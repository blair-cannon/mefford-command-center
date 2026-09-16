import {
  OWNER_CONTRACT_PRIMARY_PARTY_FIELDS,
  OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  defaultContractInstrument,
  normalizeOwnerContractCommercialTerms,
  normalizeContractMoneyFields,
  normalizeOwnerContractType,
  normalizeSmallProjectPricingMethod,
  type SmallProjectPricingMethod,
  type OwnerContractInstrument,
  type OwnerContractType,
} from "./owner-contracts";
import type { OwnerContractFieldSource, OwnerContractPrefillSummary } from "./owner-contract-prefill";

export const PREAWARD_OWNER_CONTRACT_RECORD_TYPE = "Pre-Award Owner Contracts";
export const PREAWARD_OWNER_CONTRACT_STATUS = "Pre-Award Draft";

export type PreAwardOwnerContractData = {
  opportunityId: string;
  contractType: OwnerContractType;
  pricingMethod: SmallProjectPricingMethod | "";
  activeInstrument: OwnerContractInstrument;
  fields: Record<string, string>;
  fieldSources: Record<string, OwnerContractFieldSource>;
  manualFieldKeys: string[];
  sourceSummary: OwnerContractPrefillSummary | null;
  missingRequiredFields: string[];
  paymentTerms: string;
  retainageInitialPercent: string;
  retainageAfterHalfPercent: string;
  revisionNumber: number;
  revisionHash: string;
  savedAt: string;
  savedBy: string;
  sourceOfTruth: "Pre-Award Owner Contract Draft";
  restrictions: {
    bindingCommitment: false;
    accountingSynchronization: false;
    ownerPortalAccess: false;
    ownerIssue: false;
    signatures: false;
  };
};

export function preAwardOwnerContractRecordId(opportunityId: string) {
  return `PREAWARD-CONTRACT-${opportunityId.trim()}`;
}

export function normalizePreAwardContractFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return normalizeContractMoneyFields(Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^[A-Z0-9_]+$/.test(key))
      .slice(0, 1_200)
      .map(([key, fieldValue]) => [key.slice(0, 120), String(fieldValue ?? "").slice(0, 50_000)]),
  ));
}

export function normalizePreAwardOwnerContractData(value: unknown): PreAwardOwnerContractData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const contractType = normalizeOwnerContractType(input.contractType);
  const opportunityId = String(input.opportunityId || "").trim();
  if (!contractType || !opportunityId) return null;
  const instrument = String(input.activeInstrument || defaultContractInstrument(contractType));
  const activeInstrument = (["Phase 1 Agreement", "GMP Exhibit A", "Primary Agreement", "External Agreement Mapping"] as const)
    .includes(instrument as OwnerContractInstrument)
    ? instrument as OwnerContractInstrument
    : defaultContractInstrument(contractType);
  const commercial = normalizeOwnerContractCommercialTerms({
    paymentTerms: input.paymentTerms,
    retainageInitialPercent: input.retainageInitialPercent,
    retainageAfterHalfPercent: input.retainageAfterHalfPercent,
  });
  return {
    opportunityId,
    contractType,
    pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(input.pricingMethod || normalizePreAwardContractFields(input.fields).SMALL_PROJECT_PRICING_METHOD) : "",
    activeInstrument,
    fields: normalizePreAwardContractFields(input.fields),
    fieldSources: normalizeFieldSources(input.fieldSources),
    manualFieldKeys: normalizeFieldKeys(input.manualFieldKeys),
    sourceSummary: normalizeSourceSummary(input.sourceSummary),
    missingRequiredFields: Array.isArray(input.missingRequiredFields)
      ? input.missingRequiredFields.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)).slice(0, 1_200)
      : [],
    paymentTerms: commercial.paymentTerms,
    retainageInitialPercent: commercial.retainageInitialPercent,
    retainageAfterHalfPercent: commercial.retainageAfterHalfPercent,
    revisionNumber: Math.max(1, Math.floor(Number(input.revisionNumber) || 1)),
    revisionHash: String(input.revisionHash || ""),
    savedAt: String(input.savedAt || ""),
    savedBy: String(input.savedBy || ""),
    sourceOfTruth: "Pre-Award Owner Contract Draft",
    restrictions: {
      bindingCommitment: false,
      accountingSynchronization: false,
      ownerPortalAccess: false,
      ownerIssue: false,
      signatures: false,
    },
  };
}

function normalizeFieldKeys(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)))).slice(0, 1_200)
    : [];
}

function normalizeFieldSources(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, OwnerContractFieldSource>;
  const allowed = new Set(["Project", "Estimate", "Proposal", "Standard", "Manual"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([field, raw]) => {
    if (!/^[A-Z0-9_]+$/.test(field) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const source = raw as Record<string, unknown>;
    const kind = String(source.kind || "");
    if (!allowed.has(kind)) return [];
    return [[field, {
      kind,
      label: String(source.label || kind).slice(0, 160),
      ...(source.recordId ? { recordId: String(source.recordId).slice(0, 200) } : {}),
    } as OwnerContractFieldSource]];
  }).slice(0, 1_200));
}

function normalizeSourceSummary(value: unknown): OwnerContractPrefillSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    projectFields: boundedCount(source.projectFields),
    estimateFields: boundedCount(source.estimateFields),
    proposalFields: boundedCount(source.proposalFields),
    standardFields: boundedCount(source.standardFields),
    scopeSections: boundedCount(source.scopeSections),
    budgetLines: boundedCount(source.budgetLines),
    scheduleMilestones: boundedCount(source.scheduleMilestones),
  };
}

function boundedCount(value: unknown) {
  return Math.max(0, Math.min(10_000, Math.floor(Number(value) || 0)));
}

const CONTACT_CONTROLLED_FIELDS = [
  ...OWNER_CONTRACT_PRIMARY_PARTY_FIELDS,
  ...OWNER_CONTRACT_ROUTING_OVERRIDE_FIELDS,
  "OWNER_ADDRESS_REPRESENTATIVE_CONTACT",
  "OWNER_AUTHORIZED_REPRESENTATIVE",
  "OWNER_RECIPIENT",
  "OWNER_NOTICE_CONTACT",
  "OWNER_NOTICE_EMAIL",
  "OWNER_EMAIL",
  "OWNER_NOTICE_PHONE",
  "OWNER_PHONE",
  "OWNER_NOTICE_ADDRESS_LINE_1",
  "OWNER_NOTICE_ADDRESS_LINE_2",
  "OWNER_DELIVERY_ADDRESS",
  "OWNER_MAILING_ADDRESS",
  "OWNER_SIGNATORY",
  "OWNER_SIGNATORY_TITLE",
  "OWNER_SIGNATORY_EMAIL",
  "OWNER_SIGNATORY_PHONE",
  "OWNER_REPRESENTATIVE_AUTHORIZED_TO_ACKNOWLEDGE_TICKETS",
  "PRIMARY_SITE_CONTACT",
  "OWNER_PRIMARY_SITE_CONTACT",
  "OWNER_SITE_CONTACT",
  "PROJECT_OWNER_PRIMARY_SITE_CONTACT",
  "INVOICE_DELIVERY_METHOD_RECIPIENT",
  "INVOICE_RECIPIENT",
  "OWNER_INVOICE_RECIPIENT",
  "BILLING_CONTACT",
  "OWNER_BILLING_CONTACT",
] as const;

const AWARD_CONTROLLED_FIELDS = [
  "OWNER_LEGAL_NAME",
  "OWNER_LEGAL_NAME_AND_STATUS",
  "PROJECT_NUMBER",
  "PROJECT_NAME",
  "PROJECT_NAME_AND_ADDRESS",
  "PROJECT_SITE_ADDRESS",
  "PROJECT_STATE",
  "PROJECT_DOCUMENT_ID",
  "OWNER_CRITERIA_ID_VERSION_AND_DATE",
  "FINAL_OWNER_CRITERIA_ID_VERSION_AND_DATE",
  "EFFECTIVE_DATE",
  "AGREEMENT_EFFECTIVE_DATE",
  "DOCUMENT_EFFECTIVE_DATE",
  "ORIGINAL_AGREEMENT_DATE",
  "EXHIBIT_A_EFFECTIVE_DATE",
  "CONSTRUCTION_COMMENCEMENT_DATE",
  "SUBSTANTIAL_COMPLETION_DATE",
  "SUBSTANTIAL_COMPLETION_DATE_OR_TBD",
  "FINAL_COMPLETION_DATE",
  "FINAL_COMPLETION_DATE_OR_TBD",
  ...CONTACT_CONTROLLED_FIELDS,
] as const;

export function carryPreAwardContractFields(input: {
  preAward: unknown;
  finalContractType: OwnerContractType;
  finalInstrument: OwnerContractInstrument;
  generatedFields: Record<string, string>;
}) {
  const preAward = normalizePreAwardOwnerContractData(input.preAward);
  if (!preAward || preAward.contractType !== input.finalContractType || preAward.activeInstrument !== input.finalInstrument) {
    return {
      carried: false,
      fields: { ...input.generatedFields },
      preAward,
      reason: preAward ? "Contract type or instrument changed at award" : "No pre-award draft exists",
    };
  }

  const fields = { ...input.generatedFields, ...preAward.fields };
  const manualFields = new Set(preAward.manualFieldKeys);
  const contactFields = new Set<string>(CONTACT_CONTROLLED_FIELDS);
  for (const key of AWARD_CONTROLLED_FIELDS) {
    if (!(contactFields.has(key) && manualFields.has(key)) && input.generatedFields[key] !== undefined) fields[key] = input.generatedFields[key];
  }
  if (["Design-Build Lump Sum", "Plan & Spec Lump Sum"].includes(input.finalContractType)) {
    for (const key of ["LUMP_SUM_AMOUNT", "LUMP_SUM_CONTRACT_SUM", "TOTAL_LUMP_SUM_CONTRACT_SUM_AMOUNT", "OWNER_TARGET_BUDGET", "OWNER_TOTAL_PROJECT_BUDGET", "OWNER_S_TOTAL_PROJECT_BUDGET"]) {
      if (input.generatedFields[key] !== undefined) fields[key] = input.generatedFields[key];
    }
  }

  return {
    carried: true,
    fields,
    preAward,
    reason: `Pre-award revision ${preAward.revisionNumber} carried into the awarded project`,
  };
}
