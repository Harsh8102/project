// The real production extraction run: for every vendor submission (rates,
// questionnaire, terms), extracts via Gemini, normalizes deterministically,
// and writes actual ExtractedField documents to MongoDB — not a test
// script diffing against fixtures, the real pipeline end to end.
// Run with: npm run extract:all

import { connectToDatabase } from "../lib/db/connect";
import { RfxModel } from "../lib/db/models/Rfx";
import { VendorModel } from "../lib/db/models/Vendor";
import { LaneModel } from "../lib/db/models/Lane";
import { VendorSubmissionModel, type SubmissionSection } from "../lib/db/models/VendorSubmission";
import { parseXlsx, xlsxToPromptText } from "../lib/files/parseXlsx";
import { parseDocxToText } from "../lib/files/parseDocx";
import { extractQuestionnaire } from "../lib/ai/extraction/extractQuestionnaire";
import { extractTerms } from "../lib/ai/extraction/extractTerms";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { resolveRegionMatrixToLanes } from "../lib/ai/extraction/resolveRegionMatrix";
import { normalizeCharge } from "../lib/ai/extraction/normalizeCharge";
import { convertToInr } from "../lib/normalization/currency";
import { writeExtractedFields, type ExtractedFieldInput } from "../lib/db/writeExtractedFields";
import type { DocumentInput } from "../lib/ai/extraction/extractRatesChunk";
import type { FormFieldExtractionResult } from "../lib/ai/extraction/formFieldExtraction";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";

const CONTENT_TYPE_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  image: "image/jpeg",
};

// Resumable by default — a submission already marked done/needs_review is
// skipped so re-running after a mid-batch failure doesn't re-spend quota
// on vendors that already succeeded. Pass --force to re-extract everything.
const FORCE_REEXTRACT = process.argv.includes("--force");

async function fetchBlob(url: string): Promise<Buffer> {
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

async function processQuestionnaireOrTerms(
  rfxId: string,
  vendorId: string,
  section: "questionnaire" | "terms",
  submission: { _id: unknown; blobUrl: string; fileType: string }
) {
  const buffer = await fetchBlob(submission.blobUrl);
  const document = await buildDocumentInput(submission.fileType, buffer);
  const results = section === "questionnaire" ? await extractQuestionnaire(document) : await extractTerms(document);

  const records = results.map(formResultToFieldInput);
  await writeExtractedFields({ rfxId, vendorId, submissionId: String(submission._id), domain: section, records });

  const hasFlags = records.some((r) => r.flagType);
  await VendorSubmissionModel.updateOne({ _id: submission._id }, { $set: { status: hasFlags ? "needs_review" : "done" } });
  console.log(`  ${section}: ${records.length} fields written (${records.filter((r) => r.flagType).length} flagged)`);
}

async function processRates(
  rfxId: string,
  vendorId: string,
  submission: { _id: unknown; blobUrl: string; fileType: string },
  laneIdByIndex: Map<number, string>
) {
  const buffer = await fetchBlob(submission.blobUrl);
  const document = await buildDocumentInput(submission.fileType, buffer);

  const source = submission.fileType === "xlsx" ? { kind: "xlsx" as const, parsedXlsx: await parseXlsx(buffer) } : document;
  const outcome = await extractRatesForDocument(source, CANONICAL_LANES);

  const records: ExtractedFieldInput[] = [];

  if (outcome.documentStructure === "region_matrix" && outcome.regionMatrix) {
    const resolved = resolveRegionMatrixToLanes(outcome.regionMatrix, CANONICAL_LANES);
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
    for (const lane of CANONICAL_LANES) {
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
  const hasFlags = records.some((r) => r.flagType);
  await VendorSubmissionModel.updateOne({ _id: submission._id }, { $set: { status: hasFlags ? "needs_review" : "done" } });
  console.log(`  rates: ${records.length} fields written (${records.filter((r) => r.flagType).length} flagged), structure=${outcome.documentStructure}`);
}

async function main() {
  await connectToDatabase();
  const rfx = await RfxModel.findOne().sort({ createdAt: -1 });
  if (!rfx) throw new Error("No RFx found");
  const rfxId = rfx._id.toString();

  const lanes = await LaneModel.find({ rfxId: rfx._id });
  const laneIdByIndex = new Map(lanes.map((l) => [l.laneIndex, l._id.toString()]));

  const vendorFilterArg = process.argv.find((a) => a.startsWith("--vendor="));
  const vendorFilter = vendorFilterArg ? vendorFilterArg.split("=")[1] : null;
  const sectionFilterArg = process.argv.find((a) => a.startsWith("--section="));
  const sectionFilter = sectionFilterArg ? (sectionFilterArg.split("=")[1] as SubmissionSection) : null;

  const vendors = await VendorModel.find(vendorFilter ? { code: vendorFilter } : {}).sort({ code: 1 });
  const sections: SubmissionSection[] = sectionFilter ? [sectionFilter] : ["rates", "questionnaire", "terms"];

  for (const vendor of vendors) {
    console.log(`\nVendor ${vendor.code} (${vendor.name})`);
    const vendorId = vendor._id.toString();

    for (const section of sections) {
      const submission = await VendorSubmissionModel.findOne({ rfxId: rfx._id, vendorId: vendor._id, section });
      if (!submission) {
        console.log(`  ${section}: not submitted — skipping`);
        continue;
      }
      if (!FORCE_REEXTRACT && (submission.status === "done" || submission.status === "needs_review")) {
        console.log(`  ${section}: already processed (status=${submission.status}) — skipping. Pass --force to re-run.`);
        continue;
      }
      if (section === "rates") {
        await processRates(rfxId, vendorId, submission, laneIdByIndex);
      } else {
        await processQuestionnaireOrTerms(rfxId, vendorId, section, submission);
      }
    }
  }

  console.log("\nFull extraction run complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Full extraction run failed:", err);
  process.exit(1);
});
