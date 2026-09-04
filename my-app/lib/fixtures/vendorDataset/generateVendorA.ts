// Vendor A — happy path baseline (§4.2 of the functional plan).
// Excel rates that match the expected structure exactly, complete
// questionnaire, complete terms. Vendor A's rates ARE the ground-truth
// baseline (BASE_RATES, unmodified) that the other 4 vendors deviate from.

import ExcelJS from "exceljs";
import { CANONICAL_LANES } from "../canonicalLanes";
import { BASE_RATES } from "./rateModel";
import {
  buildAnsweredQuestionnaireWorkbook,
  buildAnsweredTermsWorkbook,
  workbookToBuffer,
  type FieldAnswers,
} from "./answeredForms";

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
}

/** A well-formed rate card, basis baked into each column header like a real vendor xlsx. */
export function buildRateCardWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rate Card");
  sheet.columns = [
    { header: "Lane #", key: "laneIndex", width: 8 },
    { header: "Origin", key: "origin", width: 20 },
    { header: "Destination", key: "dest", width: 20 },
    { header: "Freight Charge (Rs/kg)", key: "freight", width: 20 },
    { header: "Fuel Surcharge (% of freight)", key: "fuel", width: 24 },
    { header: "ODA Charge (Rs/kg)", key: "oda", width: 18 },
    { header: "Pickup Charge (Rs flat)", key: "pickup", width: 20 },
    { header: "Loading Charge (Rs/box)", key: "loading", width: 20 },
    { header: "State Charge Basis", key: "stateBasis", width: 20 },
    { header: "State Charge (Rs)", key: "stateValue", width: 18 },
    { header: "Green Tax (Rs flat)", key: "greenTax", width: 18 },
    { header: "Additional Location Charge (Rs flat)", key: "addlLocation", width: 30 },
    { header: "FOV / Liability (% of invoice value)", key: "fov", width: 28 },
    { header: "Min Chargeable Weight (kg)", key: "minWeight", width: 24 },
  ];

  for (const lane of CANONICAL_LANES) {
    const rate = BASE_RATES[lane.laneIndex];
    sheet.addRow({
      laneIndex: lane.laneIndex + 1,
      origin: `${lane.originCity}, ${lane.originState}`,
      dest: `${lane.destCity}, ${lane.destState}`,
      freight: rate.freightPerKg,
      fuel: rate.fuelSurchargePctOfFreight,
      oda: rate.odaPerKg ?? "",
      pickup: rate.pickupFlat,
      loading: rate.loadingPerBox,
      stateBasis: rate.stateCharge?.basis ?? "",
      stateValue: rate.stateCharge?.value ?? "",
      greenTax: rate.greenTaxFlat ?? "",
      addlLocation: rate.additionalLocationFlat ?? "",
      fov: rate.fovPctOfInvoiceValue,
      minWeight: rate.minChargeableWeightKg,
    });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

export const VENDOR_A_QUESTIONNAIRE_ANSWERS: FieldAnswers = {
  under_investigation: false,
  outstanding_legal_issues: false,
  revenue_3yr_cr: 85,
  profit_margin_pct: 9.5,
  fleet_size: 420,
  bs6_compliant_pct: 78,
  avg_vehicle_age_years: 3.2,
  gps_enabled: true,
  gps_coverage_pct: 96,
  erp_integration: true,
  coverage_north: true,
  coverage_south: true,
  coverage_east: true,
  coverage_west: true,
  coverage_central: true,
  coverage_northeast: false,
  certifications_count: 3,
  certifications_list: "ISO 9001:2015, ISO 39001:2012, GDP Certified",
  company_name: "Bharat Roadlines Pvt Ltd",
  registered_address: "Plot 14, MIDC Industrial Area, Andheri East, Mumbai, Maharashtra 400093",
  directors: "R. Deshmukh, S. Kulkarni",
  top5_customers: "Havells India, Godrej Consumer, Dabur, Marico, Emami",
};

export const VENDOR_A_TERMS_ANSWERS: FieldAnswers = {
  payment_terms_days: 45,
  contract_duration_months: 12,
  sla_penalty_clause_present: true,
  insurance_coverage_confirmed: true,
  damages_liability_accepted: true,
  dispute_resolution_accepted: true,
  termination_notice_days: 60,
};

export async function generateVendorADocuments() {
  const [rates, questionnaire, terms] = await Promise.all([
    workbookToBuffer(buildRateCardWorkbook()),
    workbookToBuffer(buildAnsweredQuestionnaireWorkbook(VENDOR_A_QUESTIONNAIRE_ANSWERS)),
    workbookToBuffer(buildAnsweredTermsWorkbook(VENDOR_A_TERMS_ANSWERS)),
  ]);
  return {
    rates: { buffer: rates, fileName: "BharatRoadlines_RateCard.xlsx", fileType: "xlsx" as const },
    questionnaire: { buffer: questionnaire, fileName: "BharatRoadlines_Questionnaire.xlsx", fileType: "xlsx" as const },
    terms: { buffer: terms, fileName: "BharatRoadlines_Terms.xlsx", fileType: "xlsx" as const },
  };
}
