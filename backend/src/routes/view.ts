import type Anthropic from "@anthropic-ai/sdk";
import type { PurchasePlan } from "../domain/types.js";
import type { Session } from "../store/store.js";

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
}

/** Text-only transcript for the UI (tool calls, tool results and thinking are not shown). */
export function transcript(messages: Anthropic.Beta.BetaMessageParam[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")
            .map((b) => b.text)
            .join("");
    if (!text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += `\n\n${text}`;
    else out.push({ role: m.role, text });
  }
  return out;
}

/** Plan as exposed to the browser: never includes anything secret, and the lock is reduced to its hash. */
export function planView(plan: PurchasePlan) {
  const { lock, ...rest } = plan;
  return { ...rest, lock: lock ? { hash: lock.hash, lockedAt: lock.lockedAt } : undefined };
}

export function sessionView(session: Session, plans: PurchasePlan[]) {
  return {
    id: session.id,
    profile: session.profile,
    options: session.options,
    recommendedOptionId: session.recommendedOptionId,
    transcript: transcript(session.messages),
    plans: plans.map(planView),
    updatedAt: session.updatedAt,
  };
}
