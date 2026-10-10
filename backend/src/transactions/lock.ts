import { createHash } from "node:crypto";
import type { PurchasePlan } from "../domain/types.js";

/** JSON with recursively sorted keys, so the same plan always serialises to the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The financially meaningful part of a plan: exactly what the user is authorising. */
export function lockPayload(plan: PurchasePlan) {
  return {
    planId: plan.id,
    currency: plan.pricing.currency,
    items: plan.items.map((i) => ({ sku: i.sku, name: i.name, retailer: i.retailer ?? null, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    recurring: plan.recurring.map((r) => ({ name: r.name, monthly: r.monthly })),
    subtotal: plan.pricing.subtotal,
    discount: plan.pricing.discount,
    shipping: plan.pricing.shipping,
    tax: plan.pricing.tax,
    total: plan.pricing.total,
  };
}

export function computeLock(plan: PurchasePlan): { hash: string; canonical: string } {
  const canonical = canonicalJson(lockPayload(plan));
  return { hash: createHash("sha256").update(canonical).digest("hex"), canonical };
}

/** True if the plan still matches the hash that was locked (no field changed after lock). */
export function verifyLock(plan: PurchasePlan, expectedHash: string): boolean {
  if (!plan.lock || plan.lock.hash !== expectedHash) return false;
  return computeLock(plan).hash === expectedHash;
}
