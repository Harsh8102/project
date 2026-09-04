import { ExtractedFieldModel, type FieldDomain, type FlagType } from "./models/ExtractedField";

export type ExtractedFieldInput = {
  laneId?: string | null;
  fieldKey: string | null;
  rawHeaderLabel?: string | null;
  rawValue: string;
  normalizedValue: number | string | boolean | null;
  unit?: string | null;
  basis?: string | null;
  currency?: string | null;
  confidence: number;
  sourceSnippet: { type: "cell" | "page" | "quote"; cellRef?: string | null; page?: number | null; quote?: string | null };
  flagType?: FlagType | null;
  flagNote?: string | null;
};

/**
 * Append-only write (§7 trust section): the previous version's rows are
 * marked isLatest=false, never overwritten or deleted, so re-extraction
 * can't silently change what an evaluator saw earlier in a session.
 */
export async function writeExtractedFields(params: {
  rfxId: string;
  vendorId: string;
  submissionId: string;
  domain: FieldDomain;
  records: ExtractedFieldInput[];
}) {
  const { rfxId, vendorId, submissionId, domain, records } = params;

  const latestVersionDoc = await ExtractedFieldModel.findOne({ submissionId }).sort({ version: -1 }).select("version");
  const nextVersion = (latestVersionDoc?.version ?? 0) + 1;

  await ExtractedFieldModel.updateMany({ submissionId, isLatest: true }, { $set: { isLatest: false } });

  if (records.length === 0) return;

  await ExtractedFieldModel.insertMany(
    records.map((r) => ({
      submissionId,
      rfxId,
      vendorId,
      domain,
      laneId: r.laneId ?? null,
      fieldKey: r.fieldKey ?? "unmapped",
      rawHeaderLabel: r.rawHeaderLabel ?? null,
      rawValue: r.rawValue,
      normalizedValue: r.normalizedValue,
      unit: r.unit ?? null,
      basis: r.basis ?? null,
      currency: r.currency ?? null,
      confidence: r.confidence,
      sourceSnippet: r.sourceSnippet,
      flagType: r.flagType ?? null,
      flagNote: r.flagNote ?? null,
      manualOverrideFieldKey: null,
      version: nextVersion,
      isLatest: true,
      extractedAt: new Date(),
    }))
  );
}
