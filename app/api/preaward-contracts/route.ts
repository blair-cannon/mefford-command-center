import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
  PREAWARD_OWNER_CONTRACT_STATUS,
  normalizePreAwardContractFields,
  normalizePreAwardOwnerContractData,
  preAwardOwnerContractRecordId,
} from "../../../lib/preaward-owner-contract";
import {
  contractTemplate,
  defaultContractFields,
  defaultContractInstrument,
  isOwnerContractType,
  normalizeOwnerContractCommercialTerms,
  normalizeOwnerContractType,
  normalizeSmallProjectPricingMethod,
  requiredContractFields,
  synchronizeOwnerContractContactFields,
  type OwnerContractInstrument,
  type OwnerContractType,
  withOwnerContractComputedFields,
} from "../../../lib/owner-contracts";
import {
  buildOwnerContractPrefill,
  mergeOwnerContractPrefill,
} from "../../../lib/owner-contract-prefill";
import {
  ownerContractContactReference,
  resolveOwnerContractContact,
  type LinkedOwnerContractContact,
} from "../../../lib/owner-contract-contact";
import { resolveCommandActor } from "../../../lib/server-actor";
import { validateOwnerContractBasisPdfs } from "../../../lib/owner-contract-basis-server";
import type { OwnerContractBasisAttachment } from "../../../lib/owner-contract-basis";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const OPPORTUNITY_RECORD_TYPE = "Sales Opportunities";
const CONTRACT_DESIGNATIONS = new Set([
  "Estimator",
  "Estimating Manager",
  "Sales Representative",
  "Sales Manager",
  "Project Manager",
]);

type CommandRow = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  date_locked: number;
  data_json: string;
  updated_at: string;
};

type SavePayload = {
  opportunityId?: string;
  contractType?: unknown;
  activeInstrument?: unknown;
  fields?: unknown;
  paymentTerms?: unknown;
  retainageInitialPercent?: unknown;
  retainageAfterHalfPercent?: unknown;
  manualFieldKeys?: unknown;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  const url = new URL(request.url);
  const opportunityId = url.searchParams.get("opportunityId")?.trim() || "";
  if (!opportunityId) return Response.json({ error: "Opportunity Is Required" }, { status: 400 });
  const database = await commandD1();
  if (!(await canManagePreAwardContract(database, actor.email, actor.accessLevel))) {
    return Response.json({ error: "Sales, Estimating, Project Management, Or Company Leadership Access Is Required" }, { status: 403 });
  }
  const opportunity = await loadOpportunity(database, opportunityId);
  if (!opportunity) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
  const record = await loadPreAwardContract(database, opportunityId);
  const storedData = normalizePreAwardOwnerContractData(record ? parseObject(record.data_json) : null);
  const opportunityData = parseObject(opportunity.data_json);
  const requestedType = normalizeOwnerContractType(url.searchParams.get("contractType"));
  const contractType = requestedType || storedData?.contractType || inferredContractType(opportunityData);
  const requestedInstrument = String(url.searchParams.get("activeInstrument") || "") as OwnerContractInstrument;
  const activeInstrument = contractType === "Design-Build GMP" && requestedInstrument === "GMP Exhibit A"
    ? "GMP Exhibit A"
    : storedData?.contractType === contractType
      ? storedData.activeInstrument
      : defaultContractInstrument(contractType);
  const proposal = await loadLatestOwnerProposal(database, opportunityId);
  const contact = await resolveOwnerContractContact(database, ownerContractContactReference(
    opportunityData,
    parseRecord(opportunityData.proposalHandoff),
    proposal ? parseObject(proposal.data_json) : null,
  ));
  const prefill = buildPreAwardPrefill(opportunity, proposal, contact, contractType, activeInstrument, actor);
  return Response.json({
    opportunity: toClientRecord(opportunity, OPPORTUNITY_RECORD_TYPE),
    record: record ? toClientRecord(record, PREAWARD_OWNER_CONTRACT_RECORD_TYPE) : null,
    prefill,
    restrictions: preAwardRestrictions(),
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  const input = await request.json() as SavePayload;
  const opportunityId = input.opportunityId?.trim() || "";
  if (!opportunityId || !isOwnerContractType(input.contractType)) {
    return Response.json({ error: "Opportunity And Owner Contract Type Are Required" }, { status: 400 });
  }
  const database = await commandD1();
  if (!(await canManagePreAwardContract(database, actor.email, actor.accessLevel))) {
    return Response.json({ error: "Sales, Estimating, Project Management, Or Company Leadership Access Is Required" }, { status: 403 });
  }
  const opportunity = await loadOpportunity(database, opportunityId);
  if (!opportunity) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
  const opportunityData = parseObject(opportunity.data_json);
  const opportunityStage = String(opportunityData.stage || opportunity.status);
  if (["Awarded", "Lost"].includes(opportunityStage)) {
    return Response.json({ error: opportunityStage === "Awarded" ? "Open The Project Owner Contract. This Pre-Award Draft Has Already Carried Forward." : "A Lost Opportunity Cannot Start A New Owner Contract Draft." }, { status: 423 });
  }

  const contractType = input.contractType;
  const requestedInstrument = String(input.activeInstrument || "") as OwnerContractInstrument;
  const activeInstrument = contractType === "Design-Build GMP" && requestedInstrument === "GMP Exhibit A"
    ? "GMP Exhibit A"
    : defaultContractInstrument(contractType);
  const incomingFields = normalizePreAwardContractFields(input.fields);
  const commercial = normalizeOwnerContractCommercialTerms(input);
  const existing = await loadPreAwardContract(database, opportunityId);
  const existingData = normalizePreAwardOwnerContractData(existing ? parseObject(existing.data_json) : null);
  if (existing?.date_locked || existing?.status === "Carried To Project") {
    return Response.json({ error: "This Pre-Award Draft Has Already Carried Into The Awarded Project" }, { status: 423 });
  }
  let manualFieldKeys = normalizeManualFieldKeys(
    Array.isArray(input.manualFieldKeys) ? input.manualFieldKeys : existingData?.manualFieldKeys,
  );
  const proposal = await loadLatestOwnerProposal(database, opportunityId);
  const contact = await resolveOwnerContractContact(database, ownerContractContactReference(
    opportunityData,
    parseRecord(opportunityData.proposalHandoff),
    proposal ? parseObject(proposal.data_json) : null,
  ));
  const prefill = buildPreAwardPrefill(opportunity, proposal, contact, contractType, activeInstrument, actor);
  const merged = mergeOwnerContractPrefill(incomingFields, prefill, manualFieldKeys, true);
  const routing = synchronizeOwnerContractContactFields(merged.fields, manualFieldKeys);
  let fields = withOwnerContractComputedFields(contractType, routing.fields);
  manualFieldKeys = routing.manualFieldKeys;
  fields.PAYMENT_TERMS = commercial.paymentTerms;
  fields.RETAINAGE_TERMS = commercial.retainageTerms;
  fields.RETAINAGE_TERMS_AND_RELEASE = commercial.retainageTerms;
  fields.CONSTRUCTION_RETAINAGE = commercial.retainageTerms;
  fields.RETAINAGE_PERCENTAGE = commercial.retainageInitialPercent;
  let basisAttachments: OwnerContractBasisAttachment[];
  try {
    const validatedBasis = await validateOwnerContractBasisPdfs(database, `ESTIMATE-${opportunityId}`, fields);
    fields = validatedBasis.fields;
    basisAttachments = validatedBasis.attachments;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Contract Basis PDFs Could Not Be Verified" }, { status: 409 });
  }
  const fieldSources = {
    ...merged.sources,
    PAYMENT_TERMS: manualFieldKeys.includes("PAYMENT_TERMS") ? { kind: "Manual", label: "Manual Override" } : prefill.sources.PAYMENT_TERMS,
  };
  const missingRequiredFields = requiredContractFields(contractType, activeInstrument, fields)
    .filter((field) => !String(fields[field] || "").trim());

  const now = new Date().toISOString();
  const revisionNumber = (existingData?.revisionNumber || 0) + 1;
  const revisionHash = await sha256(JSON.stringify({ opportunityId, contractType, activeInstrument, fields, commercial, revisionNumber }));
  const template = contractTemplate(contractType, activeInstrument);
  const recordId = preAwardOwnerContractRecordId(opportunityId);
  const data = {
    opportunityId,
    contractType,
    pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    activeInstrument,
    templateId: template.id,
    templateVersion: template.version,
    templateHtmlPath: template.htmlPath,
    templateDocxPath: template.docxPath,
    agreementSource: template.source,
    fields,
    contractBasisAttachments: basisAttachments,
    fieldSources,
    manualFieldKeys,
    sourceSummary: prefill.summary,
    sourceContactRecordId: contact?.recordId || "",
    missingRequiredFields,
    paymentTerms: commercial.paymentTerms,
    retainageInitialPercent: commercial.retainageInitialPercent,
    retainageAfterHalfPercent: commercial.retainageAfterHalfPercent,
    revisionNumber,
    revisionHash,
    savedAt: now,
    savedBy: actor.name,
    sourceOfTruth: "Pre-Award Owner Contract Draft",
    restrictions: preAwardRestrictions(),
  };
  const proposalHandoff = parseRecord(opportunityData.proposalHandoff);
  const nextOpportunityData = {
    ...opportunityData,
    contactId: contact?.recordId || opportunityData.contactId || "",
    contactName: contact?.contact.name || opportunityData.contactName || "",
    ownerContractType: contractType,
    ownerContractPricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    preAwardOwnerContractRecordId: recordId,
    preAwardOwnerContractStatus: PREAWARD_OWNER_CONTRACT_STATUS,
    preAwardOwnerContractRevision: revisionNumber,
    proposalHandoff: {
      ...proposalHandoff,
      ownerContractType: contractType,
      ownerContractPricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
      projectName: fields.PROJECT_NAME || opportunity.title,
      projectLocation: fields.PROJECT_SITE_ADDRESS || opportunityData.projectLocation || "",
      ownerName: fields.OWNER_LEGAL_NAME || fields.OWNER_LEGAL_NAME_AND_STATUS || proposalHandoff.ownerName || opportunityData.company || "",
      ownerContactRecordId: contact?.recordId || proposalHandoff.ownerContactRecordId || "",
      ownerContactName: fields.OWNER_SIGNATORY || fields.OWNER_NOTICE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || proposalHandoff.ownerContactName || "",
      ownerContactTitle: fields.OWNER_SIGNATORY_TITLE || proposalHandoff.ownerContactTitle || "",
      ownerContactEmail: fields.OWNER_NOTICE_EMAIL || fields.OWNER_EMAIL || proposalHandoff.ownerContactEmail || "",
      ownerContactPhone: fields.OWNER_NOTICE_PHONE || fields.OWNER_PHONE || proposalHandoff.ownerContactPhone || "",
      ownerMailingAddressLine1: fields.OWNER_NOTICE_ADDRESS_LINE_1 || proposalHandoff.ownerMailingAddressLine1 || "",
      ownerMailingAddressLine2: fields.OWNER_NOTICE_ADDRESS_LINE_2 || proposalHandoff.ownerMailingAddressLine2 || "",
      ownerContractDate: fields.EFFECTIVE_DATE || fields.AGREEMENT_EFFECTIVE_DATE || fields.DOCUMENT_EFFECTIVE_DATE || "",
      targetStartDate: fields.CONSTRUCTION_COMMENCEMENT_DATE || fields.NOTICE_TO_PROCEED_DATE || proposalHandoff.targetStartDate || "",
      substantialDate: fields.SUBSTANTIAL_COMPLETION_DATE || fields.SUBSTANTIAL_COMPLETION_DATE_OR_TBD || "",
      finalDate: fields.FINAL_COMPLETION_DATE || fields.FINAL_COMPLETION_DATE_OR_TBD || "",
      architect: fields.ARCHITECT_ENGINEER_AND_CONTACT || fields.OWNER_S_ARCHITECT_ENGINEER || opportunityData.architect || "",
      paymentTerms: commercial.paymentTerms,
      retainageInitialPercent: commercial.retainageInitialPercent,
      retainageAfterHalfPercent: commercial.retainageAfterHalfPercent,
    },
  };
  const title = `${opportunity.title} · Pre-Award Owner Contract`;
  const meta = `${template.id} · R${revisionNumber} · ${missingRequiredFields.length} Required Fields Open · Internal Only`;
  const oldValue = existing ? `R${existingData?.revisionNumber || 0}` : "Not Created";

  await database.batch([
    database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
      ON CONFLICT(project_id, id) DO UPDATE SET
        record_type = excluded.record_type, title = excluded.title, owner = excluded.owner,
        due = excluded.due, status = excluded.status, meta = excluded.meta,
        record_date = excluded.record_date, date_locked = 0,
        data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ).bind(
      SALES_PROJECT_ID,
      recordId,
      PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
      title,
      actor.name,
      opportunity.due || now.slice(0, 10),
      PREAWARD_OWNER_CONTRACT_STATUS,
      meta,
      now.slice(0, 10),
      JSON.stringify(data),
      now,
    ),
    database.prepare(
      `UPDATE command_records SET data_json = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND record_type = ?`,
    ).bind(JSON.stringify(nextOpportunityData), now, SALES_PROJECT_ID, opportunityId, OPPORTUNITY_RECORD_TYPE),
    database.prepare(
      `INSERT INTO record_audits (
        project_id, record_id, field_name, old_value, new_value, reason,
        actor_name, actor_email, summary
      ) VALUES (?, ?, 'Pre-Award Owner Contract', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      SALES_PROJECT_ID,
      recordId,
      oldValue,
      `R${revisionNumber}`,
      "Internal Contract Preparation Before Formal Award",
      actor.name,
      actor.email,
      `${actor.name} saved pre-award owner contract revision ${revisionNumber} with ${basisAttachments.length} contract-basis PDF${basisAttachments.length === 1 ? "" : "s"}. It remains nonbinding and internal until formal award.`,
    ),
  ]);

  const saved = await loadPreAwardContract(database, opportunityId);
  return Response.json({
    saved: true,
    record: saved ? toClientRecord(saved, PREAWARD_OWNER_CONTRACT_RECORD_TYPE) : null,
    opportunity: { ...toClientRecord(opportunity, OPPORTUNITY_RECORD_TYPE), data: nextOpportunityData },
    restrictions: preAwardRestrictions(),
  }, { status: existing ? 200 : 201 });
}

function buildPreAwardPrefill(
  opportunity: CommandRow,
  proposal: CommandRow | null,
  contact: LinkedOwnerContractContact | null,
  contractType: OwnerContractType,
  activeInstrument: OwnerContractInstrument,
  actor: { name: string; email: string },
) {
  const data = parseObject(opportunity.data_json);
  const handoff = parseRecord(data.proposalHandoff);
  const project = {
    number: "Pending Award",
    name: String(data.projectName || opportunity.title),
    site: String(data.projectLocation || handoff.projectLocation || ""),
    ownerName: String(handoff.ownerName || data.company || ""),
    ownerContractDate: String(handoff.ownerContractDate || ""),
    architect: String(data.architect || handoff.architect || ""),
    projectType: String(data.projectType || ""),
    contractAmount: data.estimate && typeof data.estimate === "object" ? "" : String(data.estimatedValue || ""),
    startDate: String(handoff.targetStartDate || data.expectedAwardDate || ""),
    substantialDate: String(handoff.substantialDate || ""),
    finalDate: String(handoff.finalDate || ""),
    projectManager: String(data.assignedProjectManager || data.assignedEstimator || actor.name),
    superintendent: String(data.assignedSuperintendent || ""),
    paymentTerms: String(handoff.paymentTerms || ""),
    retainageInitialPercent: String(handoff.retainageInitialPercent || "10"),
    retainageAfterHalfPercent: String(handoff.retainageAfterHalfPercent || "5"),
  };
  const baseFields = defaultContractFields(contractType, project, actor, activeInstrument);
  return buildOwnerContractPrefill({
    baseFields,
    project,
    estimate: data.estimate,
    estimateRecordId: opportunity.id,
    proposal: proposal ? parseObject(proposal.data_json) : null,
    proposalRecordId: proposal?.id,
    contact: contact?.contact,
    contactRecordId: contact?.recordId,
  });
}

async function canManagePreAwardContract(database: D1Database, email: string, accessLevel: string) {
  if (["Company Owner", "Administrator"].includes(accessLevel)) return true;
  const member = await database.prepare(
    `SELECT company_access_level, designations_json FROM company_members WHERE lower(email) = ? AND is_active = 1 LIMIT 1`,
  ).bind(email.toLowerCase()).first<{ company_access_level: string; designations_json: string }>();
  if (!member) return false;
  if (["Company Owner", "Administrator"].includes(member.company_access_level)) return true;
  return parseStringArray(member.designations_json).some((designation) => CONTRACT_DESIGNATIONS.has(designation));
}

async function loadOpportunity(database: D1Database, opportunityId: string) {
  return database.prepare(
    `SELECT id, title, owner, due, status, meta, record_date, date_locked, data_json, updated_at
     FROM command_records WHERE project_id = ? AND id = ? AND record_type = ? LIMIT 1`,
  ).bind(SALES_PROJECT_ID, opportunityId, OPPORTUNITY_RECORD_TYPE).first<CommandRow>();
}

async function loadPreAwardContract(database: D1Database, opportunityId: string) {
  return database.prepare(
    `SELECT id, title, owner, due, status, meta, record_date, date_locked, data_json, updated_at
     FROM command_records WHERE project_id = ? AND id = ? AND record_type = ? LIMIT 1`,
  ).bind(SALES_PROJECT_ID, preAwardOwnerContractRecordId(opportunityId), PREAWARD_OWNER_CONTRACT_RECORD_TYPE).first<CommandRow>();
}

async function loadLatestOwnerProposal(database: D1Database, opportunityId: string) {
  const rows = (await database.prepare(
    `SELECT id, title, owner, due, status, meta, record_date, date_locked, data_json, updated_at
     FROM command_records
     WHERE project_id = ? AND record_type = 'Owner Proposals'
     ORDER BY updated_at DESC`,
  ).bind(SALES_PROJECT_ID).all<CommandRow>()).results.filter((row) =>
    String(parseObject(row.data_json).opportunityId || "") === opportunityId,
  );
  return rows.find((row) => row.status === "Issued")
    || rows.find((row) => row.status === "Approved To Send")
    || rows[0]
    || null;
}

function toClientRecord(row: CommandRow, type: string) {
  return {
    id: row.id,
    type,
    title: row.title,
    owner: row.owner,
    due: row.due,
    status: row.status,
    meta: row.meta,
    recordDate: row.record_date,
    dateLocked: Boolean(row.date_locked),
    updatedAt: row.updated_at,
    data: parseObject(row.data_json),
  };
}

function preAwardRestrictions() {
  return {
    bindingCommitment: false as const,
    accountingSynchronization: false as const,
    ownerPortalAccess: false as const,
    ownerIssue: false as const,
    signatures: false as const,
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseStringArray(value: unknown) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function inferredContractType(opportunity: Record<string, unknown>): OwnerContractType {
  const direct = normalizeOwnerContractType(opportunity.ownerContractType);
  if (direct) return direct;
  const handoff = parseRecord(opportunity.proposalHandoff);
  const fromHandoff = normalizeOwnerContractType(handoff.ownerContractType);
  if (fromHandoff) return fromHandoff;
  return String(opportunity.deliveryMethod || "").includes("Design-Build")
    ? "Design-Build Lump Sum"
    : "Plan & Spec Lump Sum";
}

function normalizeManualFieldKeys(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)))).slice(0, 1_200)
    : [];
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function commandD1() {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}
