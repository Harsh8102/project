// The analyst chat agent's endpoint (§9 of the functional plan). The DB is
// authoritative for conversation history (not the client's in-memory
// state), so a reload or a new session picks up the same conversation.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { ChatMessageModel } from "@/lib/db/models/ChatMessage";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";
import { runAgentTurn, MODELS } from "@/lib/ai/gemini";
import { CHAT_TOOLS, executeChatTool } from "@/lib/ai/chat/tools";

const SYSTEM_INSTRUCTION = `You are the analyst co-pilot for a freight procurement RFx (PTL domestic lanes). A buyer is comparing 5 vendors and needs to make a defensible award decision.

Rules — these are not optional:
- Every numeric claim you make must come from a tool you called in this turn. Never state a number, score, or ranking from memory of earlier turns or from general knowledge — call a tool for it, even if you answered something similar before.
- If a tool result is empty, partial, or a vendor has no submission for something, say so plainly. Never fill a gap with an assumption.
- Never state a ranking or "vendor X is best" without also naming what drove it (gate pass/fail, the relevant scores) — the tool results already carry this, just include it.
- If a question is outside this RFx (legal advice, unrelated topics, anything you have no tool for), decline clearly and say what you can help with instead — don't improvise an answer.
- Be concise. This is a working tool for a buyer under time pressure, not an essay.`;

export async function POST(req: Request) {
  const body = await req.json();
  const { rfxId, message } = body as { rfxId?: string; message?: string };

  if (!rfxId || !message) {
    return NextResponse.json({ error: "rfxId and message are required" }, { status: 400 });
  }

  await connectToDatabase();

  await ChatMessageModel.create({ rfxId, role: "user", text: message });

  const priorMessages = await ChatMessageModel.find({ rfxId }).sort({ createdAt: 1 }).lean();
  const history = priorMessages.map((m) => ({ role: m.role as "user" | "model", text: m.text }));

  const comparisonData = await getComparisonData(rfxId);

  // Every persisted user message must end up paired with a model reply —
  // otherwise a failed call (rate limit, transient API error) leaves a
  // dangling question in the DB-authoritative history, which then confuses
  // both a reloaded UI and the next turn's context. So a failure here still
  // gets a real (persisted) reply, just one that says what happened.
  let text: string;
  let toolCalls: Awaited<ReturnType<typeof runAgentTurn>>["toolCalls"] = [];
  try {
    const result = await runAgentTurn({
      model: MODELS.chat,
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: CHAT_TOOLS.map((t) => t.declaration),
      history,
      executeTool: async (name, args) => executeChatTool(comparisonData, name, args) as unknown as Record<string, unknown>,
    });
    text = result.text;
    toolCalls = result.toolCalls;
  } catch (err) {
    console.error("Chat agent turn failed:", err);
    text = "I hit an error reaching the model just now (possibly a rate limit) — please try that again in a moment.";
  }

  const saved = await ChatMessageModel.create({ rfxId, role: "model", text, toolCalls });

  return NextResponse.json({
    id: String(saved._id),
    text,
    toolCalls,
  });
}
