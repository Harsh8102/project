import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

const LaneSchema = new Schema(
  {
    rfxId: { type: Schema.Types.ObjectId, ref: "Rfx", required: true },
    // Fixed 0-29 order for the canonical 30-lane list — extraction chunking
    // batches lanes by this index (see lib/ai/extraction).
    laneIndex: { type: Number, required: true },
    originCity: { type: String, required: true },
    originState: { type: String, required: true },
    destCity: { type: String, required: true },
    destState: { type: String, required: true },
    expectedVolumeKgPerMonth: { type: Number, required: true },
    weightBand: { type: String, required: true },
  },
  { timestamps: true }
);

LaneSchema.index({ rfxId: 1, laneIndex: 1 }, { unique: true });

export type Lane = InferSchemaType<typeof LaneSchema> & { _id: Types.ObjectId };

export const LaneModel = models.Lane || model("Lane", LaneSchema);
