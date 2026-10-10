import { sum, type Cents } from "../lib/money.js";
import type { BundleCheck, CostBreakdown, SolutionComponent } from "../domain/types.js";

export interface CostOptions {
  /** Estimated sales-tax rate, e.g. 0.0825. Defaults to 0 (retailer computes tax at checkout). */
  taxRate?: number;
  shipping?: Cents;
  discount?: Cents;
}

function lineTotal(c: SolutionComponent): Cents {
  return c.unitPrice * c.quantity;
}

/**
 * Deterministic total-cost-of-ownership calculation.
 *   upfront     = hardware + accessories + software - discount + shipping + tax
 *   firstYear   = upfront + 12 x monthly recurring
 */
export function calculateCost(components: SolutionComponent[], opts: CostOptions = {}): CostBreakdown {
  const included = components.filter((c) => c.included);
  const byKind = (kind: SolutionComponent["kind"]) => sum(included.filter((c) => c.kind === kind).map(lineTotal));

  const hardware = byKind("HARDWARE");
  const accessories = byKind("ACCESSORY");
  const software = byKind("SOFTWARE");
  const upfrontSubtotal = hardware + accessories + software;
  const discount = Math.min(opts.discount ?? 0, upfrontSubtotal);
  const shipping = opts.shipping ?? 0;
  const tax = Math.round((upfrontSubtotal - discount) * (opts.taxRate ?? 0));
  const upfrontTotal = upfrontSubtotal - discount + shipping + tax;

  const monthlyRecurring = sum(
    included.filter((c) => c.recurringMonthly).map((c) => (c.recurringMonthly ?? 0) * c.quantity),
  );
  const annualRecurring = monthlyRecurring * 12;

  return {
    hardware,
    accessories,
    software,
    upfrontSubtotal,
    discount,
    shipping,
    tax,
    upfrontTotal,
    monthlyRecurring,
    annualRecurring,
    firstYearTotal: upfrontTotal + annualRecurring,
  };
}

/** Compares buying a bundle against buying the components it replaces separately. */
export function checkBundle(
  bundle: { productId: string; title: string; price: Cents },
  replaced: SolutionComponent[],
): BundleCheck {
  const separatePrice = sum(replaced.map(lineTotal));
  return {
    bundleProductId: bundle.productId,
    bundleTitle: bundle.title,
    bundlePrice: bundle.price,
    separatePrice,
    savings: separatePrice - bundle.price,
    replacesComponentIds: replaced.map((c) => c.id),
  };
}
