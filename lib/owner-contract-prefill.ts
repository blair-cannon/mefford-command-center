import {
  calculateEstimateSummary,
  normalizeEstimateData,
  type EstimateRollup,
} from "../app/estimate-template";
import { formatMoney, moneyDecimal } from "./money";

export type OwnerContractFieldSourceKind = "Project" | "Estimate" | "Proposal" | "Standard" | "Manual";

export type OwnerContractFieldSource = {
  kind: OwnerContractFieldSourceKind;
  label: string;
  recordId?: string;
};

export type OwnerContractPrefillSummary = {
  projectFields: number;
  estimateFields: number;
  proposalFields: number;
  standardFields: number;
  scopeSections: number;
  budgetLines: number;
  scheduleMilestones: number;
};

export type OwnerContractPrefill = {
  fields: Record<string, string>;
  sources: Record<string, OwnerContractFieldSource>;
  summary: OwnerContractPrefillSummary;
};

export type OwnerContractPrefillProject = {
  number?: string;
  name?: string;
  site?: string;
  ownerName?: string;
  ownerContractDate?: string;
  architect?: string;
  projectType?: string;
  contractAmount?: string | number;
  startDate?: string;
  substantialDate?: string;
  finalDate?: string;
  projectManager?: string;
  superintendent?: string;
  paymentTerms?: string;
  retainageInitialPercent?: string | number;
  retainageAfterHalfPercent?: string | number;
};

export type OwnerContractPrefillContact = {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

type BudgetSource = {
  code?: unknown;
  division?: unknown;
  description?: unknown;
  amount?: unknown;
  originalBudget?: unknown;
};

type ScopeSource = {
  title: string;
  description: string;
  amount: number;
};

type ScheduleSource = {
  title: string;
  startDate: string;
  endDate: string;
  phase: string;
  assumption: boolean;
};

const PROJECT_SOURCE: OwnerContractFieldSource = { kind: "Project", label: "Project Setup" };
const STANDARD_SOURCE: OwnerContractFieldSource = { kind: "Standard", label: "Contract Standard" };

const amountFieldsByDivisions: Array<{ fields: string[]; divisions: string[] }> = [
  { fields: ["GENERAL_CONDITIONS_INCLUDED_AMOUNT", "GENERAL_CONDITIONS_AND_TEMPORARY_FACILITIES_AMOUNT", "GENERAL_REQUIREMENTS_AND_TEMPORARY_FACILITIES_AMOUNT"], divisions: ["01"] },
  { fields: ["EXISTING_CONDITIONS_AMOUNT", "EXISTING_CONDITIONS_AND_DEMOLITION_AMOUNT"], divisions: ["02"] },
  { fields: ["CONCRETE_AMOUNT"], divisions: ["03"] },
  { fields: ["MASONRY_AMOUNT"], divisions: ["04"] },
  { fields: ["CONCRETE_AND_MASONRY_AMOUNT"], divisions: ["03", "04"] },
  { fields: ["METALS_AMOUNT", "STRUCTURAL_STEEL_AND_MISCELLANEOUS_METALS_AMOUNT"], divisions: ["05"] },
  { fields: ["WOOD_PLASTICS_AND_COMPOSITES_AMOUNT", "CARPENTRY_FRAMING_AND_COMPOSITES_AMOUNT"], divisions: ["06"] },
  { fields: ["THERMAL_AND_MOISTURE_PROTECTION_AMOUNT", "BUILDING_ENVELOPE_INSULATION_AND_ROOFING_AMOUNT"], divisions: ["07"] },
  { fields: ["OPENINGS_AMOUNT", "DOORS_FRAMES_WINDOWS_AND_GLAZING_AMOUNT"], divisions: ["08"] },
  { fields: ["FINISHES_AMOUNT", "INTERIOR_FINISHES_AMOUNT"], divisions: ["09"] },
  { fields: ["SPECIALTIES_AMOUNT"], divisions: ["10"] },
  { fields: ["EQUIPMENT_AMOUNT"], divisions: ["11"] },
  { fields: ["FURNISHINGS_AMOUNT"], divisions: ["12"] },
  { fields: ["SPECIALTIES_EQUIPMENT_AND_FURNISHINGS_AMOUNT"], divisions: ["10", "11", "12"] },
  { fields: ["SPECIAL_CONSTRUCTION_AMOUNT"], divisions: ["13"] },
  { fields: ["CONVEYING_EQUIPMENT_AMOUNT"], divisions: ["14"] },
  { fields: ["CONVEYING_AND_SPECIAL_CONSTRUCTION_AMOUNT", "SPECIAL_CONSTRUCTION_AND_CONVEYING_AMOUNT"], divisions: ["13", "14"] },
  { fields: ["FIRE_SUPPRESSION_AMOUNT"], divisions: ["21"] },
  { fields: ["PLUMBING_AMOUNT"], divisions: ["22"] },
  { fields: ["FIRE_SUPPRESSION_AND_PLUMBING_AMOUNT"], divisions: ["21", "22"] },
  { fields: ["HVAC_AMOUNT", "HVAC_AND_CONTROLS_AMOUNT"], divisions: ["23"] },
  { fields: ["INTEGRATED_AUTOMATION_AMOUNT"], divisions: ["25"] },
  { fields: ["ELECTRICAL_AMOUNT"], divisions: ["26"] },
  { fields: ["COMMUNICATIONS_AMOUNT"], divisions: ["27"] },
  { fields: ["ELECTRONIC_SAFETY_AND_SECURITY_AMOUNT"], divisions: ["28"] },
  { fields: ["ELECTRICAL_COMMUNICATIONS_AND_SECURITY_AMOUNT"], divisions: ["26", "27", "28"] },
  { fields: ["EARTHWORK_AMOUNT"], divisions: ["31"] },
  { fields: ["EXTERIOR_IMPROVEMENTS_AMOUNT"], divisions: ["32"] },
  { fields: ["UTILITIES_AMOUNT"], divisions: ["33"] },
  { fields: ["SITEWORK_EARTHWORK_AND_UTILITIES_AMOUNT"], divisions: ["31", "32", "33"] },
];

/**
 * Creates one contract-ready source map from Project, the linked CRM contact,
 * Estimating, and the latest owner proposal. It intentionally does not invent
 * legal terms: a contract blank remains open when none of those sources contains
 * a factual answer.
 */
export function buildOwnerContractPrefill(input: {
  baseFields?: Record<string, string>;
  project?: OwnerContractPrefillProject;
  estimate?: unknown;
  estimateRecordId?: string;
  proposal?: unknown;
  proposalRecordId?: string;
  contact?: OwnerContractPrefillContact | null;
  contactRecordId?: string;
  budgetRows?: BudgetSource[];
}) {
  const fields: Record<string, string> = {};
  const sources: Record<string, OwnerContractFieldSource> = {};
  const project = input.project || {};
  const estimateSource: OwnerContractFieldSource = {
    kind: "Estimate",
    label: "Approved Estimate",
    ...(input.estimateRecordId ? { recordId: input.estimateRecordId } : {}),
  };
  const proposalSource: OwnerContractFieldSource = {
    kind: "Proposal",
    label: "Owner Proposal",
    ...(input.proposalRecordId ? { recordId: input.proposalRecordId } : {}),
  };
  const contactSource: OwnerContractFieldSource = {
    kind: "Project",
    label: "CRM Contact",
    ...(input.contactRecordId ? { recordId: input.contactRecordId } : {}),
  };

  const put = (field: string, value: unknown, source: OwnerContractFieldSource, replace = false) => {
    const normalized = normalizeValue(value);
    if (!normalized || (!replace && fields[field]?.trim())) return;
    fields[field] = normalized;
    sources[field] = source;
  };
  const putMany = (keys: string[], value: unknown, source: OwnerContractFieldSource, replace = false) => {
    for (const key of keys) put(key, value, source, replace);
  };

  for (const [field, value] of Object.entries(input.baseFields || {})) put(field, value, STANDARD_SOURCE);
  addProjectFields(project, put, putMany, true);

  const rawEstimate = record(input.estimate);
  const hasEstimate = Object.keys(rawEstimate).length > 0;
  const estimate = hasEstimate ? normalizeEstimateData(rawEstimate) : null;
  const estimateSummary = estimate ? calculateEstimateSummary(estimate) : null;
  const estimateRollups = estimateSummary?.budgetRollups || [];
  const fallbackRollups = normalizeBudgetRows(input.budgetRows || []);
  const rollups = estimateRollups.length ? estimateRollups : fallbackRollups;
  if (estimate && estimateSummary) {
    const contractValue = money(estimateSummary.contractValue);
    const originalBudget = money(estimateSummary.originalBudget);
    const costOfWork = money(estimateSummary.directJobCost + estimateSummary.performanceBond);
    const contractorFee = money(estimateSummary.contractOnlyFees + estimateSummary.baseProfit + estimateSummary.technologyFee);
    putMany(["OWNER_TARGET_BUDGET", "OWNER_S_TOTAL_PROJECT_BUDGET", "OWNER_TOTAL_PROJECT_BUDGET", "GMP_AMOUNT", "LUMP_SUM_AMOUNT", "LUMP_SUM_CONTRACT_SUM", "TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT", "SMALL_PROJECT_CONTRACT_AMOUNT", "NTE_AMOUNT_OR_NOT_APPLICABLE", "ESTIMATED_COST_OF_THE_WORK", "EXTERNAL_CONTRACT_AMOUNT"], contractValue, estimateSource, true);
    put("COST_OF_THE_WORK_SUBTOTAL", costOfWork || originalBudget, estimateSource, true);
    putMany(["DESIGN_BUILDER_S_FEE", "DESIGN_BUILDER_OVERHEAD_AND_PROFIT_AMOUNT", "CONTRACTOR_OVERHEAD_AND_PROFIT_AMOUNT"], contractorFee, estimateSource, true);
    put("FEE_BASIS", "Fixed Fee From Approved Estimate", estimateSource, true);
    put("CONTRACTOR_FEE_PROFIT_PERCENTAGE", percent(estimate.settings.baseProfitRate * 100), estimateSource, true);
    put("PROJECT_MANAGER_STRAIGHT_TIME_HR", money(estimate.settings.projectManagerBillableRate), estimateSource, true);
    put("SUPERINTENDENT_STRAIGHT_TIME_HR", money(estimate.settings.superintendentBillableRate), estimateSource, true);
    const rateSchedule = [
      number(estimate.settings.projectManagerBillableRate) > 0 ? `Project Manager — ${formatMoney(estimate.settings.projectManagerBillableRate)} per hour` : "",
      number(estimate.settings.superintendentBillableRate) > 0 ? `Superintendent — ${formatMoney(estimate.settings.superintendentBillableRate)} per hour` : "",
    ].filter(Boolean).join("\n");
    put("TIME_AND_MATERIALS_RATE_SCHEDULE", rateSchedule, estimateSource, true);
    putMany(["APPROXIMATE_SIZE_AND_CAPACITY", "PROJECT_SIZE"], estimate.projectInputs.buildingSquareFeet > 0 ? `${formatNumber(estimate.projectInputs.buildingSquareFeet)} SF` : "", estimateSource, true);
    if (estimate.projectInputs.projectDurationMonths > 0) {
      put("CONTRACT_TIME_OR_DURATION", `${formatNumber(estimate.projectInputs.projectDurationMonths)} Months`, estimateSource, true);
    }
  }

  addEstimateBreakdown(rollups, estimateSummary, estimateSource, put, putMany);

  const proposal = record(input.proposal);
  const scopes = normalizeScopes(proposal.scopeSections);
  const milestones = normalizeMilestones(proposal.scheduleMilestones);
  const assumptions = textList(proposal.assumptions);
  const exclusions = textList(proposal.exclusions);
  const scopeNarrative = scopes.map((scope) => scope.description ? `${scope.title} — ${scope.description}` : scope.title).join("\n\n");
  const estimateScopeNarrative = rollups.map((rollup) => `${rollup.division.replace(/^\d+\s*-\s*/, "")} — ${rollup.description}`).join("\n");
  const finalScope = scopeNarrative || estimateScopeNarrative;

  if (Object.keys(proposal).length) {
    addProposalIdentity(proposal, proposalSource, put, putMany, project.site);
    const projectDescription = first(proposal.projectUnderstanding, proposal.executiveSummary);
    putMany(["PROJECT_DESCRIPTION", "PROJECT_PROGRAM_AND_INTENDED_USE"], projectDescription, proposalSource, true);
    putMany([
      "CONSTRUCTION_SCOPE_OF_WORK",
      "DESIGN_AND_CONSTRUCTION_SCOPE",
      "SCOPE_QUALITY_AND_PERFORMANCE_REQUIREMENTS",
      "TOTAL_LUMP_SUM_CONTRACT_SUM_INCLUDED_SCOPE_NOTES",
    ], finalScope, proposalSource, true);

    const assumptionsText = bulletText(assumptions);
    putMany([
      "ASSUMPTIONS_AND_CLARIFICATIONS",
      "BID_ASSUMPTIONS_AND_CLARIFICATIONS",
      "ACCEPTED_BID_QUALIFICATIONS_AND_SCOPE_LETTER",
      "POST_BID_CLARIFICATIONS_INCORPORATED_INTO_CONTRACT",
      "OTHER_ASSUMPTION_OR_CLARIFICATION",
    ], assumptionsText, proposalSource, true);
    const exclusionsText = bulletText(exclusions);
    putMany(["EXCLUSIONS", "CONSTRUCTION_EXCLUSIONS", "UNPRICED_OR_DEFERRED_SCOPE"], exclusionsText, proposalSource, true);
    exclusions.slice(0, 12).forEach((exclusion, index) => {
      put(`EXCLUSION_OR_DEFERRED_SCOPE_${index + 1}_EXCLUSION_OR_DEFERRED_SCOPE`, exclusion, proposalSource, true);
    });

    addProposalSchedule(proposal, milestones, proposalSource, put, putMany);
    addProposalDesignServices(proposal, proposalSource, put, putMany);
    addProposalBasisDocuments(proposal, proposalSource, put, putMany);
  } else if (finalScope) {
    putMany(["CONSTRUCTION_SCOPE_OF_WORK", "DESIGN_AND_CONSTRUCTION_SCOPE", "SCOPE_QUALITY_AND_PERFORMANCE_REQUIREMENTS", "TOTAL_LUMP_SUM_CONTRACT_SUM_INCLUDED_SCOPE_NOTES"], finalScope, estimateSource, true);
    if (estimate?.notes.trim()) putMany(["ASSUMPTIONS_AND_CLARIFICATIONS", "BID_ASSUMPTIONS_AND_CLARIFICATIONS", "OTHER_ASSUMPTION_OR_CLARIFICATION"], estimate.notes, estimateSource, true);
  }

  // The selected Sales Contact is the current source of truth for people and
  // delivery details. It supersedes proposal snapshots, while manual contract
  // edits remain protected by mergeOwnerContractPrefill.
  if (input.contact) addOwnerContactFields(input.contact, contactSource, put, putMany, true, project.site);

  // Final project setup wins for identity, approved dates, and assigned staff.
  addProjectFields(project, put, putMany, true);

  const counts = Object.values(sources).reduce((result, source) => {
    if (source.kind === "Project") result.projectFields += 1;
    if (source.kind === "Estimate") result.estimateFields += 1;
    if (source.kind === "Proposal") result.proposalFields += 1;
    if (source.kind === "Standard") result.standardFields += 1;
    return result;
  }, { projectFields: 0, estimateFields: 0, proposalFields: 0, standardFields: 0 });

  return {
    fields,
    sources,
    summary: {
      ...counts,
      scopeSections: scopes.length || rollups.length,
      budgetLines: rollups.length,
      scheduleMilestones: milestones.length,
    },
  } satisfies OwnerContractPrefill;
}

export function mergeOwnerContractPrefill(
  current: Record<string, string>,
  prefill: OwnerContractPrefill,
  manualFieldKeys: Iterable<string>,
  replaceAutomatic = false,
) {
  const manual = new Set(manualFieldKeys);
  const fields = { ...current };
  const sources: Record<string, OwnerContractFieldSource> = {};
  for (const [field, value] of Object.entries(prefill.fields)) {
    if (manual.has(field)) continue;
    if (!String(fields[field] || "").trim() || replaceAutomatic) fields[field] = value;
    if (fields[field] === value) sources[field] = prefill.sources[field];
  }
  for (const field of manual) sources[field] = { kind: "Manual", label: "Manual Override" };
  return { fields, sources };
}

function addProjectFields(
  project: OwnerContractPrefillProject,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  replace = false,
) {
  putMany(["PROJECT_NUMBER"], project.number, PROJECT_SOURCE, replace);
  putMany(["PROJECT_NAME", "PROJECT"], project.name, PROJECT_SOURCE, replace);
  put("PROJECT_NAME_AND_ADDRESS", [project.name, project.site].filter(Boolean).join(" · "), PROJECT_SOURCE, replace);
  put("PROJECT_SITE_ADDRESS", project.site, PROJECT_SOURCE, replace);
  putMany(["OWNER_LEGAL_NAME"], project.ownerName, PROJECT_SOURCE, replace);
  put("OWNER_LEGAL_NAME_AND_STATUS", project.ownerName, PROJECT_SOURCE, replace);
  putMany(["EFFECTIVE_DATE", "AGREEMENT_EFFECTIVE_DATE", "DOCUMENT_EFFECTIVE_DATE", "ORIGINAL_AGREEMENT_DATE", "EXHIBIT_A_EFFECTIVE_DATE"], project.ownerContractDate, PROJECT_SOURCE, replace);
  putMany(["CONSTRUCTION_COMMENCEMENT_DATE", "NOTICE_TO_PROCEED_DATE", "DESIGN_COMMENCEMENT"], project.startDate, PROJECT_SOURCE, replace);
  putMany(["SUBSTANTIAL_COMPLETION_DATE", "SUBSTANTIAL_COMPLETION_DATE_OR_TBD"], project.substantialDate, PROJECT_SOURCE, replace);
  putMany(["FINAL_COMPLETION_DATE", "FINAL_COMPLETION_DATE_OR_TBD"], project.finalDate, PROJECT_SOURCE, replace);
  putMany(["ARCHITECT_ENGINEER_AND_CONTACT", "ARCHITECT_ENGINEER_LEGAL_NAME_AND_CONTACT", "OWNER_S_ARCHITECT_ENGINEER", "OWNER_ARCHITECT_ENGINEER_OR_CONSULTANT", "OWNER_DESIGN_PROFESSIONAL_AND_CONTACT", "OWNER_DESIGN_PROFESSIONAL", "ARCHITECT_COMPANY", "ARCHITECT_NAME"], project.architect, PROJECT_SOURCE, replace);
  putMany(["PROJECT_MANAGER_NAME", "PROJECT_MANAGER_CONTACT_INCLUDED_SCOPE", "PROJECT_MANAGER_NAME_OR_FIRM", "PROJECT_MANAGER_CONTACT", "CONTRACTOR_AUTHORIZED_REPRESENTATIVE", "CONTRACTOR_REPRESENTATIVE_AND_CONTACT", "DESIGN_BUILDER_AUTHORIZED_REPRESENTATIVE", "DESIGN_BUILDER_REPRESENTATIVE_AND_CONTACT"], project.projectManager, PROJECT_SOURCE, replace);
  put("SUPERINTENDENT_CONTACT_INCLUDED_SCOPE", project.superintendent, PROJECT_SOURCE, replace);
  putMany(["PROJECT_TYPE", "PROJECT_TYPE_OR_CLASSIFICATION"], project.projectType, PROJECT_SOURCE, replace);
  if (!replace) put("PROJECT_DESCRIPTION", project.projectType, PROJECT_SOURCE);
  putMany(["OWNER_TARGET_BUDGET", "OWNER_S_TOTAL_PROJECT_BUDGET", "OWNER_TOTAL_PROJECT_BUDGET", "GMP_AMOUNT", "LUMP_SUM_AMOUNT", "LUMP_SUM_CONTRACT_SUM", "TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT", "SMALL_PROJECT_CONTRACT_AMOUNT", "NTE_AMOUNT_OR_NOT_APPLICABLE", "EXTERNAL_CONTRACT_AMOUNT"], money(project.contractAmount), PROJECT_SOURCE, replace);
  putMany(["PAYMENT_TERMS", "REMAINING_PAYMENT_SCHEDULE"], project.paymentTerms, PROJECT_SOURCE, replace);
  if (normalizeValue(project.retainageInitialPercent)) {
    const initial = percent(project.retainageInitialPercent);
    const afterHalf = percent(project.retainageAfterHalfPercent);
    put("RETAINAGE_PERCENTAGE", initial, PROJECT_SOURCE, replace);
    putMany(["RETAINAGE_TERMS", "RETAINAGE_TERMS_AND_RELEASE", "CONSTRUCTION_RETAINAGE"], `${initial}% until 50% completion, then ${afterHalf || "0"}%; release as required by Project-state law.`, PROJECT_SOURCE, replace);
  }
}

function addEstimateBreakdown(
  rollups: EstimateRollup[],
  summary: ReturnType<typeof calculateEstimateSummary> | null,
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
) {
  const byDivision = new Map<string, EstimateRollup[]>();
  for (const rollup of rollups) {
    const division = String(rollup.code || "").slice(0, 2);
    if (!division) continue;
    byDivision.set(division, [...(byDivision.get(division) || []), rollup]);
  }
  for (const item of amountFieldsByDivisions) {
    const selected = item.divisions.flatMap((division) => byDivision.get(division) || []);
    const amount = selected.reduce((total, rollup) => total + number(rollup.amount), 0);
    if (!amount) continue;
    putMany(item.fields, money(amount), source, true);
    const notes = selected.map((rollup) => rollup.description).filter(Boolean).join("; ");
    for (const amountField of item.fields) put(amountField.replace(/_AMOUNT$/, "_INCLUDED_SCOPE_NOTES"), notes, source, true);
  }
  const fullBreakdown = rollups.map((rollup) => `${rollup.code} · ${rollup.description} · ${money(rollup.amount)}`).join("\n");
  putMany(["FINAL_GMP_COST_BREAKDOWN_AND_SOV", "COST_CODES_LOCATIONS_OR_WORK_AUTHORIZATION_BREAKDOWN"], fullBreakdown, source, true);

  const allowanceRows = rollups.filter((rollup) => /allowance|contingenc/i.test(rollup.description));
  const allowanceTotal = allowanceRows.reduce((total, rollup) => total + number(rollup.amount), 0);
  putMany(["ALLOWANCES_AMOUNT", "CONTINGENCY_AMOUNT", "ALLOWANCES_AND_ACCEPTED_ALTERNATES_AMOUNT"], money(allowanceTotal), source, true);
  if (allowanceRows.length) {
    put("ALLOWANCE_SCHEDULE_OR_NONE", allowanceRows.map((rollup) => `${rollup.description} — ${formatMoney(rollup.amount)}`).join("\n"), source, true);
  }
  allowanceRows.slice(0, 10).forEach((rollup, index) => {
    put(`ALLOWANCE_OR_CONTINGENCY_${index + 1}_AMOUNT`, money(rollup.amount), source, true);
    put(`ALLOWANCE_OR_CONTINGENCY_${index + 1}_INCLUDED_COST_COMPONENTS`, rollup.description, source, true);
  });
  const matchedAmount = (pattern: RegExp) => rollups.filter((rollup) => pattern.test(`${rollup.code} ${rollup.description} ${rollup.division}`)).reduce((total, rollup) => total + number(rollup.amount), 0);
  const insuranceAndBonds = matchedAmount(/insurance|bond/i) || number(summary?.performanceBond);
  put("INSURANCE_AND_BONDS_AMOUNT", money(insuranceAndBonds), source, true);
  putMany(["PERMITS_AND_AGENCY_FEES_AMOUNT", "PERMITS_AGENCY_FEES_TESTING_AND_COMMISSIONING_AMOUNT", "PERMITS_TESTING_SUPPORT_AND_COMMISSIONING_SUPPORT_AMOUNT"], money(matchedAmount(/permit|agency fee|testing|commission/i)), source, true);
  put("DESIGN_AND_PROFESSIONAL_SERVICES_AMOUNT", money(matchedAmount(/architect|engineer|design|professional service/i)), source, true);
  put("PRECONSTRUCTION_AND_ESTIMATING_AMOUNT", money(matchedAmount(/preconstruction|estimating|project management/i)), source, true);
}

function addProposalIdentity(
  proposal: Record<string, unknown>,
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  projectSite?: unknown,
) {
  const ownerName = normalizeValue(proposal.ownerName);
  put("OWNER_LEGAL_NAME", ownerName, source);
  put("OWNER_LEGAL_NAME_AND_STATUS", ownerName, source);
  addOwnerContactFields({
    name: normalizeValue(proposal.ownerContactName),
    company: ownerName,
    jobTitle: normalizeValue(proposal.ownerContactTitle),
    email: normalizeValue(proposal.ownerContactEmail),
    phone: normalizeValue(proposal.ownerContactPhone),
    address: normalizeValue(proposal.ownerMailingAddress),
    addressLine1: normalizeValue(proposal.ownerMailingAddressLine1),
    addressLine2: normalizeValue(proposal.ownerMailingAddressLine2),
    city: normalizeValue(proposal.ownerMailingCity),
    state: normalizeValue(proposal.ownerMailingState),
    postalCode: normalizeValue(proposal.ownerMailingPostalCode),
  }, source, put, putMany, true, projectSite);
  put("PROJECT_NAME", proposal.projectName, source);
  put("PROJECT_NAME_AND_ADDRESS", [proposal.projectName, proposal.projectLocation].map(normalizeValue).filter(Boolean).join(" · "), source);
  put("PROJECT_SITE_ADDRESS", proposal.projectLocation, source);
  putMany(["PROJECT_TYPE", "PROJECT_TYPE_OR_CLASSIFICATION"], proposal.projectType, source, true);
  put("DELIVERY_METHOD", proposal.deliveryMethod, source, true);

  const proposalPrice = money(proposal.contractPrice);
  putMany(["OWNER_TARGET_BUDGET", "OWNER_S_TOTAL_PROJECT_BUDGET", "OWNER_TOTAL_PROJECT_BUDGET", "GMP_AMOUNT", "LUMP_SUM_AMOUNT", "LUMP_SUM_CONTRACT_SUM", "TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT", "SMALL_PROJECT_CONTRACT_AMOUNT", "NTE_AMOUNT_OR_NOT_APPLICABLE", "ESTIMATED_COST_OF_THE_WORK", "EXTERNAL_CONTRACT_AMOUNT"], proposalPrice, source);
  putMany(["PAYMENT_TERMS", "REMAINING_PAYMENT_SCHEDULE"], proposal.paymentTerms, source, true);
  const depositPercent = number(proposal.depositPercent);
  if (depositPercent > 0 && number(proposal.contractPrice) > 0) {
    putMany(["INITIAL_DEPOSIT_OR_ADVANCE", "INITIAL_PAYMENT_OR_MOBILIZATION"], money(number(proposal.contractPrice) * depositPercent / 100), source, true);
  }

  const team = Array.isArray(proposal.teamMembers) ? proposal.teamMembers.map(record) : [];
  const projectManager = team.find((member) => normalizeValue(member.employeeEmail).toLowerCase() === normalizeValue(proposal.proposedProjectManagerEmail).toLowerCase());
  const superintendent = team.find((member) => normalizeValue(member.employeeEmail).toLowerCase() === normalizeValue(proposal.proposedSuperintendentEmail).toLowerCase());
  if (projectManager) putMany(["PROJECT_MANAGER_NAME", "PROJECT_MANAGER_CONTACT_INCLUDED_SCOPE"], participant(projectManager), source, true);
  if (superintendent) put("SUPERINTENDENT_CONTACT_INCLUDED_SCOPE", participant(superintendent), source, true);
}

function addOwnerContactFields(
  rawContact: OwnerContractPrefillContact,
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  replace = false,
  projectSite?: unknown,
) {
  const contact = normalizeOwnerContact(rawContact);
  const projectAddress = splitProjectMailingAddress(projectSite);
  const usesProjectAddress = !contact.addressLine1 && Boolean(projectAddress.addressLine1);
  const addressLine1 = contact.addressLine1 || projectAddress.addressLine1;
  const addressLine2 = contact.addressLine1 ? contact.addressLine2 : projectAddress.addressLine2;
  const addressSource: OwnerContractFieldSource = usesProjectAddress
    ? { kind: "Project", label: "Project Location · Confirm" }
    : source;
  const combinedSource: OwnerContractFieldSource = usesProjectAddress
    ? { kind: "Project", label: `${source.label} + Project Location · Confirm`, ...(source.recordId ? { recordId: source.recordId } : {}) }
    : source;
  const representative = [contact.name, contact.jobTitle].filter(Boolean).join(" · ");
  const directContact = [representative, contact.email, contact.phone].filter(Boolean).join(" · ");
  const mailingAddress = [addressLine1, addressLine2].filter(Boolean).join("\n");
  const deliveryAddress = [contact.company, contact.name, addressLine1, addressLine2].filter(Boolean).join("\n");
  const fullContactBlock = [contact.company, addressLine1, addressLine2, representative, contact.email, contact.phone].filter(Boolean).join("\n");
  const invoiceRecipient = contact.email
    ? ["Email", contact.name, contact.email].filter(Boolean).join(" · ")
    : mailingAddress
      ? ["Mail", contact.name, mailingAddress.replaceAll("\n", ", ")].filter(Boolean).join(" · ")
      : directContact;

  putMany(["OWNER_LEGAL_NAME", "OWNER_LEGAL_NAME_AND_STATUS"], contact.company, source);
  putMany([
    "OWNER_AUTHORIZED_REPRESENTATIVE",
    "OWNER_RECIPIENT",
    "OWNER_NOTICE_CONTACT",
    "OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS",
  ], representative, source, replace);
  putMany(["OWNER_PRIMARY_CONTACT_NAME", "OWNER_SIGNATORY", "PROJECT_OWNER_CONTACT_NAME"], contact.name, source, replace);
  putMany(["OWNER_PRIMARY_CONTACT_TITLE", "OWNER_SIGNATORY_TITLE", "PROJECT_OWNER_CONTACT_TITLE"], contact.jobTitle, source, replace);
  putMany([
    "OWNER_PRIMARY_CONTACT_EMAIL",
    "OWNER_NOTICE_EMAIL",
    "OWNER_EMAIL",
    "OWNER_SIGNATORY_EMAIL",
    "PROJECT_OWNER_CONTACT_EMAIL",
  ], contact.email, source, replace);
  putMany([
    "OWNER_PRIMARY_CONTACT_PHONE",
    "OWNER_PHONE",
    "OWNER_NOTICE_PHONE",
    "OWNER_SIGNATORY_PHONE",
    "PROJECT_OWNER_CONTACT_PHONE",
  ], contact.phone, source, replace);
  putMany(["OWNER_PRIMARY_MAILING_ADDRESS_LINE_1", "OWNER_NOTICE_ADDRESS_LINE_1"], addressLine1, addressSource, replace);
  putMany(["OWNER_PRIMARY_MAILING_ADDRESS_LINE_2", "OWNER_NOTICE_ADDRESS_LINE_2"], addressLine2, addressSource, replace);
  putMany(["OWNER_DELIVERY_ADDRESS", "OWNER_MAILING_ADDRESS"], deliveryAddress || mailingAddress, combinedSource, replace);
  putMany(["OWNER_ADDRESS_REPRESENTATIVE_CONTACT", "NOTICE_REQUIREMENTS_AND_ADDRESSES"], fullContactBlock || directContact, combinedSource, replace);
  putMany([
    "PRIMARY_SITE_CONTACT",
    "OWNER_PRIMARY_SITE_CONTACT",
    "OWNER_SITE_CONTACT",
    "PROJECT_OWNER_PRIMARY_SITE_CONTACT",
  ], directContact, source, replace);
  putMany([
    "INVOICE_DELIVERY_METHOD_RECIPIENT",
    "INVOICE_RECIPIENT",
    "OWNER_INVOICE_RECIPIENT",
  ], invoiceRecipient, contact.email ? source : combinedSource, replace);
  putMany(["BILLING_CONTACT", "OWNER_BILLING_CONTACT"], directContact, source, replace);
}

function normalizeOwnerContact(contact: OwnerContractPrefillContact) {
  const name = first(contact.name, [contact.firstName, contact.lastName].map(normalizeValue).filter(Boolean).join(" "));
  const company = normalizeValue(contact.company);
  const jobTitle = normalizeValue(contact.jobTitle);
  const email = normalizeValue(contact.email);
  const phone = normalizeValue(contact.phone);
  const rawAddress = first(contact.addressLine1, contact.address);
  const embeddedLines = rawAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const addressLine1 = embeddedLines[0] || rawAddress;
  const locality = formatLocality(contact.city, contact.state, contact.postalCode);
  const addressLine2 = first(contact.addressLine2, locality, embeddedLines.slice(1).join(", "));
  return { name, company, jobTitle, email, phone, addressLine1, addressLine2 };
}

function splitProjectMailingAddress(value: unknown) {
  const address = normalizeValue(value);
  if (!address) return { addressLine1: "", addressLine2: "" };
  const lines = address.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) return { addressLine1: lines[0], addressLine2: lines.slice(1).join(", ") };
  const usAddress = address.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (usAddress) {
    return {
      addressLine1: usAddress[1].trim(),
      addressLine2: `${usAddress[2].trim()}, ${usAddress[3].toUpperCase()} ${usAddress[4]}`,
    };
  }
  return { addressLine1: address, addressLine2: "" };
}

function formatLocality(cityValue: unknown, stateValue: unknown, postalCodeValue: unknown) {
  const city = normalizeValue(cityValue);
  const state = normalizeValue(stateValue);
  const postalCode = normalizeValue(postalCodeValue);
  const stateAndPostal = [state, postalCode].filter(Boolean).join(" ");
  return [city, stateAndPostal].filter(Boolean).join(", ");
}

function addProposalSchedule(
  proposal: Record<string, unknown>,
  milestones: ScheduleSource[],
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
) {
  const scheduleText = milestones.map((milestone) => `${milestone.title}: ${dateRange(milestone.startDate, milestone.endDate)}`).join("\n");
  const narrative = [normalizeValue(proposal.scheduleNarrative), scheduleText].filter(Boolean).join("\n\n");
  putMany(["DESIGN_MILESTONES_AND_REVIEW_DATES", "DESIGN_MILESTONES_AND_ANTICIPATED_GMP_PROPOSAL_DATE", "OTHER_PROJECT_SPECIFIC_SCHEDULE_TERM", "PROJECT_SCHEDULE_PAGES_OR_NOTES"], narrative, source, true);
  putMany(["CONSTRUCTION_COMMENCEMENT_DATE", "NOTICE_TO_PROCEED_DATE"], proposal.targetStartDate, source);
  milestones.slice(0, 8).forEach((milestone, index) => {
    const number = index + 1;
    put(`MILESTONE_${number}_MILESTONE`, milestone.title, source, true);
    put(`MILESTONE_${number}_DATE`, milestone.endDate || milestone.startDate, source, true);
    put(`MILESTONE_${number}_REQUIRED_DATE`, milestone.endDate || milestone.startDate, source, true);
    put(`CONTRACTUAL_MILESTONE_IF_ANY_${number}_CONTRACTUAL_MILESTONE_IF_ANY`, milestone.title, source, true);
    put(`CONTRACTUAL_MILESTONE_IF_ANY_${number}_REQUIRED_DATE`, milestone.endDate || milestone.startDate, source, true);
  });
}

function addProposalDesignServices(
  proposal: Record<string, unknown>,
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
) {
  const services = Array.isArray(proposal.designStartupServices)
    ? proposal.designStartupServices.map(record).filter((service) => service.included !== false && normalizeValue(service.description))
    : [];
  const serviceText = services.map((service) => `${normalizeValue(service.title)} — ${normalizeValue(service.description)}`).join("\n\n");
  const startupGmp = money(proposal.designStartupGmp);
  if (startupGmp) {
    putMany(["PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE", "TOTAL_PHASE_ONE_FEE", "DESIGN_PRECONSTRUCTION_INCLUDED_AMOUNT", "AMOUNT_DUE_UPON_EXECUTION"], startupGmp, source, true);
  }
  putMany(["DESIGN_DELIVERABLES_AND_CRITERIA", "PRECONSTRUCTION_AND_ESTIMATING_INCLUDED_SCOPE_NOTES", "DESIGN_AND_PROFESSIONAL_SERVICES_INCLUDED_SCOPE_NOTES"], serviceText, source, true);
  const descriptions = (pattern: RegExp) => services.filter((service) => pattern.test(`${normalizeValue(service.title)} ${normalizeValue(service.description)}`)).map((service) => normalizeValue(service.description)).join("\n");
  put("ARCHITECTURAL_DESIGN", descriptions(/architect/i), source, true);
  put("CIVIL_AND_STRUCTURAL_DESIGN", descriptions(/civil|structural|geotechnical/i), source, true);
  put("MECHANICAL_ELECTRICAL_PLUMBING_AND_FIRE_PROTECTION_DESIGN", descriptions(/mechanical|electrical|plumbing|MEP|fire/i), source, true);
  putMany(["GEOTECHNICAL_AND_ENVIRONMENTAL_SERVICES_SCOPE_CONTRACT_SUM_TREATMENT_NOTES", "GEOTECHNICAL_AND_ENVIRONMENTAL_SERVICES_SCOPE_COST_TREATMENT_NOTES"], descriptions(/geotechnical|environmental/i), source, true);
  putMany(["BUILDING_PERMIT_SCOPE_CONTRACT_SUM_TREATMENT_NOTES", "BUILDING_AND_TRADE_PERMITS_SCOPE_COST_TREATMENT_NOTES"], descriptions(/permit|municipal|agency/i), source, true);

  services.slice(0, 5).forEach((service, index) => {
    const number = index + 1;
    put(`PROFESSIONAL_OR_DELEGATED_DESIGN_SERVICE_${number}_PROFESSIONAL_OR_DELEGATED_DESIGN_SERVICE`, service.title, source, true);
    put(`PROFESSIONAL_OR_DELEGATED_DESIGN_SERVICE_${number}_SCOPE_OR_PERFORMANCE_CRITERIA`, service.description, source, true);
  });
}

function addProposalBasisDocuments(
  proposal: Record<string, unknown>,
  source: OwnerContractFieldSource,
  put: (field: string, value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
  putMany: (keys: string[], value: unknown, source: OwnerContractFieldSource, replace?: boolean) => void,
) {
  const revision = Math.max(1, number(proposal.revision) || 1);
  const proposalDate = normalizeValue(proposal.proposalDate);
  const title = `${normalizeValue(proposal.projectName) || "Project"} · Owner Proposal R${revision}`;
  const datedRevision = [proposalDate, `R${revision}`].filter(Boolean).join(" · ");
  putMany(["PROPOSAL_ESTIMATE_TITLE_IDENTIFIER", "CONTRACTOR_BID_PROPOSAL_TITLE_IDENTIFIER", "GMP_PROPOSAL_OR_ESTIMATE_TITLE_OR_IDENTIFIER", "SCOPE_NARRATIVE_TITLE_OR_IDENTIFIER"], title, source, true);
  putMany(["PROPOSAL_ESTIMATE_DATE_REVISION", "CONTRACTOR_BID_PROPOSAL_DATE_REVISION", "GMP_PROPOSAL_OR_ESTIMATE_DATE_OR_REVISION", "SCOPE_NARRATIVE_DATE_OR_REVISION", "GMP_PROPOSAL_DATE"], proposalDate, source, true);
  putMany(["PRICING_DATE_AND_PRICE_VALIDITY_PERIOD", "BID_PRICING_DATE_AND_PRICE_VALIDITY_PERIOD"], [proposalDate, normalizeValue(proposal.validThrough) ? `Valid Through ${normalizeValue(proposal.validThrough)}` : ""].filter(Boolean).join(" · "), source, true);
  put("GMP_EXPIRATION_DATE", proposal.validThrough, source, true);
  putMany(["PROJECT_SCHEDULE_TITLE_IDENTIFIER", "PROJECT_SCHEDULE_TITLE_OR_IDENTIFIER"], `${normalizeValue(proposal.projectName) || "Project"} · Proposal Schedule`, source, true);
  putMany(["PROJECT_SCHEDULE_DATE_REVISION", "PROJECT_SCHEDULE_DATE_OR_REVISION"], datedRevision, source, true);

  const drawings = Array.isArray(proposal.visuals)
    ? proposal.visuals.map(record).filter((visual) => visual.included !== false && normalizeValue(visual.kind) === "Drawing PDF")
    : [];
  const drawingNames = drawings.map((drawing) => normalizeValue(drawing.name)).filter(Boolean).join("; ");
  putMany(["DRAWING_SET_INDEX_TITLE_IDENTIFIER", "DRAWING_INDEX_OR_DRAWING_SET_TITLE_IDENTIFIER", "DRAWING_INDEX_OR_DRAWING_SET_TITLE_OR_IDENTIFIER"], drawingNames, source, true);
  putMany(["DRAWING_SET_INDEX_DATE_REVISION", "DRAWING_INDEX_OR_DRAWING_SET_DATE_REVISION", "DRAWING_INDEX_OR_DRAWING_SET_DATE_OR_REVISION"], drawingNames ? datedRevision : "", source, true);
  put("DRAWING_INDEX_OR_DRAWING_SET_PAGES_OR_NOTES", drawings.map((drawing) => `${normalizeValue(drawing.name)} · Pages ${normalizeValue(drawing.pageSelection) || "All"}`).join("; "), source, true);

  const documents = [
    { title, date: datedRevision, purpose: "Owner proposal, scope, assumptions, exclusions, and pricing basis" },
    { title: `${normalizeValue(proposal.projectName) || "Project"} · Proposal Schedule`, date: datedRevision, purpose: "Proposed project schedule and milestones" },
    ...(drawingNames ? [{ title: drawingNames, date: datedRevision, purpose: "Design drawing basis identified in the owner proposal" }] : []),
  ];
  put(
    "CONTRACT_DOCUMENTS_AND_PROPOSALS",
    documents.map((document) => [document.title, document.date].filter(Boolean).join(" · ")).join("\n"),
    source,
    true,
  );
  documents.slice(0, 5).forEach((document, index) => {
    const suffix = index ? `_${index + 1}` : "";
    put(`ATTACHMENT_TITLE_OR_IDENTIFIER${suffix}`, document.title, source, true);
    put(`ATTACHMENT_DATE_OR_REVISION${suffix}`, document.date, source, true);
    put(`ATTACHMENT_PURPOSE${suffix}`, document.purpose, source, true);
    if (index < 6) {
      const number = index + 2;
      put(`DOCUMENT_${number}_DOCUMENT`, document.title, source, true);
      put(`DOCUMENT_${number}_TITLE_OR_IDENTIFIER`, document.title, source, true);
      put(`DOCUMENT_${number}_DATE_OR_REVISION`, document.date, source, true);
      put(`DOCUMENT_${number}_PURPOSE`, document.purpose, source, true);
    }
  });
}

function normalizeBudgetRows(rows: BudgetSource[]): EstimateRollup[] {
  return rows.map((row) => ({
    code: normalizeValue(row.code),
    division: normalizeValue(row.division),
    description: normalizeValue(row.description),
    budgetable: true,
    amount: number(row.amount ?? row.originalBudget),
  })).filter((row) => row.code && (row.amount !== 0 || row.description));
}

function normalizeScopes(value: unknown): ScopeSource[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((scope) => scope.included !== false).map((scope) => ({
    title: normalizeValue(scope.title),
    description: normalizeValue(scope.description),
    amount: number(scope.amount),
  })).filter((scope) => scope.title || scope.description);
}

function normalizeMilestones(value: unknown): ScheduleSource[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((milestone) => milestone.included !== false).map((milestone) => ({
    title: normalizeValue(milestone.title),
    startDate: date(milestone.startDate),
    endDate: date(milestone.endDate),
    phase: normalizeValue(milestone.phase),
    assumption: milestone.assumption === true,
  })).filter((milestone) => milestone.title);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.map(normalizeValue).filter(Boolean).slice(0, 100) : [];
}

function bulletText(items: string[]) {
  return items.map((item) => `• ${item}`).join("\n");
}

function normalizeValue(value: unknown) {
  return String(value ?? "").trim().slice(0, 50_000);
}

function first(...values: unknown[]) {
  return values.map(normalizeValue).find(Boolean) || "";
}

function number(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  const parsed = number(value);
  return parsed > 0 ? moneyDecimal(parsed) : "";
}

function percent(value: unknown) {
  const parsed = number(value);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100) : "";
}

function date(value: unknown) {
  const candidate = normalizeValue(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function dateRange(start: string, end: string) {
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || "Date To Be Confirmed";
}

function participant(member: Record<string, unknown>) {
  return [member.displayName, member.proposalRoleLabel, member.employeeEmail].map(normalizeValue).filter(Boolean).join(" · ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
