// Genericized RFI-style questionnaire (§3.3 of the functional plan).
// Single source of truth used by both the blank buyer-side template
// (lib/files/generateTemplates.ts) and the extraction schema
// (lib/ai/extraction/schema.ts) — the template's columns are exactly what
// the extractor is told to look for, so they can't drift apart.

import type { ScoringBenchmark } from "../scoring/benchmark";

export type FieldType = "gate" | "scored" | "informational";
export type FieldDataType = "boolean" | "number" | "text";

export type QuestionnaireField = {
  key: string;
  category: string;
  question: string;
  type: FieldType;
  dataType: FieldDataType;
  /** For gate fields: the boolean value that counts as a PASS. */
  gatePassValue?: boolean;
  /** For scored fields: how the raw value becomes a 0-100 score. See lib/scoring/benchmark.ts. */
  benchmark?: ScoringBenchmark;
};

export const QUESTIONNAIRE_FIELDS: QuestionnaireField[] = [
  // Compliance — gates
  { key: "under_investigation", category: "Compliance", question: "Is the company currently under any regulatory or legal investigation?", type: "gate", dataType: "boolean", gatePassValue: false },
  { key: "outstanding_legal_issues", category: "Compliance", question: "Are there any outstanding legal disputes material to this contract?", type: "gate", dataType: "boolean", gatePassValue: false },

  // Financials — scored
  { key: "revenue_3yr_cr", category: "Financials", question: "Average annual revenue over the last 3 years (INR crore)", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 60 } },
  { key: "profit_margin_pct", category: "Financials", question: "Net profit margin (%)", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 10 } },

  // Fleet — scored
  { key: "fleet_size", category: "Fleet", question: "Total number of owned/leased trucks", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 300 } },
  { key: "bs6_compliant_pct", category: "Fleet", question: "% of fleet that is BS-6 compliant", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 75 } },
  { key: "avg_vehicle_age_years", category: "Fleet", question: "Average vehicle age (years)", type: "scored", dataType: "number", benchmark: { kind: "lower_is_better", target: 4 } },

  // Technology — scored
  { key: "gps_enabled", category: "Technology", question: "Is GPS tracking enabled across the fleet?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "gps_coverage_pct", category: "Technology", question: "% of fleet with live GPS coverage", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 90 } },
  { key: "erp_integration", category: "Technology", question: "Can you integrate with buyer ERP / provide automated MIS & email support?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },

  // Regional presence — scored. Keys match lib/normalization/regions.ts's
  // regionCoverageFieldKey() so scoring can check coverage against the
  // regions this RFx's lanes actually touch, not just count "yes" answers.
  { key: "coverage_north", category: "Regional Presence", question: "Do you operate hubs/warehouses in North India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "coverage_south", category: "Regional Presence", question: "Do you operate hubs/warehouses in South India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "coverage_east", category: "Regional Presence", question: "Do you operate hubs/warehouses in East India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "coverage_west", category: "Regional Presence", question: "Do you operate hubs/warehouses in West India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "coverage_central", category: "Regional Presence", question: "Do you operate hubs/warehouses in Central India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },
  { key: "coverage_northeast", category: "Regional Presence", question: "Do you operate hubs/warehouses in Northeast India?", type: "scored", dataType: "boolean", benchmark: { kind: "boolean_true_is_better" } },

  // Certifications — scored
  { key: "certifications_count", category: "Certifications", question: "Number of active quality/safety certifications (ISO, etc.)", type: "scored", dataType: "number", benchmark: { kind: "higher_is_better", target: 3 } },
  { key: "certifications_list", category: "Certifications", question: "List active certifications", type: "informational", dataType: "text" },

  // Business info — informational (free text; never scored — this is the
  // genuinely subjective content, and it's excluded from the scorecard on
  // purpose, not overlooked)
  { key: "company_name", category: "Business Info", question: "Legal company name", type: "informational", dataType: "text" },
  { key: "registered_address", category: "Business Info", question: "Registered address", type: "informational", dataType: "text" },
  { key: "directors", category: "Business Info", question: "Names of directors", type: "informational", dataType: "text" },
  { key: "top5_customers", category: "Business Info", question: "Top 5 customers by volume", type: "informational", dataType: "text" },
];
