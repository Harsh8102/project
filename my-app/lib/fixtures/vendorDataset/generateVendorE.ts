// Vendor E — rates pasted as plain email text, only 4 of 30 lanes quoted,
// plus one unsolicited lane not on the RFx list. Questionnaire not
// submitted at all. Terms complete. (§4.2 of the functional plan)
//
// Deliberately loose, "trust me, rest is same as last year" phrasing —
// mirrors the brief's own worked example almost verbatim.

import { CANONICAL_LANES } from "../canonicalLanes";
import { BASE_RATES } from "./rateModel";
import { buildAnsweredTermsWorkbook, workbookToBuffer, type FieldAnswers } from "./answeredForms";

// Mumbai -> Pune, Mumbai -> Ahmedabad, Bengaluru -> Chennai, Bengaluru -> Hyderabad
export const VENDOR_E_QUOTED_LANE_INDICES = [0, 1, 5, 6];

export function buildRatesEmailText(): string {
  const lines: string[] = [
    "From: sales@transglobalfreight.example.com",
    "To: procurement@buyer.example.com",
    "Subject: RE: PTL Freight Lanes - Rate Quote",
    "",
    "Hi,",
    "",
    "Thanks for sending over the lane list. Here are our rates for the ones we can commit to right now,",
    "the rest of our network is still being onboarded for PTL so we'll hold off quoting on those:",
    "",
  ];

  for (const laneIndex of VENDOR_E_QUOTED_LANE_INDICES) {
    const lane = CANONICAL_LANES[laneIndex];
    const rate = BASE_RATES[laneIndex];
    lines.push(
      `- ${lane.originCity} to ${lane.destCity}: Rs ${rate.freightPerKg}/kg, fuel extra as per govt norms, rest same as last year.`
    );
  }

  lines.push(
    "",
    "Also wanted to flag - we can do Mumbai to Nagpur at Rs 6.20/kg if that's useful, we run that route daily for another client so happy to add it on.",
    "",
    "Let us know if you need anything else, questionnaire and terms doc to follow separately.",
    "",
    "Best,",
    "Rakesh",
    "TransGlobal Freight Solutions"
  );

  return lines.join("\n");
}

export const VENDOR_E_TERMS_ANSWERS: FieldAnswers = {
  payment_terms_days: 45,
  contract_duration_months: 6,
  sla_penalty_clause_present: true,
  insurance_coverage_confirmed: true,
  damages_liability_accepted: true,
  dispute_resolution_accepted: true,
  termination_notice_days: 30,
};

export async function generateVendorEDocuments() {
  const [terms] = await Promise.all([workbookToBuffer(buildAnsweredTermsWorkbook(VENDOR_E_TERMS_ANSWERS))]);
  return {
    rates: {
      buffer: Buffer.from(buildRatesEmailText(), "utf-8"),
      fileName: "TransGlobal_RateEmail.txt",
      fileType: "text" as const,
    },
    // No questionnaire document — vendor E did not submit one (edge case #11).
    terms: { buffer: terms, fileName: "TransGlobal_Terms.xlsx", fileType: "xlsx" as const },
  };
}
