import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, recordAudits, templateGovernanceApprovals, templateGovernanceVersions } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import {
  REVIEW_PROJECT_ID,
  TEMPLATE_REVIEW_CATALOG,
  TEMPLATE_REVIEW_RECORD_TYPE,
  addReviewYear,
  reviewFileCategory,
  reviewTemplateById,
} from "../../../lib/template-review";
import { DRAFT_NOT_APPROVED, governanceStatus, requiredTemplateReviewers, sha256Hex } from "../../../lib/template-governance";
import { normalizeUploadContentType } from "../../../lib/photo-uploads";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

type ReviewInput = {
  action?: string;
  templateId?: string;
  version?: string;
  reviewDate?: string;
  decision?: "Current — No Change" | "Updated Master";
  changeSummary?: string;
  attestation?: boolean;
  reviewerRole?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  const { getDb } = await import("../../../db");
  const db = getDb();
  await ensureProjectFileSchema();
  const access = await resolveReviewAccess(db, actor);
  if (!access.canView) return Response.json({ error: "Review Center Access Is Required" }, { status: 403 });

  const [rows, audits, fileRows, governanceRows, approvalRows] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, REVIEW_PROJECT_ID), eq(commandRecords.recordType, TEMPLATE_REVIEW_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, REVIEW_PROJECT_ID)).orderBy(desc(recordAudits.id)),
    db.select().from(projectFiles).where(eq(projectFiles.projectId, REVIEW_PROJECT_ID)).orderBy(desc(projectFiles.id)),
    db.select().from(templateGovernanceVersions).orderBy(desc(templateGovernanceVersions.createdAt)),
    db.select().from(templateGovernanceApprovals).orderBy(desc(templateGovernanceApprovals.decidedAt)),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const templates = TEMPLATE_REVIEW_CATALOG.map((template) => {
    const history = rows.filter((row) => String(parse(row.dataJson).templateId || "") === template.id);
    const currentYear = history.find((row) => String(parse(row.dataJson).reviewYear || "") === year);
    const latest = history[0];
    const latestData = parse(latest?.dataJson || "{}");
    const templateFiles = fileRows.filter((file) => file.category === reviewFileCategory(template.id));
    const currentFile = templateFiles[0] || null;
    const governed = governanceRows.find((item) => item.templateId === template.id && !item.supersededById) || null;
    const approvals = governed ? approvalRows.filter((item) => item.governanceVersionId === governed.id) : [];
    const requiredReviewers = governed ? parseStringArray(governed.requiredReviewersJson) : requiredTemplateReviewers(template.area);
    const governedStatus = governed ? governanceStatus({ sourceSha256: governed.sourceSha256, requiredReviewers, approvals, nextReviewDate: governed.nextReviewDate, today }) : currentFile ? DRAFT_NOT_APPROVED : "Missing Source Master";
    const currentVersion = currentFile?.revision || String(latestData.version || template.version);
    const currentYearData = parse(currentYear?.dataJson || "{}");
    const currentYearMatchesVersion = Boolean(currentYear) && String(currentYearData.version || "") === currentVersion;
    const currentYearFollowsFile = !currentFile || Boolean(currentYear && currentYear.updatedAt >= currentFile.createdAt);
    const nextReview = String(latestData.nextReviewDate || "");
    const status = currentYearMatchesVersion && currentYearFollowsFile
      ? "Owner Signed Off"
      : currentYear
        ? "Updated Master — Owner Signoff Required"
        : nextReview && nextReview < today
          ? "Overdue"
          : nextReview && daysBetween(today, nextReview) <= 60
            ? "Due Soon"
            : latest
              ? "Due This Year"
              : "Initial Owner Review Required";
    return {
      ...template,
      status: governedStatus,
      annualReviewStatus: status,
      publishedToEmployees: template.area === "Benefits" && governedStatus === "Approved for Use",
      governance: governed ? { id: governed.id, jurisdiction: governed.jurisdiction, businessOwner: governed.businessOwner, sourceSha256: governed.sourceSha256, effectiveDate: governed.effectiveDate, nextReviewDate: governed.nextReviewDate, requiredReviewers, approvals } : { jurisdiction: "Companywide / Jurisdiction Required", businessOwner: template.owner, sourceSha256: "", effectiveDate: "", nextReviewDate: "", requiredReviewers, approvals: [] },
      currentVersion,
      currentFile: currentFile ? toClientFile(currentFile) : null,
      files: templateFiles.map(toClientFile),
      lastReviewDate: String(latestData.reviewDate || ""),
      nextReviewDate: nextReview,
      lastDecision: String(latestData.decision || ""),
      signedBy: String(latestData.ownerName || ""),
      history: history.map((row) => ({
        id: row.id,
        status: row.status,
        ...parse(row.dataJson),
        auditHistory: audits.filter((audit) => audit.recordId === row.id).map((audit) => ({ id: audit.id, actor: audit.actorName, at: audit.createdAt, summary: audit.summary })),
      })),
    };
  });

  return Response.json({
    year,
    permissions: { ...access },
    templates,
    controls: {
      location: "Company-Level Review Center",
      cadence: "Every Template Every Calendar Year",
      approval: "Required Role Approvals Must Match The Exact SHA-256 Source Before Company Use",
      uploads: "Authorized Department Uploads Create A New Permanent File Version Pending Owner Signoff",
      changes: "Updated Masters Require A New Owner Signoff; Prior Versions Remain Permanent",
      deletion: "No Review Or Prior Version May Be Deleted",
    },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  const { getDb } = await import("../../../db");
  const db = getDb();
  await ensureProjectFileSchema();
  const access = await resolveReviewAccess(db, actor);
  if (!access.canView) return Response.json({ error: "Review Center Access Is Required" }, { status: 403 });

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    if (!access.canUpload) return Response.json({ error: "An Authorized Template Manager Must Upload Controlled Master Versions" }, { status: 403 });
    return uploadMasterVersion(request, db, actor, access.uploadAreas);
  }

  const input = await request.json() as ReviewInput;
  if (input.action === "governance-approval") return approveGovernedVersion(db, actor, access, input);
  if (!access.canReview) return Response.json({ error: "A Company Owner Must Sign The Annual Template Review" }, { status: 403 });
  if (input.action !== "owner-signoff") return Response.json({ error: "A Valid Review Action Is Required" }, { status: 400 });

  const template = reviewTemplateById(input.templateId?.trim() || "");
  const reviewDate = input.reviewDate?.trim() || "";
  const version = input.version?.trim() || "";
  const changeSummary = input.changeSummary?.trim() || "";
  if (!template || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || reviewDate > new Date().toISOString().slice(0, 10) || !version || !input.decision || input.attestation !== true || (input.decision === "Updated Master" && changeSummary.length < 15)) {
    return Response.json({ error: "Template Version Review Date Decision Owner Attestation And Any Update Summary Are Required" }, { status: 400 });
  }

  const currentFiles = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, REVIEW_PROJECT_ID), eq(projectFiles.category, reviewFileCategory(template.id)))).orderBy(desc(projectFiles.id)).limit(1);
  if (!currentFiles[0]) return Response.json({ error: "A Source Master File Is Required Before Any Approval" }, { status: 409 });
  if (currentFiles[0].revision !== version) {
    return Response.json({ error: `Owner Signoff Must Authorize The Current Uploaded Version ${currentFiles[0].revision}` }, { status: 409 });
  }
  const governed = await db.select().from(templateGovernanceVersions).where(and(eq(templateGovernanceVersions.templateId, template.id), eq(templateGovernanceVersions.version, version))).orderBy(desc(templateGovernanceVersions.createdAt)).limit(1);
  if (!governed[0]) return Response.json({ error: "The Uploaded Source Has No Governance Record; Re-upload It Before Approval" }, { status: 409 });

  const reviewYear = reviewDate.slice(0, 4);
  const existingYear = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, REVIEW_PROJECT_ID), eq(commandRecords.recordType, TEMPLATE_REVIEW_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt));
  const matchingYear = existingYear.filter((row) => {
    const data = parse(row.dataJson);
    return String(data.templateId || "") === template.id && String(data.reviewYear || "") === reviewYear;
  });
  const matchingVersion = matchingYear.find((row) => String(parse(row.dataJson).version || "") === version);
  if (matchingVersion) return Response.json({ error: `${template.name} Already Has A Locked ${reviewYear} Owner Signoff For ${version}` }, { status: 409 });

  const id = `TR-${template.id}-${reviewYear}${matchingYear.length ? `-R${matchingYear.length + 1}` : ""}`;
  const now = new Date().toISOString();
  const data = {
    templateId: template.id,
    templateName: template.name,
    category: template.category,
    source: template.source,
    reviewYear,
    version,
    reviewDate,
    nextReviewDate: addReviewYear(reviewDate),
    decision: input.decision,
    changeSummary: input.decision === "Updated Master" ? changeSummary : changeSummary || "Owner confirmed the current master remains complete and suitable.",
    ownerName: actor.name,
    ownerEmail: actor.email,
    signedAt: now,
    attestation: "I reviewed this controlled company template and authorize the stated version for continued company use.",
    priorVersionsRetained: true,
    timeline: [{ action: "Annual Owner Review Signed", actor: actor.name, at: now, detail: `${input.decision} · ${version}` }],
  };
  await db.insert(commandRecords).values({ projectId: REVIEW_PROJECT_ID, id, recordType: TEMPLATE_REVIEW_RECORD_TYPE, title: `${template.name} · ${reviewYear} Owner Review`, owner: actor.name, due: reviewDate, status: "Owner Signed Off", meta: `${template.category} · ${version} · Next ${addReviewYear(reviewDate)}`, recordDate: reviewDate, recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
  await db.insert(recordAudits).values({ projectId: REVIEW_PROJECT_ID, recordId: id, fieldName: "Annual Owner Signoff", oldValue: "Review Required", newValue: input.decision, reason: changeSummary || "Annual template review", actorName: actor.name, actorEmail: actor.email, summary: `${template.name} · ${version} · ${input.decision} · Signed ${reviewDate}. Next review ${addReviewYear(reviewDate)}. Prior versions retained.` });
  await db.insert(templateGovernanceApprovals).values({ id: crypto.randomUUID(), governanceVersionId: governed[0].id, reviewerRole: "Company Owner", reviewerName: actor.name, reviewerEmail: actor.email, decision: "Approved", sourceSha256: governed[0].sourceSha256, note: changeSummary || "Annual owner approval", decidedAt: now }).onConflictDoUpdate({ target: [templateGovernanceApprovals.governanceVersionId, templateGovernanceApprovals.reviewerRole, templateGovernanceApprovals.reviewerEmail], set: { decision: "Approved", sourceSha256: governed[0].sourceSha256, note: changeSummary || "Annual owner approval", decidedAt: now } });
  return Response.json({ saved: true, recordId: id, nextReviewDate: addReviewYear(reviewDate) }, { status: 201 });
}

async function uploadMasterVersion(
  request: Request,
  db: ReturnType<typeof import("../../../db").getDb>,
  actor: ReturnType<typeof getCommandActor>,
  uploadAreas: string[],
) {
  const form = await request.formData();
  if (String(form.get("action") || "") !== "upload-version") return Response.json({ error: "A Valid Review Upload Action Is Required" }, { status: 400 });
  const template = reviewTemplateById(String(form.get("templateId") || "").trim());
  const version = String(form.get("version") || "").trim();
  const effectiveDate = String(form.get("effectiveDate") || "").trim();
  const jurisdiction = String(form.get("jurisdiction") || "Companywide").trim();
  const changeSummary = String(form.get("changeSummary") || "").trim();
  const file = form.get("file");
  if (template && !uploadAreas.includes(template.area)) {
    return Response.json({ error: `${template.area} Template Manager Access Is Required` }, { status: 403 });
  }
  if (!template || !(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES || !version || version.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || effectiveDate > new Date().toISOString().slice(0, 10) || changeSummary.length < 15) {
    return Response.json({ error: "Template File Version Effective Date And A Detailed Change Summary Are Required; Files May Be Up To 25 MB" }, { status: 400 });
  }

  const category = reviewFileCategory(template.id);
  const current = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, REVIEW_PROJECT_ID), eq(projectFiles.category, category))).orderBy(desc(projectFiles.id)).limit(1);
  if (current[0]?.revision.toLowerCase() === version.toLowerCase()) return Response.json({ error: "A New Master Upload Must Use A New Version Label" }, { status: 409 });

  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
  const sourceBytes = await file.arrayBuffer();
  const sourceSha256 = await sha256Hex(sourceBytes);
  const storageKey = `${REVIEW_PROJECT_ID}/${template.id}/${crypto.randomUUID()}-${safeName}`;
  const { env } = await import("cloudflare:workers");
  const contentType = normalizeUploadContentType(file.name, file.type);
  await env.BUCKET.put(storageKey, sourceBytes, {
    httpMetadata: { contentType },
    customMetadata: { templateId: template.id, version, effectiveDate, uploadedBy: actor.email },
  });
  const [saved] = await db.insert(projectFiles).values({
    projectId: REVIEW_PROJECT_ID,
    name: file.name,
    category,
    revision: version,
    storageKey,
    contentType,
    sizeBytes: file.size,
    uploadedBy: actor.name,
    access: `Review Center · ${template.area} Template Managers`,
  }).returning();
  const now = new Date().toISOString();
  const governanceId = crypto.randomUUID();
  await db.insert(templateGovernanceVersions).values({ id: governanceId, templateId: template.id, version, jurisdiction, businessOwner: template.owner, sourceFileId: saved.id, sourceSha256, effectiveDate, nextReviewDate: addReviewYear(effectiveDate), requiredReviewersJson: JSON.stringify(requiredTemplateReviewers(template.area)), status: DRAFT_NOT_APPROVED, createdByEmail: actor.email });
  await db.insert(recordAudits).values({
    projectId: REVIEW_PROJECT_ID,
    recordId: `${template.id}:master-files`,
    fieldName: "Controlled Master Version",
    oldValue: current[0]?.revision || "No File Uploaded",
    newValue: version,
    reason: changeSummary,
    actorName: actor.name,
    actorEmail: actor.email,
    summary: `${template.name} · ${version} uploaded effective ${effectiveDate}. Prior file retained. Owner signoff remains a separate required action.`,
    createdAt: now,
  });
  return Response.json({ file: toClientFile(saved), currentVersion: version, sourceSha256, status: DRAFT_NOT_APPROVED, ownerSignoffRequired: true }, { status: 201 });
}

async function resolveReviewAccess(
  db: ReturnType<typeof import("../../../db").getDb>,
  actor: ReturnType<typeof getCommandActor>,
) {
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  const allAreas = Array.from(new Set(TEMPLATE_REVIEW_CATALOG.map((template) => template.area)));
  const uploadAreas = ["Company Owner", "Administrator"].includes(accessLevel)
    ? allAreas
    : [
        ...(designations.includes("Human Resources") ? ["Human Resources", "Benefits"] : []),
        ...(designations.includes("Benefits Administrator") ? ["Benefits"] : []),
      ];
  const canView = ["Company Owner", "Administrator"].includes(accessLevel)
    || designations.some((designation) => ["Attorney", "Human Resources", "Benefits Administrator"].includes(designation));
  const reviewerRoles = Array.from(new Set([...(accessLevel === "Company Owner" ? ["Company Owner"] : []), ...designations.filter((item) => ["Attorney", "Human Resources", "Accounting Administrator", "Operations / Safety", "Department Owner"].includes(item))]));
  return { canReview: accessLevel === "Company Owner", canUpload: uploadAreas.length > 0, uploadAreas, reviewerRoles, canView, accessLevel };
}

async function approveGovernedVersion(db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>, access: Awaited<ReturnType<typeof resolveReviewAccess>>, input: ReviewInput) {
  const template = reviewTemplateById(input.templateId?.trim() || "");
  const role = input.reviewerRole?.trim() || "";
  if (!template || !role || !access.reviewerRoles.includes(role) || input.attestation !== true) return Response.json({ error: "An Authorized Required Reviewer And Attestation Are Required" }, { status: 403 });
  const governed = await db.select().from(templateGovernanceVersions).where(eq(templateGovernanceVersions.templateId, template.id)).orderBy(desc(templateGovernanceVersions.createdAt)).limit(1);
  if (!governed[0] || !governed[0].sourceSha256) return Response.json({ error: "A Governed Source Master Is Required Before Approval" }, { status: 409 });
  const required = parseStringArray(governed[0].requiredReviewersJson);
  if (!required.includes(role)) return Response.json({ error: `${role} Is Not A Required Reviewer For This Template` }, { status: 409 });
  const now = new Date().toISOString();
  await db.insert(templateGovernanceApprovals).values({ id: crypto.randomUUID(), governanceVersionId: governed[0].id, reviewerRole: role, reviewerName: actor.name, reviewerEmail: actor.email, decision: "Approved", sourceSha256: governed[0].sourceSha256, note: input.changeSummary?.trim() || "Approved exact controlled source", decidedAt: now }).onConflictDoUpdate({ target: [templateGovernanceApprovals.governanceVersionId, templateGovernanceApprovals.reviewerRole, templateGovernanceApprovals.reviewerEmail], set: { decision: "Approved", sourceSha256: governed[0].sourceSha256, note: input.changeSummary?.trim() || "Approved exact controlled source", decidedAt: now } });
  const approvals = await db.select().from(templateGovernanceApprovals).where(eq(templateGovernanceApprovals.governanceVersionId, governed[0].id));
  const status = governanceStatus({ sourceSha256: governed[0].sourceSha256, requiredReviewers: required, approvals, nextReviewDate: governed[0].nextReviewDate });
  await db.update(templateGovernanceVersions).set({ status }).where(eq(templateGovernanceVersions.id, governed[0].id));
  return Response.json({ approved: true, role, status });
}

function toClientFile(file: typeof projectFiles.$inferSelect) {
  return {
    id: file.id,
    name: file.name,
    revision: file.revision,
    uploadedBy: file.uploadedBy,
    contentType: file.contentType,
    createdAt: file.createdAt,
    date: new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(new Date(`${file.createdAt}Z`)),
    size: file.sizeBytes >= 1_000_000 ? `${(file.sizeBytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1_000))} KB`,
  };
}

function parse(value: string) {
  try {
    const result = JSON.parse(value) as unknown;
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000);
}
