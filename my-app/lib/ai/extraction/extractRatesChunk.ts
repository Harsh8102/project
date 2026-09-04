import { z } from "zod";
import { Type, type Schema, generateStructured, textPart, inlineDataPart, MODELS } from "../gemini";
import { CHARGE_TAXONOMY, CHARGE_BASES, taxonomyForPrompt } from "../../normalization/chargeTaxonomy";
import { resolveChargeKey, basisMismatchFlag } from "./chargeMapping";

export type TargetLane = {
  laneIndex: number;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
};

export type DocumentInput =
  | { kind: "text"; text: string }
  | { kind: "file"; buffer: Buffer; mimeType: string };

const ChargeItemSchema = z.object({
  rawHeaderLabel: z.string(),
  suggestedTaxonomyKey: z.string(),
  value: z.string(),
  basis: z.string(),
  unitDefinitionNote: z.string(),
  currency: z.string(),
  confidence: z.number().min(0).max(1),
  sourceQuote: z.string(),
});

const LaneResultSchema = z.object({
  targetLaneIndex: z.number(),
  unsolicitedRouteDescription: z.string(),
  foundInDocument: z.boolean(),
  unreadable: z.boolean(),
  bundledAllIn: z.boolean(),
  minChargeableWeightKg: z.number(),
  charges: z.array(ChargeItemSchema),
});

const MatrixCellSchema = z.object({
  fromRegionLabel: z.string(),
  toRegionLabel: z.string(),
  ratePerKg: z.string(),
  minGuaranteedWeightKg: z.number(),
  currency: z.string(),
  confidence: z.number().min(0).max(1),
  sourceQuote: z.string(),
});

const RegionDefinitionSchema = z.object({ regionLabel: z.string(), cities: z.array(z.string()) });

const RegionMatrixSchema = z.object({
  present: z.boolean(),
  regionDefinitions: z.array(RegionDefinitionSchema),
  cells: z.array(MatrixCellSchema),
  flatCharges: z.array(ChargeItemSchema),
  unservedNote: z.string(),
});

const ExtractionResponseSchema = z.object({
  documentStructure: z.enum(["per_lane", "region_matrix"]),
  laneResults: z.array(LaneResultSchema),
  regionMatrix: RegionMatrixSchema,
});

export type RawExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

const CHARGE_ITEM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    rawHeaderLabel: { type: Type.STRING },
    suggestedTaxonomyKey: { type: Type.STRING, enum: [...CHARGE_TAXONOMY.map((c) => c.key), "unmapped"] },
    value: { type: Type.STRING },
    basis: { type: Type.STRING, enum: [...CHARGE_BASES, "unclear"] },
    unitDefinitionNote: { type: Type.STRING },
    currency: { type: Type.STRING, enum: ["INR", "USD", "unspecified"] },
    confidence: { type: Type.NUMBER },
    sourceQuote: { type: Type.STRING },
  },
  required: ["rawHeaderLabel", "suggestedTaxonomyKey", "value", "basis", "unitDefinitionNote", "currency", "confidence", "sourceQuote"],
};

function buildResponseSchema(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      documentStructure: { type: Type.STRING, enum: ["per_lane", "region_matrix"] },
      laneResults: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            targetLaneIndex: { type: Type.INTEGER },
            unsolicitedRouteDescription: { type: Type.STRING },
            foundInDocument: { type: Type.BOOLEAN },
            unreadable: { type: Type.BOOLEAN },
            bundledAllIn: { type: Type.BOOLEAN },
            minChargeableWeightKg: { type: Type.NUMBER },
            charges: { type: Type.ARRAY, items: CHARGE_ITEM_SCHEMA },
          },
          required: ["targetLaneIndex", "unsolicitedRouteDescription", "foundInDocument", "unreadable", "bundledAllIn", "minChargeableWeightKg", "charges"],
        },
      },
      regionMatrix: {
        type: Type.OBJECT,
        properties: {
          present: { type: Type.BOOLEAN },
          regionDefinitions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { regionLabel: { type: Type.STRING }, cities: { type: Type.ARRAY, items: { type: Type.STRING } } },
              required: ["regionLabel", "cities"],
            },
          },
          cells: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fromRegionLabel: { type: Type.STRING },
                toRegionLabel: { type: Type.STRING },
                ratePerKg: { type: Type.STRING },
                minGuaranteedWeightKg: { type: Type.NUMBER },
                currency: { type: Type.STRING, enum: ["INR", "USD", "unspecified"] },
                confidence: { type: Type.NUMBER },
                sourceQuote: { type: Type.STRING },
              },
              required: ["fromRegionLabel", "toRegionLabel", "ratePerKg", "minGuaranteedWeightKg", "currency", "confidence", "sourceQuote"],
            },
          },
          flatCharges: { type: Type.ARRAY, items: CHARGE_ITEM_SCHEMA },
          unservedNote: { type: Type.STRING },
        },
        required: ["present", "regionDefinitions", "cells", "flatCharges", "unservedNote"],
      },
    },
    required: ["documentStructure", "laneResults", "regionMatrix"],
  };
}

function buildSystemInstruction(targetLanes: TargetLane[]): string {
  const taxonomyText = taxonomyForPrompt()
    .map((t) => `- ${t.key}: "${t.label}" — ${t.definition} (valid bases: ${t.validBases.join(", ")})`)
    .join("\n");

  const laneListText = targetLanes
    .map((l) => `${l.laneIndex}: ${l.originCity}, ${l.originState} -> ${l.destCity}, ${l.destState}`)
    .join("\n");

  return `You are extracting freight rate data from a transporter's rate quotation document for a PTL (part-truck-load) procurement RFx.

CANONICAL CHARGE TYPES (map every charge/line item you find onto one of these keys; use "unmapped" only if genuinely nothing fits):
${taxonomyText}

TARGET LANES for this pass (only these — index: origin -> destination):
${laneListText}

First decide the document's pricing STRUCTURE:
- "per_lane": rates are given per specific origin-destination lane (a table, a list, or prose naming specific city pairs)
- "region_matrix": rates are given as a from-zone/to-zone (region) matrix, where each zone covers multiple cities, NOT per specific lane

If per_lane:
- For each target lane listed above, search the document for that lane's rates. Set foundInDocument=false if genuinely absent (never invent a value).
- For each charge you find for a lane, report the vendor's raw header/label text verbatim (rawHeaderLabel), your best guess at which canonical key it maps to (suggestedTaxonomyKey), the numeric value, the pricing basis, and any note about unit definitions if the document defines one (e.g. "1 carton = 20 units") — put that note in unitDefinitionNote even if it applies to the whole document, on every charge it affects.
- If a lane's rate is illegible (blurry photo, cut off, unreadable) but you can tell something is there, set unreadable=true and do not guess a value. This applies even if a blurred/smudged shape looks like it COULD be a particular number — if you are inferring or pattern-matching rather than clearly reading distinct digits, that is a guess, not a reading. Report unreadable=true with confidence 0 rather than a high-confidence guess; do not let context (nearby values, typical rate ranges) fill in a number you can't actually read.
- If a lane gives ONE lump-sum rate covering multiple charge types with no breakdown, set bundledAllIn=true and report it as a single "freight_charge" entry with a note.
- If the document quotes a lane that is NOT in the target list above, still report it: set targetLaneIndex=-1 and describe the route in unsolicitedRouteDescription.
- Leave regionMatrix.present=false and its arrays empty.

If region_matrix:
- Set laneResults=[] (do not attempt per-lane resolution yourself — that is done deterministically afterward).
- regionMatrix.present=true.
- regionDefinitions: for each zone/region name the document uses, list exactly which cities the document says belong to it. If the document does not define a region's cities anywhere, do not guess — omit that region or leave its cities empty.
- cells: every from-zone/to-zone rate cell you find, with the zone labels exactly as the document names them.
- flatCharges: any charges that apply uniformly regardless of zone (handling fees, liability %, etc.), mapped the same way as per-lane charges.
- unservedNote: quote verbatim any statement about zones/cities NOT serviced, if present.

Report currency as INR, USD, or "unspecified" if not stated (assume INR only if the document uses an Rs/INR symbol or says so explicitly — otherwise "unspecified", never assume).
Never guess a number that isn't stated. Confidence should reflect how directly the document states each value.`;
}

export async function extractRatesChunk(document: DocumentInput, targetLanes: TargetLane[], options: { thinkingBudget?: number } = {}): Promise<RawExtractionResponse> {
  const part = document.kind === "text" ? textPart(document.text) : inlineDataPart(document.buffer, document.mimeType);

  const raw = await generateStructured({
    model: MODELS.extraction,
    systemInstruction: buildSystemInstruction(targetLanes),
    parts: [part],
    responseSchema: buildResponseSchema(),
    thinkingBudget: options.thinkingBudget,
  });

  return ExtractionResponseSchema.parse(raw);
}

export { resolveChargeKey, basisMismatchFlag };
