// App Router's automatic Suspense boundary for this route — without a
// loading.tsx, a click on "Open <RFx>" shows nothing at all until the page
// below finishes (5 DB queries, landed-cost/score computation for every
// vendor x lane, and serializing that whole comparison payload), which
// measured ~1.5-2.4s on the real deployment. That's not fixable by
// speeding up the query alone -- this is what makes the click feel instant
// regardless, matching this page's real shape so nothing jumps once the
// real data arrives.

function Bar({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className ?? ""}`} />;
}

export default function RfxOverviewLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-start justify-between border-b border-border px-6 py-4 md:px-8">
        <div className="flex flex-col gap-2">
          <Bar className="h-7 w-64" />
          <Bar className="h-4 w-40" />
        </div>
        <div className="flex items-center gap-2.5">
          <Bar className="h-8 w-24" />
          <Bar className="h-6 w-16" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-6 md:p-8">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 gap-2">
            {["Overview", "Upload", "Charges", "Questionnaire", "Terms", "Decision Summary"].map((label) => (
              <Bar key={label} className="h-8 w-28" />
            ))}
          </div>
          <Bar className="h-10 w-full" />
          <Bar className="min-h-0 flex-1 w-full" />
        </div>
        <div className="hidden w-80 shrink-0 flex-col gap-3 md:flex">
          <Bar className="h-10 w-full" />
          <Bar className="min-h-0 flex-1 w-full" />
        </div>
      </div>
    </div>
  );
}
