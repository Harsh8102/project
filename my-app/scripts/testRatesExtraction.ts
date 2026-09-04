// Proves rates extraction against the real seeded vendor A rate card (xlsx,
// canonical headers, all 30 lanes) — chunked exactly as the real pipeline
// will chunk it, compared against the known BASE_RATES ground truth.
// Run with: npm run test:rates-extraction

import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { parseXlsx } from "../lib/files/parseXlsx";
import { resolveChargeKey } from "../lib/ai/extraction/extractRatesChunk";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";
import { BASE_RATES } from "../lib/fixtures/vendorDataset/rateModel";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: "A" });
  if (!vendor) throw new Error("Vendor A not found");
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "rates" });
  if (!submission) throw new Error("Vendor A rates submission not found");

  const buffer = await fetchBlob(submission.blobUrl);
  const parsedXlsx = await parseXlsx(buffer);

  console.log(`Extracting vendor A rates (${CANONICAL_LANES.length} lanes)...\n`);

  const outcome = await extractRatesForDocument({ kind: "xlsx", parsedXlsx }, CANONICAL_LANES);

  console.log(`documentStructure=${outcome.documentStructure}, chunks run=${outcome.chunkCount}, lanes resolved=${outcome.laneResultsByIndex.size}\n`);

  let correctFreight = 0;
  let deterministicMaps = 0;
  let llmMaps = 0;
  let unmapped = 0;

  for (const lane of CANONICAL_LANES) {
    const lr = outcome.laneResultsByIndex.get(lane.laneIndex);
    const expected = BASE_RATES[lane.laneIndex];

    if (!lr) {
      console.log(`  Lane ${lane.laneIndex}: NO RESULT`);
      continue;
    }

    const freightCharge = lr.charges.find((c) => resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence).key === "freight_charge");
    for (const c of lr.charges) {
      const r = resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence);
      if (r.method === "deterministic") deterministicMaps++;
      else if (r.method === "llm") llmMaps++;
      else unmapped++;
    }

    if (!freightCharge) {
      console.log(`  Lane ${lane.laneIndex}: NO freight_charge found (foundInDocument=${lr.foundInDocument})`);
      continue;
    }

    const extractedValue = Number(freightCharge.value);
    const match = Math.abs(extractedValue - expected.freightPerKg) < 0.05;
    if (match) correctFreight++;
    else console.log(`  Lane ${lane.laneIndex}: freight MISMATCH extracted=${extractedValue} expected=${expected.freightPerKg}`);
  }

  console.log(`\n=== Vendor A rates extraction summary ===`);
  console.log(`Freight charge accuracy: ${correctFreight}/${CANONICAL_LANES.length} lanes matched (tolerance 0.05)`);
  console.log(`Header mapping: ${deterministicMaps} deterministic, ${llmMaps} LLM-resolved, ${unmapped} unmapped`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Rates extraction test failed:", err);
  process.exit(1);
});
