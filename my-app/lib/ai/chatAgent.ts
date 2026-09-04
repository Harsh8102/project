// Three-tier fallback chain for the analyst chat agent: Groq -> Cerebras
// -> OpenRouter. Built after a real live incident (lib/ai/groq.ts alone,
// under a burst of real questions, needed 3 independently-retried rounds
// that stacked to 102.7s total) and three separate real benchmarks (same 6
// questions, same real tools/data, run against each provider) that showed
// each tier is genuinely useful for a different reason:
//   - Groq: fastest in the common case (~1-3s), free.
//   - Cerebras: matches Groq on correctness and best-case speed, and
//     critically has an INDEPENDENT quota pool — a Groq-specific outage or
//     exhausted quota doesn't touch it. (Its own free tier is actually
//     tighter than Groq's, so it's not "more headroom," it's "different
//     headroom.")
//   - OpenRouter: slower per call (~6-18s, real routing overhead) but
//     didn't hit a single rate limit in the exact burst that broke both of
//     the others — the property that matters most for a LAST resort.
//
// Each tier gets its own short wait budget (see
// lib/ai/openaiCompatibleAgent.ts) so a struggling provider fails fast
// instead of exhausting its own retries before the chain even tries the
// next one. A tier-level failure restarts the whole turn on the next
// provider rather than trying to splice conversation state across
// providers mid-round — turns are short (1-3 rounds typically) so the
// redone work is cheap, and it avoids subtle cross-provider message-format
// bugs.

import type { RequestTimer } from "@/lib/timing";
import type { ChatTurn, ToolDeclaration, ToolCallRecord } from "./gemini";
import { runAgentTurnGroq, runWithGroqApiKeyOverride, GROQ_MODELS } from "./groq";
import { runAgentTurnCerebras, runWithCerebrasApiKeyOverride, CEREBRAS_MODELS } from "./cerebras";
import { runAgentTurnOpenRouter, runWithOpenRouterApiKeyOverride, OPENROUTER_MODELS } from "./openrouter";

export type ChatProviderName = "groq" | "cerebras" | "openrouter";

export async function runAgentTurnWithFallback(params: {
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  timer?: RequestTimer;
  userGroqKey?: string | null;
  userCerebrasKey?: string | null;
  userOpenRouterKey?: string | null;
}): Promise<{ text: string; toolCalls: ToolCallRecord[]; providerUsed: ChatProviderName }> {
  const shared = {
    systemInstruction: params.systemInstruction,
    tools: params.tools,
    history: params.history,
    executeTool: params.executeTool,
    maxToolRounds: params.maxToolRounds,
    timer: params.timer,
  };

  try {
    const result = await runWithGroqApiKeyOverride(params.userGroqKey, () =>
      runAgentTurnGroq({ ...shared, model: GROQ_MODELS.chat, maxWaitBudgetMs: 6000 })
    );
    return { ...result, providerUsed: "groq" };
  } catch (groqErr) {
    console.warn("[chat fallback] Groq failed, trying Cerebras:", groqErr instanceof Error ? groqErr.message : groqErr);
  }

  try {
    const result = await runWithCerebrasApiKeyOverride(params.userCerebrasKey, () =>
      runAgentTurnCerebras({ ...shared, model: CEREBRAS_MODELS.chat, maxWaitBudgetMs: 6000 })
    );
    return { ...result, providerUsed: "cerebras" };
  } catch (cerebrasErr) {
    console.warn("[chat fallback] Cerebras failed, trying OpenRouter:", cerebrasErr instanceof Error ? cerebrasErr.message : cerebrasErr);
  }

  // Last resort — no further tier to fall back to, so let its own error
  // (if any) propagate to the caller.
  const result = await runWithOpenRouterApiKeyOverride(params.userOpenRouterKey, () =>
    runAgentTurnOpenRouter({ ...shared, model: OPENROUTER_MODELS.chat, maxWaitBudgetMs: 15000 })
  );
  return { ...result, providerUsed: "openrouter" };
}
