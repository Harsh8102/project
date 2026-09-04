import { z } from "zod";
import { Type, type Schema, generateStructured, textPart, inlineDataPart, MODELS } from "../gemini";
import type { FieldType, FieldDataType } from "../../fixtures/questionnaireFields";
import type { DocumentInput } from "./extractRatesChunk";

export type ExtractableField = {
  key: string;
  label: string; // question or term text
  type: FieldType;
  dataType: FieldDataType;
};

const RawFieldResultSchema = z.object({
  fieldKey: z.string(),
  found: z.boolean(),
  rawValue: z.string(),
  confidence: z.number().min(0).max(1),
  sourceRow: z.number(),
  sourceQuote: z.string(),
});
const RawExtractionResponseSchema = z.object({ fields: z.array(RawFieldResultSchema) });

export type FormFieldExtractionResult = {
  fieldKey: string;
  found: boolean;
  rawValue: string;
  normalizedValue: string | number | boolean | null;
  confidence: number;
  sourceSnippet: { type: "cell" | "quote"; cellRef?: string; quote?: string };
  flagType: "low_confidence" | null; // "missing gate/field" is a scoring-time concern, not an extraction-time flag
};

const LOW_CONFIDENCE_THRESHOLD = 0.6;

function buildResponseSchema(fieldKeys: string[]): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      fields: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            fieldKey: { type: Type.STRING, enum: fieldKeys },
            found: { type: Type.BOOLEAN },
            rawValue: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            sourceRow: { type: Type.INTEGER },
            sourceQuote: { type: Type.STRING },
          },
          required: ["fieldKey", "found", "rawValue", "confidence", "sourceRow", "sourceQuote"],
        },
      },
    },
    required: ["fields"],
  };
}

function normalizeValue(field: ExtractableField, raw: string, found: boolean): string | number | boolean | null {
  if (!found || raw.trim() === "") return null;
  if (field.dataType === "boolean") {
    const v = raw.trim().toLowerCase();
    if (["yes", "true", "y"].includes(v)) return true;
    if (["no", "false", "n"].includes(v)) return false;
    return null; // couldn't parse a clean boolean — treated as not found downstream
  }
  if (field.dataType === "number") {
    const n = Number(raw.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return raw.trim();
}

/** Runs one structured-extraction call for a fixed list of form fields (questionnaire or terms) against a document's text. */
export async function extractFormFields(
  fields: ExtractableField[],
  document: DocumentInput,
  sectionLabel: string
): Promise<FormFieldExtractionResult[]> {
  const fieldKeys = fields.map((f) => f.key);
  const fieldDescriptions = fields
    .map((f) => `- ${f.key} (${f.dataType}): "${f.label}"`)
    .join("\n");

  const formatNote =
    document.kind === "text"
      ? "The document is a spreadsheet rendered as text, with row numbers."
      : "The document is a file (PDF/image) — it may not be the expected spreadsheet format; read whatever structure it actually uses.";

  const systemInstruction = `You are extracting answers from a vendor's ${sectionLabel} submission for a freight procurement RFx.

${formatNote} For each of the following fields, find the vendor's answer and report it.

Fields to extract:
${fieldDescriptions}

Rules:
- For boolean fields, rawValue must be exactly "Yes" or "No" (normalize the vendor's wording, e.g. "Y"/"N"/"Confirmed" -> Yes/No) — but only if the document actually states an answer. Never infer a Yes/No from silence.
- For number fields, rawValue must be just the number (no units, no currency symbols).
- If a field has no answer in the document at all, set found=false, rawValue="", confidence=0, sourceRow=-1, sourceQuote="".
- confidence reflects how directly the document states the value (1.0 = explicit and unambiguous, lower if you had to infer from adjacent context).
- sourceRow is the row number the answer came from if the document has rows (else -1); sourceQuote is a short verbatim excerpt (a few words) proving where the value came from.
- Report every field in the list exactly once, even if not found.`;

  const part = document.kind === "text" ? textPart(document.text) : inlineDataPart(document.buffer, document.mimeType);

  const raw = await generateStructured({
    model: MODELS.extraction,
    systemInstruction,
    parts: [part],
    responseSchema: buildResponseSchema(fieldKeys),
  });

  const parsed = RawExtractionResponseSchema.parse(raw);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));

  return parsed.fields.map((r): FormFieldExtractionResult => {
    const field = fieldByKey.get(r.fieldKey);
    const normalizedValue = field ? normalizeValue(field, r.rawValue, r.found) : null;
    const found = r.found && normalizedValue !== null;
    return {
      fieldKey: r.fieldKey,
      found,
      rawValue: r.rawValue,
      normalizedValue,
      confidence: r.confidence,
      sourceSnippet:
        r.sourceRow > 0
          ? { type: "cell", cellRef: `Row ${r.sourceRow}`, quote: r.sourceQuote }
          : { type: "quote", quote: r.sourceQuote },
      flagType: found && r.confidence < LOW_CONFIDENCE_THRESHOLD ? "low_confidence" : null,
    };
  });
}
