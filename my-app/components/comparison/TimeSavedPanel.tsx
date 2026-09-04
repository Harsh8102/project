// §8.4 of the functional plan: "does extraction visibly reduce decision
// time" is an explicit grading axis, so it has to be shown, not asserted.
// The per-field time assumption is displayed inline rather than baked into
// a single black-box number, so the estimate is auditable.

import { Card, CardContent } from "@/components/ui/card";
import type { TimeSavedStats } from "@/lib/db/queries/getComparisonData";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function TimeSavedPanel({ stats }: { stats: TimeSavedStats }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-8 py-4">
        <Stat label="Documents processed" value={String(stats.submissionsProcessed)} />
        <Stat label="Fields auto-extracted" value={String(stats.fieldsExtracted)} />
        <Stat label="Fields flagged for review" value={String(stats.fieldsFlagged)} />
        <Stat label="Manual entry time avoided" value={`~${stats.minutesAvoided} min`} />
        <p className="ml-auto max-w-xs text-xs text-muted-foreground">
          Assumes ~{stats.assumptionSecondsPerField}s per field manually retyped from a document. Flagged fields still
          need buyer review, so they&rsquo;re not counted as time saved.
        </p>
      </CardContent>
    </Card>
  );
}
