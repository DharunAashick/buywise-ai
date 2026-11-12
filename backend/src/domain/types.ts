import type { Cents } from "../lib/money.js";

// ---------- Catalog ----------

export interface Offer {
  retailer: string; // domain, e.g. "bestbuy.com"
  url: string;
  price: Cents;
  compareAtPrice?: Cents;
  currency: string;
  availability: "InStock" | "OutOfStock";
}

export interface Product {
  id: string;
  title: string;
  brand?: string;
  category?: string;
  description?: string;
  image?: string;
  keyFeatures: string[];
  offers: Offer[];
  /** Best in-stock offer (lowest price). */
  bestOffer?: Offer;
  /** For subscriptions/services: recurring price per month, in cents. */
  recurringMonthly?: Cents;
  /** Where the data came from. Demo data is always labelled so it is never passed off as live. */
  source: "channel3" | "demo-catalog";
}

// ---------- Solutions ----------

export type ComponentRole = "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
export type ComponentKind = "HARDWARE" | "ACCESSORY" | "SOFTWARE" | "SUBSCRIPTION";

export interface SolutionComponent {
  id: string;
  productId: string;
  title: string;
  role: ComponentRole;
  kind: ComponentKind;
  quantity: number;
  reason: string;
  unitPrice: Cents;
  retailer?: string;
  url?: string;
  image?: string;
  /** Recurring components (subscriptions) are charged monthly, not at checkout. */
  recurringMonthly?: Cents;
  included: boolean;
}

export interface BundleCheck {
  bundleProductId: string;
  bundleTitle: string;
  bundlePrice: Cents;
  separatePrice: Cents;
  savings: Cents;
  replacesComponentIds: string[];
}

export interface CostBreakdown {
  hardware: Cents;
  accessories: Cents;
  software: Cents;
  upfrontSubtotal: Cents;
  discount: Cents;
  shipping: Cents;
  tax: Cents;
  upfrontTotal: Cents;
  monthlyRecurring: Cents;
  annualRecurring: Cents;
  firstYearTotal: Cents;
}

export interface Affordability {
  monthlyIncome?: Cents;
  monthlyBudget?: Cents;
  upfrontToIncomeRatio?: number;
  recurringShareOfIncome?: number;
  impact: "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
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
  name: string; // "Xbox Series S starter setup"
  approach: string; // "Console", "PC", "Handheld"
  summary: string;
  pros: string[];
  cons: string[];
  goalFit: number; // 0..10 as judged by the agent, explained in pros/cons
  /** Built around the specific product the user named (e.g. "I want a PS5"). */
  matchesRequest?: boolean;
  components: SolutionComponent[];
  bundle?: BundleCheck;
  cost: CostBreakdown;
  affordability: Affordability;
  score?: ScoreBreakdown;
  rank?: number;
  createdAt: string;
}

export interface UserProfile {
  goal?: string;
  experience?: string;
  /** Country the user said they live in, as given (e.g. "India"). */
  country?: string;
  /** Channel3 market used for product search (falls back to US when the country isn't supported). */
  catalogCountry?: string;
  /** Income exactly as the user stated it, before conversion to USD. */
  statedIncome?: { amount: number; currency: string; usdRate: number; rateSource: string };
  /** Home currency of `country` (e.g. INR for India): amounts display in it even before a salary is given. */
  localCurrency?: { currency: string; usdRate: number; rateSource: string };
  /** True once the user has been asked about country/income (so we don't ask twice). */
  intakeAsked?: boolean;
  monthlyIncome?: Cents;
  monthlyBudget?: Cents;
  maxUpfront?: Cents;
  preferences: string[];
}

// ---------- Purchase plan & transaction ----------

export type PlanStatus =
  | "DRAFT"
  | "FINAL_REVIEW"
  | "LOCKED"
  | "AUTHORIZED"
  | "PAYMENT_PENDING"
  | "PAYMENT_SUCCESS"
  | "AUTHORIZATION_FAILED"
  | "PAYMENT_FAILED"
  | "PAYMENT_DECLINED"
  | "CANCELLED"
  | "SYSTEM_ERROR";

export interface PlanLineItem {
  sku: string;
  name: string;
  retailer?: string;
  quantity: number;
  unitPrice: Cents;
  lineTotal: Cents;
}

export interface PlanRecurringItem {
  name: string;
  monthly: Cents;
}

export interface PurchasePlan {
  id: string;
  sessionId: string;
  optionId: string;
  goal: string;
  title: string;
  reasoning: string[];
  items: PlanLineItem[];
  recurring: PlanRecurringItem[];
  pricing: {
    subtotal: Cents;
    discount: Cents;
    shipping: Cents;
    tax: Cents;
    total: Cents;
    currency: string;
  };
  ownership: { firstYearCost: Cents; monthlyRecurring: Cents };
  affordability: Affordability;
  status: PlanStatus;
  lock?: { hash: string; lockedAt: string; canonical: string };
  authorization?: { authorizedAt: string; expiresAt: string; lockHash: string };
  paypal?: { orderId: string; status: string; captureId?: string; payerEmail?: string };
  history: { status: PlanStatus; at: string; note?: string }[];
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}
