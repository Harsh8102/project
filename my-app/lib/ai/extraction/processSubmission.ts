// The real extraction pipeline for one vendor submission — Gemini extracts,
// deterministic code normalizes and writes ExtractedField rows. Originally
// lived only in scripts/runFullExtraction.ts; pulled out here so the batch
// script and the live upload-and-process API route
// (app/api/submissions/[id]/process/route.ts) share one implementation,
// never two copies that can drift apart.

import { VendorSubmissionModel } from "../../db/models/VendorSubmission";
import { parseXlsx, xlsxToPromptText } from "../../files/parseXlsx";
import { parseDocxToText } from "../../files/parseDocx";
import { extractQuestionnaire } from "./extractQuestionnaire";
import { extractTerms } from "./extractTerms";
import { extractRatesForDocument } from "./extractRatesForDocument";
import { resolveRegionMatrixToLanes } from "./resolveRegionMatrix";
import { normalizeCharge } from "./normalizeCharge";
import { convertToInr } from "../../normalization/currency";
import { writeExtractedFields, type ExtractedFieldInput } from "../../db/writeExtractedFields";
import type { DocumentInput } from "./extractRatesChunk";
import type { FormFieldExtractionResult } from "./formFieldExtraction";
import { CANONICAL_LANES, type CanonicalLane } from "../../fixtures/canonicalLanes";

const CONTENT_TYPE_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  image: "image/jpeg",
};

export async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function buildDocumentInput(fileType: string, buffer: Buffer): Promise<DocumentInput> {
  if (fileType === "xlsx") {
    const parsed = await parseXlsx(buffer);
    return { kind: "text", text: xlsxToPromptText(parsed) };
  }
  if (fileType === "docx") {
    return { kind: "text", text: await parseDocxToText(buffer) };
  }
  if (fileType === "text") {
    return { kind: "text", text: buffer.toString("utf-8") };
  }
  return { kind: "file", buffer, mimeType: CONTENT_TYPE_TO_MIME[fileType] ?? "application/octet-stream" };
}

function formResultToFieldInput(r: FormFieldExtractionResult): ExtractedFieldInput {
  return {
    laneId: null,
    fieldKey: r.fieldKey,
    rawHeaderLabel: null,
    rawValue: r.rawValue,
    normalizedValue: r.normalizedValue,
    unit: null,
    basis: null,
    currency: null,
    confidence: r.confidence,
    sourceSnippet: r.sourceSnippet,
    flagType: r.flagType,
    flagNote: r.flagType ? `Extraction confidence ${r.confidence.toFixed(2)}` : null,
  };
}

export type ProcessResult = { fieldsWritten: number; fieldsFlagged: number; status: "done" | "needs_review" };

export async function processFormSubmission(
  rfxId: string,
  vendorId: string,
  section: "questionnaire" | "terms",
  submission: { _id: unknown; blobUrl: string; fileType: string }
): Promise<ProcessResult> {
  const buffer = await fetchBlob(submission.blobUrl);
  const document = await buildDocumentInput(submission.fileType, buffer);
  const results = section === "questionnaire" ? await extractQuestionnaire(document) : await extractTerms(document);

  const records = results.map(formResultToFieldInput);
  await writeExtractedFields({ rfxId, vendorId, submissionId: String(submission._id), domain: section, records });

  const fieldsFlagged = records.filter((r) => r.flagType).length;
  const status = fieldsFlagged > 0 ? "needs_review" : "done";
  await VendorSubmissionModel.updateOne({ _id: submission._id }, { $set: { status } });
  return { fieldsWritten: records.length, fieldsFlagged, status };
}

export async function processRatesSubmission(
  rfxId: string,
  vendorId: string,
  submission: { _id: unknown; blobUrl: string; fileType: string },
  laneIdByIndex: Map<number, string>,
  options: { onProgress?: (chunksDone: number, chunksTotal: number) => void; lanes?: CanonicalLane[] } = {}
): Promise<ProcessResult> {
  const lanes = options.lanes ?? CANONICAL_LANES;
  const buffer = await fetchBlob(submission.blobUrl);
  const document = await buildDocumentInput(submission.fileType, buffer);

  const source = submission.fileType === "xlsx" ? { kind: "xlsx" as const, parsedXlsx: await parseXlsx(buffer) } : document;
  const outcome = await extractRatesForDocument(source, lanes, { onProgress: options.onProgress });

  const records: ExtractedFieldInput[] = [];

  if (outcome.documentStructure === "region_matrix" && outcome.regionMatrix) {
    const resolved = resolveRegionMatrixToLanes(outcome.regionMatrix, lanes);
    for (const r of resolved) {
      const laneId = laneIdByIndex.get(r.laneIndex) ?? null;
      if (r.status === "resolved") {
        for (const c of r.charges) {
          records.push({
            laneId,
            fieldKey: c.fieldKey,
            rawHeaderLabel: c.rawHeaderLabel,
            rawValue: c.rawValue,
            normalizedValue: (() => {
              const n = Number(c.rawValue);
              if (!Number.isFinite(n)) return null;
              return c.currency === "USD" ? convertToInr(n, "USD").valueInr : n;
            })(),
            unit: c.basis,
            basis: c.basis,
            currency: c.currency === "USD" ? "INR" : c.currency,
            confidence: c.confidence,
            sourceSnippet: { type: "quote", quote: c.sourceQuote },
            flagType: c.currency === "USD" ? "currency_converted" : c.fieldKey ? null : "unmapped_header",
            flagNote: c.currency === "USD" ? `Converted from USD ${c.rawValue} at a fixed rate` : null,
          });
        }
      } else {
        records.push({
          laneId,
          fieldKey: null,
          rawHeaderLabel: null,
          rawValue: "",
          normalizedValue: null,
          unit: null,
          basis: null,
          currency: null,
          confidence: 1,
          sourceSnippet: { type: "quote", quote: r.reason },
          flagType: "lane_not_quoted",
          flagNote: r.reason,
        });
      }
    }
  } else {
    for (const lane of lanes) {
      const laneId = laneIdByIndex.get(lane.laneIndex) ?? null;
      const lr = outcome.laneResultsByIndex.get(lane.laneIndex);

      if (!lr || !lr.foundInDocument) {
        records.push({
          laneId,
          fieldKey: null,
          rawHeaderLabel: null,
          rawValue: "",
          normalizedValue: null,
          unit: null,
          basis: null,
          currency: null,
          confidence: 1,
          sourceSnippet: { type: "quote", quote: "" },
          flagType: "lane_not_quoted",
          flagNote: "Not quoted in this vendor's submission",
        });
        continue;
      }

      if (lr.unreadable) {
        records.push({
          laneId,
          fieldKey: null,
          rawHeaderLabel: null,
          rawValue: "",
          normalizedValue: null,
          unit: null,
          basis: null,
          currency: null,
          confidence: 0,
          sourceSnippet: { type: "quote", quote: "" },
          flagType: "unreadable",
          flagNote: "Present in the document but not legible",
        });
        continue;
      }

      for (const c of lr.charges) {
        const normalized = normalizeCharge(c);
        records.push({
          laneId,
          fieldKey: normalized.fieldKey,
          rawHeaderLabel: normalized.rawHeaderLabel,
          rawValue: normalized.rawValue,
          normalizedValue: normalized.normalizedValue,
          unit: normalized.unit,
          basis: normalized.basis,
          currency: normalized.currency,
          confidence: normalized.confidence,
          sourceSnippet: { type: "quote", quote: normalized.sourceQuote },
          flagType: lr.bundledAllIn ? "bundled_all_in" : normalized.flagType,
          flagNote: lr.bundledAllIn ? "Bundled all-in rate, no component breakdown" : normalized.flagNote,
        });
      }
    }

    for (const u of outcome.unsolicitedLanes) {
      records.push({
        laneId: null,
        fieldKey: "freight_charge",
        rawHeaderLabel: null,
        rawValue: u.description,
        normalizedValue: null,
        unit: null,
        basis: null,
        currency: null,
        confidence: 1,
        sourceSnippet: { type: "quote", quote: u.description },
        flagType: "unsolicited_lane",
        flagNote: `Quoted but not on the RFx's canonical lane list: ${u.description}`,
      });
    }
  }

  await writeExtractedFields({ rfxId, vendorId, submissionId: String(submission._id), domain: "charges", records });
  const fieldsFlagged = records.filter((r) => r.flagType).length;
  const status = fieldsFlagged > 0 ? "needs_review" : "done";
  await VendorSubmissionModel.updateOne({ _id: submission._id }, { $set: { status } });
  return { fieldsWritten: records.length, fieldsFlagged, status };
}
