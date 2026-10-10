import { config, integrations } from "../config.js";
import { log } from "../lib/logger.js";
import type { Product } from "../domain/types.js";
import { channel3Product, channel3Search, type SearchFilters } from "./channel3.js";
import { DEMO_PRODUCTS, demoSearch } from "./demo-catalog.js";

// Every product the agent has seen is cached by id, so later tool calls (building an option,
// locking a plan) price items from the catalog result rather than from anything the LLM typed.
const seen = new Map<string, Product>();

export function catalogSource(): "channel3" | "demo-catalog" {
  return integrations.channel3() ? "channel3" : "demo-catalog";
}

export async function searchProducts(query: string, filters: SearchFilters = {}): Promise<Product[]> {
  let results: Product[];
  if (integrations.channel3()) {
    results = await channel3Search(query, filters);
  } else if (config.allowDemoCatalog) {
    results = demoSearch(query, filters);
  } else {
    throw new Error("No product source configured: set CHANNEL3_API_KEY or ALLOW_DEMO_CATALOG=true");
  }
  for (const p of results) seen.set(p.id, p);
  return results;
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const cached = seen.get(id);
  if (cached) return cached;
  if (integrations.channel3() && !id.startsWith("demo-")) {
    try {
      const p = await channel3Product(id);
      seen.set(p.id, p);
      return p;
    } catch (err) {
      log("channel3_product_failed", { id, error: String(err) }, "warn");
      return undefined;
    }
  }
  const demo = DEMO_PRODUCTS.find((p) => p.id === id);
  if (demo) seen.set(demo.id, demo);
  return demo;
}
