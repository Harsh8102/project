// Proves the scoring methodology against the actual fixture data — no DB,
// no extraction pipeline needed. Run with: npm run score:fixtures
//
// This exists to make lib/scoring/computeScores.ts inspectable on its own:
// answer this concretely -> "how does a raw questionnaire/terms answer turn
// into a comparable score" -> before the extraction pipeline exists to feed
// it real data.

import { computeVendorScore } from "../lib/scoring/computeScores";
import { VENDOR_A_QUESTIONNAIRE_ANSWERS, VENDOR_A_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorA";
import { VENDOR_B_QUESTIONNAIRE_ANSWERS, VENDOR_B_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorB";
import { VENDOR_C_QUESTIONNAIRE_ANSWERS, VENDOR_C_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorC";
import { VENDOR_D_QUESTIONNAIRE_ANSWERS, VENDOR_D_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorD";
import { VENDOR_E_TERMS_ANSWERS } from "../lib/fixtures/vendorDataset/generateVendorE";

const VENDORS = [
  { label: "A - Bharat Roadlines", questionnaire: VENDOR_A_QUESTIONNAIRE_ANSWERS, terms: VENDOR_A_TERMS_ANSWERS },
  { label: "B - Continental Cargo", questionnaire: VENDOR_B_QUESTIONNAIRE_ANSWERS, terms: VENDOR_B_TERMS_ANSWERS },
  { label: "C - Sagar Transport", questionnaire: VENDOR_C_QUESTIONNAIRE_ANSWERS, terms: VENDOR_C_TERMS_ANSWERS },
  { label: "D - Speedway Logistics", questionnaire: VENDOR_D_QUESTIONNAIRE_ANSWERS, terms: VENDOR_D_TERMS_ANSWERS },
  { label: "E - TransGlobal Freight", questionnaire: null, terms: VENDOR_E_TERMS_ANSWERS }, // no questionnaire submitted
];

for (const vendor of VENDORS) {
  const result = computeVendorScore({
    vendorId: vendor.label,
    vendorLabel: vendor.label,
    questionnaireAnswers: vendor.questionnaire,
    termsAnswers: vendor.terms,
    rateCompetitivenessScore: null, // not wired yet — extraction pipeline isn't built
  });

  console.log(`\n=== ${result.vendorLabel} ===`);
  console.log(
    `Questionnaire: ${result.questionnaire ? `${result.questionnaire.sectionScore}/100 (${result.questionnaire.completenessPct}% complete)` : "NOT SUBMITTED"}`
  );
  if (result.questionnaire) {
    for (const d of result.questionnaire.dimensions) {
      console.log(`  ${d.label}: ${d.value ?? "-"} -> ${d.score}/100`);
    }
  }
  console.log(
    `Terms: ${result.terms ? `${result.terms.sectionScore}/100 (${result.terms.completenessPct}% complete)` : "NOT SUBMITTED"}`
  );
  if (result.terms) {
    for (const d of result.terms.dimensions) {
      console.log(`  ${d.label}: ${d.value ?? "-"} -> ${d.score}/100`);
    }
  }

  if (result.gateFailures.length > 0) {
    console.log(`GATE FAILURES (excluded from ranking):`);
    for (const f of result.gateFailures) console.log(`  [${f.section}] ${f.reason}`);
  } else {
    console.log(`All gates passed.`);
  }
}

console.log(
  "\nNote: overallScore is null for every vendor above until rate competitiveness is wired in (extraction pipeline, not yet built) — this run only proves the questionnaire/terms scoring half."
);
