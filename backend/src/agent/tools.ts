import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { formatMoney, toCents } from "../lib/money.js";
import { getProduct, searchProducts } from "../catalog/index.js";
import { calculateCost, checkBundle } from "../engine/cost.js";
import { assessAffordability } from "../engine/affordability.js";
import { scoreOptions } from "../engine/scoring.js";
import type { SolutionComponent, SolutionOption } from "../domain/types.js";
import { store, type Session } from "../store/store.js";
import { transactions } from "../transactions/service.js";
import { getAgentToolkit, runToolkit } from "../paypal/toolkit.js";

// ---------- Tool input schemas (single source: used for validation and for the JSON schema sent to Claude) ----------

const ProfileInput = z.object({
  goal: z.string().optional().describe("What the user wants to achieve, in their words, e.g. 'get into gaming'"),
  experience: z.string().optional().describe("beginner / casual / experienced, if known"),
  monthly_income: z.number().positive().optional().describe("Monthly income the user shared, in USD"),
  monthly_budget: z.number().positive().optional().describe("How much per month the user said they can spend or save, in USD"),
  max_upfront: z.number().positive().optional().describe("Maximum upfront spend the user stated, in USD"),
  preferences: z.array(z.string()).optional().describe("Stated preferences, e.g. 'plays with friends online', 'wants portability'"),
});

const SearchInput = z.object({
  query: z.string().min(2).describe("Natural-language product query, e.g. 'Xbox Series S console' or 'PS5 controller'"),
  max_price: z.number().positive().optional().describe("Maximum unit price in USD"),
  min_price: z.number().nonnegative().optional().describe("Minimum unit price in USD"),
  limit: z.number().int().min(1).max(12).optional().describe("Max results, default 6"),
});

const ComponentInput = z.object({
  product_id: z.string().describe("Product id from a search_products result"),
  role: z.enum(["REQUIRED", "RECOMMENDED", "OPTIONAL"]),
  kind: z.enum(["HARDWARE", "ACCESSORY", "SOFTWARE", "SUBSCRIPTION"]).describe("SUBSCRIPTION for monthly services; SOFTWARE for games/credit"),
  quantity: z.number().int().min(1).max(10).optional(),
  reason: z.string().describe("One short sentence: why this component is needed for the goal"),
});

const OptionInput = z.object({
  name: z.string().describe("Short option name, e.g. 'Xbox Series S starter setup'"),
  approach: z.string().describe("Solution category, e.g. 'Console', 'Gaming PC', 'Handheld'"),
  summary: z.string().describe("One sentence describing the option"),
  goal_fit: z.number().min(0).max(10).describe("How well this option serves the stated goal and preferences, 0-10. Justify it in pros/cons."),
  pros: z.array(z.string()).min(1).max(5),
  cons: z.array(z.string()).max(5),
  components: z.array(ComponentInput).min(1).max(12),
  bundle: z
    .object({
      bundle_product_id: z.string(),
      replaces_product_ids: z.array(z.string()).min(1).describe("Component product ids the bundle would replace"),
    })
    .optional()
    .describe("A bundle product to compare against buying the replaced components separately"),
});

const RankInput = z.object({});
const RemoveInput = z.object({ option_id: z.string() });
const PlanInput = z.object({
  option_id: z.string(),
  include_component_ids: z
    .array(z.string())
    .optional()
    .describe("Component ids to include. REQUIRED components are always included. Omit to use the option's current selection."),
});

type ToolDef = {
  schema: z.ZodType;
  description: string;
  run: (session: Session, input: any) => Promise<unknown>;
};

// ---------- Helpers ----------

function productSummary(p: Awaited<ReturnType<typeof searchProducts>>[number]) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    category: p.category,
    price: p.recurringMonthly ? undefined : p.bestOffer ? formatMoney(p.bestOffer.price) : "unavailable",
    monthly: p.recurringMonthly ? formatMoney(p.recurringMonthly) : undefined,
    was: p.bestOffer?.compareAtPrice ? formatMoney(p.bestOffer.compareAtPrice) : undefined,
    retailer: p.bestOffer?.retailer,
    other_offers: Math.max(0, p.offers.length - 1),
    features: p.keyFeatures.slice(0, 4),
    source: p.source,
  };
}

function optionSummary(o: SolutionOption) {
  return {
    option_id: o.id,
    name: o.name,
    approach: o.approach,
    upfront_total: formatMoney(o.cost.upfrontTotal),
    monthly_recurring: formatMoney(o.cost.monthlyRecurring),
    first_year_total: formatMoney(o.cost.firstYearTotal),
    bundle: o.bundle
      ? { title: o.bundle.bundleTitle, used: o.bundle.savings > 0, savings: formatMoney(o.bundle.savings) }
      : undefined,
    financial_impact: o.affordability.impact,
    affordability_notes: o.affordability.notes,
    components: o.components.map((c) => ({
      component_id: c.id,
      title: c.title,
      role: c.role,
      included: c.included,
      price: c.recurringMonthly ? `${formatMoney(c.recurringMonthly)}/mo` : formatMoney(c.unitPrice * c.quantity),
    })),
    score: o.score,
    rank: o.rank,
  };
}

async function buildOption(session: Session, input: z.infer<typeof OptionInput>): Promise<SolutionOption> {
  const components: SolutionComponent[] = [];
  const missing: string[] = [];
  for (const c of input.components) {
    const product = await getProduct(c.product_id);
    if (!product || (!product.bestOffer && !product.recurringMonthly)) {
      missing.push(c.product_id);
      continue;
    }
    const isSub = c.kind === "SUBSCRIPTION" || Boolean(product.recurringMonthly);
    components.push({
      id: `c_${randomUUID().slice(0, 6)}`,
      productId: product.id,
      title: product.title,
      role: c.role,
      kind: isSub ? "SUBSCRIPTION" : c.kind,
      quantity: c.quantity ?? 1,
      reason: c.reason,
      unitPrice: isSub ? 0 : product.bestOffer!.price,
      recurringMonthly: product.recurringMonthly,
      retailer: product.bestOffer?.retailer,
      url: product.bestOffer?.url,
      image: product.image,
      included: c.role !== "OPTIONAL",
    });
  }
  if (missing.length) {
    throw new Error(`Unknown or unpriced product ids: ${missing.join(", ")}. Use ids returned by search_products.`);
  }

  let bundle: SolutionOption["bundle"];
  if (input.bundle) {
    const bundleProduct = await getProduct(input.bundle.bundle_product_id);
    const replaced = components.filter((c) => input.bundle!.replaces_product_ids.includes(c.productId));
    if (bundleProduct?.bestOffer && replaced.length) {
      bundle = checkBundle({ productId: bundleProduct.id, title: bundleProduct.title, price: bundleProduct.bestOffer.price }, replaced);
      if (bundle.savings > 0) {
        // The bundle is cheaper: buy it instead of the separate components.
        for (const r of replaced) r.included = false;
        components.unshift({
          id: `c_${randomUUID().slice(0, 6)}`,
          productId: bundleProduct.id,
          title: bundleProduct.title,
          role: "REQUIRED",
          kind: "HARDWARE",
          quantity: 1,
          reason: `Bundle saves ${formatMoney(bundle.savings)} versus buying separately`,
          unitPrice: bundleProduct.bestOffer.price,
          retailer: bundleProduct.bestOffer.retailer,
          url: bundleProduct.bestOffer.url,
          image: bundleProduct.image,
          included: true,
        });
        // Replaced components are covered by the bundle; mark them so they can't be double-bought.
        for (const r of replaced) {
          r.role = "OPTIONAL";
          r.reason = `Already included in ${bundleProduct.title} - only add if you want a second one`;
        }
      }
    }
  }

  const cost = calculateCost(components);
  return {
    id: `opt_${randomUUID().slice(0, 6)}`,
    name: input.name,
    approach: input.approach,
    summary: input.summary,
    pros: input.pros,
    cons: input.cons,
    goalFit: input.goal_fit,
    components,
    bundle,
    cost,
    affordability: assessAffordability(cost, session.profile),
    createdAt: new Date().toISOString(),
  };
}

function rescore(session: Session) {
  session.options = session.options.map((o) => ({ ...o, affordability: assessAffordability(o.cost, session.profile) }));
  session.options = scoreOptions(session.options, session.profile);
  session.recommendedOptionId = session.options[0]?.id;
}

// ---------- BuyWise tools ----------

const TOOLS: Record<string, ToolDef> = {
  update_user_profile: {
    schema: ProfileInput,
    description:
      "Save what you learned about the user's goal, experience, and any income/budget figures they chose to share. Call whenever new information appears. Amounts in USD.",
    run: async (session, input: z.infer<typeof ProfileInput>) => {
      const p = session.profile;
      if (input.goal) p.goal = input.goal;
      if (input.experience) p.experience = input.experience;
      if (input.monthly_income) p.monthlyIncome = toCents(input.monthly_income);
      if (input.monthly_budget) p.monthlyBudget = toCents(input.monthly_budget);
      if (input.max_upfront) p.maxUpfront = toCents(input.max_upfront);
      if (input.preferences) p.preferences = [...new Set([...p.preferences, ...input.preferences])];
      if (session.options.length) rescore(session);
      return { saved: true, profile: { ...p, monthlyIncome: p.monthlyIncome && formatMoney(p.monthlyIncome), monthlyBudget: p.monthlyBudget && formatMoney(p.monthlyBudget), maxUpfront: p.maxUpfront && formatMoney(p.maxUpfront) } };
    },
  },

  search_products: {
    schema: SearchInput,
    description:
      "Search the product catalog (Channel3: products and offers across retailers). Returns product ids, best in-stock price and retailer. Subscriptions return a monthly price. Search each approach and each needed component separately.",
    run: async (_session, input: z.infer<typeof SearchInput>) => {
      const results = await searchProducts(input.query, { maxPrice: input.max_price, minPrice: input.min_price, limit: input.limit ?? 6 });
      return { query: input.query, count: results.length, products: results.map(productSummary) };
    },
  },

  build_solution_option: {
    schema: OptionInput,
    description:
      "Assemble one complete way to reach the goal from catalog products. The cost engine prices every component from the catalog and returns upfront, monthly and first-year totals plus financial impact. If a bundle is given, the engine checks whether it is cheaper than the separate components and uses it only if it is.",
    run: async (session, input: z.infer<typeof OptionInput>) => {
      const option = await buildOption(session, input);
      session.options.push(option);
      rescore(session);
      return optionSummary(session.options.find((o) => o.id === option.id)!);
    },
  },

  rank_options: {
    schema: RankInput,
    description:
      "Score and rank all built options with the deterministic scoring engine (cost, goal fit, budget fit, bundle value, availability). Returns the ranking with score breakdowns.",
    run: async (session) => {
      rescore(session);
      return {
        weights: "cost 30%, goal fit 30%, budget fit 20%, bundle value 10%, availability 10%",
        ranking: session.options.map(optionSummary),
      };
    },
  },

  remove_option: {
    schema: RemoveInput,
    description: "Remove an option that turned out to be a poor fit or a duplicate.",
    run: async (session, input: z.infer<typeof RemoveInput>) => {
      session.options = session.options.filter((o) => o.id !== input.option_id);
      rescore(session);
      return { removed: input.option_id, remaining: session.options.length };
    },
  },

  prepare_purchase_plan: {
    schema: PlanInput,
    description:
      "Prepare a DRAFT purchase plan for the option the user chose, for them to review in the checkout panel. This does not lock or pay anything; the user locks and approves it with their PIN outside this conversation.",
    run: async (session, input: z.infer<typeof PlanInput>) => {
      store.saveSession(session);
      const plan = transactions.createPlan(session.id, input.option_id, input.include_component_ids);
      return {
        plan_id: plan.id,
        status: plan.status,
        items: plan.items.map((i) => `${i.quantity} x ${i.name} - ${formatMoney(i.lineTotal)}`),
        upfront_total: formatMoney(plan.pricing.total),
        monthly_recurring: formatMoney(plan.ownership.monthlyRecurring),
        first_year_cost: formatMoney(plan.ownership.firstYearCost),
        next_step: "User reviews and locks the plan in the checkout panel, then approves with PIN and PayPal.",
      };
    },
  },
};

// ---------- PayPal Agent Toolkit (read-only) ----------

const PAYPAL_AGENT_TOOL_NAMES = new Set(["get_order", "list_transactions", "get_shipment_tracking"]);

/** Provider-neutral tool description; each orchestrator maps it to its own wire format. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

function paypalAgentTools(): ToolSpec[] {
  const toolkit = getAgentToolkit();
  if (!toolkit) return [];
  return toolkit
    .getTools()
    .filter((t) => PAYPAL_AGENT_TOOL_NAMES.has(t.function.name))
    .map((t) => ({
      name: t.function.name,
      description: `[PayPal] ${t.function.description ?? ""}`.slice(0, 1000),
      schema: (t.function.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
    }));
}

// ---------- Registry ----------

let cachedSpecs: ToolSpec[] | undefined;

export function toolSpecs(): ToolSpec[] {
  cachedSpecs ??= [
    ...Object.entries(TOOLS).map(([name, def]) => ({
      name,
      description: def.description,
      schema: z.toJSONSchema(def.schema, { target: "draft-7" }) as Record<string, unknown>,
    })),
    ...paypalAgentTools(),
  ];
  return cachedSpecs;
}

export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return toolSpecs().map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: s.schema as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

export class ToolInputError extends Error {}

export async function executeTool(session: Session, name: string, rawInput: unknown): Promise<unknown> {
  const def = TOOLS[name];
  if (def) {
    const parsed = def.schema.safeParse(rawInput ?? {});
    if (!parsed.success) throw new ToolInputError(`Invalid input for ${name}: ${parsed.error.message}`);
    return def.run(session, parsed.data);
  }
  if (PAYPAL_AGENT_TOOL_NAMES.has(name)) {
    const toolkit = getAgentToolkit();
    if (!toolkit) throw new Error("PayPal is not configured");
    return runToolkit(toolkit, name, rawInput ?? {});
  }
  throw new Error(`Unknown tool: ${name}`);
}

/** Short human-readable label for the activity feed. */
export function describeToolCall(name: string, input: any): string {
  switch (name) {
    case "update_user_profile":
      return "Updating your goal and budget profile";
    case "search_products":
      return `Searching products: "${input?.query ?? ""}"`;
    case "build_solution_option":
      return `Building option: ${input?.name ?? ""}`;
    case "rank_options":
      return "Scoring and ranking options";
    case "remove_option":
      return "Removing an option";
    case "prepare_purchase_plan":
      return "Preparing purchase plan for review";
    case "get_order":
      return "Checking PayPal order status";
    case "list_transactions":
      return "Reading PayPal transactions";
    case "get_shipment_tracking":
      return "Checking shipment tracking";
    default:
      return name;
  }
}
