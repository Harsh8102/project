// Resolves a vendor's charge line items for one lane into a single
// comparable landed-cost total, in code — never guessed by the LLM (§7 trust
// rule). normalizeCharge.ts deliberately stops at "value + basis"; this is
// the next deterministic step: turning a basis into an actual INR number.
//
// per_unit and pct_of_invoice_value need a reference (unit count, invoice
// value) that no vendor document provides — these resolve ONLY when the
// caller supplies a real assumption (lib/scoring/costAssumptions.ts;
// buyer-set, always labeled, never silently invented — see
// docs/charge-normalization-unit-economics.md and
// aerchain-implementation-plan.md §5.3). Absent that, they stay excluded,
// exactly as before this was possible at all.

import type { FlagType } from "../db/models/ExtractedField";
import { getTaxonomyEntry } from "../normalization/chargeTaxonomy";
import type { AssumptionSource, ResolvedCostAssumptions } from "./costAssumptions";

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
  // Which assumption (if any) this line item's resolved value depends on —
  // null for a charge resolved purely from the vendor's own flat number.
  // "band_midpoint" and "lane_override"/"rfx_default" are distinguished so
  // the UI can show "this is today's existing default" vs. "you set this."
  assumptionSource: AssumptionSource | null;
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

export function computeLandedCost(rows: ChargeFieldRow[], assumptions: ResolvedCostAssumptions): LandedCostResult {
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
  const referenceWeightKg = assumptions.referenceWeightKg.value;
  const weightSource = assumptions.referenceWeightKg.source;

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
          assumptionSource: null,
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
          assumptionSource: null,
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
        assumptionSource: PER_KG_BASES.has(r.basis ?? "") ? weightSource : null,
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

  // Resolve freight_charge first — pct_of_freight charges need it, and (if
  // freight itself is weight-dependent) inherit its assumption source too,
  // since a fuel surcharge on a per_kg freight is indirectly weight-driven.
  const freightRow = rows.find((r) => r.fieldKey === "freight_charge");
  const freightResolvedInr =
    freightRow && freightRow.normalizedValue !== null && !freightRow.flagType
      ? resolveFlatOrPerKg(freightRow.normalizedValue, freightRow.basis, referenceWeightKg)
      : null;
  const freightAssumptionSource: AssumptionSource | null =
    freightRow && PER_KG_BASES.has(freightRow.basis ?? "") ? weightSource : null;

  const unitCount = assumptions.unitCount.value;
  const unitCountSource = assumptions.unitCount.source;
  const invoiceValueInr = assumptions.referenceInvoiceValueInr.value;
  const invoiceValueSource = assumptions.referenceInvoiceValueInr.source;

  const lineItems: LandedCostLineItem[] = [];
  const excludedReasons: string[] = [];
  let totalInr = 0;
  let anyIncluded = false;

  for (const row of rows) {
    const label = labelFor(row.fieldKey, row.rawHeaderLabel);
    const base: Omit<LandedCostLineItem, "included" | "exclusionReason" | "resolvedValueInr" | "assumptionSource"> = {
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
      lineItems.push({ ...base, resolvedValueInr: null, included: false, exclusionReason: reason, assumptionSource: null });
    };
    const include = (resolvedValueInr: number, assumptionSource: AssumptionSource | null) => {
      anyIncluded = true;
      totalInr += resolvedValueInr;
      lineItems.push({ ...base, resolvedValueInr, included: true, exclusionReason: null, assumptionSource });
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
    if (row.fieldKey === "fov_liability" && row.basis === "pct_of_invoice_value") {
      if (invoiceValueInr === null) {
        exclude("Priced as % of invoice value — no invoice value assumption set for this RFx/lane");
      } else {
        include((row.normalizedValue / 100) * invoiceValueInr, invoiceValueSource);
      }
      continue;
    }
    if (row.basis === "per_unit") {
      if (unitCount === null) {
        exclude("Priced per unit — no unit-count assumption set for this RFx/lane (needs a weight and an avg weight/unit)");
      } else {
        include(row.normalizedValue * unitCount, unitCountSource);
      }
      continue;
    }
    if (row.basis === "slab_on_weight") {
      exclude("Given as a weight-slab rate, not resolved to a single comparable value");
      continue;
    }

    if (FLAT_BASES.has(row.basis ?? "")) {
      include(row.normalizedValue, null);
    } else if (PER_KG_BASES.has(row.basis ?? "")) {
      if (referenceWeightKg === null) {
        exclude("Priced per kg but the lane's weight band couldn't be parsed");
      } else {
        include(row.normalizedValue * referenceWeightKg, weightSource);
      }
    } else if (row.basis === "pct_of_freight") {
      if (freightResolvedInr === null) {
        exclude("Priced as % of freight, but no freight charge was resolved for this lane");
      } else {
        include((row.normalizedValue / 100) * freightResolvedInr, freightAssumptionSource);
      }
    } else {
      exclude(`Unrecognized pricing basis "${row.basis}"`);
    }
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
