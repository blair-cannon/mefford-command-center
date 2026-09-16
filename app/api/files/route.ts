import { canReadFileScope, fileUploadScopeError } from "../../../lib/project-file-access";
import { and, desc, eq } from "drizzle-orm";
import type { getDb } from "../../../db";
import { commandRecords, companyMembers, projectFiles, projects } from "../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { REVIEW_PROJECT_ID, TEMPLATE_REVIEW_RECORD_TYPE, reviewTemplateById, reviewTemplateIdFromFileCategory } from "../../../lib/template-review";
import { isPhotoUpload, isVideoUpload, photoUploadContentType, storedFileResponseHeaders } from "../../../lib/photo-uploads";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const search = new URL(request.url).searchParams;
  const id = Number(search.get("id"));
  const [{ getDb }, { env }] = await Promise.all([
    import("../../../db"),
    import("cloudflare:workers"),
  ]);
  const db = getDb();
  await ensureProjectFileSchema();
  if (Number.isInteger(id) && id > 0) {
    const row = await db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.id, id))
      .limit(1);
    if (!row[0]) return Response.json({ error: "File not found" }, { status: 404 });
    if (!(await canReadFileScope(db, actor, row[0]))) return Response.json({ error: "Assigned Project Or Authorized Company File Access Is Required" }, { status: 403 });
    const employeeBenefitMaster = await isCurrentEmployeeBenefitMaster(db, row[0]);
    if (row[0].projectId !== "MEFFORD-PEOPLE" && !employeeBenefitMaster) {
      const onboardingLock = await enforceOnboardingAccess(request);
      if (onboardingLock) return onboardingLock;
    }
    if (
      row[0].projectId === "MEFFORD-BID-ARCHIVE" &&
      !(await canAccessBidArchive(db, actor))
    ) {
      return Response.json({ error: "Bid Archive Access Is Required" }, { status: 403 });
    }
    if (
      row[0].projectId === REVIEW_PROJECT_ID &&
      !employeeBenefitMaster &&
      !(await canAccessReviewCenter(db, actor))
    ) {
      return Response.json({ error: "Review Center Access Is Required" }, { status: 403 });
    }
    if (row[0].projectId === "MEFFORD-PEOPLE" && row[0].category.startsWith("Proposal Headshots / ") && !(await canAccessProposalHeadshot(db, actor, row[0].category))) {
      return Response.json({ error: "Employee Or Company Owner Access Is Required" }, { status: 403 });
    }
    if (row[0].projectId === "MEFFORD-SALES" && ["Marketing Content Asset", "Customer Survey Video", "Customer Survey Photo"].includes(row[0].category) && !(await canAccessMarketingFile(db, actor, row[0]))) {
      return Response.json({ error: "Marketing Or Assigned Project Team Access Is Required" }, { status: 403 });
    }
    if (row[0].projectId === "MEFFORD-SALES" && row[0].category.startsWith("Sales Contacts /") && !(await canAccessSalesContactFile(db, actor))) {
      return Response.json({ error: "Pre-Construction Sales Access Is Required" }, { status: 403 });
    }
    if (/^(Safety|SDS|Visitor|Incident)/i.test(row[0].category) && !(await canAccessSafetyFile(db, actor, row[0].projectId, row[0].category.startsWith("Incident")))) {
      return Response.json({ error: "Project Safety File Access Is Required" }, { status: 403 });
    }
    const object = await env.BUCKET.get(row[0].storageKey);
    if (!object) return Response.json({ error: "File content not found" }, { status: 404 });
    return new Response(object.body, { headers: storedFileResponseHeaders({ name: row[0].name, contentType: row[0].contentType, sizeBytes: row[0].sizeBytes }) });
  }

  const projectId = search.get("projectId")?.trim() ?? "";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }
  if (!(await canReadFileScope(db, actor, { projectId }))) return Response.json({ error: "Assigned Project Or Authorized Company File Access Is Required" }, { status: 403 });
  if (projectId !== "MEFFORD-PEOPLE") {
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
  }
  if (
    projectId === "MEFFORD-BID-ARCHIVE" &&
    !(await canAccessBidArchive(db, actor))
  ) {
    return Response.json({ error: "Bid Archive Access Is Required" }, { status: 403 });
  }
  if (
    projectId === REVIEW_PROJECT_ID &&
    !(await canAccessReviewCenter(db, actor))
  ) {
    return Response.json({ error: "Review Center Access Is Required" }, { status: 403 });
  }
  const rows = await db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(desc(projectFiles.id));
  const safetyAccess = await canAccessSafetyFile(db, actor, projectId, false);
  const incidentAccess = await canAccessSafetyFile(db, actor, projectId, true);
  const salesContactAccess = projectId !== "MEFFORD-SALES" || await canAccessSalesContactFile(db, actor);
  const visibleRows = await Promise.all(rows.map(async (row) => ({ row, visible: await canReadFileScope(db, actor, row) && (!row.category.startsWith("Proposal Headshots / ") || await canAccessProposalHeadshot(db, actor, row.category)) && (!["Marketing Content Asset", "Customer Survey Video", "Customer Survey Photo"].includes(row.category) || await canAccessMarketingFile(db, actor, row)) })));
  return Response.json({ files: visibleRows.filter(({ row, visible }) => visible && (!row.category.startsWith("Sales Contacts /") || salesContactAccess) && (!/^(Safety|SDS|Visitor|Incident)/i.test(row.category) || (row.category.startsWith("Incident") ? incidentAccess : safetyAccess))).map(({ row }) => toClientFile(row)) });
}

async function canAccessBidArchive(
  db: ReturnType<typeof getDb>,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (!actor.email) return false;
  const member = await db
    .select({
      accessLevel: companyMembers.companyAccessLevel,
      designationsJson: companyMembers.designationsJson,
    })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  if (["Company Owner", "Administrator"].includes(member[0]?.accessLevel || "")) {
    return true;
  }
  try {
    const designations = JSON.parse(member[0]?.designationsJson || "[]") as unknown;
    return Array.isArray(designations) &&
      (designations.includes("Estimator") || designations.includes("Sales Representative"));
  } catch {
    return false;
  }
}

async function canAccessReviewCenter(
  db: ReturnType<typeof getDb>,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (!actor.email) return false;
  const member = await db
    .select({
      accessLevel: companyMembers.companyAccessLevel,
      designationsJson: companyMembers.designationsJson,
    })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  if (["Company Owner", "Administrator"].includes(member[0]?.accessLevel || "")) return true;
  try {
    const designations = JSON.parse(member[0]?.designationsJson || "[]") as unknown;
    return Array.isArray(designations) && designations.some((designation) => ["Attorney", "Human Resources", "Benefits Administrator"].includes(String(designation)));
  } catch {
    return false;
  }
}

async function canAccessMarketingFile(
  db: ReturnType<typeof getDb>,
  actor: ReturnType<typeof getCommandActor>,
  file: typeof projectFiles.$inferSelect,
) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (!actor.email) return false;
  const member = await db.select({ accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson, displayName: companyMembers.displayName, isActive: companyMembers.isActive }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
  if (!member[0]?.isActive) return false;
  if (["Company Owner", "Administrator"].includes(member[0].accessLevel)) return true;
  let designations: string[] = [];
  try { const parsed = JSON.parse(member[0].designationsJson || "[]") as unknown; if (Array.isArray(parsed)) designations = parsed.map(String); } catch { designations = []; }
  if (designations.some((item) => ["Marketing", "Sales Representative"].includes(item))) return true;
  if (file.category !== "Customer Survey Video") return false;
  const responses = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-SALES"), eq(commandRecords.recordType, "Marketing Customer Survey Response")));
  const projectIds = responses.flatMap((row) => { try { const data = JSON.parse(row.dataJson) as Record<string, unknown>; return Number(data.videoId || 0) === file.id ? [String(data.projectId || "")] : []; } catch { return []; } });
  if (!projectIds.length) return false;
  const assigned = await Promise.all(projectIds.map((projectId) => db.select({ projectManager: projects.projectManager, superintendent: projects.superintendent }).from(projects).where(eq(projects.number, projectId)).limit(1)));
  return assigned.some((rows) => [rows[0]?.projectManager, rows[0]?.superintendent].includes(member[0].displayName));
}

async function isCurrentEmployeeBenefitMaster(
  db: ReturnType<typeof getDb>,
  file: typeof projectFiles.$inferSelect,
) {
  if (file.projectId !== REVIEW_PROJECT_ID) return false;
  const template = reviewTemplateById(reviewTemplateIdFromFileCategory(file.category));
  if (template?.area !== "Benefits") return false;
  const current = await db.select({ id: projectFiles.id }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, REVIEW_PROJECT_ID), eq(projectFiles.category, file.category)))
    .orderBy(desc(projectFiles.id)).limit(1);
  if (current[0]?.id !== file.id) return false;
  const approvals = await db.select({ status: commandRecords.status, dataJson: commandRecords.dataJson, updatedAt: commandRecords.updatedAt }).from(commandRecords)
    .where(and(eq(commandRecords.projectId, REVIEW_PROJECT_ID), eq(commandRecords.recordType, TEMPLATE_REVIEW_RECORD_TYPE)))
    .orderBy(desc(commandRecords.updatedAt));
  return approvals.some((approval) => {
    if (approval.status !== "Owner Signed Off" || approval.updatedAt < file.createdAt) return false;
    try {
      const data = JSON.parse(approval.dataJson) as Record<string, unknown>;
      return String(data.templateId || "") === template.id && String(data.version || "") === file.revision;
    } catch {
      return false;
    }
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const form = await request.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "").trim();
  const category = String(form.get("category") ?? "Drawings").trim();
  const access = String(form.get("access") ?? "Project team").trim();
  const revision = String(form.get("revision") ?? "New Upload").trim();
  if (!(file instanceof File) || !projectId) {
    return Response.json({ error: "A file and project are required" }, { status: 400 });
  }
  const scopeError = await fileUploadScopeError(await commandFileDb(), actor, { projectId, category, contentType: file.type, access });
  if (scopeError) return Response.json({ error: scopeError }, { status: scopeError.startsWith("Scanned") ? 415 : 403 });
  if (
    projectId === "MEFFORD-PEOPLE" &&
    category.startsWith("Employee Onboarding") &&
    !isVideoUpload(file)
  ) {
    return Response.json(
      { error: "Scanned Or Uploaded Onboarding Documents Are Blocked. Use An Official Agency Source Or A Native Command Center Form." },
      { status: 415 },
    );
  }
  if (projectId === "MEFFORD-PEOPLE" && category.startsWith("Proposal Headshots / ")) {
    const targetEmail = category.slice("Proposal Headshots / ".length).trim().toLowerCase();
    if (!targetEmail || (actor.email.toLowerCase() !== targetEmail && actor.accessLevel !== "Company Owner")) return Response.json({ error: "Employees May Upload Only Their Own Proposal Headshot" }, { status: 403 });
    if (!isPhotoUpload(file) || file.size > 10 * 1024 * 1024) return Response.json({ error: "Proposal Headshots Must Be An Image File And 10 MB Or Smaller" }, { status: 415 });
  }
  if (projectId === REVIEW_PROJECT_ID) {
    return Response.json({ error: "Controlled Master Files Must Be Uploaded Through Review Center" }, { status: 403 });
  }
  if (projectId === "MEFFORD-SALES" && category.startsWith("Sales Contacts /") && !(await canAccessSalesContactFile(await commandFileDb(), actor))) {
    return Response.json({ error: "Pre-Construction Sales Access Is Required" }, { status: 403 });
  }
  if (/^(Safety|SDS|Visitor|Incident)/i.test(category) && !(await canAccessSafetyFile(await commandFileDb(), actor, projectId, category.startsWith("Incident")))) {
    return Response.json({ error: "Project Safety File Access Is Required" }, { status: 403 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: "Files must be 25 MB or smaller during this first storage phase" },
      { status: 413 },
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
  const storageKey = `${projectId}/${crypto.randomUUID()}-${safeName}`;
  const contentType = photoUploadContentType(file);
  const [{ getDb }, { env }] = await Promise.all([
    import("../../../db"),
    import("cloudflare:workers"),
  ]);
  await env.BUCKET.put(storageKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: actor.email, category },
  });
  const db = getDb();
  await ensureProjectFileSchema();
  let saved: typeof projectFiles.$inferSelect;
  try {
    [saved] = await db
    .insert(projectFiles)
    .values({
      projectId,
      name: file.name,
      category,
      revision,
      storageKey,
      contentType,
      sizeBytes: file.size,
      uploadedBy: actor.name,
      access,
    })
    .returning();
  } catch {
    await env.BUCKET.delete(storageKey);
    return Response.json({ error: "The File Could Not Be Registered. Please Retry The Upload." }, { status: 500 });
  }
  let microsoftFileMapping: Awaited<ReturnType<(typeof import("../../../lib/sharepoint-storage"))["queueProjectFileForSharePoint"]>> | null = null;
  let microsoftFileWarning = "";
  try {
    const { queueProjectFileForSharePoint } = await import("../../../lib/sharepoint-storage");
    microsoftFileMapping = await queueProjectFileForSharePoint({
      projectFileId: saved.id,
      projectId: saved.projectId,
      name: saved.name,
      category: saved.category,
      storageKey: saved.storageKey,
      sizeBytes: saved.sizeBytes,
      uploadedBy: actor.name,
      uploadedByEmail: actor.email,
    });
  } catch (error) {
    microsoftFileWarning = error instanceof Error ? error.message : "Microsoft File Mapping Could Not Be Registered";
  }
  return Response.json({ file: toClientFile(saved), microsoftFileMapping, microsoftFileWarning }, { status: 201 });
}

async function commandFileDb() {
  const { getDb } = await import("../../../db");
  return getDb();
}

async function canAccessSalesContactFile(db: ReturnType<typeof getDb>, actor: ReturnType<typeof getCommandActor>) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (!actor.email) return false;
  const member = await db.select({ isActive: companyMembers.isActive, accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
  if (!member[0]?.isActive) return false;
  if (["Company Owner", "Administrator"].includes(member[0].accessLevel)) return true;
  try {
    const designations = JSON.parse(member[0].designationsJson || "[]") as unknown;
    return Array.isArray(designations) && designations.some((designation) => ["Sales Representative", "Estimator", "Marketing"].includes(String(designation)));
  } catch {
    return false;
  }
}

async function canAccessSafetyFile(db: ReturnType<typeof getDb>, actor: ReturnType<typeof getCommandActor>, projectId: string, incident: boolean) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  if (!actor.email) return false;
  const [member, project] = await Promise.all([
    db.select({ accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson, displayName: companyMembers.displayName, isActive: companyMembers.isActive }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1),
    db.select({ projectManager: projects.projectManager, superintendent: projects.superintendent }).from(projects).where(eq(projects.number, projectId)).limit(1),
  ]);
  if (!member[0]?.isActive) return false;
  if (["Company Owner", "Administrator"].includes(member[0].accessLevel)) return true;
  let designations: string[] = [];
  try { const parsed = JSON.parse(member[0].designationsJson || "[]") as unknown; if (Array.isArray(parsed)) designations = parsed.filter((item): item is string => typeof item === "string"); } catch { designations = []; }
  const isPm = designations.includes("Project Manager") || project[0]?.projectManager === member[0].displayName;
  const isSuper = designations.includes("Superintendent") || project[0]?.superintendent === member[0].displayName;
  const isSafety = designations.some((designation) => ["Safety Director", "Safety"].includes(designation));
  return incident ? isPm || isSafety : isPm || isSuper || isSafety || designations.includes("Office Staff");
}

async function canAccessProposalHeadshot(db: ReturnType<typeof getDb>, actor: ReturnType<typeof getCommandActor>, category: string) {
  const targetEmail = category.slice("Proposal Headshots / ".length).trim().toLowerCase();
  if (actor.email.toLowerCase() === targetEmail || actor.accessLevel === "Company Owner") return true;
  const member = actor.email ? await db.select({ accessLevel: companyMembers.companyAccessLevel }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  return member[0]?.accessLevel === "Company Owner";
}

function toClientFile(file: typeof projectFiles.$inferSelect) {
  return {
    id: file.id,
    name: file.name,
    category: file.category,
    revision: file.revision,
    uploadedBy: file.uploadedBy,
    contentType: file.contentType,
    createdAt: file.createdAt,
    date: new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${file.createdAt}Z`)),
    size: formatFileSize(file.sizeBytes),
    access: file.access,
    stored: true,
  };
}

function formatFileSize(sizeBytes: number) {
  return sizeBytes >= 1_000_000_000
    ? `${(sizeBytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.max(0.1, sizeBytes / 1_000_000).toFixed(1)} MB`;
}
