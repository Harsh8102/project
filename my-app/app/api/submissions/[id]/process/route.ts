// Runs the real extraction pipeline (lib/ai/extraction/processSubmission.ts
// — the same code scripts/runFullExtraction.ts uses) for one uploaded
// submission, streaming real per-chunk progress back over Server-Sent
// Events as each chunk actually completes — not a simulated progress bar.
// Rates documents chunk internally (extractRatesForDocument); questionnaire
// and terms are single-call (§6.1 of the architecture plan), so they only
// ever report one "processing" -> "done" step.

import { connectToDatabase } from "@/lib/db/connect";
import { LaneModel } from "@/lib/db/models/Lane";
import { VendorSubmissionModel } from "@/lib/db/models/VendorSubmission";
import { processFormSubmission, processRatesSubmission } from "@/lib/ai/extraction/processSubmission";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connectToDatabase();

  const submission = await VendorSubmissionModel.findById(id);
  if (!submission) {
    return new Response(JSON.stringify({ error: "Submission not found" }), { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Best-effort only: if the client has disconnected (tab closed, curl
      // killed, ...), `enqueue` throws "Controller is already closed" — that
      // must never be treated as an extraction failure. The real pipeline
      // (processRatesSubmission/processFormSubmission) already sets the
      // submission's actual status based on real flags; a failed notification
      // to a client that isn't listening anymore shouldn't override it.
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client gone — nothing to do
        }
      };

      try {
        await VendorSubmissionModel.updateOne({ _id: id }, { $set: { status: "processing" } });
        send({ type: "status", status: "processing" });

        const rfxId = String(submission.rfxId);
        const vendorId = String(submission.vendorId);
        const section = submission.section;

        let result;
        if (section === "rates") {
          const lanes = await LaneModel.find({ rfxId: submission.rfxId });
          const laneIdByIndex = new Map(lanes.map((l) => [l.laneIndex, String(l._id)]));
          result = await processRatesSubmission(rfxId, vendorId, submission, laneIdByIndex, {
            onProgress: (chunksDone, chunksTotal) => send({ type: "progress", chunksDone, chunksTotal }),
          });
        } else {
          send({ type: "progress", chunksDone: 0, chunksTotal: 1 });
          result = await processFormSubmission(rfxId, vendorId, section, submission);
        }

        send({ type: "done", status: result.status, fieldsWritten: result.fieldsWritten, fieldsFlagged: result.fieldsFlagged });
      } catch (err) {
        // A genuine pipeline failure (Gemini error, parse error, etc.) —
        // this is the only path that should mark the submission needs_review
        // with an error message; a disconnected client never reaches here.
        const message = err instanceof Error ? err.message : "Processing failed";
        await VendorSubmissionModel.updateOne({ _id: id }, { $set: { status: "needs_review", errorMessage: message } });
        send({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client disconnecting — fine
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
