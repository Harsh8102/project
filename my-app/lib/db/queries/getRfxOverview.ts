import { connectToDatabase } from "../connect";
import { RfxModel } from "../models/Rfx";
import { LaneModel } from "../models/Lane";
import { VendorModel } from "../models/Vendor";
import { VendorSubmissionModel, SUBMISSION_SECTIONS, type SubmissionSection } from "../models/VendorSubmission";

export type SubmissionSummary = {
  id: string;
  section: SubmissionSection;
  fileName: string;
  fileType: string;
  blobUrl: string;
  status: string;
  formatViolation: boolean;
} | null;

export type VendorOverview = {
  id: string;
  code: string;
  name: string;
  submissions: Record<SubmissionSection, SubmissionSummary>;
};

export type RfxOverview = {
  id: string;
  title: string;
  status: string;
  laneCount: number;
  laneListBlobUrl: string | null;
  questionnaireTemplateBlobUrl: string | null;
  termsTemplateBlobUrl: string | null;
  vendors: VendorOverview[];
};

export async function getLatestRfxOverview(): Promise<RfxOverview | null> {
  await connectToDatabase();

  const rfx = await RfxModel.findOne().sort({ createdAt: -1 });
  if (!rfx) return null;

  const [laneCount, vendors, submissions] = await Promise.all([
    LaneModel.countDocuments({ rfxId: rfx._id }),
    VendorModel.find().sort({ code: 1 }),
    VendorSubmissionModel.find({ rfxId: rfx._id }),
  ]);

  const submissionsByVendor = new Map<string, Map<SubmissionSection, SubmissionSummary>>();
  for (const s of submissions) {
    const vendorId = s.vendorId.toString();
    if (!submissionsByVendor.has(vendorId)) submissionsByVendor.set(vendorId, new Map());
    submissionsByVendor.get(vendorId)!.set(s.section as SubmissionSection, {
      id: s._id.toString(),
      section: s.section as SubmissionSection,
      fileName: s.fileName,
      fileType: s.fileType,
      blobUrl: s.blobUrl,
      status: s.status,
      formatViolation: s.formatViolation,
    });
  }

  return {
    id: rfx._id.toString(),
    title: rfx.title,
    status: rfx.status,
    laneCount,
    laneListBlobUrl: rfx.laneListBlobUrl ?? null,
    questionnaireTemplateBlobUrl: rfx.questionnaireTemplateBlobUrl ?? null,
    termsTemplateBlobUrl: rfx.termsTemplateBlobUrl ?? null,
    vendors: vendors.map((v) => {
      const subs = submissionsByVendor.get(v._id.toString()) ?? new Map();
      const submissionsRecord = {} as Record<SubmissionSection, SubmissionSummary>;
      for (const section of SUBMISSION_SECTIONS) {
        submissionsRecord[section] = subs.get(section) ?? null;
      }
      return { id: v._id.toString(), code: v.code, name: v.name, submissions: submissionsRecord };
    }),
  };
}
