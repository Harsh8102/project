"use client";

// The direct, literal answer to the brief's "what does the system show the
// buyer when it isn't sure" (§8.2.4 of the functional plan) — every flag
// across every vendor and every section (charges/questionnaire/terms),
// aggregated and filterable, each row clickable to its source.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FieldDetailDialog } from "./FieldDetailDialog";
import type { ReviewQueueItem, VendorSummary } from "@/lib/db/queries/getComparisonData";

const DOMAIN_LABELS: Record<string, string> = {
  charges: "Charges",
  questionnaire: "Questionnaire",
  terms: "Terms",
};

export function ReviewQueue({ items, vendors }: { items: ReviewQueueItem[]; vendors: VendorSummary[] }) {
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");

  const filtered = useMemo(
    () =>
      items.filter(
        (i) => (vendorFilter === "all" || i.vendorId === vendorFilter) && (domainFilter === "all" || i.domain === domainFilter)
      ),
    [items, vendorFilter, domainFilter]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{filtered.length} flagged item{filtered.length === 1 ? "" : "s"}</span>
        <select
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
        >
          <option value="all">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.code}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="all">All sections</option>
          <option value="charges">Charges</option>
          <option value="questionnaire">Questionnaire</option>
          <option value="terms">Terms</option>
        </select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Field / Lane</TableHead>
              <TableHead>Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.vendorCode}</TableCell>
                <TableCell>{DOMAIN_LABELS[item.domain] ?? item.domain}</TableCell>
                <TableCell>{item.laneLabel ?? item.rawHeaderLabel ?? item.fieldKey ?? "—"}</TableCell>
                <TableCell>
                  <FieldDetailDialog
                    trigger={
                      <Badge variant="destructive" className="cursor-pointer text-[10px]">
                        {item.flagType.replaceAll("_", " ")}
                      </Badge>
                    }
                    title={`${item.vendorCode} — ${item.laneLabel ?? item.rawHeaderLabel ?? item.fieldKey ?? "Flag"}`}
                    rawValue={item.rawValue}
                    confidence={item.confidence}
                    sourceSnippet={item.sourceSnippet}
                    flagType={item.flagType}
                    flagNote={item.flagNote}
                  />
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No flags for this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
