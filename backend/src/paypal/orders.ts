import { fromCents, toCents } from "../lib/money.js";
import type { PurchasePlan } from "../domain/types.js";
import { getExecutionToolkit, runToolkit } from "./toolkit.js";

export class PayPalError extends Error {
  constructor(message: string, readonly code: string, readonly details?: unknown) {
    super(message);
  }
}

function errorCode(result: any): string {
  return result?.error?.details?.[0]?.issue ?? result?.error?.name ?? result?.error?.type ?? "PAYPAL_ERROR";
}

/**
 * Creates a PayPal order for a locked, authorised plan. Amounts come only from the plan
 * (computed by the cost engine); nothing from the browser or the LLM is used.
 */
export async function createOrderForPlan(plan: PurchasePlan): Promise<{ orderId: string; status: string }> {
  const toolkit = getExecutionToolkit();
  const result = await runToolkit(toolkit, "create_order", {
    currencyCode: plan.pricing.currency,
    items: plan.items.map((i) => ({
      name: i.name.slice(0, 127),
      description: i.retailer ? `Fulfilled by ${i.retailer}`.slice(0, 127) : undefined,
      quantity: i.quantity,
      itemCost: fromCents(i.unitPrice),
      itemTotal: fromCents(i.lineTotal),
      taxPercent: 0,
    })),
    discount: fromCents(plan.pricing.discount),
    shippingCost: fromCents(plan.pricing.shipping),
  });

  if (!result?.id) throw new PayPalError("PayPal order creation failed", errorCode(result), result?.error);

  // Defence in depth: the amount PayPal will charge must equal the locked total, to the cent.
  // The create response is minimal (no amounts), so read the order back before trusting it.
  const order = await runToolkit(toolkit, "get_order", { id: result.id });
  const unit = order?.purchase_units?.[0]?.amount;
  if (!unit?.value) throw new PayPalError("Could not verify the PayPal order amount", "AMOUNT_UNVERIFIED", order?.error);
  const charged = toCents(Number(unit.value));
  if (charged !== plan.pricing.total || unit.currency_code !== plan.pricing.currency) {
    throw new PayPalError(`PayPal order total ${unit.value} ${unit.currency_code} does not match locked total`, "AMOUNT_MISMATCH");
  }
  return { orderId: result.id, status: result.status };
}

export interface CaptureResult {
  status: "COMPLETED" | "DECLINED" | "PENDING" | "FAILED";
  captureId?: string;
  payerEmail?: string;
  amount?: number;
  code?: string;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const toolkit = getExecutionToolkit();
  const result = await runToolkit(toolkit, "pay_order", { id: orderId });
  if (result?.error || result?.status === "error") {
    const code = errorCode(result) || errorCode({ error: result?.response });
    if (code === "INSTRUMENT_DECLINED" || code === "PAYER_ACTION_REQUIRED") return { status: "DECLINED", code };
    if (code === "ORDER_ALREADY_CAPTURED") return getCaptureFromOrder(orderId);
    return { status: "FAILED", code };
  }
  const data = result?.response ?? result;
  return parseCapture(data);
}

async function getCaptureFromOrder(orderId: string): Promise<CaptureResult> {
  const order = await runToolkit(getExecutionToolkit(), "get_order", { id: orderId });
  return { ...parseCapture(order), code: "ORDER_ALREADY_CAPTURED" };
}

function parseCapture(data: any): CaptureResult {
  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  const captureStatus: string | undefined = capture?.status;
  const status: CaptureResult["status"] =
    captureStatus === "COMPLETED" ? "COMPLETED" : captureStatus === "DECLINED" ? "DECLINED" : captureStatus === "PENDING" ? "PENDING" : data?.status === "COMPLETED" ? "COMPLETED" : "FAILED";
  return {
    status,
    captureId: capture?.id,
    payerEmail: data?.payer?.email_address,
    amount: capture?.amount?.value ? toCents(Number(capture.amount.value)) : undefined,
  };
}

export async function getOrder(orderId: string) {
  return runToolkit(getExecutionToolkit(), "get_order", { id: orderId });
}
