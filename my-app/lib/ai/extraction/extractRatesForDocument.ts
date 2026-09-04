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
  options: { batchSize?: number; onProgress?: (chunksDone: number, chunksTotal: number) => void; thinkingBudget?: number } = {}
): Promise<RateExtractionOutcome> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const canChunk = source.kind === "xlsx" && lanes.length > CHUNK_THRESHOLD;
  const batches = canChunk ? chunkArray(lanes, batchSize) : [lanes];

  const laneResultsByIndex = new Map<number, LaneExtractionResult>();
  const unsolicitedLanes: { description: string }[] = [];
  let documentStructure: "per_lane" | "region_matrix" = "per_lane";
  let regionMatrix: RawExtractionResponse["regionMatrix"] | null = null;
  let chunksRun = 0;

  function runChunk(batchLanes: CanonicalLane[]): Promise<RawExtractionResponse> {
    const targetLanes = batchLanes.map(toTargetLane);
    const chunkDocument: DocumentInput =
      source.kind === "xlsx"
        ? { kind: "text", text: xlsxToPromptText(filterRowsByLanePairs(source.parsedXlsx, batchLanes)) }
        : source;
    return extractRatesChunk(chunkDocument, targetLanes, { thinkingBudget: options.thinkingBudget });
  }

  function mergeResult(batchLanes: CanonicalLane[], result: RawExtractionResponse) {
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

  // Chunks target disjoint lane subsets of the same document — nothing
  // downstream of the FIRST chunk depends on an earlier chunk's result,
  // except one thing: if the document turns out to be a region_matrix (one
  // response answers every lane at once), every further chunk is wasted
  // work. So the first chunk runs alone to make that call cheaply, then —
  // only for the common per_lane case — every remaining chunk fires in
  // parallel instead of the old one-at-a-time loop. This was the single
  // biggest lever on wall-clock extraction time: a real 30-lane/4-chunk
  // document that took ~157s sequentially (each chunk paying Gemini's own
  // ~24-51s per-call latency back to back) drops to roughly the time of
  // the SLOWEST single chunk, since the other three now overlap. No model
  // or accuracy risk — every chunk still asks the exact same question the
  // same way, just concurrently instead of queued.
  const [firstBatch, ...restBatches] = batches;
  const firstResult = await runChunk(firstBatch);
  chunksRun = 1;
  options.onProgress?.(chunksRun, batches.length);

  if (firstResult.documentStructure === "region_matrix") {
    documentStructure = "region_matrix";
    regionMatrix = firstResult.regionMatrix;
  } else {
    mergeResult(firstBatch, firstResult);

    if (restBatches.length > 0) {
      await Promise.all(
        restBatches.map(async (batchLanes) => {
          const result = await runChunk(batchLanes);
          chunksRun++;
          options.onProgress?.(chunksRun, batches.length);
          // A later chunk reporting region_matrix on a document the first
          // chunk already read as per_lane would be a genuinely confusing,
          // inconsistent signal — treat it the same as any other chunk
          // (merge what it found) rather than silently flipping the
          // outcome's overall documentStructure partway through.
          mergeResult(batchLanes, result);
        })
      );
    }
  }

  return { documentStructure, laneResultsByIndex, unsolicitedLanes, regionMatrix, chunkCount: chunksRun };
}
