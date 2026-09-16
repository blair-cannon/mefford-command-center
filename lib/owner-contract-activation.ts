import { ensureOwnerPortalSchema, hashOwnerSecret } from "./owner-portal";
import {
  applyOwnerContractCommercialTerms,
  contractTemplate,
  defaultContractFields,
  defaultContractInstrument,
  normalizeOwnerContractCommercialTerms,
  normalizeSmallProjectPricingMethod,
  requiredContractFields,
  type ContractActorSource,
  type ContractProjectSource,
  type OwnerContractType,
  withOwnerContractComputedFields,
} from "./owner-contracts";
import { buildOwnerContractPrefill } from "./owner-contract-prefill";

type ActivationProject = ContractProjectSource & {
  ownerContractType: OwnerContractType;
  paymentTerms?: string;
  retainageInitialPercent?: string;
  retainageAfterHalfPercent?: string;
};

export async function activateOwnerContractWorkflow(
  database: D1Database,
  project: ActivationProject,
  actor: ContractActorSource,
) {
  await ensureOwnerPortalSchema(database);
  const now = new Date().toISOString();
  const contractRecordId = `OWNER-CONTRACT-${project.number}`;
  const template = contractTemplate(project.ownerContractType);
  const activeInstrument = defaultContractInstrument(project.ownerContractType);
  const generatedFields = defaultContractFields(project.ownerContractType, project, actor, activeInstrument);
  const prefill = buildOwnerContractPrefill({ baseFields: generatedFields, project });
  const fields = withOwnerContractComputedFields(project.ownerContractType, prefill.fields);
  const commercialTerms = normalizeOwnerContractCommercialTerms(project);
  const { paymentTerms, retainageInitialPercent, retainageAfterHalfPercent } = commercialTerms;
  applyOwnerContractCommercialTerms(fields, commercialTerms);
  const missingRequiredFields = requiredContractFields(project.ownerContractType, activeInstrument, fields)
    .filter((field) => !fields[field]?.trim());
  const revisionHash = await hashOwnerSecret(JSON.stringify({
    contractType: project.ownerContractType,
    activeInstrument,
    fields,
    fieldSources: prefill.sources,
    manualFieldKeys: [],
    sourceSummary: prefill.summary,
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
  }));
  const due = project.ownerContractDate || now.slice(0, 10);
  const contractAmount = project.contractAmount || "";
  const contractData = {
    contractType: project.ownerContractType,
    pricingMethod: project.ownerContractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    templateId: template.id,
    templateVersion: template.version,
    templateHtmlPath: template.htmlPath,
    templateDocxPath: template.docxPath,
    agreementSource: template.source,
    activeInstrument,
    phaseExecutions: {},
    fields,
    missingRequiredFields,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    paymentTerms,
    signatures: {},
    sourceOfTruth: "Owner Contract Record",
    createdFromProjectSetup: true,
    savedAt: now,
    savedBy: actor.name,
  };
  const billingData = {
    projectNumber: project.number,
    contractType: project.ownerContractType,
    pricingMethod: project.ownerContractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    contractRecordId,
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    ownerOnly: true,
    locked: false,
    createdFromProjectSetup: true,
    ownerContactName: fields.OWNER_SIGNATORY || fields.OWNER_NOTICE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    ownerContactTitle: fields.OWNER_SIGNATORY_TITLE || "",
    ownerContactEmail: fields.OWNER_NOTICE_EMAIL || fields.OWNER_EMAIL || "",
    ownerContactPhone: fields.OWNER_NOTICE_PHONE || fields.OWNER_PHONE || "",
    ownerMailingAddress: fields.OWNER_DELIVERY_ADDRESS || [fields.OWNER_NOTICE_ADDRESS_LINE_1, fields.OWNER_NOTICE_ADDRESS_LINE_2].filter(Boolean).join("\n"),
    invoiceDeliveryMethodRecipient: fields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
    primarySiteContact: fields.PRIMARY_SITE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    standardRules: {
      projectManagement: "Combined Project Manager And Superintendent",
      generalConditions: "Division 01 Except Project Management Plus Technology Insurance And Other Contract Fees",
      overheadAndProfit: "Explicit Base Profit Only",
    },
    billingCycle: { billingMonthEnds: "Month-End", subcontractInvoicesDueDay: 5, automatedDraftDay: 6, ownerSubmissionDay: 15 },
  };
  const accountingData = {
    projectNumber: project.number,
    projectName: project.name,
    ownerName: project.ownerName || "",
    contractRecordId,
    contractType: project.ownerContractType,
    pricingMethod: project.ownerContractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "",
    contractAmount,
    paymentTerms,
    retainageInitialPercent,
    retainageAfterHalfPercent,
    ownerContactName: fields.OWNER_SIGNATORY || fields.OWNER_NOTICE_CONTACT || fields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
    ownerContactEmail: fields.OWNER_NOTICE_EMAIL || fields.OWNER_EMAIL || "",
    ownerContactPhone: fields.OWNER_NOTICE_PHONE || fields.OWNER_PHONE || "",
    invoiceDeliveryMethodRecipient: fields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
    contractStatus: "Draft",
    effectiveDate: due,
    sourceOfTruth: "Owner Contract Record",
    synchronizedAt: now,
  };

  await database.batch([
    database.prepare(
      `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
       VALUES (?, ?, 'Contracts', ?, ?, ?, 'Draft', ?, ?, NULL, 0, ?, ?)
       ON CONFLICT(project_id, id) DO NOTHING`,
    ).bind(project.number, contractRecordId, project.ownerContractType === "External Contract" ? `${project.name} · External Contract Control` : `${project.name} · ${template.label}`, actor.name, due, `${template.id} · ${missingRequiredFields.length} Required Fields Open`, due, JSON.stringify(contractData), now),
    database.prepare(
      `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
       VALUES (?, 'OWNER-BILLING-SETUP', 'Owner Billing Setup', ?, 'Company Owner', ?, 'Owner Action Required', ?, ?, NULL, 0, ?, ?)
       ON CONFLICT(project_id, id) DO NOTHING`,
    ).bind(project.number, `${project.name} First Owner Invoice Structure`, due, "Owner Must Review And Lock The SOV Before First Billing", due, JSON.stringify(billingData), now),
    database.prepare(
      `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
       VALUES ('MEFFORD-ACCOUNTING', ?, 'Owner Contract Setup', ?, ?, ?, 'Draft', ?, ?, NULL, 0, ?, ?)
       ON CONFLICT(project_id, id) DO NOTHING`,
    ).bind(contractRecordId, `${project.number} · ${project.name} Owner Contract`, actor.name, due, `${project.ownerContractType} · ${contractAmount}`, due, JSON.stringify(accountingData), now),
    database.prepare(
      `INSERT INTO owner_portal_access (project_id, contract_record_id, status, created_at, updated_at)
       VALUES (?, ?, 'Dormant', ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET contract_record_id = excluded.contract_record_id, status = 'Dormant', contact_name = '', contact_email = '', approved_revision_id = '', approved_by = '', approved_at = NULL, invited_at = NULL, revoked_at = NULL, updated_at = excluded.updated_at`,
    ).bind(project.number, contractRecordId, now, now),
    database.prepare(
      `INSERT INTO owner_contract_revisions (id, project_id, contract_record_id, revision_number, phase, contract_type, fields_json, snapshot_hash, note, created_by_type, created_by_name, created_by_email, created_at)
       VALUES (?, ?, ?, 1, 'Draft Preparation', ?, ?, ?, 'Project-created controlled draft. No Project Owner access or invitation was activated.', 'Mefford', ?, ?, ?)
       ON CONFLICT(project_id, contract_record_id, revision_number) DO NOTHING`,
    ).bind(`${contractRecordId}-R1`, project.number, contractRecordId, project.ownerContractType, JSON.stringify(fields), revisionHash, actor.name, actor.email, now),
  ]);

  return { contractRecordId, revisionId: `${contractRecordId}-R1`, portalStatus: "Dormant", missingRequiredFields };
}
