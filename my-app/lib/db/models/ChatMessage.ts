import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

// Analyst chat history (§9 of the functional plan), persisted so a reload
// or a later session picks up the same conversation — the DB is the source
// of truth for what the agent "remembers," not client-side React state.
export const CHAT_ROLES = ["user", "model"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

const ChatMessageSchema = new Schema(
  {
    rfxId: { type: Schema.Types.ObjectId, ref: "Rfx", required: true },
    role: { type: String, enum: CHAT_ROLES, required: true },
    text: { type: String, required: true },
    // The {name, args, result, displayHint} trace behind a "model" message —
    // lets a reloaded conversation re-render the same table/chart a live
    // turn would have shown, not just the prose. Null for "user" messages.
    toolCalls: { type: Schema.Types.Mixed, default: null },
    // RequestTimer.toJSON() for this turn — {totalMs, marks[]}. Persisted
    // (not just console-logged) so response-time evidence survives past the
    // dev server's stdout, for demoing/reviewing later. Null for "user"
    // messages and for a turn that errored before a timer snapshot existed.
    timings: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

ChatMessageSchema.index({ rfxId: 1, createdAt: 1 });

export type ChatMessage = InferSchemaType<typeof ChatMessageSchema> & { _id: Types.ObjectId };

export const ChatMessageModel = models.ChatMessage || model("ChatMessage", ChatMessageSchema);
