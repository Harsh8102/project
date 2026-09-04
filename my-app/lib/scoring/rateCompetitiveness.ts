// Turns per-lane landed costs (computeLandedCost.ts) into the
// rate_competitiveness input computeVendorScore expects (§3.5 of the
// functional plan). Relative, not benchmark-based, by deliberate product
// decision — see aerchain-implementation-plan.md §3.5: "cheapest wins" only
// means something relative to the vendors who actually bid on a lane, unlike
// the questionnaire/terms fields which score against an absolute buyer
// target. Pure function — no DB, no I/O — so it's cheap to check against
// hand-built cases before wiring it into the query layer.

import type { LandedCostResult } from "./computeLandedCost";

/** vendorId -> laneId -> that vendor's landed cost result for that lane. */
export type LandedCostGrid = Map<string, Map<string, LandedCostResult>>;

/**
 * Per lane: the cheapest vendor with a usable total (see below) scores 100;
 * every other vendor on that lane scores max(0, 100 - pctMoreExpensive).
 * A lane where fewer than 2 vendors have a usable total can't be judged
 * relatively and is skipped entirely for every vendor on it — not scored as
 * a trivial 100 for being the sole bidder.
 *
 * A vendor's overall score is the average of its per-lane scores over lanes
 * that were actually comparable for it. null if it had no comparable lanes
 * at all (e.g. it quoted nothing usable, or was always the sole quoter).
 */
export function computeRateCompetitiveness(grid: LandedCostGrid): Map<string, number | null> {
  const vendorIds = [...grid.keys()];

  const laneIds = new Set<string>();
  for (const laneMap of grid.values()) {
    for (const laneId of laneMap.keys()) laneIds.add(laneId);
  }

  const perVendorLaneScores = new Map<string, number[]>();
  for (const vendorId of vendorIds) perVendorLaneScores.set(vendorId, []);

  for (const laneId of laneIds) {
    // Usable = at least one charge component resolved (totalInr !== null).
    // Deliberately NOT restricted to fully-resolved (non-partial) totals:
    // in the real dataset, charges like per-unit loading and FOV/liability
    // (% of invoice value) are excluded from nearly every vendor's total
    // (see computeLandedCost.ts) because there's no reliable unit count or
    // invoice value to resolve them with — requiring a fully complete total
    // would leave almost no vendor ever comparable, going dark on ranking
    // for the whole build rather than giving a slightly incomplete but
    // consistent signal. The `isPartial` flag stays visible on the totals
    // themselves (grid badge, review queue) so the buyer can judge how much
    // to trust a given comparison — this only affects whether a lane is
    // used for the automated ranking at all.
    const usable: { vendorId: string; total: number }[] = [];
    for (const vendorId of vendorIds) {
      const result = grid.get(vendorId)?.get(laneId);
      if (result && result.totalInr !== null) {
        usable.push({ vendorId, total: result.totalInr });
      }
    }
    if (usable.length < 2) continue;

    const minTotal = Math.min(...usable.map((u) => u.total));
    for (const { vendorId, total } of usable) {
      const pctMoreExpensive = ((total - minTotal) / minTotal) * 100;
      const score = Math.max(0, Math.round(100 - pctMoreExpensive));
      perVendorLaneScores.get(vendorId)!.push(score);
    }
  }

  const result = new Map<string, number | null>();
  for (const vendorId of vendorIds) {
    const scores = perVendorLaneScores.get(vendorId)!;
    result.set(vendorId, scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null);
  }
  return result;
}
