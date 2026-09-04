// The real production extraction run: for every vendor submission (rates,
// questionnaire, terms), extracts via Gemini, normalizes deterministically,
// and writes actual ExtractedField documents to MongoDB — not a test
// script diffing against fixtures, the real pipeline end to end.
// Run with: npm run extract:all
//
// The actual extraction logic lives in lib/ai/extraction/processSubmission.ts,
// shared with the live upload-and-process API route — this script is just
// the batch driver over every submission in the RFx.

import { connectToDatabase } from "../lib/db/connect";
import { RfxModel } from "../lib/db/models/Rfx";
import { VendorModel } from "../lib/db/models/Vendor";
import { LaneModel } from "../lib/db/models/Lane";
import { VendorSubmissionModel, type SubmissionSection } from "../lib/db/models/VendorSubmission";
import { processFormSubmission, processRatesSubmission } from "../lib/ai/extraction/processSubmission";

// Resumable by default — a submission already marked done/needs_review is
// skipped so re-running after a mid-batch failure doesn't re-spend quota
// on vendors that already succeeded. Pass --force to re-extract everything.
const FORCE_REEXTRACT = process.argv.includes("--force");

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

      const result =
        section === "rates"
          ? await processRatesSubmission(rfxId, vendorId, submission, laneIdByIndex, {
              onProgress: (done, total) => console.log(`  rates: chunk ${done}/${total}`),
            })
          : await processFormSubmission(rfxId, vendorId, section, submission);

      console.log(`  ${section}: ${result.fieldsWritten} fields written (${result.fieldsFlagged} flagged), status=${result.status}`);
    }
  }

  console.log("\nFull extraction run complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Full extraction run failed:", err);
  process.exit(1);
});
