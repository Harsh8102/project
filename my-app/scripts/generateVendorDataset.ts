// Generates and uploads the fabricated 5-vendor dataset (§4.2 of the
// functional plan), then registers each document as a VendorSubmission.
// Run with: npm run seed:vendors  (after npm run seed)
//
// This is step 2 of the build sequence. Extraction (step 4) hasn't been
// built yet, so submissions land with status "uploaded" — the chunk
// counters get their real values once the extraction pipeline exists.

import { connectToDatabase } from "../lib/db/connect";
import { RfxModel } from "../lib/db/models/Rfx";
import { VendorModel } from "../lib/db/models/Vendor";
import { VendorSubmissionModel, type SubmissionSection } from "../lib/db/models/VendorSubmission";
import { uploadToBlob } from "../lib/files/blob";
import { generateVendorADocuments } from "../lib/fixtures/vendorDataset/generateVendorA";
import { generateVendorBDocuments } from "../lib/fixtures/vendorDataset/generateVendorB";
import { generateVendorCDocuments } from "../lib/fixtures/vendorDataset/generateVendorC";
import { generateVendorDDocuments } from "../lib/fixtures/vendorDataset/generateVendorD";
import { generateVendorEDocuments } from "../lib/fixtures/vendorDataset/generateVendorE";

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  image: "image/jpeg",
  text: "text/plain",
};

// Rates are accepted in any format; questionnaire/terms must be xlsx
// (§2 scoping decision) — anything else is a format violation.
function isFormatViolation(section: SubmissionSection, fileType: string): boolean {
  if (section === "rates") return false;
  return fileType !== "xlsx";
}

async function registerSubmission(
  rfxId: string,
  vendorId: string,
  section: SubmissionSection,
  doc: { buffer: Buffer; fileName: string; fileType: string }
) {
  const pathname = `rfx/${rfxId}/vendors/${vendorId}/${section}/${doc.fileName}`;
  const blob = await uploadToBlob(pathname, doc.buffer, CONTENT_TYPES[doc.fileType]);

  await VendorSubmissionModel.findOneAndUpdate(
    { rfxId, vendorId, section },
    {
      rfxId,
      vendorId,
      section,
      blobUrl: blob.url,
      fileName: doc.fileName,
      fileType: doc.fileType,
      status: "uploaded",
      chunksTotal: 1,
      chunksDone: 0,
      nextChunkIndex: 0,
      formatViolation: isFormatViolation(section, doc.fileType),
      errorMessage: null,
    },
    { upsert: true }
  );
  console.log(`  ${section}: ${doc.fileName} -> ${blob.pathname}${isFormatViolation(section, doc.fileType) ? " [FORMAT VIOLATION]" : ""}`);
}

async function main() {
  await connectToDatabase();

  const rfx = await RfxModel.findOne({ status: { $in: ["active", "draft"] } }).sort({ createdAt: -1 });
  if (!rfx) throw new Error("No RFx found — run `npm run seed` first.");
  const rfxId = rfx._id.toString();

  const vendors = await VendorModel.find({});
  const byCode = new Map(vendors.map((v) => [v.code, v]));

  const A = byCode.get("A");
  const B = byCode.get("B");
  const C = byCode.get("C");
  const D = byCode.get("D");
  const E = byCode.get("E");
  if (!A || !B || !C || !D || !E) throw new Error("Vendors A-E not found — run `npm run seed` first.");

  console.log(`Generating vendor dataset for RFx ${rfxId}...\n`);

  console.log(`Vendor A (${A.name}) — happy path`);
  const a = await generateVendorADocuments();
  await registerSubmission(rfxId, A._id.toString(), "rates", a.rates);
  await registerSubmission(rfxId, A._id.toString(), "questionnaire", a.questionnaire);
  await registerSubmission(rfxId, A._id.toString(), "terms", a.terms);

  console.log(`\nVendor B (${B.name}) — USD PDF, partial coverage, missing gates`);
  const b = await generateVendorBDocuments();
  await registerSubmission(rfxId, B._id.toString(), "rates", b.rates);
  await registerSubmission(rfxId, B._id.toString(), "questionnaire", b.questionnaire);
  await registerSubmission(rfxId, B._id.toString(), "terms", b.terms);

  console.log(`\nVendor C (${C.name}) — prose docx, per-carton ambiguity, terms as PDF`);
  const c = await generateVendorCDocuments();
  await registerSubmission(rfxId, C._id.toString(), "rates", c.rates);
  await registerSubmission(rfxId, C._id.toString(), "questionnaire", c.questionnaire);
  await registerSubmission(rfxId, C._id.toString(), "terms", c.terms);

  console.log(`\nVendor D (${D.name}) — angled photo, bundled rate, illegible line`);
  const d = await generateVendorDDocuments();
  await registerSubmission(rfxId, D._id.toString(), "rates", d.rates);
  await registerSubmission(rfxId, D._id.toString(), "questionnaire", d.questionnaire);
  await registerSubmission(rfxId, D._id.toString(), "terms", d.terms);

  console.log(`\nVendor E (${E.name}) — plain text email, partial + unsolicited lane, no questionnaire`);
  const e = await generateVendorEDocuments();
  await registerSubmission(rfxId, E._id.toString(), "rates", e.rates);
  // No questionnaire submission for vendor E — deliberately absent (edge case #11).
  await registerSubmission(rfxId, E._id.toString(), "terms", e.terms);

  console.log("\nVendor dataset generation complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Vendor dataset generation failed:", err);
  process.exit(1);
});
