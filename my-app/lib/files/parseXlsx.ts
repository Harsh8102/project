import ExcelJS from "exceljs";

export type XlsxRow = { rowNumber: number; cells: string[] };
export type ParsedXlsx = { sheetName: string; rows: XlsxRow[] }[];

/** Reads every worksheet into plain rows of stringified cell values, with row numbers for citation. */
export async function parseXlsx(buffer: Buffer): Promise<ParsedXlsx> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: ParsedXlsx = [];
  workbook.eachSheet((worksheet) => {
    const rows: XlsxRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.text ?? "");
      });
      if (cells.some((c) => c.trim() !== "")) {
        rows.push({ rowNumber, cells });
      }
    });
    sheets.push({ sheetName: worksheet.name, rows });
  });
  return sheets;
}

/**
 * Keeps only the header row plus rows matching at least one lane pair (BOTH
 * that lane's origin AND destination city present in the row) — the
 * mechanism that makes chunked extraction actually bound what a Gemini call
 * has to process, rather than relying on a prompt instruction the model can
 * (and did, in testing) ignore when the whole document is visible in
 * context. Matching on a single city name is deliberately NOT enough: many
 * cities appear in several canonical lanes (e.g. "Chennai" in both
 * Chennai->Coimbatore and Chennai->Madurai), so single-city keyword
 * filtering leaks OTHER chunks' lanes into this one — which then get
 * reported as "unsolicited" simply because they're not in this chunk's
 * target list, even though they're perfectly valid canonical lanes another
 * chunk handles. Falls back to the unfiltered rows if filtering would
 * remove everything (keeps the pipeline working rather than silently
 * sending an empty chunk).
 */
export function filterRowsByLanePairs(
  parsed: ParsedXlsx,
  lanes: { originCity: string; destCity: string }[]
): ParsedXlsx {
  const pairs = lanes.map((l) => ({
    origin: l.originCity.trim().toLowerCase(),
    dest: l.destCity.trim().toLowerCase(),
  }));
  return parsed.map((sheet) => {
    const [header, ...rest] = sheet.rows;
    const matched = rest.filter((row) => {
      const rowText = row.cells.join(" ").toLowerCase();
      return pairs.some((p) => rowText.includes(p.origin) && rowText.includes(p.dest));
    });
    const rows = matched.length > 0 ? [header, ...matched] : sheet.rows;
    return { sheetName: sheet.sheetName, rows };
  });
}

/** Renders parsed sheets as a plain-text table block suitable for an LLM prompt, with row numbers for citation. */
export function xlsxToPromptText(parsed: ParsedXlsx): string {
  return parsed
    .map((sheet) => {
      const lines = sheet.rows.map((r) => `Row ${r.rowNumber}: ${r.cells.join(" | ")}`);
      return `--- Sheet: ${sheet.sheetName} ---\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
