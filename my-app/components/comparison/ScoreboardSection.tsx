"use client";

// Collapsed-by-category Questionnaire/Terms view (§8.2.2/§8.2.3) — real RFx
// questionnaires can run to 100+ questions, so this shows one row per
// category (pass/fail or score, across all 5 vendors) and expands to
// individual questions on click, instead of dumping every field open at
// once. Same component drives both tabs — Questionnaire passes
// QUESTIONNAIRE_FIELDS, Terms passes TERMS_FIELDS; both now share a real
// `category` field (lib/fixtures/questionnaireFields.ts,
// lib/fixtures/termsFields.ts).

import { useState } from "react";
import type { VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { SectionScore } from "@/lib/scoring/computeScores";
import type { QuestionnaireField } from "@/lib/fixtures/questionnaireFields";
import type { TermsField } from "@/lib/fixtures/termsFields";
import type { ScoringBenchmark } from "@/lib/scoring/benchmark";

type AnyField = QuestionnaireField | TermsField;

function fieldLabel(field: AnyField): string {
  return "question" in field ? field.question : field.term;
}

function benchmarkDescription(benchmark: ScoringBenchmark | undefined): string {
  if (!benchmark) return "";
  switch (benchmark.kind) {
    case "higher_is_better":
      return `target ≥ ${benchmark.target}`;
    case "lower_is_better":
      return `target ≤ ${benchmark.target}`;
    case "boolean_true_is_better":
      return "Yes = 100, No = 0";
    case "closest_to_target":
      return `closest to ${benchmark.target}, ±${benchmark.tolerance}`;
  }
}

function downloadMethodology(sectionLabel: string, fields: AnyField[]) {
  const lines = [
    `${sectionLabel} — scoring methodology`,
    "",
    "Gate questions are pass/fail only: one failure excludes the vendor from ranking entirely.",
    "Scored questions compare the vendor's answer to a target using one of four rules:",
    "  - higher is better",
    "  - lower is better",
    "  - yes/no (Yes = 100, No = 0)",
    "  - closest to target, with a tolerance",
    "A category's score is the plain average of its questions' scores.",
    "",
    "Field-by-field rules:",
    ...fields.map((f) => {
      const kind = f.type === "gate" ? "gate" : f.type === "informational" ? "informational, not scored" : "scored";
      const rule = f.type === "scored" ? ` — ${benchmarkDescription(f.benchmark)}` : "";
      return `[${f.category}] ${fieldLabel(f)} (${kind})${rule}`;
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sectionLabel.toLowerCase().replace(/\s+/g, "-")}-methodology.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-foreground";
  if (score >= 40) return "text-warning-foreground";
  return "text-danger-foreground";
}

function OverallLeaderboard({
  vendors,
  scores,
  sectionLabel,
}: {
  vendors: VendorSummary[];
  scores: Record<string, SectionScore | null>;
  sectionLabel: string;
}) {
  const ranked = vendors
    .map((v) => ({ vendor: v, section: scores[v.id] }))
    .filter((r): r is { vendor: VendorSummary; section: SectionScore } => r.section !== null)
    .sort((a, b) => {
      if (a.section.allGatesPassed !== b.section.allGatesPassed) return a.section.allGatesPassed ? -1 : 1;
      return b.section.sectionScore - a.section.sectionScore;
    });
  const notSubmitted = vendors.filter((v) => !scores[v.id]);

  if (ranked.length === 0) return null;
  const best = ranked.find((r) => r.section.allGatesPassed);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-accent/40 px-5 py-3">
      <div className="text-[12.5px] font-bold whitespace-nowrap">
        Overall {sectionLabel.toLowerCase()} ranking
      </div>
      {best && (
        <div className="text-[12.5px] font-semibold text-primary whitespace-nowrap">
          Best: {best.vendor.code} — {best.section.sectionScore}/100
        </div>
      )}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {ranked.map((r, i) => (
          <div
            key={r.vendor.id}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-semibold ${
              !r.section.allGatesPassed
                ? "border-danger/30 bg-danger-soft text-danger-foreground"
                : i === 0
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card"
            }`}
          >
            {r.section.allGatesPassed && <span className="text-[10px] font-bold opacity-60">#{i + 1}</span>}
            {r.vendor.code}
            <span className="font-mono tabular-nums">{r.section.allGatesPassed ? r.section.sectionScore : "gate failed"}</span>
          </div>
        ))}
        {notSubmitted.map((v) => (
          <div key={v.id} className="rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
            {v.code} <span className="font-normal">not submitted</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScoreboardSection({
  vendors,
  scores,
  fields,
  sectionLabel,
}: {
  vendors: VendorSummary[];
  scores: Record<string, SectionScore | null>;
  fields: AnyField[];
  sectionLabel: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const categories: { name: string; fields: AnyField[] }[] = [];
  for (const field of fields) {
    if (field.type === "informational") continue;
    let group = categories.find((c) => c.name === field.category);
    if (!group) {
      group = { name: field.category, fields: [] };
      categories.push(group);
    }
    group.fields.push(field);
  }

  function toggle(category: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <OverallLeaderboard vendors={vendors} scores={scores} sectionLabel={sectionLabel} />

      <div className="flex shrink-0 items-start gap-4 rounded-lg border border-border bg-card px-5 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
          <circle cx="8" cy="8" r="6.8" stroke="var(--color-primary)" strokeWidth="1.3" />
          <path d="M8 7.2v3.8M8 5.2v0.1" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div className="flex-1">
          <div className="mb-1 text-[12.5px] font-bold">How a question becomes a score</div>
          <div className="text-[12.5px] leading-relaxed text-foreground/80">
            <b>Gate questions</b> are pass/fail only — one failure excludes the vendor from ranking entirely, shown
            separately, never scored numerically. <b>Scored questions</b> compare the vendor&rsquo;s answer to a
            buyer-set target using one of four rules: <i>higher is better</i>, <i>lower is better</i>, <i>yes/no</i>,
            or <i>closest to target</i> with a tolerance. A category&rsquo;s score is the plain average of its
            questions — nothing is weighted differently within a category.
          </div>
        </div>
        <button
          onClick={() => downloadMethodology(sectionLabel, fields)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold whitespace-nowrap"
        >
          Download methodology (.txt)
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[240px_repeat(5,1fr)] bg-background px-1 pb-2 text-xs font-bold text-muted-foreground uppercase">
          <div>Category</div>
          {vendors.map((v) => (
            <div key={v.id} className="text-center">
              {v.code}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {categories.map((cat) => {
          const isOpen = expanded.has(cat.name);
          const hasGates = cat.fields.some((f) => f.type === "gate");
          return (
            <div
              key={cat.name}
              className={`overflow-hidden rounded-lg border ${isOpen ? "border-primary/35" : "border-border"} bg-card`}
            >
              <button
                onClick={() => toggle(cat.name)}
                className={`grid w-full grid-cols-[240px_repeat(5,1fr)] items-center px-4 py-3 text-left ${isOpen ? "bg-accent/40" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  >
                    <path
                      d="M4 3L8 6L4 9"
                      stroke={isOpen ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className={`text-[13px] font-semibold ${isOpen ? "text-primary" : ""}`}>{cat.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {cat.fields.length} question{cat.fields.length === 1 ? "" : "s"}
                  </span>
                </div>
                {vendors.map((v) => {
                  const section = scores[v.id];
                  if (!section) {
                    return (
                      <div key={v.id} className="text-center text-xs text-muted-foreground">
                        —
                      </div>
                    );
                  }
                  if (hasGates) {
                    const allPass = cat.fields.every((f) => section.gates.find((g) => g.key === f.key)?.pass ?? false);
                    return (
                      <div key={v.id} className="flex justify-center">
                        <span className={`h-2 w-2 rounded-full ${allPass ? "bg-success" : "bg-danger"}`} />
                      </div>
                    );
                  }
                  const catScores = cat.fields
                    .map((f) => section.dimensions.find((d) => d.key === f.key)?.score)
                    .filter((s): s is number => s !== undefined);
                  const avg = catScores.length ? Math.round(catScores.reduce((a, b) => a + b, 0) / catScores.length) : null;
                  return (
                    <div key={v.id} className={`text-center font-mono text-[13px] font-bold ${avg !== null ? scoreColor(avg) : "text-muted-foreground"}`}>
                      {avg ?? "—"}
                    </div>
                  );
                })}
              </button>

              {isOpen &&
                cat.fields.map((field) => (
                  <div key={field.key} className="grid grid-cols-[240px_repeat(5,1fr)] items-center border-t border-border py-2 pr-4 pl-10">
                    <div>
                      <div className="text-xs text-foreground/85">{fieldLabel(field)}</div>
                      {field.type === "scored" && (
                        <div className="text-[11px] text-muted-foreground">{benchmarkDescription(field.benchmark)}</div>
                      )}
                    </div>
                    {vendors.map((v) => {
                      const section = scores[v.id];
                      const gate = section?.gates.find((g) => g.key === field.key);
                      const dim = section?.dimensions.find((d) => d.key === field.key);
                      if (gate) {
                        return (
                          <div key={v.id} className={`text-center text-xs font-semibold ${gate.pass ? "text-success-foreground" : "text-danger-foreground"}`}>
                            {gate.pass ? "Pass" : "Fail"}
                          </div>
                        );
                      }
                      if (dim) {
                        return (
                          <div key={v.id} className="text-center text-xs">
                            {dim.value === null || dim.value === undefined ? "—" : String(dim.value)}
                          </div>
                        );
                      }
                      return (
                        <div key={v.id} className="text-center text-xs text-muted-foreground">
                          —
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}
