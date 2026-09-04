// Terms & conditions schema (§3.4 of the functional plan) — defined fresh,
// not adapted from the source RFI. Same "single source of truth" role as
// questionnaireFields.ts: drives both the blank template and the extractor.

import type { FieldType, FieldDataType } from "./questionnaireFields";
import type { ScoringBenchmark } from "../scoring/benchmark";

export type TermsField = {
  key: string;
  term: string;
  type: FieldType;
  dataType: FieldDataType;
  /** Shown on the template so vendors know what "good" looks like. */
  buyerIdeal?: string;
  gatePassValue?: boolean;
  /** For scored fields: how the raw value becomes a 0-100 score. See lib/scoring/benchmark.ts. */
  benchmark?: ScoringBenchmark;
};

export const TERMS_FIELDS: TermsField[] = [
  { key: "payment_terms_days", term: "Payment terms (days)", type: "scored", dataType: "number", buyerIdeal: "45 days", benchmark: { kind: "closest_to_target", target: 45, tolerance: 30 } },
  { key: "contract_duration_months", term: "Contract duration (months)", type: "scored", dataType: "number", buyerIdeal: "12 months", benchmark: { kind: "closest_to_target", target: 12, tolerance: 12 } },
  { key: "sla_penalty_clause_present", term: "SLA / delay penalty clause present and accepted?", type: "gate", dataType: "boolean", gatePassValue: true, buyerIdeal: "Yes" },
  { key: "insurance_coverage_confirmed", term: "Cargo insurance coverage confirmed?", type: "gate", dataType: "boolean", gatePassValue: true, buyerIdeal: "Yes" },
  { key: "damages_liability_accepted", term: "Damages/liability clause accepted as per buyer's standard terms?", type: "scored", dataType: "boolean", buyerIdeal: "Yes", benchmark: { kind: "boolean_true_is_better" } },
  { key: "dispute_resolution_accepted", term: "Dispute resolution clause (arbitration, jurisdiction) accepted?", type: "scored", dataType: "boolean", buyerIdeal: "Yes", benchmark: { kind: "boolean_true_is_better" } },
  { key: "termination_notice_days", term: "Termination notice period (days)", type: "informational", dataType: "number" },
];
