"use client";

// Live, buyer-owned sliders for the assumptions computeLandedCost.ts needs
// to resolve per_unit/pct_of_invoice_value charges (and, per the breakeven
// planning conversation, weight too, since it was the same category of
// silent default). Moving a slider previews locally; releasing it PATCHes
// a per-LANE override (never the RFx-wide default — exploring one lane
// must never silently change another's numbers) and refreshes the page so
// every consumer (Charges grid, scorecard, rate score, chat) picks up the
// new official value. See lib/scoring/costAssumptions.ts for precedence.
//
// `router.refresh()` has no completion callback, so without an explicit
// "saving" state a buyer who switches to the Grid tab right after
// releasing a slider can briefly see stale totals there — not a data bug
// (a fresh page load always shows the right numbers), but a real,
// confusing gap with no feedback that anything was even in flight. Fixed
// by tracking the just-committed value and clearing "saving" only once
// the refreshed `assumptions` prop actually reflects it.

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResolvedCostAssumptions, AssumptionSource } from "@/lib/scoring/costAssumptions";

type AssumptionField = "referenceWeightKg" | "avgWeightPerUnitKg" | "referenceInvoiceValueInr";

function sourceLabel(source: AssumptionSource): { text: string; className: string } {
  switch (source) {
    case "lane_override":
      return { text: "you set this, for this lane", className: "text-primary" };
    case "rfx_default":
      return { text: "RFx-wide default — unbacked, adjust if you know better", className: "text-warning-foreground" };
    case "band_midpoint":
      return { text: "this lane's weight-band midpoint", className: "text-muted-foreground" };
    case "unset":
      return { text: "not set — related charges stay excluded", className: "text-muted-foreground" };
  }
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  source,
  saving,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  source: AssumptionSource;
  saving: boolean;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  // Adjusted during render, not a useEffect (the React-recommended pattern
  // for "sync local state to a prop" — avoids an extra render pass): once
  // a save settles, the fresh prop value replaces our local echo, so the
  // slider stays correct even if the resolved value came from somewhere
  // else (another tab, or the RFx default changing) while frozen at the
  // just-committed value throughout the "saving" window in between.
  const [syncedValue, setSyncedValue] = useState(value);
  if (!saving && value !== syncedValue) {
    setSyncedValue(value);
    setLocal(value);
  }
  const src = sourceLabel(source);

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
          saving — updating everywhere this lane appears…
        </span>
      ) : (
        <span className={`text-[9.5px] font-medium ${src.className}`}>{src.text}</span>
      )}
    </div>
  );
}

/** "500-1000 kg" -> {low: 500, high: 1000}. Falls back to a wide guess if unparseable. */
function parseWeightBandBounds(weightBand: string): { low: number; high: number } {
  const nums = weightBand.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length >= 2) return { low: nums[0], high: nums[1] };
  if (nums.length === 1) return { low: 0, high: nums[0] * 2 };
  return { low: 0, high: 5000 };
}

export function CostAssumptionSliders({
  laneId,
  weightBand,
  assumptions,
  showUnitSlider,
  showInvoiceSlider,
}: {
  laneId: string;
  weightBand: string;
  assumptions: ResolvedCostAssumptions;
  showUnitSlider: boolean;
  showInvoiceSlider: boolean;
}) {
  const router = useRouter();
  const bounds = parseWeightBandBounds(weightBand);
  const weightMin = Math.max(0, Math.round(bounds.low * 0.5));
  const weightMax = Math.round(bounds.high * 1.5);

  const [pending, setPending] = useState<{ field: AssumptionField; value: number } | null>(null);

  // Clears "saving" only once the server-refreshed prop actually reflects
  // the value we committed — not on a fixed timer, which could either lag
  // behind a slow refresh or clear before Charges/Terms/chat have caught
  // up. Adjusted during render (see Slider above) rather than a useEffect.
  const [prevAssumptions, setPrevAssumptions] = useState(assumptions);
  if (assumptions !== prevAssumptions) {
    setPrevAssumptions(assumptions);
    if (pending && assumptions[pending.field].value === pending.value) setPending(null);
  }

  async function commitLaneOverride(field: AssumptionField, value: number) {
    setPending({ field, value });
    await fetch(`/api/lanes/${laneId}/cost-assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  }

  if (!showUnitSlider && !showInvoiceSlider && assumptions.referenceWeightKg.value === null) return null;

  return (
    <div className="flex flex-col gap-3.5">
      {assumptions.referenceWeightKg.value !== null && (
        <Slider
          label="Reference weight"
          value={assumptions.referenceWeightKg.value}
          min={weightMin}
          max={Math.max(weightMax, weightMin + 1)}
          step={10}
          unit="kg"
          source={assumptions.referenceWeightKg.source}
          saving={pending?.field === "referenceWeightKg"}
          onCommit={(v) => commitLaneOverride("referenceWeightKg", v)}
        />
      )}
      {showUnitSlider && (
        <Slider
          label="Avg weight per unit (box/carton)"
          value={assumptions.avgWeightPerUnitKg.value ?? 10}
          min={0.5}
          max={50}
          step={0.5}
          unit="kg/unit"
          source={assumptions.avgWeightPerUnitKg.source}
          saving={pending?.field === "avgWeightPerUnitKg"}
          onCommit={(v) => commitLaneOverride("avgWeightPerUnitKg", v)}
        />
      )}
      {showInvoiceSlider && (
        <Slider
          label="Reference invoice value"
          value={assumptions.referenceInvoiceValueInr.value ?? 50000}
          min={0}
          max={500000}
          step={5000}
          unit="₹"
          source={assumptions.referenceInvoiceValueInr.source}
          saving={pending?.field === "referenceInvoiceValueInr"}
          onCommit={(v) => commitLaneOverride("referenceInvoiceValueInr", v)}
        />
      )}
    </div>
  );
}
