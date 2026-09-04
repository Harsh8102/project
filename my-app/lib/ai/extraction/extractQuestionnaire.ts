import { QUESTIONNAIRE_FIELDS } from "../../fixtures/questionnaireFields";
import { extractFormFields, type FormFieldExtractionResult } from "./formFieldExtraction";
import type { DocumentInput } from "./extractRatesChunk";

export async function extractQuestionnaire(document: DocumentInput): Promise<FormFieldExtractionResult[]> {
  const fields = QUESTIONNAIRE_FIELDS.map((f) => ({ key: f.key, label: f.question, type: f.type, dataType: f.dataType }));
  return extractFormFields(fields, document, "questionnaire");
}
