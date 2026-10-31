import { ApiError, GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { config } from "../config.js";
import { log } from "../lib/logger.js";
import { store, type Session } from "../store/store.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { describeToolCall, executeTool, toolSpecs, ToolInputError } from "./tools.js";
import type { AgentEvent } from "./orchestrator.js";

const MAX_ITERATIONS = 24;

let client: GoogleGenAI | undefined;
function gemini() {
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

/**
 * Gemini accepts JSON Schema via parametersJsonSchema but not every keyword: drop "$schema",
 * and collapse the zod/toolkit pattern anyOf[{not:{}}, X] (an "omit me or X" optional) to X.
 */
function cleanSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanSchema);
  if (!node || typeof node !== "object") return node;
  const obj = { ...(node as Record<string, unknown>) };
  delete obj.$schema;
  if (Array.isArray(obj.anyOf)) {
    const branches = (obj.anyOf as Record<string, unknown>[]).filter(
      (b) => !(b && typeof b === "object" && "not" in b && Object.keys(b).length === 1) && b?.type !== "null",
    );
    if (branches.length === 1) {
      const { anyOf: _drop, ...rest } = obj;
      return cleanSchema({ ...rest, ...branches[0] });
    }
    obj.anyOf = branches;
  }
  for (const [k, v] of Object.entries(obj)) obj[k] = cleanSchema(v);
  return obj;
}

export { cleanSchema as __test_cleanSchema };

let declarations: FunctionDeclaration[] | undefined;
function functionDeclarations(): FunctionDeclaration[] {
  declarations ??= toolSpecs().map((s) => ({
    name: s.name,
    description: s.description,
    parametersJsonSchema: cleanSchema(s.schema),
  }));
  return declarations;
}

/** One user turn on Gemini with manual function calling (automatic calling disabled so we control every tool run). */
export async function geminiTurn(session: Session, userText: string, emit: (e: AgentEvent) => void): Promise<void> {
  const history = (session.gemini ??= []);
  history.push({ role: "user", parts: [{ text: userText }] });
  store.saveSession(session);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = await gemini().models.generateContentStream({
      model: config.gemini.model,
      contents: history,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: functionDeclarations() }],
        automaticFunctionCalling: { disable: true },
        maxOutputTokens: 8192,
      },
    });

    // Keep every part exactly as returned (thought signatures must be sent back unchanged).
    const parts: Part[] = [];
    let finishReason: string | undefined;
    let usage: unknown;
    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      finishReason = cand?.finishReason ?? finishReason;
      usage = chunk.usageMetadata ?? usage;
      for (const p of cand?.content?.parts ?? []) {
        parts.push(p);
        if (p.text && !p.thought) emit({ type: "text", delta: p.text });
      }
    }
    log("agent_iteration", { provider: "gemini", sessionId: session.id, iteration: i, finish: finishReason, usage });

    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST") {
      emit({ type: "text", delta: "\n\nI can't help with that request. I can help you compare and plan purchases." });
      break;
    }

    const calls = parts.filter((p) => p.functionCall);
    if (finishReason === "MAX_TOKENS" && calls.length) {
      throw new Error("The agent's response was cut off. Please try again.");
    }
    if (parts.length) history.push({ role: "model", parts });
    if (calls.length === 0) break;

    const responses: Part[] = await Promise.all(
      calls.map(async ({ functionCall }, idx): Promise<Part> => {
        const name = functionCall!.name ?? "";
        const id = functionCall!.id ?? `${name}_${i}_${idx}`;
        emit({ type: "tool_start", id, name, label: describeToolCall(name, functionCall!.args) });
        try {
          const output = await executeTool(session, name, functionCall!.args ?? {});
          emit({ type: "tool_end", id, name, ok: true });
          return { functionResponse: { id: functionCall!.id, name, response: { output } } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit({ type: "tool_end", id, name, ok: false, error: msg });
          log("agent_tool_error", { tool: name, error: msg, invalidInput: err instanceof ToolInputError }, "warn");
          return { functionResponse: { id: functionCall!.id, name, response: { error: msg } } };
        }
      }),
    );
    history.push({ role: "user", parts: responses });
    store.saveSession(session);
    emit({ type: "state", sessionId: session.id });
  }
}

/** Maps Gemini SDK errors to a user-facing message. */
export function geminiErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.status === 429) return "The free Gemini quota is busy right now - please wait a minute and try again.";
  if (err.status === 400 || err.status === 403) return `Gemini rejected the request (${err.status}). Check GEMINI_API_KEY and GEMINI_MODEL.`;
  return `The AI service returned an error (${err.status}).`;
}

/** Text-only transcript of a Gemini history (function calls, responses and thoughts hidden). */
export function geminiTranscript(history: Content[]): { role: "user" | "assistant"; text: string }[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const c of history) {
    const text = (c.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");
    if (!text.trim()) continue;
    const role = c.role === "model" ? "assistant" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`;
    else out.push({ role, text });
  }
  return out;
}
