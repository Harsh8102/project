// Breakeven / dominance analysis between two vendors on one lane — the
// generic technique from the breakeven-analysis planning conversation,
// applied to this app's real (finite, known) variable set: weight and
// invoice value. Unit count deliberately isn't a third independent
// variable here — it's derived (weight / avgWeightPerUnitKg), so a
// per_unit charge's cost contribution collapses into a weight coefficient
// once avgWeightPerUnitKg is held fixed. See
// docs/charge-normalization-unit-economics.md and
// lib/scoring/costAssumptions.ts for how that value gets set.
//
// Every function here is pure — no DB access, no LLM — so a caller can
// build a formula from a real LandedCostResult, run these, and trust the
// output traces directly back to real, cited numbers.

import type { LandedCostLineItem } from "./computeLandedCost";

const FLAT_BASES = new Set(["flat", "inter_state_flat", "intra_state_flat"]);
const PER_KG_BASES = new Set(["per_kg", "inter_state_per_kg", "intra_state_per_kg"]);

export type CostFormula = {
  fixed: number;
  weightCoefficient: number; // INR per kg
  invoiceValueCoefficient: number; // INR per INR of invoice value (the % as a decimal)
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyBasic(li: LandedCostLineItem, avgWeightPerUnitKg: number | null): { fixed: number; weightCoef: number } {
  if (li.normalizedValue === null) return { fixed: 0, weightCoef: 0 };
  const basis = li.basis ?? "";
  if (FLAT_BASES.has(basis)) return { fixed: li.normalizedValue, weightCoef: 0 };
  if (PER_KG_BASES.has(basis)) return { fixed: 0, weightCoef: li.normalizedValue };
  if (basis === "per_unit" && avgWeightPerUnitKg) return { fixed: 0, weightCoef: li.normalizedValue / avgWeightPerUnitKg };
  return { fixed: 0, weightCoef: 0 };
}

/**
 * Builds `Total = fixed + weightCoefficient*weight + invoiceValueCoefficient*invoiceValue`
 * from a vendor's already-resolved line items on one lane. Only INCLUDED
 * items contribute — anything still excluded (slab_on_weight, or per_unit/
 * pct_of_invoice_value with no assumption set) is honestly left out of the
 * formula too, exactly as it's left out of the total shown elsewhere.
 */
export function buildCostFormula(lineItems: LandedCostLineItem[], avgWeightPerUnitKg: number | null): CostFormula {
  let fixed = 0;
  let weightCoefficient = 0;
  let invoiceValueCoefficient = 0;

  const freightItem = lineItems.find((li) => li.fieldKey === "freight_charge" && li.included);
  const freightClass = freightItem ? classifyBasic(freightItem, avgWeightPerUnitKg) : { fixed: 0, weightCoef: 0 };

  for (const li of lineItems) {
    if (!li.included || li.normalizedValue === null) continue;
    const basis = li.basis ?? "";

    if (basis === "pct_of_freight") {
      const pct = li.normalizedValue / 100;
      fixed += pct * freightClass.fixed;
      weightCoefficient += pct * freightClass.weightCoef;
      continue;
    }
    if (basis === "pct_of_invoice_value") {
      invoiceValueCoefficient += li.normalizedValue / 100;
      continue;
    }
    const c = classifyBasic(li, avgWeightPerUnitKg);
    fixed += c.fixed;
    weightCoefficient += c.weightCoef;
  }

  // Deliberately NOT rounded here — this feeds evaluateFormula(), and a
  // worked example that doesn't reproduce the real total shown elsewhere
  // (because a coefficient like 10.0016 got truncated to 10.00) would be
  // exactly the kind of silent-precision-loss this project has been
  // catching all session. Round only at display time (describeFormula, or
  // the UI), never in the stored value.
  return { fixed, weightCoefficient, invoiceValueCoefficient };
}

export function describeFormula(vendorCode: string, f: CostFormula): string {
  const terms: string[] = [];
  if (f.weightCoefficient !== 0) terms.push(`₹${f.weightCoefficient.toFixed(2)} × weight(kg)`);
  if (f.invoiceValueCoefficient !== 0) terms.push(`${(f.invoiceValueCoefficient * 100).toFixed(2)}% × invoice value`);
  if (f.fixed !== 0 || terms.length === 0) terms.push(`₹${f.fixed.toFixed(2)} flat`);
  return `${vendorCode}: Total ≈ ${terms.join(" + ")}`;
}

export type DominanceResult = "a_dominates" | "b_dominates" | "tied" | "none";

/** a_dominates = A is cheaper-or-equal on every term, for ANY non-negative weight/invoiceValue — no breakeven needed. */
export function checkDominance(a: CostFormula, b: CostFormula): DominanceResult {
  const aLE = a.fixed <= b.fixed && a.weightCoefficient <= b.weightCoefficient && a.invoiceValueCoefficient <= b.invoiceValueCoefficient;
  const bLE = b.fixed <= a.fixed && b.weightCoefficient <= a.weightCoefficient && b.invoiceValueCoefficient <= a.invoiceValueCoefficient;
  if (aLE && bLE) return "tied";
  if (aLE) return "a_dominates";
  if (bLE) return "b_dominates";
  return "none";
}

export type BreakevenResult =
  | { kind: "dominance"; winner: "a" | "b" | "tied" }
  | { kind: "weight"; breakevenKg: number }
  | { kind: "invoiceValue"; breakevenInr: number }
  | { kind: "multi_variable"; direction: string };

/**
 * Dominance first, always. Then: exactly one of {weight, invoiceValue}
 * differing between the two formulas resolves to real algebra. Both
 * differing does NOT produce a fabricated single number — it reports which
 * direction (increasing which variable) favors which vendor instead, per
 * the "never force a single answer out of a genuinely multi-dimensional
 * problem" rule from the breakeven-analysis plan.
 */
export function solveBreakeven(a: CostFormula, b: CostFormula): BreakevenResult {
  const dominance = checkDominance(a, b);
  if (dominance !== "none") {
    return { kind: "dominance", winner: dominance === "tied" ? "tied" : dominance === "a_dominates" ? "a" : "b" };
  }

  const weightDiffers = a.weightCoefficient !== b.weightCoefficient;
  const invoiceDiffers = a.invoiceValueCoefficient !== b.invoiceValueCoefficient;

  if (weightDiffers && !invoiceDiffers) {
    const breakevenKg = (b.fixed - a.fixed) / (a.weightCoefficient - b.weightCoefficient);
    return { kind: "weight", breakevenKg: round2(breakevenKg) };
  }
  if (invoiceDiffers && !weightDiffers) {
    const breakevenInr = (b.fixed - a.fixed) / (a.invoiceValueCoefficient - b.invoiceValueCoefficient);
    return { kind: "invoiceValue", breakevenInr: round2(breakevenInr) };
  }

  // Both differ: report direction, don't fabricate a single crossing point.
  const favorsAAsWeightRises = a.weightCoefficient < b.weightCoefficient;
  const favorsAAsInvoiceRises = a.invoiceValueCoefficient < b.invoiceValueCoefficient;
  const direction =
    favorsAAsWeightRises === favorsAAsInvoiceRises
      ? `${favorsAAsWeightRises ? "A" : "B"} pulls ahead as either weight or invoice value increases`
      : `weight and invoice value pull the ranking in opposite directions — no single "cheaper" direction`;
  return { kind: "multi_variable", direction };
}

/** Evaluates a formula at real, current variable values — the worked-example step. */
export function evaluateFormula(f: CostFormula, weightKg: number, invoiceValueInr: number): number {
  return round2(f.fixed + f.weightCoefficient * weightKg + f.invoiceValueCoefficient * invoiceValueInr);
}
