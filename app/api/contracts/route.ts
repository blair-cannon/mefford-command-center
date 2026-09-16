import { canReadProjectId } from "../../../lib/project-access";
import { REBASED_CURRENT_CONTRACT_SQL, reconcileAwardContractTotals } from "../../../lib/project-contract-financials";
import {
  applyOwnerContractCommercialTerms,
  contractAmountField,
  contractTemplate,
  defaultContractInstrument,
  defaultContractFields,
  isOwnerContractType,
  normalizeOwnerContractCommercialTerms,
  normalizeOwnerContractType,
  normalizeSmallProjectPricingMethod,
  normalizeContractMoneyFields,
  requiredContractFields,
  synchronizeOwnerContractContactFields,
  type OwnerContractInstrument,
  type OwnerContractType,
  withOwnerContractComputedFields,
} from "../../../lib/owner-contracts";
import {
  buildOwnerContractPrefill,
  mergeOwnerContractPrefill,
  type OwnerContractPrefill,
} from "../../../lib/owner-contract-prefill";
import {
  ownerContractContactReference,
  resolveOwnerContractContact,
} from "../../../lib/owner-contract-contact";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  ensureOwnerPortalSchema,
  hashOwnerSecret,
  parseOwnerObject,
  randomOwnerCode,
} from "../../../lib/owner-portal";
import { sendEmployeeMail } from "../../../lib/microsoft-graph";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { domainEventStatements, reconcileDomainEvent } from "../../../lib/domain-outbox";
import {
  ownerContractBasisAccessStatements,
  validateOwnerContractBasisPdfs,
} from "../../../lib/owner-contract-basis-server";
import type { OwnerContractBasisAttachment } from "../../../lib/owner-contract-basis";

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";
const BILLING_SETUP_ID = "OWNER-BILLING-SETUP";

type ContractPayload = {
  action?: "save" | "sign" | "submit-internal-review" | "approve-owner-review" | "issue-owner-invite" | "respond-change-request" | "approve-final" | "revoke-owner-access" | "open-gmp-exhibit-a";
  projectId?: string;
  recordId?: string;
  contractType?: OwnerContractType;
  releaseForSignature?: boolean;
  fields?: Record<string, unknown>;
  retainageInitialPercent?: number;
  retainageAfterHalfPercent?: number;
  paymentTerms?: string;
  manualFieldKeys?: unknown;
  contactName?: string;
  contactEmail?: string;
  changeRequestId?: string;
  decision?: "Accepted" | "Rejected" | "Revised";
  response?: string;
  signature?: {
    role?: "owner" | "mefford";
    signerName?: string;
    signerTitle?: string;
    signerEmail?: string;
    signatureImage?: string;
    consent?: boolean;
  };
};

type ContractRow = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  data_json: string;
};

type ProjectRow = {
  number: string;
  name: string;
  site: string;
  owner_name: string;
  owner_contract_date: string;
  owner_contract_type: string;
  contract_amount: string;
  current_contract_amount: string;
  payment_terms: string;
  retainage_initial_percent: string;
  retainage_after_half_percent: string;
  architect: string;
  project_type: string;
  project_manager: string;
  superintendent: string;
  start_date: string;
  substantial_date: string;
  final_date: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await ensureOwnerPortalSchema(database);
  await ensureContractProjectColumns(database);
  const project = await database.prepare(
    `SELECT number, name, site, owner_name, owner_contract_date, owner_contract_type,
            contract_amount, current_contract_amount, payment_terms, retainage_initial_percent,
            retainage_after_half_percent, architect, project_type, project_manager,
            superintendent, start_date, substantial_date, final_date
     FROM projects WHERE number = ? LIMIT 1`,
  ).bind(projectId).first<ProjectRow>();
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const { getDb } = await import("../../../db");
  if (!(await canReadProjectId(getDb(), actor, projectId))) return Response.json({ error: "Assigned Project Contract Access Is Required" }, { status: 403 });
  if (!(await canManageContract(database, actor, project))) return Response.json({ error: "Project Contract Access Is Required" }, { status: 403 });
  const url = new URL(request.url);
  const requestedType = normalizeOwnerContractType(url.searchParams.get("contractType"));
  const requestedInstrument = normalizeInstrument(url.searchParams.get("activeInstrument"));
  return contractWorkflowPayload(database, projectId, requestedType || undefined, requestedInstrument || undefined);
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const payload = (await request.json()) as ContractPayload;
    const projectId = payload.projectId?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    const { env } = await import("cloudflare:workers");
    const database = env.DB;
    await ensureOwnerPortalSchema(database);
    await ensureContractProjectColumns(database);
    const project = await database.prepare(
      `SELECT number, name, site, owner_name, owner_contract_date, owner_contract_type,
              contract_amount, current_contract_amount, payment_terms, retainage_initial_percent,
              retainage_after_half_percent, architect, project_type, project_manager,
              superintendent, start_date, substantial_date, final_date
       FROM projects WHERE number = ? LIMIT 1`,
    ).bind(projectId).first<ProjectRow>();
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const { getDb } = await import("../../../db");
  if (!(await canReadProjectId(getDb(), actor, projectId))) return Response.json({ error: "Assigned Project Contract Access Is Required" }, { status: 403 });
  if (!(await canManageContract(database, actor, project))) {
      return Response.json({ error: "Project Manager Administrator Or Company Owner Access Is Required" }, { status: 403 });
    }

    await reconcileAwardContractTotals(database, [projectId]);
    if (payload.action === "sign") return await signContract(database, payload, project, actor);
    if (payload.action && payload.action !== "save") return await ownerWorkflowAction(database, payload, project, actor, request);
    return await saveContract(database, payload, project, actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Owner Contract Could Not Be Saved";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function saveContract(
  database: D1Database,
  payload: ContractPayload,
  project: ProjectRow,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (!isOwnerContractType(payload.contractType)) {
    return Response.json({ error: "Select One Of The Five Controlled Contract Paths" }, { status: 400 });
  }
  const contractType = payload.contractType;
  const recordId = payload.recordId?.trim() || `OWNER-CONTRACT-${project.number}`;
  const existing = await loadContract(database, project.number, recordId);
  const existingData = parseObject(existing?.data_json);
  const existingType = normalizeOwnerContractType(existingData.contractType);
  const activeInstrument = String(existingType === contractType ? existingData.activeInstrument || defaultContractInstrument(contractType) : defaultContractInstrument(contractType)) as OwnerContractInstrument;
  const incomingFields = normalizeFields(payload.fields);
  const prefill = await loadOwnerContractPrefill(database, project.number, contractType, activeInstrument, project);
  const explicitManualKeys = Array.isArray(payload.manualFieldKeys)
    ? normalizeManualFieldKeys(payload.manualFieldKeys)
    : null;
  const savedManualKeys = normalizeManualFieldKeys(existingData.manualFieldKeys);
  let manualFieldKeys = explicitManualKeys || (savedManualKeys.length
    ? savedManualKeys
    : inferLegacyManualFields(incomingFields, prefill));
  const merged = mergeOwnerContractPrefill(incomingFields, prefill, manualFieldKeys, true);
  const routing = synchronizeOwnerContractContactFields(merged.fields, manualFieldKeys);
  let fields = withOwnerContractComputedFields(contractType, routing.fields);
  manualFieldKeys = routing.manualFieldKeys;
  const commercial = normalizeOwnerContractCommercialTerms({
    paymentTerms: payload.paymentTerms ?? fields.PAYMENT_TERMS,
    retainageInitialPercent: payload.retainageInitialPercent ?? project.retainage_initial_percent,
    retainageAfterHalfPercent: payload.retainageAfterHalfPercent ?? project.retainage_after_half_percent,
  });
  applyOwnerContractCommercialTerms(fields, commercial);
  let basisAttachments: OwnerContractBasisAttachment[];
  try {
    const validatedBasis = await validateOwnerContractBasisPdfs(database, project.number, fields);
    fields = validatedBasis.fields;
    basisAttachments = validatedBasis.attachments;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Contract Basis PDFs Could Not Be Verified" }, { status: 409 });
  }
  const fieldSources = {
    ...merged.sources,
    ...Object.fromEntries(manualFieldKeys.map((field) => [field, { kind: "Manual", label: "Manual Override" }])),
  };
  const template = contractTemplate(contractType, activeInstrument);
  const missing = requiredContractFields(contractType, activeInstrument, fields).filter((field) => !fields[field]?.trim());
  if (payload.releaseForSignature && missing.length) {
    return Response.json({
      error: `Complete ${missing.length} Required Contract Field${missing.length === 1 ? "" : "s"} Before Release`,
      missingFields: missing,
    }, { status: 409 });
  }
  if (existing?.status === "Executed") {
    return Response.json({ error: "The Executed Contract Is Immutable. Create A Controlled Amendment Instead." }, { status: 409 });
  }
  if (existing && !["Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"].includes(existing.status)) {
    return Response.json({ error: "This Released Revision Is Read-Only. Complete The Owner Review Or Open A Controlled Mefford Revision Before Editing." }, { status: 409 });
  }
  const now = new Date().toISOString();
  const effectiveDate = fields.EFFECTIVE_DATE || project.owner_contract_date || now.slice(0, 10);
  const priorPhase = String(existingData.contractPhase || existing?.status || "Draft Preparation");
  const status = priorPhase === "Mefford Revision" ? "Mefford Revision" : activeInstrument === "GMP Exhibit A" ? "GMP Exhibit A Draft" : "Draft Preparation";
  const retainageInitialPercent = clampPercent(commercial.retainageInitialPercent, 10);
  const retainageAfterHalfPercent = clampPercent(commercial.retainageAfterHalfPercent, 5);
  const paymentTerms = commercial.paymentTerms;
  const contractAmount = contractAmountFor(contractType, fields, project.contract_amount, activeInstrument);
  const data = {
    ...existingData,
    contractType,
    pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    templateId: template.id,
    templateVersion: template.version,
    templateHtmlPath: template.htmlPath,
    templateDocxPath: template.docxPath,
    agreementSource: template.source,
    activeInstrument,
    phaseExecutions: existingType === contractType ? existingData.phaseExecutions || {} : {},
    fields,
    contractBasisAttachments: basisAttachments,
    fieldSources,
    manualFieldKeys,
    sourceSummary: prefill.summary,
    sourceRefresh: {
      estimateRecordId: sourceRecordId(prefill, "Estimate"),
      proposalRecordId: sourceRecordId(prefill, "Proposal"),
      contactRecordId: crmContactRecordId(prefill),
      refreshedAt: now,
      refreshedBy: actor.name,
    },
    missingRequiredFields: missing,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    paymentTerms,
    sourceOfTruth: "Owner Contract Record",
    contractPhase: status,
    synchronization: {
      project: true,
      accounting: true,
      ownerBilling: true,
      synchronizedAt: now,
      synchronizedBy: actor.name,
    },
    signatures: existingData.signatures || {},
    attorneyReviewNotice: undefined,
    controlledMasterNotice: `${template.id} · ${template.version}`,
    savedAt: now,
    savedBy: actor.name,
  };
  const title = contractType === "External Contract" ? `${project.name} · External Contract Control` : `${project.name} · ${template.label}`;
  const meta = `${template.id} · ${formatMoney(contractAmount)} · ${missing.length ? `${missing.length} Required Fields Open` : status}`;
  const billingSetup = await loadRecordData(database, project.number, BILLING_SETUP_ID);
  const billingData = {
    ...billingSetup,
    projectNumber: project.number,
    contractRecordId: recordId,
    contractType,
    pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    contractAmount,
    phaseOneAuthorizationAmount: contractType === "Design-Build GMP" ? fields.PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE || fields.TOTAL_PHASE_ONE_FEE || "" : "",
    gmpAmount: contractType === "Design-Build GMP" ? fields.GMP_AMOUNT || "" : "",
    ownerContactRecordId: crmContactRecordId(prefill),
    ownerContactName: fields.OWNER_SIGNATORY || fields.OWNER_NOTICE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    ownerContactTitle: fields.OWNER_SIGNATORY_TITLE || "",
    ownerContactEmail: fields.OWNER_NOTICE_EMAIL || fields.OWNER_EMAIL || "",
    ownerContactPhone: fields.OWNER_NOTICE_PHONE || fields.OWNER_PHONE || "",
    ownerMailingAddress: fields.OWNER_DELIVERY_ADDRESS || [fields.OWNER_NOTICE_ADDRESS_LINE_1, fields.OWNER_NOTICE_ADDRESS_LINE_2].filter(Boolean).join("\n"),
    invoiceDeliveryMethodRecipient: fields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
    primarySiteContact: fields.PRIMARY_SITE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    contractStatus: status,
    sourceOfTruth: "Owner Contract Record",
    synchronizedAt: now,
  };
  const accountingData = {
    projectNumber: project.number,
    projectName: project.name,
    ownerName: fields.OWNER_LEGAL_NAME || project.owner_name,
    contractRecordId: recordId,
    contractType,
    pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    contractAmount,
    phaseOneAuthorizationAmount: contractType === "Design-Build GMP" ? fields.PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE || fields.TOTAL_PHASE_ONE_FEE || "" : "",
    gmpAmount: contractType === "Design-Build GMP" ? fields.GMP_AMOUNT || "" : "",
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    ownerContactRecordId: crmContactRecordId(prefill),
    ownerContactName: fields.OWNER_SIGNATORY || fields.OWNER_NOTICE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    ownerContactEmail: fields.OWNER_NOTICE_EMAIL || fields.OWNER_EMAIL || "",
    ownerContactPhone: fields.OWNER_NOTICE_PHONE || fields.OWNER_PHONE || "",
    invoiceDeliveryMethodRecipient: fields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
    contractStatus: status,
    effectiveDate,
    sourceOfTruth: "Owner Contract Record",
    synchronizedAt: now,
  };
  const revisionNumber = await nextRevisionNumber(database, project.number, recordId);
  const revisionId = `${recordId}-R${revisionNumber}`;
  const snapshotHash = await sha256(JSON.stringify({ contractType, activeInstrument, fields, paymentTerms, retainageInitialPercent, retainageAfterHalfPercent }));

  await database.batch([
    upsertRecord(database, project.number, recordId, "Contracts", title, actor.name, effectiveDate, status, meta, effectiveDate, data, now),
    database.prepare(
      `UPDATE projects SET owner_name = ?, owner_contract_date = ?, owner_contract_type = ?,
         owner_contract_status = ?, owner_contract_record_id = ?, payment_terms = ?,
         retainage_initial_percent = ?, retainage_after_half_percent = ?, contract_amount = ?,
         current_contract_amount = ${REBASED_CURRENT_CONTRACT_SQL},
         updated_at = ? WHERE number = ?`,
    ).bind(
      fields.OWNER_LEGAL_NAME || project.owner_name,
      effectiveDate,
      contractType,
      status,
      recordId,
      paymentTerms,
      String(retainageInitialPercent),
      String(retainageAfterHalfPercent),
      contractAmount,
      contractAmount,
      now,
      project.number,
    ),
    upsertRecord(
      database,
      project.number,
      BILLING_SETUP_ID,
      "Owner Billing Setup",
      `${project.name} First Owner Invoice Structure`,
      actor.name,
      effectiveDate,
      "Owner Action Required",
      `${contractType} · Synchronized From ${recordId}`,
      effectiveDate,
      billingData,
      now,
    ),
    upsertRecord(
      database,
      ACCOUNTING_PROJECT_ID,
      `OWNER-CONTRACT-${project.number}`,
      "Owner Contract Setup",
      `${project.number} · ${project.name} Owner Contract`,
      actor.name,
      effectiveDate,
      status,
      `${contractType} · ${formatMoney(contractAmount)}`,
      effectiveDate,
      accountingData,
      now,
    ),
    database.prepare(
      `INSERT INTO owner_portal_access (project_id, contract_record_id, status, updated_at)
       VALUES (?, ?, 'Dormant', ?)
       ON CONFLICT(project_id) DO UPDATE SET contract_record_id = excluded.contract_record_id, updated_at = excluded.updated_at`,
    ).bind(project.number, recordId, now),
    database.prepare(
      `INSERT INTO owner_contract_revisions (
        id, project_id, contract_record_id, revision_number, phase, contract_type,
        fields_json, snapshot_hash, note, created_by_type, created_by_name,
        created_by_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Mefford', ?, ?, ?)`,
    ).bind(revisionId, project.number, recordId, revisionNumber, status, contractType, JSON.stringify(fields), snapshotHash, payload.releaseForSignature ? "Legacy release request converted to controlled draft; Company Owner review remains required." : "Controlled draft saved.", actor.name, actor.email, now),
    auditStatement(database, project.number, recordId, existing?.status || "Not Created", status, actor, `Saved ${contractType} owner contract with ${basisAttachments.length} contract-basis PDF${basisAttachments.length === 1 ? "" : "s"} and synchronized Project Accounting and Owner Billing.`),
  ]);

  const savedFinancials = await database.prepare(`SELECT current_contract_amount FROM projects WHERE number = ?`)
    .bind(project.number).first<{ current_contract_amount: string }>();
  return Response.json({
    record: clientRecord({ id: recordId, title, owner: actor.name, due: effectiveDate, status, meta, record_date: effectiveDate, data_json: JSON.stringify(data) }),
    project: {
      ownerContractType: contractType,
      ownerContractStatus: status,
      ownerContractRecordId: recordId,
      paymentTerms,
      retainageInitialPercent: String(retainageInitialPercent),
      retainageAfterHalfPercent: String(retainageAfterHalfPercent),
      contractAmount,
      currentContractAmount: savedFinancials?.current_contract_amount || contractAmount,
    },
    accountingSynchronized: true,
    revisionId,
  });
}

async function signContract(
  database: D1Database,
  payload: ContractPayload,
  project: ProjectRow,
  actor: ReturnType<typeof getCommandActor>,
) {
  const recordId = payload.recordId?.trim() || `OWNER-CONTRACT-${project.number}`;
  const record = await loadContract(database, project.number, recordId);
  if (!record) return Response.json({ error: "Save And Release The Contract Before Signing" }, { status: 404 });
  const storedData = parseObject(record.data_json);
  const normalizedType = normalizeOwnerContractType(storedData.contractType);
  if (!normalizedType) {
    return Response.json({ error: "The Contract Type Is Invalid" }, { status: 409 });
  }
  if (!["Ready for Signature", "Owner Signed", "Partially Signed"].includes(record.status)) {
    return Response.json({ error: "The Contract Must Be Released For Signature First" }, { status: 409 });
  }
  const signature = payload.signature;
  if (!signature?.consent || !signature.role || !signature.signerName?.trim() || !signature.signerTitle?.trim() || !validSignatureImage(signature.signatureImage)) {
    return Response.json({ error: "Typed Identity Title Consent And Drawn Signature Are Required" }, { status: 400 });
  }
  if (signature.role === "owner") {
    return Response.json({ error: "The Project Owner Must Sign Through Their Dedicated Owner Portal" }, { status: 403 });
  }
  if (signature.role === "mefford" && !["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    return Response.json({ error: "A Company Owner Or Administrator Must Sign For Mefford" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const data = storedData;
  const activeInstrument = String(data.activeInstrument || defaultContractInstrument(normalizedType)) as OwnerContractInstrument;
  const signatures = parseObject(data.signatures);
  if (!parseObject(signatures.owner).signedAt) {
    return Response.json({ error: "The Project Owner Must Sign The Frozen Revision Before Mefford Countersigns" }, { status: 409 });
  }
  signatures[signature.role] = {
    signerName: signature.signerName.trim(),
    signerTitle: signature.signerTitle.trim(),
    signerEmail: signature.signerEmail?.trim() || "",
    signatureImage: signature.signatureImage,
    signedAt: now,
    capturedBy: actor.name,
    capturedByEmail: actor.email,
    consentText: "I reviewed and agree to this exact controlled contract packet and intend this electronic signature to be binding.",
  };
  const instrumentExecuted = Boolean(parseObject(signatures.owner).signedAt && parseObject(signatures.mefford).signedAt);
  const phaseOneExecution = instrumentExecuted && normalizedType === "Design-Build GMP" && activeInstrument === "Phase 1 Agreement";
  const fullyExecuted = instrumentExecuted && !phaseOneExecution;
  const status = phaseOneExecution ? "Phase 1 Executed" : fullyExecuted ? "Executed" : "Owner Signed";
  const executionHash = instrumentExecuted ? await sha256(JSON.stringify({ projectId: project.number, recordId, activeInstrument, data: { ...data, signatures }, executedAt: now })) : "";
  const fields = normalizeFields(data.fields);
  const ownerSignature = parseObject(signatures.owner);
  const meffordSignature = parseObject(signatures.mefford);
  Object.assign(fields, {
    OWNER_SIGNATORY: String(ownerSignature.signerName || fields.OWNER_SIGNATORY || ""),
    OWNER_SIGNATORY_TITLE: String(ownerSignature.signerTitle || fields.OWNER_SIGNATORY_TITLE || ""),
    OWNER_SIGNATURE_DATE: String(ownerSignature.signedAt || "").slice(0, 10),
    CONTRACTOR_SIGNATORY: String(meffordSignature.signerName || fields.CONTRACTOR_SIGNATORY || ""),
    CONTRACTOR_SIGNATORY_TITLE: String(meffordSignature.signerTitle || fields.CONTRACTOR_SIGNATORY_TITLE || ""),
    CONTRACTOR_SIGNATURE_DATE: String(meffordSignature.signedAt || "").slice(0, 10),
    DESIGN_BUILDER_SIGNATORY: String(meffordSignature.signerName || fields.DESIGN_BUILDER_SIGNATORY || ""),
    DESIGN_BUILDER_SIGNATORY_TITLE: String(meffordSignature.signerTitle || fields.DESIGN_BUILDER_SIGNATORY_TITLE || ""),
    DESIGN_BUILDER_SIGNATURE_DATE: String(meffordSignature.signedAt || "").slice(0, 10),
    DOCUMENT_HASH_AT_EXECUTION: executionHash,
    SIGNATURE_AUDIT_RECORD_ID: instrumentExecuted ? `${recordId}-${activeInstrument}-${now}` : "Pending second signature",
  });
  const phaseExecutions = parseObject(data.phaseExecutions);
  if (instrumentExecuted) {
    phaseExecutions[activeInstrument === "GMP Exhibit A" ? "gmpExhibitA" : activeInstrument === "Phase 1 Agreement" ? "phase1" : "primary"] = {
      instrument: activeInstrument,
      fields: { ...fields },
      signatures: { ...signatures },
      executionHash,
      executedAt: now,
    };
  }
  const nextData = {
    ...data,
    fields,
    signatures,
    signatureStatus: status,
    phaseExecutions,
    executedAt: fullyExecuted ? now : null,
    instrumentExecutedAt: instrumentExecuted ? now : null,
    executionHash,
    immutableAt: instrumentExecuted ? now : null,
    contractPhase: status,
  };
  const meta = `${String(data.contractType)} · ${status}${executionHash ? ` · ${executionHash.slice(0, 12)}` : ""}`;
  const accountingRecord = await loadRecordData(database, ACCOUNTING_PROJECT_ID, `OWNER-CONTRACT-${project.number}`);
  const billingSetup = await loadRecordData(database, project.number, BILLING_SETUP_ID);
  const storedContractType = normalizedType;
  const contractAmount = contractAmountFor(storedContractType, fields, project.contract_amount, activeInstrument);
  const startDate = controlledDate(fields.CONSTRUCTION_COMMENCEMENT_DATE, project.start_date);
  const substantialDate = controlledDate(fields.SUBSTANTIAL_COMPLETION_DATE || fields.SUBSTANTIAL_COMPLETION_DATE_OR_TBD, project.substantial_date);
  const finalDate = controlledDate(fields.FINAL_COMPLETION_DATE || fields.FINAL_COMPLETION_DATE_OR_TBD, project.final_date);
  const domainEventId = `owner-contract-executed:${project.number}:${recordId}:${executionHash}`;
  const reconciliationStatements = fullyExecuted ? domainEventStatements(database, {
    id: domainEventId,
    idempotencyKey: `owner-contract-executed:${project.number}:${recordId}:${executionHash}`,
    eventType: "owner-contract.executed",
    aggregateType: "Owner Contract",
    aggregateId: recordId,
    projectId: project.number,
    actorName: actor.name,
    actorEmail: actor.email,
    occurredAt: now,
    payload: { projectId: project.number, recordId, executionHash, contractAmount, startDate, substantialDate, finalDate },
    consumers: [
      { key: "project-contract-status", completedInSourceTransaction: true, result: { status, contractAmount } },
      { key: "owner-portal-contract-status", completedInSourceTransaction: true, result: { status, executionHash } },
      { key: "contract-audit-history", completedInSourceTransaction: true, result: { action: "Contract Executed" } },
    ],
  }) : [];
  await database.batch([
    upsertRecord(database, project.number, recordId, "Contracts", record.title, actor.name, record.due, status, meta, record.record_date || record.due, nextData, now),
    database.prepare(
      `UPDATE projects SET owner_contract_status = ?, owner_contract_record_id = ?,
       owner_contract_date = CASE WHEN ? = 'Executed' THEN ? ELSE owner_contract_date END,
       contract_amount = ?,
       current_contract_amount = ${REBASED_CURRENT_CONTRACT_SQL},
       start_date = ?, substantial_date = ?, final_date = ?,
       updated_at = ? WHERE number = ?`,
    ).bind(status, recordId, status, now.slice(0, 10), contractAmount, contractAmount, startDate, substantialDate, finalDate, now, project.number),
    upsertRecord(
      database,
      ACCOUNTING_PROJECT_ID,
      `OWNER-CONTRACT-${project.number}`,
      "Owner Contract Setup",
      `${project.number} · ${project.name} Owner Contract`,
      actor.name,
      record.due,
      status,
      meta,
      record.record_date || record.due,
      { ...accountingRecord, contractAmount, contractStatus: status, startDate, substantialDate, finalDate, executedAt: fullyExecuted ? now : null, executionHash },
      now,
    ),
    upsertRecord(
      database,
      project.number,
      BILLING_SETUP_ID,
      "Owner Billing Setup",
      `${project.name} First Owner Invoice Structure`,
      actor.name,
      record.due,
      fullyExecuted ? "Ready For SOV" : phaseOneExecution ? "Phase 1 Billing Ready" : String(billingSetup.status || "Owner Action Required"),
      `${String(data.contractType)} · Contract ${status}`,
      record.record_date || record.due,
      { ...billingSetup, contractAmount, phaseOneAuthorizationAmount: storedContractType === "Design-Build GMP" ? fields.PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE || fields.TOTAL_PHASE_ONE_FEE || "" : "", gmpAmount: storedContractType === "Design-Build GMP" ? fields.GMP_AMOUNT || "" : "", contractStatus: status, scheduleMilestones: fullyExecuted ? { startDate, substantialDate, finalDate } : {}, executedAt: fullyExecuted ? now : null, phaseOneExecutedAt: phaseOneExecution ? now : null, executionHash },
      now,
    ),
    ...(fullyExecuted ? [
      upsertRecord(database, project.number, "CONTRACT-MILESTONE-START", "Schedule", "Contract Start", project.project_manager, startDate, "Scheduled", `Executed Owner Contract · ${startDate}`, startDate, { milestone: true, start: startDate, finish: startDate, progress: 0, sourceType: "Executed Owner Contract", sourceRecordId: recordId }, now),
      upsertRecord(database, project.number, "CONTRACT-MILESTONE-SUBSTANTIAL", "Schedule", "Substantial Completion", project.project_manager, substantialDate, "Scheduled", `Executed Owner Contract · ${substantialDate}`, substantialDate, { milestone: true, start: substantialDate, finish: substantialDate, progress: 0, sourceType: "Executed Owner Contract", sourceRecordId: recordId }, now),
      upsertRecord(database, project.number, "CONTRACT-MILESTONE-FINAL", "Schedule", "Final Completion", project.project_manager, finalDate, "Scheduled", `Executed Owner Contract · ${finalDate}`, finalDate, { milestone: true, start: finalDate, finish: finalDate, progress: 0, sourceType: "Executed Owner Contract", sourceRecordId: recordId }, now),
    ] : []),
    auditStatement(database, project.number, recordId, record.status, status, actor, "Mefford signature captured for the exact controlled contract packet."),
    database.prepare(
      `UPDATE owner_portal_access SET status = ?, updated_at = ? WHERE project_id = ?`,
    ).bind(status, now, project.number),
    database.prepare(
      `INSERT INTO owner_portal_audits (project_id, contract_record_id, actor_type, actor_name, actor_email, action, detail)
       VALUES (?, ?, 'Mefford', ?, ?, ?, ?)`,
    ).bind(project.number, recordId, actor.name, actor.email, fullyExecuted ? "Contract Executed" : phaseOneExecution ? "Phase 1 Design Authorization Executed" : "Mefford Signature Recorded", fullyExecuted ? `Executed contract hash ${executionHash}. Downstream records synchronized.` : phaseOneExecution ? `Phase 1 execution hash ${executionHash}. Construction remains blocked until GMP Exhibit A is executed.` : "Mefford signature recorded after Project Owner signature."),
    ...reconciliationStatements,
  ]);

  const handoff = fullyExecuted ? await reconcileDomainEvent(database, domainEventId) : null;

  return Response.json({
    record: clientRecord({ ...record, owner: actor.name, status, meta, data_json: JSON.stringify(nextData) }),
    fullyExecuted,
    instrumentExecuted,
    nextStep: phaseOneExecution ? "Open GMP Exhibit A when design is complete" : fullyExecuted ? "Contract complete" : "Mefford countersignature required",
    accountingSynchronized: true,
    handoff: handoff ? { eventId: domainEventId, status: handoff.status, consumers: handoff.consumers } : null,
  });
}

async function ownerWorkflowAction(
  database: D1Database,
  payload: ContractPayload,
  project: ProjectRow,
  actor: ReturnType<typeof getCommandActor>,
  request: Request,
) {
  const recordId = payload.recordId?.trim() || `OWNER-CONTRACT-${project.number}`;
  const record = await loadContract(database, project.number, recordId);
  if (!record) return Response.json({ error: "Save The Owner Contract Draft First" }, { status: 404 });
  if (record.status === "Executed") return Response.json({ error: "The Executed Contract Is Immutable" }, { status: 409 });
  const data = parseObject(record.data_json);
  const fields = normalizeFields(data.fields);
  const contractType = normalizeOwnerContractType(data.contractType);
  const activeInstrument = String(data.activeInstrument || (contractType ? defaultContractInstrument(contractType) : "Primary Agreement")) as OwnerContractInstrument;
  const now = new Date().toISOString();
  const companyOwner = actor.accessLevel === "Company Owner";

  if (payload.action === "open-gmp-exhibit-a") {
    if (contractType !== "Design-Build GMP" || activeInstrument !== "Phase 1 Agreement" || record.status !== "Phase 1 Executed") {
      return Response.json({ error: "An Executed Design-Build GMP Phase 1 Agreement Is Required" }, { status: 409 });
    }
    const phaseExecutions = parseObject(data.phaseExecutions);
    if (!parseObject(phaseExecutions.phase1).executionHash) return Response.json({ error: "The Preserved Phase 1 Execution Could Not Be Verified" }, { status: 409 });
    const manualFieldKeys = normalizeManualFieldKeys(data.manualFieldKeys);
    const exhibitPrefill = await loadOwnerContractPrefill(database, project.number, "Design-Build GMP", "GMP Exhibit A", project);
    const exhibitMerge = mergeOwnerContractPrefill(fields, exhibitPrefill, manualFieldKeys, true);
    const exhibitFields = exhibitMerge.fields;
    const revisionNumber = await nextRevisionNumber(database, project.number, recordId);
    const revisionId = `${recordId}-R${revisionNumber}`;
    const snapshotHash = await sha256(JSON.stringify({ contractType, activeInstrument: "GMP Exhibit A", fields: exhibitFields }));
    const exhibitTemplate = contractTemplate("Design-Build GMP", "GMP Exhibit A");
    const nextData = { ...data, activeInstrument: "GMP Exhibit A", templateId: exhibitTemplate.id, templateVersion: exhibitTemplate.version, templateHtmlPath: exhibitTemplate.htmlPath, templateDocxPath: exhibitTemplate.docxPath, fields: exhibitFields, fieldSources: { ...exhibitMerge.sources, ...manualSources(manualFieldKeys) }, sourceSummary: exhibitPrefill.summary, signatures: {}, contractPhase: "GMP Exhibit A Draft", gmpExhibitOpenedAt: now, gmpExhibitOpenedBy: actor.name, immutableAt: null };
    await database.batch([
      database.prepare(`UPDATE command_records SET status = 'GMP Exhibit A Draft', date_locked = 0, data_json = ?, meta = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify(nextData), `Design-Build GMP · Exhibit A Draft · Phase 1 Preserved`, now, project.number, recordId),
      database.prepare(`UPDATE projects SET owner_contract_status = 'GMP Exhibit A Draft', updated_at = ? WHERE number = ?`).bind(now, project.number),
      database.prepare(`UPDATE owner_portal_invites SET status = 'Revoked', revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL`).bind(now, project.number),
      database.prepare(`UPDATE owner_portal_access SET status = 'Dormant', approved_revision_id = '', invited_at = NULL, revoked_at = NULL, updated_at = ? WHERE project_id = ?`).bind(now, project.number),
      database.prepare(`INSERT INTO owner_contract_revisions (id, project_id, contract_record_id, revision_number, phase, contract_type, fields_json, snapshot_hash, note, created_by_type, created_by_name, created_by_email, created_at) VALUES (?, ?, ?, ?, 'GMP Exhibit A Draft', ?, ?, ?, 'Phase 1 execution preserved. Exhibit A opened for final GMP and construction authorization.', 'Mefford', ?, ?, ?)`).bind(revisionId, project.number, recordId, revisionNumber, contractType, JSON.stringify(exhibitFields), snapshotHash, actor.name, actor.email, now),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "GMP Exhibit A Opened", "Signed Phase 1 remained immutable; customer access reset until Company Owner approves the Exhibit A revision."),
      auditStatement(database, project.number, recordId, "Phase 1 Executed", "GMP Exhibit A Draft", actor, "Opened the separate GMP Exhibit A workflow without altering the signed Phase 1 authorization."),
    ]);
    return contractWorkflowPayload(database, project.number);
  }

  if (payload.action === "submit-internal-review") {
    if (!["Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"].includes(record.status)) return Response.json({ error: "Only An Editable Mefford Draft Can Enter Internal Review" }, { status: 409 });
    await setContractPhase(database, project.number, record, data, "Internal Review", actor, "Draft submitted for internal review.", now);
    return contractWorkflowPayload(database, project.number);
  }

  if (payload.action === "approve-owner-review") {
    if (!companyOwner) return Response.json({ error: "Company Owner Approval Is Required Before Customer Review" }, { status: 403 });
    if (!["Internal Review", "Mefford Revision"].includes(record.status)) return Response.json({ error: "Complete Internal Review Or Mefford Revision First" }, { status: 409 });
    if (!contractType) return Response.json({ error: "The Contract Type Is Invalid" }, { status: 409 });
    const missing = requiredContractFields(contractType, activeInstrument, fields).filter((field) => !fields[field]?.trim());
    if (missing.length) return Response.json({ error: `Complete ${missing.length} Required Contract Field${missing.length === 1 ? "" : "s"} Before Owner Review`, missingFields: missing }, { status: 409 });
    if (contractType === "External Contract" && (fields.EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION !== "YES — THE UPLOADED EXTERNAL AGREEMENT CONTROLS" || !/^\d+$/.test(fields.EXTERNAL_CONTRACT_FILE_ID || ""))) {
      return Response.json({ error: "Upload The External Agreement And Confirm That The Original Controls Before Owner Review", missingFields: ["EXTERNAL_CONTRACT_FILE_ID", "EXTERNAL_CONTRACT_CONTROLS_CONFIRMATION"] }, { status: 409 });
    }
    if (contractType === "External Contract") {
      const sourceFile = await database.prepare(`SELECT id FROM project_files WHERE id = ? AND project_id = ? AND category = 'Contracts / External Agreement' LIMIT 1`).bind(Number(fields.EXTERNAL_CONTRACT_FILE_ID), project.number).first<{ id: number }>();
      if (!sourceFile) return Response.json({ error: "The Controlling External Contract File Must Belong To This Project" }, { status: 409 });
    }
    const revision = await latestRevision(database, project.number, recordId);
    if (!revision) return Response.json({ error: "Save A Controlled Revision Before Approval" }, { status: 409 });
    let basisAttachments: OwnerContractBasisAttachment[];
    try {
      basisAttachments = (await validateOwnerContractBasisPdfs(database, project.number, fields)).attachments;
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The Contract Basis PDFs Could Not Be Verified" }, { status: 409 });
    }
    await database.batch([
      database.prepare(`UPDATE owner_contract_revisions SET phase = 'Approved for Owner Review' WHERE id = ?`).bind(revision.id),
      database.prepare(`UPDATE command_records SET status = 'Approved for Owner Review', data_json = ?, meta = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify({ ...data, contractPhase: "Approved for Owner Review", ownerReviewRevisionId: revision.id, ownerReviewApprovedBy: actor.name, ownerReviewApprovedAt: now }), `${contractType} · R${revision.revision_number} · Approved For Owner Review`, now, project.number, recordId),
      database.prepare(`INSERT INTO owner_portal_access (project_id, contract_record_id, status, approved_revision_id, approved_by, approved_at, updated_at) VALUES (?, ?, 'Approved for Owner Review', ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET contract_record_id = excluded.contract_record_id, status = excluded.status, approved_revision_id = excluded.approved_revision_id, approved_by = excluded.approved_by, approved_at = excluded.approved_at, revoked_at = NULL, updated_at = excluded.updated_at`).bind(project.number, recordId, revision.id, actor.name, now, now),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "Approved For Owner Review", `Company Owner approved revision R${revision.revision_number} for customer review.`),
      auditStatement(database, project.number, recordId, record.status, "Approved for Owner Review", actor, `Company Owner approved immutable revision R${revision.revision_number} for Project Owner review.`),
      ...ownerContractBasisAccessStatements(database, project.number, basisAttachments),
    ]);
    return contractWorkflowPayload(database, project.number);
  }

  if (payload.action === "issue-owner-invite") {
    if (!["Company Owner", "Administrator"].includes(actor.accessLevel)) return Response.json({ error: "Company Owner Or Administrator Access Is Required To Issue The Approved Invite" }, { status: 403 });
    const access = await database.prepare(`SELECT status, approved_revision_id FROM owner_portal_access WHERE project_id = ? LIMIT 1`).bind(project.number).first<{ status: string; approved_revision_id: string }>();
    if (!access || !["Approved for Owner Review", "Owner Review", "Changes Requested", "Owner Review Complete"].includes(access.status)) return Response.json({ error: "The Company Owner Must Approve A Contract Revision Before An Invite Can Be Issued" }, { status: 409 });
    const contactName = payload.contactName?.trim().slice(0, 160) || "";
    const contactEmail = payload.contactEmail?.trim().toLowerCase().slice(0, 320) || "";
    if (!contactName || !/^\S+@\S+\.\S+$/.test(contactEmail)) return Response.json({ error: "Project Owner Name And Valid Email Are Required" }, { status: 400 });
    const inviteId = `OWN-${crypto.randomUUID()}`;
    const code = randomOwnerCode();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const link = `${new URL(request.url).origin}/?ownerPortal=${encodeURIComponent(inviteId)}`;
    await database.batch([
      database.prepare(`UPDATE owner_portal_invites SET status = 'Revoked', revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL`).bind(now, project.number),
      database.prepare(`INSERT INTO owner_portal_invites (id, project_id, contract_record_id, contact_name, email, code_hash, status, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Issued', ?, ?, ?)`).bind(inviteId, project.number, recordId, contactName, contactEmail, await hashOwnerSecret(code), expiresAt, actor.email, now),
      database.prepare(`UPDATE owner_portal_access SET status = 'Owner Review', contact_name = ?, contact_email = ?, invited_at = ?, revoked_at = NULL, updated_at = ? WHERE project_id = ?`).bind(contactName, contactEmail, now, now, project.number),
      database.prepare(`UPDATE command_records SET status = 'Owner Review', data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify({ ...data, contractPhase: "Owner Review", ownerContactName: contactName, ownerContactEmail: contactEmail, ownerInviteIssuedAt: now }), now, project.number, recordId),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "Project Owner Invite Issued", `${contactName} · ${contactEmail} · Expires ${expiresAt}`),
    ]);
    let deliveryStatus = "Manual Send Required";
    let providerReceipt: Record<string, unknown> | null = null;
    try {
      providerReceipt = await sendEmployeeMail(actor.email, {
        subject: `${project.name} contract review · Mefford Contracting`,
        recipients: [contactEmail],
        bodyText: `Hello ${contactName},\n\nMefford Contracting has prepared the ${project.name} contract for your review.\n\nOpen: ${link}\nOne-time code: ${code}\n\nThe link expires ${new Date(expiresAt).toLocaleDateString("en-US")}. You will only see the project information Mefford has released to you.`,
      });
      deliveryStatus = "Provider Accepted Through Microsoft 365";
      await portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "Owner Invite Provider Acceptance", `${providerReceipt.requestId || providerReceipt.clientRequestId || "Receipt Recorded"} · Microsoft Graph accepted the request; inbox delivery is not claimed.`).run();
    } catch {
      deliveryStatus = "Delivery Deferred · Microsoft 365 Not Connected · Copy The Secure Invite";
    }
    const workflow = await contractWorkflowObject(database, project.number);
    return Response.json({ ...workflow, invite: { id: inviteId, link, code, email: contactEmail, expiresAt, deliveryStatus, providerReceipt } });
  }

  if (payload.action === "respond-change-request") {
    const requestId = payload.changeRequestId?.trim() || "";
    const decision = payload.decision;
    const response = payload.response?.trim().slice(0, 5000) || "";
    if (!requestId || !decision || !response) return Response.json({ error: "Request Decision And Response Are Required" }, { status: 400 });
    const change = await database.prepare(`SELECT * FROM owner_contract_change_requests WHERE id = ? AND project_id = ? AND status = 'Open' LIMIT 1`).bind(requestId, project.number).first<Record<string, unknown>>();
    if (!change) return Response.json({ error: "Open Change Request Not Found" }, { status: 404 });
    const nextFields = { ...fields };
    const clauseKey = String(change.clause_key);
    const manualFieldKeys = new Set(normalizeManualFieldKeys(data.manualFieldKeys));
    const fieldSources = parseObject(data.fieldSources);
    if (decision === "Accepted") {
      nextFields[clauseKey] = String(change.proposed_text || "");
      manualFieldKeys.add(clauseKey);
      fieldSources[clauseKey] = { kind: "Manual", label: "Owner Change Accepted By Mefford" };
    }
    const revisionNumber = await nextRevisionNumber(database, project.number, recordId);
    const revisionId = `${recordId}-R${revisionNumber}`;
    const snapshotHash = await sha256(JSON.stringify({ contractType, fields: nextFields }));
    await database.batch([
      database.prepare(`UPDATE owner_contract_change_requests SET status = ?, mefford_response = ?, resolved_by_name = ?, resolved_by_email = ?, resolved_at = ?, updated_at = ? WHERE id = ?`).bind(decision, response, actor.name, actor.email, now, now, requestId),
      database.prepare(`UPDATE command_records SET status = 'Mefford Revision', data_json = ?, meta = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify({ ...data, fields: nextFields, fieldSources, manualFieldKeys: [...manualFieldKeys], contractPhase: "Mefford Revision", savedAt: now, savedBy: actor.name }), `${contractType} · R${revisionNumber} · Mefford Revision`, now, project.number, recordId),
      database.prepare(`INSERT INTO owner_contract_revisions (id, project_id, contract_record_id, revision_number, phase, contract_type, fields_json, snapshot_hash, note, created_by_type, created_by_name, created_by_email, created_at) VALUES (?, ?, ?, ?, 'Mefford Revision', ?, ?, ?, ?, 'Mefford', ?, ?, ?)`).bind(revisionId, project.number, recordId, revisionNumber, contractType, JSON.stringify(nextFields), snapshotHash, `${decision}: ${response}`, actor.name, actor.email, now),
      database.prepare(`UPDATE owner_portal_access SET status = 'Mefford Revision', updated_at = ? WHERE project_id = ?`).bind(now, project.number),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, `Change Request ${decision}`, `${String(change.clause_key)} · ${response}`),
    ]);
    return contractWorkflowPayload(database, project.number);
  }

  if (payload.action === "approve-final") {
    if (!companyOwner) return Response.json({ error: "Company Owner Final Approval Is Required" }, { status: 403 });
    if (record.status !== "Owner Review Complete") return Response.json({ error: "The Project Owner Must Complete Review Before Final Approval" }, { status: 409 });
    const open = await database.prepare(`SELECT COUNT(*) AS count FROM owner_contract_change_requests WHERE project_id = ? AND contract_record_id = ? AND status = 'Open'`).bind(project.number, recordId).first<{ count: number }>();
    if (Number(open?.count || 0)) return Response.json({ error: "Resolve Every Owner Change Request Before Final Approval" }, { status: 409 });
    const revision = await latestRevision(database, project.number, recordId);
    if (!revision) return Response.json({ error: "No Controlled Revision Is Available" }, { status: 409 });
    await database.batch([
      database.prepare(`UPDATE owner_contract_revisions SET phase = 'Final Approval', frozen_at = ? WHERE id = ?`).bind(now, revision.id),
      database.prepare(`UPDATE command_records SET status = 'Ready for Signature', date_locked = 1, data_json = ?, meta = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify({ ...data, contractPhase: "Ready for Signature", frozenRevisionId: revision.id, frozenRevisionHash: revision.snapshot_hash, finalApprovedBy: actor.name, finalApprovedAt: now }), `${contractType} · R${revision.revision_number} · Frozen For Signatures`, now, project.number, recordId),
      database.prepare(`UPDATE owner_portal_access SET status = 'Ready for Signature', approved_revision_id = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE project_id = ?`).bind(revision.id, actor.name, now, now, project.number),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "Final Contract Approved And Frozen", `Revision R${revision.revision_number} · ${revision.snapshot_hash}`),
      auditStatement(database, project.number, recordId, record.status, "Ready for Signature", actor, `Company Owner froze revision R${revision.revision_number} for Project Owner signature followed by Mefford countersignature.`),
    ]);
    return contractWorkflowPayload(database, project.number);
  }

  if (payload.action === "revoke-owner-access") {
    if (!["Company Owner", "Administrator"].includes(actor.accessLevel)) return Response.json({ error: "Company Owner Or Administrator Access Is Required" }, { status: 403 });
    await database.batch([
      database.prepare(`UPDATE owner_portal_invites SET status = 'Revoked', revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL`).bind(now, project.number),
      database.prepare(`UPDATE owner_portal_access SET status = 'Revoked', revoked_at = ?, updated_at = ? WHERE project_id = ?`).bind(now, now, project.number),
      portalAudit(database, project.number, recordId, "Mefford", actor.name, actor.email, "Owner Portal Access Revoked", "All active Project Owner invite sessions were revoked."),
    ]);
    return contractWorkflowPayload(database, project.number);
  }

  return Response.json({ error: "Owner Contract Action Is Not Supported" }, { status: 400 });
}

async function setContractPhase(database: D1Database, projectId: string, record: ContractRow, data: Record<string, unknown>, phase: string, actor: ReturnType<typeof getCommandActor>, detail: string, now: string) {
  await database.batch([
    database.prepare(`UPDATE command_records SET status = ?, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(phase, JSON.stringify({ ...data, contractPhase: phase }), now, projectId, record.id),
    database.prepare(`UPDATE owner_portal_access SET status = ?, updated_at = ? WHERE project_id = ?`).bind(phase, now, projectId),
    portalAudit(database, projectId, record.id, "Mefford", actor.name, actor.email, phase, detail),
    auditStatement(database, projectId, record.id, record.status, phase, actor, detail),
  ]);
}

async function contractWorkflowPayload(
  database: D1Database,
  projectId: string,
  requestedType?: OwnerContractType,
  requestedInstrument?: OwnerContractInstrument,
) {
  return Response.json(await contractWorkflowObject(database, projectId, requestedType, requestedInstrument));
}

async function contractWorkflowObject(
  database: D1Database,
  projectId: string,
  requestedType?: OwnerContractType,
  requestedInstrument?: OwnerContractInstrument,
) {
  const [access, revisions, changes, invites, audits, contract] = await Promise.all([
    database.prepare(`SELECT * FROM owner_portal_access WHERE project_id = ? LIMIT 1`).bind(projectId).first<Record<string, unknown>>(),
    database.prepare(`SELECT id, revision_number, phase, contract_type, fields_json, snapshot_hash, note, created_by_type, created_by_name, created_by_email, frozen_at, created_at FROM owner_contract_revisions WHERE project_id = ? ORDER BY revision_number DESC`).bind(projectId).all<Record<string, unknown>>(),
    database.prepare(`SELECT * FROM owner_contract_change_requests WHERE project_id = ? ORDER BY created_at DESC`).bind(projectId).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, project_id, contact_name, email, status, expires_at, verified_at, revoked_at, session_expires_at, created_by, created_at FROM owner_portal_invites WHERE project_id = ? ORDER BY created_at DESC`).bind(projectId).all<Record<string, unknown>>(),
    database.prepare(`SELECT * FROM owner_portal_audits WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`).bind(projectId).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, title, owner, due, status, meta, record_date, data_json FROM command_records WHERE project_id = ? AND record_type = 'Contracts' ORDER BY updated_at DESC LIMIT 1`).bind(projectId).first<ContractRow>(),
  ]);
  const contractData = parseObject(contract?.data_json);
  const contractType = requestedType
    || normalizeOwnerContractType(contractData.contractType)
    || "Plan & Spec Lump Sum";
  const activeInstrument = requestedInstrument
    || normalizeInstrument(contractData.activeInstrument)
    || defaultContractInstrument(contractType);
  const prefill = await loadOwnerContractPrefill(database, projectId, contractType, activeInstrument);
  return {
    access: access || { project_id: projectId, status: "Dormant" },
    revisions: revisions.results.map((row) => ({ ...row, fields: parseOwnerObject(row.fields_json) })),
    changeRequests: changes.results,
    invites: invites.results,
    audits: audits.results,
    contract: contract ? clientRecord(contract) : null,
    prefill,
  };
}

async function loadOwnerContractPrefill(
  database: D1Database,
  projectId: string,
  contractType: OwnerContractType,
  activeInstrument: OwnerContractInstrument,
  suppliedProject?: ProjectRow,
) {
  const project = suppliedProject || await database.prepare(
    `SELECT number, name, site, owner_name, owner_contract_date, owner_contract_type,
            contract_amount, current_contract_amount, payment_terms, retainage_initial_percent,
            retainage_after_half_percent, architect, project_type, project_manager,
            superintendent, start_date, substantial_date, final_date
     FROM projects WHERE number = ? LIMIT 1`,
  ).bind(projectId).first<ProjectRow>();
  if (!project) return emptyPrefill();

  const [estimateRecord, proposalRows, budgetRows] = await Promise.all([
    database.prepare(
      `SELECT id, status, data_json, updated_at FROM command_records
       WHERE project_id = ? AND record_type = 'Awarded Estimates'
       ORDER BY updated_at DESC LIMIT 1`,
    ).bind(projectId).first<{ id: string; status: string; data_json: string; updated_at: string }>(),
    database.prepare(
      `SELECT id, status, data_json, updated_at FROM command_records
       WHERE project_id = ? AND record_type = 'Owner Proposals'
       ORDER BY updated_at DESC`,
    ).bind(projectId).all<{ id: string; status: string; data_json: string; updated_at: string }>(),
    database.prepare(
      `SELECT id, data_json FROM command_records
       WHERE project_id = ? AND record_type = 'Budget'
       ORDER BY id`,
    ).bind(projectId).all<{ id: string; data_json: string }>(),
  ]);
  const proposalRecord = proposalRows.results.find((row) => row.status === "Award Basis Of Sale")
    || proposalRows.results.find((row) => row.status === "Issued")
    || proposalRows.results[0];
  const estimateData = parseObject(estimateRecord?.data_json);
  const proposalData = proposalRecord ? parseObject(proposalRecord.data_json) : {};
  const opportunityId = String(
    estimateData.opportunityId
      || proposalData.sourceOpportunityId
      || proposalData.opportunityId
      || (estimateRecord?.id.startsWith("ESTIMATE-") ? estimateRecord.id.slice("ESTIMATE-".length) : ""),
  ).trim();
  const opportunity = opportunityId ? await database.prepare(
    `SELECT data_json FROM command_records
     WHERE project_id = 'MEFFORD-SALES' AND id = ? AND record_type = 'Sales Opportunities'
     LIMIT 1`,
  ).bind(opportunityId).first<{ data_json: string }>() : await database.prepare(
    `SELECT data_json FROM command_records
     WHERE project_id = 'MEFFORD-SALES'
       AND record_type = 'Sales Opportunities'
       AND json_extract(data_json, '$.awardedProjectNumber') = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(projectId).first<{ data_json: string }>();
  const opportunityData = parseObject(opportunity?.data_json);
  const contact = await resolveOwnerContractContact(database, ownerContractContactReference(
    opportunityData,
    parseObject(opportunityData.proposalHandoff),
    proposalData,
    estimateData,
    { ownerName: project.owner_name },
  ));
  const projectSource = {
    number: project.number,
    name: project.name,
    site: project.site,
    ownerName: project.owner_name,
    ownerContractDate: project.owner_contract_date,
    architect: project.architect,
    projectType: project.project_type,
    contractAmount: project.contract_amount,
    startDate: project.start_date,
    substantialDate: project.substantial_date,
    finalDate: project.final_date,
    projectManager: project.project_manager,
    superintendent: project.superintendent,
    paymentTerms: project.payment_terms,
    retainageInitialPercent: project.retainage_initial_percent,
    retainageAfterHalfPercent: project.retainage_after_half_percent,
  };
  const baseFields = defaultContractFields(contractType, projectSource, {
    name: "",
    email: "",
  }, activeInstrument);
  return buildOwnerContractPrefill({
    baseFields,
    project: projectSource,
    estimate: estimateData.estimate,
    estimateRecordId: estimateRecord?.id,
    proposal: proposalRecord ? proposalData : null,
    proposalRecordId: proposalRecord?.id,
    contact: contact?.contact,
    contactRecordId: contact?.recordId,
    budgetRows: budgetRows.results.map((row) => parseObject(row.data_json)),
  });
}

function emptyPrefill(): OwnerContractPrefill {
  return {
    fields: {},
    sources: {},
    summary: { projectFields: 0, estimateFields: 0, proposalFields: 0, standardFields: 0, scopeSections: 0, budgetLines: 0, scheduleMilestones: 0 },
  };
}

async function nextRevisionNumber(database: D1Database, projectId: string, recordId: string) {
  const row = await database.prepare(`SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM owner_contract_revisions WHERE project_id = ? AND contract_record_id = ?`).bind(projectId, recordId).first<{ next: number }>();
  return Number(row?.next || 1);
}

async function latestRevision(database: D1Database, projectId: string, recordId: string) {
  return database.prepare(`SELECT id, revision_number, phase, snapshot_hash FROM owner_contract_revisions WHERE project_id = ? AND contract_record_id = ? ORDER BY revision_number DESC LIMIT 1`).bind(projectId, recordId).first<{ id: string; revision_number: number; phase: string; snapshot_hash: string }>();
}

function portalAudit(database: D1Database, projectId: string, contractRecordId: string, actorType: string, actorName: string, actorEmail: string, action: string, detail: string) {
  return database.prepare(`INSERT INTO owner_portal_audits (project_id, contract_record_id, actor_type, actor_name, actor_email, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(projectId, contractRecordId, actorType, actorName, actorEmail, action, detail);
}

function upsertRecord(
  database: D1Database,
  projectId: string,
  id: string,
  recordType: string,
  title: string,
  owner: string,
  due: string,
  status: string,
  meta: string,
  recordDate: string,
  data: Record<string, unknown>,
  now: string,
) {
  return database.prepare(
    `INSERT INTO command_records (
      project_id, id, record_type, title, owner, due, status, meta,
      record_date, record_time, date_locked, data_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(project_id, id) DO UPDATE SET
      record_type = excluded.record_type, title = excluded.title, owner = excluded.owner,
      due = excluded.due, status = excluded.status, meta = excluded.meta,
      record_date = excluded.record_date, date_locked = excluded.date_locked,
      data_json = excluded.data_json, updated_at = excluded.updated_at`,
  ).bind(projectId, id, recordType, title, owner, due, status, meta, recordDate, ["Executed", "Phase 1 Executed"].includes(status) ? 1 : 0, JSON.stringify(data), now);
}

function auditStatement(
  database: D1Database,
  projectId: string,
  recordId: string,
  oldValue: string,
  newValue: string,
  actor: ReturnType<typeof getCommandActor>,
  summary: string,
) {
  return database.prepare(
    `INSERT INTO record_audits (
      project_id, record_id, field_name, old_value, new_value, reason,
      actor_name, actor_email, summary
    ) VALUES (?, ?, 'Owner Contract Lifecycle', ?, ?, 'Controlled Contract Workflow', ?, ?, ?)`,
  ).bind(projectId, recordId, oldValue, newValue, actor.name, actor.email, summary);
}

async function loadContract(database: D1Database, projectId: string, recordId: string) {
  return database.prepare(
    `SELECT id, title, owner, due, status, meta, record_date, data_json
     FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Contracts' LIMIT 1`,
  ).bind(projectId, recordId).first<ContractRow>();
}

async function loadRecordData(database: D1Database, projectId: string, recordId: string) {
  const row = await database.prepare(
    `SELECT status, data_json FROM command_records WHERE project_id = ? AND id = ? LIMIT 1`,
  ).bind(projectId, recordId).first<{ status: string; data_json: string }>();
  return { ...parseObject(row?.data_json), ...(row?.status ? { status: row.status } : {}) };
}

async function canManageContract(database: D1Database, actor: ReturnType<typeof getCommandActor>, project: ProjectRow) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (actor.name === project.project_manager) return true;
  const member = await database.prepare(
    `SELECT designations_json FROM company_members WHERE email = ? LIMIT 1`,
  ).bind(actor.email).first<{ designations_json: string }>();
  try {
    return (JSON.parse(member?.designations_json || "[]") as unknown[]).includes("Project Manager");
  } catch {
    return false;
  }
}

async function ensureContractProjectColumns(database: D1Database) {
  const columns = await database.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["owner_contract_type", "TEXT NOT NULL DEFAULT 'Plan & Spec Lump Sum'"],
    ["owner_contract_status", "TEXT NOT NULL DEFAULT 'Draft'"],
    ["owner_contract_record_id", "TEXT NOT NULL DEFAULT ''"],
    ["payment_terms", "TEXT NOT NULL DEFAULT ''"],
    ["retainage_initial_percent", "TEXT NOT NULL DEFAULT '10'"],
    ["retainage_after_half_percent", "TEXT NOT NULL DEFAULT '5'"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) await database.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`).run();
  }
}

function normalizeFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return normalizeContractMoneyFields(Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^[A-Z0-9_]+$/.test(key))
      .map(([key, fieldValue]) => [key, String(fieldValue ?? "").trim().slice(0, 20_000)]),
  ));
}

function normalizeManualFieldKeys(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).filter((field) => /^[A-Z0-9_]+$/.test(field)))).slice(0, 1_200)
    : [];
}

function inferLegacyManualFields(fields: Record<string, string>, prefill: OwnerContractPrefill) {
  return Object.entries(fields).filter(([field, value]) => {
    if (!value.trim()) return false;
    const automatic = prefill.fields[field];
    return !automatic || automatic !== value;
  }).map(([field]) => field);
}

function normalizeInstrument(value: unknown): OwnerContractInstrument | null {
  const candidate = String(value || "");
  return (["Phase 1 Agreement", "GMP Exhibit A", "Primary Agreement", "External Agreement Mapping"] as const)
    .includes(candidate as OwnerContractInstrument)
    ? candidate as OwnerContractInstrument
    : null;
}

function sourceRecordId(prefill: OwnerContractPrefill, kind: "Estimate" | "Proposal") {
  return Object.values(prefill.sources).find((source) => source.kind === kind && source.recordId)?.recordId || "";
}

function crmContactRecordId(prefill: OwnerContractPrefill) {
  return Object.values(prefill.sources).find((source) => source.label === "CRM Contact" && source.recordId)?.recordId || "";
}

function manualSources(fields: Iterable<string>) {
  return Object.fromEntries(Array.from(fields, (field) => [field, { kind: "Manual" as const, label: "Manual Override" }]));
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clientRecord(row: ContractRow) {
  return {
    id: row.id,
    type: "Contracts",
    title: row.title,
    owner: row.owner,
    due: row.due,
    status: row.status,
    meta: row.meta,
    recordDate: row.record_date,
    dateLocked: ["Executed", "Phase 1 Executed"].includes(row.status),
    data: parseObject(row.data_json),
  };
}

function contractAmountFor(type: OwnerContractType, fields: Record<string, string>, fallback: string, instrument: OwnerContractInstrument = defaultContractInstrument(type)) {
  const value = type === "Design-Build GMP" && instrument === "Phase 1 Agreement"
    ? fields.OWNER_TARGET_BUDGET
    : fields[contractAmountField(type, instrument)];
  const amount = Number(String(value || fallback || "").replace(/[$,]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : String(fallback || "");
}

function clampPercent(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
}

function controlledDate(value: unknown, fallback: string) {
  const candidate = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : fallback;
}

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) : "$0.00";
}

function validSignatureImage(value: unknown) {
  return typeof value === "string" && value.length < 300_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
