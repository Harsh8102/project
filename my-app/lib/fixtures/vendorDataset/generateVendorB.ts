// Vendor B — a from-region/to-region rate MATRIX (not a per-lane table),
// quoted in USD, with a minimum guaranteed weight per cell. The document
// explicitly defines which cities each region covers (a matrix that just
// says "North/South/East/West" with no city list forces the reader to
// guess — the extraction pipeline shouldn't have to guess either). Two
// coverage gaps, deliberately different in kind:
//   1. Central and Northeast are absent from the matrix entirely (region-level gap)
//   2. Goa and Udaipur are explicitly excluded even though West/North are
//      otherwise served (city-level gap within a served region — realistic:
//      transporters skip specific small/remote towns inside a zone they
//      broadly cover)
// Charge headers are real-world synonyms, not the canonical taxonomy labels
// verbatim (§5.1a needs something to actually map). Questionnaire is
// missing both compliance gate answers. Terms are complete. (§4.2)

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CANONICAL_LANES, type CanonicalLane } from "../canonicalLanes";
import { USD_TO_INR } from "./rateModel";
import { getRegionForState, getCitiesByRegion, type Region } from "../../normalization/regions";
import {
  buildAnsweredQuestionnaireWorkbook,
  buildAnsweredTermsWorkbook,
  workbookToBuffer,
  type FieldAnswers,
} from "./answeredForms";

// Vendor B only serves these 4 regions — Central and Northeast are absent
// from the matrix entirely, not quoted as "0" or blank.
const SERVED_REGIONS: Region[] = ["North", "South", "East", "West"];

// Explicitly excluded even within a served region — a city-level gap, not a
// region-level one. Chosen because they're the smaller/more remote city in
// their region (Goa within West, Udaipur within North).
const EXCLUDED_CITIES = new Set(["Goa", "Udaipur"]);

// Hand-set regional adjacency (1 = same region, 2 = adjacent, 3 = far) —
// drives both the rate and the minimum guaranteed weight per matrix cell.
const REGION_DISTANCE: Record<string, number> = {
  "North-North": 1, "South-South": 1, "East-East": 1, "West-West": 1,
  "North-West": 2, "West-North": 2,
  "West-South": 2, "South-West": 2,
  "North-East": 2, "East-North": 2,
  "South-East": 3, "East-South": 3,
  "North-South": 3, "South-North": 3,
  "West-East": 3, "East-West": 3,
};

export type MatrixCell = {
  fromRegion: Region;
  toRegion: Region;
  ratePerKgUsd: number;
  minGuaranteedWeightKg: number;
  fuelSurchargePct: number;
};

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRegionMatrix(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  let seed = 0;
  for (const fromRegion of SERVED_REGIONS) {
    for (const toRegion of SERVED_REGIONS) {
      const distance = REGION_DISTANCE[`${fromRegion}-${toRegion}`];
      const rand = mulberry32(seed++ * 97 + 11);
      const baseInr = 3 + distance * 1.8 + rand() * 0.8;
      cells.push({
        fromRegion,
        toRegion,
        ratePerKgUsd: Math.round((baseInr / USD_TO_INR) * 100) / 100,
        minGuaranteedWeightKg: distance === 1 ? 300 : distance === 2 ? 500 : 750,
        fuelSurchargePct: Math.round((9 + distance * 0.6 + rand() * 1.5) * 10) / 10,
      });
    }
  }
  return cells;
}

/** Which canonical lanes have NO applicable rate — region not served, or a city explicitly excluded. */
export function getVendorBUnservedLanes(): CanonicalLane[] {
  return CANONICAL_LANES.filter((lane) => {
    const originRegion = getRegionForState(lane.originState);
    const destRegion = getRegionForState(lane.destState);
    const regionGap = !SERVED_REGIONS.includes(originRegion) || !SERVED_REGIONS.includes(destRegion);
    const cityGap = EXCLUDED_CITIES.has(lane.originCity) || EXCLUDED_CITIES.has(lane.destCity);
    return regionGap || cityGap;
  });
}

function wrapList(items: string[], perLine = 6): string[] {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += perLine) {
    lines.push(items.slice(i, i + perLine).join(", "));
  }
  return lines;
}

async function buildRateMatrixPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595, 842]); // portrait A4
  const margin = 45;
  let y = 800;

  page.drawText("CONTINENTAL CARGO MOVERS", { x: margin, y, size: 15, font: bold, color: rgb(0.1, 0.1, 0.4) });
  y -= 14;
  page.drawText("PTL & FTL Freight Solutions Across India | GSTIN: 27AACCC1234M1Z5", { x: margin, y, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
  y -= 9;
  page.drawText("Plot 22, Sector 5, Ghansoli, Navi Mumbai, Maharashtra 400701 | Ph: +91 22 4567 8900", { x: margin, y, size: 7.5, font, color: rgb(0.35, 0.35, 0.35) });
  y -= 20;
  page.drawText("Zone-to-Zone Rate Card (Quoted in USD)", { x: margin, y, size: 11.5, font: bold });
  y -= 13;
  page.drawText("We currently do not service Central India or the Northeast — no rates quoted for those zones.", { x: margin, y, size: 8.5, font: bold, color: rgb(0.5, 0.15, 0.15) });
  y -= 16;

  // Region definitions — the part a bare "North/South/East/West" matrix
  // leaves the reader to guess.
  const citiesByRegion = getCitiesByRegion(CANONICAL_LANES);
  page.drawText("Zone Definitions:", { x: margin, y, size: 9.5, font: bold });
  y -= 12;
  for (const region of SERVED_REGIONS) {
    const servedCities = citiesByRegion[region].filter((c) => !EXCLUDED_CITIES.has(c));
    page.drawText(`${region}:`, { x: margin, y, size: 8, font: bold });
    for (const line of wrapList(servedCities)) {
      page.drawText(line, { x: margin + 45, y, size: 8, font });
      y -= 10;
    }
  }
  y -= 2;
  page.drawText(
    `Note: within the zones above, we do not currently service ${Array.from(EXCLUDED_CITIES).join(" or ")} — please confirm separately if quoted.`,
    { x: margin, y, size: 8, font: bold, color: rgb(0.5, 0.15, 0.15) }
  );
  y -= 18;

  const matrix = buildRegionMatrix();
  const colWidth = (595 - margin * 2 - 90) / SERVED_REGIONS.length;

  page.drawText("From \\ To", { x: margin, y, size: 8, font: bold });
  SERVED_REGIONS.forEach((region, i) => {
    page.drawText(region, { x: margin + 90 + i * colWidth, y, size: 9, font: bold });
  });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: 595 - margin, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  y -= 15;

  for (const fromRegion of SERVED_REGIONS) {
    page.drawText(fromRegion, { x: margin, y, size: 9, font: bold });
    SERVED_REGIONS.forEach((toRegion, i) => {
      const cell = matrix.find((c) => c.fromRegion === fromRegion && c.toRegion === toRegion)!;
      const text = `$${cell.ratePerKgUsd}/kg`;
      page.drawText(text, { x: margin + 90 + i * colWidth, y, size: 9, font });
    });
    y -= 15;
  }

  y -= 6;
  page.drawText("Min Guaranteed Weight & Fuel Surcharge by zone pair:", { x: margin, y, size: 8.5, font: bold });
  y -= 12;
  for (const cell of matrix) {
    if (cell.fromRegion > cell.toRegion) continue; // print each unordered pair once
    const text = `${cell.fromRegion} <-> ${cell.toRegion}: Min Gtd Wt ${cell.minGuaranteedWeightKg} kg, Fuel Cost Adjustment Factor ${cell.fuelSurchargePct}%`;
    page.drawText(text, { x: margin, y, size: 7.5, font, color: rgb(0.25, 0.25, 0.25) });
    y -= 10.5;
  }

  y -= 10;
  page.drawText("Other Charges (flat, applicable across all zones):", { x: margin, y, size: 9.5, font: bold });
  y -= 14;

  // Diversified, real-world-synonym headers — deliberately NOT the canonical
  // taxonomy labels, so header semantic mapping (§5.1a) has real work to do.
  const otherCharges: [string, string][] = [
    ["Origin Handling Fee", "$4.10 flat per shipment"],
    ["Destination Handling (per package)", "$0.95 per package"],
    ["Remote Area Surcharge", "$0.05/kg for non-metro PIN codes"],
    ["Statutory / Entry Charges", "$1.80 flat, applicable as per state"],
    ["Cargo Liability Premium", "0.22% of declared invoice value"],
  ];
  for (const [label, value] of otherCharges) {
    page.drawText(label, { x: margin, y, size: 8.5, font: bold });
    page.drawText(value, { x: margin + 225, y, size: 8.5, font });
    y -= 12.5;
  }

  y -= 8;
  page.drawText(
    "All rates in USD ($). Rates apply per shipment weight; below minimum guaranteed weight, MGW is chargeable.",
    { x: margin, y, size: 7, font, color: rgb(0.4, 0.4, 0.4) }
  );

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export const VENDOR_B_QUESTIONNAIRE_ANSWERS: FieldAnswers = {
  // under_investigation and outstanding_legal_issues intentionally omitted — missing gate fields
  revenue_3yr_cr: 52,
  profit_margin_pct: 7.2,
  fleet_size: 260,
  bs6_compliant_pct: 61,
  avg_vehicle_age_years: 4.6,
  gps_enabled: true,
  gps_coverage_pct: 84,
  erp_integration: false,
  coverage_north: true,
  coverage_south: true,
  coverage_east: true,
  coverage_west: true,
  coverage_central: false,
  coverage_northeast: false,
  certifications_count: 1,
  certifications_list: "ISO 9001:2015",
  company_name: "Continental Cargo Movers",
  registered_address: "Plot 22, Sector 5, Ghansoli, Navi Mumbai, Maharashtra 400701",
  directors: "A. Fernandes",
  top5_customers: "Bajaj Electricals, Whirlpool, Voltas, Blue Star, Crompton",
};

export const VENDOR_B_TERMS_ANSWERS: FieldAnswers = {
  payment_terms_days: 30,
  contract_duration_months: 12,
  sla_penalty_clause_present: true,
  insurance_coverage_confirmed: true,
  damages_liability_accepted: true,
  dispute_resolution_accepted: true,
  termination_notice_days: 45,
};

export async function generateVendorBDocuments() {
  const [rates, questionnaire, terms] = await Promise.all([
    buildRateMatrixPdf(),
    workbookToBuffer(buildAnsweredQuestionnaireWorkbook(VENDOR_B_QUESTIONNAIRE_ANSWERS)),
    workbookToBuffer(buildAnsweredTermsWorkbook(VENDOR_B_TERMS_ANSWERS)),
  ]);
  return {
    rates: { buffer: rates, fileName: "ContinentalCargo_ZoneRateMatrix.pdf", fileType: "pdf" as const },
    questionnaire: { buffer: questionnaire, fileName: "ContinentalCargo_Questionnaire.xlsx", fileType: "xlsx" as const },
    terms: { buffer: terms, fileName: "ContinentalCargo_Terms.xlsx", fileType: "xlsx" as const },
  };
}
