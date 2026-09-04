// The analyst chat agent's endpoint (§9 of the functional plan). The DB is
// authoritative for conversation history (not the client's in-memory
// state), so a reload or a new session picks up the same conversation.
//
// Timed end-to-end (see RequestTimer, lib/timing.ts) — added after real
// user reports of slow responses; findings and the fix (or lack of one, and
// why) are written up in docs/chat-response-time-investigation.md.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { ChatMessageModel } from "@/lib/db/models/ChatMessage";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";
import { runAgentTurn, runWithApiKeyOverride, MODELS } from "@/lib/ai/gemini";
import { runAgentTurnWithFallback } from "@/lib/ai/chatAgent";
import { CHAT_TOOLS, executeChatTool } from "@/lib/ai/chat/tools";
import { CHAT_SYSTEM_INSTRUCTION } from "@/lib/ai/chat/systemInstruction";
import { RequestTimer } from "@/lib/timing";

// Provider swap point — real side-by-side benchmark (same real questions,
// same real tools) found Groq ~10-20x faster per turn than Gemini with
// identical tool selection and both guardrail traps (fabrication bait,
// prompt injection) still holding. When set to "groq" this runs the real
// 3-tier fallback chain (Groq -> Cerebras -> OpenRouter — see
// lib/ai/chatAgent.ts), not Groq alone. Gemini stays available via this
// one env var as a last-resort switch back to the original provider.
const CHAT_PROVIDER = process.env.CHAT_PROVIDER === "groq" ? "groq" : "gemini";

export async function POST(req: Request) {
  const timer = new RequestTimer();
  const body = await req.json();
  const { rfxId, message } = body as { rfxId?: string; message?: string };

  if (!rfxId || !message) {
    return NextResponse.json({ error: "rfxId and message are required" }, { status: 400 });
  }

  // Viewer-supplied key (see components/ApiKeyControl.tsx) — never logged,
  // never persisted, used only to scope this request's calls to whichever
  // provider is actually active. Only Gemini and Groq are exposed in the
  // UI (the two a viewer is actually likely to hit); Cerebras/OpenRouter
  // are fallback-only tiers with no override surface yet.
  const userGeminiKey = req.headers.get("x-gemini-api-key");
  const userGroqKey = req.headers.get("x-groq-api-key");

  await connectToDatabase();
  timer.mark("connectDb");

  await ChatMessageModel.create({ rfxId, role: "user", text: message });
  timer.mark("saveUserMessage");

  const priorMessages = await ChatMessageModel.find({ rfxId }).sort({ createdAt: 1 }).lean();
  const history = priorMessages.map((m) => ({ role: m.role as "user" | "model", text: m.text }));
  timer.mark("loadHistory");

  const comparisonData = await getComparisonData(rfxId);
  timer.mark("getComparisonData");

  // Every persisted user message must end up paired with a model reply —
  // otherwise a failed call (rate limit, transient API error) leaves a
  // dangling question in the DB-authoritative history, which then confuses
  // both a reloaded UI and the next turn's context. So a failure here still
  // gets a real (persisted) reply, just one that says what happened.
  let text: string;
  let toolCalls: Awaited<ReturnType<typeof runAgentTurn>>["toolCalls"] = [];
  try {
    const executeTool = async (name: string, args: Record<string, unknown>) =>
      executeChatTool(comparisonData, name, args) as unknown as Record<string, unknown>;

    if (CHAT_PROVIDER === "groq") {
      const result = await runAgentTurnWithFallback({
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        tools: CHAT_TOOLS.map((t) => t.declaration),
        history,
        executeTool,
        timer,
        userGroqKey,
      });
      text = result.text;
      toolCalls = result.toolCalls;
      console.log(`[chat provider] answered via ${result.providerUsed}`);
    } else {
      const result = await runWithApiKeyOverride(userGeminiKey, () =>
        runAgentTurn({ model: MODELS.chat, systemInstruction: CHAT_SYSTEM_INSTRUCTION, tools: CHAT_TOOLS.map((t) => t.declaration), history, executeTool, timer })
      );
      text = result.text;
      toolCalls = result.toolCalls;
    }
  } catch (err) {
    console.error("Chat agent turn failed:", err);
    // For the groq/fallback-chain path, reaching this catch means all
    // three tiers (Groq -> Cerebras -> OpenRouter) failed — a much rarer
    // event than any single provider's own rate limit, so the message
    // reflects that rather than blaming just Groq specifically.
    const usedOwnKey = CHAT_PROVIDER === "groq" ? !!userGroqKey : !!userGeminiKey;
    const providerLabel = CHAT_PROVIDER === "groq" ? "Groq" : "Gemini";
    const keySiteHint = CHAT_PROVIDER === "groq" ? "console.groq.com/keys" : "aistudio.google.com/apikey";
    text = usedOwnKey
      ? `I hit an error reaching the model with your API key — double-check it's a valid ${providerLabel} key and try again.`
      : CHAT_PROVIDER === "groq"
        ? `I hit an error reaching the model just now — all three fallback providers (Groq, Cerebras, OpenRouter) are unavailable, which is unusual. Click "API key" above and paste your own free Groq key (${keySiteHint}) to keep going.`
        : `I hit an error reaching the model just now (likely the shared demo key is rate-limited). Click "API key" above and paste your own free ${providerLabel} key (${keySiteHint}) to keep going.`;
  }
  timer.mark("runAgentTurn");

  // Snapshot before the save so `timings` reflects everything up to (not
  // including) persisting itself — `saveModelMessage` below still gets
  // marked and logged, just not baked into the stored document.
  const timings = timer.toJSON();
  const saved = await ChatMessageModel.create({ rfxId, role: "model", text, toolCalls, timings });
  timer.mark("saveModelMessage");

  console.log(`[chat timing] rfxId=${rfxId}\n${timer.summary()}`);

  return NextResponse.json({
    id: String(saved._id),
    text,
    toolCalls,
    timings,
  });
}
