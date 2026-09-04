import { notFound } from "next/navigation";
import { getLatestRfxOverview } from "@/lib/db/queries/getRfxOverview";
import { getComparisonData } from "@/lib/db/queries/getComparisonData";
import { getChatHistory } from "@/lib/db/queries/getChatHistory";
import { Badge } from "@/components/ui/badge";
import { ComparisonTabs } from "@/components/comparison/ComparisonTabs";
import { ChatPanel } from "@/components/chat/ChatPanel";

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
    <div className="mx-auto max-w-[1600px] space-y-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{rfx.title}</h1>
          <p className="text-sm text-muted-foreground">
            {rfx.laneCount} lanes · {rfx.vendors.length} vendors
          </p>
        </div>
        <Badge className="capitalize">{rfx.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <ComparisonTabs
          overview={rfx}
          lanes={comparison.lanes}
          vendors={comparison.vendors}
          landedCosts={nestedMapToRecord(comparison.landedCosts)}
          unsolicitedLanes={comparison.unsolicitedLanes}
          questionnaireScores={mapToRecord(comparison.questionnaireScores)}
          termsScores={mapToRecord(comparison.termsScores)}
          vendorScores={mapToRecord(comparison.vendorScores)}
          reviewQueue={comparison.reviewQueue}
          timeSaved={comparison.timeSaved}
          decisions={comparison.decisions}
        />
        <ChatPanel rfxId={rfx.id} initialMessages={chatHistory} />
      </div>
    </div>
  );
}
