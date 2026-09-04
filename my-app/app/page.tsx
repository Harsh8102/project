import Link from "next/link";
import { getLatestRfxOverview } from "@/lib/db/queries/getRfxOverview";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Vendors submit",
    body: "Rate quote, questionnaire, terms — in whatever format they actually send.",
  },
  {
    step: "02",
    title: "AI extracts, code normalizes",
    body: "Gemini reads the document; deterministic code does every number — never the model.",
  },
  {
    step: "03",
    title: "You compare, side by side",
    body: "Every number traces back to its source document — click any figure to see it.",
  },
  {
    step: "04",
    title: "Ask, don't click",
    body: "The analyst co-pilot answers questions grounded in this exact data — cited, never guessed.",
  },
];

export default async function Home() {
  const rfx = await getLatestRfxOverview();

  if (!rfx) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="mb-2 text-xl font-semibold">No RFx found</h1>
        <p className="text-sm text-muted-foreground">
          Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">npm run seed</code> and{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">npm run seed:vendors</code> to
          create the demo dataset.
        </p>
      </div>
    );
  }

  const comparison = await getComparisonData(rfx.id);
  const { timeSaved } = comparison;

  return (
    <div className="relative flex min-h-full flex-col bg-background">
      {/* NAV */}
      <div className="flex items-center justify-between border-b border-border px-14 py-5">
        <div className="flex items-center gap-2.5">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <rect x="1" y="1" width="24" height="24" rx="6" stroke="var(--color-primary)" strokeWidth="1.6" />
            <path
              d="M6.5 17V11M13 17V8M19.5 17V13.5"
              stroke="var(--color-primary)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <div className="text-[15px] font-bold tracking-tight">Kill the Quote Spreadsheet</div>
        </div>
        <div className="flex items-center gap-5 text-sm font-medium text-muted-foreground">
          <div>Documentation</div>
          <div>Decisions note</div>
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
            HG
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="flex items-start gap-16 px-14 pt-18 pb-12">
        <div className="flex flex-1 flex-col gap-5" style={{ flex: "1.1" }}>
          <div className="font-mono text-xs font-semibold tracking-widest text-primary uppercase">
            PTL freight procurement
          </div>
          <h1 className="text-[44px] leading-[1.08] font-bold tracking-tight">
            Compare five vendor quotes
            <br />
            without opening five spreadsheets.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Upload whatever a vendor actually sends — a photo of a rate card, a PDF, a spreadsheet in their own
            format — and this reads it into one normalized comparison. Anything it isn&rsquo;t confident about gets
            flagged for you, never guessed.
          </p>
          <div className="mt-2 flex items-center gap-3.5">
            <Button size="lg" render={<Link href={`/rfx/${rfx.id}`} />}>
              Open {rfx.title}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
            <div className="px-1.5 py-3 text-sm font-semibold text-muted-foreground">View the decisions note</div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4.5 rounded-2xl bg-foreground p-7 text-background">
          <div className="text-xs font-semibold tracking-wide text-background/65 uppercase">Current RFx — this run</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <div className="font-mono text-[26px] font-bold">{rfx.laneCount}</div>
              <div className="text-xs text-background/65">lanes requested</div>
            </div>
            <div>
              <div className="font-mono text-[26px] font-bold">{rfx.vendors.length}</div>
              <div className="text-xs text-background/65">vendors submitted</div>
            </div>
            <div>
              <div className="font-mono text-[26px] font-bold">{timeSaved.fieldsExtracted}</div>
              <div className="text-xs text-background/65">fields auto-extracted</div>
            </div>
            <div>
              <div className="font-mono text-[26px] font-bold text-warning">{timeSaved.fieldsFlagged}</div>
              <div className="text-xs text-background/65">flagged for your review</div>
            </div>
          </div>
          <div className="h-px bg-background/10" />
          <div className="flex items-center justify-between">
            <div className="text-xs text-background/65">Manual entry time avoided</div>
            <div className="font-mono text-[15px] font-bold text-success">
              ~{(timeSaved.minutesAvoided / 60).toFixed(1)} hrs
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="mx-14 mb-10 grid grid-cols-4 gap-px border-y border-border bg-border">
        {HOW_IT_WORKS.map((item) => (
          <div key={item.step} className="flex flex-col gap-2 bg-background px-7 py-6">
            <div className="font-mono text-[11px] font-bold text-primary">{item.step}</div>
            <div className="text-[13px] font-semibold">{item.title}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">{item.body}</div>
          </div>
        ))}
      </div>

      {/* ROADMAP CARD */}
      <div className="px-14 pb-18">
        <div className="flex items-center gap-10 rounded-2xl border-[1.5px] border-dashed border-ai-accent/40 bg-ai-accent-soft/60 px-9 py-8">
          <div className="flex-1">
            <div className="mb-2.5 flex items-center gap-2.5">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 1.5L10.7 6.8L16 9L10.7 11.2L9 16.5L7.3 11.2L2 9L7.3 6.8L9 1.5Z"
                  stroke="var(--color-ai-accent-foreground)"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="text-[13px] font-bold text-ai-accent-foreground">AI CO-PILOT RFQ SETUP</div>
              <div className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
                COMING SOON
              </div>
            </div>
            <div className="mb-1.5 text-xl font-bold">Start a new RFx by talking to it, not filling out a form.</div>
            <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              A real conversational loop will confirm your lane list, pick questionnaire &amp; terms templates, let
              you select which of your configured vendors to invite, and send the RFx to them — the same trust
              rules as everywhere else: nothing goes out without your confirmation.
            </div>
          </div>
          <div className="flex min-w-[300px] flex-col gap-2.5">
            {[
              "Confirm lanes & expected volumes",
              "Pick questionnaire & terms templates",
              "Select vendors to invite (of 5 configured)",
              "Send the RFx",
            ].map((label, i) => (
              <div key={label} className="flex items-center gap-2.5 opacity-55">
                <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-ai-accent-foreground text-[11px] font-bold text-ai-accent-foreground">
                  {i + 1}
                </div>
                <div className="text-[13px] font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FLOATING CHAT LAUNCHER */}
      <Link
        href={`/rfx/${rfx.id}`}
        className="fixed right-14 bottom-8 flex items-center gap-2.5 no-underline"
      >
        <div className="rounded-lg bg-foreground px-3.5 py-2.5 text-[12.5px] font-semibold text-background shadow-lg">
          Ask about this RFx
        </div>
        <div className="flex h-13 w-13 items-center justify-center rounded-full bg-ai-accent shadow-lg shadow-ai-accent/40">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L13.3 8.7L20 11L13.3 13.3L11 20L8.7 13.3L2 11L8.7 8.7L11 2Z" fill="white" />
          </svg>
        </div>
      </Link>
    </div>
  );
}
