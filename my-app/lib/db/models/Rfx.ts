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
  },
  { timestamps: true }
);

export type Rfx = InferSchemaType<typeof RfxSchema>;

export const RfxModel = models.Rfx || model("Rfx", RfxSchema);
