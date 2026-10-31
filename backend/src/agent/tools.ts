import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { formatLocal, formatMoney, toCents, type LocalFx } from "../lib/money.js";
import { toUsd } from "../lib/fx.js";
import { getProduct, searchProducts } from "../catalog/index.js";
import { calculateCost, checkBundle } from "../engine/cost.js";
import { assessAffordability, localFx } from "../engine/affordability.js";
import { scoreOptions } from "../engine/scoring.js";
import type { SolutionComponent, SolutionOption } from "../domain/types.js";
import { store, type Session } from "../store/store.js";
import { transactions } from "../transactions/service.js";
import { getAgentToolkit, runToolkit } from "../paypal/toolkit.js";

// ---------- Tool input schemas (single source: used for validation and for the JSON schema sent to Claude) ----------

const ProfileInput = z.object({
  goal: z.string().optional().describe("What the user wants to achieve, in their words, e.g. 'get into gaming'"),
  experience: z.string().optional().describe("beginner / casual / experienced, if known"),
  country: z.string().optional().describe("Country the user lives in, e.g. 'India', 'United States'"),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code of the amounts below exactly as the user stated them, e.g. INR for '₹60,000', USD for '$2,000'. Do not convert amounts yourself."),
  monthly_income: z.number().positive().optional().describe("Monthly income exactly as the user stated it, in `currency`"),
  monthly_budget: z.number().positive().optional().describe("Monthly spend/save amount the user stated, in `currency`"),
  max_upfront: z.number().positive().optional().describe("Maximum upfront spend the user stated, in `currency`"),
  income_declined: z.boolean().optional().describe("True if the user prefers not to share income"),
  preferences: z.array(z.string()).optional().describe("Stated preferences, e.g. 'plays with friends online', 'wants portability'"),
});

// Channel3 markets (docs: config.country). Other countries fall back to the US catalog.
const CHANNEL3_MARKETS: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", america: "US",
  "united kingdom": "GB", uk: "GB", gb: "GB", england: "GB", britain: "GB",
  canada: "CA", ca: "CA", australia: "AU", au: "AU", ireland: "IE", ie: "IE",
  germany: "DE", de: "DE", austria: "AT", france: "FR", belgium: "BE", italy: "IT", spain: "ES",
  netherlands: "NL", sweden: "SE", finland: "FI", portugal: "PT", "czech republic": "CZ", czechia: "CZ",
  greece: "GR", romania: "RO",
};

export function catalogMarket(country: string): string {
  return CHANNEL3_MARKETS[country.trim().toLowerCase()] ?? "US";
}

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
  cons: z.array(z.string()).max(5).default([]),
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

function optionSummary(o: SolutionOption, fx?: LocalFx) {
  const local = (cents: number) => (fx ? formatLocal(cents, fx) : undefined);
  return {
    option_id: o.id,
    name: o.name,
    approach: o.approach,
    upfront_total: formatMoney(o.cost.upfrontTotal),
    monthly_recurring: formatMoney(o.cost.monthlyRecurring),
    first_year_total: formatMoney(o.cost.firstYearTotal),
    // Approximate amounts in the user's own currency - quote these to the user.
    in_user_currency: fx
      ? {
          currency: fx.currency,
          upfront_total: local(o.cost.upfrontTotal),
          monthly_recurring: local(o.cost.monthlyRecurring),
          first_year_total: local(o.cost.firstYearTotal),
        }
      : undefined,
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

const KIND_LABEL: Record<string, string> = { SOFTWARE: "games/software", SUBSCRIPTION: "a subscription", ACCESSORY: "accessories" };

/**
 * Like-for-like check: if some options include games/subscriptions and another has none, its cost
 * looks artificially low. Flags each gap once, unless the option's cons already explain it.
 */
export function comparabilityGaps(options: SolutionOption[]): string[] {
  if (options.length < 2) return [];
  const has = (o: SolutionOption, kind: string) => o.components.some((c) => c.included && c.kind === kind);
  const gaps: string[] = [];
  for (const kind of ["SOFTWARE", "SUBSCRIPTION"]) {
    const withKind = options.filter((o) => has(o, kind)).length;
    if (withKind === 0 || withKind === options.length) continue;
    for (const o of options) {
      if (has(o, kind)) continue;
      const explained = o.cons.some((c) => /no (subscription|game)|subscription.*(not|n't) (needed|required)|free online/i.test(c));
      if (!explained) gaps.push(`${o.name} (${o.id}) has no ${KIND_LABEL[kind]}, unlike the other options.`);
    }
  }
  return gaps;
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
      "Save what you learned: goal, experience, country, and any income/budget figures. Give amounts exactly as the user said them with their currency code; the backend converts to USD. Call whenever new information appears.",
    run: async (session, input: z.infer<typeof ProfileInput>) => {
      const p = session.profile;
      if (input.goal) p.goal = input.goal;
      if (input.experience) p.experience = input.experience;
      if (input.country) {
        p.country = input.country;
        p.catalogCountry = catalogMarket(input.country);
      }
      if (input.income_declined) p.intakeAsked = true;

      const currency = (input.currency ?? "USD").toUpperCase();
      const amounts = [input.monthly_income, input.monthly_budget, input.max_upfront];
      let conversion: Awaited<ReturnType<typeof toUsd>> | undefined;
      if (amounts.some((a) => a !== undefined)) conversion = await toUsd(1, currency);
      const usd = (amount: number) => toCents(amount * conversion!.rate);
      if (input.monthly_income) {
        p.monthlyIncome = usd(input.monthly_income);
        p.statedIncome = { amount: input.monthly_income, currency, usdRate: conversion!.rate, rateSource: conversion!.source };
      }
      if (input.monthly_budget) p.monthlyBudget = usd(input.monthly_budget);
      if (input.max_upfront) p.maxUpfront = usd(input.max_upfront);
      if (input.preferences) p.preferences = [...new Set([...p.preferences, ...input.preferences])];
      if (p.country && (p.monthlyIncome || input.income_declined)) p.intakeAsked = true;
      if (session.options.length) rescore(session);

      const unsupportedMarket = p.country && p.catalogCountry === "US" && !/united states|usa|^us$|america/i.test(p.country);
      return {
        saved: true,
        country: p.country,
        product_market: p.catalogCountry,
        note: unsupportedMarket
          ? `Product search isn't available for ${p.country}; using US retailer prices in USD. Tell the user this once.`
          : undefined,
        monthly_income_usd: p.monthlyIncome !== undefined ? formatMoney(p.monthlyIncome) : undefined,
        stated_income: p.statedIncome ? `${p.statedIncome.amount} ${p.statedIncome.currency}` : undefined,
        fx_rate: conversion && currency !== "USD" ? `1 ${currency} = ${conversion.rate} USD (${conversion.source})` : undefined,
        monthly_budget_usd: p.monthlyBudget !== undefined ? formatMoney(p.monthlyBudget) : undefined,
        max_upfront_usd: p.maxUpfront !== undefined ? formatMoney(p.maxUpfront) : undefined,
        goal: p.goal,
      };
    },
  },

  search_products: {
    schema: SearchInput,
    description:
      "Search the product catalog (Channel3: products and offers across retailers). Returns product ids, best in-stock price and retailer. Subscriptions return a monthly price. Search each approach and each needed component separately.",
    run: async (session, input: z.infer<typeof SearchInput>) => {
      const results = await searchProducts(input.query, {
        maxPrice: input.max_price,
        minPrice: input.min_price,
        limit: input.limit ?? 6,
        country: session.profile.catalogCountry,
      });
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
      session.rankGapWarned = false; // options changed: check comparability again
      rescore(session);
      return optionSummary(session.options.find((o) => o.id === option.id)!, localFx(session.profile));
    },
  },

  rank_options: {
    schema: RankInput,
    description:
      "Score and rank all built options with the deterministic scoring engine (cost, goal fit, budget fit, bundle value, availability). Returns the ranking with score breakdowns, or asks you to fix options that aren't comparable first.",
    run: async (session) => {
      const gaps = comparabilityGaps(session.options);
      // Ask for a fix once per set of options; if the agent ranks again anyway, rank with warnings.
      if (gaps.length && !session.rankGapWarned) {
        session.rankGapWarned = true;
        return {
          ranked: false,
          fix_first: gaps,
          instruction:
            "Options must be like-for-like before ranking. Search for and add the missing kinds of components (e.g. a first game and/or the platform's subscription) by rebuilding those options with build_solution_option and remove_option for the old ones, then call rank_options again. If a platform genuinely needs none, say so in its cons.",
        };
      }
      rescore(session);
      return {
        weights: "cost 30%, goal fit 30%, budget fit 20%, bundle value 10%, availability 10%",
        ranking: session.options.map((o) => optionSummary(o, localFx(session.profile))),
        warnings: gaps.length ? gaps.map((g) => `${g} Mention this when comparing costs.`) : undefined,
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
        charged_in_user_currency_approx: localFx(session.profile) ? formatLocal(plan.pricing.total, localFx(session.profile)!) : undefined,
        next_step: "User reviews and locks the plan in the checkout panel, then approves with PIN and PayPal. PayPal charges the exact USD amount.",
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
