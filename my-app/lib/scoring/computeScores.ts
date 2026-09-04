// The scoring engine (§2.5 / §6 of the plans). Pure, deterministic, no LLM
// involved — this is what "the LLM never does arithmetic that lands on
// screen" (§7 trust section) means in practice. Operates on plain
// field-key -> value maps so it works the same whether those values came
// from ExtractedField documents (real pipeline) or straight from a fixture
// (this is what scripts/scoreFixtures.ts exercises today, before extraction
// exists) — one formula, one implementation, called from the Decision
// Summary page, the `rank_vendors` chat tool, and DecisionRecord snapshots.

import { QUESTIONNAIRE_FIELDS, type QuestionnaireField } from "../fixtures/questionnaireFields";
import { TERMS_FIELDS, type TermsField } from "../fixtures/termsFields";
import { scoreAgainstBenchmark } from "./benchmark";

type AnswerMap = Record<string, unknown>;

export type GateResult = {
  key: string;
  label: string;
  pass: boolean;
  value: unknown;
  reason: string;
};

export type DimensionResult = {
  key: string;
  category: string;
  label: string;
  value: unknown;
  score: number; // 0-100
};

export type SectionScore = {
  gates: GateResult[];
  allGatesPassed: boolean;
  dimensions: DimensionResult[];
  /** Simple average of dimension scores — every scored field weighted equally within a section. */
  sectionScore: number;
  completenessPct: number; // % of applicable fields (gate + scored) that had a value at all
};

function scoreSection<F extends QuestionnaireField | TermsField>(
  fields: F[],
  answers: AnswerMap
): SectionScore {
  const gates: GateResult[] = [];
  const dimensions: DimensionResult[] = [];
  let answeredApplicable = 0;
  let totalApplicable = 0;

  for (const field of fields) {
    if (field.type === "informational") continue; // never scored, by design
    totalApplicable++;
    const value = answers[field.key];
    const hasValue = value !== undefined && value !== null && value !== "";
    if (hasValue) answeredApplicable++;

    if (field.type === "gate") {
      const pass = hasValue && value === field.gatePassValue;
      gates.push({
        key: field.key,
        label: "question" in field ? field.question : field.term,
        pass,
        value,
        reason: !hasValue
          ? "Not answered"
          : pass
            ? "Meets requirement"
            : `Expected ${field.gatePassValue ? "Yes" : "No"}, got ${value === true ? "Yes" : value === false ? "No" : "no answer"}`,
      });
      continue;
    }

    // scored
    const benchmark = field.benchmark;
    const score = benchmark ? scoreAgainstBenchmark(value, benchmark) : 0;
    dimensions.push({
      key: field.key,
      category: "category" in field ? field.category : "Terms",
      label: "question" in field ? field.question : field.term,
      value: hasValue ? value : null,
      score,
    });
  }

  const sectionScore = dimensions.length
    ? Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length)
    : 0;

  return {
    gates,
    allGatesPassed: gates.every((g) => g.pass),
    dimensions,
    sectionScore,
    completenessPct: totalApplicable ? Math.round((answeredApplicable / totalApplicable) * 100) : 100,
  };
}

export function computeQuestionnaireScore(answers: AnswerMap): SectionScore {
  return scoreSection(QUESTIONNAIRE_FIELDS, answers);
}

export function computeTermsScore(answers: AnswerMap): SectionScore {
  return scoreSection(TERMS_FIELDS, answers);
}

export type VendorScoreWeights = {
  rateCompetitiveness: number;
  questionnaire: number;
  terms: number;
};

export const DEFAULT_WEIGHTS: VendorScoreWeights = {
  rateCompetitiveness: 0.5,
  questionnaire: 0.3,
  terms: 0.2,
};

export type VendorScoreInput = {
  vendorId: string;
  vendorLabel: string;
  questionnaireAnswers: AnswerMap | null; // null = questionnaire not submitted at all
  termsAnswers: AnswerMap | null; // null = terms not submitted at all
  /** 0-100, computed elsewhere from extracted rate data (not yet wired — extraction pipeline is a later build step). */
  rateCompetitivenessScore: number | null;
};

export type VendorScoreResult = {
  vendorId: string;
  vendorLabel: string;
  questionnaire: SectionScore | null;
  terms: SectionScore | null;
  rateCompetitivenessScore: number | null;
  /** Every gate failure across both sections, plus "section not submitted" as an automatic gate failure (edge case #11). */
  gateFailures: { section: "questionnaire" | "terms"; reason: string }[];
  excludedFromRanking: boolean;
  overallScore: number | null; // null if excluded or an input section is missing
};

/** §2.5's formula: vendor_score = w1*rate + w2*questionnaire + w3*terms, any gate failure -> excluded. */
export function computeVendorScore(
  input: VendorScoreInput,
  weights: VendorScoreWeights = DEFAULT_WEIGHTS
): VendorScoreResult {
  const questionnaire = input.questionnaireAnswers ? computeQuestionnaireScore(input.questionnaireAnswers) : null;
  const terms = input.termsAnswers ? computeTermsScore(input.termsAnswers) : null;

  const gateFailures: VendorScoreResult["gateFailures"] = [];
  if (!input.questionnaireAnswers) {
    gateFailures.push({ section: "questionnaire", reason: "Questionnaire not submitted" });
  } else {
    for (const g of questionnaire!.gates) {
      if (!g.pass) gateFailures.push({ section: "questionnaire", reason: `${g.label}: ${g.reason}` });
    }
  }
  if (!input.termsAnswers) {
    gateFailures.push({ section: "terms", reason: "Terms not submitted" });
  } else {
    for (const g of terms!.gates) {
      if (!g.pass) gateFailures.push({ section: "terms", reason: `${g.label}: ${g.reason}` });
    }
  }

  const excludedFromRanking = gateFailures.length > 0;

  let overallScore: number | null = null;
  if (!excludedFromRanking && questionnaire && terms && input.rateCompetitivenessScore !== null) {
    overallScore = Math.round(
      weights.rateCompetitiveness * input.rateCompetitivenessScore +
        weights.questionnaire * questionnaire.sectionScore +
        weights.terms * terms.sectionScore
    );
  }

  return {
    vendorId: input.vendorId,
    vendorLabel: input.vendorLabel,
    questionnaire,
    terms,
    rateCompetitivenessScore: input.rateCompetitivenessScore,
    gateFailures,
    excludedFromRanking,
    overallScore,
  };
}
