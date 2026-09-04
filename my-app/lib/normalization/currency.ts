// Fixed FX rate (§2 scoping decision — deterministic conversion in code,
// never done by the LLM). Canonical source of truth; fixtures/vendorDataset
// imports this rather than defining their own, since vendor B's fabricated
// USD quotes need to convert consistently with the real pipeline.
export const USD_TO_INR = 83;

export function convertToInr(value: number, currency: string): { valueInr: number; wasConverted: boolean } {
  if (currency === "USD") {
    return { valueInr: Math.round(value * USD_TO_INR * 100) / 100, wasConverted: true };
  }
  return { valueInr: value, wasConverted: false };
}
