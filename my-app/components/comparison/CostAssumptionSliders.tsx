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
import { Slider } from "./AssumptionSlider";

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
          sourceText={sourceLabel(assumptions.referenceWeightKg.source).text}
          sourceClassName={sourceLabel(assumptions.referenceWeightKg.source).className}
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
          sourceText={sourceLabel(assumptions.avgWeightPerUnitKg.source).text}
          sourceClassName={sourceLabel(assumptions.avgWeightPerUnitKg.source).className}
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
          sourceText={sourceLabel(assumptions.referenceInvoiceValueInr.source).text}
          sourceClassName={sourceLabel(assumptions.referenceInvoiceValueInr.source).className}
          saving={pending?.field === "referenceInvoiceValueInr"}
          onCommit={(v) => commitLaneOverride("referenceInvoiceValueInr", v)}
        />
      )}
    </div>
  );
}
