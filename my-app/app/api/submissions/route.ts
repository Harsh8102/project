// Real vendor-document upload (§8.1 of the functional plan, finally wired
// to a UI — previously only reachable via scripts/generateVendorDataset.ts).
// Stores the file in Blob and upserts a VendorSubmission with
// status "uploaded"; extraction itself happens in a separate call to
// /api/submissions/[id]/process, kept apart so the buyer can upload several
// documents before processing any of them.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { RfxModel } from "@/lib/db/models/Rfx";
import { VendorSubmissionModel, SUBMISSION_SECTIONS, type SubmissionSection } from "@/lib/db/models/VendorSubmission";
import { uploadToBlob } from "@/lib/files/blob";

const REQUIRES_XLSX: SubmissionSection[] = ["questionnaire", "terms"];

function detectFileType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "txt") return "text";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  return "text";
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");
  const vendorId = formData.get("vendorId");
  const section = formData.get("section");

  if (!(file instanceof File) || typeof vendorId !== "string" || typeof section !== "string") {
    return NextResponse.json({ error: "file, vendorId and section are required" }, { status: 400 });
  }
  if (!SUBMISSION_SECTIONS.includes(section as SubmissionSection)) {
    return NextResponse.json({ error: `Invalid section "${section}"` }, { status: 400 });
  }

  await connectToDatabase();
  const rfx = await RfxModel.findOne().sort({ createdAt: -1 });
  if (!rfx) return NextResponse.json({ error: "No RFx found" }, { status: 404 });

  const fileType = detectFileType(file.name);
  const formatViolation = REQUIRES_XLSX.includes(section as SubmissionSection) && fileType !== "xlsx";

  const buffer = Buffer.from(await file.arrayBuffer());
  const pathname = `rfx/${rfx._id}/uploads/${vendorId}-${section}-${Date.now()}-${file.name}`;
  const blob = await uploadToBlob(pathname, buffer, file.type || undefined);

  const submission = await VendorSubmissionModel.findOneAndUpdate(
    { rfxId: rfx._id, vendorId, section },
    {
      $set: {
        blobUrl: blob.url,
        fileName: file.name,
        fileType,
        status: "uploaded",
        formatViolation,
        errorMessage: null,
        chunksDone: 0,
        chunksTotal: 1,
        nextChunkIndex: 0,
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  return NextResponse.json({
    id: String(submission._id),
    status: submission.status,
    formatViolation: submission.formatViolation,
    blobUrl: submission.blobUrl,
  });
}
