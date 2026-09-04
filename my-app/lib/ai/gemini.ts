import { AsyncLocalStorage } from "node:async_hooks";
import {
  GoogleGenAI,
  Type,
  createPartFromFunctionResponse,
  createUserContent,
  type Schema,
  type Content,
  type FunctionDeclaration,
} from "@google/genai";
import type { RequestTimer } from "@/lib/timing";

let client: GoogleGenAI | null = null;

// A hosted demo shares one Gemini key/quota across every viewer — a single
// evaluator hammering the co-pilot (or a shared free-tier outage, see
// .env.local's dated notes) can starve everyone else. `runWithApiKeyOverride`
// lets a request carry its own key (a viewer-supplied one, see
// app/api/chat/route.ts and the process route) instead of the shared server
// key, scoped via AsyncLocalStorage rather than threaded through every
// extraction/chat function signature — those already just call
// `getGeminiClient()`, so this is a zero-signature-change addition. Requests
// with different overrides running concurrently never share state: each
// override gets its own freshly-constructed client, never the cached one.
const apiKeyOverride = new AsyncLocalStorage<string>();

export function runWithApiKeyOverride<T>(key: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const trimmed = key?.trim();
  if (!trimmed) return fn();
  return apiKeyOverride.run(trimmed, fn);
}

export function getGeminiClient(): GoogleGenAI {
  const override = apiKeyOverride.getStore();
  if (override) return new GoogleGenAI({ apiKey: override });

  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and fill it in.");
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Model tiering (§5 of the architecture plan) — extraction accuracy and chat
// reasoning quality matter most (the two axes this build is graded on), so
// both stay on a Flash-class model rather than Flash-Lite; only the
// low-stakes, high-turn RFx co-pilot drops to the cheapest capable tier.
//
// Model availability has proven to vary by Google account/project (one key
// serves gemini-2.5-flash, another 404s on it and requires gemini-3.6-flash
// instead) — overridable via env so swapping keys/accounts never needs a
// code change, just a different .env.local value.
export const MODELS = {
  extraction: process.env.GEMINI_EXTRACTION_MODEL || "gemini-2.5-flash",
  chat: process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash",
  copilot: process.env.GEMINI_COPILOT_MODEL || "gemini-2.5-flash-lite",
} as const;

export { Type };
export type { Schema };

export function textPart(text: string) {
  return { text };
}

export function inlineDataPart(buffer: Buffer, mimeType: string) {
  return { inlineData: { data: buffer.toString("base64"), mimeType } };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: unknown): boolean {
  return status === 503 || status === 429;
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

/**
 * Retries transient 503 (shared free-tier pool overloaded) and 429 (rate
 * limit) errors with exponential backoff — observed frequently enough in
 * practice that this needs to be every caller's problem once, not each
 * caller's problem separately.
 */
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      if (!isRetryableStatus(status) || attempt === MAX_RETRIES) throw err;
      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      console.warn(`Gemini call failed (status ${status}), retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * One structured-output extraction call: Gemini's native `responseSchema`
 * mode (not a tool-use workaround) guarantees JSON-shaped output, which is
 * then re-validated against a Zod schema before anything touches the DB —
 * belt and suspenders, since a schema-conformant response can still be
 * semantically wrong.
 */
export async function generateStructured(params: {
  model: string;
  systemInstruction: string;
  parts: (ReturnType<typeof textPart> | ReturnType<typeof inlineDataPart>)[];
  responseSchema: Schema;
  // Optional, off by default — lets a caller test/opt into disabling
  // Gemini's default "thinking" pass (0 = disabled, per the SDK) for a
  // task that's closer to careful reading/classification than open-ended
  // reasoning. Unset behaves exactly as before this param existed.
  thinkingBudget?: number;
}): Promise<unknown> {
  const ai = getGeminiClient();
  return callWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: params.model,
      contents: [{ role: "user", parts: params.parts }],
      config: {
        systemInstruction: params.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        ...(params.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: params.thinkingBudget } } : {}),
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no text content for a structured-output call");
    return JSON.parse(text);
  });
}

export type ChatTurn = { role: "user" | "model"; text: string };
export type ToolDeclaration = { name: string; description: string; parameters: Schema };
export type ToolCallRecord = { name: string; args: Record<string, unknown>; result: Record<string, unknown> };

/**
 * Multi-turn tool-calling loop for the analyst chat agent (§9 of the
 * functional plan). Gemini gets real functions to call — `executeTool` is
 * the only thing that touches the database, so every numeric claim in the
 * final answer traces back to a concrete tool call in `toolCalls`, which is
 * exactly what a caller needs to enforce "cite everything, invent nothing."
 */
export async function runAgentTurn(params: {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  history: ChatTurn[]; // includes the new user message as the last entry
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  maxToolRounds?: number;
  // Optional — when passed, marks each Gemini round-trip and tool-execution
  // batch individually (labels prefixed `gemini:`/`tools:`), so a caller can
  // see the breakdown *inside* this loop rather than one opaque total. See
  // docs/chat-response-time-investigation.md for what this found.
  timer?: RequestTimer;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const ai = getGeminiClient();
  const maxRounds = params.maxToolRounds ?? 5;

  const functionDeclarations: FunctionDeclaration[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const contents: Content[] = params.history.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  const toolCalls: ToolCallRecord[] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: params.model,
        contents,
        config: {
          systemInstruction: params.systemInstruction,
          tools: [{ functionDeclarations }],
        },
      })
    );
    params.timer?.mark(`gemini:round${round}`);

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      return { text: response.text ?? "", toolCalls };
    }

    // Push the model's turn back verbatim (not reconstructed from
    // `response.functionCalls`) — it carries a `thoughtSignature` per part
    // that "thinking" Gemini models require to see again on the next call,
    // or they reject the request with a 400.
    const modelContent = response.candidates?.[0]?.content;
    contents.push(modelContent ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });

    const responseParts = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = call.args ?? {};
      const result = await params.executeTool(name, args);
      toolCalls.push({ name, args, result });
      responseParts.push(createPartFromFunctionResponse(call.id ?? name, name, result));
    }
    params.timer?.mark(`tools:round${round} (${calls.map((c) => c.name).join(",")})`);

    // A single tool call whose own result already IS the complete answer
    // (a ToolResult.finalAnswer — see lib/ai/chat/tools.ts) skips the next
    // Gemini round-trip entirely: there's nothing left for the model to
    // decide or phrase, so paying for another ~15-25s call just to have it
    // restate a deterministic fact is pure waste. Only fires for exactly one
    // tool call this round — a multi-call round means the model was also
    // after other data, so it still needs to see all of it and respond.
    if (calls.length === 1) {
      const onlyResult = toolCalls[toolCalls.length - 1].result;
      if (typeof onlyResult.finalAnswer === "string") {
        return { text: onlyResult.finalAnswer, toolCalls };
      }
    }

    contents.push(createUserContent(responseParts));
  }

  throw new Error(`Chat agent exceeded ${maxRounds} tool-call rounds without a final answer`);
}
