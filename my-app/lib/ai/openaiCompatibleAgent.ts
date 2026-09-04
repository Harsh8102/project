// Shared core for every OpenAI-compatible tool-calling provider this app
// talks to (Groq, Cerebras, OpenRouter — see lib/ai/groq.ts, cerebras.ts,
// openrouter.ts). The multi-round tool-calling loop, schema conversion,
// and retry-with-a-bounded-budget logic are identical across all three —
// only the URL/auth/model differ, so that's the only thing each provider
// file supplies.
//
// The bounded retry budget (`maxWaitBudgetMs`) is what makes a 3-tier
// fallback chain (lib/ai/chatAgent.ts) actually fast: a real live test hit
// a case where Groq alone, retrying its own rate limit 3x with full
// exponential/hinted backoff, took 100+ seconds across a multi-round turn.
// Left unbounded, a fallback chain would just stack that same problem
// three times over. Here, each provider gives up and lets the chain move
// on the moment a hinted wait would exceed its budget, rather than always
// waiting the full hinted time.

import type { RequestTimer } from "@/lib/timing";
import type { ChatTurn, ToolDeclaration, ToolCallRecord, Schema } from "./gemini";

// --- Gemini Schema (Type.OBJECT etc, uppercase) -> OpenAI JSON Schema (lowercase) ---
// CHAT_TOOLS (lib/ai/chat/tools.ts) declares every non-required field with
// no `required` entry at all — Gemini's own convention for "optional."
// OpenAI-compatible tool-call validators are stricter: gpt-oss-120b passes
// an explicit `null` for an unset optional field, which a bare
// `type: "string"` schema rejects (confirmed live against Groq). Fix: any
// property not in its own `required` list gets its type widened to accept
// null too.
export function convertGeminiSchemaToOpenAi(schema: unknown): Record<string, unknown> {
  if (schema === null || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof s.type === "string") out.type = s.type.toLowerCase();
  if (typeof s.description === "string") out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (Array.isArray(s.required)) out.required = s.required;
  if (s.properties && typeof s.properties === "object") {
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => {
        const converted = convertGeminiSchemaToOpenAi(v);
        if (!required.has(k) && typeof converted.type === "string") {
          converted.type = [converted.type, "null"];
        }
        return [k, converted];
      })
    );
  }
  if (s.items) out.items = convertGeminiSchemaToOpenAi(s.items as Schema);
  return out;
}

export function toOpenAiTools(declarations: ToolDeclaration[]) {
  return declarations.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: convertGeminiSchemaToOpenAi(d.parameters) },
  }));
}

export type OpenAiToolCall = { id: string; function: { name: string; arguments: string } };
export type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};
export type OpenAiChatCompletionResponse = {
  choices?: { message?: { content?: string; tool_calls?: OpenAiToolCall[] } }[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A single POST to an OpenAI-compatible chat-completions endpoint, retried
 * on retryable statuses up to `maxRetries` times — but only while the
 * (hinted or backed-off) wait would stay within `maxWaitBudgetMs` total.
 * The moment a wait would exceed the remaining budget, this throws
 * immediately instead of waiting, so a caller chaining providers moves on
 * fast rather than paying the full wait for a provider it's about to
 * abandon anyway.
 */
export async function callOpenAiCompatibleWithBoundedRetry(params: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  isRetryableStatus: (status: number) => boolean;
  maxRetries: number;
  maxWaitBudgetMs: number;
  providerLabel: string;
}): Promise<OpenAiChatCompletionResponse> {
  let waitedMs = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= params.maxRetries; attempt++) {
    const res = await fetch(params.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}`, ...params.extraHeaders },
      body: JSON.stringify(params.body),
    });
    if (res.ok) return res.json();

    const bodyText = await res.text();
    lastError = new Error(`${params.providerLabel} API error ${res.status}: ${bodyText.slice(0, 500)}`);
    if (!params.isRetryableStatus(res.status) || attempt === params.maxRetries) throw lastError;

    const match = bodyText.match(/try again in ([\d.]+)s/i) || bodyText.match(/retry.{0,20}?([\d.]+)\s*s/i);
    const hintedWaitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 300 : 2000 * 2 ** attempt;
    if (waitedMs + hintedWaitMs > params.maxWaitBudgetMs) {
      console.warn(`${params.providerLabel}: retry wait (${hintedWaitMs}ms) would exceed its fallback budget — giving up on this provider instead of waiting.`);
      throw lastError;
    }
    console.warn(`${params.providerLabel} call failed (status ${res.status}), retrying in ${hintedWaitMs}ms (attempt ${attempt + 1}/${params.maxRetries})...`);
    waitedMs += hintedWaitMs;
    await sleep(hintedWaitMs);
  }
  throw lastError;
}

export type CallOpenAiCompatible = (messages: OpenAiMessage[], tools: ReturnType<typeof toOpenAiTools>) => Promise<OpenAiChatCompletionResponse>;

/**
 * Provider-agnostic multi-round tool-calling loop — the exact same
 * contract as lib/ai/gemini.ts's runAgentTurn, so any caller (or another
 * provider file) can use it as a drop-in. `callProvider` is the only
 * provider-specific piece (its URL/auth/retry policy); everything about
 * HOW a tool-calling turn actually proceeds — building messages, executing
 * tools, the finalAnswer short-circuit — lives here once.
 */
export async function runOpenAiCompatibleAgentTurn(params: {
  callProvider: CallOpenAiCompatible;
  timerLabel: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  timer?: RequestTimer;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const maxRounds = params.maxToolRounds ?? 5;
  const tools = toOpenAiTools(params.tools);

  const messages: OpenAiMessage[] = [
    { role: "system", content: params.systemInstruction },
    ...params.history.map((t) => ({ role: (t.role === "model" ? "assistant" : "user") as "assistant" | "user", content: t.text })),
  ];

  const toolCalls: ToolCallRecord[] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const data = await params.callProvider(messages, tools);
    params.timer?.mark(`${params.timerLabel}:round${round}`);

    const message = data.choices?.[0]?.message;
    const calls = message?.tool_calls;
    if (!calls || calls.length === 0) {
      return { text: message?.content ?? "", toolCalls };
    }

    messages.push({ role: "assistant", content: message?.content ?? "", tool_calls: calls });

    for (const call of calls) {
      const name = call.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments ?? "{}");
      } catch {
        // malformed args from the model — execute with none rather than crash the turn
      }
      const result = await params.executeTool(name, args);
      toolCalls.push({ name, args, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
    params.timer?.mark(`${params.timerLabel}:tools:round${round} (${calls.map((c) => c.function?.name).join(",")})`);

    // Same short-circuit as gemini.ts's runAgentTurn: a single tool call
    // whose own result already IS the complete answer skips the next
    // round-trip entirely.
    if (calls.length === 1) {
      const onlyResult = toolCalls[toolCalls.length - 1].result;
      if (typeof onlyResult.finalAnswer === "string") {
        return { text: onlyResult.finalAnswer, toolCalls };
      }
    }
  }

  throw new Error(`Chat agent exceeded ${maxRounds} tool-call rounds without a final answer`);
}
