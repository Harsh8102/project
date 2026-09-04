// Resolves the real-world reference values landed-cost computation needs
// but nothing in a vendor's document provides — see
// docs/charge-normalization-unit-economics.md for why these can't be
// silently guessed, and the breakeven-analysis planning conversation for
// the resolution order below.
//
// Precedence, per field: lane override > RFx-wide default > (weight only)
// the lane's own weight-band midpoint > unset. Nothing here invents a
// number — "unset" is a real, honest outcome, and callers must treat it as
// "this charge stays excluded," never fall back to a guess of their own.

import { parseWeightBandMidpointKg } from "./computeLandedCost";

export type AssumptionSource = "lane_override" | "rfx_default" | "band_midpoint" | "unset";

export type ResolvedAssumption = { value: number | null; source: AssumptionSource };

export type ResolvedCostAssumptions = {
  referenceWeightKg: ResolvedAssumption;
  avgWeightPerUnitKg: ResolvedAssumption;
  referenceInvoiceValueInr: ResolvedAssumption;
  // Derived, not independently settable: unitCount = weight / avgWeightPerUnitKg.
  // Keeping weight and box-count physically consistent with each other was
  // the whole point of NOT giving them two independent sliders.
  unitCount: ResolvedAssumption;
};

export type CostAssumptionOverrides = {
  referenceWeightKg?: number | null;
  avgWeightPerUnitKg?: number | null;
  referenceInvoiceValueInr?: number | null;
};

export type CostAssumptionDefaults = {
  avgWeightPerUnitKg?: number | null;
  referenceInvoiceValueInr?: number | null;
};

export function resolveCostAssumptions(params: {
  weightBand: string;
  laneOverrides?: CostAssumptionOverrides | null;
  rfxDefaults?: CostAssumptionDefaults | null;
}): ResolvedCostAssumptions {
  const bandMidpointKg = parseWeightBandMidpointKg(params.weightBand);

  const referenceWeightKg: ResolvedAssumption =
    params.laneOverrides?.referenceWeightKg != null
      ? { value: params.laneOverrides.referenceWeightKg, source: "lane_override" }
      : bandMidpointKg != null
        ? { value: bandMidpointKg, source: "band_midpoint" }
        : { value: null, source: "unset" };

  const avgWeightPerUnitKg: ResolvedAssumption =
    params.laneOverrides?.avgWeightPerUnitKg != null
      ? { value: params.laneOverrides.avgWeightPerUnitKg, source: "lane_override" }
      : params.rfxDefaults?.avgWeightPerUnitKg != null
        ? { value: params.rfxDefaults.avgWeightPerUnitKg, source: "rfx_default" }
        : { value: null, source: "unset" };

  const referenceInvoiceValueInr: ResolvedAssumption =
    params.laneOverrides?.referenceInvoiceValueInr != null
      ? { value: params.laneOverrides.referenceInvoiceValueInr, source: "lane_override" }
      : params.rfxDefaults?.referenceInvoiceValueInr != null
        ? { value: params.rfxDefaults.referenceInvoiceValueInr, source: "rfx_default" }
        : { value: null, source: "unset" };

  const unitCount: ResolvedAssumption =
    referenceWeightKg.value != null && avgWeightPerUnitKg.value != null && avgWeightPerUnitKg.value > 0
      ? { value: referenceWeightKg.value / avgWeightPerUnitKg.value, source: avgWeightPerUnitKg.source }
      : { value: null, source: "unset" };

  return { referenceWeightKg, avgWeightPerUnitKg, referenceInvoiceValueInr, unitCount };
}
