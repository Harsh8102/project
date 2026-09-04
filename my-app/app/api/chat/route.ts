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
import { CHAT_TOOLS, executeChatTool } from "@/lib/ai/chat/tools";
import { CHAT_SYSTEM_INSTRUCTION } from "@/lib/ai/chat/systemInstruction";
import { RequestTimer } from "@/lib/timing";

export async function POST(req: Request) {
  const timer = new RequestTimer();
  const body = await req.json();
  const { rfxId, message } = body as { rfxId?: string; message?: string };

  if (!rfxId || !message) {
    return NextResponse.json({ error: "rfxId and message are required" }, { status: 400 });
  }

  // Viewer-supplied key (see components/ApiKeyControl.tsx) — never logged,
  // never persisted, used only to scope this request's Gemini calls.
  const userApiKey = req.headers.get("x-gemini-api-key");

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
    const result = await runWithApiKeyOverride(userApiKey, () =>
      runAgentTurn({
        model: MODELS.chat,
        systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        tools: CHAT_TOOLS.map((t) => t.declaration),
        history,
        executeTool: async (name, args) => executeChatTool(comparisonData, name, args) as unknown as Record<string, unknown>,
        timer,
      })
    );
    text = result.text;
    toolCalls = result.toolCalls;
  } catch (err) {
    console.error("Chat agent turn failed:", err);
    // The demo's shared key is the single most likely failure point (quota,
    // shared-tier congestion — see .env.local's dated notes) — nudge toward
    // the self-serve fix only when this request wasn't already using one.
    text = userApiKey
      ? "I hit an error reaching the model with your API key — double-check it's a valid Gemini key and try again."
      : "I hit an error reaching the model just now (likely the shared demo key is rate-limited). Click \"API key\" above and paste your own free Gemini key (aistudio.google.com/apikey) to keep going.";
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
