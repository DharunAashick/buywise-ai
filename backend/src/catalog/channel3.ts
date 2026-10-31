import { config } from "../config.js";
import { toCents } from "../lib/money.js";
import { log } from "../lib/logger.js";
import type { Offer, Product } from "../domain/types.js";

// Minimal typings for the Channel3 v1 product schema (docs.trychannel3.com/api-reference/v1/search).
interface C3Price { price: number; compare_at_price?: number | null; currency: string }
interface C3Offer { url: string; domain: string; price: C3Price; availability: "InStock" | "OutOfStock" }
interface C3Product {
  id: string;
  title: string;
  description?: string | null;
  brands?: { id: string; name: string }[];
  images?: { url: string; cleaned_url?: string | null; is_main_image?: boolean }[];
  category?: { slug: string; title: string } | null;
  key_features?: string[] | null;
  offers?: C3Offer[];
}

export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  /** Channel3 market (ISO country code). Defaults to CHANNEL3_COUNTRY. */
  country?: string;
}

export class Channel3Error extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.channel3.baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": config.channel3.apiKey, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Channel3Error(`Channel3 ${path} failed: ${res.status} ${body.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

export function mapChannel3Product(p: C3Product): Product {
  const offers: Offer[] = (p.offers ?? [])
    .filter((o) => o.price && Number.isFinite(o.price.price))
    .map((o) => ({
      retailer: o.domain,
      url: o.url,
      price: toCents(o.price.price),
      compareAtPrice: o.price.compare_at_price ? toCents(o.price.compare_at_price) : undefined,
      currency: o.price.currency,
      availability: o.availability,
    }));
  const inStock = offers.filter((o) => o.availability === "InStock" && o.currency === config.currency);
  const bestOffer = [...(inStock.length ? inStock : offers)].sort((a, b) => a.price - b.price)[0];
  const image = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name,
    category: p.category?.title,
    description: p.description ?? undefined,
    image: image?.cleaned_url ?? image?.url,
    keyFeatures: (p.key_features ?? []).slice(0, 5),
    offers,
    bestOffer,
    source: "channel3",
  };
}

export async function channel3Search(query: string, filters: SearchFilters = {}): Promise<Product[]> {
  const body = {
    query,
    limit: Math.min(filters.limit ?? 8, 30),
    filters: {
      availability: ["InStock"],
      conditions: ["new"],
      ...(filters.minPrice || filters.maxPrice
        ? { price: { min_price: filters.minPrice ?? null, max_price: filters.maxPrice ?? null } }
        : {}),
    },
    // Prices stay in USD (PayPal settlement currency) regardless of market.
    config: { country: filters.country ?? config.channel3.country, currency: config.currency },
  };
  const started = Date.now();
  const data = await request<{ products: C3Product[] }>("/v1/search", { method: "POST", body: JSON.stringify(body) });
  log("channel3_search", { query, results: data.products.length, ms: Date.now() - started });
  return data.products.map(mapChannel3Product);
}

export async function channel3Product(id: string): Promise<Product> {
  const qs = new URLSearchParams({ country: config.channel3.country, currency: config.currency });
  const data = await request<C3Product>(`/v1/products/${encodeURIComponent(id)}?${qs}`);
  return mapChannel3Product(data);
}
