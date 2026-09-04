// Canonical PTL charge taxonomy (§5.1a of the architecture plan).
//
// Every charge a vendor could name is defined once here — with a stable key,
// a plain-language definition, its valid pricing bases, and known real-world
// synonyms. Header mapping happens in two stages, cheapest first:
//   1. matchHeaderDeterministic() — exact/alias lookup, free, confidence 1.0
//   2. LLM semantic fallback (lib/ai/extraction) — only for what stage 1 misses,
//      given this same taxonomy (keys + definitions) in its prompt/schema
// Anything neither stage can confidently resolve is written with
// flagType: "unmapped_header" and the vendor's raw wording preserved — never
// invented, never silently dropped.

export const CHARGE_BASES = [
  "flat",
  "per_kg",
  "per_unit",
  "slab_on_weight",
  "pct_of_freight",
  "pct_of_invoice_value",
  "inter_state_flat",
  "intra_state_flat",
  "inter_state_per_kg",
  "intra_state_per_kg",
] as const;
export type ChargeBasis = (typeof CHARGE_BASES)[number];

export type ChargeTaxonomyEntry = {
  key: string;
  label: string;
  definition: string;
  validBases: ChargeBasis[];
  aliases: string[];
};

export const CHARGE_TAXONOMY: ChargeTaxonomyEntry[] = [
  {
    key: "freight_charge",
    label: "Freight Charge",
    definition: "The base transportation charge for moving goods along the lane.",
    validBases: ["flat", "per_kg", "per_unit", "slab_on_weight"],
    aliases: [
      "freight",
      "base freight",
      "freight rate",
      "transportation charge",
      "line haul",
      "line haul charge",
      "basic freight",
      "transport charge",
    ],
  },
  {
    key: "fuel_surcharge",
    label: "Fuel Surcharge",
    definition: "A variable surcharge tracking diesel/fuel price movements, usually a % of freight.",
    validBases: ["flat", "pct_of_freight"],
    aliases: ["fsc", "fuel surcharge", "fuel adjustment", "diesel surcharge", "diesel adjustment", "fuel escalation"],
  },
  {
    key: "oda_charge",
    label: "ODA Charge",
    definition: "Out-of-delivery-area charge for remote/non-standard delivery locations.",
    validBases: ["flat", "per_kg", "per_unit", "slab_on_weight"],
    aliases: [
      "oda",
      "out of delivery area",
      "out-of-delivery-area charge",
      "remote area charge",
      "remote location charge",
      "extended delivery charge",
    ],
  },
  {
    key: "pickup_charge",
    label: "Pickup Charge",
    definition: "Charge for collecting goods from the origin.",
    validBases: ["flat", "per_unit"],
    aliases: ["pickup", "pickup charge", "collection charge", "origin charge", "origin pickup"],
  },
  {
    key: "loading_charge",
    label: "Loading Charge",
    definition: "Handling/labour charge for loading (and typically unloading) the shipment.",
    validBases: ["flat", "per_unit"],
    aliases: [
      "loading",
      "loading charge",
      "loading/unloading",
      "labour charge",
      "labor charge",
      "handling charge",
    ],
  },
  {
    key: "lr_docket_charge",
    label: "LR / Docket Charge",
    definition: "Charge for issuing the Lorry Receipt (LR) / consignment docket — the shipment's legal transport document.",
    validBases: ["flat"],
    aliases: ["lr charge", "docket charge", "lorry receipt charge", "lorry receipt", "documentation charge", "lr fee", "docket fee"],
  },
  {
    key: "state_charge",
    label: "State Charge",
    definition: "Inter-state or intra-state statutory/entry charges specific to certain states.",
    validBases: ["inter_state_flat", "intra_state_flat", "inter_state_per_kg", "intra_state_per_kg"],
    aliases: [
      "state tax",
      "state charge",
      "entry tax",
      "octroi",
      "check post charge",
      "interstate charge",
      "intrastate charge",
      "detention charges",
    ],
  },
  {
    key: "green_tax",
    label: "Green Tax",
    definition: "Flat environmental/eco charge applied for certain states or locations.",
    validBases: ["flat"],
    aliases: ["green tax", "environment cess", "eco charge", "environmental charge"],
  },
  {
    key: "additional_location_charge",
    label: "Additional Location Charge",
    definition: "Extra charge for delivery to specific hard-to-reach drop points beyond the base lane.",
    validBases: ["flat", "per_unit", "slab_on_weight"],
    aliases: [
      "additional location charge",
      "extra delivery point",
      "remote drop charge",
      "additional drop charge",
      "extra location surcharge",
    ],
  },
  {
    key: "fov_liability",
    label: "FOV / Liability Charge",
    definition: "Freight-on-value or cargo liability/insurance charge, usually a % of invoice value.",
    validBases: ["pct_of_invoice_value", "flat"],
    aliases: ["fov", "freight on value", "liability charge", "insurance liability", "cargo liability"],
  },
];

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export type HeaderMatch = { key: string; confidence: number };

/**
 * Stage 1: deterministic alias lookup. Exact or substring match against a
 * known alias (case/punctuation-insensitive) — confidence 1.0. Returns null
 * if nothing matches, so the caller can fall back to the LLM semantic pass.
 *
 * Picks the LONGEST matching alias across every entry, not the first one
 * found — short generic aliases (e.g. "freight") can appear inside another
 * charge's header as an incidental word ("Fuel Surcharge (% of freight)"),
 * and the more specific match ("fuel surcharge") is the correct one even
 * though it's declared later in the taxonomy list.
 */
export function matchHeaderDeterministic(rawHeader: string): HeaderMatch | null {
  const normalized = normalizeHeader(rawHeader);
  if (!normalized) return null;

  let best: { key: string; aliasLength: number } | null = null;

  for (const entry of CHARGE_TAXONOMY) {
    for (const alias of [entry.key, entry.label, ...entry.aliases]) {
      const normalizedAlias = normalizeHeader(alias);
      if (!normalizedAlias) continue;
      if (normalized === normalizedAlias || normalized.includes(normalizedAlias)) {
        if (!best || normalizedAlias.length > best.aliasLength) {
          best = { key: entry.key, aliasLength: normalizedAlias.length };
        }
      }
    }
  }

  return best ? { key: best.key, confidence: 1 } : null;
}

export function getTaxonomyEntry(key: string): ChargeTaxonomyEntry | undefined {
  return CHARGE_TAXONOMY.find((entry) => entry.key === key);
}

export function isValidBasisFor(key: string, basis: string): boolean {
  const entry = getTaxonomyEntry(key);
  if (!entry) return false;
  return (entry.validBases as string[]).includes(basis);
}

/** Compact form (key + label + definition, no aliases) for LLM prompts/schemas. */
export function taxonomyForPrompt(): { key: string; label: string; definition: string; validBases: string[] }[] {
  return CHARGE_TAXONOMY.map(({ key, label, definition, validBases }) => ({
    key,
    label,
    definition,
    validBases,
  }));
}
