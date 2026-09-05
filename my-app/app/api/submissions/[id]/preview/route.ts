// Parses an xlsx submission's real content for in-app preview (Upload tab),
// so a buyer can check what a vendor actually sent without downloading it.
// Image/PDF/text files don't need parsing — the client renders those
// directly via /api/files (the existing private-blob proxy). docx has no
// parser in this project, so it isn't handled here; the client falls back
// to "open in a new tab" for that file type.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { VendorSubmissionModel } from "@/lib/db/models/VendorSubmission";
import { parseXlsx } from "@/lib/files/parseXlsx";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connectToDatabase();

  const submission = await VendorSubmissionModel.findById(id);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  if (submission.fileType !== "xlsx") {
    return NextResponse.json({ error: "Only xlsx submissions have a parsed preview." }, { status: 400 });
  }

  const upstream = await fetch(submission.blobUrl, { headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
  if (!upstream.ok) {
    return NextResponse.json({ error: "Failed to fetch the file" }, { status: 502 });
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  const sheets = await parseXlsx(buffer);

  return NextResponse.json({ sheets });
}
