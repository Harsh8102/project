// Same-basis ("Nos") unit-economics ranking — see
// docs/charge-normalization-unit-economics.md for the full reasoning.
//
// When 2+ vendors quote the SAME charge type on a per_unit basis for the
// same lane, their ₹/unit rates are directly comparable without inventing
// any reference quantity: "box" and "carton" are both just packaging
// vocabulary for a count, so ranking raw ₹/unit rates against each other
// is safe — the (unknown) actual unit count would multiply through
// identically on every side and cancel out of the ranking.
//
// This deliberately does NOT attempt to bridge a per_unit charge against a
// flat charge (that needs a real reference count with no safe default —
// see the doc) and never touches the landed-cost total or score; it's an
// additional, separate comparison surface only.

export type UnitEconomicsEntry = { vendorId: string; ratePerUnitInr: number };

export type UnitEconomicsRank = {
  vendorId: string;
  rank: number;
  outOf: number;
  ratePerUnitInr: number;
  isCheapest: boolean;
};

export function rankUnitEconomics(entries: UnitEconomicsEntry[]): UnitEconomicsRank[] {
  if (entries.length < 2) return []; // nothing to rank a single quote against
  const sorted = [...entries].sort((a, b) => a.ratePerUnitInr - b.ratePerUnitInr);
  return sorted.map((e, i) => ({
    vendorId: e.vendorId,
    rank: i + 1,
    outOf: sorted.length,
    ratePerUnitInr: e.ratePerUnitInr,
    isCheapest: i === 0,
  }));
}
