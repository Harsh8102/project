// Groq client for the analyst chat agent — tier 1 of the chat provider
// fallback chain (lib/ai/chatAgent.ts: Groq -> Cerebras -> OpenRouter).
// Chosen as primary after a real side-by-side benchmark: Groq answered the
// same real questions in ~1-3s vs Gemini's 24-51s, picked identical tools,
// and held both guardrail tests (fabrication bait, prompt injection)
// without even needing a tool call. Extraction stays on Gemini — a
// separate benchmark on real document data found Groq materially less
// accurate at reading dense numeric tables, which doesn't apply to chat's
// much smaller, non-tabular tool-call schemas.
//
// Real constraint this file exists to handle: Groq's free tier caps at
// 8,000 tokens/minute, and a live benchmark hit that twice in just 6 test
// questions. See lib/ai/openaiCompatibleAgent.ts's bounded-retry-budget
// mechanism for how this stays fast even so — and lib/ai/chatAgent.ts for
// why Cerebras/OpenRouter exist as further tiers rather than just retrying
// Groq harder.

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestTimer } from "@/lib/timing";
import type { ChatTurn, ToolDeclaration, ToolCallRecord } from "./gemini";
import { callOpenAiCompatibleWithBoundedRetry, runOpenAiCompatibleAgentTurn, toOpenAiTools } from "./openaiCompatibleAgent";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Same per-request-override pattern as lib/ai/gemini.ts's
// runWithApiKeyOverride — a viewer-supplied key (components/ApiKeyControl.tsx)
// scopes just that request via AsyncLocalStorage, never the shared module
// state, so concurrent requests with different keys never collide.
const apiKeyOverride = new AsyncLocalStorage<string>();

export function runWithGroqApiKeyOverride<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const trimmed = key?.trim();
  if (!trimmed) return fn();
  return apiKeyOverride.run(trimmed, fn);
}

function getGroqApiKey(): string {
  const override = apiKeyOverride.getStore();
  if (override) return override;
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set. Add it to .env.local.");
  }
  return process.env.GROQ_API_KEY;
}

export const GROQ_MODELS = {
  chat: process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
} as const;

// Groq reports its TPM cap as status 429 (rolling window) or 413 (a single
// request estimated over the limit) — both carry a "try again in Xs" hint
// in the message, parsed by callOpenAiCompatibleWithBoundedRetry.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 413 || status === 500 || status === 502 || status === 503;
}

/**
 * Same contract as lib/ai/gemini.ts's runAgentTurn. `maxWaitBudgetMs` caps
 * how long this call is willing to wait on Groq's own rate limit before
 * giving up — small when used inside the fallback chain (fail fast, let
 * Cerebras take over), generous when Groq is used standalone.
 */
export async function runAgentTurnGroq(params: {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  timer?: RequestTimer;
  maxWaitBudgetMs?: number;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const apiKey = getGroqApiKey();
  const maxWaitBudgetMs = params.maxWaitBudgetMs ?? 30000;

  return runOpenAiCompatibleAgentTurn({
    timerLabel: "groq",
    systemInstruction: params.systemInstruction,
    tools: params.tools,
    history: params.history,
    executeTool: params.executeTool,
    maxToolRounds: params.maxToolRounds,
    timer: params.timer,
    callProvider: (messages, tools) =>
      callOpenAiCompatibleWithBoundedRetry({
        url: GROQ_API_URL,
        apiKey,
        body: { model: params.model, messages, tools, tool_choice: "auto" },
        isRetryableStatus,
        maxRetries: 3,
        maxWaitBudgetMs,
        providerLabel: "Groq",
      }),
  });
}

// Re-exported for callers that only need tool-shape conversion without the full loop.
export { toOpenAiTools };
