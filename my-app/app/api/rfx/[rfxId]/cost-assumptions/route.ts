// Persists the RFx-wide fallback assumptions used to resolve per_unit and
// pct_of_invoice_value charges (lib/scoring/costAssumptions.ts) — the
// buyer-set defaults every lane uses unless it has its own override
// (see app/api/lanes/[laneId]/cost-assumptions/route.ts). Saved on slider
// release, not per drag frame — see components/comparison's cost-assumption
// sliders.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { RfxModel } from "@/lib/db/models/Rfx";

export async function PATCH(req: Request, { params }: { params: Promise<{ rfxId: string }> }) {
  const { rfxId } = await params;
  const body = await req.json();
  const { avgWeightPerUnitKg, referenceInvoiceValueInr } = body as {
    avgWeightPerUnitKg?: number | null;
    referenceInvoiceValueInr?: number | null;
  };

  await connectToDatabase();

  const set: Record<string, number | null> = {};
  if (avgWeightPerUnitKg !== undefined) set["costAssumptionDefaults.avgWeightPerUnitKg"] = avgWeightPerUnitKg;
  if (referenceInvoiceValueInr !== undefined) set["costAssumptionDefaults.referenceInvoiceValueInr"] = referenceInvoiceValueInr;

  const rfx = await RfxModel.findByIdAndUpdate(rfxId, { $set: set }, { new: true, projection: "costAssumptionDefaults" });
  if (!rfx) {
    return NextResponse.json({ error: "RFx not found" }, { status: 404 });
  }

  return NextResponse.json({ costAssumptionDefaults: rfx.costAssumptionDefaults });
}
