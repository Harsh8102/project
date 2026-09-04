import ExcelJS from "exceljs";
import { QUESTIONNAIRE_FIELDS } from "../questionnaireFields";
import { TERMS_FIELDS } from "../termsFields";

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
}

function formatValue(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export type FieldAnswers = Record<string, string | number | boolean>;

/** Filled-in questionnaire xlsx. Keys in `answers` missing entirely are left blank on the row. */
export function buildAnsweredQuestionnaireWorkbook(answers: FieldAnswers): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questionnaire");
  sheet.columns = [
    { header: "Category", key: "category", width: 20 },
    { header: "Question", key: "question", width: 60 },
    { header: "Vendor Response", key: "response", width: 30 },
    { header: "Supporting Info (optional)", key: "supporting", width: 40 },
  ];
  for (const field of QUESTIONNAIRE_FIELDS) {
    sheet.addRow({
      category: field.category,
      question: field.question,
      response: formatValue(answers[field.key]),
      supporting: "",
    });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

/** Filled-in terms xlsx. */
export function buildAnsweredTermsWorkbook(answers: FieldAnswers): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Terms & Conditions");
  sheet.columns = [
    { header: "Term", key: "term", width: 55 },
    { header: "Buyer's Requirement", key: "buyerIdeal", width: 20 },
    { header: "Vendor Response (Accept / Value)", key: "response", width: 32 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  for (const field of TERMS_FIELDS) {
    sheet.addRow({
      term: field.term,
      buyerIdeal: field.buyerIdeal ?? "",
      response: formatValue(answers[field.key]),
      notes: "",
    });
  }
  styleHeaderRow(sheet.getRow(1));
  return workbook;
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
