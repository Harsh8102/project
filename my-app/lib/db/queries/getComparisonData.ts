// The single query the Comparison UI (Charges/Questionnaire/Terms/Review
// Queue/Decision Summary tabs) is built on. Reads real ExtractedField data
// written by scripts/runFullExtraction.ts and turns it into everything those
// tabs need: landed costs, section scores, a flat review queue, and the
// time-saved stats (§8.4 of the functional plan).

import { connectToDatabase } from "../connect";
import { RfxModel } from "../models/Rfx";
import { LaneModel, type Lane } from "../models/Lane";
import { VendorModel, type Vendor } from "../models/Vendor";
import { VendorSubmissionModel } from "../models/VendorSubmission";
import { ExtractedFieldModel, type FieldDomain, type FlagType } from "../models/ExtractedField";
import { DecisionRecordModel } from "../models/DecisionRecord";
import { computeLandedCost, type ChargeFieldRow, type LandedCostResult } from "../../scoring/computeLandedCost";
import { computeRateCompetitiveness, type LandedCostGrid } from "../../scoring/rateCompetitiveness";
import { computeVendorScore, type VendorScoreResult } from "../../scoring/computeScores";
import { getRegionForState, type Region } from "../../normalization/regions";
import { resolveCostAssumptions, type ResolvedCostAssumptions } from "../../scoring/costAssumptions";

const SECONDS_PER_MANUAL_FIELD = 90;

type LeanExtractedField = {
  _id: unknown;
  vendorId: unknown;
  domain: FieldDomain;
  laneId: unknown | null;
  fieldKey: string | null;
  rawHeaderLabel: string | null;
  rawValue: string;
  normalizedValue: number | string | boolean | null;
  basis: string | null;
  confidence: number;
  sourceSnippet: { type: "cell" | "page" | "quote"; cellRef?: string | null; page?: number | null; quote?: string | null };
  flagType: FlagType | null;
  flagNote: string | null;
};

export type LaneSummary = {
  id: string;
  laneIndex: number;
  originCity: string;
  originState: string;
  originRegion: Region;
  destCity: string;
  destState: string;
  destRegion: Region;
  weightBand: string;
  expectedVolumeKgPerMonth: number;
};

export type VendorSummary = { id: string; code: string; name: string };

export type UnsolicitedLane = {
  vendorId: string;
  description: string;
  sourceSnippet: LeanExtractedField["sourceSnippet"];
};

export type ReviewQueueItem = {
  id: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  domain: FieldDomain;
  laneId: string | null;
  laneLabel: string | null;
  fieldKey: string | null;
  rawHeaderLabel: string | null;
  rawValue: string;
  confidence: number;
  flagType: FlagType;
  flagNote: string | null;
  sourceSnippet: LeanExtractedField["sourceSnippet"];
};

export type TimeSavedStats = {
  submissionsProcessed: number;
  fieldsExtracted: number;
  fieldsFlagged: number;
  minutesAvoided: number;
  assumptionSecondsPerField: number;
};

export type DecisionSummaryRecord = { vendorId: string; laneId: string | null; awardedAt: string };

export type ComparisonData = {
  rfxId: string;
  lanes: LaneSummary[];
  vendors: VendorSummary[];
  landedCosts: LandedCostGrid; // vendorId -> laneId -> LandedCostResult
  costAssumptionsByLaneId: Map<string, ResolvedCostAssumptions>;
  unsolicitedLanes: UnsolicitedLane[];
  questionnaireScores: Map<string, ReturnType<typeof computeVendorScore>["questionnaire"]>;
  termsScores: Map<string, ReturnType<typeof computeVendorScore>["terms"]>;
  vendorScores: Map<string, VendorScoreResult>;
  reviewQueue: ReviewQueueItem[];
  timeSaved: TimeSavedStats;
  decisions: DecisionSummaryRecord[];
};

function laneLabel(lane: Pick<LaneSummary, "originCity" | "destCity">): string {
  return `${lane.originCity} → ${lane.destCity}`;
}

export async function getComparisonData(rfxId: string): Promise<ComparisonData> {
  await connectToDatabase();

  const rfx = await RfxModel.findById(rfxId);
  if (!rfx) throw new Error(`RFx ${rfxId} not found`);

  const [laneDocs, vendorDocs, fieldDocs, submissions, decisionDocs] = await Promise.all([
    LaneModel.find({ rfxId }).sort({ laneIndex: 1 }).lean<Lane[]>(),
    VendorModel.find().sort({ code: 1 }).lean<Vendor[]>(),
    ExtractedFieldModel.find({ rfxId, isLatest: true }).lean<LeanExtractedField[]>(),
    VendorSubmissionModel.find({ rfxId }).lean(),
    DecisionRecordModel.find({ rfxId }).lean(),
  ]);

  const lanes: LaneSummary[] = laneDocs.map((l) => ({
    id: String(l._id),
    laneIndex: l.laneIndex,
    originCity: l.originCity,
    originState: l.originState,
    originRegion: getRegionForState(l.originState),
    destCity: l.destCity,
    destState: l.destState,
    destRegion: getRegionForState(l.destState),
    weightBand: l.weightBand,
    expectedVolumeKgPerMonth: l.expectedVolumeKgPerMonth,
  }));
  const laneById = new Map(lanes.map((l) => [l.id, l]));

  // Resolved once per lane (not per vendor) — every vendor on a lane shares
  // the same reference weight/unit-count/invoice-value assumptions. See
  // lib/scoring/costAssumptions.ts for the lane-override > RFx-default >
  // band-midpoint precedence.
  const costAssumptionsByLaneId = new Map<string, ResolvedCostAssumptions>();
  for (const l of laneDocs) {
    costAssumptionsByLaneId.set(
      String(l._id),
      resolveCostAssumptions({
        weightBand: l.weightBand,
        laneOverrides: l.costAssumptionOverrides,
        rfxDefaults: rfx.costAssumptionDefaults,
      })
    );
  }

  const vendors: VendorSummary[] = vendorDocs.map((v) => ({ id: String(v._id), code: v.code, name: v.name }));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const chargeFields = fieldDocs.filter((f) => f.domain === "charges");
  const questionnaireFields = fieldDocs.filter((f) => f.domain === "questionnaire");
  const termsFields = fieldDocs.filter((f) => f.domain === "terms");

  // --- Charges: group by (vendorId, laneId), resolve landed cost per lane ---
  const chargesByVendorLane = new Map<string, Map<string, LeanExtractedField[]>>();
  const unsolicitedLanes: UnsolicitedLane[] = [];

  for (const f of chargeFields) {
    const vendorId = String(f.vendorId);
    if (f.flagType === "unsolicited_lane") {
      unsolicitedLanes.push({ vendorId, description: f.rawValue, sourceSnippet: f.sourceSnippet });
      continue;
    }
    if (!f.laneId) continue;
    const laneId = String(f.laneId);
    if (!chargesByVendorLane.has(vendorId)) chargesByVendorLane.set(vendorId, new Map());
    const byLane = chargesByVendorLane.get(vendorId)!;
    if (!byLane.has(laneId)) byLane.set(laneId, []);
    byLane.get(laneId)!.push(f);
  }

  const landedCosts: LandedCostGrid = new Map();
  for (const vendor of vendors) {
    const byLane = chargesByVendorLane.get(vendor.id) ?? new Map<string, LeanExtractedField[]>();
    const resultByLane = new Map<string, LandedCostResult>();
    for (const lane of lanes) {
      const rows = byLane.get(lane.id) ?? [];
      const chargeRows: ChargeFieldRow[] = rows.map((r) => ({
        fieldKey: r.fieldKey,
        rawHeaderLabel: r.rawHeaderLabel,
        basis: r.basis,
        normalizedValue: typeof r.normalizedValue === "number" ? r.normalizedValue : null,
        confidence: r.confidence,
        flagType: r.flagType,
        flagNote: r.flagNote,
        sourceSnippet: r.sourceSnippet,
      }));
      resultByLane.set(lane.id, computeLandedCost(chargeRows, costAssumptionsByLaneId.get(lane.id)!));
    }
    landedCosts.set(vendor.id, resultByLane);
  }

  const rateCompetitivenessScores = computeRateCompetitiveness(landedCosts);

  // --- Questionnaire / Terms: fold into AnswerMaps, score via the existing engine ---
  function answerMapFor(fields: LeanExtractedField[], vendorId: string): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (const f of fields) {
      if (String(f.vendorId) !== vendorId || !f.fieldKey) continue;
      map[f.fieldKey] = f.normalizedValue;
    }
    return map;
  }

  const submittedSections = new Set(submissions.map((s) => `${String(s.vendorId)}:${s.section}`));

  const vendorScores = new Map<string, VendorScoreResult>();
  const questionnaireScores = new Map<string, VendorScoreResult["questionnaire"]>();
  const termsScores = new Map<string, VendorScoreResult["terms"]>();

  for (const vendor of vendors) {
    const hasQuestionnaire = submittedSections.has(`${vendor.id}:questionnaire`);
    const hasTerms = submittedSections.has(`${vendor.id}:terms`);
    const scoreResult = computeVendorScore({
      vendorId: vendor.id,
      vendorLabel: `${vendor.code} — ${vendor.name}`,
      questionnaireAnswers: hasQuestionnaire ? answerMapFor(questionnaireFields, vendor.id) : null,
      termsAnswers: hasTerms ? answerMapFor(termsFields, vendor.id) : null,
      rateCompetitivenessScore: rateCompetitivenessScores.get(vendor.id) ?? null,
    });
    vendorScores.set(vendor.id, scoreResult);
    questionnaireScores.set(vendor.id, scoreResult.questionnaire);
    termsScores.set(vendor.id, scoreResult.terms);
  }

  // --- Review queue: every flagged field, across all domains ---
  const reviewQueue: ReviewQueueItem[] = fieldDocs
    .filter((f) => f.flagType !== null)
    .map((f) => {
      const vendor = vendorById.get(String(f.vendorId));
      const lane = f.laneId ? laneById.get(String(f.laneId)) : null;
      return {
        id: String(f._id),
        vendorId: String(f.vendorId),
        vendorCode: vendor?.code ?? "?",
        vendorName: vendor?.name ?? "Unknown vendor",
        domain: f.domain,
        laneId: lane?.id ?? null,
        laneLabel: lane ? laneLabel(lane) : null,
        fieldKey: f.fieldKey,
        rawHeaderLabel: f.rawHeaderLabel,
        rawValue: f.rawValue,
        confidence: f.confidence,
        flagType: f.flagType as FlagType,
        flagNote: f.flagNote,
        sourceSnippet: f.sourceSnippet,
      };
    });

  // --- Time-saved stats (§8.4) ---
  const submissionsProcessed = submissions.filter((s) => s.status === "done" || s.status === "needs_review").length;
  const fieldsFlagged = fieldDocs.filter((f) => f.flagType !== null).length;
  const fieldsExtracted = fieldDocs.length - fieldsFlagged;
  const timeSaved: TimeSavedStats = {
    submissionsProcessed,
    fieldsExtracted,
    fieldsFlagged,
    minutesAvoided: Math.round((fieldsExtracted * SECONDS_PER_MANUAL_FIELD) / 60),
    assumptionSecondsPerField: SECONDS_PER_MANUAL_FIELD,
  };

  const decisions: DecisionSummaryRecord[] = decisionDocs.map((d) => ({
    vendorId: String(d.vendorId),
    laneId: d.laneId ? String(d.laneId) : null,
    awardedAt: (d.awardedAt as Date).toISOString(),
  }));

  return {
    rfxId: String(rfx._id),
    lanes,
    vendors,
    landedCosts,
    costAssumptionsByLaneId,
    unsolicitedLanes,
    questionnaireScores,
    termsScores,
    vendorScores,
    reviewQueue,
    timeSaved,
    decisions,
  };
}
