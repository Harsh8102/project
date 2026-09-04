// Cerebras client for the analyst chat agent — tier 2 of the chat
// provider fallback chain (lib/ai/chatAgent.ts: Groq -> Cerebras ->
// OpenRouter). A real side-by-side benchmark (same 6 real questions, same
// real tools/data) found Cerebras matched Groq exactly on correctness
// (100%, both guardrail tests held) and was just as fast when not
// rate-limited (~0.5-1.0s) — but its free tier's per-minute request cap is
// actually TIGHTER than Groq's, so it's not "more resilient than Groq,"
// it's an independent provider with its own quota pool, which is exactly
// what makes it useful as a second tier rather than retrying Groq harder.

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestTimer } from "@/lib/timing";
import type { ChatTurn, ToolDeclaration, ToolCallRecord } from "./gemini";
import { callOpenAiCompatibleWithBoundedRetry, runOpenAiCompatibleAgentTurn } from "./openaiCompatibleAgent";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

const apiKeyOverride = new AsyncLocalStorage<string>();

export function runWithCerebrasApiKeyOverride<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const trimmed = key?.trim();
  if (!trimmed) return fn();
  return apiKeyOverride.run(trimmed, fn);
}

function getCerebrasApiKey(): string {
  const override = apiKeyOverride.getStore();
  if (override) return override;
  if (!process.env.CEREBRAS_API_KEY) {
    throw new Error("CEREBRAS_API_KEY is not set. Add it to .env.local.");
  }
  return process.env.CEREBRAS_API_KEY;
}

// Note: unlike Groq/OpenRouter, this is the bare model id (no "openai/"
// prefix) — that's Cerebras's own naming convention for the same model.
export const CEREBRAS_MODELS = {
  chat: process.env.CEREBRAS_CHAT_MODEL || "gpt-oss-120b",
} as const;

// Confirmed live: Cerebras's rate-limit error doesn't carry a "try again in
// Xs" hint the way Groq's does, so callOpenAiCompatibleWithBoundedRetry
// falls back to its generic exponential backoff for this provider.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

export async function runAgentTurnCerebras(params: {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  timer?: RequestTimer;
  maxWaitBudgetMs?: number;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const apiKey = getCerebrasApiKey();
  const maxWaitBudgetMs = params.maxWaitBudgetMs ?? 30000;

  return runOpenAiCompatibleAgentTurn({
    timerLabel: "cerebras",
    systemInstruction: params.systemInstruction,
    tools: params.tools,
    history: params.history,
    executeTool: params.executeTool,
    maxToolRounds: params.maxToolRounds,
    timer: params.timer,
    callProvider: (messages, tools) =>
      callOpenAiCompatibleWithBoundedRetry({
        url: CEREBRAS_API_URL,
        apiKey,
        body: { model: params.model, messages, tools, tool_choice: "auto" },
        isRetryableStatus,
        maxRetries: 3,
        maxWaitBudgetMs,
        providerLabel: "Cerebras",
      }),
  });
}
