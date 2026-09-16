import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projects,
  recordAudits,
  vendorProfiles,
  vendorProjectAccess,
  vendorSubmissions,
} from "../../../db/schema";
import {
  LIEN_WAIVER_CONTROL_TYPE,
  LIEN_WAIVER_FORM_LABELS,
  LIEN_WAIVER_JURISDICTIONS,
  LIEN_WAIVER_PROJECT_CLASSES,
  LIEN_WAIVER_RECORD_TYPE,
  LIEN_WAIVER_RULES,
  canIssueUnconditionalWaiver,
  isConditionalWaiver,
  isFinalWaiver,
  isLienWaiverJurisdiction,
  isLienWaiverProjectClass,
  isLienWaiverType,
  unconditionalTypeFor,
  type LienWaiverType,
} from "../../../lib/lien-waivers";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { ensureVendorSchema, parseStringArray } from "../../../lib/vendor-portal";
import { roundMoney } from "../../../lib/money.js";

type Db = ReturnType<(typeof import("../../../db"))["getDb"]>;

type WaiverPayload = {
  action?: string;
  projectId?: string;
  recordId?: string;
  jurisdiction?: string;
  projectClass?: string;
  projectLegalName?: string;
  projectAddress?: string;
  legalDescription?: string;
  titleCompanyRequirements?: string;
  vendorId?: string;
  vendorName?: string;
  vendorEmail?: string;
  formType?: string;
  commitmentReference?: string;
  payApplicationReference?: string;
  linkedSubmissionId?: string;
  linkedApRecordId?: string;
  amount?: number;
  retainage?: number;
  throughDate?: string;
  exceptions?: string;
  lowerTierStatement?: string;
  signerName?: string;
  signerTitle?: string;
  signatureImage?: string;
  signatureConsent?: boolean;
  paymentReference?: string;
  paymentClearedDate?: string;
  reviewNote?: string;
  reason?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureVendorSchema();
    const { getDb } = await import("../../../db");
    const db = getDb();
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
    const permissions = await waiverPermissions(db, actor, projectId);
    if (!permissions.canView) return Response.json({ error: "Accounting Project Manager Owner Or Administrator Access Is Required" }, { status: 403 });
    const projectRows = await db.select().from(projects).orderBy(projects.number);
    if (!projectId) {
      const visibleProjectRows = permissions.canAccountingReview
        ? projectRows
        : projectRows.filter((project) => project.projectManager?.trim().toLowerCase() === actor.name.trim().toLowerCase());
      return Response.json({
        projects: visibleProjectRows.map((project) => ({ number: project.number, name: project.name, site: project.site, status: project.status, projectManager: project.projectManager })),
        jurisdictions: LIEN_WAIVER_JURISDICTIONS.map((state) => LIEN_WAIVER_RULES[state]),
        projectClasses: LIEN_WAIVER_PROJECT_CLASSES,
        permissions,
      });
    }
    const project = projectRows.find((item) => item.number === projectId);
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const [rows, audits, accessRows, submissionRows] = await Promise.all([
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, [LIEN_WAIVER_CONTROL_TYPE, LIEN_WAIVER_RECORD_TYPE]))).orderBy(desc(commandRecords.updatedAt)),
      db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)).orderBy(desc(recordAudits.id)),
      db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId)),
      db.select().from(vendorSubmissions).where(eq(vendorSubmissions.projectId, projectId)).orderBy(desc(vendorSubmissions.submittedAt)),
    ]);
    const vendorIds = accessRows.map((row) => row.vendorId);
    const vendors = vendorIds.length ? await db.select().from(vendorProfiles).where(inArray(vendorProfiles.id, vendorIds)) : [];
    const auditMap = new Map<string, typeof audits>();
    for (const entry of audits) auditMap.set(entry.recordId, [...(auditMap.get(entry.recordId) || []), entry]);
    const controlRow = rows.find((row) => row.recordType === LIEN_WAIVER_CONTROL_TYPE);
    const control = controlRow ? parseObject(controlRow.dataJson) : null;
    const waiverRows = rows.filter((row) => row.recordType === LIEN_WAIVER_RECORD_TYPE);
    const rule = control && isLienWaiverJurisdiction(control.jurisdiction) ? LIEN_WAIVER_RULES[control.jurisdiction] : null;
    return Response.json({
      project: { number: project.number, name: project.name, site: project.site, ownerName: project.ownerName, projectManager: project.projectManager, finalDate: project.finalDate },
      permissions,
      control: control ? { ...control, status: controlRow?.status, auditHistory: auditMap.get(controlRow!.id) || [] } : null,
      rule,
      jurisdictions: LIEN_WAIVER_JURISDICTIONS.map((state) => LIEN_WAIVER_RULES[state]),
      projectClasses: LIEN_WAIVER_PROJECT_CLASSES,
      vendors: accessRows.map((access) => {
        const vendor = vendors.find((item) => item.id === access.vendorId);
        return { id: access.vendorId, name: vendor?.legalName || access.vendorId, email: vendor?.contactEmail || "", trade: access.trade, commitmentReference: access.contractReference, status: access.status };
      }),
      submissions: submissionRows.map((submission) => ({ id: submission.id, vendorId: submission.vendorId, title: submission.title, amount: Number(submission.amount || 0), periodEnd: submission.periodEnd || "", status: submission.status, finalApplication: parseObject(submission.payloadJson).finalApplication === true })),
      waivers: waiverRows.map((row) => ({
        id: row.id,
        title: row.title,
        due: row.due,
        status: row.status,
        meta: row.meta,
        updatedAt: row.updatedAt,
        data: parseObject(row.dataJson),
        auditHistory: auditMap.get(row.id) || [],
      })),
      policy: {
        templates: "Four separate forms; never a partial/full checkbox",
        payApplications: "Conditional progress waiver requested with each project invoice or AIA-style pay application",
        payment: "Approved conditional waiver or a one-time audited Company Owner override is required before payment authorization",
        clearedFunds: "Cleared payment makes the conditional waiver effective and creates—never signs—an unconditional request",
        final: "Conditional final release gates final payment; approved unconditional final release gates Total Project Closeout",
        retention: "Every generated document and prior version remains permanently linked to project, vendor, commitment, billing record, payment, and audit",
        review: "Initial counsel/Owner approval and annual Owner review are required for each controlled master",
      },
    });
  } catch (error) {
    return waiverError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureVendorSchema();
    const input = await request.json() as WaiverPayload;
    const projectId = input.projectId?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    const { getDb } = await import("../../../db");
    const db = getDb();
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
    const permissions = await waiverPermissions(db, actor, projectId);
    if (!permissions.canView) return Response.json({ error: "Lien Waiver Access Is Required" }, { status: 403 });
    const now = new Date().toISOString();

    if (input.action === "configure-project") {
      if (!permissions.canConfigure) return Response.json({ error: "Project Manager Accountant Owner Or Administrator Access Is Required" }, { status: 403 });
      if (!isLienWaiverJurisdiction(input.jurisdiction) || !isLienWaiverProjectClass(input.projectClass)) return Response.json({ error: "Choose One Of The Six Approved States And The Private Or Public / Bonded Classification" }, { status: 400 });
      const projectAddress = input.projectAddress?.trim() || project.site;
      if (!projectAddress || (input.projectClass === "Private" && !input.legalDescription?.trim())) return Response.json({ error: "Project Address And A Private-Property Legal Description Or Parcel Reference Are Required" }, { status: 400 });
      const existing = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "LIEN-WAIVER-CONTROL"))).limit(1))[0];
      const data = {
        jurisdiction: input.jurisdiction,
        projectClass: input.projectClass,
        projectLegalName: input.projectLegalName?.trim() || project.name,
        propertyOwner: project.ownerName || "",
        projectAddress,
        legalDescription: input.legalDescription?.trim() || "Public property / payment-bond claim",
        titleCompanyRequirements: input.titleCompanyRequirements?.trim() || "",
        templateStatus: "Initial Counsel And Company Owner Review Required",
        formFamily: "Mefford Branded Four-Form Lien Waiver Standard",
        sourceReference: "Construction Lien Waiver - EDITABLE (1).pdf · visual reference only",
        updatedBy: actor.name,
        updatedAt: now,
      };
      await db.insert(commandRecords).values({ projectId, id: "LIEN-WAIVER-CONTROL", recordType: LIEN_WAIVER_CONTROL_TYPE, title: `${project.name} Lien Waiver Control`, owner: project.projectManager, due: project.finalDate, status: "Configured — Review Required", meta: `${input.jurisdiction} · ${input.projectClass} · Four Controlled Forms`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { status: "Configured — Review Required", meta: `${input.jurisdiction} · ${input.projectClass} · Four Controlled Forms`, dataJson: JSON.stringify(data), updatedAt: now } });
      await audit(db, projectId, "LIEN-WAIVER-CONTROL", actor, "Project Waiver Routing", existing?.meta || "Not Configured", `${input.jurisdiction} · ${input.projectClass}`, "State, project classification, property identity, and controlled form family recorded");
      await hydratePendingWaivers(db, projectId, data, now);
      return Response.json({ saved: true, control: data });
    }

    const controlRow = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "LIEN-WAIVER-CONTROL"))).limit(1))[0];
    const control = parseObject(controlRow?.dataJson || "{}");
    if (!controlRow || !isLienWaiverJurisdiction(control.jurisdiction) || !isLienWaiverProjectClass(control.projectClass)) return Response.json({ error: "Configure The Project State And Private Or Public / Bonded Classification Before Issuing A Waiver" }, { status: 409 });

    if (input.action === "create-request") {
      if (!permissions.canManage) return Response.json({ error: "Accounting Project Manager Owner Or Administrator Access Is Required" }, { status: 403 });
      if (!isLienWaiverType(input.formType) || !isConditionalWaiver(input.formType)) return Response.json({ error: "Start With A Conditional Progress Or Conditional Final Request. Unconditional Forms Are Created Only After Cleared Payment." }, { status: 400 });
      const amount = roundMoney(input.amount || 0);
      if (!input.vendorId?.trim() || !input.vendorName?.trim() || !input.commitmentReference?.trim() || !input.payApplicationReference?.trim() || !validDate(input.throughDate) || !Number.isFinite(amount) || amount <= 0) return Response.json({ error: "Vendor Commitment Billing Reference Through-Date And Positive Payment Amount Are Required" }, { status: 400 });
      const id = `LW-${crypto.randomUUID()}`;
      const data = waiverData({ input, control, formType: input.formType, createdBy: actor.name, createdAt: now });
      await db.insert(commandRecords).values({ projectId, id, recordType: LIEN_WAIVER_RECORD_TYPE, title: `${LIEN_WAIVER_FORM_LABELS[input.formType]} · ${input.vendorName.trim()}`, owner: input.vendorName.trim(), due: input.throughDate!, status: "Requested", meta: `${control.jurisdiction} · ${control.projectClass} · ${input.payApplicationReference.trim()} · ${money(amount)}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, projectId, id, actor, "Lien Waiver Request", "None", "Requested", `Conditional ${isFinalWaiver(input.formType) ? "final" : "progress"} request created; no document was signed or approved automatically`);
      return Response.json({ saved: true, recordId: id }, { status: 201 });
    }

    const recordId = input.recordId?.trim() || "";
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE))).limit(1))[0];
    if (!row) return Response.json({ error: "Lien Waiver Record Not Found" }, { status: 404 });
    const data = parseObject(row.dataJson);
    const formType = String(data.formType || "");
    if (!isLienWaiverType(formType)) return Response.json({ error: "Controlled Waiver Type Is Invalid" }, { status: 409 });

    if (input.action === "record-signature") {
      if (!input.signerName?.trim() || !input.signerTitle?.trim() || !validSignatureImage(input.signatureImage) || input.signatureConsent !== true) return Response.json({ error: "Drawn Signature Typed Identity Title And Electronic-Signature Consent Are Required" }, { status: 400 });
      if (!isConditionalWaiver(formType) && !canIssueUnconditionalWaiver(data)) return Response.json({ error: "Unconditional Waiver Blocked Until Accounting Records Cleared Payment And Its Reference" }, { status: 409 });
      const nextData = { ...data, signature: { signerName: input.signerName.trim(), signerTitle: input.signerTitle.trim(), signatureImage: input.signatureImage, signerEmail: input.vendorEmail?.trim() || String(data.vendorEmail || ""), consent: true, signedAt: now, recordedBy: actor.name, deviceRecord: "Audited Command Center Session" } };
      await updateRecord(db, row, "Signed — Accounting Review", nextData, now);
      await audit(db, projectId, row.id, actor, "Electronic Signature", row.status, "Signed — Accounting Review", `${input.signerName.trim()} signed the controlled ${LIEN_WAIVER_FORM_LABELS[formType]}`);
      return Response.json({ saved: true, status: "Signed — Accounting Review" });
    }

    if (input.action === "accounting-review") {
      if (!permissions.canAccountingReview) return Response.json({ error: "Accountant Financial Administrator Owner Or Administrator Review Is Required" }, { status: 403 });
      if (!data.signature || row.status !== "Signed — Accounting Review") return Response.json({ error: "A Signed Waiver Must Reach Accounting Review First" }, { status: 409 });
      if (!isConditionalWaiver(formType) && !canIssueUnconditionalWaiver(data)) return Response.json({ error: "Unconditional Waiver Cannot Be Approved Without Cleared Payment Evidence" }, { status: 409 });
      const status = isConditionalWaiver(formType) ? "Approved — Payment May Proceed" : "Approved — Unconditional";
      const nextData = { ...data, accountingReview: { reviewer: actor.name, email: actor.email, reviewedAt: now, note: input.reviewNote?.trim() || "Identity, amount, through-date, exceptions, retainage, and payment condition reviewed." } };
      await updateRecord(db, row, status, nextData, now);
      await audit(db, projectId, row.id, actor, "Accounting Review", row.status, status, String(nextData.accountingReview.note));
      await syncCloseoutRequirement(db, projectId, row.id, nextData, status, actor, now);
      return Response.json({ saved: true, status });
    }

    if (input.action === "record-payment-cleared") {
      if (!permissions.canAccountingReview) return Response.json({ error: "Accounting Owner Or Administrator Access Is Required" }, { status: 403 });
      if (!isConditionalWaiver(formType) || !["Approved — Payment May Proceed", "Owner Override — Payment Authorized"].includes(row.status)) return Response.json({ error: "An Approved Conditional Waiver Or Audited Company Owner Override Is Required Before Cleared Payment Can Be Matched" }, { status: 409 });
      if (!validDate(input.paymentClearedDate) || !input.paymentReference?.trim()) return Response.json({ error: "Cleared Payment Date And Bank Check ACH Card Or Wire Reference Are Required" }, { status: 400 });
      const clearedAt = `${input.paymentClearedDate}T12:00:00.000Z`;
      const nextData = { ...data, clearedPaymentAt: clearedAt, clearedPaymentReference: input.paymentReference.trim(), clearedPaymentRecordedBy: actor.name };
      await updateRecord(db, row, "Effective — Payment Cleared", nextData, now);
      await audit(db, projectId, row.id, actor, "Payment Cleared", row.status, "Effective — Payment Cleared", `${input.paymentReference.trim()} cleared ${input.paymentClearedDate}; conditional release became effective`);
      const unconditionalId = await createUnconditionalRequest(db, projectId, row, nextData, actor, now);
      await syncCloseoutRequirement(db, projectId, row.id, nextData, "Effective — Payment Cleared", actor, now);
      return Response.json({ saved: true, status: "Effective — Payment Cleared", unconditionalId });
    }

    if (input.action === "owner-override") {
      if (!permissions.isCompanyOwner) return Response.json({ error: "A Company Owner Must Authorize A Waiver Exception" }, { status: 403 });
      const reason = input.reason?.trim() || "";
      if (reason.length < 20) return Response.json({ error: "A Specific Audited Owner Override Reason Of At Least 20 Characters Is Required" }, { status: 400 });
      const nextData = { ...data, ownerOverride: { reason, owner: actor.name, email: actor.email, at: now, oneTime: true, doesNotCreateOrSignWaiver: true } };
      await updateRecord(db, row, "Owner Override — Payment Authorized", nextData, now);
      await audit(db, projectId, row.id, actor, "Company Owner Override", row.status, "Owner Override — Payment Authorized", `${reason} · Override does not create, sign, or approve a missing waiver`);
      return Response.json({ saved: true, status: "Owner Override — Payment Authorized" });
    }

    return Response.json({ error: "Unsupported Lien Waiver Action" }, { status: 400 });
  } catch (error) {
    return waiverError(error);
  }
}

function waiverData({ input, control, formType, createdBy, createdAt }: { input: WaiverPayload; control: Record<string, unknown>; formType: LienWaiverType; createdBy: string; createdAt: string }) {
  return {
    formType,
    formLabel: LIEN_WAIVER_FORM_LABELS[formType],
    jurisdiction: control.jurisdiction,
    projectClass: control.projectClass,
    projectLegalName: control.projectLegalName,
    propertyOwner: control.propertyOwner,
    projectAddress: control.projectAddress,
    legalDescription: control.legalDescription,
    titleCompanyRequirements: control.titleCompanyRequirements,
    templateStatus: control.templateStatus,
    vendorId: input.vendorId?.trim() || "",
    vendorName: input.vendorName?.trim() || "",
    vendorEmail: input.vendorEmail?.trim() || "",
    commitmentReference: input.commitmentReference?.trim() || "",
    payApplicationReference: input.payApplicationReference?.trim() || "",
    linkedSubmissionId: input.linkedSubmissionId?.trim() || "",
    linkedApRecordId: input.linkedApRecordId?.trim() || "",
    amount: roundMoney(input.amount || 0),
    retainage: Math.max(0, roundMoney(input.retainage || 0)),
    throughDate: input.throughDate || "",
    exceptions: input.exceptions?.trim() || "None",
    lowerTierStatement: input.lowerTierStatement?.trim() || "No unpaid lower-tier claims are known except those listed in Exceptions.",
    formVersion: `MEF-LW-${String(control.jurisdiction)}-v1`,
    sourceReference: control.sourceReference,
    createdBy,
    createdAt,
    immutableLinks: [input.linkedSubmissionId, input.linkedApRecordId, input.commitmentReference].filter(Boolean),
  };
}

async function createUnconditionalRequest(db: Db, projectId: string, source: typeof commandRecords.$inferSelect, data: Record<string, unknown>, actor: { name: string; email: string }, now: string) {
  const sourceType = String(data.formType || "") as LienWaiverType;
  const formType = unconditionalTypeFor(sourceType);
  const id = `LW-${crypto.randomUUID()}`;
  const nextData = { ...data, formType, formLabel: LIEN_WAIVER_FORM_LABELS[formType], conditionalSourceId: source.id, signature: null, accountingReview: null, createdBy: "Command Center Payment Reconciliation", createdAt: now };
  await db.insert(commandRecords).values({ projectId, id, recordType: LIEN_WAIVER_RECORD_TYPE, title: `${LIEN_WAIVER_FORM_LABELS[formType]} · ${String(data.vendorName || source.owner)}`, owner: source.owner, due: now.slice(0, 10), status: "Requested", meta: `${String(data.jurisdiction)} · ${String(data.projectClass)} · ${String(data.payApplicationReference)} · Cleared ${String(data.clearedPaymentReference)}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(nextData), updatedAt: now });
  await audit(db, projectId, id, actor, "Unconditional Request Created", "None", "Requested", `Cleared payment created the ${LIEN_WAIVER_FORM_LABELS[formType]} request; no signature or approval was created automatically`);
  return id;
}

async function hydratePendingWaivers(db: Db, projectId: string, control: Record<string, unknown>, now: string) {
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE)));
  for (const row of rows) {
    const data = parseObject(row.dataJson);
    if (isLienWaiverJurisdiction(data.jurisdiction) && isLienWaiverProjectClass(data.projectClass)) continue;
    await db.update(commandRecords).set({ status: row.status === "Project Setup Required" ? "Requested" : row.status, meta: `${String(control.jurisdiction)} · ${String(control.projectClass)} · ${String(data.payApplicationReference || "Billing Link Pending")}`, dataJson: JSON.stringify({ ...data, jurisdiction: control.jurisdiction, projectClass: control.projectClass, projectLegalName: control.projectLegalName, propertyOwner: control.propertyOwner, projectAddress: control.projectAddress, legalDescription: control.legalDescription, titleCompanyRequirements: control.titleCompanyRequirements, templateStatus: control.templateStatus, formVersion: `MEF-LW-${String(control.jurisdiction)}-v1` }), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, row.id)));
  }
}

async function syncCloseoutRequirement(db: Db, projectId: string, waiverId: string, data: Record<string, unknown>, waiverStatus: string, actor: { name: string; email: string }, now: string) {
  if (!isFinalWaiver(String(data.formType || "") as LienWaiverType) || !data.vendorId) return;
  const requirements = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Closeout Requirements")));
  const key = isConditionalWaiver(String(data.formType) as LienWaiverType) ? "conditional-waiver" : "unconditional-waiver";
  const target = requirements.find((row) => {
    const requirement = parseObject(row.dataJson);
    return String(requirement.vendorId || "") === String(data.vendorId) && String(requirement.templateKey || "").endsWith(key);
  });
  if (!target) return;
  const nextStatus = key === "conditional-waiver"
    ? ["Approved — Payment May Proceed", "Effective — Payment Cleared"].includes(waiverStatus) ? "Approved" : target.status
    : waiverStatus === "Approved — Unconditional" ? "Approved" : target.status;
  if (nextStatus === target.status) return;
  const requirement = parseObject(target.dataJson);
  const nextData = { ...requirement, linkedLienWaiverId: waiverId, conditionalSourceLienWaiverId: String(data.conditionalSourceId || ""), lienWaiverStatus: waiverStatus, approvals: [...(Array.isArray(requirement.approvals) ? requirement.approvals : []), { role: "Accountant", actor: actor.name, email: actor.email, decision: "Approved", at: now, comments: `Controlled lien waiver status: ${waiverStatus}` }], timeline: [...(Array.isArray(requirement.timeline) ? requirement.timeline : []), { action: "Lien Waiver Workflow Synced", actor: actor.name, at: now, detail: waiverStatus }] };
  await db.update(commandRecords).set({ status: nextStatus, dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, target.id)));
}

async function updateRecord(db: Db, row: typeof commandRecords.$inferSelect, status: string, data: Record<string, unknown>, now: string) {
  await db.update(commandRecords).set({ status, dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
}

async function audit(db: Db, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, summary: string) {
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason: summary, actorName: actor.name, actorEmail: actor.email, summary });
}

async function waiverPermissions(db: Db, actor: ReturnType<typeof getCommandActor>, projectId: string) {
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0];
  const level = member?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member?.designationsJson || "[]");
  const leadership = ["Company Owner", "Administrator"].includes(level);
  const accounting = designations.some((item) => ["Accountant", "Financial Administrator", "Office Staff"].includes(item));
  const project = projectId ? (await db.select({ projectManager: projects.projectManager }).from(projects).where(eq(projects.number, projectId)).limit(1))[0] : null;
  const isPm = projectId
    ? Boolean(project?.projectManager && project.projectManager.toLowerCase() === actor.name.toLowerCase())
    : designations.includes("Project Manager");
  return { canView: leadership || accounting || isPm, canManage: leadership || accounting || isPm, canConfigure: leadership || accounting || isPm, canAccountingReview: leadership || accounting, isCompanyOwner: level === "Company Owner", level, designations };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function validSignatureImage(value: unknown) { return typeof value === "string" && value.length < 250_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function waiverError(error: unknown) { const message = error instanceof Error ? error.message : "Lien Waiver Workflow Is Unavailable"; const status = /D1 binding|database|no such table/i.test(message) ? 503 : 500; return Response.json({ error: message }, { status }); }
