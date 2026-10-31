import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

// The PIN is a demo authorization boundary that lives entirely outside the AI pipeline:
// it arrives on its own endpoint, is compared against a salted scrypt hash, and is never
// logged, persisted, echoed back, or placed in any LLM request.

const salt = randomBytes(16);
const pinHash = scryptSync(config.security.demoPin, salt, 32);

const attempts = new Map<string, number>();

export type PinResult = { ok: true } | { ok: false; reason: "INVALID_PIN" | "LOCKED_OUT"; attemptsLeft: number };

/**
 * Checks a PIN for a plan with per-plan attempt limits. `userCheck` verifies a signed-in user's own
 * PIN; guests fall back to the demo PIN.
 */
export function verifyPin(planId: string, pin: unknown, userCheck?: (pin: string) => boolean): PinResult {
  const used = attempts.get(planId) ?? 0;
  const max = config.security.maxPinAttempts;
  if (used >= max) return { ok: false, reason: "LOCKED_OUT", attemptsLeft: 0 };

  const valid =
    typeof pin === "string" &&
    /^\d{4,8}$/.test(pin) &&
    (userCheck ? userCheck(pin) : timingSafeEqual(scryptSync(pin, salt, 32), pinHash));

  if (valid) {
    attempts.delete(planId);
    return { ok: true };
  }
  attempts.set(planId, used + 1);
  const attemptsLeft = Math.max(0, max - used - 1);
  return { ok: false, reason: attemptsLeft === 0 ? "LOCKED_OUT" : "INVALID_PIN", attemptsLeft };
}
