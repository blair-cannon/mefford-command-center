import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, recordAudits } from "../../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../../lib/server-actor";
import { PEOPLE_PROJECT_ID, employeeRecordId, parseEmployeeData } from "../../../../lib/onboarding";
import {
  ONBOARDING_DOCUMENTS,
  onboardingDocumentById,
  onboardingDocumentRecordId,
  onboardingTemplateRecordId,
  requiredFieldsForRole,
  type OnboardingDocumentDefinition,
} from "../../../../lib/onboarding-documents";

type Signature = {
  name: string;
  email: string;
  role: "Employee" | "Employer";
  method: "Authenticated Typed Signature";
  signedAt: string;
};

type DocumentSubmission = {
  documentId: string;
  documentVersion: string;
  employeeEmail: string;
  employeeName: string;
  answers: Record<string, string | boolean>;
  status: "Draft" | "Employee Signed" | "Employer Review Required" | "Complete";
  employeeSignature?: Signature;
  employerSignature?: Signature;
  contentHash?: string;
  officialSourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  revisions: Array<Record<string, unknown>>;
};

type DocumentPayload = {
  action?: "save_draft" | "employee_sign" | "employer_sign" | "approve_template" | "start_revision" | "set_outside_counsel";
  employeeEmail?: string;
  documentId?: string;
  answers?: Record<string, unknown>;
  signatureName?: string;
  signatureIntent?: boolean;
  reviewNote?: string;
  counselFirm?: string;
  counselContact?: string;
  counselReference?: string;
  annualReviewDue?: string;
};

type RoleAssignment = { designation: "Administrator" | "Accountant" | "Safety Director"; name: string; email: string };
const OUTSIDE_COUNSEL_RECORD_ID = "ONBOARDING-OUTSIDE-COUNSEL";
const PAYLOCITY_EMPLOYEE_URL = "https://access.paylocity.com/";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  try {
    const db = await documentDatabase();
    const admin = await canAdminister(db, actor.email, actor.accessLevel);
    const search = new URL(request.url).searchParams;
    const requestedEmail = search.get("employeeEmail")?.trim().toLowerCase() || actor.email;
    const [members, counselRows] = await Promise.all([
      db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, OUTSIDE_COUNSEL_RECORD_ID))).limit(1),
    ]);
    const roleAssignments = resolveRoleAssignments(members);
    const outsideCounsel = parseData(counselRows[0]?.dataJson || "{}");

    if (search.get("assignedQueue") === "1") {
      const submissionRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Onboarding Document Submission")));
      const reviewQueue = submissionRows.flatMap((row) => {
        const submission = parseData(row.dataJson);
        const document = onboardingDocumentById(String(submission.documentId || ""));
        if (!document || submission.status !== "Employer Review Required") return [];
        const assigned = roleAssignments[document.internalReviewerDesignation];
        if (assigned?.email !== actor.email && !admin) return [];
        return [{ employeeEmail: String(submission.employeeEmail || row.owner), employeeName: String(submission.employeeName || row.title), documentId: document.id, documentTitle: document.title, status: submission.status, assignedReviewer: assigned || null }];
      });
      return Response.json({ canAdminister: admin, reviewQueue, roleAssignments, outsideCounsel });
    }

    const actorCanReview = ONBOARDING_DOCUMENTS.some((document) => roleAssignments[document.internalReviewerDesignation]?.email === actor.email);
    if (requestedEmail !== actor.email && !admin && !actorCanReview) return Response.json({ error: "Employee Document Access Is Required" }, { status: 403 });
    const employee = await loadEmployee(db, requestedEmail);
    if (!employee) return Response.json({ error: "Employee Onboarding Record Was Not Found" }, { status: 404 });

    const [templateRows, submissionRows] = await Promise.all([
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Onboarding Document Template"))),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Onboarding Document Submission"))),
    ]);
    const releaseById = new Map(templateRows.map((row) => [row.id, parseData(row.dataJson)]));
    const submissionById = new Map(submissionRows.filter((row) => row.owner.toLowerCase() === requestedEmail).map((row) => [String(parseData(row.dataJson).documentId || ""), parseData(row.dataJson)]));
    const documents = ONBOARDING_DOCUMENTS.filter((document) => requestedEmail === actor.email || admin || roleAssignments[document.internalReviewerDesignation]?.email === actor.email).map((document) => {
      const release = releaseById.get(onboardingTemplateRecordId(document.id));
      const releaseStatus = release?.releaseStatus === "Ready" ? "Ready" : document.defaultReleaseStatus;
      const assignedReviewer = roleAssignments[document.internalReviewerDesignation] || null;
      return {
        ...document,
        fields: document.fields.map((field) => ({
          ...field,
          systemValue: field.fixedValue || (field.roleBinding ? roleAssignments[field.roleBinding as keyof typeof roleAssignments]?.name || "" : ""),
          systemManaged: Boolean(field.fixedValue || field.roleBinding || field.actorName),
        })),
        releaseStatus,
        releaseReview: release?.releaseStatus === "Ready" ? release : null,
        assignedReviewer,
        canEmployerSign: assignedReviewer?.email === actor.email,
        submission: submissionById.get(document.id) || null,
      };
    });
    return Response.json({
      canAdminister: admin,
      canReviewAssignedDocuments: actorCanReview,
      employee: { email: employee.email, name: employee.name },
      documents,
      roleAssignments,
      outsideCounsel,
      providers: {
        payroll: { name: "Paylocity", boundary: "File Export And Accountant Return Intake Only", employeeUrl: requestedEmail === actor.email ? PAYLOCITY_EMPLOYEE_URL : "" },
        lifeInsurance: { name: "Northwestern Mutual", scope: "Employee Life Insurance Only" },
        healthInsurance: { name: "UnitedHealthcare", scope: "Employee Health Insurance Only" },
      },
      policy: {
        scannedDocuments: "Blocked",
        sourceRule: "Official Agency Source Or Native Command Center Document Only",
        signatureRule: "Authenticated Intent Plus Typed Name And Immutable Audit Snapshot",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Onboarding Documents Are Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  try {
    const payload = await request.json() as DocumentPayload;
    const db = await documentDatabase();
    const admin = await canAdminister(db, actor.email, actor.accessLevel);
    const action = payload.action || "save_draft";
    const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
    const roleAssignments = resolveRoleAssignments(members);

    if (action === "set_outside_counsel") {
      if (!admin) return administratorRequired();
      const firmName = payload.counselFirm?.trim() || "";
      const contact = payload.counselContact?.trim() || "";
      const engagementReference = payload.counselReference?.trim() || "";
      const annualReviewDue = payload.annualReviewDue?.trim() || "";
      if (firmName.length < 3 || engagementReference.length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(annualReviewDue)) {
        return Response.json({ error: "Outside Counsel Firm Annual Review Reference And Due Date Are Required" }, { status: 400 });
      }
      const now = new Date().toISOString();
      const data = { firmName, contact, engagementReference, annualReviewDue, recordedBy: actor.name, recordedByEmail: actor.email, recordedAt: now, scope: "Annual Employment Form And Policy Review" };
      await db.insert(commandRecords).values({ projectId: PEOPLE_PROJECT_ID, id: OUTSIDE_COUNSEL_RECORD_ID, recordType: "Onboarding Legal Provider", title: `${firmName} · Outside Employment Counsel`, owner: actor.name, due: annualReviewDue, status: "Configured", meta: `Annual Review · ${engagementReference}`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { title: `${firmName} · Outside Employment Counsel`, owner: actor.name, due: annualReviewDue, status: "Configured", meta: `Annual Review · ${engagementReference}`, recordDate: now.slice(0, 10), dataJson: JSON.stringify(data), updatedAt: now } });
      await audit(db, OUTSIDE_COUNSEL_RECORD_ID, actor, "Outside Counsel Configuration Updated", `${firmName} · ${engagementReference} · Annual review due ${annualReviewDue}`);
      return Response.json({ saved: true, outsideCounsel: data });
    }

    const targetEmail = payload.employeeEmail?.trim().toLowerCase() || actor.email;
    const document = onboardingDocumentById(payload.documentId?.trim() || "");
    if (!document) return Response.json({ error: "Onboarding Document Was Not Found" }, { status: 404 });
    const assignedReviewer = roleAssignments[document.internalReviewerDesignation];
    const actorIsAssignedReviewer = assignedReviewer?.email === actor.email;
    if (targetEmail !== actor.email && !admin && !(action === "employer_sign" && actorIsAssignedReviewer)) return Response.json({ error: "Employee Document Access Is Required" }, { status: 403 });
    const employee = await loadEmployee(db, targetEmail);
    if (!employee) return Response.json({ error: "Employee Onboarding Record Was Not Found" }, { status: 404 });

    if (action === "approve_template") {
      const outsideCounsel = await loadOutsideCounsel(db);
      if (document.reviewer === "Safety Director" && !actorIsAssignedReviewer) return Response.json({ error: "The Current Safety Director Must Approve This Template" }, { status: 403 });
      if (document.reviewer !== "Safety Director" && !admin) return administratorRequired();
      if (document.reviewer === "Outside Counsel" && !String(outsideCounsel.firmName || "").trim()) return Response.json({ error: "Configure The Outside Employment Counsel Before Recording Annual Legal Approval" }, { status: 409 });
      if (document.defaultReleaseStatus === "Ready") return Response.json({ approved: true, alreadyReady: true });
      if ((payload.reviewNote?.trim().length || 0) < 12) return Response.json({ error: "A Specific Reviewer Approval Note Is Required" }, { status: 400 });
      const now = new Date().toISOString();
      const data = {
        documentId: document.id,
        documentVersion: document.version,
        releaseStatus: "Ready",
        reviewedBy: document.reviewer === "Outside Counsel" ? String(outsideCounsel.firmName) : assignedReviewer?.name || actor.name,
        reviewedByEmail: actor.email,
        reviewRecordedBy: actor.name,
        reviewedAt: now,
        reviewNote: payload.reviewNote!.trim(),
        requiredReviewer: document.reviewer,
        externalCounselReference: document.reviewer === "Outside Counsel" ? outsideCounsel.engagementReference : "",
      };
      await db.insert(commandRecords).values({
        projectId: PEOPLE_PROJECT_ID,
        id: onboardingTemplateRecordId(document.id),
        recordType: "Onboarding Document Template",
        title: `${document.title} · Published Template`,
        owner: String(data.reviewedBy),
        due: now.slice(0, 10),
        status: "Ready",
        meta: `${document.version} · Approved By ${String(data.reviewedBy)}`,
        recordDate: now.slice(0, 10),
        dateLocked: true,
        dataJson: JSON.stringify(data),
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [commandRecords.projectId, commandRecords.id],
        set: { status: "Ready", meta: `${document.version} · Approved By ${String(data.reviewedBy)}`, dataJson: JSON.stringify(data), updatedAt: now },
      });
      await audit(db, onboardingTemplateRecordId(document.id), actor, `${document.title} Template Approved`, payload.reviewNote!.trim());
      return Response.json({ approved: true, documentId: document.id });
    }

    const releaseStatus = await documentReleaseStatus(db, document);
    if (releaseStatus !== "Ready") return Response.json({ error: `${document.title} Is Held For ${releaseStatus}` }, { status: 409 });
    const existing = await loadSubmission(db, targetEmail, document.id);
    const now = new Date().toISOString();

    if (action === "start_revision") {
      if (!existing || existing.status === "Draft") return Response.json({ error: "A Signed Submission Is Required Before Starting A Revision" }, { status: 409 });
      const next: DocumentSubmission = {
        documentId: document.id,
        documentVersion: document.version,
        employeeEmail: targetEmail,
        employeeName: employee.name,
        answers: {},
        status: "Draft",
        createdAt: now,
        updatedAt: now,
        revisions: [...(existing.revisions || []), signedSnapshot(existing)],
        officialSourceUrl: document.sourceUrl,
      };
      await saveSubmission(db, document, next, actor.name);
      await audit(db, onboardingDocumentRecordId(targetEmail, document.id), actor, `${document.title} Revision Started`, "Prior signed version retained permanently");
      return Response.json({ submission: next });
    }

    if (existing && existing.status !== "Draft" && action !== "employer_sign") {
      return Response.json({ error: "This Signed Submission Is Immutable. Start A New Revision To Make Changes." }, { status: 409 });
    }
    const roleForAnswers: "Employee" | "Employer" = action === "employer_sign" ? "Employer" : "Employee";
    const submittedAnswers = sanitizeAnswers(document, payload.answers || {});
    const permittedFieldIds = new Set(document.fields.filter((field) => (field.role || "Employee") === roleForAnswers).map((field) => field.id));
    let answers = {
      ...(existing?.answers || {}),
      ...Object.fromEntries(Object.entries(submittedAnswers).filter(([key]) => permittedFieldIds.has(key))),
    };
    answers = applySystemManagedAnswers(document, answers, roleAssignments, actor, roleForAnswers);
    let submission: DocumentSubmission = existing || {
      documentId: document.id,
      documentVersion: document.version,
      employeeEmail: targetEmail,
      employeeName: employee.name,
      answers: {},
      status: "Draft",
      officialSourceUrl: document.sourceUrl,
      createdAt: now,
      updatedAt: now,
      revisions: [],
    };
    submission = { ...submission, answers, updatedAt: now };

    if (action === "save_draft") {
      await saveSubmission(db, document, submission, actor.name);
      return Response.json({ submission });
    }

    if (action === "employee_sign") {
      if (targetEmail !== actor.email) return Response.json({ error: "Only The Employee May Apply Their Signature" }, { status: 403 });
      const missing = missingRequired(document, answers, "Employee");
      if (missing.length) return Response.json({ error: `Complete Required Fields: ${missing.join(", ")}` }, { status: 400 });
      if (!payload.signatureIntent || !samePerson(payload.signatureName, actor.name)) return Response.json({ error: "Typed Legal Name And Signature Intent Are Required" }, { status: 400 });
      submission.employeeSignature = signature(actor, "Employee", now);
      submission.status = document.requiredSigners.includes("Employer") ? "Employer Review Required" : "Complete";
      submission.contentHash = await submissionHash(submission);
      await saveSubmission(db, document, submission, actor.name);
      await audit(db, onboardingDocumentRecordId(targetEmail, document.id), actor, `${document.title} Employee Signature Applied`, submission.contentHash);
      return Response.json({ submission });
    }

    if (action === "employer_sign") {
      if (!assignedReviewer) return Response.json({ error: `Assign One Active ${document.internalReviewerDesignation} Before Employer Review` }, { status: 409 });
      if (!actorIsAssignedReviewer) return Response.json({ error: `${assignedReviewer.name} Is The Current ${document.internalReviewerDesignation} And Must Complete This Employer Review` }, { status: 403 });
      if (!document.requiredSigners.includes("Employer") || !existing?.employeeSignature) return Response.json({ error: "Employee Signature Is Required Before Employer Review" }, { status: 409 });
      const missing = missingRequired(document, answers, "Employer");
      if (missing.length) return Response.json({ error: `Complete Employer Fields: ${missing.join(", ")}` }, { status: 400 });
      if (!payload.signatureIntent || !samePerson(payload.signatureName, actor.name)) return Response.json({ error: "Typed Legal Name And Signature Intent Are Required" }, { status: 400 });
      submission.employerSignature = signature(actor, "Employer", now);
      submission.status = "Complete";
      submission.contentHash = await submissionHash(submission);
      await saveSubmission(db, document, submission, actor.name);
      await audit(db, onboardingDocumentRecordId(targetEmail, document.id), actor, `${document.title} Employer Review Completed`, submission.contentHash);
      return Response.json({ submission });
    }

    return Response.json({ error: "Unsupported Onboarding Document Action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Onboarding Document Could Not Be Saved" }, { status: 500 });
  }
}

async function documentDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (project_id text NOT NULL, id text NOT NULL, record_type text NOT NULL, title text NOT NULL, owner text NOT NULL, due text NOT NULL, status text NOT NULL, meta text DEFAULT '' NOT NULL, record_date text, record_time text, date_locked integer DEFAULT false NOT NULL, data_json text DEFAULT '{}' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY(project_id, id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (email text PRIMARY KEY NOT NULL, display_name text NOT NULL, company_access_level text NOT NULL, designations_json text DEFAULT '[]' NOT NULL, is_active integer DEFAULT true NOT NULL, identity_provider text DEFAULT 'microsoft_entra_pending' NOT NULL, provider_subject text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS record_audits (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, project_id text NOT NULL, record_id text NOT NULL, field_name text NOT NULL, old_value text NOT NULL, new_value text NOT NULL, reason text NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL, summary text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
  ]);
  const { getDb } = await import("../../../../db");
  return getDb();
}

async function canAdminister(db: Awaited<ReturnType<typeof documentDatabase>>, email: string, accessLevel: string) {
  if (["Company Owner", "Administrator"].includes(accessLevel)) return true;
  const row = await db.select({ level: companyMembers.companyAccessLevel }).from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
  return ["Company Owner", "Administrator"].includes(row[0]?.level || "");
}

async function loadEmployee(db: Awaited<ReturnType<typeof documentDatabase>>, email: string) {
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, employeeRecordId(email)))).limit(1);
  return parseEmployeeData(rows[0]?.dataJson || "");
}

async function documentReleaseStatus(db: Awaited<ReturnType<typeof documentDatabase>>, document: OnboardingDocumentDefinition) {
  if (document.defaultReleaseStatus === "Ready") return "Ready";
  const rows = await db.select({ status: commandRecords.status, dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, onboardingTemplateRecordId(document.id)))).limit(1);
  const data = parseData(rows[0]?.dataJson || "{}");
  return rows[0]?.status === "Ready" && data.releaseStatus === "Ready" ? "Ready" : document.defaultReleaseStatus;
}

async function loadSubmission(db: Awaited<ReturnType<typeof documentDatabase>>, email: string, documentId: string) {
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, onboardingDocumentRecordId(email, documentId)))).limit(1);
  return rows[0] ? parseData(rows[0].dataJson) as unknown as DocumentSubmission : null;
}

async function saveSubmission(db: Awaited<ReturnType<typeof documentDatabase>>, document: OnboardingDocumentDefinition, submission: DocumentSubmission, actorName: string) {
  const now = new Date().toISOString();
  const id = onboardingDocumentRecordId(submission.employeeEmail, document.id);
  await db.insert(commandRecords).values({
    projectId: PEOPLE_PROJECT_ID,
    id,
    recordType: "Onboarding Document Submission",
    title: `${submission.employeeName} · ${document.title}`,
    owner: submission.employeeEmail,
    due: now.slice(0, 10),
    status: submission.status,
    meta: `${document.version} · ${document.restricted ? "Restricted" : "Employee Record"} · Updated By ${actorName}`,
    recordDate: now.slice(0, 10),
    dateLocked: submission.status !== "Draft",
    dataJson: JSON.stringify(submission),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [commandRecords.projectId, commandRecords.id],
    set: { status: submission.status, meta: `${document.version} · ${document.restricted ? "Restricted" : "Employee Record"} · Updated By ${actorName}`, dateLocked: submission.status !== "Draft", dataJson: JSON.stringify(submission), updatedAt: now },
  });
}

function sanitizeAnswers(document: OnboardingDocumentDefinition, input: Record<string, unknown>) {
  const allowed = new Map(document.fields.map((field) => [field.id, field]));
  const answers: Array<[string, string | boolean]> = [];
  for (const [key, value] of Object.entries(input)) {
    const field = allowed.get(key);
    if (!field) continue;
    answers.push(field.type === "checkbox"
      ? [key, Boolean(value)]
      : [key, String(value ?? "").trim().slice(0, field.type === "textarea" ? 4000 : 500)]);
  }
  return Object.fromEntries(answers) as Record<string, string | boolean>;
}

function missingRequired(document: OnboardingDocumentDefinition, answers: Record<string, string | boolean>, role: "Employee" | "Employer") {
  return requiredFieldsForRole(document, role).filter((field) => {
    if (document.id === "kentucky-k4-2026" && answers.requestType === "No K-4 Required" && field.id === "ssn") return false;
    const value = answers[field.id];
    return field.type === "checkbox" ? value !== true : !String(value ?? "").trim();
  }).map((field) => field.label);
}

function signature(actor: ReturnType<typeof getCommandActor>, role: "Employee" | "Employer", signedAt: string): Signature {
  return { name: actor.name, email: actor.email, role, method: "Authenticated Typed Signature", signedAt };
}

function samePerson(left?: string, right?: string) {
  return Boolean(left?.trim() && right?.trim() && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function resolveRoleAssignments(members: Array<typeof companyMembers.$inferSelect>) {
  const ordered = [...members].sort((left, right) => left.displayName.localeCompare(right.displayName));
  const byDesignation = (designation: string) => ordered.find((member) => parseStringList(member.designationsJson).includes(designation));
  const administrator = ordered.find((member) => member.companyAccessLevel === "Administrator") || ordered.find((member) => member.email === "jmefford@meffcon.com") || ordered.find((member) => member.companyAccessLevel === "Company Owner");
  const accountant = byDesignation("Accountant");
  const safetyDirector = byDesignation("Safety Director") || byDesignation("Safety");
  const output: Partial<Record<RoleAssignment["designation"], RoleAssignment>> = {};
  if (administrator) output.Administrator = { designation: "Administrator", name: administrator.displayName, email: administrator.email };
  if (accountant) output.Accountant = { designation: "Accountant", name: accountant.displayName, email: accountant.email };
  if (safetyDirector) output["Safety Director"] = { designation: "Safety Director", name: safetyDirector.displayName, email: safetyDirector.email };
  return output;
}

function applySystemManagedAnswers(
  document: OnboardingDocumentDefinition,
  current: Record<string, string | boolean>,
  roles: ReturnType<typeof resolveRoleAssignments>,
  actor: ReturnType<typeof getCommandActor>,
  role: "Employee" | "Employer",
) {
  const next = { ...current };
  for (const field of document.fields.filter((candidate) => (candidate.role || "Employee") === role)) {
    if (field.fixedValue) next[field.id] = field.fixedValue;
    else if (field.roleBinding) next[field.id] = roles[field.roleBinding as keyof typeof roles]?.name || "";
    else if (field.actorName) next[field.id] = actor.name;
  }
  return next;
}

async function loadOutsideCounsel(db: Awaited<ReturnType<typeof documentDatabase>>) {
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, OUTSIDE_COUNSEL_RECORD_ID))).limit(1);
  return parseData(rows[0]?.dataJson || "{}");
}

function signedSnapshot(submission: DocumentSubmission) {
  return { ...submission, revisions: undefined, supersededAt: new Date().toISOString() };
}

async function submissionHash(submission: DocumentSubmission) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    documentId: submission.documentId,
    documentVersion: submission.documentVersion,
    employeeEmail: submission.employeeEmail,
    answers: submission.answers,
    employeeSignature: submission.employeeSignature,
    employerSignature: submission.employerSignature,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function audit(db: Awaited<ReturnType<typeof documentDatabase>>, recordId: string, actor: ReturnType<typeof getCommandActor>, reason: string, detail: string) {
  await db.insert(recordAudits).values({
    projectId: PEOPLE_PROJECT_ID,
    recordId,
    fieldName: "Onboarding Document",
    oldValue: "Prior Version Preserved",
    newValue: reason,
    reason: detail,
    actorName: actor.name,
    actorEmail: actor.email,
    summary: `${actor.name}: ${reason}`,
  });
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringList(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function administratorRequired() {
  return Response.json({ error: "A Company Owner Or Administrator Is Required" }, { status: 403 });
}
