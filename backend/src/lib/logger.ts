// Structured JSON logging with a hard redaction list. Anything that looks like a PIN,
// secret or token is replaced before it reaches stdout.

const REDACT_KEYS = /pin|secret|token|password|authorization|api[-_]?key/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export function log(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export { redact };
