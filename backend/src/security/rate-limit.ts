import type { NextFunction, Request, Response } from "express";
import { log } from "../lib/logger.js";

// In-memory limits that protect the AI bill on a public demo: a sliding window per client IP,
// plus a global daily cap on AI turns. Good enough for a single-instance hackathon deployment.

interface Window {
  hits: number[];
}

export function rateLimit(opts: { name: string; max: number; windowMs: number }) {
  const buckets = new Map<string, Window>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const w = buckets.get(key) ?? { hits: [] };
    w.hits = w.hits.filter((t) => now - t < opts.windowMs);
    if (w.hits.length >= opts.max) {
      const retryAfter = Math.ceil((opts.windowMs - (now - w.hits[0])) / 1000);
      res.setHeader("retry-after", String(retryAfter));
      log("rate_limited", { limiter: opts.name, retryAfter }, "warn");
      return res.status(429).json({
        error: { code: "RATE_LIMITED", message: `Too many requests - please wait ${retryAfter}s and try again.` },
      });
    }
    w.hits.push(now);
    buckets.set(key, w);
    if (buckets.size > 10_000) buckets.clear(); // crude memory bound
    next();
  };
}

/** Global cap on AI turns per UTC day (DAILY_AI_TURN_LIMIT, default 400). */
const dailyLimit = Number(process.env.DAILY_AI_TURN_LIMIT ?? 400);
let day = new Date().toISOString().slice(0, 10);
let turnsToday = 0;

export function dailyAiCap(_req: Request, res: Response, next: NextFunction) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    turnsToday = 0;
  }
  if (turnsToday >= dailyLimit) {
    log("daily_ai_cap_reached", { limit: dailyLimit }, "warn");
    return res.status(429).json({
      error: { code: "DAILY_LIMIT", message: "The demo has reached today's AI usage limit. Please try again tomorrow." },
    });
  }
  turnsToday++;
  next();
}
