// Vendor E only, isolated — C and D already passed; this avoids re-spending
// quota re-testing them. Run with: npm run test:vendor-e-extraction

import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { resolveChargeKey } from "../lib/ai/extraction/extractRatesChunk";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";
import { BASE_RATES } from "../lib/fixtures/vendorDataset/rateModel";
import { VENDOR_E_QUOTED_LANE_INDICES } from "../lib/fixtures/vendorDataset/generateVendorE";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: "E" });
  if (!vendor) throw new Error("Vendor E not found");
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "rates" });
  if (!submission) throw new Error("Vendor E rates submission not found");

  const buffer = await fetchBlob(submission.blobUrl);
  const text = buffer.toString("utf-8");

  console.log("=== Vendor E (plain text email, partial + unsolicited lane) ===");
  const outcome = await extractRatesForDocument({ kind: "text", text }, CANONICAL_LANES);
  console.log(`documentStructure=${outcome.documentStructure}, lanes resolved=${outcome.laneResultsByIndex.size}/30 (expected: ${VENDOR_E_QUOTED_LANE_INDICES.length})`);
  console.log(`Resolved lane indices: ${Array.from(outcome.laneResultsByIndex.keys()).sort((a, b) => a - b).join(", ")}`);
  console.log(`Expected lane indices: ${VENDOR_E_QUOTED_LANE_INDICES.join(", ")}`);
  console.log(`Unsolicited lanes reported: ${outcome.unsolicitedLanes.map((u) => u.description).join(" | ") || "(none)"}`);

  for (const idx of VENDOR_E_QUOTED_LANE_INDICES) {
    const lr = outcome.laneResultsByIndex.get(idx);
    const freight = lr?.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "freight_charge");
    const expected = BASE_RATES[idx].freightPerKg;
    const match = freight && Math.abs(Number(freight.value) - expected) < 0.05;
    console.log(`  Lane ${idx}: extracted=${freight?.value ?? "MISSING"} expected=${expected} ${match ? "OK" : "MISMATCH"}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Vendor E extraction test failed:", err);
  process.exit(1);
});
