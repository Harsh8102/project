import { matchHeaderDeterministic, isValidBasisFor, getTaxonomyEntry } from "../../normalization/chargeTaxonomy";

export type ChargeKeyResolution = {
  key: string | null; // null = genuinely unmapped
  confidence: number;
  method: "deterministic" | "llm" | "unmapped";
};

/**
 * §5.1a's two-stage mapping, applied as post-processing on whatever header
 * Gemini reports it found: the deterministic alias table is checked FIRST
 * and wins whenever it matches (free, 100% consistent) — Gemini's own
 * suggestion is only trusted when the alias table has nothing, and its
 * confidence is carried through rather than assumed.
 */
export function resolveChargeKey(rawHeaderLabel: string, llmSuggestedKey: string, llmConfidence: number): ChargeKeyResolution {
  const deterministic = matchHeaderDeterministic(rawHeaderLabel);
  if (deterministic) return { key: deterministic.key, confidence: deterministic.confidence, method: "deterministic" };

  if (llmSuggestedKey && llmSuggestedKey !== "unmapped" && getTaxonomyEntry(llmSuggestedKey)) {
    return { key: llmSuggestedKey, confidence: llmConfidence, method: "llm" };
  }

  return { key: null, confidence: 0, method: "unmapped" };
}

export function basisMismatchFlag(key: string | null, basis: string): boolean {
  if (!key || !basis) return false;
  return !isValidBasisFor(key, basis);
}
