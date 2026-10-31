// Mirrors backend/src/domain/types.ts. All money values are integer cents.

export type ComponentRole = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
export type ComponentKind = 'HARDWARE' | 'ACCESSORY' | 'SOFTWARE' | 'SUBSCRIPTION';
export type Impact = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' | 'UNKNOWN';

export interface SolutionComponent {
  id: string;
  productId: string;
  title: string;
  role: ComponentRole;
  kind: ComponentKind;
  quantity: number;
  reason: string;
  unitPrice: number;
  retailer?: string;
  url?: string;
  image?: string;
  recurringMonthly?: number;
  included: boolean;
}

export interface CostBreakdown {
  hardware: number;
  accessories: number;
  software: number;
  upfrontSubtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  upfrontTotal: number;
  monthlyRecurring: number;
  annualRecurring: number;
  firstYearTotal: number;
}

export interface Affordability {
  monthlyIncome?: number;
  monthlyBudget?: number;
  upfrontToIncomeRatio?: number;
  recurringShareOfIncome?: number;
  impact: Impact;
  monthsOfSavingNeeded?: number;
  notes: string[];
}

export interface ScoreBreakdown {
  cost: number;
  goalFit: number;
  budgetFit: number;
  bundleValue: number;
  availability: number;
  total: number;
}

export interface SolutionOption {
  id: string;
  name: string;
  approach: string;
  summary: string;
  pros: string[];
  cons: string[];
  goalFit: number;
  components: SolutionComponent[];
  bundle?: { bundleTitle: string; bundlePrice: number; separatePrice: number; savings: number };
  cost: CostBreakdown;
  affordability: Affordability;
  score?: ScoreBreakdown;
  rank?: number;
}

export interface UserProfile {
  goal?: string;
  experience?: string;
  monthlyIncome?: number;
  monthlyBudget?: number;
  maxUpfront?: number;
  preferences: string[];
}

export type PlanStatus =
  | 'DRAFT'
  | 'FINAL_REVIEW'
  | 'LOCKED'
  | 'AUTHORIZED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_SUCCESS'
  | 'AUTHORIZATION_FAILED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_DECLINED'
  | 'CANCELLED'
  | 'SYSTEM_ERROR';

export interface PurchasePlan {
  id: string;
  optionId: string;
  title: string;
  reasoning: string[];
  items: { sku: string; name: string; retailer?: string; quantity: number; unitPrice: number; lineTotal: number }[];
  recurring: { name: string; monthly: number }[];
  pricing: { subtotal: number; discount: number; shipping: number; tax: number; total: number; currency: string };
  ownership: { firstYearCost: number; monthlyRecurring: number };
  affordability: Affordability;
  status: PlanStatus;
  lock?: { hash: string; lockedAt: string };
  authorization?: { authorizedAt: string; expiresAt: string };
  paypal?: { orderId: string; status: string; captureId?: string; payerEmail?: string };
  history: { status: PlanStatus; at: string; note?: string }[];
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionView {
  id: string;
  profile: UserProfile;
  options: SolutionOption[];
  recommendedOptionId?: string;
  transcript: { role: 'user' | 'assistant'; text: string }[];
  plans: PurchasePlan[];
}

export interface AppConfig {
  currency: string;
  catalogSource: 'channel3' | 'demo-catalog';
  paypal: { clientId: string | null; sandbox: boolean };
  integrations: { ai: boolean; channel3: boolean; paypal: boolean };
  aiProvider: 'claude' | 'gemini';
  model: string;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; error?: string }
  | { type: 'state'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ApiErrorBody {
  error: { code: string; message: string; attemptsLeft?: number; changes?: string[] };
}
