// Deterministic step (§7 trust rule: the LLM extracts, code reasons/computes).
// Takes the region matrix Gemini extracted — using the VENDOR's OWN declared
// region-to-city definitions, not our internal canonical regions.ts, because
// the vendor's document is what actually governs their pricing structure —
// and resolves it down to a per-lane rate for every canonical lane.

import type { CanonicalLane } from "../../fixtures/canonicalLanes";
import type { RawExtractionResponse } from "./extractRatesChunk";
import { resolveChargeKey } from "./chargeMapping";

export type ResolvedLaneCharge = {
  fieldKey: string | null;
  rawHeaderLabel: string;
  rawValue: string;
  basis: string;
  currency: string;
  confidence: number;
  sourceQuote: string;
};

export type ResolvedLaneRate =
  | { laneIndex: number; status: "resolved"; minChargeableWeightKg: number; charges: ResolvedLaneCharge[] }
  | { laneIndex: number; status: "city_not_defined"; reason: string }
  | { laneIndex: number; status: "region_pair_not_served"; reason: string };

function findRegionForCity(city: string, regionDefinitions: RawExtractionResponse["regionMatrix"]["regionDefinitions"]): string | null {
  const normalized = city.trim().toLowerCase();
  for (const def of regionDefinitions) {
    if (def.cities.some((c) => c.trim().toLowerCase() === normalized)) return def.regionLabel;
  }
  return null;
}

export function resolveRegionMatrixToLanes(
  matrix: RawExtractionResponse["regionMatrix"],
  lanes: CanonicalLane[]
): ResolvedLaneRate[] {
  const flatResolved: ResolvedLaneCharge[] = matrix.flatCharges.map((c) => {
    const resolution = resolveChargeKey(c.rawHeaderLabel, c.suggestedTaxonomyKey, c.confidence);
    return {
      fieldKey: resolution.key,
      rawHeaderLabel: c.rawHeaderLabel,
      rawValue: c.value,
      basis: c.basis,
      currency: c.currency,
      confidence: resolution.confidence,
      sourceQuote: c.sourceQuote,
    };
  });

  return lanes.map((lane): ResolvedLaneRate => {
    const originRegion = findRegionForCity(lane.originCity, matrix.regionDefinitions);
    const destRegion = findRegionForCity(lane.destCity, matrix.regionDefinitions);

    if (!originRegion || !destRegion) {
      const missing = [!originRegion ? lane.originCity : null, !destRegion ? lane.destCity : null].filter(Boolean).join(" and ");
      return {
        laneIndex: lane.laneIndex,
        status: "city_not_defined",
        reason: `${missing} not listed in any zone the vendor defined — cannot resolve a region`,
      };
    }

    const cell = matrix.cells.find((c) => c.fromRegionLabel === originRegion && c.toRegionLabel === destRegion);
    if (!cell) {
      return {
        laneIndex: lane.laneIndex,
        status: "region_pair_not_served",
        reason: `No rate quoted for ${originRegion} -> ${destRegion} (lane resolved to this zone pair, but the matrix has no cell for it)`,
      };
    }

    const freightCharge: ResolvedLaneCharge = {
      fieldKey: "freight_charge",
      rawHeaderLabel: `${cell.fromRegionLabel} -> ${cell.toRegionLabel} zone rate`,
      rawValue: cell.ratePerKg,
      basis: "per_kg",
      currency: cell.currency,
      confidence: cell.confidence,
      sourceQuote: cell.sourceQuote,
    };

    return {
      laneIndex: lane.laneIndex,
      status: "resolved",
      minChargeableWeightKg: cell.minGuaranteedWeightKg,
      charges: [freightCharge, ...flatResolved],
    };
  });
}
