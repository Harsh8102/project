"use client";

// Renders one chat tool call's result as a table or chart, per the
// `displayHint` the tool itself set (never guessed from the model's prose —
// §8.3 of the functional plan). Used for both a live turn and a reloaded
// turn's stored trace, since both are just a ToolCallTrace.

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ToolCallTrace } from "@/lib/db/queries/getChatHistory";

function extractRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
        return value as Record<string, unknown>[];
      }
    }
  }
  return null;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function GenericTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No matching rows.</p>;
  const columns = Object.keys(rows[0]).filter((k) => k !== "vendorId" && k !== "laneId" && k !== "flagId");

  return (
    <div className="max-h-64 min-w-0 max-w-full overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="text-[11px]">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c} className="text-xs">
                  {formatCell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BarChartView({ rows }: { rows: Record<string, unknown>[] }) {
  const numericKey = Object.keys(rows[0] ?? {}).find(
    (k) => typeof rows[0][k] === "number" && !k.toLowerCase().endsWith("id") && !k.toLowerCase().includes("count")
  );
  if (!numericKey) return <GenericTable rows={rows} />;

  const chartData = rows.map((r) => ({ label: (r.vendorCode as string) ?? "?", value: r[numericKey] as number }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" fontSize={11} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Bar dataKey="value" fill="var(--color-primary, #6366f1)" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ToolResultView({ trace }: { trace: ToolCallTrace }) {
  const { result } = trace;
  if (result.displayHint === "none") return null;

  const rows = extractRows(result.data);
  if (!rows) return null;

  return (
    <div className="mt-2 min-w-0 max-w-full space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{trace.name}</p>
      {result.displayHint === "chart" ? <BarChartView rows={rows} /> : <GenericTable rows={rows} />}
    </div>
  );
}
