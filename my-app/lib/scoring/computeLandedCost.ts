// Resolves a vendor's charge line items for one lane into a single
// comparable landed-cost total, in code — never guessed by the LLM (§7 trust
// rule). normalizeCharge.ts deliberately stops at "value + basis"; this is
// the next deterministic step: turning a basis into an actual INR number for
// a reference shipment, and being honest about the charges it can't safely
// resolve rather than guessing a unit count or invoice value that was never
// given (see aerchain-implementation-plan.md §5.3 for the product decision).

import type { FlagType } from "../db/models/ExtractedField";
import { getTaxonomyEntry } from "../normalization/chargeTaxonomy";

export type ChargeFieldRow = {
  fieldKey: string | null;
  rawHeaderLabel: string | null;
  basis: string | null;
  normalizedValue: number | null;
  confidence: number;
  flagType: FlagType | null;
  flagNote: string | null;
  sourceSnippet: { type: "cell" | "page" | "quote"; cellRef?: string | null; page?: number | null; quote?: string | null };
};

export type LandedCostLineItem = {
  fieldKey: string | null;
  label: string;
  basis: string | null;
  normalizedValue: number | null;
  resolvedValueInr: number | null;
  included: boolean;
  exclusionReason: string | null;
  flagType: FlagType | null;
  flagNote: string | null;
  sourceSnippet: ChargeFieldRow["sourceSnippet"];
};

export type LandedCostStatus = "resolved" | "partial" | "not_quoted" | "unreadable";

export type LandedCostResult = {
  totalInr: number | null;
  isPartial: boolean;
  status: LandedCostStatus;
  excludedReasons: string[];
  lineItems: LandedCostLineItem[];
};

const FLAT_BASES = new Set(["flat", "inter_state_flat", "intra_state_flat"]);
const PER_KG_BASES = new Set(["per_kg", "inter_state_per_kg", "intra_state_per_kg"]);

function labelFor(fieldKey: string | null, rawHeaderLabel: string | null): string {
  if (fieldKey) return getTaxonomyEntry(fieldKey)?.label ?? fieldKey;
  return rawHeaderLabel || "Unmapped charge";
}

/** "500-1000 kg" -> 750. Returns null if the band isn't in the expected two-number format. */
export function parseWeightBandMidpointKg(weightBand: string): number | null {
  const nums = weightBand.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  if (nums.length === 1) return nums[0];
  return null;
}

/** Resolves a flat or per-kg value to a per-shipment INR number; null if the basis isn't one of those (caller decides what to do). */
function resolveFlatOrPerKg(value: number, basis: string | null, referenceWeightKg: number | null): number | null {
  if (FLAT_BASES.has(basis ?? "")) return value;
  if (PER_KG_BASES.has(basis ?? "") && referenceWeightKg !== null) return value * referenceWeightKg;
  return null;
}

export function computeLandedCost(rows: ChargeFieldRow[], weightBand: string): LandedCostResult {
  if (rows.length === 0) {
    return { totalInr: null, isPartial: false, status: "not_quoted", excludedReasons: [], lineItems: [] };
  }

  if (rows.length === 1 && rows[0].flagType === "lane_not_quoted") {
    return { totalInr: null, isPartial: false, status: "not_quoted", excludedReasons: [], lineItems: [] };
  }
  if (rows.length === 1 && rows[0].flagType === "unreadable") {
    return { totalInr: null, isPartial: false, status: "unreadable", excludedReasons: [], lineItems: [] };
  }

  const bundledRows = rows.filter((r) => r.flagType === "bundled_all_in");
  const referenceWeightKg = parseWeightBandMidpointKg(weightBand);

  if (bundledRows.length > 0) {
    // Bundled still means "one line item covers everything" — it does NOT
    // mean the reported value is already a per-shipment total. A vendor can
    // (and does, in this dataset) bundle everything into one line that's
    // still quoted per_kg, e.g. "₹9.41/kg, all-in" — so the same basis
    // resolution applies to it as to any other charge.
    const lineItems: LandedCostLineItem[] = [];
    let totalInr = 0;
    let anyBundledResolved = false;
    let anyBundledExcluded = false;

    for (const r of rows) {
      const label = labelFor(r.fieldKey, r.rawHeaderLabel);
      const isBundled = r.flagType === "bundled_all_in";

      if (!isBundled) {
        lineItems.push({
          fieldKey: r.fieldKey,
          label,
          basis: r.basis,
          normalizedValue: r.normalizedValue,
          resolvedValueInr: null,
          included: false,
          exclusionReason: "Covered by the vendor's bundled all-in rate",
          flagType: r.flagType,
          flagNote: r.flagNote,
          sourceSnippet: r.sourceSnippet,
        });
        continue;
      }

      const resolved = r.normalizedValue !== null ? resolveFlatOrPerKg(r.normalizedValue, r.basis, referenceWeightKg) : null;
      if (resolved === null) {
        anyBundledExcluded = true;
        lineItems.push({
          fieldKey: r.fieldKey,
          label,
          basis: r.basis,
          normalizedValue: r.normalizedValue,
          resolvedValueInr: null,
          included: false,
          exclusionReason: `Bundled all-in rate given as "${r.basis}" — couldn't resolve to a per-shipment value`,
          flagType: r.flagType,
          flagNote: r.flagNote,
          sourceSnippet: r.sourceSnippet,
        });
        continue;
      }

      anyBundledResolved = true;
      totalInr += resolved;
      lineItems.push({
        fieldKey: r.fieldKey,
        label,
        basis: r.basis,
        normalizedValue: r.normalizedValue,
        resolvedValueInr: resolved,
        included: true,
        exclusionReason: null,
        flagType: r.flagType,
        flagNote: r.flagNote,
        sourceSnippet: r.sourceSnippet,
      });
    }

    if (!anyBundledResolved) {
      return {
        totalInr: null,
        isPartial: true,
        status: "partial",
        excludedReasons: ["Bundled all-in rate could not be resolved to a per-shipment value"],
        lineItems,
      };
    }

    return {
      totalInr,
      isPartial: anyBundledExcluded,
      status: anyBundledExcluded ? "partial" : "resolved",
      excludedReasons: anyBundledExcluded ? ["Part of the bundled all-in rate could not be resolved"] : [],
      lineItems,
    };
  }

  // Resolve freight_charge first — pct_of_freight charges need it.
  const freightRow = rows.find((r) => r.fieldKey === "freight_charge");
  const freightResolvedInr =
    freightRow && freightRow.normalizedValue !== null && !freightRow.flagType
      ? resolveFlatOrPerKg(freightRow.normalizedValue, freightRow.basis, referenceWeightKg)
      : null;

  const lineItems: LandedCostLineItem[] = [];
  const excludedReasons: string[] = [];
  let totalInr = 0;
  let anyIncluded = false;

  for (const row of rows) {
    const label = labelFor(row.fieldKey, row.rawHeaderLabel);
    const base: Omit<LandedCostLineItem, "included" | "exclusionReason" | "resolvedValueInr"> = {
      fieldKey: row.fieldKey,
      label,
      basis: row.basis,
      normalizedValue: row.normalizedValue,
      flagType: row.flagType,
      flagNote: row.flagNote,
      sourceSnippet: row.sourceSnippet,
    };

    const exclude = (reason: string) => {
      excludedReasons.push(`${label}: ${reason}`);
      lineItems.push({ ...base, resolvedValueInr: null, included: false, exclusionReason: reason });
    };

    if (row.normalizedValue === null) {
      exclude(row.flagNote ?? "No numeric value extracted");
      continue;
    }
    if (row.flagType === "unreadable") {
      exclude("Illegible in the source document");
      continue;
    }
    if (row.flagType === "unmapped_header" || !row.fieldKey) {
      exclude(`Header "${row.rawHeaderLabel ?? "unknown"}" did not match a known charge type`);
      continue;
    }
    if (row.flagType === "basis_mismatch") {
      exclude(`Unusual pricing basis "${row.basis}" for this charge — needs manual review`);
      continue;
    }
    if (row.fieldKey === "fov_liability") {
      exclude("Priced as % of invoice value — no invoice value in this comparison");
      continue;
    }
    if (row.basis === "per_unit") {
      exclude("Priced per unit — unit definition varies by vendor, not safely comparable");
      continue;
    }
    if (row.basis === "slab_on_weight") {
      exclude("Given as a weight-slab rate, not resolved to a single comparable value");
      continue;
    }

    let resolvedValueInr: number | null = null;
    if (FLAT_BASES.has(row.basis ?? "")) {
      resolvedValueInr = row.normalizedValue;
    } else if (PER_KG_BASES.has(row.basis ?? "")) {
      if (referenceWeightKg === null) {
        exclude("Priced per kg but the lane's weight band couldn't be parsed");
        continue;
      }
      resolvedValueInr = row.normalizedValue * referenceWeightKg;
    } else if (row.basis === "pct_of_freight") {
      if (freightResolvedInr === null) {
        exclude("Priced as % of freight, but no freight charge was resolved for this lane");
        continue;
      }
      resolvedValueInr = (row.normalizedValue / 100) * freightResolvedInr;
    } else {
      exclude(`Unrecognized pricing basis "${row.basis}"`);
      continue;
    }

    anyIncluded = true;
    totalInr += resolvedValueInr;
    lineItems.push({ ...base, resolvedValueInr, included: true, exclusionReason: null });
  }

  if (!anyIncluded) {
    return { totalInr: null, isPartial: true, status: "partial", excludedReasons, lineItems };
  }

  return {
    totalInr,
    isPartial: excludedReasons.length > 0,
    status: excludedReasons.length > 0 ? "partial" : "resolved",
    excludedReasons,
    lineItems,
  };
}
