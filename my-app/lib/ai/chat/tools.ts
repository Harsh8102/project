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
import { rankUnitEconomics } from "../../scoring/unitEconomics";

export type ToolResult = {
  summary: string;
  data: unknown;
  displayHint: "table" | "chart" | "none";
  // Set only when a tool's own result is itself a complete, deterministic
  // answer — nothing left to look up or phrase. runAgentTurn (lib/ai/gemini.ts)
  // short-circuits and returns this text directly, skipping the next Gemini
  // round-trip entirely, when a round made exactly one tool call and that
  // tool set this. A tool sets it only when it can prove there's genuinely
  // no more useful data to fetch — e.g. a fully-specified origin+destination
  // lookup that matched zero lanes; a real "this doesn't exist" fact doesn't
  // get more true by asking a model to say it in different words.
  finalAnswer?: string;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// --- 1. filter_lanes ---

type Lane = ComparisonData["lanes"][number];

// A small, closed filter primitive — not arbitrary code, just a bounded set
// of known fields and operators — so a question needing a combination we
// didn't specifically build a named param for (region, a numeric range on
// volume) still resolves to one real, deterministic tool call instead of
// the model reconstructing the answer from raw fields with its own
// ungrounded judgment. See docs/chat-response-time-investigation.md-style
// reasoning: this is the general fix for the class of gap "West to North"
// exposed, not a one-off patch for that specific phrasing.
const LANE_STRING_FIELDS = ["originCity", "originState", "originRegion", "destCity", "destState", "weightBand", "destRegion"] as const;
const LANE_NUMERIC_FIELDS = ["expectedVolumeKgPerMonth"] as const;
type LaneField = (typeof LANE_STRING_FIELDS)[number] | (typeof LANE_NUMERIC_FIELDS)[number];
type FilterOp = "eq" | "contains" | "gt" | "gte" | "lt" | "lte";

const ORIGIN_FIELDS = new Set<LaneField>(["originCity", "originState", "originRegion"]);
const DEST_FIELDS = new Set<LaneField>(["destCity", "destState", "destRegion"]);

type LaneClause = { field: LaneField; op: FilterOp; value: unknown };

function parseWhereClauses(v: unknown): LaneClause[] {
  if (!Array.isArray(v)) return [];
  const allFields = new Set<string>([...LANE_STRING_FIELDS, ...LANE_NUMERIC_FIELDS]);
  const allOps = new Set<string>(["eq", "contains", "gt", "gte", "lt", "lte"]);
  return v
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({ field: asString(c.field), op: asString(c.op), value: c.value }))
    .filter((c): c is LaneClause => Boolean(c.field && allFields.has(c.field) && c.op && allOps.has(c.op)));
}

function evaluateLaneClause(lane: Lane, clause: LaneClause): boolean {
  const isNumericField = (LANE_NUMERIC_FIELDS as readonly string[]).includes(clause.field);
  const fieldValue = lane[clause.field as keyof Lane];

  if (isNumericField) {
    const fieldNum = Number(fieldValue);
    const targetNum = Number(clause.value);
    if (!Number.isFinite(fieldNum) || !Number.isFinite(targetNum)) return false;
    switch (clause.op) {
      case "eq": return fieldNum === targetNum;
      case "gt": return fieldNum > targetNum;
      case "gte": return fieldNum >= targetNum;
      case "lt": return fieldNum < targetNum;
      case "lte": return fieldNum <= targetNum;
      default: return false; // "contains" is meaningless on a number
    }
  }

  const fieldStr = String(fieldValue).toLowerCase();
  const targetStr = String(clause.value).toLowerCase();
  if (clause.op === "eq") return fieldStr === targetStr;
  if (clause.op === "contains") return fieldStr.includes(targetStr);
  return false; // gt/gte/lt/lte are meaningless on a string field
}

function filterLanes(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const originCity = asString(args.originCity)?.toLowerCase() ?? null;
  const originState = asString(args.originState)?.toLowerCase() ?? null;
  const destCity = asString(args.destCity)?.toLowerCase() ?? null;
  const destState = asString(args.destState)?.toLowerCase() ?? null;
  const weightBand = asString(args.weightBand)?.toLowerCase() ?? null;
  const whereClauses = parseWhereClauses(args.where);
  const originClauses = whereClauses.filter((c) => ORIGIN_FIELDS.has(c.field));
  const destClauses = whereClauses.filter((c) => DEST_FIELDS.has(c.field));
  const otherClauses = whereClauses.filter((c) => !ORIGIN_FIELDS.has(c.field) && !DEST_FIELDS.has(c.field));

  const matchesOrigin = (l: Lane) =>
    (!originCity || l.originCity.toLowerCase().includes(originCity)) &&
    (!originState || l.originState.toLowerCase().includes(originState)) &&
    originClauses.every((c) => evaluateLaneClause(l, c));
  const matchesDest = (l: Lane) =>
    (!destCity || l.destCity.toLowerCase().includes(destCity)) &&
    (!destState || l.destState.toLowerCase().includes(destState)) &&
    destClauses.every((c) => evaluateLaneClause(l, c));
  const matchesOther = (l: Lane) =>
    (!weightBand || l.weightBand.toLowerCase().includes(weightBand)) && otherClauses.every((c) => evaluateLaneClause(l, c));

  const matches = data.lanes.filter((l) => matchesOrigin(l) && matchesDest(l) && matchesOther(l));

  // A fully-specified origin+destination query (both sides identified —
  // whether by city, state, or region, in any combination — with nothing
  // else narrowing the result) that matches zero lanes is a deterministic,
  // complete fact: this lane isn't in the RFx, full stop. Templating that
  // here — with real "closest data" context, not a guess — lets the caller
  // skip an entire extra Gemini round just to have a model reword "0 lanes
  // matched." Left out whenever weightBand or any other clause is also
  // set: something besides origin/destination identity might be why it
  // came up empty, and that's a more nuanced case than this shortcut
  // should try to handle on its own.
  let finalAnswer: string | undefined;
  const hasOriginFilter = Boolean(originCity || originState) || originClauses.length > 0;
  const hasDestFilter = Boolean(destCity || destState) || destClauses.length > 0;
  const hasOtherFilter = Boolean(weightBand) || otherClauses.length > 0;
  if (matches.length === 0 && hasOriginFilter && hasDestFilter && !hasOtherFilter) {
    const fromOrigin = data.lanes.filter(matchesOrigin);
    const toDestination = data.lanes.filter(matchesDest);
    const originLabel = asString(args.originCity) ?? asString(args.originState) ?? (originClauses[0] ? String(originClauses[0].value) : "that origin");
    const destLabel = asString(args.destCity) ?? asString(args.destState) ?? (destClauses[0] ? String(destClauses[0].value) : "that destination");
    const lines = [`No lane from ${originLabel} to ${destLabel} is in this RFx (0 matches).`];
    if (fromOrigin.length > 0) {
      lines.push(`Lanes from ${originLabel} in this RFx: ${fromOrigin.map((l) => `${l.originCity} → ${l.destCity}`).join(", ")}.`);
    }
    if (toDestination.length > 0) {
      lines.push(`Lanes to ${destLabel} in this RFx: ${toDestination.map((l) => `${l.originCity} → ${l.destCity}`).join(", ")}.`);
    }
    if (fromOrigin.length === 0 && toDestination.length === 0) {
      lines.push(`This RFx has no lanes touching ${originLabel} or ${destLabel} at all.`);
    }
    finalAnswer = lines.join(" ");
  }

  return {
    summary: `${matches.length} lane(s) matched.`,
    data: matches.map((l) => ({
      laneId: l.id,
      origin: `${l.originCity}, ${l.originState} (${l.originRegion})`,
      destination: `${l.destCity}, ${l.destState} (${l.destRegion})`,
      weightBand: l.weightBand,
      expectedVolumeKgPerMonth: l.expectedVolumeKgPerMonth,
    })),
    displayHint: matches.length > 0 ? "table" : "none",
    ...(finalAnswer ? { finalAnswer } : {}),
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

// --- 9. get_lane_charges ---
// The gap that motivated this tool: none of the others expose individual
// charge components (freight, fuel surcharge, loading, etc.) for a
// lane/vendor — only totals and flags. A question like "which vendors have
// a loading charge on this lane" has no correct answer without this.

function getLaneCharges(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const laneId = asString(args.laneId);
  const vendorId = asString(args.vendorId);
  if (!laneId) {
    return { summary: "laneId is required — call filter_lanes first to find it.", data: null, displayHint: "none" };
  }

  const vendorIds = vendorId ? [vendorId] : data.vendors.map((v) => v.id);
  const rows: Record<string, unknown>[] = [];
  // vId + fieldKey -> row, kept alongside `rows` so the unit-economics pass
  // below can group same-charge-type per_unit rows without re-deriving
  // fieldKey from the display label (which is a human label, not a stable key).
  const perUnitByFieldKey = new Map<string, { vendorId: string; row: Record<string, unknown>; ratePerUnitInr: number }[]>();

  for (const vId of vendorIds) {
    const vendor = data.vendors.find((v) => v.id === vId);
    const result = data.landedCosts.get(vId)?.get(laneId);

    if (!result || result.status === "not_quoted") {
      rows.push({ vendorCode: vendor?.code ?? "?", charge: null, basis: null, rawValue: null, resolvedInr: null, status: "not quoted for this lane" });
      continue;
    }
    if (result.status === "unreadable") {
      rows.push({ vendorCode: vendor?.code ?? "?", charge: null, basis: null, rawValue: null, resolvedInr: null, status: "illegible in source document" });
      continue;
    }
    for (const li of result.lineItems) {
      const row: Record<string, unknown> = {
        vendorCode: vendor?.code ?? "?",
        charge: li.label,
        basis: li.basis,
        rawValue: li.normalizedValue,
        resolvedInr: li.resolvedValueInr,
        status: li.included ? "included" : (li.exclusionReason ?? "excluded"),
        sourceQuote: li.sourceSnippet.quote || null,
      };
      rows.push(row);

      // Same-basis unit-economics grouping (Case A — see
      // docs/charge-normalization-unit-economics.md): group by fieldKey,
      // not the display label, so wording differences ("Loading Charge" vs
      // a raw unmapped label) don't split what's really the same charge type.
      if (li.basis === "per_unit" && li.fieldKey && li.normalizedValue !== null) {
        const key = li.fieldKey;
        if (!perUnitByFieldKey.has(key)) perUnitByFieldKey.set(key, []);
        perUnitByFieldKey.get(key)!.push({ vendorId: vId, row, ratePerUnitInr: li.normalizedValue });
      }
    }
  }

  for (const entries of perUnitByFieldKey.values()) {
    const ranked = rankUnitEconomics(entries.map((e) => ({ vendorId: e.vendorId, ratePerUnitInr: e.ratePerUnitInr })));
    if (ranked.length === 0) continue; // fewer than 2 vendors quoted this charge per-unit — nothing to rank
    const rankByVendor = new Map(ranked.map((r) => [r.vendorId, r]));
    for (const entry of entries) {
      const r = rankByVendor.get(entry.vendorId);
      if (!r) continue;
      entry.row.unitEconomicsRank = `#${r.rank} of ${r.outOf} by ₹/unit${r.isCheapest ? " (cheapest)" : ""}`;
      entry.row.unitEconomicsNote =
        "Comparable directly by ₹/unit against other vendors quoting this same charge per-unit on this lane — the package name (box/carton/etc.) doesn't matter, " +
        "only the rate does, since the actual unit count would cancel out of the comparison. Not comparable against a flat or per-kg charge without a real reference count, which isn't assumed here.";
    }
  }

  return {
    summary: `${rows.length} charge line item(s) for this lane${vendorId ? "" : ", across all vendors"}.`,
    data: rows,
    displayHint: rows.length > 0 ? "table" : "none",
  };
}

// --- 10. rank_vendor_lanes_by_cost ---
// The gap that motivated this tool: a real user question ("top 2 lanes
// where Bharat Roadlines has quoted the least") had no correct answer —
// aggregate_cost only gives one total/average across ALL of a vendor's
// lanes, and get_lane_charges needs a laneId already in hand and doesn't
// sum to a total. Live-tested: without this tool the agent burned 4 tool
// calls trying to improvise an answer, then gave up and asked the user to
// do the arithmetic themselves.
//
// Only ranks lanes with a status of "resolved" — every charge counted,
// nothing excluded (lib/scoring/computeLandedCost.ts). A "partial" total
// (e.g. a per-unit or FOV charge excluded for lack of a cost assumption)
// is deliberately left OUT of the ranking rather than compared on an
// artificially lower number — the same discipline the rate-competitiveness
// score and every landed-cost total in this app already follow. Excluded
// lanes are still reported, with why, so a buyer sees what's missing
// rather than a silently incomplete ranking.

function rankVendorLanesByCost(data: ComparisonData, args: Record<string, unknown>): ToolResult {
  const vendorArg = asString(args.vendorId);
  if (!vendorArg) {
    return { summary: "vendorId is required.", data: null, displayHint: "none" };
  }
  // Resolve leniently — id, code ("A"), or name/partial-name all work,
  // rather than silently returning "no data" whenever the model passes a
  // vendor's code or name instead of its real database id (confirmed live:
  // a real question about "Bharat Roadlines" got the model to correctly
  // infer vendor code "A" on its own, but not the underlying id — an
  // exact-id-only match would have wrongly reported zero data for every
  // one of that vendor's lanes instead of a real answer).
  const needle = vendorArg.toLowerCase();
  const vendor =
    data.vendors.find((v) => v.id === vendorArg) ??
    data.vendors.find((v) => v.code.toLowerCase() === needle) ??
    data.vendors.find((v) => v.name.toLowerCase().includes(needle));
  if (!vendor) {
    return { summary: `No vendor matches "${vendorArg}".`, data: null, displayHint: "none" };
  }
  const order = args.order === "most_expensive" ? "most_expensive" : "cheapest";
  const limitArg = Number(args.limit);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 5;

  const laneMap = data.landedCosts.get(vendor.id) ?? new Map();

  const resolved: { laneId: string; lane: string; totalInr: number }[] = [];
  const excludedFromRanking: { laneId: string; lane: string; reason: string }[] = [];

  for (const lane of data.lanes) {
    const result = laneMap.get(lane.id);
    const laneLabel = `${lane.originCity} → ${lane.destCity}`;
    if (!result || result.status !== "resolved" || result.totalInr === null) {
      const reason =
        !result || result.status === "not_quoted"
          ? "not quoted for this lane"
          : result.status === "unreadable"
            ? "illegible in source document"
            : `partial total — not fully resolved (${result.excludedReasons.join("; ") || "one or more charges excluded"})`;
      excludedFromRanking.push({ laneId: lane.id, lane: laneLabel, reason });
      continue;
    }
    resolved.push({ laneId: lane.id, lane: laneLabel, totalInr: result.totalInr });
  }

  resolved.sort((a, b) => (order === "cheapest" ? a.totalInr - b.totalInr : b.totalInr - a.totalInr));
  const top = resolved.slice(0, limit);

  return {
    summary:
      `${vendor.code}: ${top.length} ${order === "cheapest" ? "cheapest" : "most expensive"} lane(s) by fully-resolved landed cost ` +
      `(${resolved.length} of ${data.lanes.length} lane(s) had a fully-resolved total; ${excludedFromRanking.length} excluded from ranking).`,
    data: {
      vendorCode: vendor.code,
      ranked: top.map((r, i) => ({ rank: i + 1, laneId: r.laneId, lane: r.lane, totalInr: Math.round(r.totalInr) })),
      excludedFromRanking,
    },
    displayHint: top.length > 0 ? "table" : "none",
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
      description:
        "Find lanes matching an origin/destination city or state, or a weight band. All fields optional; omit to match everything. " +
        "For anything these simple fields can't express — filtering/grouping by REGION (North/South/East/West/Central/Northeast — e.g. \"West to North\"), " +
        "or a numeric range on expectedVolumeKgPerMonth (e.g. \"over 30,000 kg/month\") — use the `where` clauses instead of guessing at city/state names. " +
        "Every returned lane also already includes originRegion/destRegion and expectedVolumeKgPerMonth, so for a broad question you can often call this once with no filters and reason over the full labeled list yourself rather than issuing several narrow guesses.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          originCity: stringParam("Origin city, partial match"),
          originState: stringParam("Origin state, partial match"),
          destCity: stringParam("Destination city, partial match"),
          destState: stringParam("Destination state, partial match"),
          weightBand: stringParam("Weight band, partial match, e.g. '500-1000'"),
          where: {
            type: Type.ARRAY,
            description:
              "Additional filter clauses, ANDed with each other and with the fields above. Use for region or numeric-range filtering. " +
              "Each clause: {field, op, value}. field: one of originCity, originState, originRegion, destCity, destState, destRegion, weightBand, expectedVolumeKgPerMonth. " +
              "op: 'eq' or 'contains' for text fields (originRegion/destRegion must use 'eq' with an exact region name: North, South, East, West, Central, or Northeast); " +
              "'eq'/'gt'/'gte'/'lt'/'lte' for the numeric field expectedVolumeKgPerMonth. value: always pass as a string, e.g. \"30000\" for a number.",
            items: {
              type: Type.OBJECT,
              properties: {
                field: {
                  type: Type.STRING,
                  enum: ["originCity", "originState", "originRegion", "destCity", "destState", "destRegion", "weightBand", "expectedVolumeKgPerMonth"],
                },
                op: { type: Type.STRING, enum: ["eq", "contains", "gt", "gte", "lt", "lte"] },
                value: stringParam("The value to compare against, as a string even for numeric fields"),
              },
              required: ["field", "op", "value"],
            },
          },
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
      name: "get_lane_charges",
      description:
        "Get individual charge components (freight, fuel surcharge, ODA, pickup, loading, state charge, green tax, FOV/liability, etc.) for one lane — the only tool that breaks a total down into its line items. Use this for any question about a specific charge type (e.g. \"which vendors have a loading charge on this lane\", \"what's vendor A's fuel surcharge here\") — get_flags and aggregate_cost only give totals and flags, not components. Requires laneId (call filter_lanes first to find it); omit vendorId for all vendors. " +
        "When 2+ vendors quote the SAME charge type per-unit (per box, per carton, etc.) on this lane, each of those rows also carries unitEconomicsRank/unitEconomicsNote — a real, code-computed ranking by ₹/unit that's safe to cite directly (the package name doesn't matter, only the rate). This does NOT bridge a per-unit charge against a flat or per-kg one — never claim one is cheaper than the other by inventing a unit count; if asked to compare across bases, say that needs a real reference quantity you don't have.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          laneId: stringParam("Lane id, from filter_lanes"),
          vendorId: stringParam("Vendor id to restrict to; omit for all vendors"),
        },
        required: ["laneId"],
      },
    },
    handler: getLaneCharges,
  },
  {
    declaration: {
      name: "rank_vendor_lanes_by_cost",
      description:
        "Rank ONE vendor's lanes by landed cost, cheapest (or most expensive) first — the only tool that answers questions like \"which lanes is this vendor cheapest on\" or \"top N lanes where vendor X quoted the least\". " +
        "Only ranks lanes with a FULLY resolved total (every charge counted, nothing excluded) — a lane with a partial total (e.g. a per-unit or FOV charge excluded for lack of a cost assumption) is deliberately left OUT of the ranking rather than compared on an artificially lower number, and is listed separately in excludedFromRanking with why. " +
        "Use aggregate_cost instead for one vendor's overall total/average across ALL lanes; use get_lane_charges for one specific lane's individual charge breakdown.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          vendorId: stringParam("The vendor to rank lanes for — a real vendor id, a code (e.g. 'A'), or a name/partial name all work"),
          order: { type: Type.STRING, enum: ["cheapest", "most_expensive"], description: "Sort direction; defaults to cheapest first" },
          limit: { type: Type.NUMBER, description: "How many top lanes to return; defaults to 5" },
        },
        required: ["vendorId"],
      },
    },
    handler: rankVendorLanesByCost,
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
