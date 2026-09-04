// Persists a per-lane override of the cost-comparison assumptions (weight,
// avg weight/unit, reference invoice value) — see
// lib/scoring/costAssumptions.ts for precedence (this beats the RFx-wide
// default). Setting one here only changes THIS lane's landed cost/score;
// every other lane keeps using the RFx default. Pass `null` for a field to
// clear its override (fall back to the RFx default / band midpoint again).

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { LaneModel } from "@/lib/db/models/Lane";

export async function PATCH(req: Request, { params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = await params;
  const body = await req.json();
  const { referenceWeightKg, avgWeightPerUnitKg, referenceInvoiceValueInr } = body as {
    referenceWeightKg?: number | null;
    avgWeightPerUnitKg?: number | null;
    referenceInvoiceValueInr?: number | null;
  };

  await connectToDatabase();

  const set: Record<string, number | null> = {};
  if (referenceWeightKg !== undefined) set["costAssumptionOverrides.referenceWeightKg"] = referenceWeightKg;
  if (avgWeightPerUnitKg !== undefined) set["costAssumptionOverrides.avgWeightPerUnitKg"] = avgWeightPerUnitKg;
  if (referenceInvoiceValueInr !== undefined) set["costAssumptionOverrides.referenceInvoiceValueInr"] = referenceInvoiceValueInr;

  const lane = await LaneModel.findByIdAndUpdate(laneId, { $set: set }, { new: true, projection: "costAssumptionOverrides" });
  if (!lane) {
    return NextResponse.json({ error: "Lane not found" }, { status: 404 });
  }

  return NextResponse.json({ costAssumptionOverrides: lane.costAssumptionOverrides });
}
