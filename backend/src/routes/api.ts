import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import Anthropic from "@anthropic-ai/sdk";
import { aiModel, aiProvider, config, integrations } from "../config.js";
import { geminiErrorMessage } from "../agent/gemini.js";
import { log } from "../lib/logger.js";
import { catalogSource } from "../catalog/index.js";
import { calculateCost } from "../engine/cost.js";
import { assessAffordability } from "../engine/affordability.js";
import { scoreOptions } from "../engine/scoring.js";
import { store } from "../store/store.js";
import { runAgentTurn, SessionBusyError, type AgentEvent } from "../agent/orchestrator.js";
import { PlanError, transactions } from "../transactions/service.js";
import { planView, sessionView } from "./view.js";

export const api = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

function requireSession(id: string) {
  const s = store.getSession(id);
  if (!s) throw new PlanError("Session not found", "SESSION_NOT_FOUND", 404);
  return s;
}

// ---------- Meta ----------

api.get("/health", (_req, res) => {
  res.json({ ok: true, ai: aiProvider(), integrations: { ai: integrations.ai(), channel3: integrations.channel3(), paypal: integrations.paypal() } });
});

api.get("/config", (_req, res) => {
  res.json({
    currency: config.currency,
    catalogSource: catalogSource(),
    paypal: { clientId: config.paypal.clientId || null, sandbox: config.paypal.sandbox },
    integrations: { ai: integrations.ai(), channel3: integrations.channel3(), paypal: integrations.paypal() },
    aiProvider: aiProvider(),
    model: aiModel(),
  });
});

// ---------- Sessions & chat ----------

api.post("/sessions", (_req, res) => {
  const s = store.createSession();
  log("session_created", { sessionId: s.id });
  res.status(201).json(sessionView(s, []));
});

api.get(
  "/sessions/:id",
  wrap((req, res) => {
    const s = requireSession(String(req.params.id));
    res.json(sessionView(s, store.plansForSession(s.id)));
  }),
);

const ChatBody = z.object({ message: z.string().trim().min(1).max(4000) });

// Server-sent events: text deltas, tool activity, and "state" pings telling the UI to refresh.
api.post(
  "/sessions/:id/chat",
  wrap(async (req, res) => {
    const s = requireSession(String(req.params.id));
    const body = ChatBody.parse(req.body);
    if (!integrations.ai()) {
      const key = aiProvider() === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
      throw new PlanError(`${key} is not configured on the server`, "AI_NOT_CONFIGURED", 503);
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    try {
      log("intent_received", { sessionId: s.id, chars: body.message.length });
      await runAgentTurn(s, body.message, send);
    } catch (err) {
      const message =
        err instanceof SessionBusyError
          ? err.message
          : geminiErrorMessage(err)
          ? geminiErrorMessage(err)!
          : err instanceof Anthropic.RateLimitError
            ? "The AI service is busy right now. Please try again in a moment."
            : err instanceof Anthropic.APIError
              ? `The AI service returned an error (${err.status}).`
              : err instanceof Error
                ? err.message
                : "Unexpected error";
      log("agent_turn_failed", { sessionId: s.id, error: String(err) }, "error");
      send({ type: "error", message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }),
);

// User edits an option in the comparison grid (include/exclude a non-required component).
const ToggleBody = z.object({ componentId: z.string(), included: z.boolean() });
api.post(
  "/sessions/:id/options/:optionId/components",
  wrap((req, res) => {
    const s = requireSession(String(req.params.id));
    const { componentId, included } = ToggleBody.parse(req.body);
    const option = s.options.find((o) => o.id === req.params.optionId);
    if (!option) throw new PlanError("Option not found", "OPTION_NOT_FOUND", 404);
    const comp = option.components.find((c) => c.id === componentId);
    if (!comp) throw new PlanError("Component not found", "COMPONENT_NOT_FOUND", 404);
    if (comp.role === "REQUIRED" && !included) throw new PlanError("Required components can't be removed", "REQUIRED_COMPONENT");
    comp.included = included;
    option.cost = calculateCost(option.components);
    option.affordability = assessAffordability(option.cost, s.profile);
    s.options = scoreOptions(s.options, s.profile);
    s.recommendedOptionId = s.options[0]?.id;
    store.saveSession(s);
    res.json(sessionView(s, store.plansForSession(s.id)));
  }),
);

// ---------- Purchase plans ----------
// Note: none of these endpoints accept prices, totals or quantities from the client.
// Plans are built from server-side options; amounts are computed by the cost engine.

const CreatePlanBody = z.object({ sessionId: z.string(), optionId: z.string(), includeComponentIds: z.array(z.string()).optional() });
api.post(
  "/plans",
  wrap((req, res) => {
    const body = CreatePlanBody.parse(req.body);
    res.status(201).json(planView(transactions.createPlan(body.sessionId, body.optionId, body.includeComponentIds)));
  }),
);

api.get(
  "/plans/:id",
  wrap((req, res) => {
    const plan = store.getPlan(String(req.params.id));
    if (!plan) throw new PlanError("Purchase plan not found", "PLAN_NOT_FOUND", 404);
    res.json(planView(plan));
  }),
);

api.post(
  "/plans/:id/lock",
  wrap(async (req, res) => {
    res.json(planView(await transactions.lock(String(req.params.id))));
  }),
);

const AuthorizeBody = z.object({ lockHash: z.string().regex(/^[a-f0-9]{64}$/), pin: z.string() });
api.post(
  "/plans/:id/authorize",
  wrap(async (req, res) => {
    const body = AuthorizeBody.parse(req.body);
    res.json(planView(await transactions.authorize(String(req.params.id), body.lockHash, body.pin)));
  }),
);

const CaptureBody = z.object({ orderId: z.string().regex(/^[A-Z0-9]{10,40}$/) });
api.post(
  "/plans/:id/capture",
  wrap(async (req, res) => {
    const body = CaptureBody.parse(req.body);
    res.json(planView(await transactions.capture(String(req.params.id), body.orderId)));
  }),
);

api.post(
  "/plans/:id/cancel",
  wrap((req, res) => {
    res.json(planView(transactions.cancel(String(req.params.id))));
  }),
);
