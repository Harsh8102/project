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
    // Per-lane overrides for the buyer's cost-comparison assumptions — set
    // when analyzing THIS lane specifically (Lane Detail's sliders), so
    // exploring one lane never silently changes another's numbers. Each
    // field falls back to the RFx-wide default (Rfx.costAssumptionDefaults)
    // when unset, and referenceWeightKg additionally falls back to this
    // lane's own weightBand midpoint (the existing, already-live default).
    costAssumptionOverrides: {
      referenceWeightKg: { type: Number, default: null },
      avgWeightPerUnitKg: { type: Number, default: null },
      referenceInvoiceValueInr: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

LaneSchema.index({ rfxId: 1, laneIndex: 1 }, { unique: true });

export type Lane = InferSchemaType<typeof LaneSchema> & { _id: Types.ObjectId };

export const LaneModel = models.Lane || model("Lane", LaneSchema);
