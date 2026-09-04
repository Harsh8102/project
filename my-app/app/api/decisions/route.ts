// Writes a DecisionRecord (§3.1/§7 of the functional plan): an award action
// is only defensible if it carries a frozen copy of the scores/flags that
// justified it, so re-extraction or a later resubmission can't quietly
// change what an evaluator saw at award time.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { DecisionRecordModel } from "@/lib/db/models/DecisionRecord";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";

export async function POST(req: Request) {
  const body = await req.json();
  const { rfxId, vendorId, laneId = null } = body as { rfxId?: string; vendorId?: string; laneId?: string | null };

  if (!rfxId || !vendorId) {
    return NextResponse.json({ error: "rfxId and vendorId are required" }, { status: 400 });
  }

  await connectToDatabase();

  const data = await getComparisonData(rfxId);
  const scoreResult = data.vendorScores.get(vendorId);
  if (!scoreResult) {
    return NextResponse.json({ error: "Vendor not found in this RFx" }, { status: 404 });
  }

  const record = await DecisionRecordModel.create({
    rfxId,
    vendorId,
    laneId,
    awardedAt: new Date(),
    justificationSnapshot: scoreResult,
  });

  return NextResponse.json({ id: String(record._id) });
}
