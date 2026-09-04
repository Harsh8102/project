// Shared renderer for the Questionnaire and Terms tabs (§8.2.2/§8.2.3 of the
// functional plan) — same shape (gates, scored dimensions, completeness %),
// same component, driven entirely by lib/scoring/computeScores.ts's
// SectionScore, now computed from real extracted answers
// (lib/db/queries/getComparisonData.ts) instead of fixtures.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VendorSummary } from "@/lib/db/queries/getComparisonData";
import type { SectionScore } from "@/lib/scoring/computeScores";

function scoreBadgeVariant(score: number): "outline" | "secondary" | "destructive" {
  if (score >= 70) return "outline";
  if (score >= 40) return "secondary";
  return "destructive";
}

export function ScoreboardSection({
  vendors,
  scores,
}: {
  vendors: VendorSummary[];
  scores: Record<string, SectionScore | null>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {vendors.map((vendor) => {
        const section = scores[vendor.id];
        return (
          <Card key={vendor.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {vendor.code} — {vendor.name}
              </CardTitle>
              {section ? (
                <Badge variant={scoreBadgeVariant(section.sectionScore)}>{section.sectionScore}/100</Badge>
              ) : (
                <Badge variant="destructive">Not submitted</Badge>
              )}
            </CardHeader>
            {section && (
              <CardContent className="space-y-3 text-sm">
                <div className="text-xs text-muted-foreground">{section.completenessPct}% complete</div>

                {section.gates.length > 0 && (
                  <div className="space-y-1">
                    {section.gates.map((g) => (
                      <div key={g.key} className="flex items-start justify-between gap-2">
                        <span>{g.label}</span>
                        <Badge variant={g.pass ? "outline" : "destructive"} className="shrink-0 text-[10px]">
                          {g.pass ? "Pass" : "Fail"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                {section.dimensions.length > 0 && (
                  <div className="space-y-1 border-t pt-2">
                    {section.dimensions.map((d) => (
                      <div key={d.key} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{d.label}</span>
                        <span className="tabular-nums">
                          {d.value === null ? "—" : String(d.value)}{" "}
                          <span className="text-xs text-muted-foreground">({d.score})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
