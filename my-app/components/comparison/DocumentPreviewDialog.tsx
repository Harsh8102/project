"use client";

// In-app preview for an uploaded vendor document (Upload tab) — built
// because presenting a demo previously meant downloading every file and
// opening it separately to show what a vendor actually sent. Renders each
// real file type this dataset uses directly:
//   - image: <img>, straight from the private-blob proxy
//   - pdf: <iframe>, using the browser's own native PDF viewer
//   - text: fetched and shown as plain text
//   - xlsx: parsed server-side (this project's real parseXlsx util — the
//     same one extraction itself uses) and rendered as a real table
//   - docx: no parser in this project; falls back to "open in a new tab"
//     rather than pretending to render something it can't

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export type PreviewTarget = { submissionId: string; blobUrl: string; fileName: string; fileType: string };

function fileHref(blobUrl: string) {
  return `/api/files?url=${encodeURIComponent(blobUrl)}`;
}

type XlsxSheet = { sheetName: string; rows: { rowNumber: number; cells: string[] }[] };

function XlsxTable({ sheet }: { sheet: XlsxSheet }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-bold text-muted-foreground">{sheet.sheetName}</div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            {sheet.rows.map((row, i) => (
              <tr key={row.rowNumber} className={i === 0 ? "bg-muted font-semibold" : "odd:bg-muted/30"}>
                {row.cells.map((cell, j) => (
                  <td key={j} className="border-b border-border px-2.5 py-1.5 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DocumentPreviewDialog({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  const [xlsxSheets, setXlsxSheets] = useState<XlsxSheet[] | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset stale content the moment a *different* document is selected —
  // adjusted during render (comparing submissionId identity), not inside
  // the effect below, same pattern used elsewhere for prop-driven resets.
  const [prevTargetId, setPrevTargetId] = useState<string | null>(target?.submissionId ?? null);
  const targetId = target?.submissionId ?? null;
  if (targetId !== prevTargetId) {
    setPrevTargetId(targetId);
    setXlsxSheets(null);
    setTextContent(null);
    setError(null);
  }

  // Fetching preview content for whichever document was clicked — a real
  // subscription to an external system (the server), not state derived
  // from a prop, so an effect is the right tool for the actual I/O.
  useEffect(() => {
    if (!target) return;
    if (target.fileType !== "xlsx" && target.fileType !== "text") return;

    let cancelled = false;

    // Standard async-effect shape (setState calls live inside this nested
    // function, called from the effect, rather than directly in the effect
    // body) — the recommended pattern for a real data fetch triggered by a
    // prop change.
    async function loadPreview(t: NonNullable<typeof target>) {
      setLoading(true);
      try {
        if (t.fileType === "xlsx") {
          const res = await fetch(`/api/submissions/${t.submissionId}/preview`);
          const data = await res.json();
          if (cancelled) return;
          if (data.error) setError(data.error);
          else setXlsxSheets(data.sheets);
        } else {
          const res = await fetch(fileHref(t.blobUrl));
          const text = await res.text();
          if (!cancelled) setTextContent(text);
        }
      } catch {
        if (!cancelled) setError("Couldn't load this file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadPreview(target);

    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{target?.fileName}</DialogTitle>
          <DialogDescription>
            {target && (
              <a href={fileHref(target.blobUrl)} target="_blank" rel="noreferrer" className="underline">
                Open in a new tab
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {!target ? null : loading ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="py-10 text-center text-[12px] text-muted-foreground">{error}</div>
          ) : target.fileType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private-blob-proxied vendor upload, not an optimizable static asset
            <img src={fileHref(target.blobUrl)} alt={target.fileName} className="mx-auto max-h-[70vh] rounded-md" />
          ) : target.fileType === "pdf" ? (
            <iframe src={fileHref(target.blobUrl)} title={target.fileName} className="h-[70vh] w-full rounded-md border border-border" />
          ) : target.fileType === "text" ? (
            <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11.5px] whitespace-pre-wrap">{textContent}</pre>
          ) : target.fileType === "xlsx" && xlsxSheets ? (
            <div className="flex flex-col gap-4">
              {xlsxSheets.map((sheet) => (
                <XlsxTable key={sheet.sheetName} sheet={sheet} />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              No in-app preview for this file type yet — use &ldquo;Open in a new tab&rdquo; above.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
