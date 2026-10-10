import type { ScoreBreakdown, SolutionOption, UserProfile } from "../domain/types.js";

// Reproducible recommendation scoring. The agent supplies goal fit (with written reasons);
// everything else is derived from catalog data and the cost engine. Weights are configurable and
// deliberately neutral - no platform is favoured by construction.

export interface ScoreWeights {
  cost: number;
  goalFit: number;
  budgetFit: number;
  bundleValue: number;
  availability: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { cost: 0.3, goalFit: 0.3, budgetFit: 0.2, bundleValue: 0.1, availability: 0.1 };

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Continuous budget fit (no cliffs between impact bands): 10 at zero cost, falling linearly to 0 when
 * the upfront cost reaches 2x monthly income, minus a penalty for subscriptions' share of income.
 */
function budgetFitScore(o: SolutionOption, profile: UserProfile): number {
  const income = profile.monthlyIncome;
  let score: number;
  if (income) {
    const upfrontRatio = o.cost.upfrontTotal / income;
    const recurringShare = o.cost.monthlyRecurring / income;
    score = 10 * (1 - upfrontRatio / 2) - recurringShare * 40;
  } else {
    score = 6; // unknown budget: neutral
  }
  if (profile.maxUpfront && o.cost.upfrontTotal > profile.maxUpfront) score = Math.min(score, 2);
  return clamp(score, 0, 10);
}

export function scoreOptions(
  options: SolutionOption[],
  profile: UserProfile,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): SolutionOption[] {
  if (options.length === 0) return [];
  const min = Math.min(...options.map((o) => o.cost.firstYearTotal));

  const scored = options.map((o) => {
    // Relative to the cheapest first-year cost: an option 25% more expensive scores 8/10. Relative (not
    // min-max) scaling keeps a small price gap from looking like a large one.
    const cost = o.cost.firstYearTotal <= 0 ? 10 : 10 * (Math.max(1, min) / o.cost.firstYearTotal);
    const budgetFit = budgetFitScore(o, profile);
    const savings = o.bundle && o.bundle.savings > 0 ? o.bundle.savings : 0;
    const bundleValue = savings > 0 ? Math.min(10, 6 + (savings / Math.max(1, o.cost.upfrontTotal)) * 40) : 5;
    const items = o.components.filter((c) => c.included);
    const availability = items.length === 0 ? 0 : 10;
    const goalFit = Math.max(0, Math.min(10, o.goalFit));

    const total =
      cost * weights.cost +
      goalFit * weights.goalFit +
      budgetFit * weights.budgetFit +
      bundleValue * weights.bundleValue +
      availability * weights.availability;

    const score: ScoreBreakdown = {
      cost: round1(cost),
      goalFit: round1(goalFit),
      budgetFit: round1(budgetFit),
      bundleValue: round1(bundleValue),
      availability: round1(availability),
      total: round1(total),
    };
    return { ...o, score };
  });

  scored.sort((a, b) => (b.score!.total - a.score!.total) || (a.cost.firstYearTotal - b.cost.firstYearTotal));
  return scored.map((o, i) => ({ ...o, rank: i + 1 }));
}
