import ExcelJS from "exceljs";
import type { CanonicalLane } from "../fixtures/canonicalLanes";
import { QUESTIONNAIRE_FIELDS } from "../fixtures/questionnaireFields";
import { TERMS_FIELDS } from "../fixtures/termsFields";
import { uploadToBlob } from "./blob";

async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
}

/** Lane list — the 30-lane RFx annexure (downloadable for demo transparency). */
export function buildLaneListWorkbook(lanes: CanonicalLane[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lane List");
  sheet.columns = [
    { header: "Lane #", key: "laneIndex", width: 8 },
    { header: "Origin City", key: "originCity", width: 18 },
    { header: "Origin State", key: "originState", width: 18 },
    { header: "Destination City", key: "destCity", width: 18 },
    { header: "Destination State", key: "destState", width: 18 },
    { header: "Expected Volume (kg/month)", key: "expectedVolumeKgPerMonth", width: 26 },
    { header: "Weight Band", key: "weightBand", width: 16 },
  ];
  for (const lane of lanes) {
    sheet.addRow({ ...lane, laneIndex: lane.laneIndex + 1 });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

/**
 * Blank questionnaire template — one row per question, a blank "Vendor
 * Response" column vendors fill in, and a reference sheet naming exactly the
 * charge headers we expect (helps a good-faith vendor, but the extractor
 * never depends on this being followed — see §5.1a).
 */
export function buildQuestionnaireTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questionnaire");
  sheet.columns = [
    { header: "Category", key: "category", width: 20 },
    { header: "Question", key: "question", width: 60 },
    { header: "Vendor Response", key: "response", width: 30 },
    { header: "Supporting Info (optional)", key: "supporting", width: 40 },
  ];
  for (const field of QUESTIONNAIRE_FIELDS) {
    sheet.addRow({ category: field.category, question: field.question, response: "", supporting: "" });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

/** Blank terms & conditions template, with the buyer's stated ideal shown alongside each term. */
export function buildTermsTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Terms & Conditions");
  sheet.columns = [
    { header: "Term", key: "term", width: 55 },
    { header: "Buyer's Requirement", key: "buyerIdeal", width: 20 },
    { header: "Vendor Response (Accept / Value)", key: "response", width: 32 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  for (const field of TERMS_FIELDS) {
    sheet.addRow({ term: field.term, buyerIdeal: field.buyerIdeal ?? "", response: "", notes: "" });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

export async function generateAndUploadBuyerTemplates(rfxId: string, lanes: CanonicalLane[]) {
  const [laneList, questionnaire, terms] = await Promise.all([
    workbookToBuffer(buildLaneListWorkbook(lanes)).then((buf) =>
      uploadToBlob(`rfx/${rfxId}/lane-list.xlsx`, buf, XLSX_CONTENT_TYPE)
    ),
    workbookToBuffer(buildQuestionnaireTemplateWorkbook()).then((buf) =>
      uploadToBlob(`rfx/${rfxId}/questionnaire-template.xlsx`, buf, XLSX_CONTENT_TYPE)
    ),
    workbookToBuffer(buildTermsTemplateWorkbook()).then((buf) =>
      uploadToBlob(`rfx/${rfxId}/terms-template.xlsx`, buf, XLSX_CONTENT_TYPE)
    ),
  ]);

  return { laneListUrl: laneList.url, questionnaireUrl: questionnaire.url, termsUrl: terms.url };
}
