import { TERMS_FIELDS } from "../../fixtures/termsFields";
import { extractFormFields, type FormFieldExtractionResult } from "./formFieldExtraction";
import type { DocumentInput } from "./extractRatesChunk";

export async function extractTerms(document: DocumentInput): Promise<FormFieldExtractionResult[]> {
  const fields = TERMS_FIELDS.map((f) => ({ key: f.key, label: f.term, type: f.type, dataType: f.dataType }));
  return extractFormFields(fields, document, "terms & conditions");
}
