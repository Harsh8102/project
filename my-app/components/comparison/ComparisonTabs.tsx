// Tab shell docking Overview / Charges / Questionnaire / Terms / Review
// Queue / Decision Summary on one page (§8.3 of the functional plan: kept
// together, not separate routes, so a future chat panel can reference and
// highlight rows the buyer is already looking at).

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SUBMISSION_SECTIONS } from "@/lib/db/models/VendorSubmission";
import { QUESTIONNAIRE_FIELDS } from "@/lib/fixtures/questionnaireFields";
import { TERMS_FIELDS } from "@/lib/fixtures/termsFields";
import type { RfxOverview, SubmissionSummary } from "@/lib/db/queries/getRfxOverview";
import type {
  DecisionSummaryRecord,
  LaneSummary,
  UnsolicitedLane,
  VendorSummary,
} from "@/lib/db/queries/getComparisonData";
import type { LandedCostResult } from "@/lib/scoring/computeLandedCost";
import type { SectionScore, VendorScoreResult } from "@/lib/scoring/computeScores";
import type { ResolvedCostAssumptions } from "@/lib/scoring/costAssumptions";
import { ChargesGrid } from "./ChargesGrid";
import { ScoreboardSection } from "./ScoreboardSection";
import { DecisionSummary } from "./DecisionSummary";
import { UploadTab } from "./UploadTab";

function fileHref(blobUrl: string) {
  return `/api/files?url=${encodeURIComponent(blobUrl)}`;
}

const SECTION_LABELS: Record<string, string> = {
  rates: "Rates",
  questionnaire: "Questionnaire",
  terms: "Terms",
};

function SubmissionCell({ submission }: { submission: SubmissionSummary }) {
  if (!submission) {
    return <Badge variant="destructive">Not submitted</Badge>;
  }
  return (
    <div className="flex flex-col gap-1">
      <a
        href={fileHref(submission.blobUrl)}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-primary hover:underline"
      >
        {submission.fileName}
      </a>
      <div className="flex flex-wrap gap-1">
        <Badge variant="secondary" className="text-[10px]">
          {submission.fileType}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {submission.status}
        </Badge>
        {submission.formatViolation && (
          <Badge variant="destructive" className="text-[10px]">
            wrong format
          </Badge>
        )}
      </div>
    </div>
  );
}

export function ComparisonTabs({
  overview,
  lanes,
  vendors,
  landedCosts,
  costAssumptionsByLaneId,
  unsolicitedLanes,
  questionnaireScores,
  termsScores,
  vendorScores,
  decisions,
}: {
  overview: RfxOverview;
  lanes: LaneSummary[];
  vendors: VendorSummary[];
  landedCosts: Record<string, Record<string, LandedCostResult>>;
  costAssumptionsByLaneId: Record<string, ResolvedCostAssumptions>;
  unsolicitedLanes: UnsolicitedLane[];
  questionnaireScores: Record<string, SectionScore | null>;
  termsScores: Record<string, SectionScore | null>;
  vendorScores: Record<string, VendorScoreResult>;
  decisions: DecisionSummaryRecord[];
}) {
  return (
    <Tabs defaultValue="charges" className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="charges">Charges</TabsTrigger>
        <TabsTrigger value="questionnaire">Questionnaire</TabsTrigger>
        <TabsTrigger value="terms">Terms</TabsTrigger>
        <TabsTrigger value="decision">Decision Summary</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="min-h-0 flex-1 space-y-6 overflow-y-auto pt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buyer-side documents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            {overview.laneListBlobUrl && (
              <a href={fileHref(overview.laneListBlobUrl)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Lane list ({overview.laneCount} lanes) ↓
              </a>
            )}
            {overview.questionnaireTemplateBlobUrl && (
              <a
                href={fileHref(overview.questionnaireTemplateBlobUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Blank questionnaire template ↓
              </a>
            )}
            {overview.termsTemplateBlobUrl && (
              <a href={fileHref(overview.termsTemplateBlobUrl)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Blank terms template ↓
              </a>
            )}
          </CardContent>
        </Card>

        <Separator />

        <div>
          <h2 className="mb-3 text-lg font-semibold">Vendor submissions</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Vendor</TableHead>
                  {SUBMISSION_SECTIONS.map((section) => (
                    <TableHead key={section}>{SECTION_LABELS[section]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">
                      {vendor.code} — {vendor.name}
                    </TableCell>
                    {SUBMISSION_SECTIONS.map((section) => (
                      <TableCell key={section}>
                        <SubmissionCell submission={vendor.submissions[section]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="upload" className="min-h-0 flex-1 overflow-y-auto pt-4">
        <UploadTab overview={overview} />
      </TabsContent>

      <TabsContent value="charges" className="min-h-0 flex-1 overflow-hidden pt-4">
        <ChargesGrid
          lanes={lanes}
          vendors={vendors}
          landedCosts={landedCosts}
          costAssumptionsByLaneId={costAssumptionsByLaneId}
          unsolicitedLanes={unsolicitedLanes}
          vendorScores={vendorScores}
        />
      </TabsContent>

      <TabsContent value="questionnaire" className="min-h-0 flex-1 overflow-hidden pt-4">
        <ScoreboardSection vendors={vendors} scores={questionnaireScores} fields={QUESTIONNAIRE_FIELDS} sectionLabel="Questionnaire" />
      </TabsContent>

      <TabsContent value="terms" className="min-h-0 flex-1 overflow-hidden pt-4">
        <ScoreboardSection vendors={vendors} scores={termsScores} fields={TERMS_FIELDS} sectionLabel="Terms" />
      </TabsContent>

      <TabsContent value="decision" className="min-h-0 flex-1 overflow-y-auto pt-4">
        <DecisionSummary rfxId={overview.id} vendors={vendors} scores={vendorScores} decisions={decisions} />
      </TabsContent>
    </Tabs>
  );
}
