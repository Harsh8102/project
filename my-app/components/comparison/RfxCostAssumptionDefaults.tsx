"use client";

// The "overall assumption layer": one RFx-wide average for avg weight/unit
// and reference invoice value, used to resolve per_unit and
// pct_of_invoice_value charges on every lane that doesn't have its own
// lane-level override (see lib/scoring/costAssumptions.ts for precedence —
// lane override beats this). Setting these here is what turns most lanes'
// landed-cost status from "partial" to "resolved," which is what makes them
// count toward the rate-competitiveness score at all now that scoring
// requires status === "resolved" (lib/scoring/rateCompetitiveness.ts). A
// buyer who knows a specific lane's real shipment profile differs from the
// RFx-wide average (e.g. bulkier/lighter cargo on that lane) can still open
// Lane detail and override just that lane — this panel only ever sets the
// fallback everyone else uses.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Slider } from "./AssumptionSlider";

type Field = "avgWeightPerUnitKg" | "referenceInvoiceValueInr";

export type RfxCostAssumptionDefaultsValue = {
  avgWeightPerUnitKg: number | null;
  referenceInvoiceValueInr: number | null;
};

export function RfxCostAssumptionDefaults({
  rfxId,
  defaults,
}: {
  rfxId: string;
  defaults: RfxCostAssumptionDefaultsValue;
}) {
  const router = useRouter();
  const [pendingField, setPendingField] = useState<Field | "reset" | null>(null);

  // Clears "saving" only once the server-refreshed prop reflects the
  // committed value — same pattern as CostAssumptionSliders, for the same
  // reason (router.refresh() has no completion callback).
  const [prevDefaults, setPrevDefaults] = useState(defaults);
  if (defaults !== prevDefaults) {
    setPrevDefaults(defaults);
    setPendingField(null);
  }

  async function commit(field: Field, value: number) {
    setPendingField(field);
    await fetch(`/api/rfx/${rfxId}/cost-assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  }

  async function reset() {
    setPendingField("reset");
    await fetch(`/api/rfx/${rfxId}/cost-assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avgWeightPerUnitKg: null, referenceInvoiceValueInr: null }),
    });
    router.refresh();
  }

  const isSet = defaults.avgWeightPerUnitKg != null || defaults.referenceInvoiceValueInr != null;

  return (
    <div className="flex flex-col gap-3.5 border-t border-border bg-muted/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
          Overall cost assumptions — RFx-wide defaults
        </div>
        {isSet && (
          <button
            onClick={reset}
            disabled={pendingField !== null}
            className="text-[10.5px] font-semibold text-muted-foreground underline decoration-dotted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            {pendingField === "reset" ? "Resetting…" : "Reset to unset"}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Applied to every lane unless that lane has its own override (set from Lane detail). Setting these resolves
        per-unit and %-of-invoice-value charges that currently show as &ldquo;partial&rdquo; and are excluded from
        the rate score below.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Slider
          label="Avg weight per unit (box/carton)"
          value={defaults.avgWeightPerUnitKg ?? 10}
          min={0.5}
          max={50}
          step={0.5}
          unit="kg/unit"
          sourceText={defaults.avgWeightPerUnitKg != null ? "RFx-wide default" : "not set — per-unit charges stay excluded"}
          sourceClassName={defaults.avgWeightPerUnitKg != null ? "text-primary" : "text-warning-foreground"}
          saving={pendingField === "avgWeightPerUnitKg" || pendingField === "reset"}
          onCommit={(v) => commit("avgWeightPerUnitKg", v)}
        />
        <Slider
          label="Reference invoice value"
          value={defaults.referenceInvoiceValueInr ?? 50000}
          min={0}
          max={500000}
          step={5000}
          unit="₹"
          sourceText={
            defaults.referenceInvoiceValueInr != null ? "RFx-wide default" : "not set — invoice-value charges stay excluded"
          }
          sourceClassName={defaults.referenceInvoiceValueInr != null ? "text-primary" : "text-warning-foreground"}
          saving={pendingField === "referenceInvoiceValueInr" || pendingField === "reset"}
          onCommit={(v) => commit("referenceInvoiceValueInr", v)}
        />
      </div>
    </div>
  );
}
