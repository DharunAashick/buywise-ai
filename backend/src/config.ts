import "dotenv/config";

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:4200",

  anthropic: {
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    effort: (process.env.ANTHROPIC_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  },

  channel3: {
    apiKey: process.env.CHANNEL3_API_KEY ?? "",
    baseUrl: process.env.CHANNEL3_BASE_URL ?? "https://api.trychannel3.com",
    country: process.env.CHANNEL3_COUNTRY ?? "US",
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    sandbox: (process.env.PAYPAL_ENVIRONMENT ?? "sandbox").toLowerCase() !== "production",
  },

  // PayPal's Agent Toolkit create_order and Channel3 both support USD, so it is the
  // single settlement currency for the whole pipeline.
  currency: "USD" as const,

  security: {
    // Demo PIN used only to seed the PIN hash on first boot. It is never logged or stored in clear.
    demoPin: process.env.DEMO_PIN ?? "2468",
    maxPinAttempts: Number(process.env.MAX_PIN_ATTEMPTS ?? 3),
    authorizationTtlMs: 10 * 60 * 1000,
  },

  // When true and Channel3 has no key, the agent searches the bundled demo catalog.
  allowDemoCatalog: bool(process.env.ALLOW_DEMO_CATALOG, true),
  dataFile: process.env.DATA_FILE ?? "data/store.json",
};

export const integrations = {
  claude: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  channel3: () => Boolean(config.channel3.apiKey),
  paypal: () => Boolean(config.paypal.clientId && config.paypal.clientSecret),
};
