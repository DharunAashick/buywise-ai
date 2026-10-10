import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { config, integrations } from "../config.js";
import { log } from "../lib/logger.js";

// Two PayPal Agent Toolkit instances with different action allow-lists:
//
//  * agentToolkit     - handed to Claude. Read-only: look up orders, transactions and shipment tracking.
//  * executionToolkit - used only by the backend transaction service, after a locked plan has been
//                       authorised with the user's PIN. It can create and capture orders.
//
// Claude never receives a tool that can move money; the capability simply is not in its toolkit.

const AGENT_ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
  shipment: { get: true },
};

const EXECUTION_ACTIONS = {
  orders: { create: true, get: true, capture: true },
};

let agentToolkit: PayPalAgentToolkit | undefined;
let executionToolkit: PayPalAgentToolkit | undefined;

function build(actions: Record<string, Record<string, boolean>>) {
  return new PayPalAgentToolkit({
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
    configuration: { actions, context: { sandbox: config.paypal.sandbox } },
  });
}

export function getAgentToolkit(): PayPalAgentToolkit | undefined {
  if (!integrations.paypal()) return undefined;
  agentToolkit ??= build(AGENT_ACTIONS);
  return agentToolkit;
}

export function getExecutionToolkit(): PayPalAgentToolkit {
  if (!integrations.paypal()) throw new Error("PayPal sandbox credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)");
  executionToolkit ??= build(EXECUTION_ACTIONS);
  return executionToolkit;
}

let callSeq = 0;

/** Runs one toolkit action and parses its JSON string result. */
export async function runToolkit(toolkit: PayPalAgentToolkit, name: string, args: unknown): Promise<any> {
  const started = Date.now();
  const res = await toolkit.handleToolCall({
    id: `call_${Date.now()}_${++callSeq}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  log("paypal_toolkit_call", { action: name, ms: Date.now() - started, ok: !parsed?.error });
  return parsed;
}
