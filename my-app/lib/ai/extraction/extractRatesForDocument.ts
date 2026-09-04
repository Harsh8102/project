// Orchestrates rates extraction for one vendor submission end-to-end:
// decides whether to chunk, pre-filters text-based documents so a chunk
// call actually only processes its own slice (not just "asked nicely" to —
// testing showed Gemini will extract everything visible in the prompt
// regardless of an instruction to restrict itself, so the input itself has
// to be scoped), and merges per-chunk results.
//
// File-based documents (image/PDF) aren't line-filterable, but in this
// dataset they're single compact pages anyway — chunking exists for
// documents large enough to need it, not as a fixed ritual.

import type { CanonicalLane } from "../../fixtures/canonicalLanes";
import type { ParsedXlsx } from "../../files/parseXlsx";
import { xlsxToPromptText, filterRowsByLanePairs } from "../../files/parseXlsx";
import { extractRatesChunk, type DocumentInput, type TargetLane, type RawExtractionResponse } from "./extractRatesChunk";

/** xlsx sources are filterable per chunk (rows); text/file sources are sent whole to every chunk call. */
export type RateDocumentSource =
  | { kind: "xlsx"; parsedXlsx: ParsedXlsx }
  | DocumentInput;

const DEFAULT_BATCH_SIZE = 8;
const CHUNK_THRESHOLD = 10; // below this many lanes, one call is simpler and just as fast

export type LaneExtractionResult = RawExtractionResponse["laneResults"][number];

export type RateExtractionOutcome = {
  documentStructure: "per_lane" | "region_matrix";
  laneResultsByIndex: Map<number, LaneExtractionResult>;
  unsolicitedLanes: { description: string }[];
  regionMatrix: RawExtractionResponse["regionMatrix"] | null;
  chunkCount: number;
};

function toTargetLane(lane: CanonicalLane): TargetLane {
  return {
    laneIndex: lane.laneIndex,
    originCity: lane.originCity,
    originState: lane.originState,
    destCity: lane.destCity,
    destState: lane.destState,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** True if a free-text route description plausibly names a specific canonical lane's cities. */
function matchesKnownLane(description: string, lanes: CanonicalLane[]): boolean {
  const normalized = description.toLowerCase();
  return lanes.some(
    (l) => normalized.includes(l.originCity.toLowerCase()) && normalized.includes(l.destCity.toLowerCase())
  );
}

export async function extractRatesForDocument(
  source: RateDocumentSource,
  lanes: CanonicalLane[],
  options: { batchSize?: number; onProgress?: (chunksDone: number, chunksTotal: number) => void } = {}
): Promise<RateExtractionOutcome> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const canChunk = source.kind === "xlsx" && lanes.length > CHUNK_THRESHOLD;
  const batches = canChunk ? chunkArray(lanes, batchSize) : [lanes];

  const laneResultsByIndex = new Map<number, LaneExtractionResult>();
  const unsolicitedLanes: { description: string }[] = [];
  let documentStructure: "per_lane" | "region_matrix" = "per_lane";
  let regionMatrix: RawExtractionResponse["regionMatrix"] | null = null;
  let chunksRun = 0;

  for (const batchLanes of batches) {
    const targetLanes = batchLanes.map(toTargetLane);

    const chunkDocument: DocumentInput =
      source.kind === "xlsx"
        ? { kind: "text", text: xlsxToPromptText(filterRowsByLanePairs(source.parsedXlsx, batchLanes)) }
        : source;

    const result = await extractRatesChunk(chunkDocument, targetLanes);
    chunksRun++;
    options.onProgress?.(chunksRun, batches.length);

    if (result.documentStructure === "region_matrix") {
      documentStructure = "region_matrix";
      regionMatrix = result.regionMatrix;
      break; // the matrix answers every lane at once — no need to run further chunks
    }

    const targetIndexSet = new Set(batchLanes.map((l) => l.laneIndex));
    for (const lr of result.laneResults) {
      if (lr.targetLaneIndex === -1) {
        // Cross-check against the FULL lane list, not just this chunk's —
        // a lane belonging to a different chunk can leak into this one's
        // input despite filtering, and would otherwise be misreported as
        // "unsolicited" simply for being absent from this chunk's target set.
        if (!matchesKnownLane(lr.unsolicitedRouteDescription, lanes)) {
          unsolicitedLanes.push({ description: lr.unsolicitedRouteDescription });
        }
        continue;
      }
      // Defensive: only accept results for lanes this chunk actually targeted,
      // in case the model reports extras despite the filtered input.
      if (targetIndexSet.has(lr.targetLaneIndex) && !laneResultsByIndex.has(lr.targetLaneIndex)) {
        laneResultsByIndex.set(lr.targetLaneIndex, lr);
      }
    }
  }

  return { documentStructure, laneResultsByIndex, unsolicitedLanes, regionMatrix, chunkCount: chunksRun };
}
