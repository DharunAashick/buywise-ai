import type { PlanStatus, PurchasePlan } from "../domain/types.js";

// Explicit transitions: the only way a plan reaches PAYMENT_PENDING is LOCKED -> AUTHORIZED,
// and AUTHORIZED is only reachable through the PIN service. The LLM cannot call any of these.
const TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  DRAFT: ["FINAL_REVIEW", "CANCELLED"],
  FINAL_REVIEW: ["LOCKED", "DRAFT", "CANCELLED"],
  LOCKED: ["AUTHORIZED", "AUTHORIZATION_FAILED", "CANCELLED"],
  AUTHORIZATION_FAILED: ["LOCKED", "CANCELLED"],
  AUTHORIZED: ["PAYMENT_PENDING", "CANCELLED", "SYSTEM_ERROR"],
  PAYMENT_PENDING: ["PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_DECLINED", "SYSTEM_ERROR"],
  PAYMENT_SUCCESS: [],
  PAYMENT_FAILED: ["CANCELLED"],
  PAYMENT_DECLINED: ["CANCELLED"],
  SYSTEM_ERROR: ["CANCELLED"],
  CANCELLED: [],
};

export class TransitionError extends Error {
  constructor(readonly from: PlanStatus, readonly to: PlanStatus) {
    super(`Illegal plan transition ${from} -> ${to}`);
  }
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(plan: PurchasePlan, to: PlanStatus, note?: string): PurchasePlan {
  if (!canTransition(plan.status, to)) throw new TransitionError(plan.status, to);
  plan.status = to;
  plan.history.push({ status: to, at: new Date().toISOString(), note });
  return plan;
}
