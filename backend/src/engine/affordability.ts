import { formatForUser, type LocalFx } from "../lib/money.js";
import type { Affordability, CostBreakdown, UserProfile } from "../domain/types.js";

// Decision support, not financial advice: we only compare the purchase with figures the user
// chose to share, and describe the impact in neutral terms.

const DEFAULT_SAVINGS_RATE = 0.2; // assumed share of income a person could set aside, when no budget is given

export function assessAffordability(cost: CostBreakdown, profile: UserProfile): Affordability {
  const fx = localFx(profile);
  const fmt = (cents: number) => formatForUser(cents, fx);
  const notes: string[] = [];
  const income = profile.monthlyIncome;

  if (!income) {
    if (profile.maxUpfront && cost.upfrontTotal > profile.maxUpfront) {
      notes.push(`Upfront cost is ${fmt(cost.upfrontTotal - profile.maxUpfront)} above the stated maximum.`);
      return { impact: "HIGH", notes };
    }
    notes.push("No income or budget shared, so financial impact was not assessed.");
    return { impact: "UNKNOWN", notes };
  }

  const ratio = cost.upfrontTotal / income;
  const recurringShare = cost.monthlyRecurring / income;
  const impact: Affordability["impact"] = ratio < 0.25 ? "LOW" : ratio < 0.75 ? "MODERATE" : ratio < 1.5 ? "HIGH" : "VERY_HIGH";

  notes.push(`Upfront cost is ${ratio.toFixed(2)}x the monthly income provided.`);
  if (cost.monthlyRecurring > 0) {
    notes.push(`Ongoing subscriptions use ${(recurringShare * 100).toFixed(1)}% of monthly income.`);
  }

  const monthlySaving = profile.monthlyBudget ?? Math.round(income * DEFAULT_SAVINGS_RATE);
  const monthsOfSavingNeeded = Math.max(1, Math.ceil(cost.upfrontTotal / monthlySaving));
  if (impact === "HIGH" || impact === "VERY_HIGH") {
    notes.push(
      `Saving ${fmt(monthlySaving)}/month${profile.monthlyBudget ? "" : " (20% of income)"} would cover it in about ${monthsOfSavingNeeded} months.`,
    );
  }
  if (profile.maxUpfront && cost.upfrontTotal > profile.maxUpfront) {
    notes.push(`Upfront cost is ${fmt(cost.upfrontTotal - profile.maxUpfront)} above the stated maximum.`);
  }

  return {
    monthlyIncome: income,
    monthlyBudget: profile.monthlyBudget,
    upfrontToIncomeRatio: Number(ratio.toFixed(3)),
    recurringShareOfIncome: Number(recurringShare.toFixed(4)),
    impact,
    monthsOfSavingNeeded,
    notes,
  };
}

/** The user's own currency, if they stated their salary in one (amounts are still computed in USD). */
export function localFx(profile: UserProfile): LocalFx | undefined {
  const s = profile.statedIncome;
  return s && s.currency !== "USD" ? { currency: s.currency, usdRate: s.usdRate } : undefined;
}
