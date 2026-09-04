// A persistent, at-a-glance scorecard above the Charges grid — the direct
// fix for "I have to click every cell to understand a transporter." Reads
// real VendorScoreResult data (lib/scoring/computeScores.ts), nothing new
// computed here — purely presentational.

import type { VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { VendorScoreResult } from "@/lib/scoring/computeScores";

function gateReason(result: VendorScoreResult): string {
  return result.gateFailures[0]?.reason ?? "Excluded from ranking";
}

export function VendorScorecardStrip({
  vendors,
  scores,
}: {
  vendors: VendorSummary[];
  scores: Record<string, VendorScoreResult>;
}) {
  return (
    <div className="grid grid-cols-[240px_repeat(5,1fr)] gap-px overflow-hidden border-t border-border bg-border">
      <div className="flex flex-col justify-center gap-0.5 bg-muted px-4 py-3">
        <div className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Vendor scorecard</div>
        <div className="text-[11.5px] font-semibold text-primary">scores (0–100) — how these are calculated</div>
      </div>
      {vendors.map((vendor) => {
        const result = scores[vendor.id];
        const passed = result && !result.excludedFromRanking;
        return (
          <div key={vendor.id} className="flex flex-col gap-1 bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[12.5px] font-bold" title={`${vendor.code} — ${vendor.name}`}>
                {vendor.code} — {vendor.name}
              </div>
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${passed ? "bg-success" : "bg-danger"}`}
              />
            </div>
            {passed ? (
              <>
                <div className="font-mono text-xl font-bold">
                  {result.overallScore ?? "—"} <span className="text-xs font-medium text-muted-foreground">overall score</span>
                </div>
                <div className="flex gap-2 text-[11px] text-muted-foreground">
                  <span>rate score {result.rateCompetitivenessScore ?? "—"}</span>
                  <span>quest. {result.questionnaire?.sectionScore ?? "—"}</span>
                  <span>terms {result.terms?.sectionScore ?? "—"}</span>
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-xl font-bold text-muted-foreground">
                  — <span className="text-xs font-medium">excluded from ranking</span>
                </div>
                <div className="text-[11px] text-danger-foreground">{result ? gateReason(result) : "Not evaluated"}</div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
