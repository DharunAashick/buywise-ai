import { Router } from "express";
import { config, integrations } from "../config.js";
import { log } from "../lib/logger.js";
import { getExecutionToolkit } from "../paypal/toolkit.js";
import { transactions } from "../transactions/service.js";

export const webhooks = Router();

/** Verifies a PayPal webhook with PayPal's verify-webhook-signature API. */
async function verify(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !integrations.paypal()) return false;
  const client = getExecutionToolkit().client;
  const res = await fetch(`${client.getBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: await client.getHeaders(),
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

webhooks.post("/paypal", async (req, res) => {
  const event = req.body as { id?: string; event_type?: string; resource?: any };
  try {
    if (!(await verify(req.headers, event))) {
      log("webhook_rejected", { id: event?.id, type: event?.event_type, sandbox: config.paypal.sandbox }, "warn");
      return res.status(400).json({ ok: false });
    }
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (orderId && event.event_type) transactions.settleFromWebhook(orderId, event.event_type, event.resource?.id);
    log("webhook_received", { id: event.id, type: event.event_type });
    res.json({ ok: true });
  } catch (err) {
    log("webhook_failed", { error: String(err) }, "error");
    res.status(500).json({ ok: false });
  }
});
