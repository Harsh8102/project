"use client";

// Real per-vendor, per-section document upload + processing (§8.1/§6.1 of
// the functional plan, finally reachable from the UI). Two real API calls
// per document: POST /api/submissions (upload to Blob, mark "uploaded"),
// then POST /api/submissions/[id]/process (Gemini extraction, streamed
// per-chunk progress over SSE — not a simulated progress bar).

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Type-only import — the runtime SUBMISSION_SECTIONS value lives in the
// Mongoose model file, which must never be imported into a client bundle
// (pulls the Node-only `mongoose` package into the browser).
import type { SubmissionSection } from "@/lib/db/models/VendorSubmission";
import type { RfxOverview, SubmissionSummary } from "@/lib/db/queries/getRfxOverview";
import { useToastStack, ToastStack } from "@/components/ui/toast-stack";
import { geminiKey } from "@/lib/client/apiKeyStorage";

const SUBMISSION_SECTIONS: SubmissionSection[] = ["rates", "questionnaire", "terms"];

function fileHref(blobUrl: string) {
  return `/api/files?url=${encodeURIComponent(blobUrl)}`;
}

const SECTION_LABELS: Record<SubmissionSection, string> = {
  rates: "Rates",
  questionnaire: "Questionnaire",
  terms: "Terms",
};

type Progress = { chunksDone: number; chunksTotal: number } | null;

async function consumeSse(response: Response, onEvent: (event: Record<string, unknown>) => void) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice("data: ".length)));
    }
  }
}

export function UploadTab({ overview }: { overview: RfxOverview }) {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Record<string, Record<SubmissionSection, SubmissionSummary>>>(() =>
    Object.fromEntries(overview.vendors.map((v) => [v.id, v.submissions]))
  );
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { toasts, push: pushToast, dismiss: dismissToast } = useToastStack();

  const pendingCount = Object.values(submissions)
    .flatMap((s) => Object.values(s))
    .filter((s) => s?.status === "uploaded").length;

  async function upload(vendorId: string, section: SubmissionSection, file: File) {
    const key = `${vendorId}:${section}`;
    setUploading(key);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("vendorId", vendorId);
    formData.append("section", section);
    try {
      const res = await fetch("/api/submissions", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setSubmissions((prev) => ({
          ...prev,
          [vendorId]: {
            ...prev[vendorId],
            [section]: {
              id: data.id,
              section,
              fileName: file.name,
              fileType: file.name.split(".").pop() ?? "",
              blobUrl: "",
              status: "uploaded",
              formatViolation: data.formatViolation,
            },
          },
        }));
      }
    } finally {
      setUploading(null);
    }
  }

  async function processOne(vendorId: string, section: SubmissionSection, submissionId: string) {
    const vendorLabel = overview.vendors.find((v) => v.id === vendorId)?.code ?? "Vendor";
    setProgress((prev) => ({ ...prev, [submissionId]: { chunksDone: 0, chunksTotal: 1 } }));

    let res: Response;
    try {
      res = await fetch(`/api/submissions/${submissionId}/process`, { method: "POST", headers: geminiKey.header() });
    } catch {
      pushToast({ tone: "danger", title: `${vendorLabel} ${SECTION_LABELS[section]} — couldn't reach the server`, detail: "Check your connection and try again." });
      return;
    }

    // The stream can end (network drop, tab backgrounded) without ever
    // sending a "done"/"error" event — track whether we actually saw one so
    // a silent failure still surfaces as a toast instead of leaving the card
    // stuck on "Processing…" forever with no explanation.
    let sawTerminalEvent = false;

    await consumeSse(res, (event) => {
      if (event.type === "progress") {
        setProgress((prev) => ({ ...prev, [submissionId]: { chunksDone: event.chunksDone as number, chunksTotal: event.chunksTotal as number } }));
      } else if (event.type === "done") {
        sawTerminalEvent = true;
        const status = event.status as string;
        const fieldsWritten = event.fieldsWritten as number;
        const fieldsFlagged = event.fieldsFlagged as number;
        setSubmissions((prev) => ({
          ...prev,
          [vendorId]: { ...prev[vendorId], [section]: prev[vendorId]?.[section] ? { ...prev[vendorId][section]!, status } : prev[vendorId]?.[section] },
        }));
        pushToast(
          status === "needs_review"
            ? { tone: "warning", title: `${vendorLabel} ${SECTION_LABELS[section]} needs review`, detail: `${fieldsWritten} field(s) written, ${fieldsFlagged} flagged for review.` }
            : { tone: "success", title: `${vendorLabel} ${SECTION_LABELS[section]} processed`, detail: `${fieldsWritten} field(s) written${fieldsFlagged ? `, ${fieldsFlagged} flagged` : ""}.` }
        );
      } else if (event.type === "error") {
        sawTerminalEvent = true;
        setSubmissions((prev) => ({
          ...prev,
          [vendorId]: { ...prev[vendorId], [section]: prev[vendorId]?.[section] ? { ...prev[vendorId][section]!, status: "needs_review" } : prev[vendorId]?.[section] },
        }));
        pushToast({ tone: "danger", title: `${vendorLabel} ${SECTION_LABELS[section]} failed`, detail: event.message as string });
      }
    });

    if (!sawTerminalEvent) {
      pushToast({ tone: "warning", title: `${vendorLabel} ${SECTION_LABELS[section]} — connection dropped mid-process`, detail: "Reload to check its actual status before retrying." });
    }
    setProgress((prev) => {
      const next = { ...prev };
      delete next[submissionId];
      return next;
    });
  }

  async function processAll() {
    setProcessingAll(true);
    const toProcess = Object.entries(submissions).flatMap(([vendorId, sections]) =>
      Object.entries(sections)
        .filter(([, s]) => s?.status === "uploaded")
        .map(([section, s]) => ({ vendorId, section: section as SubmissionSection, id: s!.id }))
    );
    for (const item of toProcess) {
      await processOne(item.vendorId, item.section, item.id);
    }
    setProcessingAll(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="flex items-center gap-6 rounded-lg border border-border bg-card px-5 py-4">
        <div className="text-[12.5px] font-semibold text-muted-foreground">Before uploading — download what vendors should fill in:</div>
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {overview.laneListBlobUrl && (
            <a href={fileHref(overview.laneListBlobUrl)} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold hover:bg-accent">
              Lane list.xlsx · {overview.laneCount} lanes
            </a>
          )}
          {overview.questionnaireTemplateBlobUrl && (
            <a href={fileHref(overview.questionnaireTemplateBlobUrl)} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold hover:bg-accent">
              Questionnaire template.xlsx
            </a>
          )}
          {overview.termsTemplateBlobUrl && (
            <a href={fileHref(overview.termsTemplateBlobUrl)} target="_blank" rel="noreferrer" className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold hover:bg-accent">
              Terms template.xlsx
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/25 bg-accent/40 px-5 py-3.5">
        <div>
          <div className="text-[12.5px] font-bold">
            {pendingCount > 0 ? `${pendingCount} document${pendingCount === 1 ? "" : "s"} uploaded, not yet processed` : "Nothing queued"}
          </div>
          <div className="text-[11px] text-muted-foreground">Nothing is read or scored until you process it.</div>
        </div>
        <button
          onClick={processAll}
          disabled={pendingCount === 0 || processingAll}
          className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-4.5 py-2.5 text-[13px] font-bold text-primary-foreground disabled:opacity-40"
        >
          {processingAll ? "Processing…" : "Process uploaded documents"}
        </button>
      </div>

      <div className="grid grid-cols-[220px_repeat(3,1fr)] gap-3">
        <div />
        {SUBMISSION_SECTIONS.map((section) => (
          <div key={section} className="text-[11px] font-bold text-muted-foreground uppercase">
            {SECTION_LABELS[section]}
          </div>
        ))}

        {overview.vendors.map((vendor) => (
          <Fragment key={vendor.id}>
            <div className="flex items-center text-[13px] font-bold">
              {vendor.code} — {vendor.name}
            </div>
            {SUBMISSION_SECTIONS.map((section) => {
              const sub = submissions[vendor.id]?.[section];
              const key = `${vendor.id}:${section}`;
              const prog = sub ? progress[sub.id] : null;
              const isUploading = uploading === key;

              return (
                <div key={key} className="min-h-[80px] rounded-lg border border-border bg-card p-3.5">
                  <input
                    ref={(el) => {
                      fileInputRefs.current[key] = el;
                    }}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload(vendor.id, section, file);
                      e.target.value = "";
                    }}
                  />
                  {!sub ? (
                    <button
                      onClick={() => fileInputRefs.current[key]?.click()}
                      disabled={isUploading}
                      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input py-3 text-center"
                    >
                      <span className="text-[11.5px] font-semibold text-muted-foreground">
                        {isUploading ? "Uploading…" : "Drop file or browse"}
                      </span>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                            sub.status === "done"
                              ? "bg-success"
                              : sub.status === "needs_review"
                                ? "bg-warning"
                                : sub.status === "processing"
                                  ? "bg-primary"
                                  : "bg-primary"
                          }`}
                        />
                        <span className="truncate text-xs font-semibold" title={sub.fileName}>
                          {sub.fileName}
                        </span>
                      </div>
                      {sub.formatViolation && (
                        <div className="text-[10.5px] font-semibold text-danger-foreground">
                          Wrong format — .xlsx required
                        </div>
                      )}
                      {prog && sub.status !== "done" && sub.status !== "needs_review" ? (
                        <div className="flex flex-col gap-1">
                          <div className="text-[10.5px] font-semibold text-primary">
                            Processing — chunk {prog.chunksDone} of {prog.chunksTotal}
                          </div>
                          <div className="h-[5px] overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${prog.chunksTotal ? Math.round((prog.chunksDone / prog.chunksTotal) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10.5px] text-muted-foreground">
                          {sub.status === "done" && "Done"}
                          {sub.status === "needs_review" && "Needs review"}
                          {sub.status === "uploaded" && "Queued, not yet processed"}
                        </div>
                      )}
                      <button
                        onClick={() => fileInputRefs.current[key]?.click()}
                        className="self-start text-[10.5px] font-semibold text-primary"
                      >
                        Replace file
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
