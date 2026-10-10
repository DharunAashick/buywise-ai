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

export function sum(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
