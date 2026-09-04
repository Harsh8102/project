// OpenRouter client for the analyst chat agent — tier 3 (last resort) of
// the chat provider fallback chain (lib/ai/chatAgent.ts: Groq -> Cerebras
// -> OpenRouter). A real side-by-side benchmark (same 6 real questions,
// same real tools/data) found OpenRouter meaningfully slower per call
// (~6-18s vs Groq/Cerebras's ~1-3s best case — it's a routing layer with
// its own hop on top of whichever backend it dispatches to) but it never
// once hit a rate limit across the exact same rapid-fire burst that broke
// BOTH Groq and Cerebras. That's because this uses the paid
// openai/gpt-oss-120b (not a free ":free"-suffixed model) — real but
// negligible cost (a few cents for the whole benchmark). Positioned last
// in the chain deliberately: slower but essentially didn't choke under
// load, which is exactly the property worth having as the final fallback.

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestTimer } from "@/lib/timing";
import type { ChatTurn, ToolDeclaration, ToolCallRecord } from "./gemini";
import { callOpenAiCompatibleWithBoundedRetry, runOpenAiCompatibleAgentTurn } from "./openaiCompatibleAgent";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const apiKeyOverride = new AsyncLocalStorage<string>();

export function runWithOpenRouterApiKeyOverride<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const trimmed = key?.trim();
  if (!trimmed) return fn();
  return apiKeyOverride.run(trimmed, fn);
}

function getOpenRouterApiKey(): string {
  const override = apiKeyOverride.getStore();
  if (override) return override;
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local.");
  }
  return process.env.OPENROUTER_API_KEY;
}

// OpenRouter's provider/model-slug naming (WITH the "openai/" prefix,
// unlike Cerebras's bare model id) — same underlying model tested on Groq
// and Cerebras, for a like-for-like comparison across all three.
export const OPENROUTER_MODELS = {
  chat: process.env.OPENROUTER_CHAT_MODEL || "openai/gpt-oss-120b",
} as const;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

export async function runAgentTurnOpenRouter(params: {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  timer?: RequestTimer;
  maxWaitBudgetMs?: number;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const apiKey = getOpenRouterApiKey();
  // Last resort in the chain — nowhere further to fall back to, and it's
  // already the slow tier, so it gets a more generous wait budget than
  // Groq/Cerebras rather than failing fast.
  const maxWaitBudgetMs = params.maxWaitBudgetMs ?? 60000;

  return runOpenAiCompatibleAgentTurn({
    timerLabel: "openrouter",
    systemInstruction: params.systemInstruction,
    tools: params.tools,
    history: params.history,
    executeTool: params.executeTool,
    maxToolRounds: params.maxToolRounds,
    timer: params.timer,
    callProvider: (messages, tools) =>
      callOpenAiCompatibleWithBoundedRetry({
        url: OPENROUTER_API_URL,
        apiKey,
        body: { model: params.model, messages, tools, tool_choice: "auto" },
        extraHeaders: { "X-Title": "Kill the Quote Spreadsheet" },
        isRetryableStatus,
        maxRetries: 3,
        maxWaitBudgetMs,
        providerLabel: "OpenRouter",
      }),
  });
}
