// Deterministic "ground truth" rate model the 5 fabricated vendor documents
// are derived from (§4.2 of the functional plan). Not used by the app at
// runtime — this only exists so the demo dataset looks like real PTL pricing
// instead of hand-typed placeholder numbers, and so every vendor's deviation
// from vendor A's baseline is a controlled, known quantity we can verify
// extraction against.

import { CANONICAL_LANES, type CanonicalLane } from "../canonicalLanes";
import { USD_TO_INR } from "../../normalization/currency";

export { USD_TO_INR };

// Small seeded PRNG (mulberry32) so re-running generation is reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REMOTE_DEST_STATES = ["Assam", "Meghalaya", "Himachal Pradesh", "Uttarakhand", "Goa"];
export const GREEN_TAX_STATES = ["Maharashtra", "Karnataka"];
export const ADDITIONAL_LOCATION_DESTS = ["Goa", "Shillong", "Udaipur"];

export type LaneRate = {
  laneIndex: number;
  freightPerKg: number; // INR
  fuelSurchargePctOfFreight: number;
  odaPerKg: number | null; // null if lane isn't remote
  pickupFlat: number;
  loadingPerBox: number; // INR per box, box = 1 unit in the canonical model
  stateCharge: { basis: "inter_state_flat" | "intra_state_flat"; value: number } | null;
  greenTaxFlat: number | null;
  additionalLocationFlat: number | null;
  fovPctOfInvoiceValue: number;
  minChargeableWeightKg: number;
};

function computeLaneRate(lane: CanonicalLane): LaneRate {
  const rand = mulberry32(lane.laneIndex + 1000);
  const isRemote = REMOTE_DEST_STATES.includes(lane.destState);
  const isInterState = lane.originState !== lane.destState;
  const hasGreenTax = GREEN_TAX_STATES.includes(lane.originState) || GREEN_TAX_STATES.includes(lane.destState);
  const hasAdditionalLocation = ADDITIONAL_LOCATION_DESTS.includes(lane.destCity);

  return {
    laneIndex: lane.laneIndex,
    freightPerKg: Math.round((4 + rand() * 5) * 100) / 100, // ₹4-9/kg
    fuelSurchargePctOfFreight: Math.round((8 + rand() * 4) * 10) / 10, // 8-12%
    odaPerKg: isRemote ? Math.round((2 + rand() * 2) * 100) / 100 : null,
    pickupFlat: Math.round(150 + rand() * 250),
    loadingPerBox: Math.round((5 + rand() * 6) * 10) / 10,
    stateCharge: isInterState
      ? { basis: "inter_state_flat", value: Math.round(80 + rand() * 120) }
      : { basis: "intra_state_flat", value: Math.round(20 + rand() * 40) },
    greenTaxFlat: hasGreenTax ? Math.round(30 + rand() * 40) : null,
    additionalLocationFlat: hasAdditionalLocation ? Math.round(100 + rand() * 150) : null,
    fovPctOfInvoiceValue: Math.round((0.15 + rand() * 0.15) * 100) / 100,
    minChargeableWeightKg: Number(lane.weightBand.split("-")[0]),
  };
}

export const BASE_RATES: LaneRate[] = CANONICAL_LANES.map(computeLaneRate);

export function getBaseRate(laneIndex: number): LaneRate {
  const rate = BASE_RATES[laneIndex];
  if (!rate) throw new Error(`No base rate for lane index ${laneIndex}`);
  return rate;
}
