import { Router } from "express";
import { z } from "zod/v4";
import { config, integrations } from "../config.js";
import { log } from "../lib/logger.js";
import { authorizeUrl, consumeState, identityFromCode, redirectUri } from "../auth/paypal-login.js";
import { userStore, userView } from "../auth/users.js";
import { clearCookie, currentUser, readCookie, SESSION_COOKIE, setCookie } from "../auth/cookies.js";
import { rateLimit } from "../security/rate-limit.js";

export const auth = Router();
auth.use(rateLimit({ name: "auth", max: 30, windowMs: 10 * 60 * 1000 }));

const STATE_COOKIE = "bw_oauth_state";

// Step 1: send the browser to PayPal's consent screen.
auth.get("/paypal/start", (_req, res) => {
  if (!integrations.paypal()) return res.status(503).send("PayPal is not configured");
  const { url, state } = authorizeUrl();
  setCookie(res, STATE_COOKIE, state, 600);
  log("paypal_login_started", { redirectUri: redirectUri() });
  res.redirect(url);
});

// Step 2: PayPal redirects back with ?code&state.
auth.get("/paypal/callback", async (req, res) => {
  const back = (status: string) => res.redirect(`${config.publicUrl}/?login=${status}`);
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  clearCookie(res, STATE_COOKIE);

  if (req.query.error) {
    log("paypal_login_denied", { error: String(req.query.error) }, "warn");
    return back("cancelled");
  }
  if (!code || !state || state !== readCookie(req, STATE_COOKIE) || !consumeState(state)) {
    log("paypal_login_bad_state", {}, "warn");
    return back("failed");
  }
  try {
    const identity = await identityFromCode(code);
    const user = userStore.upsertFromPayPal(identity);
    setCookie(res, SESSION_COOKIE, userStore.createSession(user.id), 7 * 24 * 60 * 60);
    log("paypal_login_success", { userId: user.id });
    back("ok");
  } catch (err) {
    log("paypal_login_failed", { error: String(err) }, "error");
    back("failed");
  }
});

auth.get("/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? userView(user) : null, paypalLoginAvailable: integrations.paypal() });
});

auth.post("/logout", (req, res) => {
  userStore.endSession(readCookie(req, SESSION_COOKIE));
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});

// The user's own BuyWise PIN. Changing an existing PIN requires the current one.
const PinBody = z.object({ pin: z.string().regex(/^\d{4}$/), currentPin: z.string().optional() });
auth.post("/pin", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: { code: "NOT_SIGNED_IN", message: "Sign in with PayPal first" } });
  const body = PinBody.parse(req.body);
  if (user.pin && !(body.currentPin && userStore.checkPin(user, body.currentPin))) {
    return res.status(403).json({ error: { code: "INVALID_PIN", message: "Current PIN is incorrect" } });
  }
  userStore.setPin(user.id, body.pin);
  log("user_pin_set", { userId: user.id });
  res.json({ user: userView(userStore.get(user.id)!) });
});
