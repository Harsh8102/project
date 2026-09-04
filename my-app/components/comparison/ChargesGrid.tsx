"use client";

// The 30-lane x 5-vendor charges comparison grid (§8.2.1 of the functional
// plan). Every cell is a landed-cost total resolved by
// lib/scoring/computeLandedCost.ts — clicking it opens the line items that
// made up (or were excluded from) that total, so a buyer can verify without
// leaving the app (§7).

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LaneSummary, VendorSummary, UnsolicitedLane } from "@/lib/db/queries/getComparisonData";
import type { LandedCostResult } from "@/lib/scoring/computeLandedCost";
import { formatInr } from "./format";

type LandedCostGridPlain = Record<string, Record<string, LandedCostResult>>;

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
    return <span className="text-xs text-muted-foreground">Not quoted</span>;
  }
  if (result.status === "unreadable") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Unreadable
      </Badge>
    );
  }

  return (
    <Dialog>
      <DialogTrigger className="flex flex-col items-start gap-0.5 text-left hover:underline">
        <span className="text-sm font-medium tabular-nums">
          {result.totalInr !== null ? formatInr(result.totalInr) : "—"}
        </span>
        {result.isPartial && (
          <Badge variant="outline" className="text-[10px]">
            partial
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {vendor.code} — {lane.originCity} → {lane.destCity}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
          {result.lineItems.map((li, i) => (
            <div key={i} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
              <div>
                <div className="font-medium">{li.label}</div>
                {li.basis && (
                  <div className="text-xs text-muted-foreground">
                    {li.basis}
                    {li.normalizedValue !== null ? ` · raw ${li.normalizedValue}` : ""}
                  </div>
                )}
                {!li.included && li.exclusionReason && (
                  <div className="text-xs text-destructive">{li.exclusionReason}</div>
                )}
                {li.flagNote && <div className="text-xs text-amber-600">{li.flagNote}</div>}
                {li.sourceSnippet.quote && (
                  <div className="text-xs italic text-muted-foreground">&ldquo;{li.sourceSnippet.quote}&rdquo;</div>
                )}
              </div>
              <div className="shrink-0 text-sm tabular-nums">
                {li.resolvedValueInr !== null ? formatInr(li.resolvedValueInr) : "excluded"}
              </div>
            </div>
          ))}
          <div className="flex justify-between pt-1 font-semibold">
            <span>Total{result.isPartial ? " (partial — some charges excluded above)" : ""}</span>
            <span className="tabular-nums">{result.totalInr !== null ? formatInr(result.totalInr) : "—"}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  lanes,
  vendors,
  landedCosts,
  unsolicitedLanes,
}: {
  lanes: LaneSummary[];
  vendors: VendorSummary[];
  landedCosts: LandedCostGridPlain;
  unsolicitedLanes: UnsolicitedLane[];
}) {
  const [showUnsolicited, setShowUnsolicited] = useState(false);
  const [sortKey, setSortKey] = useState<"lane" | string>("lane");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Click any total to see the charges (and any excluded ones) behind it.
        </p>
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("lane")}>
                Lane{sortIndicator("lane")}
              </TableHead>
              {vendors.map((vendor) => (
                <TableHead
                  key={vendor.id}
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort(vendor.id)}
                >
                  {vendor.code}
                  {sortIndicator(vendor.id)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLanes.map((lane) => (
              <TableRow key={lane.id}>
                <TableCell>
                  <div className="font-medium">
                    {lane.originCity} → {lane.destCity}
                  </div>
                  <div className="text-xs text-muted-foreground">{lane.weightBand}</div>
                </TableCell>
                {vendors.map((vendor) => (
                  <TableCell key={vendor.id}>
                    <LaneVendorCell lane={lane} vendor={vendor} result={landedCosts[vendor.id]?.[lane.id]} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {unsolicitedLanes.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowUnsolicited((s) => !s)}>
            {showUnsolicited ? "Hide" : "Show"} {unsolicitedLanes.length} unsolicited lane
            {unsolicitedLanes.length === 1 ? "" : "s"}
          </Button>
          {showUnsolicited && (
            <div className="mt-2 space-y-1 rounded-md border p-2 text-sm">
              {unsolicitedLanes.map((u, i) => {
                const vendor = vendors.find((v) => v.id === u.vendorId);
                return (
                  <div key={i} className="flex items-start gap-2">
                    <Badge variant="secondary" className="text-[10px]">
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
  );
}
