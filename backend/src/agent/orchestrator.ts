import Anthropic from "@anthropic-ai/sdk";
import { aiProvider, config } from "../config.js";
import { geminiTurn } from "./gemini.js";
import { log } from "../lib/logger.js";
import { store, type Session } from "../store/store.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { describeToolCall, executeTool, toolDefinitions, ToolInputError } from "./tools.js";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean; error?: string }
  | { type: "state"; sessionId: string }
  | { type: "error"; message: string }
  | { type: "done" };

const MAX_ITERATIONS = 24;
let anthropic: Anthropic | undefined;
const busy = new Set<string>();

export class SessionBusyError extends Error {}

/**
 * One user turn: a manual tool-use loop over BuyWise tools and read-only PayPal Agent Toolkit tools,
 * on whichever AI provider is configured. Neither loop has a path to payment execution - that lives in
 * the transaction service behind the PIN.
 */
export async function runAgentTurn(session: Session, userText: string, emit: (e: AgentEvent) => void): Promise<void> {
  if (busy.has(session.id)) throw new SessionBusyError("This conversation is still working on the previous message");
  busy.add(session.id);
  try {
    if (aiProvider() === "gemini") await geminiTurn(session, userText, emit);
    else await claudeTurn(session, userText, emit);
    store.saveSession(session);
    emit({ type: "state", sessionId: session.id });
    emit({ type: "done" });
  } finally {
    busy.delete(session.id);
  }
}

async function claudeTurn(session: Session, userText: string, emit: (e: AgentEvent) => void): Promise<void> {
  const client = (anthropic ??= new Anthropic());
  {
    session.messages.push({ role: "user", content: userText });
    store.saveSession(session);

    const tools = toolDefinitions().map((t) => ({ ...t, eager_input_streaming: true }));
    let jsonRetries = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = client.beta.messages.stream({
        model: config.anthropic.model,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: config.anthropic.effort },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages: session.messages,
      });
      stream.on("text", (delta) => emit({ type: "text", delta }));

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        log("agent_tool_json_retry", { sessionId: session.id }, "warn");
        continue;
      }

      log("agent_iteration", {
        sessionId: session.id,
        iteration: i,
        stop: message.stop_reason,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        cacheRead: message.usage.cache_read_input_tokens,
        outputTokens: message.usage.output_tokens,
      });

      if (message.stop_reason === "refusal") {
        // Don't keep the refused turn in history; tell the user plainly.
        emit({ type: "text", delta: "\n\nI can't help with that request. I can help you compare and plan purchases." });
        break;
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "max_tokens" && toolUses.length) {
        // A truncated tool call must not be run or kept in history.
        throw new Error("The agent's response was cut off (max_tokens). Please try again.");
      }
      session.messages.push({ role: "assistant", content: message.content });
      if (toolUses.length === 0) break;

      const results = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          emit({ type: "tool_start", id: tu.id, name: tu.name, label: describeToolCall(tu.name, tu.input) });
          try {
            const output = await executeTool(session, tu.name, tu.input);
            emit({ type: "tool_end", id: tu.id, name: tu.name, ok: true });
            return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: "tool_end", id: tu.id, name: tu.name, ok: false, error: msg });
            log("agent_tool_error", { tool: tu.name, error: msg, invalidInput: err instanceof ToolInputError }, "warn");
            return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: msg };
          }
        }),
      );
      session.messages.push({ role: "user", content: results });
      store.saveSession(session);
      emit({ type: "state", sessionId: session.id });
    }
  }
}
