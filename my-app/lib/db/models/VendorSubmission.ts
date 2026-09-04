import { Schema, model, models, Types, type InferSchemaType } from "mongoose";

// "section" names the document the vendor was asked to submit. Extracted
// fields derived from a "rates" submission live under the "charges" domain —
// see ExtractedField's `domain` field and lib/ai/chat/tools.ts.
export const SUBMISSION_SECTIONS = ["rates", "questionnaire", "terms"] as const;
export type SubmissionSection = (typeof SUBMISSION_SECTIONS)[number];

export const SUBMISSION_STATUSES = [
  "uploaded",
  "processing",
  "done",
  "needs_review",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const VendorSubmissionSchema = new Schema(
  {
    rfxId: { type: Schema.Types.ObjectId, ref: "Rfx", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    section: { type: String, enum: SUBMISSION_SECTIONS, required: true },
    blobUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, required: true }, // e.g. 'xlsx' | 'pdf' | 'docx' | 'image' | 'text'
    status: { type: String, enum: SUBMISSION_STATUSES, default: "uploaded" },

    // Drives the chunked-extraction progress loop (§6.1 of the architecture plan).
    chunksTotal: { type: Number, default: 1 },
    chunksDone: { type: Number, default: 0 },
    nextChunkIndex: { type: Number, default: 0 },

    // Wrong-format detection (edge case #9): true when this section's file
    // type doesn't match the required format for that section.
    formatViolation: { type: Boolean, default: false },

    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

VendorSubmissionSchema.index({ rfxId: 1, vendorId: 1, section: 1 }, { unique: true });

export type VendorSubmission = InferSchemaType<typeof VendorSubmissionSchema> & {
  _id: Types.ObjectId;
};

export const VendorSubmissionModel =
  models.VendorSubmission || model("VendorSubmission", VendorSubmissionSchema);
