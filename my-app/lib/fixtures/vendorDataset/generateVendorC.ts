// Vendor C — rates in prose (Word doc), all 30 lanes, with "per carton"
// loading charges where 1 carton = 20 units (the brief's own "per box ≠ per
// 100 pieces" edge case). Terms submitted as PDF instead of the required
// xlsx (format-rule violation). Questionnaire is complete. (§4.2)

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CANONICAL_LANES, type CanonicalLane } from "../canonicalLanes";
import { BASE_RATES } from "./rateModel";
import {
  buildAnsweredQuestionnaireWorkbook,
  workbookToBuffer,
  type FieldAnswers,
} from "./answeredForms";
import { TERMS_FIELDS } from "../termsFields";

export const UNITS_PER_CARTON = 20;
export const VENDOR_C_MARKUP = 1.04; // ~4% above vendor A baseline

function laneSentence(lane: CanonicalLane): string {
  const rate = BASE_RATES[lane.laneIndex];
  const freight = Math.round(rate.freightPerKg * VENDOR_C_MARKUP * 100) / 100;
  const cartonRate = Math.round(rate.loadingPerBox * UNITS_PER_CARTON * 0.98);
  const bits = [
    `${lane.destCity} at Rs ${freight}/kg (fuel surcharge ${rate.fuelSurchargePctOfFreight}% extra)`,
    `loading Rs ${cartonRate} per carton`,
  ];
  if (rate.odaPerKg != null) bits.push(`ODA Rs ${rate.odaPerKg}/kg for non-standard delivery points`);
  if (rate.stateCharge) {
    const label = rate.stateCharge.basis === "inter_state_flat" ? "inter-state charges" : "local state charges";
    bits.push(`${label} of Rs ${rate.stateCharge.value} as applicable`);
  }
  bits.push(`pickup Rs ${rate.pickupFlat} flat, FOV ${rate.fovPctOfInvoiceValue}% of invoice value`);
  return `To ${bits.join(", ")}.`;
}

export async function buildRatesDocx(): Promise<Buffer> {
  const originGroups = new Map<string, CanonicalLane[]>();
  for (const lane of CANONICAL_LANES) {
    const list = originGroups.get(lane.originCity) ?? [];
    list.push(lane);
    originGroups.set(lane.originCity, list);
  }

  const children: Paragraph[] = [
    new Paragraph({ text: "Sagar Transport Co. — Freight Rate Quotation", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun(
          "Please find below our quoted rates for the requested lanes. Note: our loading charge is quoted per carton, and 1 carton = 20 individual units/packages — please account for this when comparing against per-unit rates. All rates are in INR and exclude any charges not mentioned below."
        ),
      ],
      spacing: { after: 200 },
    }),
  ];

  for (const [origin, lanes] of originGroups) {
    children.push(new Paragraph({ text: `From ${origin}:`, heading: HeadingLevel.HEADING_2 }));
    for (const lane of lanes) {
      children.push(new Paragraph({ children: [new TextRun(laneSentence(lane))], spacing: { after: 120 } }));
    }
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Rates valid for the contract period; revision possible if diesel prices move beyond +/-10%.",
          italics: true,
        }),
      ],
      spacing: { before: 200 },
    })
  );

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

export const VENDOR_C_TERMS_ANSWERS: FieldAnswers = {
  payment_terms_days: 30,
  contract_duration_months: 12,
  sla_penalty_clause_present: true,
  insurance_coverage_confirmed: true,
  damages_liability_accepted: false,
  dispute_resolution_accepted: true,
  termination_notice_days: 30,
};

/** Terms submitted as a PDF — the deliberate format-rule violation vendor C tests. */
export async function buildTermsPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595, 842]); // portrait A4
  const margin = 50;
  let y = 792;

  page.drawText("Sagar Transport Co. — Terms & Conditions", { x: margin, y, size: 14, font: bold });
  y -= 30;

  for (const field of TERMS_FIELDS) {
    const value = VENDOR_C_TERMS_ANSWERS[field.key];
    const formatted = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "-");
    page.drawText(field.term, { x: margin, y, size: 10, font: bold });
    y -= 14;
    page.drawText(`Response: ${formatted}`, { x: margin + 10, y, size: 10, font });
    y -= 22;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export const VENDOR_C_QUESTIONNAIRE_ANSWERS: FieldAnswers = {
  under_investigation: false,
  outstanding_legal_issues: false,
  revenue_3yr_cr: 38,
  profit_margin_pct: 8.1,
  fleet_size: 190,
  bs6_compliant_pct: 55,
  avg_vehicle_age_years: 5.1,
  gps_enabled: true,
  gps_coverage_pct: 72,
  erp_integration: true,
  coverage_north: false,
  coverage_south: true,
  coverage_east: false,
  coverage_west: true,
  coverage_central: false,
  coverage_northeast: false,
  certifications_count: 2,
  certifications_list: "ISO 9001:2015, IATI Member",
  company_name: "Sagar Transport Co.",
  registered_address: "12 Anna Salai, Teynampet, Chennai, Tamil Nadu 600018",
  directors: "K. Subramaniam",
  top5_customers: "TVS Motor, Ashok Leyland, Sanmina, Cognizant Facilities, Royal Enfield",
};

export async function generateVendorCDocuments() {
  const [rates, questionnaire, terms] = await Promise.all([
    buildRatesDocx(),
    workbookToBuffer(buildAnsweredQuestionnaireWorkbook(VENDOR_C_QUESTIONNAIRE_ANSWERS)),
    buildTermsPdf(),
  ]);
  return {
    rates: { buffer: rates, fileName: "SagarTransport_Rates.docx", fileType: "docx" as const },
    questionnaire: { buffer: questionnaire, fileName: "SagarTransport_Questionnaire.xlsx", fileType: "xlsx" as const },
    terms: { buffer: terms, fileName: "SagarTransport_Terms.pdf", fileType: "pdf" as const },
  };
}
