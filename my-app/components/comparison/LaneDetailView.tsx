"use client";

// "View full breakdown per lane" (user feedback): instead of clicking every
// grid cell one at a time, see every charge component for every vendor on
// one lane, stacked vertically, with a deterministic (not LLM) recommendation
// underneath — lib/scoring/laneRecommendation.ts.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LaneSummary, VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { LandedCostLineItem, LandedCostResult } from "@/lib/scoring/computeLandedCost";
import { computeLaneRecommendation, type LaneInsight } from "@/lib/scoring/laneRecommendation";
import { CHARGE_TAXONOMY } from "@/lib/normalization/chargeTaxonomy";
import type { ResolvedCostAssumptions } from "@/lib/scoring/costAssumptions";
import { formatInr } from "./format";
import { CostAssumptionSliders } from "./CostAssumptionSliders";
import { BreakevenPanel } from "./BreakevenPanel";

type LandedCostGridPlain = Record<string, Record<string, LandedCostResult>>;

function rowOrderKey(fieldKey: string | null): number {
  if (!fieldKey) return 999;
  const idx = CHARGE_TAXONOMY.findIndex((t) => t.key === fieldKey);
  return idx === -1 ? 998 : idx;
}

function findLineItem(result: LandedCostResult | undefined, rowKey: string, rowLabel: string): LandedCostLineItem | undefined {
  return result?.lineItems.find((li) => (li.fieldKey ?? li.label) === (rowKey ?? rowLabel));
}

function isBundledVendor(result: LandedCostResult | undefined): boolean {
  return !!result?.lineItems.some((li) => li.flagType === "bundled_all_in");
}

function LineItemCell({ result, rowKey, rowLabel }: { result: LandedCostResult | undefined; rowKey: string; rowLabel: string }) {
  if (!result || result.status === "not_quoted") {
    return <div className="text-xs text-muted-foreground">not quoted for this lane</div>;
  }
  if (result.status === "unreadable") {
    return <div className="text-xs font-medium text-danger-foreground">illegible in source document</div>;
  }

  const li = findLineItem(result, rowKey, rowLabel);
  if (!li) {
    if (isBundledVendor(result)) {
      return <div className="text-xs text-muted-foreground">— bundled into one all-in rate</div>;
    }
    return <div className="text-xs text-muted-foreground">not charged</div>;
  }

  if (!li.included) {
    return (
      <div>
        <div className="text-xs font-semibold text-warning-foreground">excluded</div>
        {li.exclusionReason && <div className="text-[11px] text-warning-foreground">{li.exclusionReason}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="font-mono text-[13px] font-bold tabular-nums">
        {li.resolvedValueInr !== null ? formatInr(li.resolvedValueInr) : "—"}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {li.basis}
        {li.flagNote ? ` · ${li.flagNote}` : ""}
      </div>
    </div>
  );
}

function InsightLine({ insight }: { insight: LaneInsight }) {
  return (
    <>
      <b>{insight.vendorCode}</b> {insight.detail}
    </>
  );
}

export function LaneDetailView({
  lanes,
  vendors,
  landedCosts,
  costAssumptionsByLaneId,
  onExitLaneView,
  initialLaneId,
}: {
  lanes: LaneSummary[];
  vendors: VendorSummary[];
  landedCosts: LandedCostGridPlain;
  costAssumptionsByLaneId: Record<string, ResolvedCostAssumptions>;
  onExitLaneView?: () => void;
  initialLaneId?: string | null;
}) {
  // Lazy initializer, not useEffect: the grid view unmounts this component
  // entirely when switching away (ChargesGrid renders it conditionally), so
  // a fresh mount already picks up whichever lane was just clicked — no
  // separate sync step needed.
  const [index, setIndex] = useState(() => {
    const requested = initialLaneId ? lanes.findIndex((l) => l.id === initialLaneId) : -1;
    return requested >= 0 ? requested : 0;
  });
  const lane = lanes[index];

  const rows = useMemo(() => {
    const seen = new Map<string, { key: string; label: string }>();
    for (const vendor of vendors) {
      const result = landedCosts[vendor.id]?.[lane.id];
      for (const li of result?.lineItems ?? []) {
        const key = li.fieldKey ?? li.label;
        if (!seen.has(key)) seen.set(key, { key, label: li.label });
      }
    }
    return [...seen.values()].sort((a, b) => rowOrderKey(a.key) - rowOrderKey(b.key));
  }, [vendors, landedCosts, lane.id]);

  const recommendation = useMemo(
    () =>
      computeLaneRecommendation({
        laneId: lane.id,
        totalLaneCount: lanes.length,
        vendors,
        landedCosts,
      }),
    [lane.id, lanes.length, vendors, landedCosts]
  );

  const [drawerOpen, setDrawerOpen] = useState(false);

  const assumptions = costAssumptionsByLaneId[lane.id];
  // Only offer a slider for a variable if some vendor on THIS lane actually
  // has a charge that depends on it — no point showing an invoice-value
  // slider on a lane where nobody quoted an FOV/liability charge.
  const laneResults = vendors.map((v) => landedCosts[v.id]?.[lane.id]).filter((r): r is LandedCostResult => !!r);
  const showUnitSlider = laneResults.some((r) => r.lineItems.some((li) => li.basis === "per_unit"));
  const showInvoiceSlider = laneResults.some((r) => r.lineItems.some((li) => li.basis === "pct_of_invoice_value"));
  const landedCostsForLane = new Map(vendors.map((v) => [v.id, landedCosts[v.id]?.[lane.id]]).filter((e): e is [string, LandedCostResult] => !!e[1]));
  const activeAssumptionCount = [assumptions?.avgWeightPerUnitKg, assumptions?.referenceInvoiceValueInr].filter(
    (a) => a && a.value !== null && a.source !== "unset"
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* One compact header for the whole lane view — exit-to-grid, lane
          nav, and lane picker together, deliberately not stacked with any
          other bar above it, so a lane with many charge rows gets the
          maximum possible height for the actual comparison table. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
        {onExitLaneView && (
          <button
            onClick={onExitLaneView}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-muted"
          >
            ← All lanes
          </button>
        )}
        <div className="h-5 w-px shrink-0 bg-border" />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            ←
          </Button>
          <div>
            <div className="text-[14.5px] font-bold">
              {lane.originCity} → {lane.destCity}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {lane.weightBand} · lane {index + 1} of {lanes.length}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === lanes.length - 1}
            onClick={() => setIndex((i) => Math.min(lanes.length - 1, i + 1))}
          >
            →
          </Button>
        </div>
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-[12.5px]"
          value={lane.id}
          onChange={(e) => setIndex(lanes.findIndex((l) => l.id === e.target.value))}
        >
          {lanes.map((l, i) => (
            <option key={l.id} value={l.id}>
              {i + 1}. {l.originCity} → {l.destCity}
            </option>
          ))}
        </select>

        <div className="ml-auto" />
        {assumptions && (
          <button
            onClick={() => setDrawerOpen((o) => !o)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[12.5px] font-bold ${
              drawerOpen
                ? "border-ai-accent bg-ai-accent text-white"
                : "border-ai-accent/40 bg-ai-accent-soft text-ai-accent-foreground"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
              <path d="M9 1.5L10.7 6.8L16 9L10.7 11.2L9 16.5L7.3 11.2L2 9L7.3 6.8L9 1.5Z" fill="currentColor" />
            </svg>
            Explore assumptions &amp; breakeven
            {activeAssumptionCount > 0 && (
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  drawerOpen ? "bg-white text-ai-accent" : "bg-ai-accent text-white"
                }`}
              >
                {activeAssumptionCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Table gets the majority of the screen — the drawer is opened on
          demand, not stacked permanently above/below it. */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
          <div className="grid shrink-0 grid-cols-[220px_repeat(5,1fr)] border-b border-border bg-muted">
            <div className="px-4 py-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Charge component
            </div>
            {vendors.map((v) => (
              <div key={v.id} className="px-4 py-2 text-xs font-bold">
                {v.code} — {v.name}
              </div>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row, i) => (
              <div key={row.key} className={`grid grid-cols-[220px_repeat(5,1fr)] border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/40" : ""}`}>
                <div className="px-4 py-2 text-[12.5px] font-semibold">{row.label}</div>
                {vendors.map((v) => (
                  <div key={v.id} className="px-4 py-2">
                    <LineItemCell result={landedCosts[v.id]?.[lane.id]} rowKey={row.key} rowLabel={row.label} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="grid shrink-0 grid-cols-[220px_repeat(5,1fr)] items-center border-t-2 border-t-primary bg-muted">
            <div className="px-4 py-2 text-[12.5px] font-bold">Total landed cost</div>
            {vendors.map((v) => {
              const result = landedCosts[v.id]?.[lane.id];
              return (
                <div key={v.id} className="px-4 py-2">
                  <div className="font-mono text-base font-bold tabular-nums">
                    {result?.totalInr !== null && result?.totalInr !== undefined ? formatInr(result.totalInr) : "—"}
                  </div>
                  {result && result.totalInr !== null && (
                    <div className={`text-[11px] font-semibold ${result.isPartial ? "text-warning-foreground" : "text-success-foreground"}`}>
                      {result.isPartial ? "partial — charges excluded" : "fully resolved"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {recommendation.hasUsableBid && recommendation.insights.length > 0 && (
            <div className="flex shrink-0 items-start gap-2.5 border-t border-border bg-card px-4 py-2">
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" className="mt-0.5 shrink-0">
                <path
                  d="M9 1.5L10.7 6.8L16 9L10.7 11.2L9 16.5L7.3 11.2L2 9L7.3 6.8L9 1.5Z"
                  fill="var(--color-muted-foreground)"
                />
              </svg>
              <div className="min-w-0 flex-1 space-y-0.5 text-[12px] leading-snug text-muted-foreground">
                {recommendation.insights.map((insight, i) => (
                  <p key={i}>
                    <InsightLine insight={insight} />
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        {drawerOpen && assumptions && (
          <div className="flex w-[400px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-ai-accent-soft px-4 py-3">
              <div>
                <div className="text-[12.5px] font-bold text-ai-accent-foreground">Assumptions &amp; breakeven</div>
                <div className="text-[10px] text-ai-accent-foreground/75">
                  {lane.originCity} → {lane.destCity}
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-ai-accent-foreground hover:bg-black/5"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M2 2L11 11M11 2L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex flex-col gap-3">
                <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Reference values for this lane</div>
                <CostAssumptionSliders
                  laneId={lane.id}
                  weightBand={lane.weightBand}
                  assumptions={assumptions}
                  showUnitSlider={showUnitSlider}
                  showInvoiceSlider={showInvoiceSlider}
                />
              </div>

              <div className="h-px shrink-0 bg-border" />

              <BreakevenPanel
                vendors={vendors}
                landedCostsForLane={landedCostsForLane}
                avgWeightPerUnitKg={assumptions.avgWeightPerUnitKg.value}
                currentWeightKg={assumptions.referenceWeightKg.value ?? 0}
                currentInvoiceValueInr={assumptions.referenceInvoiceValueInr.value ?? 0}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
