import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod/v4";
import { aiModel, aiProvider, config, integrations } from "./config.js";
import { log } from "./lib/logger.js";
import { api } from "./routes/api.js";
import { webhooks } from "./routes/webhooks.js";
import { auth } from "./routes/auth.js";
import { PlanError } from "./transactions/service.js";
import { TransitionError } from "./transactions/state-machine.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: "256kb" }));
app.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  next();
});

app.use("/api", api);
app.use("/api/webhooks", webhooks);
app.use("/api/auth", auth);
if (process.env.DEV_SEED === "true" && process.env.NODE_ENV !== "production") {
  const { dev } = await import("./routes/dev.js");
  app.use("/api/dev", dev);
  log("dev_routes_enabled", {}, "warn");
}

// In production the backend also serves the built Angular app (single Render service).
const staticDir = path.resolve(process.env.STATIC_DIR ?? "../frontend/dist/frontend/browser");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof PlanError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Invalid request body", issues: err.issues.map((i) => i.path.join(".")) } });
  }
  if (err instanceof TransitionError) {
    return res.status(409).json({ error: { code: "INVALID_STATE", message: err.message } });
  }
  log("unhandled_error", { error: String(err) }, "error");
  res.status(500).json({ error: { code: "SYSTEM_ERROR", message: "Something went wrong" } });
});

app.listen(config.port, () => {
  log("server_started", {
    port: config.port,
    ai: aiProvider(),
    model: aiModel(),
    aiConfigured: integrations.ai(),
    channel3: integrations.channel3(),
    paypal: integrations.paypal(),
    paypalEnv: config.paypal.sandbox ? "sandbox" : "production",
  });
});
