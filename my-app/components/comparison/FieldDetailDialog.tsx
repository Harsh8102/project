"use client";

// Shared trust primitive (§7 of the functional plan: "every number is
// clickable"). Given one field's raw value + source snippet + confidence +
// flag, shows exactly what the extractor saw and why it's flagged (if it
// is) — used by the Review Queue and the questionnaire/terms scoreboards.

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type SourceSnippet = {
  type: "cell" | "page" | "quote";
  cellRef?: string | null;
  page?: number | null;
  quote?: string | null;
};

function confidenceBadgeVariant(confidence: number): "outline" | "secondary" | "destructive" {
  if (confidence >= 0.8) return "outline";
  if (confidence >= 0.6) return "secondary";
  return "destructive";
}

export function FieldDetailDialog({
  trigger,
  title,
  rawValue,
  confidence,
  sourceSnippet,
  flagType,
  flagNote,
}: {
  trigger: ReactNode;
  title: string;
  rawValue?: string | null;
  confidence: number;
  sourceSnippet: SourceSnippet;
  flagType?: string | null;
  flagNote?: string | null;
}) {
  return (
    <Dialog>
      <DialogTrigger className="text-left">{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {rawValue ? (
            <div>
              <span className="text-muted-foreground">Raw value: </span>
              {rawValue}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Confidence:</span>
            <Badge variant={confidenceBadgeVariant(confidence)}>{Math.round(confidence * 100)}%</Badge>
          </div>
          {flagType && (
            <div className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="font-medium capitalize">{flagType.replaceAll("_", " ")}</div>
              {flagNote && <div>{flagNote}</div>}
            </div>
          )}
          {sourceSnippet.quote && (
            <div className="rounded-md bg-muted p-2 italic">&ldquo;{sourceSnippet.quote}&rdquo;</div>
          )}
          {sourceSnippet.cellRef && (
            <div className="text-xs text-muted-foreground">Source: {sourceSnippet.cellRef}</div>
          )}
          {sourceSnippet.page != null && (
            <div className="text-xs text-muted-foreground">Source: page {sourceSnippet.page}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
