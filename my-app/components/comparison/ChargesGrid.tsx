"use client";

// The 30-lane x 5-vendor charges comparison grid (§8.2.1 of the functional
// plan). Every cell is a landed-cost total resolved by
// lib/scoring/computeLandedCost.ts — clicking it opens the line items that
// made up (or were excluded from) that total, so a buyer can verify without
// leaving the app (§7). "Landed cost" here is always currency (₹) — the
// 0-100 scores live in VendorScorecardStrip above, deliberately never mixed
// into this grid (see the section header below).

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LaneSummary, VendorSummary, UnsolicitedLane, RfxCostAssumptionDefaults as RfxCostAssumptionDefaultsValue } from "@/lib/db/queries/getComparisonData";
import type { LandedCostResult } from "@/lib/scoring/computeLandedCost";
import type { VendorScoreResult } from "@/lib/scoring/computeScores";
import type { ResolvedCostAssumptions } from "@/lib/scoring/costAssumptions";
import { formatInr } from "./format";
import { VendorScorecardStrip } from "./VendorScorecardStrip";
import { RfxCostAssumptionDefaults } from "./RfxCostAssumptionDefaults";
import { LaneDetailView } from "./LaneDetailView";

type LandedCostGridPlain = Record<string, Record<string, LandedCostResult>>;

function statusMicrocopy(result: LandedCostResult): { text: string; className: string } | null {
  if (!result.isPartial) return null;
  const n = result.excludedReasons.length;
  return {
    text: `partial (${n} charge${n === 1 ? "" : "s"} excluded)`,
    className: "text-warning-foreground",
  };
}

function LaneVendorCell({
  lane,
  vendor,
  result,
}: {
  lane: LaneSummary;
  vendor: VendorSummary;
  result: LandedCostResult | undefined;
}) {
  if (!result || result.status === "not_quoted") {
    return <span className="text-xs text-muted-foreground">not quoted</span>;
  }
  if (result.status === "unreadable") {
    return (
      <Badge variant="destructive" className="text-[11px]">
        Unreadable
      </Badge>
    );
  }

  const micro = statusMicrocopy(result);

  return (
    <Dialog>
      <DialogTrigger className="flex flex-col items-start gap-0.5 text-left hover:underline">
        <span className="font-mono text-sm font-medium tabular-nums">
          {result.totalInr !== null ? formatInr(result.totalInr) : "—"}
        </span>
        {micro && <span className={`text-[11px] font-semibold ${micro.className}`}>{micro.text}</span>}
      </DialogTrigger>
      <DialogContent className="top-0 right-0 bottom-0 left-auto h-full w-full max-w-md translate-x-0 translate-y-0 rounded-none rounded-l-2xl border-l data-open:slide-in-from-right data-closed:slide-out-to-right">
        <DialogHeader>
          <div className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {vendor.code} · {lane.originCity} → {lane.destCity}
          </div>
          <DialogTitle className="text-xl">Landed cost breakdown</DialogTitle>
        </DialogHeader>
        <div className="max-h-[calc(100vh-160px)] space-y-2 overflow-y-auto text-sm">
          {result.lineItems.map((li, i) => (
            <div key={i} className="flex items-start justify-between gap-2 border-b border-border pb-2 last:border-0">
              <div>
                <div className="font-medium">{li.label}</div>
                {li.basis && (
                  <div className="text-xs text-muted-foreground">
                    {li.basis}
                    {li.normalizedValue !== null ? ` · raw ${li.normalizedValue}` : ""}
                  </div>
                )}
                {!li.included && li.exclusionReason && (
                  <div className="text-xs font-medium text-warning-foreground">{li.exclusionReason}</div>
                )}
                {li.flagNote && <div className="text-xs text-info-foreground">{li.flagNote}</div>}
                {li.sourceSnippet.quote && (
                  <div className="text-xs text-muted-foreground italic">&ldquo;{li.sourceSnippet.quote}&rdquo;</div>
                )}
              </div>
              <div className="shrink-0 font-mono text-sm tabular-nums">
                {li.resolvedValueInr !== null ? formatInr(li.resolvedValueInr) : "excluded"}
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-1 font-semibold">
            <span>Total{result.isPartial ? " (partial — some charges excluded above)" : ""}</span>
            <span className="font-mono tabular-nums">{result.totalInr !== null ? formatInr(result.totalInr) : "—"}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function computeVendorTotal(vendorId: string, lanes: LaneSummary[], grid: LandedCostGridPlain) {
  let sum = 0;
  let included = 0;
  for (const lane of lanes) {
    const r = grid[vendorId]?.[lane.id];
    if (r?.totalInr !== null && r?.totalInr !== undefined) {
      sum += r.totalInr;
      included++;
    }
  }
  return { sum, included, missing: lanes.length - included };
}

function toCsv(lanes: LaneSummary[], vendors: VendorSummary[], grid: LandedCostGridPlain): string {
  const header = ["Lane", ...vendors.map((v) => v.code)].join(",");
  const rows = lanes.map((lane) => {
    const cells = vendors.map((v) => {
      const r = grid[v.id]?.[lane.id];
      if (!r || r.totalInr === null) return "";
      return r.isPartial ? `${Math.round(r.totalInr)} (partial)` : String(Math.round(r.totalInr));
    });
    return [`"${lane.originCity} -> ${lane.destCity}"`, ...cells].join(",");
  });
  return [header, ...rows].join("\n");
}

export function ChargesGrid({
  rfxId,
  lanes,
  vendors,
  landedCosts,
  costAssumptionsByLaneId,
  rfxCostAssumptionDefaults,
  unsolicitedLanes,
  vendorScores,
}: {
  rfxId: string;
  lanes: LaneSummary[];
  vendors: VendorSummary[];
  landedCosts: LandedCostGridPlain;
  costAssumptionsByLaneId: Record<string, ResolvedCostAssumptions>;
  rfxCostAssumptionDefaults: RfxCostAssumptionDefaultsValue;
  unsolicitedLanes: UnsolicitedLane[];
  vendorScores: Record<string, VendorScoreResult>;
}) {
  const [view, setView] = useState<"grid" | "lane">("grid");
  const [showUnsolicited, setShowUnsolicited] = useState(false);
  const [sortKey, setSortKey] = useState<"lane" | string>("lane");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const assumptionsUnset =
    rfxCostAssumptionDefaults.avgWeightPerUnitKg == null || rfxCostAssumptionDefaults.referenceInvoiceValueInr == null;
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);

  function openLaneDetail(laneId: string) {
    setSelectedLaneId(laneId);
    setView("lane");
  }

  function toggleSort(key: "lane" | string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedLanes = useMemo(() => {
    const withKey = lanes.map((lane) => {
      const value =
        sortKey === "lane"
          ? `${lane.originCity} → ${lane.destCity}`
          : (landedCosts[sortKey]?.[lane.id]?.totalInr ?? -1);
      return { lane, value };
    });
    withKey.sort((a, b) => {
      if (a.value < b.value) return sortDir === "asc" ? -1 : 1;
      if (a.value > b.value) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return withKey.map((w) => w.lane);
  }, [lanes, sortKey, sortDir, landedCosts]);

  const sortIndicator = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Both this scorecard bar and the description/toggle bar below are
          deliberately omitted entirely (not just collapsed) in lane view —
          "a full blown view for only the lane" was the explicit ask, and a
          collapsed-but-still-rendered bar is still a bar taking a row. */}
      {view === "grid" && (
        <div className="shrink-0 overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => setScorecardOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 bg-muted px-4 py-2 text-left"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-bold">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={`shrink-0 transition-transform ${scorecardOpen ? "rotate-90" : ""}`}>
                <path d="M4 3L8 6L4 9" stroke="var(--color-muted-foreground)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Vendor scorecard
              {!scorecardOpen && assumptionsUnset && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                  cost assumptions not set
                </span>
              )}
            </span>
            <span className="text-[11.5px] font-medium text-muted-foreground">
              {scorecardOpen ? "Hide" : "Show"} scores &amp; cost assumptions
            </span>
          </button>
          {scorecardOpen && (
            <>
              <VendorScorecardStrip vendors={vendors} scores={vendorScores} />
              <RfxCostAssumptionDefaults rfxId={rfxId} defaults={rfxCostAssumptionDefaults} />
            </>
          )}
        </div>
      )}

      {view === "grid" && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <div className="text-[12.5px] font-bold">
            Landed cost per lane, in ₹{" "}
            <span className="font-medium text-muted-foreground">— currency, not a score; rate score above is derived from this</span>
          </div>
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
            <button className="rounded-md bg-card px-3 py-1.5 text-[12.5px] font-semibold shadow-sm">Grid — all lanes</button>
            <button
              onClick={() => setView("lane")}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground"
            >
              Lane detail
            </button>
          </div>
        </div>
      )}

      {view === "lane" ? (
        <div className="min-h-0 flex-1">
          <LaneDetailView
            lanes={sortedLanes}
            vendors={vendors}
            landedCosts={landedCosts}
            costAssumptionsByLaneId={costAssumptionsByLaneId}
            onExitLaneView={() => setView("grid")}
            initialLaneId={selectedLaneId}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const csv = toCsv(lanes, vendors, landedCosts);
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "charges-comparison.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </Button>
          </div>

          {/* Total is a separate table below the scroll area, sharing the same
              <colgroup> as the scrolling one so columns line up exactly —
              deliberately NOT a `sticky`/`<TableFooter>` row inside the
              scrolling table: sticky positioning on a <tfoot> inside a
              scrolling <table> is unreliable across browsers, which was the
              actual cause of the total only being visible after scrolling
              all the way down. A genuinely separate, always-rendered element
              has no such ambiguity. */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-t-md border border-b-0">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: "220px" }} />
                {vendors.map((v) => (
                  <col key={v.id} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="sticky top-0 z-10 cursor-pointer bg-muted text-[12.5px] select-none"
                    onClick={() => toggleSort("lane")}
                  >
                    Lane{sortIndicator("lane")}
                  </TableHead>
                  {vendors.map((vendor) => (
                    <TableHead
                      key={vendor.id}
                      className="sticky top-0 z-10 cursor-pointer bg-muted text-[12.5px] select-none"
                      onClick={() => toggleSort(vendor.id)}
                    >
                      {vendor.code}
                      {sortIndicator(vendor.id)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLanes.map((lane, i) => (
                  <TableRow key={lane.id} className={i % 2 === 1 ? "bg-muted/40" : ""}>
                    <TableCell className="p-0">
                      <button
                        onClick={() => openLaneDetail(lane.id)}
                        className="flex w-full flex-col items-start px-2 py-2 text-left hover:bg-accent/50"
                        title="Open lane detail — every vendor's full breakdown for this lane"
                      >
                        <span className="text-[12.5px] font-semibold text-primary hover:underline">
                          {lane.originCity} → {lane.destCity}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{lane.weightBand}</span>
                      </button>
                    </TableCell>
                    {vendors.map((vendor) => (
                      <TableCell key={vendor.id}>
                        <LaneVendorCell lane={lane} vendor={vendor} result={landedCosts[vendor.id]?.[lane.id]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          <div className="shrink-0 overflow-hidden rounded-b-md border border-t-2 border-t-primary">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: "220px" }} />
                {vendors.map((v) => (
                  <col key={v.id} />
                ))}
              </colgroup>
              <TableBody>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="bg-foreground text-[12.5px] font-bold text-background">Total</TableCell>
                  {vendors.map((vendor) => {
                    const { sum, included, missing } = computeVendorTotal(vendor.id, sortedLanes, landedCosts);
                    return (
                      <TableCell key={vendor.id} className="bg-foreground">
                        <div className="font-mono text-sm font-bold text-background tabular-nums">
                          {included > 0 ? formatInr(sum) : "—"}
                        </div>
                        {missing > 0 && (
                          <div className="text-[11px] text-background/60">{missing} lane{missing === 1 ? "" : "s"} not quoted</div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </table>
          </div>

          {unsolicitedLanes.length > 0 && (
            <div className="shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setShowUnsolicited((s) => !s)}>
                {showUnsolicited ? "Hide" : "Show"} {unsolicitedLanes.length} unsolicited lane
                {unsolicitedLanes.length === 1 ? "" : "s"}
              </Button>
              {showUnsolicited && (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                  {unsolicitedLanes.map((u, i) => {
                    const vendor = vendors.find((v) => v.id === u.vendorId);
                    return (
                      <div key={i} className="flex items-start gap-2">
                        <Badge variant="secondary" className="text-[11px]">
                          {vendor?.code ?? "?"}
                        </Badge>
                        <span>{u.description}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
