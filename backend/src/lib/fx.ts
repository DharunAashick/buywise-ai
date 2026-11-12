import { log } from "./logger.js";

// Converts a user's stated income/budget into USD (the settlement currency) so the affordability
// engine compares like with like. Live ECB reference rates via frankfurter.app (no key needed),
// cached for 12h, with a static fallback so the agent never stalls on a network error.

const FALLBACK_USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  INR: 0.0118,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  JPY: 0.0067,
  SGD: 0.74,
  AED: 0.272,
  CNY: 0.138,
  BRL: 0.18,
  MXN: 0.055,
  ZAR: 0.055,
  CHF: 1.13,
  SEK: 0.095,
  NZD: 0.6,
};

// Home currency per country, so amounts show in the user's money as soon as they say where they live.
const COUNTRY_CURRENCY: Record<string, string> = {
  india: "INR", "united states": "USD", usa: "USD", us: "USD", america: "USD",
  "united kingdom": "GBP", uk: "GBP", gb: "GBP", england: "GBP", britain: "GBP", scotland: "GBP", wales: "GBP",
  canada: "CAD", australia: "AUD", "new zealand": "NZD", japan: "JPY", singapore: "SGD",
  uae: "AED", "united arab emirates": "AED", dubai: "AED", china: "CNY", brazil: "BRL", mexico: "MXN",
  "south africa": "ZAR", switzerland: "CHF", sweden: "SEK",
  germany: "EUR", france: "EUR", italy: "EUR", spain: "EUR", netherlands: "EUR", belgium: "EUR", austria: "EUR",
  ireland: "EUR", portugal: "EUR", finland: "EUR", greece: "EUR",
};

export function currencyForCountry(country: string): string | undefined {
  return COUNTRY_CURRENCY[country.trim().toLowerCase()];
}

const cache = new Map<string, { rate: number; at: number }>();
const TTL_MS = 12 * 60 * 60 * 1000;

export interface UsdConversion {
  usd: number;
  rate: number; // USD per 1 unit of the source currency
  source: "live" | "fallback" | "identity";
}

export async function usdRate(currency: string): Promise<{ rate: number; source: UsdConversion["source"] }> {
  const cur = currency.toUpperCase();
  if (cur === "USD") return { rate: 1, source: "identity" };
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < TTL_MS) return { rate: hit.rate, source: "live" };
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(cur)}&to=USD`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: { USD?: number } };
      if (data.rates?.USD) {
        cache.set(cur, { rate: data.rates.USD, at: Date.now() });
        return { rate: data.rates.USD, source: "live" };
      }
    }
  } catch (err) {
    log("fx_lookup_failed", { currency: cur, error: String(err) }, "warn");
  }
  const fallback = FALLBACK_USD_PER_UNIT[cur];
  if (fallback) return { rate: fallback, source: "fallback" };
  throw new Error(`Unsupported currency "${cur}". Use an ISO 4217 code such as INR, EUR, GBP or USD.`);
}

export async function toUsd(amount: number, currency: string): Promise<UsdConversion> {
  const { rate, source } = await usdRate(currency);
  return { usd: Math.round(amount * rate * 100) / 100, rate, source };
}
