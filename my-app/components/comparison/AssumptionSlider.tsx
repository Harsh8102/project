"use client";

// The single slider control shared by both cost-assumption surfaces:
// per-lane overrides (CostAssumptionSliders.tsx) and the RFx-wide defaults
// (RfxCostAssumptionDefaults.tsx) — same drag/commit/saving behavior,
// different caption text about what value is being set and why.

import { useState } from "react";

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  sourceText,
  sourceClassName,
  saving,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  sourceText: string;
  sourceClassName?: string;
  saving: boolean;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  // Adjusted during render, not a useEffect (the React-recommended pattern
  // for "sync local state to a prop" — avoids an extra render pass): once
  // a save settles, the fresh prop value replaces our local echo, so the
  // slider stays correct even if the resolved value came from somewhere
  // else while frozen at the just-committed value throughout the "saving"
  // window in between.
  const [syncedValue, setSyncedValue] = useState(value);
  if (!saving && value !== syncedValue) {
    setSyncedValue(value);
    setLocal(value);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {local.toLocaleString("en-IN")} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={saving}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-wait disabled:opacity-60"
      />
      {saving ? (
        <span className="flex items-center gap-1 text-[9.5px] font-semibold text-primary">
          <svg width="8" height="8" viewBox="0 0 8 8" className="animate-spin">
            <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 3" />
          </svg>
          saving — updating everywhere this appears…
        </span>
      ) : (
        <span className={`text-[9.5px] font-medium ${sourceClassName ?? "text-muted-foreground"}`}>{sourceText}</span>
      )}
    </div>
  );
}
