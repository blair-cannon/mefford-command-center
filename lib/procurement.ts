import { roundMoney } from "./money.js";

export const SALES_PROJECT_ID = "MEFFORD-SALES";
export const BID_PACKAGE_RECORD_TYPE = "Bid Packages";
export const PROCUREMENT_FILE_CATEGORY = "03-Estimating - Quotes";

export type QuoteOcrReview = {
  status: "Human Reviewed";
  engine: "PDF Text + Tesseract OCR" | "Manual Review · Original File Preserved";
  extractedPrice: number;
  extractedScope: string;
  reviewedPrice: number;
  reviewedScope: string;
  reviewedBy: string;
  reviewedAt: string;
  completedAt: string;
  characterCount: number;
};

export type BidRevision = {
  id: string;
  revision: number;
  total: number;
  baseBid: number;
  alternates: string;
  allowances: string;
  exclusions: string;
  qualifications: string;
  clarifications: string;
  schedule: string;
  fileId: number;
  fileName: string;
  receivedAt: string;
  receivedBy: string;
  supersedesRevisionId: string;
  supersededByRevisionId: string;
  ocr?: QuoteOcrReview;
};

export type BidderRecord = {
  vendorId: string;
  vendorName: string;
  contactName: string;
  contactEmail: string;
  invitedAt: string;
  invitationStatus: string;
  portalStatus: string;
  revisions: BidRevision[];
  questions: Array<{ id: string; question: string; askedAt: string; status: string; publicAnswerId?: string }>;
  acknowledgments: string[];
  leveling: {
    scopeComplete: boolean;
    exclusionsReviewed: boolean;
    alternatesReviewed: boolean;
    clarificationsComplete: boolean;
    budgetCompared: boolean;
    leveledAmount: number;
    notes: string;
    scopeResolution?: string;
    completedBy: string;
    completedAt: string;
  };
  reopenedUntil: string;
  reopenedReason: string;
  reopenedBy: string;
};

export type ProposalBasis = {
  vendorId: string;
  vendorName: string;
  bidRevisionId: string;
  bidRevision: number;
  selectedPrice: number;
  sourceScope: string;
  ownerScopeDraft: string;
  estimateLineKey: string;
  selectedBy: string;
  selectedAt: string;
};

export type BidPackageData = {
  lifecycleScope: "Sales" | "Project";
  opportunityId: string;
  projectId: string;
  trade: string;
  costCode: string;
  scopeDescription: string;
  scopeNature: "Labor And Material" | "Labor Only" | "Material Or Equipment Only" | "Professional Service";
  budgetAmount: number;
  deadline: string;
  estimatedStart: string;
  bidInstructions: string;
  folderProjectId: string;
  folderCategory: string;
  bidders: BidderRecord[];
  addenda: Array<{ id: string; number: number; title: string; body: string; issuedAt: string; issuedBy: string; attachmentFileId: number; attachmentName: string }>;
  publicAnswers: Array<{ id: string; questionId: string; question: string; answer: string; issuedAt: string; issuedBy: string }>;
  coverageException: { reason: string; requestedBy: string; requestedAt: string; approvedBy: string; approvedAt: string } | null;
  recommendation: { vendorId: string; vendorName: string; narrative: string; submittedBy: string; submittedAt: string } | null;
  proposalBasis: ProposalBasis | null;
  ownerApproval: { decision: string; note: string; ownerName: string; ownerEmail: string; decidedAt: string } | null;
  commitmentRecommendation: "Subcontract" | "Purchase Order";
  commitmentType: "" | "Subcontract" | "Purchase Order";
  commitmentOverrideReason: string;
  linkedCommitmentId: string;
  commitmentDecision: {
    decision: "Do Not Award";
    reason: string;
    decidedBy: string;
    decidedAt: string;
  } | null;
  awardHandoff: Record<string, unknown> | null;
  immutableSalesSnapshot: Record<string, unknown> | null;
  timeline: Array<{ action: string; actor: string; at: string; detail: string }>;
};

export function emptyBidPackageData(input: {
  scope: "Sales" | "Project";
  opportunityId?: string;
  projectId?: string;
  trade: string;
  costCode: string;
  scopeDescription: string;
  scopeNature: BidPackageData["scopeNature"];
  budgetAmount: number;
  deadline: string;
  estimatedStart?: string;
  bidInstructions?: string;
}) : BidPackageData {
  const folderProjectId = input.scope === "Sales"
    ? `ESTIMATE-${input.opportunityId || "UNASSIGNED"}`
    : input.projectId || "";
  return {
    lifecycleScope: input.scope,
    opportunityId: input.opportunityId || "",
    projectId: input.projectId || "",
    trade: input.trade,
    costCode: input.costCode,
    scopeDescription: input.scopeDescription,
    scopeNature: input.scopeNature,
    budgetAmount: Math.max(0, roundMoney(input.budgetAmount || 0)),
    deadline: input.deadline,
    estimatedStart: input.estimatedStart || "",
    bidInstructions: input.bidInstructions || "",
    folderProjectId,
    folderCategory: PROCUREMENT_FILE_CATEGORY,
    bidders: [],
    addenda: [],
    publicAnswers: [],
    coverageException: null,
    recommendation: null,
    proposalBasis: null,
    ownerApproval: null,
    commitmentRecommendation: recommendCommitmentType(input.scopeNature),
    commitmentType: "",
    commitmentOverrideReason: "",
    linkedCommitmentId: "",
    commitmentDecision: null,
    awardHandoff: null,
    immutableSalesSnapshot: null,
    timeline: [],
  };
}

export function normalizeBidPackageData(value: unknown): BidPackageData {
  const source = value && typeof value === "object" ? value as Partial<BidPackageData> : {};
  return {
    ...emptyBidPackageData({
      scope: source.lifecycleScope === "Project" ? "Project" : "Sales",
      opportunityId: source.opportunityId || "",
      projectId: source.projectId || "",
      trade: source.trade || "",
      costCode: source.costCode || "Unassigned",
      scopeDescription: source.scopeDescription || "",
      scopeNature: source.scopeNature || "Labor And Material",
      budgetAmount: Number(source.budgetAmount || 0),
      deadline: source.deadline || "",
      estimatedStart: source.estimatedStart || "",
      bidInstructions: source.bidInstructions || "",
    }),
    ...source,
    folderCategory: PROCUREMENT_FILE_CATEGORY,
    bidders: Array.isArray(source.bidders) ? source.bidders : [],
    addenda: Array.isArray(source.addenda) ? source.addenda : [],
    publicAnswers: Array.isArray(source.publicAnswers) ? source.publicAnswers : [],
    proposalBasis: source.proposalBasis && typeof source.proposalBasis === "object"
      ? source.proposalBasis as ProposalBasis
      : null,
    timeline: Array.isArray(source.timeline) ? source.timeline : [],
  } as BidPackageData;
}

export function buildOwnerScopeDraft(data: BidPackageData, bidder: BidderRecord) {
  const bid = latestBid(bidder);
  const reviewedScope = bid?.ocr?.reviewedScope?.trim() || "";
  const pieces = uniqueScopeParts([reviewedScope]);
  const trade = (data.trade || "trade").trim().replace(/[.]+$/g, "");
  const detail = pieces.join("; ");
  return detail
    ? `Provide ${trade.toLowerCase()} work: ${lowerFirst(detail)}.`
    : `Confirm the ${trade.toLowerCase()} scope against the original quote before including this work.`;
}

export function recommendCommitmentType(scopeNature: BidPackageData["scopeNature"]) {
  return scopeNature === "Material Or Equipment Only" ? "Purchase Order" : "Subcontract";
}

export function latestBid(bidder: BidderRecord) {
  return bidder.revisions.at(-1) || null;
}

export function selectedProposalBid(data: BidPackageData) {
  if (!data.proposalBasis) return null;
  const bidder = data.bidders.find(
    (item) => item.vendorId === data.proposalBasis?.vendorId,
  );
  if (!bidder) return null;
  const bid = bidder.revisions.find(
    (revision) => revision.id === data.proposalBasis?.bidRevisionId,
  );
  return bid && bid.id === latestBid(bidder)?.id && bidderIsLeveled(bidder)
    && roundMoney(bidder.leveling.leveledAmount) === roundMoney(data.proposalBasis.selectedPrice)
    && !(bidder.leveling.completedAt > data.proposalBasis.selectedAt)
    && !missingAddendumAcknowledgments(data, bidder).length ? { bidder, bid, basis: data.proposalBasis } : null;
}

export function bidderIsLeveled(bidder: BidderRecord) {
  const leveling = bidder.leveling;
  return Boolean(
    latestBid(bidder) &&
    leveling?.scopeComplete &&
    leveling?.exclusionsReviewed &&
    leveling?.alternatesReviewed &&
    leveling?.clarificationsComplete &&
    leveling?.budgetCompared,
  );
}

export function missingAddendumAcknowledgments(data: BidPackageData, bidder: BidderRecord) {
  return data.addenda.filter((addendum) => !bidder.acknowledgments.includes(addendum.id));
}

export function coverageSatisfied(data: BidPackageData) {
  const responsive = data.bidders.filter((bidder) => latestBid(bidder) && !missingAddendumAcknowledgments(data, bidder).length);
  return responsive.length >= 3 || Boolean(data.coverageException?.approvedAt);
}

export function permanentBidFolder(data: BidPackageData, packageId: string, vendorName: string, revision: number) {
  const safeVendor = vendorName.replace(/[^a-zA-Z0-9 -]+/g, "-");
  return `Procurement / ${packageId} / ${safeVendor} / Bid Revision ${revision}`;
}

function uniqueScopeParts(values: string[]) {
  const parts: string[] = [];
  for (const value of values) {
    const clean = String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^(?:scope(?: of work)?(?: includes?)?|work included|provide(?: and install)?|included work)\s*:?\s*/i, "")
      .replace(/\s*[.;]+\s*$/g, "")
      .trim();
    if (clean && !parts.some((item) => item.toLowerCase() === clean.toLowerCase())) parts.push(clean);
  }
  return parts;
}

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}
