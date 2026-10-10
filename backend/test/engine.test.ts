import { describe, expect, it } from "vitest";
import { calculateCost, checkBundle } from "../src/engine/cost.js";
import { assessAffordability } from "../src/engine/affordability.js";
import { scoreOptions } from "../src/engine/scoring.js";
import { toDecimalString, toCents } from "../src/lib/money.js";
import type { SolutionComponent, SolutionOption } from "../src/domain/types.js";

const comp = (over: Partial<SolutionComponent>): SolutionComponent => ({
  id: over.id ?? "c",
  productId: over.productId ?? "p",
  title: "x",
  role: "REQUIRED",
  kind: "HARDWARE",
  quantity: 1,
  reason: "",
  unitPrice: 0,
  included: true,
  ...over,
});

describe("money", () => {
  it("avoids floating point drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toDecimalString(123456)).toBe("1234.56");
    expect(toDecimalString(5)).toBe("0.05");
  });
});

describe("cost engine", () => {
  const components = [
    comp({ id: "console", unitPrice: 37999 }),
    comp({ id: "pad", kind: "ACCESSORY", role: "RECOMMENDED", unitPrice: 5999, quantity: 2 }),
    comp({ id: "game", kind: "SOFTWARE", role: "RECOMMENDED", unitPrice: 3999 }),
    comp({ id: "sub", kind: "SUBSCRIPTION", role: "RECOMMENDED", unitPrice: 0, recurringMonthly: 1999 }),
    comp({ id: "headset", kind: "ACCESSORY", role: "OPTIONAL", unitPrice: 4999, included: false }),
  ];

  it("computes upfront, recurring and first-year totals exactly", () => {
    const cost = calculateCost(components);
    expect(cost.hardware).toBe(37999);
    expect(cost.accessories).toBe(11998);
    expect(cost.software).toBe(3999);
    expect(cost.upfrontTotal).toBe(53996);
    expect(cost.monthlyRecurring).toBe(1999);
    expect(cost.annualRecurring).toBe(23988);
    expect(cost.firstYearTotal).toBe(77984);
  });

  it("excludes components that are not included", () => {
    expect(calculateCost(components).accessories).toBe(11998);
    expect(calculateCost(components.map((c) => ({ ...c, included: true }))).accessories).toBe(16997);
  });

  it("applies discount, shipping and tax", () => {
    const cost = calculateCost([comp({ unitPrice: 10000 })], { discount: 1000, shipping: 500, taxRate: 0.1 });
    expect(cost.tax).toBe(900);
    expect(cost.upfrontTotal).toBe(10000 - 1000 + 500 + 900);
  });

  it("detects bundle savings", () => {
    const b = checkBundle({ productId: "bundle", title: "B", price: 47999 }, [comp({ unitPrice: 44999 }), comp({ unitPrice: 6999 })]);
    expect(b.separatePrice).toBe(51998);
    expect(b.savings).toBe(3999);
  });
});

describe("affordability", () => {
  const cost = calculateCost([comp({ unitPrice: 72498 })]);

  it("reports ratio to income neutrally", () => {
    const a = assessAffordability(cost, { monthlyIncome: 200000, preferences: [] });
    expect(a.upfrontToIncomeRatio).toBeCloseTo(0.362, 3);
    expect(a.impact).toBe("MODERATE");
  });

  it("flags high impact and suggests a saving horizon", () => {
    const a = assessAffordability(cost, { monthlyIncome: 50000, preferences: [] });
    expect(a.impact).toBe("HIGH");
    expect(a.monthsOfSavingNeeded).toBe(8); // 724.98 / (20% of 500)
    expect(a.notes.join(" ")).not.toMatch(/can't afford|cannot afford/i);
  });

  it("is UNKNOWN without income", () => {
    expect(assessAffordability(cost, { preferences: [] }).impact).toBe("UNKNOWN");
  });
});

describe("scoring", () => {
  const option = (id: string, upfront: number, goalFit: number): SolutionOption => {
    const components = [comp({ unitPrice: upfront })];
    const c = calculateCost(components);
    return {
      id, name: id, approach: "", summary: "", pros: [], cons: [], goalFit, components, cost: c,
      affordability: assessAffordability(c, { monthlyIncome: 200000, preferences: [] }), createdAt: "",
    };
  };

  it("is deterministic and ranks by weighted score", () => {
    const opts = [option("pricey", 90000, 8), option("cheap", 40000, 7), option("mid", 60000, 6)];
    const a = scoreOptions(opts, { monthlyIncome: 200000, preferences: [] });
    const b = scoreOptions(opts, { monthlyIncome: 200000, preferences: [] });
    expect(a.map((o) => o.id)).toEqual(b.map((o) => o.id));
    expect(a[0].id).toBe("cheap");
    expect(a.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it("lets a strong goal fit outrank a cheaper option", () => {
    const ranked = scoreOptions([option("cheap-poor-fit", 40000, 2), option("fit", 50000, 10)], { monthlyIncome: 200000, preferences: [] });
    expect(ranked[0].id).toBe("fit");
  });

  it("penalises options above the stated max upfront", () => {
    const ranked = scoreOptions([option("over", 80000, 9), option("under", 70000, 9)], { monthlyIncome: 200000, maxUpfront: 75000, preferences: [] });
    expect(ranked[0].id).toBe("under");
    expect(ranked.find((o) => o.id === "over")!.score!.budgetFit).toBeLessThanOrEqual(2);
  });
});
