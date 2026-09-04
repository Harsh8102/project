import { connectToDatabase } from "../lib/db/connect";
import { VendorSubmissionModel } from "../lib/db/models/VendorSubmission";
import { VendorModel } from "../lib/db/models/Vendor";
import { extractRatesForDocument } from "../lib/ai/extraction/extractRatesForDocument";
import { CANONICAL_LANES } from "../lib/fixtures/canonicalLanes";
import { VENDOR_D_ILLEGIBLE_LANE_INDEX } from "../lib/fixtures/vendorDataset/generateVendorD";

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await connectToDatabase();
  const vendor = await VendorModel.findOne({ code: "D" });
  if (!vendor) throw new Error("Vendor D not found");
  const submission = await VendorSubmissionModel.findOne({ vendorId: vendor._id, section: "rates" });
  if (!submission) throw new Error("Vendor D rates submission not found");

  const buffer = await fetchBlob(submission.blobUrl);
  const outcome = await extractRatesForDocument({ kind: "file", buffer, mimeType: "image/jpeg" }, CANONICAL_LANES);

  const lr = outcome.laneResultsByIndex.get(VENDOR_D_ILLEGIBLE_LANE_INDEX);
  console.log(`Lane ${VENDOR_D_ILLEGIBLE_LANE_INDEX} (Bengaluru->Chennai): foundInDocument=${lr?.foundInDocument}, unreadable=${lr?.unreadable}, charges=${JSON.stringify(lr?.charges)}`);
  console.log(lr?.unreadable ? "PASS: correctly reported as unreadable" : "STILL FAILING: not reported as unreadable");

  process.exit(0);
}

main().catch((err) => {
  console.error("Vendor D test failed:", err);
  process.exit(1);
});
