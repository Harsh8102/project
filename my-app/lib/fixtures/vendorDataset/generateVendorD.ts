// Vendor D — a photo of a printed rate card, all 30 lanes, bundled
// "all-inclusive" rates (no component breakdown), one line rendered
// illegible (blurred, low-contrast) to test the "unreadable, not guessed"
// behavior. Questionnaire complete but low GPS coverage. Terms complete. (§4.2)

import sharp from "sharp";
import { CANONICAL_LANES } from "../canonicalLanes";
import { BASE_RATES } from "./rateModel";
import {
  buildAnsweredQuestionnaireWorkbook,
  buildAnsweredTermsWorkbook,
  workbookToBuffer,
  type FieldAnswers,
} from "./answeredForms";

// The Bengaluru -> Chennai lane (a high-volume lane, so the gap is
// demo-visible) is rendered illegible in the photo.
export const VENDOR_D_ILLEGIBLE_LANE_INDEX = 5;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bundledRate(laneIndex: number): number {
  const rate = BASE_RATES[laneIndex];
  const withFuel = rate.freightPerKg * (1 + rate.fuelSurchargePctOfFreight / 100);
  const withOda = withFuel + (rate.odaPerKg ?? 0);
  return Math.round(withOda * 1.06 * 100) / 100; // bundled convenience markup
}

function buildRateCardSvg(): string {
  const rowHeight = 20;
  const startY = 130;
  const width = 900;
  const height = startY + CANONICAL_LANES.length * rowHeight + 40;

  const rows = CANONICAL_LANES.map((lane, i) => {
    const y = startY + i * rowHeight;
    const isIllegible = lane.laneIndex === VENDOR_D_ILLEGIBLE_LANE_INDEX;
    const route = `${lane.laneIndex + 1}. ${lane.originCity} -> ${lane.destCity}`;
    const rateText = `Rs ${bundledRate(lane.laneIndex)}/kg all-in`;
    // The rate text itself renders normally (fully-formed glyphs) — a
    // mottled stain is composited OVER it below, which reads unambiguously
    // as "something is physically obscuring this value" rather than a
    // blur a vision model can guess through, or blank space it reads as absent.
    // Fully opaque — a translucent stain still let the text show through.
    const stain = isIllegible
      ? `<ellipse cx="555" cy="${y - 4}" rx="80" ry="11" fill="#5b4636" opacity="1"/>`
      : "";
    return `<text x="20" y="${y}" font-size="12" font-family="Courier New, monospace" fill="#161616">${escapeXml(route)}</text>
<text x="620" y="${y}" font-size="12" font-family="Courier New, monospace" fill="#161616" text-anchor="end">${escapeXml(rateText)}</text>
${stain}`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#fdfdf6"/>
  <text x="20" y="40" font-size="24" font-family="Georgia, serif" font-weight="bold" fill="#111">SPEEDWAY LOGISTICS</text>
  <text x="20" y="62" font-size="11" font-family="Arial" fill="#444">PTL Rate Card — All-Inclusive Rates (Freight + Fuel + ODA + Handling combined)</text>
  <line x1="20" y1="76" x2="${width - 20}" y2="76" stroke="#999" stroke-width="1"/>
  <text x="20" y="105" font-size="12" font-family="Arial" font-weight="bold" fill="#000">Lane / Route</text>
  <text x="620" y="105" font-size="12" font-family="Arial" font-weight="bold" fill="#000" text-anchor="end">All-In Rate</text>
  ${rows}
</svg>`;
}

export async function buildRateCardPhoto(): Promise<Buffer> {
  const svg = buildRateCardSvg();
  return sharp(Buffer.from(svg))
    .resize({ width: 1600 })
    .rotate(5.5, { background: "#fdfdf6" })
    .jpeg({ quality: 68 })
    .toBuffer();
}

export const VENDOR_D_QUESTIONNAIRE_ANSWERS: FieldAnswers = {
  under_investigation: false,
  outstanding_legal_issues: false,
  revenue_3yr_cr: 61,
  profit_margin_pct: 6.4,
  fleet_size: 310,
  bs6_compliant_pct: 48,
  avg_vehicle_age_years: 6.2,
  gps_enabled: true,
  gps_coverage_pct: 34, // deliberately low
  erp_integration: false,
  coverage_north: true,
  coverage_south: true,
  coverage_east: false,
  coverage_west: true,
  coverage_central: true,
  coverage_northeast: false,
  certifications_count: 1,
  certifications_list: "ISO 9001:2015",
  company_name: "Speedway Logistics",
  registered_address: "45 GIDC Estate, Vatva, Ahmedabad, Gujarat 382445",
  directors: "M. Patel, J. Shah",
  top5_customers: "Torrent Pharma, Cadila, Arvind Ltd, Zydus, Nirma",
};

export const VENDOR_D_TERMS_ANSWERS: FieldAnswers = {
  payment_terms_days: 60,
  contract_duration_months: 12,
  sla_penalty_clause_present: true,
  insurance_coverage_confirmed: true,
  damages_liability_accepted: true,
  dispute_resolution_accepted: false,
  termination_notice_days: 30,
};

export async function generateVendorDDocuments() {
  const [rates, questionnaire, terms] = await Promise.all([
    buildRateCardPhoto(),
    workbookToBuffer(buildAnsweredQuestionnaireWorkbook(VENDOR_D_QUESTIONNAIRE_ANSWERS)),
    workbookToBuffer(buildAnsweredTermsWorkbook(VENDOR_D_TERMS_ANSWERS)),
  ]);
  return {
    rates: { buffer: rates, fileName: "SpeedwayLogistics_RateCard_Photo.jpg", fileType: "image" as const },
    questionnaire: { buffer: questionnaire, fileName: "SpeedwayLogistics_Questionnaire.xlsx", fileType: "xlsx" as const },
    terms: { buffer: terms, fileName: "SpeedwayLogistics_Terms.xlsx", fileType: "xlsx" as const },
  };
}
