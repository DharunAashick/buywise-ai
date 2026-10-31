import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Content } from "@google/genai";
import { config } from "../config.js";
import { log } from "../lib/logger.js";
import type { PurchasePlan, SolutionOption, UserProfile } from "../domain/types.js";

export interface Session {
  id: string;
  /** PayPal-login user who owns this conversation; undefined for guests. */
  userId?: string;
  /** Claude conversation history (append-only, includes thinking/tool blocks). */
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Gemini conversation history (append-only, includes thought signatures and function calls). */
  gemini?: Content[];
  profile: UserProfile;
  options: SolutionOption[];
  recommendedOptionId?: string;
  /** Set once rank_options has asked the agent to make options like-for-like. */
  rankGapWarned?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Snapshot {
  sessions: Session[];
  plans: PurchasePlan[];
  /** Idempotency keys -> plan id, so a retried capture never charges twice. */
  captures: Record<string, string>;
}

const sessions = new Map<string, Session>();
const plans = new Map<string, PurchasePlan>();
const captures = new Map<string, string>();

const file = path.resolve(config.dataFile);

function load() {
  try {
    if (!fs.existsSync(file)) return;
    const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
    snap.sessions?.forEach((s) => sessions.set(s.id, s));
    snap.plans?.forEach((p) => plans.set(p.id, p));
    Object.entries(snap.captures ?? {}).forEach(([k, v]) => captures.set(k, v));
    log("store_loaded", { sessions: sessions.size, plans: plans.size });
  } catch (err) {
    log("store_load_failed", { error: String(err) }, "warn");
  }
}

let timer: NodeJS.Timeout | undefined;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const snap: Snapshot = { sessions: [...sessions.values()], plans: [...plans.values()], captures: Object.fromEntries(captures) };
      fs.writeFileSync(file, JSON.stringify(snap));
    } catch (err) {
      log("store_persist_failed", { error: String(err) }, "error");
    }
  }, 250);
}

load();

export const store = {
  createSession(userId?: string): Session {
    const now = new Date().toISOString();
    const s: Session = { id: randomUUID(), userId, messages: [], profile: { preferences: [] }, options: [], createdAt: now, updatedAt: now };
    sessions.set(s.id, s);
    persist();
    return s;
  },
  getSession(id: string) {
    return sessions.get(id);
  },
  saveSession(s: Session) {
    s.updatedAt = new Date().toISOString();
    sessions.set(s.id, s);
    persist();
  },
  getPlan(id: string) {
    return plans.get(id);
  },
  savePlan(p: PurchasePlan) {
    p.updatedAt = new Date().toISOString();
    plans.set(p.id, p);
    persist();
  },
  allPlans() {
    return [...plans.values()];
  },
  plansForSession(sessionId: string) {
    return [...plans.values()].filter((p) => p.sessionId === sessionId);
  },
  getCapture(key: string) {
    return captures.get(key);
  },
  setCapture(key: string, planId: string) {
    captures.set(key, planId);
    persist();
  },
};
