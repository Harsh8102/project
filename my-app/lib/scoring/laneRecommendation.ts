// Deterministic "what this means for this lane" narrative for the Lane
// Detail view — no LLM involved, same trust rule as the rest of scoring
// (lib/scoring/computeScores.ts, computeLandedCost.ts): the system explains
// itself in code, never by prompting a model to write plausible-sounding
// copy about numbers it didn't compute.

import type { LandedCostResult } from "./computeLandedCost";

const LOW_COVERAGE_THRESHOLD = 0.5;

export type LaneInsight = {
  vendorId: string;
  vendorCode: string;
  kind: "best_overall" | "cheapest_limited_coverage" | "safer_alternative" | "cheaper_but_partial";
  detail: string;
};

export type LaneRecommendation = {
  hasUsableBid: boolean;
  insights: LaneInsight[];
};

export function computeLaneRecommendation(params: {
  laneId: string;
  totalLaneCount: number;
  vendors: { id: string; code: string }[];
  landedCosts: Record<string, Record<string, LandedCostResult>>; // vendorId -> laneId -> result
}): LaneRecommendation {
  const { laneId, totalLaneCount, vendors, landedCosts } = params;

  const coverageByVendor = new Map<string, number>();
  for (const v of vendors) {
    const laneMap = landedCosts[v.id];
    const covered = laneMap ? Object.values(laneMap).filter((r) => r.totalInr !== null).length : 0;
    coverageByVendor.set(v.id, totalLaneCount > 0 ? covered / totalLaneCount : 0);
  }

  const usable = vendors
    .map((v) => ({ vendor: v, result: landedCosts[v.id]?.[laneId] }))
    .filter((x): x is { vendor: typeof x.vendor; result: LandedCostResult } => x.result !== undefined && x.result.totalInr !== null)
    .sort((a, b) => a.result.totalInr! - b.result.totalInr!);

  if (usable.length === 0) {
    return { hasUsableBid: false, insights: [] };
  }

  const cheapest = usable[0];
  const cheapestCoverage = coverageByVendor.get(cheapest.vendor.id) ?? 0;
  const insights: LaneInsight[] = [];

  const reliable = usable.find((x) => (coverageByVendor.get(x.vendor.id) ?? 0) >= LOW_COVERAGE_THRESHOLD);

  if (cheapestCoverage < LOW_COVERAGE_THRESHOLD) {
    const coveredLanes = Math.round(cheapestCoverage * totalLaneCount);
    insights.push({
      vendorId: cheapest.vendor.id,
      vendorCode: cheapest.vendor.code,
      kind: "cheapest_limited_coverage",
      detail: `is cheapest (${cheapest.result.totalInr !== null ? Math.round(cheapest.result.totalInr) : "—"}) but only quotes ${coveredLanes} of your ${totalLaneCount} lanes overall — not a dependable primary vendor for this lane specifically.`,
    });
    if (reliable && reliable.vendor.id !== cheapest.vendor.id) {
      insights.push({
        vendorId: reliable.vendor.id,
        vendorCode: reliable.vendor.code,
        kind: "safer_alternative",
        detail: `is the safer comparison among vendors bidding broadly across the RFx${reliable.result.isPartial ? " (partial — some charges excluded, see breakdown)" : " — fully resolved, nothing excluded"}.`,
      });
    }
  } else {
    insights.push({
      vendorId: cheapest.vendor.id,
      vendorCode: cheapest.vendor.code,
      kind: "best_overall",
      detail: `is cheapest on this lane and bids broadly across the RFx${cheapest.result.isPartial ? " (partial — some charges excluded, see breakdown below)" : " — fully resolved, nothing excluded"}.`,
    });
  }

  // If the cheapest usable bid is partial, and a nearby fully-resolved bid exists, flag that the real gap may be smaller than it looks.
  const primary = insights[0].vendorId === cheapest.vendor.id ? cheapest : reliable ?? cheapest;
  if (primary.result.isPartial) {
    const fullyResolvedCloseBy = usable.find(
      (x) => !x.result.isPartial && x.vendor.id !== primary.vendor.id && x.result.totalInr! <= primary.result.totalInr! * 1.15
    );
    if (fullyResolvedCloseBy) {
      insights.push({
        vendorId: primary.vendor.id,
        vendorCode: primary.vendor.code,
        kind: "cheaper_but_partial",
        detail: `looks cheaper, but that number is missing ${primary.result.excludedReasons.length} charge${primary.result.excludedReasons.length === 1 ? "" : "s"} that ${fullyResolvedCloseBy.vendor.code}'s fully-resolved total already includes — the real gap is probably smaller than it appears, not larger.`,
      });
    }
  }

  return { hasUsableBid: true, insights };
}
