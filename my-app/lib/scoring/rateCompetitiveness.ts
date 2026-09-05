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
    // Usable = status === "resolved" — every charge component the vendor
    // quoted on this lane resolved to a real number, none excluded. A
    // "partial" total (e.g. missing per-unit loading or FOV/liability
    // because no unit-count/invoice-value assumption is set) is NOT usable
    // here: comparing a partial sum against another vendor's complete total
    // isn't apples-to-apples — it structurally favors whoever has more
    // missing charges, since exclusions only ever subtract from a total,
    // never add. Requiring full resolution means a lane goes dark on
    // ranking until the buyer sets the assumption(s) it needs (RFx-wide
    // default or a per-lane override — see costAssumptions.ts) rather than
    // silently scoring on an incomplete number. Matches the same
    // fully-resolved-only rule already required for rank_vendor_lanes_by_cost.
    const usable: { vendorId: string; total: number }[] = [];
    for (const vendorId of vendorIds) {
      const result = grid.get(vendorId)?.get(laneId);
      if (result && result.status === "resolved" && result.totalInr !== null) {
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
