import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

const DecisionRecordSchema = new Schema(
  {
    rfxId: { type: Schema.Types.ObjectId, ref: "Rfx", required: true },
    laneId: { type: Schema.Types.ObjectId, ref: "Lane", default: null }, // null = whole-RFx award
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    awardedAt: { type: Date, default: Date.now },
    // Frozen copy of the scores/flags that were on screen at award time
    // (§7 trust section) — stays defensible even if data is re-extracted later.
    justificationSnapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export type DecisionRecord = InferSchemaType<typeof DecisionRecordSchema> & {
  _id: Types.ObjectId;
};

export const DecisionRecordModel =
  models.DecisionRecord || model("DecisionRecord", DecisionRecordSchema);
