// Deterministic post-processing between "Gemini extracted this" and "this is
// an ExtractedField row" — currency conversion, basis validation, and
// confidence flagging all happen here in plain code, applying identically
// regardless of which vendor/format the charge came from (§7 trust rule:
// the LLM extracts, code computes).

import { convertToInr } from "../../normalization/currency";
import { resolveChargeKey, basisMismatchFlag } from "./chargeMapping";
import type { FlagType } from "../../db/models/ExtractedField";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

// The extraction prompt asks for "the numeric value," but a vendor document
// often states a charge with its own formatting intact (a literal "%" on a
// percentage charge, comma thousands-separators on a large flat amount) —
// Gemini legitimately echoes what's on the page rather than silently
// stripping it. Trust boundary: the LLM extracts what's there, this
// deterministic layer is responsible for tolerating ordinary formatting
// before deciding a value is genuinely unparseable, not just cosmetically
// dressed. `Number("0.29%")` is NaN with no cleanup, which was flagging
// every otherwise-valid FOV/insurance percentage as low_confidence.
function parseNumeric(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type RawChargeLike = {
  rawHeaderLabel: string;
  suggestedTaxonomyKey: string;
  value: string;
  basis: string;
  unitDefinitionNote: string;
  currency: string;
  confidence: number;
  sourceQuote: string;
};

export type NormalizedCharge = {
  fieldKey: string | null;
  rawHeaderLabel: string;
  rawValue: string;
  normalizedValue: number | null;
  unit: string | null;
  basis: string | null;
  currency: string | null;
  confidence: number;
  sourceQuote: string;
  flagType: FlagType | null;
  flagNote: string | null;
};

export function normalizeCharge(raw: RawChargeLike): NormalizedCharge {
  const resolution = resolveChargeKey(raw.rawHeaderLabel, raw.suggestedTaxonomyKey, raw.confidence);
  const numericValue = parseNumeric(raw.value);

  let normalizedValue: number | null = null;
  let currency: string | null = raw.currency !== "unspecified" ? raw.currency : null;
  let flagType: FlagType | null = null;
  let flagNote: string | null = null;

  if (numericValue === null) {
    flagType = "low_confidence";
    flagNote = `Could not parse "${raw.value}" as a number`;
  } else if (raw.currency === "USD") {
    const { valueInr } = convertToInr(numericValue, "USD");
    normalizedValue = valueInr;
    currency = "INR"; // normalizedValue is always INR after conversion; original currency+value kept in rawValue
    flagType = "currency_converted";
    flagNote = `Converted from USD ${numericValue} at a fixed rate`;
  } else {
    normalizedValue = numericValue;
  }

  if (!resolution.key) {
    flagType = "unmapped_header";
    flagNote = `Header "${raw.rawHeaderLabel}" did not match any canonical charge type`;
  } else if (!flagType && basisMismatchFlag(resolution.key, raw.basis)) {
    flagType = "basis_mismatch";
    flagNote = `Basis "${raw.basis}" is unusual for this charge type`;
  } else if (!flagType && resolution.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flagType = "low_confidence";
    flagNote = `Header mapping confidence ${resolution.confidence.toFixed(2)}`;
  } else if (!flagType && raw.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flagType = "low_confidence";
    flagNote = `Extraction confidence ${raw.confidence.toFixed(2)}`;
  }

  return {
    fieldKey: resolution.key,
    rawHeaderLabel: raw.rawHeaderLabel,
    rawValue: raw.value,
    normalizedValue,
    unit: raw.basis || null,
    basis: raw.basis || null,
    currency,
    confidence: Math.min(raw.confidence, resolution.confidence),
    sourceQuote: raw.sourceQuote,
    flagType,
    flagNote,
  };
}
