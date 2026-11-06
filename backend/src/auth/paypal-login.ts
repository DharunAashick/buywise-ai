import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

// "Log in with PayPal" (OAuth 2.0 authorization-code flow, PayPal Identity API).
// Sandbox: www.sandbox.paypal.com / api-m.sandbox.paypal.com.

const WEB = config.paypal.sandbox ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
const API = config.paypal.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
const SCOPES = "openid profile email address";

/**
 * Public origin of the app. PUBLIC_URL wins; in production without it, use the request's own
 * host (Render terminates TLS and "trust proxy" makes req.protocol https); in development the
 * Angular proxy rewrites Host, so fall back to the configured dev URL.
 */
export function publicOrigin(req: Request): string {
  if (process.env.PUBLIC_URL) return config.publicUrl;
  if (process.env.NODE_ENV === "production" && req.get("host")) return `${req.protocol}://${req.get("host")}`;
  return config.publicUrl;
}

export const redirectUri = (req: Request) => `${publicOrigin(req)}/api/auth/paypal/callback`;

/** One-time `state` values guarding the callback against CSRF (10 minute lifetime). */
const pendingStates = new Map<string, number>();

export function authorizeUrl(req: Request): { url: string; state: string } {
  const state = randomBytes(24).toString("base64url");
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    flowEntry: "static",
    client_id: config.paypal.clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri(req),
    state,
  });
  return { url: `${WEB}/signin/authorize?${params}`, state };
}

export function consumeState(state: string | undefined): boolean {
  if (!state) return false;
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

export interface PayPalIdentity {
  id: string;
  name: string;
  email?: string;
  countryCode?: string;
}

function basicAuth() {
  return "Basic " + Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64");
}

/** Exchanges the authorization code for a user access token, reads the profile, and discards the token. */
export async function identityFromCode(code: string): Promise<PayPalIdentity> {
  const tokenRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`PayPal token exchange failed: ${token.error_description ?? tokenRes.status}`);
  }

  const infoRes = await fetch(`${API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const info = (await infoRes.json()) as {
    user_id?: string;
    payer_id?: string;
    name?: string;
    given_name?: string;
    emails?: { value: string; primary?: boolean }[];
    email?: string;
    address?: { country?: string };
  };
  if (!infoRes.ok || !(info.user_id || info.payer_id)) {
    throw new Error(`PayPal userinfo failed (${infoRes.status})`);
  }
  const email = info.emails?.find((e) => e.primary)?.value ?? info.emails?.[0]?.value ?? info.email;
  log("paypal_login_identity", { hasEmail: Boolean(email), country: info.address?.country });
  return {
    id: (info.user_id ?? info.payer_id)!,
    name: info.name ?? info.given_name ?? email ?? "PayPal user",
    email,
    countryCode: info.address?.country,
  };
}
