import { randomUUID } from "node:crypto";
import { config, integrations } from "../config.js";
import { log } from "../lib/logger.js";
import { sum } from "../lib/money.js";
import { getProduct } from "../catalog/index.js";
import { calculateCost } from "../engine/cost.js";
import { assessAffordability } from "../engine/affordability.js";
import type { PurchasePlan, SolutionOption } from "../domain/types.js";
import { store, type Session } from "../store/store.js";
import { verifyPin } from "../security/pin.js";
import { userStore } from "../auth/users.js";
import { captureOrder, createOrderForPlan, PayPalError } from "../paypal/orders.js";
import { computeLock, verifyLock } from "./lock.js";
import { transition } from "./state-machine.js";

export class PlanError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function requirePlan(id: string): PurchasePlan {
  const plan = store.getPlan(id);
  if (!plan) throw new PlanError("Purchase plan not found", "PLAN_NOT_FOUND", 404);
  return plan;
}

function buildPricing(option: SolutionOption, session: Session) {
  const cost = calculateCost(option.components);
  return { cost, affordability: assessAffordability(cost, session.profile) };
}

function planFromOption(session: Session, option: SolutionOption, plan?: PurchasePlan): PurchasePlan {
  const { cost, affordability } = buildPricing(option, session);
  const included = option.components.filter((c) => c.included);
  const items = included
    .filter((c) => c.kind !== "SUBSCRIPTION" && c.unitPrice > 0)
    .map((c) => ({ sku: c.productId, name: c.title, retailer: c.retailer, quantity: c.quantity, unitPrice: c.unitPrice, lineTotal: c.unitPrice * c.quantity }));
  const recurring = included
    .filter((c) => c.recurringMonthly)
    .map((c) => ({ name: c.title, monthly: (c.recurringMonthly ?? 0) * c.quantity }));
  const now = new Date().toISOString();
  return {
    id: plan?.id ?? `plan_${randomUUID().slice(0, 8)}`,
    sessionId: session.id,
    optionId: option.id,
    goal: session.profile.goal ?? "",
    title: option.name,
    reasoning: [...option.pros],
    items,
    recurring,
    pricing: {
      subtotal: sum(items.map((i) => i.lineTotal)),
      discount: cost.discount,
      shipping: cost.shipping,
      tax: cost.tax,
      total: cost.upfrontTotal,
      currency: config.currency,
    },
    ownership: { firstYearCost: cost.firstYearTotal, monthlyRecurring: cost.monthlyRecurring },
    affordability,
    status: plan?.status ?? "DRAFT",
    history: plan?.history ?? [{ status: "DRAFT", at: now }],
    createdAt: plan?.createdAt ?? now,
    updatedAt: now,
  };
}

export const transactions = {
  /** Creates (or replaces) a DRAFT plan from one of the session's solution options. */
  createPlan(sessionId: string, optionId: string, includedComponentIds?: string[]): PurchasePlan {
    const session = store.getSession(sessionId);
    if (!session) throw new PlanError("Session not found", "SESSION_NOT_FOUND", 404);
    const option = session.options.find((o) => o.id === optionId);
    if (!option) throw new PlanError("Option not found", "OPTION_NOT_FOUND", 404);

    const working: SolutionOption = includedComponentIds
      ? {
          ...option,
          components: option.components.map((c) => ({ ...c, included: c.role === "REQUIRED" || includedComponentIds.includes(c.id) })),
        }
      : option;
    if (!working.components.some((c) => c.included && c.kind !== "SUBSCRIPTION")) {
      throw new PlanError("A plan needs at least one physical item", "EMPTY_PLAN");
    }
    const plan = planFromOption(session, working);
    if (plan.items.length === 0) throw new PlanError("Nothing to charge upfront in this plan", "EMPTY_PLAN");
    // A user may only have one open draft at a time; earlier drafts are cancelled.
    for (const p of store.plansForSession(sessionId)) {
      if (p.status === "DRAFT" || p.status === "FINAL_REVIEW") {
        transition(p, "CANCELLED", "superseded by a new plan");
        store.savePlan(p);
      }
    }
    store.savePlan(plan);
    log("purchase_plan_created", { planId: plan.id, sessionId, total: plan.pricing.total });
    return plan;
  },

  /**
   * Re-validates prices against the catalog, then freezes the plan behind a SHA-256 hash.
   * All decisions happen before this point: if a price moved, the plan is returned to the user
   * for review instead of being locked.
   */
  async lock(planId: string): Promise<PurchasePlan> {
    const plan = requirePlan(planId);
    if (plan.status !== "DRAFT") throw new PlanError(`Plan is ${plan.status}, cannot lock`, "INVALID_STATE", 409);

    const changes: string[] = [];
    for (const item of plan.items) {
      const product = await getProduct(item.sku);
      if (!product?.bestOffer) {
        changes.push(`${item.name} is no longer available`);
      } else if (product.bestOffer.price !== item.unitPrice) {
        changes.push(`${item.name} changed price`);
      }
    }
    if (changes.length) {
      throw new PlanError("Prices changed since this plan was built - please review", "PRICE_CHANGED", 409, { changes });
    }

    transition(plan, "FINAL_REVIEW");
    const lock = computeLock(plan);
    plan.lock = { ...lock, lockedAt: new Date().toISOString() };
    transition(plan, "LOCKED", `hash ${lock.hash.slice(0, 12)}`);
    store.savePlan(plan);
    log("transaction_locked", { planId, hash: lock.hash, total: plan.pricing.total });
    return plan;
  },

  /**
   * PIN authorisation for an exact locked plan, then server-side PayPal order creation.
   * The PIN is checked and discarded here; it is never stored or logged.
   */
  async authorize(planId: string, lockHash: string, pin: unknown): Promise<PurchasePlan> {
    const plan = requirePlan(planId);
    if (plan.status !== "LOCKED" && plan.status !== "AUTHORIZATION_FAILED") {
      throw new PlanError(`Plan is ${plan.status}, cannot authorise`, "INVALID_STATE", 409);
    }
    if (!verifyLock(plan, lockHash)) {
      throw new PlanError("Plan contents do not match the locked transaction", "LOCK_MISMATCH", 409);
    }
    if (!integrations.paypal()) {
      throw new PlanError("PayPal sandbox is not configured on the server (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)", "PAYPAL_NOT_CONFIGURED", 503);
    }

    // Signed-in users authorise with their own PIN; guest sessions use the demo PIN.
    const owner = store.getSession(plan.sessionId)?.userId;
    const user = owner ? userStore.get(owner) : undefined;
    if (owner && !user?.pin) {
      throw new PlanError("Set your BuyWise PIN first", "PIN_NOT_SET", 409);
    }
    const pinResult = verifyPin(planId, pin, user ? (p) => userStore.checkPin(user, p) : undefined);
    if (!pinResult.ok) {
      if (plan.status === "LOCKED") transition(plan, "AUTHORIZATION_FAILED", pinResult.reason);
      if (pinResult.reason === "LOCKED_OUT") transition(plan, "CANCELLED", "too many PIN attempts");
      store.savePlan(plan);
      log("authorization_failed", { planId, reason: pinResult.reason }, "warn");
      throw new PlanError(
        pinResult.reason === "LOCKED_OUT" ? "Too many incorrect PIN attempts. This plan was cancelled." : "Incorrect PIN",
        pinResult.reason,
        401,
        { attemptsLeft: pinResult.attemptsLeft },
      );
    }
    if (plan.status === "AUTHORIZATION_FAILED") transition(plan, "LOCKED", "retry");

    const now = Date.now();
    transition(plan, "AUTHORIZED");
    plan.authorization = {
      authorizedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.security.authorizationTtlMs).toISOString(),
      lockHash,
    };
    log("authorization_success", { planId });

    try {
      const order = await createOrderForPlan(plan);
      plan.paypal = { orderId: order.orderId, status: order.status };
      transition(plan, "PAYMENT_PENDING", `PayPal order ${order.orderId}`);
      log("paypal_order_created", { planId, orderId: order.orderId, total: plan.pricing.total });
    } catch (err) {
      plan.failureReason = err instanceof Error ? err.message : String(err);
      transition(plan, "SYSTEM_ERROR", plan.failureReason);
      log("paypal_order_failed", { planId, error: plan.failureReason, code: err instanceof PayPalError ? err.code : undefined }, "error");
      store.savePlan(plan);
      throw new PlanError("Could not create the PayPal order", err instanceof PayPalError ? err.code : "PAYPAL_UNAVAILABLE", 502);
    }
    store.savePlan(plan);
    return plan;
  },

  /** Captures the PayPal order after buyer approval. Idempotent per plan. */
  async capture(planId: string, orderId: string): Promise<PurchasePlan> {
    const plan = requirePlan(planId);
    if (plan.status === "PAYMENT_SUCCESS" && plan.paypal?.orderId === orderId) return plan; // duplicate request
    if (plan.status !== "PAYMENT_PENDING") throw new PlanError(`Plan is ${plan.status}, cannot capture`, "INVALID_STATE", 409);
    if (plan.paypal?.orderId !== orderId) throw new PlanError("Order does not belong to this plan", "ORDER_MISMATCH", 409);
    if (!plan.authorization || Date.parse(plan.authorization.expiresAt) < Date.now()) {
      transition(plan, "PAYMENT_FAILED", "authorization expired");
      store.savePlan(plan);
      throw new PlanError("Authorization expired - please start again", "AUTHORIZATION_EXPIRED", 409);
    }
    if (!verifyLock(plan, plan.authorization.lockHash)) {
      transition(plan, "SYSTEM_ERROR", "lock mismatch at capture");
      store.savePlan(plan);
      throw new PlanError("Plan changed after authorization", "LOCK_MISMATCH", 409);
    }

    const idemKey = `capture:${orderId}`;
    if (store.getCapture(idemKey)) return requirePlan(store.getCapture(idemKey)!);

    const result = await captureOrder(orderId).catch((err) => ({ status: "FAILED" as const, code: String(err?.message ?? err) }));
    if (result.status === "COMPLETED") {
      plan.paypal = { ...plan.paypal, status: "COMPLETED", captureId: result.captureId, payerEmail: result.payerEmail };
      transition(plan, "PAYMENT_SUCCESS", `capture ${result.captureId}`);
      store.setCapture(idemKey, plan.id);
      log("paypal_payment_captured", { planId, orderId, captureId: result.captureId });
      log("transaction_completed", { planId, total: plan.pricing.total });
    } else if (result.status === "DECLINED") {
      plan.failureReason = result.code ?? "Payment declined";
      transition(plan, "PAYMENT_DECLINED", plan.failureReason);
      log("transaction_failed", { planId, reason: "declined", code: result.code }, "warn");
    } else if (result.status === "PENDING") {
      // PayPal accepted the capture but is holding funds; keep the plan pending - the webhook will settle it.
      plan.paypal = { ...plan.paypal, status: "PENDING", captureId: result.captureId };
      store.setCapture(idemKey, plan.id);
      log("paypal_capture_pending", { planId, orderId });
    } else {
      plan.failureReason = result.code ?? "Payment failed";
      transition(plan, "PAYMENT_FAILED", plan.failureReason);
      log("transaction_failed", { planId, reason: "failed", code: result.code }, "error");
    }
    store.savePlan(plan);
    return plan;
  },

  /** Webhook settlement for captures that completed asynchronously. */
  settleFromWebhook(orderId: string, eventType: string, captureId?: string) {
    for (const sessionPlan of store.allPlans()) {
      if (sessionPlan.paypal?.orderId !== orderId || sessionPlan.status !== "PAYMENT_PENDING") continue;
      if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        sessionPlan.paypal = { ...sessionPlan.paypal, status: "COMPLETED", captureId };
        transition(sessionPlan, "PAYMENT_SUCCESS", "webhook");
      } else if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "PAYMENT.CAPTURE.DECLINED") {
        transition(sessionPlan, "PAYMENT_DECLINED", "webhook");
      }
      store.savePlan(sessionPlan);
      log("webhook_settled", { planId: sessionPlan.id, eventType });
    }
  },

  cancel(planId: string): PurchasePlan {
    const plan = requirePlan(planId);
    transition(plan, "CANCELLED", "cancelled by user");
    store.savePlan(plan);
    return plan;
  },
};
