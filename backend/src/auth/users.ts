import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

// Users who signed in with PayPal, and their app sessions. We keep only identity details PayPal
// shares (name, email, country) and a salted scrypt hash of the user's own BuyWise PIN - never the
// PayPal access token or password.

export interface User {
  id: string; // PayPal user_id (stable per app)
  name: string;
  email?: string;
  countryCode?: string; // ISO 3166-1 alpha-2 from PayPal profile
  country?: string; // display name
  pin?: { salt: string; hash: string };
  createdAt: string;
  lastLoginAt: string;
}

interface Snapshot {
  users: User[];
  authSessions: Record<string, { userId: string; expiresAt: number }>;
}

const users = new Map<string, User>();
const authSessions = new Map<string, { userId: string; expiresAt: number }>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const file = path.resolve(path.dirname(config.dataFile), "users.json");

try {
  if (fs.existsSync(file)) {
    const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
    snap.users?.forEach((u) => users.set(u.id, u));
    Object.entries(snap.authSessions ?? {}).forEach(([k, v]) => v.expiresAt > Date.now() && authSessions.set(k, v));
  }
} catch (err) {
  log("users_load_failed", { error: String(err) }, "warn");
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const snap: Snapshot = { users: [...users.values()], authSessions: Object.fromEntries(authSessions) };
    fs.writeFileSync(file, JSON.stringify(snap));
  } catch (err) {
    log("users_persist_failed", { error: String(err) }, "error");
  }
}

function countryName(code?: string): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const userStore = {
  upsertFromPayPal(p: { id: string; name: string; email?: string; countryCode?: string }): User {
    const now = new Date().toISOString();
    const existing = users.get(p.id);
    const user: User = {
      ...existing,
      id: p.id,
      name: p.name,
      email: p.email,
      countryCode: p.countryCode,
      country: countryName(p.countryCode),
      createdAt: existing?.createdAt ?? now,
      lastLoginAt: now,
    };
    users.set(user.id, user);
    persist();
    return user;
  },

  get(id: string) {
    return users.get(id);
  },

  createSession(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    authSessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    persist();
    return token;
  },

  userForToken(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const s = authSessions.get(token);
    if (!s || s.expiresAt < Date.now()) return undefined;
    return users.get(s.userId);
  },

  endSession(token: string | undefined) {
    if (token && authSessions.delete(token)) persist();
  },

  setPin(userId: string, pin: string) {
    const user = users.get(userId);
    if (!user) throw new Error("User not found");
    const salt = randomBytes(16);
    user.pin = { salt: salt.toString("base64"), hash: scryptSync(pin, salt, 32).toString("base64") };
    persist();
  },

  checkPin(user: User, pin: string): boolean {
    if (!user.pin) return false;
    const actual = scryptSync(pin, Buffer.from(user.pin.salt, "base64"), 32);
    return timingSafeEqual(actual, Buffer.from(user.pin.hash, "base64"));
  },
};

/** Public view of a user - never includes the PIN hash. */
export function userView(u: User) {
  return { id: u.id, name: u.name, email: u.email, country: u.country, countryCode: u.countryCode, hasPin: Boolean(u.pin) };
}
