// The analyst chat agent's tools (§9.1 of the functional plan). Every tool
// is a pure, deterministic filter/shape function over one already-computed
// lib/db/queries/getComparisonData.ts result — no raw Mongoose queries here,
// no LLM-authored arithmetic, and nothing a tool returns that the
// Comparison UI itself doesn't already show. `displayHint` is decided by
// the tool's own code, never by the model — the frontend renders a table or
// chart from a tool result, it never guesses one from prose.

import { Type, type Schema, type ToolDeclaration } from "../gemini";
import type { ComparisonData } from "../../db/queries/getComparisonData";
import { computeRateCompetitiveness, type LandedCostGrid } from "../../scoring/rateCompetitiveness";
import { DEFAULT_WEIGHTS, type VendorScoreWeights, type VendorScoreResult } from "../../scoring/computeScores";

export type ToolResult = {
  summary: string;
  data: unknown;
  displayHint: "table" | "chart" | "none";
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// --- 1. filter_lanes ---

function filterLanes(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const originCity = asString(args.originCity)?.toLowerCase() ?? null;
  const originState = asString(args.originState)?.toLowerCase() ?? null;
  const destCity = asString(args.destCity)?.toLowerCase() ?? null;
  const destState = asString(args.destState)?.toLowerCase() ?? null;
  const weightBand = asString(args.weightBand)?.toLowerCase() ?? null;

  const matches = data.lanes.filter((l) => {
    if (originCity && !l.originCity.toLowerCase().includes(originCity)) return false;
    if (originState && !l.originState.toLowerCase().includes(originState)) return false;
    if (destCity && !l.destCity.toLowerCase().includes(destCity)) return false;
    if (destState && !l.destState.toLowerCase().includes(destState)) return false;
    if (weightBand && !l.weightBand.toLowerCase().includes(weightBand)) return false;
    return true;
  });

  return {
    summary: `${matches.length} lane(s) matched.`,
    data: matches.map((l) => ({
      laneId: l.id,
      origin: `${l.originCity}, ${l.originState}`,
      destination: `${l.destCity}, ${l.destState}`,
      weightBand: l.weightBand,
    })),
    displayHint: matches.length > 0 ? "table" : "none",
  };
}

// --- 2. aggregate_cost ---

function aggregateCost(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const vendorId = asString(args.vendorId);
  const laneIdFilter = asStringArray(args.laneIds);
  const laneIdSet = laneIdFilter.length > 0 ? new Set(laneIdFilter) : null;
  const vendorIds = vendorId ? [vendorId] : data.vendors.map((v) => v.id);

  const rows = vendorIds.map((vId) => {
    const vendor = data.vendors.find((v) => v.id === vId);
    const laneMap = data.landedCosts.get(vId) ?? new Map();
    let total = 0;
    let usableCount = 0;
    let partialCount = 0;
    let notUsableCount = 0;

    for (const [laneId, result] of laneMap) {
      if (laneIdSet && !laneIdSet.has(laneId)) continue;
      if (result.totalInr === null) {
        notUsableCount++;
        continue;
      }
      total += result.totalInr;
      usableCount++;
      if (result.isPartial) partialCount++;
    }

    return {
      vendorId: vId,
      vendorCode: vendor?.code ?? "?",
      totalInr: usableCount > 0 ? Math.round(total) : null,
      avgInr: usableCount > 0 ? Math.round(total / usableCount) : null,
      lanesIncluded: usableCount,
      partialLanes: partialCount,
      lanesWithNoUsableTotal: notUsableCount,
    };
  });

  return {
    summary: vendorId
      ? `Cost aggregate for ${rows[0]?.vendorCode ?? vendorId}: ₹${rows[0]?.totalInr?.toLocaleString("en-IN") ?? "n/a"} across ${rows[0]?.lanesIncluded ?? 0} lane(s).`
      : `Cost aggregate across ${rows.length} vendors.`,
    data: rows,
    displayHint: rows.length > 1 ? "chart" : "table",
  };
}

// --- 3. filter_vendors_by_gate ---

function filterVendorsByGate(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const section = args.section === "terms" ? "terms" : "questionnaire";
  const wantPass = args.pass !== false;
  const scores = section === "terms" ? data.termsScores : data.questionnaireScores;

  const rows = data.vendors
    .map((v) => {
      const s = scores.get(v.id);
      const passed = s ? s.allGatesPassed : false;
      return {
        vendorId: v.id,
        vendorCode: v.code,
        vendorName: v.name,
        submitted: s !== null && s !== undefined,
        allGatesPassed: passed,
        failedGates: s ? s.gates.filter((g) => !g.pass).map((g) => g.label) : ["Not submitted"],
      };
    })
    .filter((r) => r.allGatesPassed === wantPass);

  return {
    summary: wantPass
      ? `${rows.length} vendor(s) passed all ${section} gates.`
      : `${rows.length} vendor(s) failed at least one ${section} gate (did not pass all of them).`,
    data: rows,
    displayHint: "table",
  };
}

// --- 4. rank_vendors ---

function normalizeWeights(partial: Partial<VendorScoreWeights> | undefined): VendorScoreWeights {
  const base = { ...DEFAULT_WEIGHTS, ...(partial ?? {}) };
  const sum = base.rateCompetitiveness + base.questionnaire + base.terms;
  if (!(sum > 0)) return DEFAULT_WEIGHTS;
  return {
    rateCompetitiveness: base.rateCompetitiveness / sum,
    questionnaire: base.questionnaire / sum,
    terms: base.terms / sum,
  };
}

function recomputeOverall(result: VendorScoreResult, weights: VendorScoreWeights): number | null {
  if (result.excludedFromRanking) return null;
  if (result.rateCompetitivenessScore === null || !result.questionnaire || !result.terms) return null;
  return Math.round(
    weights.rateCompetitiveness * result.rateCompetitivenessScore +
      weights.questionnaire * result.questionnaire.sectionScore +
      weights.terms * result.terms.sectionScore
  );
}

function rankVendors(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const weights = normalizeWeights(args.weights as Partial<VendorScoreWeights> | undefined);
  const laneIds = asStringArray(args.laneIds);

  let rateScores: Map<string, number | null>;
  if (laneIds.length > 0) {
    const laneIdSet = new Set(laneIds);
    const filteredGrid: LandedCostGrid = new Map();
    for (const [vendorId, laneMap] of data.landedCosts) {
      filteredGrid.set(vendorId, new Map([...laneMap].filter(([laneId]) => laneIdSet.has(laneId))));
    }
    rateScores = computeRateCompetitiveness(filteredGrid);
  } else {
    rateScores = new Map(data.vendors.map((v) => [v.id, data.vendorScores.get(v.id)?.rateCompetitivenessScore ?? null]));
  }

  const rows = data.vendors
    .map((v) => {
      const base = data.vendorScores.get(v.id);
      if (!base) return null;
      const rate = rateScores.get(v.id) ?? null;
      const overall = recomputeOverall({ ...base, rateCompetitivenessScore: rate }, weights);
      return {
        vendorId: v.id,
        vendorCode: v.code,
        rate,
        questionnaire: base.questionnaire?.sectionScore ?? null,
        terms: base.terms?.sectionScore ?? null,
        overall,
        excludedFromRanking: base.excludedFromRanking,
        gateFailures: base.gateFailures.map((g) => g.reason),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  return {
    summary: `Ranked ${rows.length} vendor(s) with weights rate=${weights.rateCompetitiveness.toFixed(2)}, questionnaire=${weights.questionnaire.toFixed(2)}, terms=${weights.terms.toFixed(2)}${laneIds.length > 0 ? ` (restricted to ${laneIds.length} lane(s))` : ""}.`,
    data: rows,
    displayHint: "table",
  };
}

// --- 5. get_flags ---

function getFlags(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const vendorId = asString(args.vendorId);
  const domain = asString(args.domain);

  const rows = data.reviewQueue.filter((f) => (!vendorId || f.vendorId === vendorId) && (!domain || f.domain === domain));

  return {
    summary: `${rows.length} flagged item(s) matched.`,
    data: rows.map((f) => ({
      flagId: f.id,
      vendor: f.vendorCode,
      domain: f.domain,
      field: f.laneLabel ?? f.rawHeaderLabel ?? f.fieldKey,
      flagType: f.flagType,
      flagNote: f.flagNote,
    })),
    displayHint: rows.length > 0 ? "table" : "none",
  };
}

// --- 6. compare_vendors ---

function compareVendors(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const vendorIds = asStringArray(args.vendorIds);

  const rows = vendorIds.map((vId) => {
    const vendor = data.vendors.find((v) => v.id === vId);
    const score = data.vendorScores.get(vId);
    return {
      vendorId: vId,
      vendorCode: vendor?.code ?? "?",
      vendorName: vendor?.name ?? "Unknown",
      rate: score?.rateCompetitivenessScore ?? null,
      questionnaire: score?.questionnaire?.sectionScore ?? null,
      terms: score?.terms?.sectionScore ?? null,
      overall: score?.overallScore ?? null,
      excludedFromRanking: score?.excludedFromRanking ?? true,
      gateFailures: score?.gateFailures.map((g) => g.reason) ?? [],
    };
  });

  return {
    summary: `Compared ${rows.length} vendor(s).`,
    data: rows,
    displayHint: "table",
  };
}

// --- 7. simulate_split_award — the brief's own worked example ---

function simulateSplitAward(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const requireQuestionnairePass = args.requireQuestionnairePass === true;
  const requireTermsPass = args.requireTermsPass === true;

  const eligibleVendorIds = data.vendors
    .filter((v) => {
      if (requireQuestionnairePass && !(data.questionnaireScores.get(v.id)?.allGatesPassed ?? false)) return false;
      if (requireTermsPass && !(data.termsScores.get(v.id)?.allGatesPassed ?? false)) return false;
      return true;
    })
    .map((v) => v.id);

  const assignments: {
    laneId: string;
    laneLabel: string;
    awardedVendorId: string | null;
    awardedVendorCode: string | null;
    costInr: number | null;
  }[] = [];
  let totalCostInr = 0;
  let unassignedCount = 0;

  for (const lane of data.lanes) {
    let bestVendorId: string | null = null;
    let bestCost = Infinity;
    for (const vendorId of eligibleVendorIds) {
      const result = data.landedCosts.get(vendorId)?.get(lane.id);
      if (result && result.totalInr !== null && result.totalInr < bestCost) {
        bestCost = result.totalInr;
        bestVendorId = vendorId;
      }
    }
    const vendor = bestVendorId ? data.vendors.find((v) => v.id === bestVendorId) : null;
    if (bestVendorId) totalCostInr += bestCost;
    else unassignedCount++;
    assignments.push({
      laneId: lane.id,
      laneLabel: `${lane.originCity} → ${lane.destCity}`,
      awardedVendorId: bestVendorId,
      awardedVendorCode: vendor?.code ?? null,
      costInr: bestVendorId ? Math.round(bestCost) : null,
    });
  }

  return {
    summary: `Split award across ${eligibleVendorIds.length} eligible vendor(s): ${assignments.length - unassignedCount}/${assignments.length} lanes assigned, total ≈ ₹${Math.round(totalCostInr).toLocaleString("en-IN")}, ${unassignedCount} lane(s) with no eligible bid.`,
    data: {
      assignments,
      totalCostInr: Math.round(totalCostInr),
      unassignedCount,
      eligibleVendors: eligibleVendorIds.map((id) => data.vendors.find((v) => v.id === id)?.code),
    },
    displayHint: "table",
  };
}

// --- 8. explain_flag ---

function explainFlag(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const flagId = asString(args.flagId);
  const item = flagId ? data.reviewQueue.find((f) => f.id === flagId) : undefined;

  if (!item) {
    return { summary: "No flag found with that id.", data: null, displayHint: "none" };
  }

  return {
    summary: `${item.vendorCode} — ${item.flagType.replaceAll("_", " ")}: ${item.flagNote ?? "no note"}`,
    data: item,
    displayHint: "none",
  };
}

// --- Registry: Gemini function declarations + handlers, kept together so they can't drift apart ---

const stringParam = (description: string): Schema => ({ type: Type.STRING, description });
const boolParam = (description: string): Schema => ({ type: Type.BOOLEAN, description });
const stringArrayParam = (description: string): Schema => ({ type: Type.ARRAY, items: { type: Type.STRING }, description });

type ToolEntry = { declaration: ToolDeclaration; handler: (data: ComparisonData, args: Record<string, unknown>) => ToolResult };

export const CHAT_TOOLS: ToolEntry[] = [
  {
    declaration: {
      name: "filter_lanes",
      description: "Find lanes matching an origin/destination city or state, or a weight band. All fields optional; omit to match everything.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          originCity: stringParam("Origin city, partial match"),
          originState: stringParam("Origin state, partial match"),
          destCity: stringParam("Destination city, partial match"),
          destState: stringParam("Destination state, partial match"),
          weightBand: stringParam("Weight band, partial match, e.g. '500-1000'"),
        },
      },
    },
    handler: filterLanes,
  },
  {
    declaration: {
      name: "aggregate_cost",
      description: "Sum and average a vendor's landed cost across lanes (optionally restricted to specific lane ids). Omit vendorId to get every vendor's aggregate.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          vendorId: stringParam("Vendor id to aggregate; omit for all vendors"),
          laneIds: stringArrayParam("Lane ids to restrict to; omit for all lanes"),
        },
      },
    },
    handler: aggregateCost,
  },
  {
    declaration: {
      name: "filter_vendors_by_gate",
      description: "List vendors that passed or failed all mandatory gate questions in the questionnaire or terms section.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          section: { type: Type.STRING, enum: ["questionnaire", "terms"], description: "Which section's gates to check" },
          pass: boolParam("true for vendors that passed all gates, false for vendors that failed at least one (default true)"),
        },
        required: ["section"],
      },
    },
    handler: filterVendorsByGate,
  },
  {
    declaration: {
      name: "rank_vendors",
      description:
        "Rank all vendors by overall score using custom weights for rate/questionnaire/terms (they're normalized to sum to 1 automatically — you don't need to do that math). Optionally restrict the rate portion to specific lanes.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          weights: {
            type: Type.OBJECT,
            description: "Any subset of the three weights; omitted ones default to the standard weighting before normalization",
            properties: {
              rateCompetitiveness: { type: Type.NUMBER },
              questionnaire: { type: Type.NUMBER },
              terms: { type: Type.NUMBER },
            },
          },
          laneIds: stringArrayParam("Lane ids to restrict the rate-competitiveness portion to; omit to use all lanes"),
        },
      },
    },
    handler: rankVendors,
  },
  {
    declaration: {
      name: "get_flags",
      description: "List flagged (uncertain) fields, optionally filtered to one vendor and/or one section (charges, questionnaire, terms).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          vendorId: stringParam("Vendor id to filter to; omit for all vendors"),
          domain: { type: Type.STRING, enum: ["charges", "questionnaire", "terms"], description: "Section to filter to; omit for all sections" },
        },
      },
    },
    handler: getFlags,
  },
  {
    declaration: {
      name: "compare_vendors",
      description: "Side-by-side rate/questionnaire/terms/overall scores and gate failures for a specific set of vendors.",
      parameters: {
        type: Type.OBJECT,
        properties: { vendorIds: stringArrayParam("Vendor ids to compare") },
        required: ["vendorIds"],
      },
    },
    handler: compareVendors,
  },
  {
    declaration: {
      name: "simulate_split_award",
      description:
        "Simulate splitting the award lane-by-lane to whichever eligible vendor is cheapest on that lane. Optionally require vendors to have passed all questionnaire and/or terms gates to be eligible.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          requireQuestionnairePass: boolParam("Only consider vendors that passed all questionnaire gates"),
          requireTermsPass: boolParam("Only consider vendors that passed all terms gates"),
        },
      },
    },
    handler: simulateSplitAward,
  },
  {
    declaration: {
      name: "explain_flag",
      description: "Get the full detail (source snippet, confidence, note) behind one specific flag id, e.g. one returned by get_flags.",
      parameters: {
        type: Type.OBJECT,
        properties: { flagId: stringParam("The flag id") },
        required: ["flagId"],
      },
    },
    handler: explainFlag,
  },
];

export function executeChatTool(data: ComparisonData, name: string, args: Record<string, unknown>): ToolResult {
  const entry = CHAT_TOOLS.find((t) => t.declaration.name === name);
  if (!entry) {
    return { summary: `Unknown tool "${name}".`, data: null, displayHint: "none" };
  }
  return entry.handler(data, args);
}
