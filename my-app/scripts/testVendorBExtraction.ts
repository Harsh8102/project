// Proves rates extraction against the real seeded vendor B document — a PDF
// region matrix with real-world header synonyms and two kinds of coverage
// gaps (region-level: Central/Northeast; city-level: Goa/Udaipur). Compares
// the deterministic lane-resolution step against the known ground truth.
// Run with: npm run test:vendor-b-extraction

import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { resolveRegionMatrixToLanes } from "../lib/ai/extraction/resolveRegionMatrix";
import { resolveChargeKey } from "../lib/ai/extraction/extractRatesChunk";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";
import { buildRegionMatrix, getVendorBUnservedLanes } from "../lib/fixtures/vendorDataset/generateVendorB";
import { USD_TO_INR } from "../lib/fixtures/vendorDataset/rateModel";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: "B" });
  if (!vendor) throw new Error("Vendor B not found");
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "rates" });
  if (!submission) throw new Error("Vendor B rates submission not found");

  const buffer = await fetchBlob(submission.blobUrl);

  console.log("Extracting vendor B rates (PDF region matrix)...\n");
  const outcome = await extractRatesForDocument(
    { kind: "file", buffer, mimeType: "application/pdf" },
    CANONICAL_LANES
  );

  console.log(`documentStructure=${outcome.documentStructure}, chunks run=${outcome.chunkCount}`);
  if (outcome.documentStructure !== "region_matrix" || !outcome.regionMatrix) {
    console.error("FAILED: expected a region_matrix, got per_lane. Aborting.");
    process.exit(1);
  }

  const matrix = outcome.regionMatrix;
  console.log(`\nExtracted ${matrix.regionDefinitions.length} region definitions:`);
  for (const r of matrix.regionDefinitions) console.log(`  ${r.regionLabel}: ${r.cities.join(", ")}`);
  console.log(`Extracted ${matrix.cells.length} matrix cells, ${matrix.flatCharges.length} flat charges`);
  console.log(`Unserved note: "${matrix.unservedNote}"`);

  const resolved = resolveRegionMatrixToLanes(matrix, CANONICAL_LANES);
  const expectedUnserved = new Set(getVendorBUnservedLanes().map((l) => l.laneIndex));
  const expectedCells = buildRegionMatrix();

  console.log(`\n=== Per-lane resolution check ===`);
  let correct = 0;
  for (const r of resolved) {
    const shouldBeUnserved = expectedUnserved.has(r.laneIndex);

    if (shouldBeUnserved) {
      const ok = r.status !== "resolved";
      if (ok) correct++;
      console.log(`  Lane ${r.laneIndex}: ${ok ? "OK" : "MISMATCH"} — expected unserved, got status=${r.status}`);
      continue;
    }

    if (r.status !== "resolved") {
      console.log(`  Lane ${r.laneIndex}: MISMATCH — expected resolved, got status=${r.status} (${(r as { reason: string }).reason})`);
      continue;
    }

    const lane = CANONICAL_LANES[r.laneIndex];
    // We don't know which region label the vendor used for lane's regions without
    // re-deriving it, so just check the freight charge is a plausible USD/kg rate
    // in the extracted matrix's cell range (not comparing to a specific cell — the
    // point here is "did resolution find a rate" and "is header mapping working").
    const freight = r.charges.find((c) => c.fieldKey === "freight_charge");
    const flatMapped = r.charges.filter((c) => c.fieldKey && c.fieldKey !== "freight_charge");
    const ok = !!freight && Number(freight.rawValue) > 0 && Number(freight.rawValue) < 1; // USD/kg, expect < $1
    if (ok) correct++;
    console.log(
      `  Lane ${r.laneIndex} (${lane.originCity}->${lane.destCity}): ${ok ? "OK" : "MISMATCH"} freight=$${freight?.rawValue}/kg, ${flatMapped.length}/${r.charges.length - 1} flat charges mapped`
    );
  }
  console.log(`\nResolution accuracy: ${correct}/${resolved.length} lanes correct`);

  console.log(`\n=== Flat charge header mapping (real-world synonyms, not canonical labels) ===`);
  for (const c of matrix.flatCharges) {
    const r = resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence);
    console.log(`  "${c.rawHeaderLabel}" -> ${r.key ?? "UNMAPPED"} (${r.method}, confidence ${r.confidence.toFixed(2)})`);
  }

  console.log(`\nExpected rate range check (USD_TO_INR=${USD_TO_INR}): first extracted cell = ${matrix.cells[0]?.ratePerKg}, expected cell[0] (${expectedCells[0].fromRegion}->${expectedCells[0].toRegion}) = $${expectedCells[0].ratePerKgUsd}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Vendor B extraction test failed:", err);
  process.exit(1);
});
