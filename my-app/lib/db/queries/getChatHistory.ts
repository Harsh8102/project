import { connectToDatabase } from "../connect";
import { ChatMessageModel, type ChatRole } from "../models/ChatMessage";

export type ToolCallTrace = {
  name: string;
  args: Record<string, unknown>;
  result: { summary: string; data: unknown; displayHint: "table" | "chart" | "none" };
};

export type ChatMessageSummary = {
  id: string;
  role: ChatRole;
  text: string;
  toolCalls: ToolCallTrace[] | null;
};

export async function getChatHistory(rfxId: string): Promise<ChatMessageSummary[]> {
  await connectToDatabase();
  const docs = await ChatMessageModel.find({ rfxId }).sort({ createdAt: 1 }).lean();
  return docs.map((d) => ({
    id: String(d._id),
    role: d.role as ChatRole,
    text: d.text,
    toolCalls: (d.toolCalls as ToolCallTrace[] | null) ?? null,
  }));
}
