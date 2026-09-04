import { notFound } from "next/navigation";
import { getLatestRfxOverview } from "@/lib/db/queries/getRfxOverview";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";
import { getChatHistory } from "@/lib/db/queries/getChatHistory";
import { Badge } from "@/components/ui/badge";
import { RfxWorkspaceShell } from "@/components/RfxWorkspaceShell";
import { ComparisonTabs } from "@/components/comparison/ComparisonTabs";
import { ApiKeyControl } from "@/components/ApiKeyControl";

function mapToRecord<V>(m: Map<string, V>): Record<string, V> {
  return Object.fromEntries(m);
}

function nestedMapToRecord<V>(m: Map<string, Map<string, V>>): Record<string, Record<string, V>> {
  const out: Record<string, Record<string, V>> = {};
  for (const [k, inner] of m) out[k] = mapToRecord(inner);
  return out;
}

export default async function RfxOverviewPage() {
  const rfx = await getLatestRfxOverview();
  if (!rfx) notFound();

  const [comparison, chatHistory] = await Promise.all([getComparisonData(rfx.id), getChatHistory(rfx.id)]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-start justify-between border-b border-border px-6 py-4 md:px-8">
        <div>
          <h1 className="text-2xl font-semibold">{rfx.title}</h1>
          <p className="text-sm text-muted-foreground">
            {rfx.laneCount} lanes · {rfx.vendors.length} vendors
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <ApiKeyControl chatProvider={process.env.CHAT_PROVIDER === "groq" ? "groq" : "gemini"} />
          <Badge className="capitalize">{rfx.status}</Badge>
        </div>
      </div>

      <RfxWorkspaceShell rfxId={rfx.id} chatHistory={chatHistory}>
        <ComparisonTabs
          overview={rfx}
          lanes={comparison.lanes}
          vendors={comparison.vendors}
          landedCosts={nestedMapToRecord(comparison.landedCosts)}
          costAssumptionsByLaneId={mapToRecord(comparison.costAssumptionsByLaneId)}
          unsolicitedLanes={comparison.unsolicitedLanes}
          questionnaireScores={mapToRecord(comparison.questionnaireScores)}
          termsScores={mapToRecord(comparison.termsScores)}
          vendorScores={mapToRecord(comparison.vendorScores)}
          decisions={comparison.decisions}
        />
      </RfxWorkspaceShell>
    </div>
  );
}
