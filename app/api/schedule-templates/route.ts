import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projects, recordAudits, templateGovernanceApprovals, templateGovernanceVersions } from "../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  SCHEDULE_TEMPLATE_PROJECT_ID,
  SCHEDULE_TEMPLATE_RECORD_TYPE,
  STANDARD_SCHEDULE_TEMPLATES,
  type ScheduleTemplate,
  type ScheduleTemplateTask,
} from "../../../lib/schedule-templates";
import { SCHEDULE_QUALITY_CATEGORIES } from "../../../lib/quality-control";
import { assertTemplateApproved, governanceStatus } from "../../../lib/template-governance";

type Input = { action?: "save-template" | "prepare-template"; projectId?: string; templateId?: string; name?: string };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const db = await database();
    const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SCHEDULE_TEMPLATE_PROJECT_ID), eq(commandRecords.recordType, SCHEDULE_TEMPLATE_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt));
    const custom = rows.map(templateFromRow).filter(Boolean) as ScheduleTemplate[];
    return Response.json({ templates: [...STANDARD_SCHEDULE_TEMPLATES, ...custom] });
  } catch (error) { return scheduleError(error); }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const input = await request.json() as Input;
    const projectId = input.projectId?.trim() || "";
    if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
    const db = await database();
    const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
    if (!project) return Response.json({ error: "Project Was Not Found" }, { status: 404 });
    if (!(await canManageSchedule(db, actor, project.projectManager))) return Response.json({ error: "Project Manager Administrator Or Company Owner Schedule Access Is Required" }, { status: 403 });
    if (input.action === "save-template") {
      const name = input.name?.trim() || "";
      if (name.length < 4 || name.length > 80) return Response.json({ error: "Enter A Template Name Between 4 And 80 Characters" }, { status: 400 });
      const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Schedule"))).orderBy(commandRecords.recordDate, commandRecords.id);
      if (!rows.length) return Response.json({ error: "Add At Least One Schedule Activity Before Saving A Template" }, { status: 409 });
      const parsed = rows.map((row) => ({ row, data: parse(row.dataJson) }));
      const starts = parsed.map(({ row, data }) => String(data.start || row.recordDate || "")).filter(validDate).sort();
      const firstStart = starts[0];
      if (!firstStart) return Response.json({ error: "Every Template Activity Requires A Valid Start Date" }, { status: 409 });
      const tasks: ScheduleTemplateTask[] = parsed.map(({ row, data }) => ({
        name: row.title,
        offsetDays: dateDifference(firstStart, String(data.start || row.recordDate)),
        days: Math.max(1, Number(data.days || 1)),
        dependency: String(data.dependency || "None"),
        qualityCategoryId: String(data.qualityCategoryId || ""),
        tone: String(data.tone || "orange"),
      }));
      if (tasks.some((task) => !SCHEDULE_QUALITY_CATEGORIES.some((category) => category.id === task.qualityCategoryId))) return Response.json({ error: "Every Activity Requires A Valid Quality Category Before Template Publication" }, { status: 409 });
      const now = new Date().toISOString();
      const id = `SCHEDULE-TEMPLATE-${crypto.randomUUID()}`;
      const data = { id, name, description: `${tasks.length} activities saved from ${project.number} · ${project.name}.`, source: "Saved Company Template", tasks, sourceProjectId: projectId, publishedBy: actor.name, publishedAt: now, revision: 1 };
      await db.insert(commandRecords).values({ projectId: SCHEDULE_TEMPLATE_PROJECT_ID, id, recordType: SCHEDULE_TEMPLATE_RECORD_TYPE, title: name, owner: actor.name, due: "Governance Approval", status: "Draft — Not Approved for Use", meta: `${tasks.length} Activities · Revision 1 · Release Blocked`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await db.insert(recordAudits).values({ projectId: SCHEDULE_TEMPLATE_PROJECT_ID, recordId: id, fieldName: "Schedule Template Draft", oldValue: "Not Created", newValue: "Draft — Not Approved for Use", reason: "Governed company schedule template candidate", actorName: actor.name, actorEmail: actor.email, summary: `${name} captured from ${projectId} with ${tasks.length} quality-categorized activities. Release remains blocked pending source registration and approvals.` });
      return Response.json({ saved: true, template: data, notice: `${name} Saved As Draft — Not Approved for Use.` }, { status: 201 });
    }
    if (input.action === "prepare-template") {
      await assertScheduleTemplateRelease(db);
      const existing = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Schedule"))).limit(1);
      if (existing.length) return Response.json({ error: "Templates Apply Only To An Empty Project Schedule. Existing Activities Were Preserved." }, { status: 409 });
      const template = await findTemplate(db, input.templateId?.trim() || "");
      if (!template) return Response.json({ error: "Schedule Template Was Not Found" }, { status: 404 });
      const projectStart = validDate(project.startDate) ? project.startDate : new Date().toISOString().slice(0, 10);
      const tasks = template.tasks.map((task, index) => ({ id: index + 1, name: task.name, trade: "Mefford Crew", start: addDays(projectStart, task.offsetDays), days: task.days, progress: 0, dependency: task.dependency, tone: task.tone, baselineStart: addDays(projectStart, task.offsetDays), baselineDays: task.days, qualityCategoryId: task.qualityCategoryId }));
      return Response.json({ prepared: true, template: { id: template.id, name: template.name }, projectStart, tasks, notice: `${template.name} Prepared For ${project.name}. Save Through The Controlled Schedule Workflow To Apply.` });
    }
    return Response.json({ error: "A Valid Schedule Template Action Is Required" }, { status: 400 });
  } catch (error) { return scheduleError(error); }
}

async function assertScheduleTemplateRelease(db: Awaited<ReturnType<typeof database>>) {
  const governed = (await db.select().from(templateGovernanceVersions).where(eq(templateGovernanceVersions.templateId, "schedule-baseline")).orderBy(desc(templateGovernanceVersions.createdAt)).limit(1))[0];
  if (!governed) return assertTemplateApproved({ templateId: "schedule-baseline", status: "Missing Source Master", sourceSha256: "", version: "" });
  const approvals = await db.select().from(templateGovernanceApprovals).where(eq(templateGovernanceApprovals.governanceVersionId, governed.id));
  const requiredReviewers = parseArray(governed.requiredReviewersJson);
  const status = governanceStatus({ sourceSha256: governed.sourceSha256, requiredReviewers, approvals, nextReviewDate: governed.nextReviewDate });
  return assertTemplateApproved({ templateId: governed.templateId, status, sourceSha256: governed.sourceSha256, version: governed.version });
}

async function findTemplate(db: Awaited<ReturnType<typeof database>>, id: string) {
  const standard = STANDARD_SCHEDULE_TEMPLATES.find((template) => template.id === id);
  if (standard) return standard;
  const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SCHEDULE_TEMPLATE_PROJECT_ID), eq(commandRecords.recordType, SCHEDULE_TEMPLATE_RECORD_TYPE), eq(commandRecords.id, id))).limit(1))[0];
  return row ? templateFromRow(row) : null;
}

function templateFromRow(row: typeof commandRecords.$inferSelect) {
  const data = parse(row.dataJson);
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter((item): item is ScheduleTemplateTask => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  if (!tasks.length) return null;
  return { id: row.id, name: String(data.name || row.title), description: String(data.description || row.meta), source: "Saved Company Template" as const, tasks };
}

async function canManageSchedule(db: Awaited<ReturnType<typeof database>>, actor: ReturnType<typeof getCommandActor>, projectManager: string) {
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email || "")).limit(1))[0];
  const level = member?.companyAccessLevel || actor.accessLevel;
  const designations = parseArray(member?.designationsJson || "[]");
  return ["Company Owner", "Administrator"].includes(level) || designations.includes("Project Manager") || actor.name === projectManager;
}

function parse(value: string) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {} as Record<string, unknown>; } }
function parseArray(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function dateDifference(first: string, value: string) { return Math.max(0, Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86_400_000)); }
async function database() { const { getDb } = await import("../../../db"); return getDb(); }
function scheduleError(error: unknown) { const message = error instanceof Error ? error.message : "Schedule Templates Are Unavailable"; console.error("schedule template error", error); return Response.json({ error: message }, { status: 500 }); }
