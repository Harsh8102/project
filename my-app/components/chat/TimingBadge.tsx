"use client";

// Surfaces the per-turn RequestTimer snapshot (persisted on the message —
// lib/db/models/ChatMessage.ts's `timings` field) directly in the chat UI.
// Built for demoing the response-time investigation (see
// docs/chat-response-time-investigation.md): click a reply's badge and the
// Gemini-round-trip-vs-everything-else breakdown is right there, no server
// console needed.

import { useState } from "react";
import type { MessageTimings } from "@/lib/db/queries/getChatHistory";

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function TimingBadge({ timings }: { timings: MessageTimings }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-1.5 min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
        title="Where the response time went"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
          <path d="M5 2.6V5L6.6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        answered in {formatMs(timings.totalMs)}
        <span className="opacity-60">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-1 min-w-0 max-w-full space-y-0.5 rounded-md border border-border bg-card/60 px-2.5 py-2 font-mono text-[10.5px]">
          {timings.marks.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-muted-foreground">{m.label}</span>
              <span className="shrink-0 tabular-nums">{formatMs(m.sinceLastMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
