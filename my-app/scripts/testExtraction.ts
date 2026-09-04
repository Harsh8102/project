// Proves questionnaire/terms extraction against the REAL seeded vendor
// documents (not a synthetic snippet) — fetches from Blob, parses xlsx,
// runs the actual Gemini extraction call, and diffs against the known
// fixture answers so accuracy is visible, not just "it ran without error."
// Run with: npm run test:extraction

import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { parseXlsx, xlsxToPromptText } from "../lib/files/parseXlsx";
import { extractQuestionnaire } from "../lib/ai/extraction/extractQuestionnaire";
import { extractTerms } from "../lib/ai/extraction/extractTerms";
import { VENDOR_A_QUESTIONNAIRE_ANSWERS, VENDOR_A_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorA";
import { VENDOR_B_QUESTIONNAIRE_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorB";
import { VENDOR_D_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorD";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function testQuestionnaire(vendorCode: string, expected: Record<string, unknown>) {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: vendorCode });
  if (!vendor) throw new Error(`Vendor ${vendorCode} not found`);
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "questionnaire" });
  if (!submission) {
    console.log(`\n=== Vendor ${vendorCode} questionnaire: NOT SUBMITTED (expected — nothing to extract) ===`);
    return;
  }

  const buffer = await fetchBlob(submission.blobUrl);
  const parsed = await parseXlsx(buffer);
  const text = xlsxToPromptText(parsed);

  const results = await extractQuestionnaire({ kind: "text", text });

  console.log(`\n=== Vendor ${vendorCode} questionnaire extraction ===`);
  let correct = 0;
  let total = 0;
  for (const r of results) {
    const expectedValue = expected[r.fieldKey];
    const expectedHasValue = expectedValue !== undefined;
    total++;
    const match = expectedHasValue
      ? String(r.normalizedValue).toLowerCase() === String(expectedValue).toLowerCase()
      : !r.found;
    if (match) correct++;
    const flag = r.flagType ? ` [${r.flagType}]` : "";
    const mismatch = match ? "" : "  <-- MISMATCH";
    console.log(
      `  ${r.fieldKey}: extracted=${r.found ? r.normalizedValue : "NOT FOUND"} (conf ${r.confidence.toFixed(2)})${flag} | expected=${expectedHasValue ? expectedValue : "(not in fixture / informational)"}${mismatch}`
    );
  }
  console.log(`  Accuracy: ${correct}/${total} fields matched expectation`);
}

async function testTerms(vendorCode: string, expected: Record<string, unknown>) {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: vendorCode });
  if (!vendor) throw new Error(`Vendor ${vendorCode} not found`);
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "terms" });
  if (!submission) throw new Error(`Vendor ${vendorCode} terms submission not found`);

  if (submission.fileType !== "xlsx") {
    console.log(`\n=== Vendor ${vendorCode} terms: skipped (${submission.fileType}, xlsx parser only — PDF/image path comes with rates extraction) ===`);
    return;
  }

  const buffer = await fetchBlob(submission.blobUrl);
  const parsed = await parseXlsx(buffer);
  const text = xlsxToPromptText(parsed);
  const results = await extractTerms({ kind: "text", text });

  console.log(`\n=== Vendor ${vendorCode} terms extraction ===`);
  let correct = 0;
  let total = 0;
  for (const r of results) {
    const expectedValue = expected[r.fieldKey];
    const expectedHasValue = expectedValue !== undefined;
    total++;
    const match = expectedHasValue
      ? String(r.normalizedValue).toLowerCase() === String(expectedValue).toLowerCase()
      : !r.found;
    if (match) correct++;
    const mismatch = match ? "" : "  <-- MISMATCH";
    console.log(
      `  ${r.fieldKey}: extracted=${r.found ? r.normalizedValue : "NOT FOUND"} (conf ${r.confidence.toFixed(2)}) | expected=${expectedHasValue ? expectedValue : "(informational)"}${mismatch}`
    );
  }
  console.log(`  Accuracy: ${correct}/${total} fields matched expectation`);
}

async function main() {
  await testQuestionnaire("A", VENDOR_A_QUESTIONNAIRE_ANSWERS);
  await testQuestionnaire("B", VENDOR_B_QUESTIONNAIRE_ANSWERS); // should show under_investigation/outstanding_legal_issues as NOT FOUND
  await testTerms("A", VENDOR_A_TERMS_ANSWERS);
  await testTerms("D", VENDOR_D_TERMS_ANSWERS);

  process.exit(0);
}

main().catch((err) => {
  console.error("Extraction test failed:", err);
  process.exit(1);
});
