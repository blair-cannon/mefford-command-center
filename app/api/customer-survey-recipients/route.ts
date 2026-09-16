import { projectDesignationsFor } from "../../../lib/project-access";
import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, ownerPortalAccess, projects, recordAudits } from "../../../db/schema";
import { CUSTOMER_SURVEY_RECIPIENT_ID, CUSTOMER_SURVEY_RECIPIENT_TYPE } from "../../../lib/customer-voice";
import { resolveCommandActor } from "../../../lib/server-actor";
import { normalizeDesignations, parseRecordData, parseStringArray, PROJECT_TEAM_ASSIGNMENT_TYPE, projectTeamAssignmentId } from "../../../lib/team-access";

type Recipient = { name: string; email: string };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const projectId = String(new URL(request.url).searchParams.get("projectId") || "").trim();
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const context = await recipientContext(projectId, actor);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canView) return Response.json({ error: "Project Team Access Is Required" }, { status: 403 });
  const settings = await context.db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, CUSTOMER_SURVEY_RECIPIENT_ID), eq(commandRecords.recordType, CUSTOMER_SURVEY_RECIPIENT_TYPE))).limit(1);
  const data = parseRecordData(settings[0]?.dataJson);
  const primary = await primaryRecipient(context.db, context.project, data);
  return Response.json({ primary, additional: recipients(data.additional).filter((item) => item.email !== primary.email), canEdit: context.canEdit, cadence: cadence(context.project.ownerContractType, context.project.projectType), policy: "The primary customer contact is always included. Project Managers may add recipients; automatic surveys create a separate single-use link for each recipient." });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as { projectId?: string; additional?: Recipient[] };
  const projectId = String(input.projectId || "").trim();
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const context = await recipientContext(projectId, actor);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canEdit) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
  const existing = await context.db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, CUSTOMER_SURVEY_RECIPIENT_ID), eq(commandRecords.recordType, CUSTOMER_SURVEY_RECIPIENT_TYPE))).limit(1);
  const prior = parseRecordData(existing[0]?.dataJson);
  const primary = await primaryRecipient(context.db, context.project, prior);
  if (!validEmail(primary.email)) return Response.json({ error: "Set The Primary Owner Contact Email In The Owner Contract Or Owner Portal Before Adding Survey Recipients" }, { status: 409 });
  const additional = recipients(input.additional).filter((item) => item.email !== primary.email).slice(0, 20);
  const now = new Date().toISOString();
  const data = { ...prior, primary, additional, updatedBy: actor.name, updatedByEmail: actor.email, updatedAt: now, primaryPolicy: "Required and cannot be removed from automatic delivery" };
  await context.db.insert(commandRecords).values({ projectId, id: CUSTOMER_SURVEY_RECIPIENT_ID, recordType: CUSTOMER_SURVEY_RECIPIENT_TYPE, title: "Automatic Customer Survey Recipients", owner: context.project.projectManager, due: now.slice(0, 10), status: "Active", meta: `Primary + ${additional.length} Additional`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { owner: context.project.projectManager, status: "Active", meta: `Primary + ${additional.length} Additional`, dataJson: JSON.stringify(data), updatedAt: now } });
  await context.db.insert(recordAudits).values({ projectId, recordId: CUSTOMER_SURVEY_RECIPIENT_ID, fieldName: "Automatic Survey Recipients", oldValue: `${recipients(prior.additional).length} Additional`, newValue: `${additional.length} Additional`, reason: "Authorized project survey recipient update; primary contact retained", actorName: actor.name, actorEmail: actor.email, summary: `${context.project.name} surveys will automatically go to the primary contact plus ${additional.length} PM-designated recipient(s)`, createdAt: now });
  return Response.json({ saved: true, primary, additional });
}

async function recipientContext(projectId: string, actor: Awaited<ReturnType<typeof resolveCommandActor>>) {
  const { getDb } = await import("../../../db"); const db = getDb();
  const [projectRows, memberRows] = await Promise.all([db.select().from(projects).where(eq(projects.number, projectId)).limit(1), db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1)]);
  const project = projectRows[0] || null; const member = memberRows[0]; let designations = normalizeDesignations(parseStringArray(member?.designationsJson));
  if (project && member) { const assignment = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, projectTeamAssignmentId(member.email)), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))).limit(1); if (assignment[0]) designations = normalizeDesignations(parseRecordData(assignment[0].dataJson).projectDesignations); }
  if (project) designations = await projectDesignationsFor(db, actor, project, designations);
  const elevated = ["Company Owner", "Administrator"].includes(member?.companyAccessLevel || actor.accessLevel); const isPm = designations.includes("Project Manager") || project?.projectManager === (member?.displayName || actor.name); const marketing = designations.includes("Marketing");
  return { db, project, canEdit: Boolean(elevated || isPm || marketing), canView: Boolean(elevated || isPm || marketing || designations.includes("Superintendent")) };
}

async function primaryRecipient(db: ReturnType<typeof import("../../../db").getDb>, project: typeof projects.$inferSelect, data: Record<string, unknown>) {
  const configured = object(data.primary); const portal = (await db.select().from(ownerPortalAccess).where(eq(ownerPortalAccess.projectId, project.number)).limit(1))[0];
  const contract = (await db.select().from(commandRecords).where(eq(commandRecords.projectId, project.number))).find((record) => ["Contracts", "Owner Contract"].includes(record.recordType)); const contractData = parseRecordData(contract?.dataJson); const fields = object(contractData.fields);
  return { name: text(configured.name || portal?.contactName || project.ownerName), email: text(configured.email || portal?.contactEmail || fields.OWNER_NOTICE_EMAIL || contractData.ownerEmail).toLowerCase(), primary: true };
}

function recipients(value: unknown): Recipient[] { const items = Array.isArray(value) ? value : []; const unique = new Map<string, Recipient>(); for (const raw of items) { const item = object(raw); const email = text(item.email).toLowerCase(); if (!validEmail(email)) continue; unique.set(email, { name: text(item.name) || email.split("@")[0], email }); } return [...unique.values()]; }
function cadence(contractType: string, projectType: string) { const value = `${contractType} ${projectType}`.toLowerCase(); if (/time\s*(?:&|and)\s*material|\bt\s*&\s*m\b/.test(value)) return "Monthly · 24 Hours After Each Owner Invoice"; if (/design\s*[-/&]?\s*build/.test(value)) return "Startup · Design Experience · 50% Schedule · Turnover"; return "50% Schedule · Turnover"; }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return String(value || "").trim(); }
function validEmail(value: string) { return /^\S+@\S+\.\S+$/.test(value); }
import { enforceOnboardingAccess } from "../../../lib/onboarding";
