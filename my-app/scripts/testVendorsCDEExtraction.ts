// Proves extraction against the real seeded vendor C (docx prose,
// per-carton ambiguity), D (angled photo, bundled + one illegible line),
// and E (plain text email, partial + unsolicited lane) documents.
// Run with: npm run test:vendors-cde-extraction

import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { parseDocxToText } from "../lib/files/parseDocx";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { resolveChargeKey } from "../lib/ai/extraction/extractRatesChunk";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";
import { BASE_RATES } from "../lib/fixtures/vendorDataset/rateModel";
import { VENDOR_C_MARKUP, UNITS_PER_CARTON } from "../lib/fixtures/vendorDataset/generateVendorC";
import { VENDOR_D_ILLEGIBLE_LANE_INDEX } from "../lib/fixtures/vendorDataset/generateVendorD";
import { VENDOR_E_QUOTED_LANE_INDICES } from "../lib/fixtures/vendorDataset/generateVendorE";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getRatesSubmission(code: string) {
  const vendor = await VendorModel.findOne({ code });
  if (!vendor) throw new Error(`Vendor ${code} not found`);
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "rates" });
  if (!submission) throw new Error(`Vendor ${code} rates submission not found`);
  return submission;
}

async function testVendorC() {
  console.log("\n=== Vendor C (docx prose, per-carton ambiguity) ===");
  const submission = await getRatesSubmission("C");
  const buffer = await fetchBlob(submission.blobUrl);
  const text = await parseDocxToText(buffer);

  const outcome = await extractRatesForDocument({ kind: "text", text }, CANONICAL_LANES);
  console.log(`documentStructure=${outcome.documentStructure}, lanes resolved=${outcome.laneResultsByIndex.size}/30`);

  let freightOk = 0;
  let cartonNoteFound = 0;
  for (const lane of CANONICAL_LANES) {
    const lr = outcome.laneResultsByIndex.get(lane.laneIndex);
    if (!lr) continue;
    const freight = lr.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "freight_charge");
    const loading = lr.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "loading_charge");
    const expectedFreight = BASE_RATES[lane.laneIndex].freightPerKg * VENDOR_C_MARKUP;
    if (freight && Math.abs(Number(freight.value) - expectedFreight) < 0.1) freightOk++;
    if (loading?.unitDefinitionNote.toLowerCase().includes(String(UNITS_PER_CARTON))) cartonNoteFound++;
  }
  console.log(`Freight accuracy (within 0.1): ${freightOk}/${outcome.laneResultsByIndex.size}`);
  console.log(`Loading charges carrying the "1 carton = 20 units" note: ${cartonNoteFound}/${outcome.laneResultsByIndex.size}`);

  const sample = outcome.laneResultsByIndex.get(0);
  const sampleLoading = sample?.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "loading_charge");
  console.log(`Sample (lane 0, Mumbai->Pune) loading charge: value=${sampleLoading?.value}, unitNote="${sampleLoading?.unitDefinitionNote}"`);
}

async function testVendorD() {
  console.log("\n=== Vendor D (angled photo, bundled all-in, one illegible line) ===");
  const submission = await getRatesSubmission("D");
  const buffer = await fetchBlob(submission.blobUrl);

  const outcome = await extractRatesForDocument({ kind: "file", buffer, mimeType: "image/jpeg" }, CANONICAL_LANES);
  console.log(`documentStructure=${outcome.documentStructure}, lanes resolved=${outcome.laneResultsByIndex.size}/30`);

  const illegibleLane = outcome.laneResultsByIndex.get(VENDOR_D_ILLEGIBLE_LANE_INDEX);
  console.log(`Lane ${VENDOR_D_ILLEGIBLE_LANE_INDEX} (should be unreadable): unreadable=${illegibleLane?.unreadable}, foundInDocument=${illegibleLane?.foundInDocument}`);

  let bundledCount = 0;
  let readableWithValue = 0;
  for (const [idx, lr] of outcome.laneResultsByIndex) {
    if (idx === VENDOR_D_ILLEGIBLE_LANE_INDEX) continue;
    if (lr.bundledAllIn) bundledCount++;
    if (lr.charges.length > 0) readableWithValue++;
  }
  console.log(`Other lanes: ${bundledCount} marked bundledAllIn, ${readableWithValue} have a charge value (out of ${outcome.laneResultsByIndex.size - 1})`);
}

async function testVendorE() {
  console.log("\n=== Vendor E (plain text email, partial + unsolicited lane) ===");
  const submission = await getRatesSubmission("E");
  const buffer = await fetchBlob(submission.blobUrl);
  const text = buffer.toString("utf-8");

  const outcome = await extractRatesForDocument({ kind: "text", text }, CANONICAL_LANES);
  console.log(`documentStructure=${outcome.documentStructure}, lanes resolved=${outcome.laneResultsByIndex.size}/30 (expected: ${VENDOR_E_QUOTED_LANE_INDICES.length})`);
  console.log(`Resolved lane indices: ${Array.from(outcome.laneResultsByIndex.keys()).sort((a, b) => a - b).join(", ")}`);
  console.log(`Expected lane indices: ${VENDOR_E_QUOTED_LANE_INDICES.join(", ")}`);
  console.log(`Unsolicited lanes reported: ${outcome.unsolicitedLanes.map((u) => u.description).join(" | ")}`);

  for (const idx of VENDOR_E_QUOTED_LANE_INDICES) {
    const lr = outcome.laneResultsByIndex.get(idx);
    const freight = lr?.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "freight_charge");
    const expected = BASE_RATES[idx].freightPerKg;
    const match = freight && Math.abs(Number(freight.value) - expected) < 0.05;
    console.log(`  Lane ${idx}: extracted=${freight?.value ?? "MISSING"} expected=${expected} ${match ? "OK" : "MISMATCH"}`);
  }
}

async function main() {
  await connectToDatabase();
  await testVendorC();
  await testVendorD();
  await testVendorE();
  process.exit(0);
}

main().catch((err) => {
  console.error("Vendors C/D/E extraction test failed:", err);
  process.exit(1);
});
