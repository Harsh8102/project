// Plain-language dominance/breakeven explanation between the current top-2
// cheapest vendors on one lane — generated from real formulas built from
// each vendor's own resolved charges, never scripted per-scenario text.
// See lib/scoring/breakeven.ts and docs/... for the underlying logic.
//
// Typographic hierarchy (per the Lane Detail redesign): the actual
// conclusion is the most prominent thing on the panel; direction chips
// replace a sentence of prose where there's a real "who wins as X rises"
// answer; the worked example is its own supporting-evidence card; the
// formulas are the least important thing here, tucked into a collapsed
// disclosure — someone verifying the math opens it, everyone else doesn't
// have to read algebra to get the answer.

import type { VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { LandedCostResult } from "@/lib/scoring/computeLandedCost";
import { buildCostFormula, describeFormula, solveBreakeven, evaluateFormula, type CostFormula } from "@/lib/scoring/breakeven";

function DirectionChip({ caption, label }: { caption: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-border px-2.5 py-1.5">
      <span className="text-[9px] text-muted-foreground">{caption}</span>
      <span className="text-[11.5px] font-bold">{label}</span>
    </div>
  );
}

export function BreakevenPanel({
  vendors,
  landedCostsForLane,
  avgWeightPerUnitKg,
  currentWeightKg,
  currentInvoiceValueInr,
}: {
  vendors: VendorSummary[];
  landedCostsForLane: Map<string, LandedCostResult>;
  avgWeightPerUnitKg: number | null;
  currentWeightKg: number;
  currentInvoiceValueInr: number;
}) {
  const ranked = vendors
    .map((v) => ({ vendor: v, result: landedCostsForLane.get(v.id) }))
    .filter((r): r is { vendor: VendorSummary; result: LandedCostResult } => !!r.result && r.result.totalInr !== null)
    .sort((a, b) => a.result.totalInr! - b.result.totalInr!);

  if (ranked.length < 2) {
    return (
      <div className="text-[12px] text-muted-foreground">Need at least 2 vendors with a usable total on this lane to compare a breakeven.</div>
    );
  }

  const [top, second] = ranked;
  const topCode = top.vendor.code;
  const secondCode = second.vendor.code;
  const fTop = buildCostFormula(top.result.lineItems, avgWeightPerUnitKg);
  const fSecond = buildCostFormula(second.result.lineItems, avgWeightPerUnitKg);
  const breakeven = solveBreakeven(fTop, fSecond);

  const evalTop = evaluateFormula(fTop, currentWeightKg, currentInvoiceValueInr);
  const evalSecond = evaluateFormula(fSecond, currentWeightKg, currentInvoiceValueInr);
  const cheaperNow = evalTop <= evalSecond ? topCode : secondCode;
  const deltaAtCurrent = Math.abs(evalTop - evalSecond);

  function cheaperBy(pick: (f: CostFormula) => number): string {
    return pick(fTop) <= pick(fSecond) ? topCode : secondCode;
  }

  let headline: string;
  let subline: string;
  let chips: { caption: string; label: string }[] = [];

  if (breakeven.kind === "dominance") {
    if (breakeven.winner === "tied") {
      headline = "Identical cost formulas";
      subline = `${topCode} and ${secondCode} resolve to the exact same cost on every charge — there's nothing to compare here.`;
    } else {
      const winner = breakeven.winner === "a" ? topCode : secondCode;
      const loser = breakeven.winner === "a" ? secondCode : topCode;
      headline = `${winner} always wins`;
      subline = `Cheaper-or-equal than ${loser} on every resolved charge — true for any weight or invoice value. No breakeven exists to explore.`;
    }
  } else if (breakeven.kind === "weight") {
    headline = `Breakeven at ${breakeven.breakevenKg.toLocaleString("en-IN")} kg`;
    subline = "Only weight differs between these two — below the breakeven one vendor wins, above it the other does.";
    chips = [
      { caption: `below ${breakeven.breakevenKg.toLocaleString("en-IN")}kg`, label: cheaperBy((f) => f.fixed) },
      { caption: `above ${breakeven.breakevenKg.toLocaleString("en-IN")}kg`, label: cheaperBy((f) => f.weightCoefficient) },
    ];
  } else if (breakeven.kind === "invoiceValue") {
    headline = `Breakeven at ₹${breakeven.breakevenInr.toLocaleString("en-IN")} invoice value`;
    subline = "Only invoice value differs between these two — below the breakeven one vendor wins, above it the other does.";
    chips = [
      { caption: "below breakeven", label: cheaperBy((f) => f.fixed) },
      { caption: "above breakeven", label: cheaperBy((f) => f.invoiceValueCoefficient) },
    ];
  } else {
    headline = "No single breakeven point";
    subline = "Weight and invoice value pull the ranking in opposite directions — there's no one number that decides it.";
    chips = [
      { caption: "↑ as weight rises", label: `${cheaperBy((f) => f.weightCoefficient)} pulls ahead` },
      { caption: "↑ as invoice value rises", label: `${cheaperBy((f) => f.invoiceValueCoefficient)} pulls ahead` },
    ];
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
        Breakeven — {topCode} vs {secondCode} (#1 and #2 cheapest)
      </div>

      {/* The conclusion — most prominent element on the panel */}
      <div className="flex flex-col gap-1">
        <div className="text-[14.5px] leading-tight font-extrabold">{headline}</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">{subline}</div>
      </div>

      {chips.length > 0 && (
        <div className="flex gap-2">
          {chips.map((c, i) => (
            <DirectionChip key={i} caption={c.caption} label={c.label} />
          ))}
        </div>
      )}

      {/* Worked example — separated as supporting evidence, not part of the headline */}
      <div className="rounded-lg border border-border bg-muted px-2.5 py-2">
        <div className="mb-1 text-[9.5px] font-semibold text-muted-foreground">At the values above</div>
        <div className="flex items-end gap-3">
          <div>
            <div className="text-[9.5px] text-muted-foreground">{topCode}</div>
            <div className="font-mono text-[13px] font-bold tabular-nums">₹{evalTop.toLocaleString("en-IN")}</div>
          </div>
          <div>
            <div className="text-[9.5px] text-muted-foreground">{secondCode}</div>
            <div className="font-mono text-[13px] font-bold tabular-nums">₹{evalSecond.toLocaleString("en-IN")}</div>
          </div>
          <div className="ml-auto self-end text-right">
            <div className="text-[9.5px] font-semibold text-success-foreground">
              {deltaAtCurrent < 50 ? "essentially tied here" : `${cheaperNow} cheaper by ₹${Math.round(deltaAtCurrent).toLocaleString("en-IN")}`}
            </div>
          </div>
        </div>
      </div>

      {/* Formulas — least important, collapsed by default */}
      <details className="rounded-lg border border-border px-2.5 py-1.5">
        <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground">Show the formulas</summary>
        <div className="mt-1.5 space-y-1 font-mono text-[9.5px] leading-relaxed text-muted-foreground">
          <div>{describeFormula(topCode, fTop)}</div>
          <div>{describeFormula(secondCode, fSecond)}</div>
        </div>
      </details>
    </div>
  );
}
