import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_FILE = `data/test-${process.pid}.json`;
process.env.DEMO_PIN = "2468";
process.env.CHANNEL3_API_KEY = "";
// PayPal calls are mocked below; dummy credentials just satisfy the "configured" check.
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";

const createOrderForPlan = vi.fn();
const captureOrder = vi.fn();
vi.mock("../src/paypal/orders.js", () => ({
  createOrderForPlan: (...a: unknown[]) => createOrderForPlan(...a),
  captureOrder: (...a: unknown[]) => captureOrder(...a),
  PayPalError: class extends Error {
    constructor(m: string, public code: string) {
      super(m);
    }
  },
}));

const { store } = await import("../src/store/store.js");
const { transactions, PlanError } = await import("../src/transactions/service.js");
const { executeTool } = await import("../src/agent/tools.js");
const { canonicalJson, computeLock, verifyLock } = await import("../src/transactions/lock.js");
const { canTransition } = await import("../src/transactions/state-machine.js");

async function sessionWithOption() {
  const session = store.createSession();
  await executeTool(session, "update_user_profile", { goal: "get into gaming", monthly_income: 2000 });
  await executeTool(session, "search_products", { query: "xbox series s console" });
  await executeTool(session, "search_products", { query: "xbox controller" });
  await executeTool(session, "search_products", { query: "game pass subscription" });
  await executeTool(session, "build_solution_option", {
    name: "Xbox Series S starter",
    approach: "Console",
    summary: "Cheapest current-gen console",
    goal_fit: 8,
    pros: ["Low upfront cost"],
    cons: ["Digital only"],
    components: [
      { product_id: "demo-xbox-series-s", role: "REQUIRED", kind: "HARDWARE", reason: "The console" },
      { product_id: "demo-xbox-controller", role: "RECOMMENDED", kind: "ACCESSORY", reason: "Second player" },
      { product_id: "demo-sub-game-pass-ultimate", role: "RECOMMENDED", kind: "SUBSCRIPTION", reason: "Games library" },
    ],
  });
  return session;
}

beforeEach(() => {
  createOrderForPlan.mockReset();
  captureOrder.mockReset();
});

describe("lock", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("state machine", () => {
  it("cannot skip authorization", () => {
    expect(canTransition("LOCKED", "PAYMENT_PENDING")).toBe(false);
    expect(canTransition("DRAFT", "AUTHORIZED")).toBe(false);
    expect(canTransition("PAYMENT_SUCCESS", "PAYMENT_PENDING")).toBe(false);
  });
});

describe("agent tools", () => {
  it("rejects product ids that never came from the catalog", async () => {
    const session = store.createSession();
    await expect(
      executeTool(session, "build_solution_option", {
        name: "fake", approach: "x", summary: "x", goal_fit: 5, pros: ["x"], cons: [],
        components: [{ product_id: "made-up-ps6", role: "REQUIRED", kind: "HARDWARE", reason: "x" }],
      }),
    ).rejects.toThrow(/Unknown or unpriced/);
  });

  it("validates tool input", async () => {
    const session = store.createSession();
    await expect(executeTool(session, "search_products", { query: 5 })).rejects.toThrow(/Invalid input/);
  });

  it("prices options from the catalog, not from the model", async () => {
    const session = await sessionWithOption();
    const opt = session.options[0];
    expect(opt.cost.upfrontTotal).toBe(37999 + 5999);
    expect(opt.cost.monthlyRecurring).toBe(1999);
    expect(opt.rank).toBe(1);
  });
});

describe("purchase flow", () => {
  it("locks, authorises with PIN, creates order and captures exactly once", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    expect(plan.pricing.total).toBe(43998);
    expect(plan.recurring[0].monthly).toBe(1999);

    const locked = await transactions.lock(plan.id);
    expect(locked.status).toBe("LOCKED");
    expect(verifyLock(locked, locked.lock!.hash)).toBe(true);

    createOrderForPlan.mockResolvedValue({ orderId: "5O190127TN364715T", status: "CREATED" });
    const authorized = await transactions.authorize(plan.id, locked.lock!.hash, "2468");
    expect(authorized.status).toBe("PAYMENT_PENDING");
    expect(createOrderForPlan).toHaveBeenCalledTimes(1);
    expect(createOrderForPlan.mock.calls[0][0].pricing.total).toBe(43998);

    captureOrder.mockResolvedValue({ status: "COMPLETED", captureId: "CAP123" });
    const paid = await transactions.capture(plan.id, "5O190127TN364715T");
    expect(paid.status).toBe("PAYMENT_SUCCESS");
    const again = await transactions.capture(plan.id, "5O190127TN364715T");
    expect(again.status).toBe("PAYMENT_SUCCESS");
    expect(captureOrder).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong PIN and cancels after too many attempts", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    const locked = await transactions.lock(plan.id);
    for (let i = 0; i < 2; i++) {
      await expect(transactions.authorize(plan.id, locked.lock!.hash, "0000")).rejects.toMatchObject({ code: "INVALID_PIN" });
    }
    await expect(transactions.authorize(plan.id, locked.lock!.hash, "0000")).rejects.toMatchObject({ code: "LOCKED_OUT" });
    expect(store.getPlan(plan.id)!.status).toBe("CANCELLED");
    expect(createOrderForPlan).not.toHaveBeenCalled();
  });

  it("refuses authorisation if the plan was tampered with after locking", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    const locked = await transactions.lock(plan.id);
    const stored = store.getPlan(plan.id)!;
    stored.pricing.total = 100; // simulate tampering
    await expect(transactions.authorize(plan.id, locked.lock!.hash, "2468")).rejects.toMatchObject({ code: "LOCK_MISMATCH" });
    expect(createOrderForPlan).not.toHaveBeenCalled();
  });

  it("refuses to authorise with a hash for different contents", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    await transactions.lock(plan.id);
    const other = computeLock({ ...store.getPlan(plan.id)!, pricing: { ...plan.pricing, total: 1 } }).hash;
    await expect(transactions.authorize(plan.id, other, "2468")).rejects.toBeInstanceOf(PlanError);
  });

  it("marks a declined payment without retrying or renegotiating", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    const locked = await transactions.lock(plan.id);
    createOrderForPlan.mockResolvedValue({ orderId: "8AB12345CD678901E", status: "CREATED" });
    await transactions.authorize(plan.id, locked.lock!.hash, "2468");
    captureOrder.mockResolvedValue({ status: "DECLINED", code: "INSTRUMENT_DECLINED" });
    const res = await transactions.capture(plan.id, "8AB12345CD678901E");
    expect(res.status).toBe("PAYMENT_DECLINED");
  });

  it("rejects capture of an order that belongs to another plan", async () => {
    const session = await sessionWithOption();
    const plan = transactions.createPlan(session.id, session.options[0].id);
    const locked = await transactions.lock(plan.id);
    createOrderForPlan.mockResolvedValue({ orderId: "1AA11111AA111111A", status: "CREATED" });
    await transactions.authorize(plan.id, locked.lock!.hash, "2468");
    await expect(transactions.capture(plan.id, "9ZZ99999ZZ999999Z")).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
  });
});
