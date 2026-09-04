import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

// Matches the chat agent's query_data({ domain }) enum (§5.2 of the
// architecture plan) — "rates" documents produce "charges" domain fields.
export const FIELD_DOMAINS = ["charges", "questionnaire", "terms"] as const;
export type FieldDomain = (typeof FIELD_DOMAINS)[number];

// "Flag, don't guess" states — every ambiguity in the edge-case matrix
// (§5 of the functional plan) resolves to one of these, never a silent value.
export const FLAG_TYPES = [
  "unreadable", // illegible photo / scan (edge case #5)
  "unmapped_header", // header didn't match the canonical charge taxonomy (§5.1a)
  "basis_mismatch", // unit/charge-basis ambiguity, e.g. "per box" meaning differs (edge case #6)
  "bundled_all_in", // vendor gave one number, no component breakdown (edge case #7)
  "wrong_format", // required xlsx submitted as pdf/etc (edge case #9)
  "gate_failure", // mandatory questionnaire/terms field missing or failing (edge case #10)
  "missing_document", // whole section not submitted (edge case #11)
  "currency_converted", // value was FX-converted from a non-INR quote (edge case #12)
  "unsolicited_lane", // lane quoted but not on the RFx's canonical list (edge case #2)
  "low_confidence", // extraction confidence below the review threshold
  "lane_not_quoted", // vendor's document doesn't cover this lane at all — partial coverage (edge case #1) or a region/city gap (edge cases #13/#14)
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];

const SourceSnippetSchema = new Schema(
  {
    type: { type: String, enum: ["cell", "page", "quote"], required: true },
    cellRef: { type: String, default: null }, // e.g. "B12" for xlsx sources
    page: { type: Number, default: null }, // for PDF/image sources
    quote: { type: String, default: null }, // verbatim excerpt (prose/email sources, or a caption for page/cell)
  },
  { _id: false }
);

const ExtractedFieldSchema = new Schema(
  {
    submissionId: { type: Schema.Types.ObjectId, ref: "VendorSubmission", required: true },
    // Denormalized for the chat agent's query_data tool — avoids a $lookup
    // on every filter/aggregate call.
    rfxId: { type: Schema.Types.ObjectId, ref: "Rfx", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    domain: { type: String, enum: FIELD_DOMAINS, required: true },
    laneId: { type: Schema.Types.ObjectId, ref: "Lane", default: null }, // null for questionnaire/terms fields

    fieldKey: { type: String, required: true }, // canonical key, e.g. "freight_charge", "gps_enabled"
    rawHeaderLabel: { type: String, default: null }, // vendor's own wording, kept for auditability (§5.1a)

    // Verbatim as extracted — deliberately NOT required: a flag-only record
    // (lane_not_quoted, unreadable) has no raw value by definition, and
    // that's a legitimate first-class state, not a data-entry omission.
    rawValue: { type: String, default: "" },
    normalizedValue: { type: Schema.Types.Mixed, default: null }, // number | string | boolean after deterministic normalization

    unit: { type: String, default: null },
    basis: { type: String, default: null }, // flat | per_kg | per_unit | slab_on_weight | pct_of_freight | ...
    currency: { type: String, enum: ["INR", "USD", null], default: null },

    confidence: { type: Number, required: true, min: 0, max: 1 },
    sourceSnippet: { type: SourceSnippetSchema, required: true },

    flagType: { type: String, enum: [...FLAG_TYPES, null], default: null },
    flagNote: { type: String, default: null },

    // Set when a buyer corrects a mapping in the Review Queue — takes
    // precedence over `fieldKey` everywhere this record is read.
    manualOverrideFieldKey: { type: String, default: null },

    // Append-only versioning (§7 trust section) — re-extraction never
    // overwrites; `isLatest` is what every read path filters on.
    version: { type: Number, default: 1 },
    isLatest: { type: Boolean, default: true },

    extractedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ExtractedFieldSchema.index({ rfxId: 1, vendorId: 1, domain: 1, isLatest: 1 });
ExtractedFieldSchema.index({ submissionId: 1, isLatest: 1 });
ExtractedFieldSchema.index({ laneId: 1, isLatest: 1 });

export type ExtractedField = InferSchemaType<typeof ExtractedFieldSchema> & {
  _id: Types.ObjectId;
};

export const ExtractedFieldModel =
  models.ExtractedField || model("ExtractedField", ExtractedFieldSchema);
