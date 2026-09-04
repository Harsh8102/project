import { Schema, model, models, type InferSchemaType } from "mongoose";

const RfxSchema = new Schema(
  {
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "active", "awarded"],
      default: "draft",
    },
    // Downloadable buyer-side artifacts (§4.1 of the functional plan) —
    // generated once via lib/files/generateTemplates.ts and stored in Blob.
    laneListBlobUrl: { type: String, default: null },
    questionnaireTemplateBlobUrl: { type: String, default: null },
    termsTemplateBlobUrl: { type: String, default: null },
    // RFx-wide fallback for charges that need a real-world reference value
    // to resolve (per_unit needs a unit count, pct_of_invoice_value needs a
    // declared value) that nothing in the submitted documents provides —
    // see docs/charge-normalization-unit-economics.md. Deliberately absent
    // (null) by default: a buyer opts into resolving these, they aren't
    // silently assumed. A specific lane's own costAssumptionOverrides (see
    // Lane.ts) takes precedence over this when both are set.
    costAssumptionDefaults: {
      avgWeightPerUnitKg: { type: Number, default: null },
      referenceInvoiceValueInr: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

export type Rfx = InferSchemaType<typeof RfxSchema>;

export const RfxModel = models.Rfx || model("Rfx", RfxSchema);
