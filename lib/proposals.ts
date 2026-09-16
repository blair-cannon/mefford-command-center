import {
  calculateEstimateSummary,
  normalizeEstimateData,
  type EstimateRollup,
} from "../app/estimate-template";
import {
  latestBid,
  selectedProposalBid,
  normalizeBidPackageData,
  type BidPackageData,
} from "./procurement";
import { roundMoney } from "./money";
import { contractTemplate, normalizeOwnerContractType } from "./owner-contracts";

export const OWNER_PROPOSAL_RECORD_TYPE = "Owner Proposals";
export const OWNER_PROPOSAL_FILE_CATEGORY = "05-Owner Proposal & LOE";
export const MEFFORD_PROPOSAL_VOICE_VERSION = "mefford-owner-system-v9";
export const PROPOSAL_PRICING_VERSION = "estimate-general-conditions-v3-design-startup";
export const DESIGN_STARTUP_STANDARD_PERCENT = 5;

export const MEFFORD_CORE_VALUES = [
  "RIDE OR DIE",
  "NO BULLSHIT",
  "PROBLEM SOLVERS",
  "STAY HUNGRY",
] as const;

export const MEFFORD_OWNER_COMMITMENTS = [
  { value: "RIDE OR DIE", promise: "We stay with the owner, the work, and the hard parts through turnover." },
  { value: "NO BULLSHIT", promise: "We share hard facts early so both teams work from the same version of the truth." },
  { value: "PROBLEM SOLVERS", promise: "We bring the facts, the options, and a recommended way forward." },
  { value: "STAY HUNGRY", promise: "We keep testing and improving the plan so both teams can keep growing." },
] as const;

export const PROPOSAL_PACKET_TYPES = [
  "Construction Proposal",
  "Preconstruction Letter of Engagement",
] as const;

export type ProposalPacketType = (typeof PROPOSAL_PACKET_TYPES)[number];

export const PROPOSAL_VISUAL_PLACEMENTS = [
  "Project Photo",
  "Design Drawing",
  "After Cover",
  "After Project Read",
  "After Delivery Plan",
  "After Scope",
  "Appendix",
] as const;

export type ProposalVisualPlacement = (typeof PROPOSAL_VISUAL_PLACEMENTS)[number];
export type ProposalVisual = {
  id: string;
  fileId: number;
  kind: "Photo" | "Drawing PDF";
  name: string;
  contentType: string;
  placement: ProposalVisualPlacement;
  caption: string;
  pageSelection: string;
  included: boolean;
};

export type ProposalScopeSection = {
  id: string;
  title: string;
  description: string;
  amount: number;
  included: boolean;
  sourceLabel: string;
  sourceRevisionId: string;
};

export type ProposalDesignStartupService = {
  id: string;
  title: string;
  description: string;
  included: boolean;
};

export const DEFAULT_DESIGN_STARTUP_SERVICES: readonly ProposalDesignStartupService[] = [
  {
    id: "DESIGN-STARTUP-GEOTECHNICAL",
    title: "Geotechnical Services",
    description: "Borings and subsurface exploration; soil, rock and groundwater observations; bearing values; and fill, compaction and pavement recommendations.",
    included: true,
  },
  {
    id: "DESIGN-STARTUP-ARCHITECTURAL",
    title: "Architectural Services",
    description: "Programming, concepts and design development; code, life-safety and accessibility review; coordinated permit drawings; and plan-review responses.",
    included: true,
  },
  {
    id: "DESIGN-STARTUP-STRUCTURAL",
    title: "Structural Engineering",
    description: "Foundation and framing design criteria, calculations and details; delegated-component coordination; and structural permit responses.",
    included: true,
  },
  {
    id: "DESIGN-STARTUP-CIVIL",
    title: "Civil And Site Engineering",
    description: "Survey coordination, site layout, grading, drainage and stormwater, utilities, erosion control, access, parking and agency submittals.",
    included: true,
  },
  {
    id: "DESIGN-STARTUP-MEP",
    title: "MEP, Fire And Energy Engineering",
    description: "Mechanical, electrical, plumbing, fire-protection and energy-code design; utility loads; system coordination; and permit documents.",
    included: true,
  },
  {
    id: "DESIGN-STARTUP-PERMITTING",
    title: "Permitting And Municipality Coordination",
    description: "Pre-application, zoning, building, fire, utility and public-works meetings; applications; review comments; resubmittals; and other permit-driven consultants.",
    included: true,
  },
];

export type ProposalApproachPhase = {
  id: string;
  title: string;
  description: string;
  included: boolean;
};

export type ProposalExperienceSnapshot = {
  id: string;
  projectId: string;
  projectName: string;
  projectLocation: string;
  role: string;
  projectType: string;
  completionDate: string;
  summary: string;
  photoFileIds: number[];
};

export type ProposalTeamMember = {
  employeeEmail: string;
  displayName: string;
  companyTitle: string;
  proposalRoleLabel: string;
  professionalSummary: string;
  credentials: string[];
  priorExperience: string[];
  headshotFileId: number;
  leadershipProfile: boolean;
  includeInProposal: boolean;
  experience: ProposalExperienceSnapshot[];
};

export type ProposalScheduleMilestone = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  phase: string;
  sourceReferences: string[];
  assumption: boolean;
  included: boolean;
};

export type ProposalCitation = { sourceId: string; label: string; detail: string };

export type ProposalIntelligence = {
  status: "Not Requested" | "Connection Required" | "Draft" | "Approved";
  model: string;
  generatedAt: string;
  generatedBy: string;
  approvedAt: string;
  approvedBy: string;
  citations: ProposalCitation[];
  sourceFileIds: number[];
  openQuestions: string[];
};

export type ProposalSourceSnapshot = {
  capturedAt: string;
  estimateTemplateVersion: string;
  estimateStatus: string;
  estimateSavedAt: string;
  estimateContractValue: number;
  estimateScopeCount: number;
  bidPackageCount: number;
  receivedQuoteCount: number;
  reviewedQuoteCount: number;
  selectedQuoteCount: number;
  unselectedBidPackageCount: number;
  contactLinked: boolean;
  estimateDurationMonths?: number;
  estimateStartDate?: string;
  selectedQuoteSignature?: string;
  estimateCalculationSignature?: string;
};

export type ProposalData = {
  ownerDelivery?: { status: string; recipient: string; revision: number; attemptedAt: string; acceptedAt: string; receiptId: string; error: string; provider?: string; providerStatus?: number; safeToRetry?: boolean; retryAt?: string; idempotencyKey?: string };
  brandVoiceVersion: string;
  pricingVersion: string;
  opportunityId: string;
  packetType: ProposalPacketType;
  revision: number;
  projectName: string;
  projectLocation: string;
  ownerName: string;
  ownerContactName: string;
  ownerContactTitle: string;
  ownerContactEmail: string;
  ownerContactPhone: string;
  publicBid?: boolean;
  proposalDate: string;
  validThrough: string;
  preparedBy: string;
  preparedByEmail: string;
  deliveryMethod: string;
  projectType: string;
  title: string;
  subtitle: string;
  customerLogoFileId: number;
  executiveSummary: string;
  projectUnderstanding: string;
  proposedProjectManagerEmail: string;
  proposedSuperintendentEmail: string;
  teamMembers: ProposalTeamMember[];
  approachIntroduction: string;
  approachPhases: ProposalApproachPhase[];
  visuals: ProposalVisual[];
  scopeSections: ProposalScopeSection[];
  contractPrice: number;
  designStartupGmp: number;
  designStartupGmpManual: boolean;
  designStartupServices: ProposalDesignStartupService[];
  showSectionPricing: boolean;
  targetStartDate: string;
  durationMonths: number;
  scheduleNarrative: string;
  scheduleMilestones: ProposalScheduleMilestone[];
  paymentTerms: string;
  depositPercent: number;
  assumptions: string[];
  exclusions: string[];
  nextSteps: string;
  recommendationSteps: string[];
  recommendedContractType: string;
  proposalIntelligence: ProposalIntelligence;
  sourceSnapshot: ProposalSourceSnapshot;
  status: "Draft" | "Ready For Review" | "Approved To Send" | "Issued";
  issuedAt: string;
  issuedBy: string;
  issuedPdfKey: string;
  issuedPdfHash: string;
  issuedSnapshots: Array<Record<string, unknown>>;
  updatedAt: string;
  updatedBy: string;
};

type SourceRecord = {
  id: string;
  title: string;
  owner: string;
  status: string;
  data?: Record<string, unknown>;
};

type ContactSource = {
  title?: string;
  data?: Record<string, unknown>;
} | null;

type BidPackageSource = {
  id: string;
  title: string;
  data?: unknown;
};

export function isProposalPacketType(value: unknown): value is ProposalPacketType {
  return PROPOSAL_PACKET_TYPES.includes(value as ProposalPacketType);
}

export function proposalRecordId(opportunityId: string, packetType: ProposalPacketType) {
  const suffix = packetType === "Construction Proposal" ? "PROPOSAL" : "LOE";
  return `${opportunityId}-${suffix}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function proposalNeedsVoiceMigration(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ProposalData>
    : {};
  if (source.brandVoiceVersion !== MEFFORD_PROPOSAL_VOICE_VERSION) return true;
  const writtenCopy = [
    source.subtitle,
    source.executiveSummary,
    source.projectUnderstanding,
    source.approachIntroduction,
    ...(Array.isArray(source.approachPhases) ? source.approachPhases.flatMap((item) => [item.title, item.description]) : []),
  ].join(" ");
  return /pleased to present|defensible path|one controlled plan|one working plan|accountable leadership|transparent cost control|kickoff and alignment|gmp and construction handoff|a clear plan to deliver the work with confidence|clear scope\. straight answers|one team\. straight answers|problems before they become excuses|get in the same room|pressure-test the plan|finish strong|choosing a contractor is about more than price/i.test(writtenCopy);
}

export function proposalNeedsPricingMigration(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ProposalData>
    : {};
  return source.pricingVersion !== PROPOSAL_PRICING_VERSION;
}

function proposalContractTitle(data: Record<string, unknown>, designBuild: boolean) {
  const handoff = data.proposalHandoff && typeof data.proposalHandoff === "object" && !Array.isArray(data.proposalHandoff)
    ? data.proposalHandoff as Record<string, unknown>
    : {};
  const contractType = normalizeOwnerContractType(data.ownerContractType)
    || normalizeOwnerContractType(data.deliveryMethod)
    || normalizeOwnerContractType(handoff.ownerContractType)
    || (designBuild ? "Design-Build Lump Sum" : "Plan & Spec Lump Sum");
  return contractTemplate(contractType).label;
}

export function proposalScopeTotal(scopeSections: ProposalScopeSection[]) {
  return roundMoney(scopeSections.reduce(
    (total, scope) => scope.included ? total + roundMoney(scope.amount) : total,
    0,
  ));
}

export function designStartupGmpForPrice(contractPrice: number) {
  return roundMoney(Math.max(0, Number(contractPrice || 0)) * DESIGN_STARTUP_STANDARD_PERCENT / 100);
}

export function isDesignBuildProposal(data: Pick<ProposalData, "packetType" | "deliveryMethod" | "recommendedContractType">) {
  if (data.packetType !== "Construction Proposal") return false;
  const contractType = normalizeOwnerContractType(data.recommendedContractType);
  if (contractType) return contractType.startsWith("Design-Build");
  return String(data.deliveryMethod || "").toLowerCase().includes("design-build");
}

export function allocateProposalScopePricing(
  scopeSections: ProposalScopeSection[],
  contractPrice: number,
) {
  const targetCents = Math.round(roundMoney(contractPrice) * 100);
  const sections = scopeSections.map((scope) => ({ ...scope, amount: roundMoney(scope.amount) }));
  const directScopeCents = sections.reduce(
    (total, scope) => scope.included ? total + Math.round(scope.amount * 100) : total,
    0,
  );
  const generalConditionsAdjustmentCents = targetCents - directScopeCents;
  const generalConditionsIndex = sections.findIndex((scope) =>
    /general\s+(?:conditions|requirements)/i.test(scope.title)
      || /^SCOPE-0*1(?:-|$)/i.test(scope.id),
  );

  if (generalConditionsIndex < 0) {
    if (!generalConditionsAdjustmentCents) return sections;
    return [{
      id: "SCOPE-GENERAL-CONDITIONS",
      title: "General Conditions",
      description: "General Conditions; Overhead & Profit",
      amount: roundMoney(generalConditionsAdjustmentCents / 100),
      included: true,
      sourceLabel: "Estimate · General Conditions + Overhead & Profit",
      sourceRevisionId: "",
    }, ...sections];
  }

  const generalConditions = sections[generalConditionsIndex];
  sections[generalConditionsIndex] = {
    ...generalConditions,
    title: "General Conditions",
    description: uniqueSentences([
      generalConditions.description,
      generalConditionsAdjustmentCents ? "Overhead & Profit" : "",
    ]).join("; "),
    amount: roundMoney((Math.round(generalConditions.amount * 100) + generalConditionsAdjustmentCents) / 100),
    sourceLabel: generalConditionsAdjustmentCents
      ? "Estimate · General Conditions + Overhead & Profit"
      : "Estimate · General Conditions",
  };
  return sections;
}

export function buildProposalFromSources(input: {
  opportunity: SourceRecord;
  contact: ContactSource;
  estimateValue: unknown;
  bidPackages: BidPackageSource[];
  packetType: ProposalPacketType;
  actor: { name: string; email: string };
  now?: Date;
}) : ProposalData {
  const now = input.now ?? new Date();
  const data = input.opportunity.data ?? {};
  const contact = input.contact?.data ?? {};
  const estimate = normalizeEstimateData(input.estimateValue);
  const summary = calculateEstimateSummary(estimate);
  const bidPackages = input.bidPackages
    .map((item) => ({ ...item, normalized: normalizeBidPackageData(item.data) }))
    .filter((item) => item.normalized.opportunityId === input.opportunity.id);
  const isEngagement = input.packetType === "Preconstruction Letter of Engagement";
  const deliveryDesignBuild = String(data.deliveryMethod || "").toLowerCase().includes("design") || isEngagement;
  const recommendedContractType = proposalContractTitle(data, deliveryDesignBuild);
  const designBuild = isEngagement || recommendedContractType.startsWith("Design-Build");
  const projectName = String(data.projectName || input.opportunity.title || "Project");
  const ownerName = String(data.company || "Owner");
  const today = easternDate(now);
  const validThrough = addDays(today, 30);
  const contactName = String(input.contact?.title || data.contactName || "");
  const receivedQuoteCount = bidPackages.reduce(
    (total, item) => total + item.normalized.bidders.filter((bidder) => latestBid(bidder)).length,
    0,
  );
  const reviewedQuoteCount = bidPackages.reduce(
    (total, item) => total + item.normalized.bidders.filter((bidder) => latestBid(bidder)?.ocr?.status === "Human Reviewed").length,
    0,
  );
  const selectedQuoteCount = bidPackages.filter((item) => Boolean(selectedProposalBid(item.normalized))).length;
  const unselectedBidPackageCount = bidPackages.filter((item) =>
    item.normalized.bidders.some((bidder) => Boolean(latestBid(bidder))) && !selectedProposalBid(item.normalized),
  ).length;
  const engagementRollups = summary.budgetRollups
    .filter((item) => /architect|design|engineer/i.test(`${item.description} ${item.division}`));
  const architecturalAmount = roundMoney(engagementRollups.reduce((total, item) => total + item.amount, 0));
  const contractPrice = roundMoney(isEngagement ? architecturalAmount : summary.contractValue);
  const directScopeSections = buildScopeSections(
    isEngagement ? engagementRollups : summary.budgetRollups,
    isEngagement ? [] : bidPackages,
  );
  const scopeSections = isEngagement
    ? directScopeSections
    : allocateProposalScopePricing(directScopeSections, contractPrice);
  const notes = String(estimate.notes || data.notes || "");
  const noteLines = splitLines(notes);
  const projectLocation = String(data.projectLocation || "");
  const projectUnderstanding = [
    `${ownerName} is planning ${projectName}${projectLocation ? ` at ${projectLocation}` : ""}.`,
    noteLines[0] || "The work needs a clear scope, dependable budget, and schedule tied to the owner's priorities.",
    designBuild
      ? "Mefford will coordinate design, trade input, cost, schedule, and owner decisions into one buildable plan."
      : "Mefford will coordinate scope, trade partners, cost, schedule, safety, and closeout into one buildable plan.",
  ].filter(Boolean).join(" ");

  return {
    brandVoiceVersion: MEFFORD_PROPOSAL_VOICE_VERSION,
    pricingVersion: PROPOSAL_PRICING_VERSION,
    opportunityId: input.opportunity.id,
    packetType: input.packetType,
    revision: 1,
    projectName,
    projectLocation,
    ownerName,
    ownerContactName: contactName,
    publicBid: data.leadSource === "Public Bid",
    ownerContactTitle: String(contact.jobTitle || ""),
    ownerContactEmail: String(contact.email || ""),
    ownerContactPhone: String(contact.phone || ""),
    proposalDate: today,
    validThrough,
    preparedBy: input.actor.name,
    preparedByEmail: input.actor.email,
    deliveryMethod: String(data.deliveryMethod || "Unknown"),
    projectType: String(data.projectType || "Commercial"),
    title: isEngagement ? "Preconstruction Engagement" : "Project Proposal",
    subtitle: isEngagement
      ? "A Clear Start Built Around The Decisions That Matter"
      : "A Clear Plan, One Accountable Team, And A Strong Finish",
    customerLogoFileId: 0,
    executiveSummary: isEngagement
      ? `Mefford Contracting will use preconstruction as the beginning of the working relationship: learn how ${ownerName}'s business and building need to work, test the important choices, and give ${projectName} an honest basis for the construction decision.`
      : `Mefford Contracting will lead ${projectName} with clear ownership of scope, cost, schedule, decisions, and turnover. The goal is a strong project and a relationship that is stronger when the work is finished.`,
    projectUnderstanding,
    proposedProjectManagerEmail: "",
    proposedSuperintendentEmail: "",
    teamMembers: [],
    approachIntroduction: isEngagement
      ? "Every step should reduce uncertainty and leave the owner with a useful decision, deliverable, or clear next move."
      : "The owner should always know where the project stands, what changed, and who owns the next move.",
    approachPhases: defaultApproachPhases(designBuild, isEngagement),
    visuals: [],
    scopeSections,
    contractPrice,
    designStartupGmp: designBuild && !isEngagement ? designStartupGmpForPrice(contractPrice) : 0,
    designStartupGmpManual: false,
    designStartupServices: DEFAULT_DESIGN_STARTUP_SERVICES.map((service) => ({ ...service })),
    showSectionPricing: false,
    targetStartDate: String(data.targetStartDate || data.expectedAwardDate || ""),
    durationMonths: Math.max(0, Number(estimate.projectInputs.projectDurationMonths || 0)),
    scheduleNarrative: isEngagement
      ? "The decision schedule will connect owner reviews, design milestones, budget updates, consultant input, and the construction decision."
      : "The proposed timeline connects scope, design, procurement, field execution, inspections, owner decisions, and turnover.",
    scheduleMilestones: defaultScheduleMilestones(String(data.targetStartDate || data.expectedAwardDate || ""), Math.max(0, Number(estimate.projectInputs.projectDurationMonths || 0)), designBuild),
    paymentTerms: isEngagement
      ? "Mefford Contracting will invoice monthly for services performed and approved consultant costs. Supporting detail will be provided with each invoice, and undisputed amounts are due within 30 days."
      : "Mefford Contracting will bill monthly for completed work and properly stored materials. Each application for payment will reflect the current contract and project status; undisputed amounts are due within 30 days.",
    depositPercent: isEngagement ? 10 : 0,
    assumptions: noteLines.length ? noteLines : [
      "Site access, work hours, and accommodations for owner operations will be coordinated before mobilization.",
      "Pricing is based on the current estimate, available documents, and written clarifications included with this proposal. Any change to that basis will be reviewed with the owner before the related work proceeds.",
      "Owner decisions and required information will be coordinated around the dates shown on the project decision schedule.",
    ],
    exclusions: [
      ...bidPackages.flatMap(item => { const selected = selectedProposalBid(item.normalized); return selected?.bid.exclusions.trim() && !/^(?:none|n\/a|no exclusions)[.!]?$/i.test(selected.bid.exclusions.trim()) ? [`${item.normalized.trade}: ${selected.bid.exclusions.trim()}`] : []; }),
      "Hazardous-material testing or abatement unless it is specifically written into the scope.",
      "Hidden conditions that could not reasonably be seen before work begins, and owner-requested changes after approval.",
      "Anything not shown or written in this proposal, its scope, or the listed exhibits.",
    ],
    nextSteps: isEngagement
      ? "Approve the engagement, confirm the team and decision calendar, and schedule the first working session."
      : "Close the remaining questions, prepare the owner agreement, and confirm the team, start date, and notice-to-proceed requirements.",
    recommendationSteps: isEngagement
      ? ["Confirm the engagement scope and fee", "Schedule the first owner working session", "Approve the decision calendar and begin preconstruction"]
      : ["Review the remaining scope and basis questions together", "Authorize preparation of the owner contract draft", "Confirm the project team, start date, and notice-to-proceed requirements"],
    recommendedContractType,
    proposalIntelligence: emptyProposalIntelligence(),
    sourceSnapshot: {
      capturedAt: now.toISOString(),
      estimateTemplateVersion: estimate.templateVersion,
      estimateStatus: estimate.status,
      estimateSavedAt: estimate.savedAt || "",
      estimateContractValue: summary.contractValue,
      estimateScopeCount: summary.budgetRollups.length,
      bidPackageCount: bidPackages.length,
      receivedQuoteCount,
      reviewedQuoteCount,
      selectedQuoteCount,
      unselectedBidPackageCount,
      contactLinked: Boolean(input.contact),
      estimateDurationMonths: Number(estimate.projectInputs.projectDurationMonths || 0),
      estimateStartDate: String(data.targetStartDate || data.expectedAwardDate || ""),
      selectedQuoteSignature: JSON.stringify(bidPackages.map(item => ({ id: item.id, basis: selectedProposalBid(item.normalized)?.basis || null })).sort((a, b) => a.id.localeCompare(b.id))),
      estimateCalculationSignature: JSON.stringify({ entries: estimate.entries, entryOverrides: estimate.entryOverrides, settings: estimate.settings, projectInputs: estimate.projectInputs }),
    },
    status: "Draft",
    issuedAt: "",
    issuedBy: "",
    issuedPdfKey: "",
    issuedPdfHash: "",
    issuedSnapshots: [],
    updatedAt: now.toISOString(),
    updatedBy: input.actor.name,
  };
}

export function refreshProposalSources(currentValue: unknown, refreshed: ProposalData) {
  const raw = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
    ? currentValue as Partial<ProposalData>
    : {};
  const keepWrittenVoice = !proposalNeedsVoiceMigration(raw);
  const current = normalizeProposalData(currentValue, refreshed);
  const scopeSections = mergeScopeSections(current.scopeSections, refreshed.scopeSections);
  const contractPrice = proposalScopeTotal(scopeSections);
  return normalizeProposalData({
    ...refreshed,
    brandVoiceVersion: MEFFORD_PROPOSAL_VOICE_VERSION,
    pricingVersion: PROPOSAL_PRICING_VERSION,
    revision: current.revision,
    ownerContactName: refreshed.ownerContactName || current.ownerContactName,
    ownerContactTitle: refreshed.ownerContactTitle || current.ownerContactTitle,
    ownerContactEmail: refreshed.ownerContactEmail || current.ownerContactEmail,
    ownerContactPhone: refreshed.ownerContactPhone || current.ownerContactPhone,
    title: keepWrittenVoice ? current.title : refreshed.title,
    subtitle: keepWrittenVoice ? current.subtitle : refreshed.subtitle,
    executiveSummary: keepWrittenVoice ? current.executiveSummary : refreshed.executiveSummary,
    projectUnderstanding: keepWrittenVoice ? current.projectUnderstanding : refreshed.projectUnderstanding,
    approachIntroduction: keepWrittenVoice ? current.approachIntroduction : refreshed.approachIntroduction,
    approachPhases: keepWrittenVoice ? current.approachPhases : refreshed.approachPhases,
    customerLogoFileId: current.customerLogoFileId || refreshed.customerLogoFileId,
    proposedProjectManagerEmail: current.proposedProjectManagerEmail,
    proposedSuperintendentEmail: current.proposedSuperintendentEmail,
    teamMembers: current.teamMembers,
    visuals: current.visuals,
    scopeSections,
    contractPrice,
    designStartupGmp: current.designStartupGmpManual ? current.designStartupGmp : designStartupGmpForPrice(contractPrice),
    designStartupGmpManual: current.designStartupGmpManual,
    designStartupServices: current.designStartupServices.length ? current.designStartupServices : refreshed.designStartupServices,
    showSectionPricing: current.showSectionPricing,
    targetStartDate: current.targetStartDate && current.targetStartDate !== current.sourceSnapshot.estimateStartDate ? current.targetStartDate : refreshed.targetStartDate,
    durationMonths: current.durationMonths && current.durationMonths !== current.sourceSnapshot.estimateDurationMonths ? current.durationMonths : refreshed.durationMonths,
    scheduleNarrative: keepWrittenVoice ? current.scheduleNarrative : refreshed.scheduleNarrative,
    scheduleMilestones: current.scheduleMilestones.length ? current.scheduleMilestones : refreshed.scheduleMilestones,
    paymentTerms: keepWrittenVoice ? current.paymentTerms : refreshed.paymentTerms,
    depositPercent: current.depositPercent,
    assumptions: keepWrittenVoice ? current.assumptions : refreshed.assumptions,
    exclusions: keepWrittenVoice ? [...new Set([...refreshed.exclusions, ...current.exclusions])] : refreshed.exclusions,
    nextSteps: keepWrittenVoice ? current.nextSteps : refreshed.nextSteps,
    recommendationSteps: keepWrittenVoice ? current.recommendationSteps : refreshed.recommendationSteps,
    recommendedContractType: refreshed.recommendedContractType || current.recommendedContractType,
    proposalIntelligence: current.proposalIntelligence,
    status: current.status,
    issuedAt: current.issuedAt,
    issuedBy: current.issuedBy,
    issuedPdfKey: current.issuedPdfKey,
    issuedPdfHash: current.issuedPdfHash,
    issuedSnapshots: current.issuedSnapshots,
  }, refreshed);
}

export function normalizeProposalData(value: unknown, fallback?: ProposalData): ProposalData {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value as Partial<ProposalData> }
    : {};
  delete (source as Record<string, unknown>).wordRoundTrip;
  const base = fallback ?? emptyProposalData();
  const packetType = isProposalPacketType(source.packetType) ? source.packetType : base.packetType;
  const status = ["Draft", "Ready For Review", "Approved To Send", "Issued"].includes(String(source.status))
    ? source.status as ProposalData["status"]
    : base.status;
  const targetStartDate = String(source.targetStartDate ?? base.targetStartDate ?? "");
  const durationMonths = Math.max(0, Number(source.durationMonths ?? base.durationMonths ?? 0));
  const scheduleMilestones = alignScheduleMilestonesToDuration(
    normalizeScheduleMilestones(source.scheduleMilestones, base.scheduleMilestones),
    targetStartDate,
    durationMonths,
  );
  const contractPrice = Math.max(0, roundMoney(source.contractPrice ?? base.contractPrice ?? 0));
  const recommendedContractType = packetType === "Construction Proposal"
    ? normalizeOwnerContractType(source.recommendedContractType)
      || normalizeOwnerContractType(base.recommendedContractType)
      || "Plan & Spec Lump Sum"
    : String(source.recommendedContractType || base.recommendedContractType || "Owner Contract");
  const designStartupGmpManual = source.designStartupGmpManual === true
    || (source.designStartupGmpManual === undefined && base.designStartupGmpManual === true);
  const automaticDesignStartupGmp = designStartupGmpForPrice(contractPrice);
  const designStartupGmp = Math.min(contractPrice, Math.max(0, roundMoney(
    designStartupGmpManual
      ? source.designStartupGmp ?? base.designStartupGmp ?? automaticDesignStartupGmp
      : automaticDesignStartupGmp,
  )));
  return {
    ...base,
    ...source,
    pricingVersion: PROPOSAL_PRICING_VERSION,
    packetType,
    status,
    revision: Math.max(1, Number(source.revision || base.revision || 1)),
    contractPrice,
    designStartupGmp,
    designStartupGmpManual,
    designStartupServices: normalizeDesignStartupServices(
      source.designStartupServices,
      base.designStartupServices?.length ? base.designStartupServices : DEFAULT_DESIGN_STARTUP_SERVICES.map((service) => ({ ...service })),
    ),
    targetStartDate,
    durationMonths,
    depositPercent: Math.min(100, Math.max(0, Number(source.depositPercent ?? base.depositPercent ?? 0))),
    showSectionPricing: source.showSectionPricing === true,
    customerLogoFileId: positiveInteger(source.customerLogoFileId ?? base.customerLogoFileId),
    approachPhases: normalizePhases(source.approachPhases, base.approachPhases),
    teamMembers: normalizeTeamMembers(source.teamMembers, base.teamMembers),
    visuals: normalizeVisuals(source.visuals, base.visuals),
    scopeSections: normalizeScopes(source.scopeSections, base.scopeSections),
    scheduleMilestones,
    assumptions: normalizeTextArray(source.assumptions, base.assumptions),
    exclusions: normalizeTextArray(source.exclusions, base.exclusions),
    recommendationSteps: normalizeTextArray(source.recommendationSteps, base.recommendationSteps).slice(0, 8),
    recommendedContractType,
    proposalIntelligence: normalizeProposalIntelligence(source.proposalIntelligence, base.proposalIntelligence),
    sourceSnapshot: normalizeSourceSnapshot(source.sourceSnapshot, base.sourceSnapshot),
    issuedSnapshots: Array.isArray(source.issuedSnapshots) ? source.issuedSnapshots : base.issuedSnapshots,
  };
}

export function proposalIssueErrors(data: ProposalData) {
  const errors: string[] = [];
  const estimateReady = ["Ready For Review", "Approved", "Awarded", "Proposal Submitted"]
    .includes(data.sourceSnapshot.estimateStatus);
  if (!data.projectName.trim()) errors.push("Project name");
  if (!data.ownerName.trim()) errors.push("Owner / client");
  if (!data.publicBid && !data.ownerContactName.trim()) errors.push("Owner contact");
  if (!data.projectLocation.trim()) errors.push("Project location");
  if (!data.targetStartDate.trim() || !proposalTimelineEndDate(data.targetStartDate, data.durationMonths || 1)) errors.push("Valid target start date");
  if (!(data.durationMonths > 0)) errors.push("Actual project duration");
  if (!estimateReady) errors.push("Estimate ready for owner issue");
  if (!data.executiveSummary.trim()) errors.push("The job as we see it");
  if (!data.projectUnderstanding.trim()) errors.push("Project understanding");
  if (!data.scopeSections.some((item) => item.included && item.description.trim())) errors.push("Included scope");
  if (data.packetType === "Construction Proposal" && data.sourceSnapshot.unselectedBidPackageCount > 0) errors.push("Select proposal basis for every quoted bid package");
  if (!(data.contractPrice > 0)) errors.push(data.packetType === "Construction Proposal" ? "Contract price" : "Engagement fee");
  if (isDesignBuildProposal(data) && !(data.designStartupGmp > 0)) errors.push("Design and permitting startup GMP");
  if (isDesignBuildProposal(data) && !data.designStartupServices.some((service) => service.included && service.description.trim())) errors.push("Design and permitting startup services");
  if (!data.validThrough.trim()) errors.push("Valid-through date");
  if (!data.paymentTerms.trim()) errors.push("Payment terms");
  if (!data.recommendationSteps.length) errors.push("Recommended next steps");
  const includedMilestones = data.scheduleMilestones.filter((item) => item.included);
  const plannedFinish = proposalTimelineEndDate(data.targetStartDate, data.durationMonths);
  if (!includedMilestones.length) errors.push("Proposed schedule");
  else if (plannedFinish && (includedMilestones[0].startDate !== data.targetStartDate || includedMilestones.at(-1)?.endDate !== plannedFinish)) errors.push("Schedule aligned to the full project duration");
  if (data.proposalIntelligence.status === "Draft") errors.push("Human approval of AI-assisted proposal language");
  if (data.visuals.filter((item) => item.included).length > 20) errors.push("Proposal visuals limited to 20 files");
  if (data.visuals.some((item) => item.included && item.kind === "Drawing PDF" && !/^(?:all|\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*)$/i.test(item.pageSelection.trim()))) errors.push("Valid drawing page selections");
  return errors;
}

function buildScopeSections(
  rollups: EstimateRollup[],
  packages: Array<BidPackageSource & { normalized: BidPackageData }>,
) {
  const groups = new Map<string, ProposalScopeSection>();
  for (const rollup of rollups) {
    const key = rollup.division;
    const current = groups.get(key) ?? {
      id: `SCOPE-${key.replace(/[^A-Za-z0-9]+/g, "-")}`,
      title: key.replace(/^\d+\s*-\s*/, ""),
      description: "",
      amount: 0,
      included: true,
      sourceLabel: "Estimate",
      sourceRevisionId: "",
    };
    current.amount = roundMoney(current.amount + rollup.amount);
    current.description = uniqueSentences([
      current.description,
      rollup.description,
    ]).join("; ");
    groups.set(key, current);
  }

  for (const item of packages) {
    const divisionCode = String(item.normalized.costCode || "").slice(0, 2);
    const matchingKey = [...groups.keys()].find((key) => key.startsWith(divisionCode.padStart(3, "0")) || key.startsWith(divisionCode));
    const key = matchingKey || `Bid Scope - ${item.normalized.trade || item.title}`;
    const current = groups.get(key) ?? {
      id: `SCOPE-${item.id}`,
      title: item.normalized.trade || item.title,
      description: "",
      amount: roundMoney(item.normalized.budgetAmount || 0),
      included: true,
      sourceLabel: "Bid Management",
      sourceRevisionId: "",
    };
    const basis = selectedProposalBid(item.normalized)?.basis;
    const estimateDescription = current.description.trim().toLowerCase() === current.title.trim().toLowerCase()
      ? ""
      : current.description;
    current.description = uniqueSentences([
      estimateDescription,
      basis?.ownerScopeDraft || item.normalized.scopeDescription,
    ]).join("; ");
    const quoteCount = item.normalized.bidders.filter((bidder) => latestBid(bidder)).length;
    current.sourceLabel = basis
      ? `${current.sourceLabel.includes("Estimate") ? "Estimate + " : ""}Selected Quote · ${basis.vendorName} R${basis.bidRevision}`
      : quoteCount
        ? `${current.sourceLabel.includes("Estimate") ? "Estimate + " : ""}${quoteCount} Quote${quoteCount === 1 ? "" : "s"} Awaiting Selection`
      : current.sourceLabel;
    current.sourceRevisionId = [...new Set([
      ...current.sourceRevisionId.split("|").filter(Boolean),
      basis?.bidRevisionId || "",
    ].filter(Boolean))].sort().join("|");
    groups.set(key, current);
  }

  return [...groups.values()]
    .filter((item) => item.amount !== 0 || item.description.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
}

function defaultApproachPhases(designBuild: boolean, isEngagement: boolean): ProposalApproachPhase[] {
  const context = designBuild
    ? "design decisions, trade input, budget, procurement, schedule, and owner operations"
    : "drawings, bid coverage, owner operations, procurement, safety, schedule, and cost";
  return [
    { id: "APPROACH-01", title: MEFFORD_CORE_VALUES[0], description: `We keep ${context} aligned and own the hard handoffs from the first decision through turnover.`, included: true },
    { id: "APPROACH-02", title: MEFFORD_CORE_VALUES[1], description: "We keep one current version of scope, cost, schedule, risk, and open decisions—and share changes early.", included: true },
    { id: "APPROACH-03", title: MEFFORD_CORE_VALUES[2], description: isEngagement ? "We test the options early and turn each step into a useful owner decision." : "Changes come with facts, options, ownership, and a recommended next move.", included: true },
    { id: "APPROACH-04", title: MEFFORD_CORE_VALUES[3], description: "We challenge the plan and improve it as the team learns, through closeout and beyond.", included: true },
  ];
}

function emptyProposalData(): ProposalData {
  return {
    brandVoiceVersion: MEFFORD_PROPOSAL_VOICE_VERSION,
    pricingVersion: PROPOSAL_PRICING_VERSION,
    opportunityId: "",
    packetType: "Construction Proposal",
    revision: 1,
    projectName: "",
    projectLocation: "",
    ownerName: "",
    ownerContactName: "",
    ownerContactTitle: "",
    ownerContactEmail: "",
    ownerContactPhone: "",
    proposalDate: "",
    validThrough: "",
    preparedBy: "",
    preparedByEmail: "",
    deliveryMethod: "Unknown",
    projectType: "Commercial",
    title: "Project Proposal",
    subtitle: "A project plan—and a team prepared to stay with it",
    customerLogoFileId: 0,
    executiveSummary: "",
    projectUnderstanding: "",
    proposedProjectManagerEmail: "",
    proposedSuperintendentEmail: "",
    teamMembers: [],
    approachIntroduction: "",
    approachPhases: [],
    visuals: [],
    scopeSections: [],
    contractPrice: 0,
    designStartupGmp: 0,
    designStartupGmpManual: false,
    designStartupServices: DEFAULT_DESIGN_STARTUP_SERVICES.map((service) => ({ ...service })),
    showSectionPricing: false,
    targetStartDate: "",
    durationMonths: 0,
    scheduleNarrative: "",
    scheduleMilestones: [],
    paymentTerms: "",
    depositPercent: 0,
    assumptions: [],
    exclusions: [],
    nextSteps: "",
    recommendationSteps: [],
    recommendedContractType: "Owner Contract",
    proposalIntelligence: emptyProposalIntelligence(),
    sourceSnapshot: {
      capturedAt: "",
      estimateTemplateVersion: "",
      estimateStatus: "Draft",
      estimateSavedAt: "",
      estimateContractValue: 0,
      estimateScopeCount: 0,
      bidPackageCount: 0,
      receivedQuoteCount: 0,
      reviewedQuoteCount: 0,
      selectedQuoteCount: 0,
      unselectedBidPackageCount: 0,
      contactLinked: false,
    },
    status: "Draft",
    issuedAt: "",
    issuedBy: "",
    issuedPdfKey: "",
    issuedPdfHash: "",
    issuedSnapshots: [],
    updatedAt: "",
    updatedBy: "",
  };
}

function normalizePhases(value: unknown, fallback: ProposalApproachPhase[]) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 4).map((item, index) => {
    const phase = item && typeof item === "object" ? item as Partial<ProposalApproachPhase> : {};
    return {
      id: String(phase.id || `APPROACH-${String(index + 1).padStart(2, "0")}`),
      title: String(phase.title || `Phase ${index + 1}`),
      description: String(phase.description || ""),
      included: phase.included !== false,
    };
  });
}

function normalizeDesignStartupServices(value: unknown, fallback: ProposalDesignStartupService[]) {
  if (!Array.isArray(value)) return fallback.map((service) => ({ ...service }));
  return value.slice(0, 8).map((item, index) => {
    const service = object(item);
    return {
      id: cleanText(service.id || `DESIGN-STARTUP-${index + 1}`, 120),
      title: cleanText(service.title || `Startup Service ${index + 1}`, 160),
      description: cleanText(service.description, 900),
      included: service.included !== false,
    };
  });
}

function normalizeTeamMembers(value: unknown, fallback: ProposalTeamMember[]) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 20).flatMap((item): ProposalTeamMember[] => {
    const member = object(item);
    const email = String(member.employeeEmail || "").trim().toLowerCase();
    if (!email) return [];
    return [{
      employeeEmail: email,
      displayName: cleanText(member.displayName, 160),
      companyTitle: cleanText(member.companyTitle, 160),
      proposalRoleLabel: cleanText(member.proposalRoleLabel, 160),
      professionalSummary: cleanText(member.professionalSummary, 3_000),
      credentials: normalizeTextArray(member.credentials, []).slice(0, 20),
      priorExperience: normalizeTextArray(member.priorExperience, []).slice(0, 20),
      headshotFileId: positiveInteger(member.headshotFileId),
      leadershipProfile: member.leadershipProfile === true,
      includeInProposal: member.includeInProposal !== false,
      experience: normalizeExperience(member.experience),
    }];
  });
}

function normalizeExperience(value: unknown): ProposalExperienceSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item, index) => {
    const experience = object(item);
    return {
      id: cleanText(experience.id || `EXPERIENCE-${index + 1}`, 220),
      projectId: cleanText(experience.projectId, 120),
      projectName: cleanText(experience.projectName, 200),
      projectLocation: cleanText(experience.projectLocation, 240),
      role: cleanText(experience.role, 160),
      projectType: cleanText(experience.projectType, 160),
      completionDate: cleanText(experience.completionDate, 40),
      summary: cleanText(experience.summary, 2_000),
      photoFileIds: Array.isArray(experience.photoFileIds) ? experience.photoFileIds.map(positiveInteger).filter(Boolean).slice(0, 6) : [],
    };
  });
}

function normalizeScheduleMilestones(value: unknown, fallback: ProposalScheduleMilestone[]) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 16).map((item, index) => {
    const milestone = object(item);
    return {
      id: cleanText(milestone.id || `MILESTONE-${index + 1}`, 120),
      title: cleanText(milestone.title || `Milestone ${index + 1}`, 180),
      startDate: cleanText(milestone.startDate, 40),
      endDate: cleanText(milestone.endDate, 40),
      durationDays: Math.max(0, Math.floor(Number(milestone.durationDays || 0))),
      phase: cleanText(milestone.phase, 160),
      sourceReferences: normalizeTextArray(milestone.sourceReferences, []).slice(0, 20),
      assumption: milestone.assumption !== false,
      included: milestone.included !== false,
    };
  });
}

function normalizeProposalIntelligence(value: unknown, fallback: ProposalIntelligence): ProposalIntelligence {
  const input = object(value);
  const status = ["Not Requested", "Connection Required", "Draft", "Approved"].includes(String(input.status))
    ? String(input.status) as ProposalIntelligence["status"] : fallback.status;
  return {
    status,
    model: cleanText(input.model || fallback.model, 120),
    generatedAt: cleanText(input.generatedAt || fallback.generatedAt, 50),
    generatedBy: cleanText(input.generatedBy || fallback.generatedBy, 160),
    approvedAt: status === "Approved" ? cleanText(input.approvedAt || fallback.approvedAt, 50) : "",
    approvedBy: status === "Approved" ? cleanText(input.approvedBy || fallback.approvedBy, 160) : "",
    citations: Array.isArray(input.citations) ? input.citations.slice(0, 40).map((item) => { const citation = object(item); return { sourceId: cleanText(citation.sourceId, 180), label: cleanText(citation.label, 260), detail: cleanText(citation.detail, 1_000) }; }).filter((item) => item.sourceId) : fallback.citations,
    sourceFileIds: Array.isArray(input.sourceFileIds) ? input.sourceFileIds.map(positiveInteger).filter(Boolean).slice(0, 60) : fallback.sourceFileIds,
    openQuestions: normalizeTextArray(input.openQuestions, fallback.openQuestions).slice(0, 20),
  };
}

export function defaultScheduleMilestones(startDate: string, durationMonths: number, designBuild: boolean): ProposalScheduleMilestone[] {
  const labels = designBuild
    ? ["Contract And Kickoff", "Design Alignment And Pricing", "Permits And Long-Lead Release", "Mobilization And Sitework", "Structure And Enclosure", "Building Systems And Interiors", "Commissioning And Training", "Substantial Completion"]
    : ["Contract And Kickoff", "Submittals And Procurement", "Permits And Long-Lead Release", "Mobilization And Sitework", "Structure And Enclosure", "Building Systems And Interiors", "Commissioning And Training", "Substantial Completion"];
  const timelineEndDate = proposalTimelineEndDate(startDate, durationMonths);
  const startTime = isoDateTime(startDate);
  const endTime = isoDateTime(timelineEndDate);
  const days = startTime !== null && endTime !== null && endTime > startTime
    ? Math.round((endTime - startTime) / 86_400_000)
    : durationMonths > 0 ? Math.max(1, Math.round(durationMonths * 30.4375)) : 0;
  return labels.map((title, index) => {
    const startOffset = Math.round((days * index) / labels.length);
    const endOffset = Math.round((days * (index + 1)) / labels.length);
    const phase = index === labels.length - 1 ? "Turnover" : index === 2 ? "Procurement" : designBuild && index < 2 ? "Preconstruction" : "Construction";
    return { id: `MILESTONE-${index + 1}`, title, startDate: timelineEndDate ? addDays(startDate, startOffset) : "", endDate: timelineEndDate ? (index === labels.length - 1 ? timelineEndDate : addDays(startDate, endOffset)) : "", durationDays: days ? Math.max(1, endOffset - startOffset) : 0, phase, sourceReferences: [], assumption: true, included: true };
  });
}

export function proposalTimelineEndDate(startDate: string, durationMonths: number) {
  if (!validIsoDate(startDate) || !(durationMonths > 0)) return "";
  const [year, month, day] = startDate.split("-").map(Number);
  const wholeMonths = Math.floor(durationMonths);
  const fractionalDays = Math.round((durationMonths - wholeMonths) * 30.4375);
  const targetMonth = month - 1 + wholeMonths;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay) + fractionalDays));
  return result.toISOString().slice(0, 10);
}

export function alignScheduleMilestonesToDuration(
  milestones: ProposalScheduleMilestone[],
  startDate: string,
  durationMonths: number,
) {
  const targetEndDate = proposalTimelineEndDate(startDate, durationMonths);
  if (!targetEndDate || !milestones.length) return milestones.map((item) => ({ ...item }));
  const targetStart = isoDateTime(startDate);
  const targetEnd = isoDateTime(targetEndDate);
  if (targetStart === null || targetEnd === null || targetEnd <= targetStart) return milestones.map((item) => ({ ...item }));

  const includedIndexes = milestones.flatMap((item, index) => item.included ? [index] : []);
  if (!includedIndexes.length) return milestones.map((item) => ({ ...item }));
  const sourceDates = milestones.filter((item) => item.included).flatMap((item) => [isoDateTime(item.startDate), isoDateTime(item.endDate)]).filter((value): value is number => value !== null);
  const sourceStart = sourceDates.length ? Math.min(...sourceDates) : targetStart;
  const sourceEnd = sourceDates.length ? Math.max(...sourceDates) : targetEnd;
  const sourceSpan = Math.max(1, sourceEnd - sourceStart);
  const targetSpan = targetEnd - targetStart;
  const oneDay = 86_400_000;

  const aligned = milestones.map((item, index) => {
    const fallbackStartRatio = index / Math.max(1, milestones.length);
    const fallbackEndRatio = (index + 1) / Math.max(1, milestones.length);
    const itemStart = isoDateTime(item.startDate);
    const itemEnd = isoDateTime(item.endDate);
    const startRatio = itemStart === null ? fallbackStartRatio : (itemStart - sourceStart) / sourceSpan;
    const endRatio = itemEnd === null ? fallbackEndRatio : (itemEnd - sourceStart) / sourceSpan;
    const alignedStart = targetStart + Math.max(0, Math.min(1, startRatio)) * targetSpan;
    const alignedEnd = targetStart + Math.max(0, Math.min(1, endRatio)) * targetSpan;
    const nextStart = new Date(alignedStart).toISOString().slice(0, 10);
    const nextEnd = new Date(Math.max(alignedStart + oneDay, alignedEnd)).toISOString().slice(0, 10);
    return { ...item, startDate: nextStart, endDate: nextEnd, durationDays: Math.max(1, Math.round((Math.max(alignedStart + oneDay, alignedEnd) - alignedStart) / oneDay)) };
  });

  const firstIndex = includedIndexes[0];
  const lastIndex = includedIndexes.at(-1)!;
  aligned[firstIndex] = { ...aligned[firstIndex], startDate };
  aligned[lastIndex] = { ...aligned[lastIndex], endDate: targetEndDate };
  aligned[firstIndex].durationDays = dateSpanDays(aligned[firstIndex].startDate, aligned[firstIndex].endDate);
  aligned[lastIndex].durationDays = dateSpanDays(aligned[lastIndex].startDate, aligned[lastIndex].endDate);
  return aligned;
}

function emptyProposalIntelligence(): ProposalIntelligence {
  return { status: "Not Requested", model: "", generatedAt: "", generatedBy: "", approvedAt: "", approvedBy: "", citations: [], sourceFileIds: [], openQuestions: [] };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function cleanText(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeScopes(value: unknown, fallback: ProposalScopeSection[]) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item, index) => {
    const scope = item && typeof item === "object" ? item as Partial<ProposalScopeSection> : {};
    return {
      id: String(scope.id || `SCOPE-${String(index + 1).padStart(2, "0")}`),
      title: String(scope.title || `Scope ${index + 1}`),
      description: String(scope.description || ""),
      amount: roundMoney(scope.amount || 0),
      included: scope.included !== false,
      sourceLabel: String(scope.sourceLabel || "Manual"),
      sourceRevisionId: String(scope.sourceRevisionId || ""),
    };
  });
}

function normalizeVisuals(value: unknown, fallback: ProposalVisual[]) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<number>();
  const visuals = value.slice(0, 24).flatMap((item, index) => {
    const visual = item && typeof item === "object" ? item as Partial<ProposalVisual> : {};
    const fileId = Number(visual.fileId || 0);
    if (!Number.isInteger(fileId) || fileId <= 0 || seen.has(fileId)) return [];
    seen.add(fileId);
    const kind: ProposalVisual["kind"] = visual.kind === "Drawing PDF" || String(visual.contentType || "").toLowerCase() === "application/pdf" ? "Drawing PDF" : "Photo";
    const placement = PROPOSAL_VISUAL_PLACEMENTS.includes(visual.placement as ProposalVisualPlacement)
      ? visual.placement as ProposalVisualPlacement
      : kind === "Drawing PDF" ? "Appendix" : "After Project Read";
    return [{
      id: String(visual.id || `VISUAL-${fileId}-${index + 1}`).slice(0, 100),
      fileId,
      kind,
      name: String(visual.name || `Proposal Visual ${index + 1}`).slice(0, 240),
      contentType: kind === "Drawing PDF" ? "application/pdf" : String(visual.contentType || "image/jpeg").slice(0, 100),
      placement,
      caption: String(visual.caption || "").slice(0, 500),
      pageSelection: kind === "Drawing PDF" ? String(visual.pageSelection || "All").slice(0, 120) : "",
      included: visual.included !== false,
    }];
  });
  if (!visuals.some((visual) => visual.kind === "Photo" && visual.placement === "Project Photo")) {
    const legacyProjectPhoto = visuals.findIndex((visual) => visual.kind === "Photo" && visual.placement === "After Project Read");
    if (legacyProjectPhoto >= 0) visuals[legacyProjectPhoto] = { ...visuals[legacyProjectPhoto], placement: "Project Photo" };
  }
  return visuals.map((visual): ProposalVisual => visual.kind === "Drawing PDF" && visual.placement === "Appendix"
    ? { ...visual, placement: "Design Drawing" as const }
    : visual);
}

function normalizeSourceSnapshot(value: unknown, fallback: ProposalSourceSnapshot) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<ProposalSourceSnapshot>
    : {};
  return {
    ...fallback,
    ...source,
    estimateContractValue: roundMoney(source.estimateContractValue ?? fallback.estimateContractValue ?? 0),
    estimateScopeCount: Number(source.estimateScopeCount ?? fallback.estimateScopeCount ?? 0),
    bidPackageCount: Number(source.bidPackageCount ?? fallback.bidPackageCount ?? 0),
    receivedQuoteCount: Number(source.receivedQuoteCount ?? fallback.receivedQuoteCount ?? 0),
    reviewedQuoteCount: Number(source.reviewedQuoteCount ?? fallback.reviewedQuoteCount ?? 0),
    selectedQuoteCount: Number(source.selectedQuoteCount ?? fallback.selectedQuoteCount ?? 0),
    unselectedBidPackageCount: Number(source.unselectedBidPackageCount ?? fallback.unselectedBidPackageCount ?? 0),
    contactLinked: source.contactLinked === true,
  };
}

function normalizeTextArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function mergeScopeSections(current: ProposalScopeSection[], refreshed: ProposalScopeSection[]) {
  return refreshed.map((item) => {
    const prior = current.find((candidate) => candidate.id === item.id);
    const sourceChanged = Boolean(item.sourceRevisionId) && item.sourceRevisionId !== prior?.sourceRevisionId;
    return prior ? { ...item, description: sourceChanged ? item.description : prior.description || item.description, included: prior.included } : item;
  });
}

function splitLines(value: string) {
  return value.split(/\r?\n|\s*[•]\s*/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function uniqueSentences(values: string[]) {
  const output: string[] = [];
  for (const value of values.flatMap((item) => String(item || "").split(/\s*;\s*/))) {
    const clean = value.trim();
    if (clean && !output.some((item) => item.toLowerCase() === clean.toLowerCase())) output.push(clean);
  }
  return output;
}

function easternDate(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDateTime(value) !== null;
}

function isoDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateSpanDays(startDate: string, endDate: string) {
  const start = isoDateTime(startDate);
  const end = isoDateTime(endDate);
  return start === null || end === null ? 1 : Math.max(1, Math.round((end - start) / 86_400_000));
}
