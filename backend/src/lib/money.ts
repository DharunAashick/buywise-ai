// All money is integer minor units (cents). The LLM never does arithmetic on these values;
// every total shown to the user or sent to PayPal is computed here.

export type Cents = number;

export function toCents(amount: number): Cents {
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount: ${amount}`);
  return Math.round(amount * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** PayPal wants decimal strings with exactly two places. */
export function toDecimalString(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(cents: Cents, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(fromCents(cents));
}

/** A user's own currency and how many USD one unit of it is worth (from their stated salary). */
export interface LocalFx {
  currency: string;
  usdRate: number;
}

const LOCALE_FOR: Record<string, string> = { INR: "en-IN", EUR: "de-DE", GBP: "en-GB", JPY: "ja-JP" };

/** USD cents shown in the user's currency, rounded to whole units (it's an approximation). */
export function formatLocal(usdCents: Cents, fx: LocalFx): string {
  const amount = usdCents / 100 / fx.usdRate;
  return new Intl.NumberFormat(LOCALE_FOR[fx.currency] ?? "en-US", {
    style: "currency",
    currency: fx.currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Local currency when the user gave one (USD stays exact), for text shown to the user. */
export function formatForUser(usdCents: Cents, fx?: LocalFx): string {
  return fx && fx.currency !== "USD" ? formatLocal(usdCents, fx) : formatMoney(usdCents);
}

export function sum(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
