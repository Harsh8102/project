"use client";

// §8.2.5 of the functional plan: rate/questionnaire/terms scores per vendor,
// gate failures called out, and an award action that writes a DecisionRecord
// (§3.1/§7 — the award is logged with a frozen justification, not just a
// click). Whole-RFx grain only; per-lane split-award is left to the chat
// agent's simulate_split_award tool in a later phase.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DecisionSummaryRecord, VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { VendorScoreResult } from "@/lib/scoring/computeScores";

function scoreCell(score: number | null) {
  return score === null ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{score}</span>;
}

export function DecisionSummary({
  rfxId,
  vendors,
  scores,
  decisions,
}: {
  rfxId: string;
  vendors: VendorSummary[];
  scores: Record<string, VendorScoreResult>;
  decisions: DecisionSummaryRecord[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [awardingVendorId, setAwardingVendorId] = useState<string | null>(null);

  const wholeRfxAward = decisions.find((d) => d.laneId === null);

  function award(vendorId: string) {
    setAwardingVendorId(vendorId);
    startTransition(async () => {
      await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfxId, vendorId, laneId: null }),
      });
      setAwardingVendorId(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 z-10 bg-muted">Vendor</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted">Rate</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted">Questionnaire</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted">Terms</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted">Overall</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted">Status</TableHead>
            <TableHead className="sticky top-0 z-10 bg-muted" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.map((vendor) => {
            const result = scores[vendor.id];
            if (!result) return null;
            const isAwarded = wholeRfxAward?.vendorId === vendor.id;
            return (
              <TableRow key={vendor.id}>
                <TableCell className="font-medium">
                  {vendor.code} — {vendor.name}
                </TableCell>
                <TableCell>{scoreCell(result.rateCompetitivenessScore)}</TableCell>
                <TableCell>{scoreCell(result.questionnaire?.sectionScore ?? null)}</TableCell>
                <TableCell>{scoreCell(result.terms?.sectionScore ?? null)}</TableCell>
                <TableCell className="font-semibold">{scoreCell(result.overallScore)}</TableCell>
                <TableCell>
                  {result.excludedFromRanking ? (
                    <div className="space-y-1">
                      <Badge variant="destructive">Excluded</Badge>
                      <div className="text-xs text-muted-foreground">
                        {result.gateFailures.map((g) => g.reason).join("; ")}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline">Eligible</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {isAwarded ? (
                    <Badge>Awarded</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={result.excludedFromRanking || (pending && awardingVendorId === vendor.id) || !!wholeRfxAward}
                      onClick={() => award(vendor.id)}
                    >
                      {pending && awardingVendorId === vendor.id ? "Awarding…" : "Award"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
