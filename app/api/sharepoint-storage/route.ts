import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projects } from "../../../db/schema";
import { enforceOnboardingAccess, PEOPLE_PROJECT_ID, parseEmployeeData } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import {
  copyPendingSharePointFiles,
  provisionPendingSharePointWorkspaces,
  provisionSharePointWorkspace,
  registerUnmappedSharePointFiles,
  registerSharePointWorkspace,
  sharePointControlSnapshot,
} from "../../../lib/sharepoint-storage";

type StorageAction = {
  action?: "register-existing" | "provision-pending" | "copy-pending" | "retry-workspace" | "controlled-folder-test";
  workspaceId?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const access = await storageAccess(actor);
  if (!access.allowed) return Response.json({ error: "Owner Administrator Or IT Administrator Access Is Required" }, { status: 403 });
  try {
    return Response.json({ ...(await sharePointControlSnapshot()), actor: access });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Microsoft File Control Is Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const access = await storageAccess(actor);
  if (!access.canConfigure) return Response.json({ error: "Owner Administrator Or IT Administrator Access Is Required" }, { status: 403 });
  try {
    const input = await request.json() as StorageAction;
    if (input.action === "register-existing") {
      const registered = await registerExisting(actor.name, actor.email);
      const fileMappings = await registerUnmappedSharePointFiles({ actorName: actor.name, actorEmail: actor.email }, 500);
      return Response.json({ saved: true, registered, fileMappings, snapshot: await sharePointControlSnapshot(), notice: `${registered.total} Existing Workspaces And ${fileMappings.registered} Supported File Mappings Were Registered Without Moving Or Deleting Any File.` });
    }
    if (input.action === "provision-pending") {
      const results = await provisionPendingSharePointWorkspaces({ actorName: actor.name, actorEmail: actor.email }, 25);
      return Response.json({ saved: true, results, snapshot: await sharePointControlSnapshot(), notice: "Pending Folder Mappings Were Processed Under The No-Delete Guard." });
    }
    if (input.action === "copy-pending") {
      const results = await copyPendingSharePointFiles({ actorName: actor.name, actorEmail: actor.email }, 10);
      return Response.json({ saved: true, results, snapshot: await sharePointControlSnapshot(), notice: `${results.length} Pending File Copy Attempt${results.length === 1 ? "" : "s"} Completed. Every Command Center Source Was Retained.` });
    }
    if (input.action === "retry-workspace") {
      const workspaceId = String(input.workspaceId || "").trim();
      if (!workspaceId) return Response.json({ error: "A Workspace Mapping Is Required" }, { status: 400 });
      const result = await provisionSharePointWorkspace(workspaceId, { actorName: actor.name, actorEmail: actor.email });
      return Response.json({ saved: true, result, snapshot: await sharePointControlSnapshot() });
    }
    if (input.action === "controlled-folder-test") {
      const mapping = await registerSharePointWorkspace({
        entityType: "Company Templates",
        entityId: "MEFFORD-TEMPLATES",
        displayName: "Mefford Controlled Templates",
        sourceProjectId: "MEFFORD-REVIEW",
        sourceRecordId: "SHAREPOINT-CONTROLLED-TEST",
        actorName: actor.name,
        actorEmail: actor.email,
        provisionWhenReady: false,
      });
      const result = await provisionSharePointWorkspace(mapping.workspaceId, { actorName: actor.name, actorEmail: actor.email });
      return Response.json({ saved: true, result, snapshot: await sharePointControlSnapshot(), notice: "The Controlled Template Folder Test Passed. Nothing Was Deleted Or Replaced." });
    }
    return Response.json({ error: "Select A Supported Microsoft File Control Action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Microsoft File Control Could Not Complete This Action" }, { status: 500 });
  }
}

async function registerExisting(actorName: string, actorEmail: string) {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const [projectRows, opportunityRows, employeeRows] = await Promise.all([
    db.select().from(projects),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-SALES"), eq(commandRecords.recordType, "Sales Opportunities"))),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Employee Onboarding"))),
  ]);
  let estimates = 0;
  let projectCount = 0;
  let employees = 0;
  for (const row of opportunityRows) {
    await registerSharePointWorkspace({ entityType: "Estimate", entityId: row.id, displayName: row.title, sourceProjectId: row.projectId, sourceRecordId: row.id, actorName, actorEmail, provisionWhenReady: false });
    estimates += 1;
  }
  for (const row of projectRows) {
    await registerSharePointWorkspace({ entityType: "Project", entityId: row.number, displayName: row.name, sourceProjectId: row.number, sourceRecordId: row.number, actorName, actorEmail, provisionWhenReady: false });
    projectCount += 1;
  }
  for (const row of employeeRows) {
    const employee = parseEmployeeData(row.dataJson);
    if (!employee) continue;
    await registerSharePointWorkspace({ entityType: "Employee", entityId: employee.email, displayName: employee.name, sourceProjectId: PEOPLE_PROJECT_ID, sourceRecordId: row.id, actorName, actorEmail, provisionWhenReady: false });
    employees += 1;
  }
  await registerSharePointWorkspace({ entityType: "Company Templates", entityId: "MEFFORD-TEMPLATES", displayName: "Mefford Controlled Templates", sourceProjectId: "MEFFORD-REVIEW", sourceRecordId: "TEMPLATE-LIBRARY", actorName, actorEmail, provisionWhenReady: false });
  return { estimates, projects: projectCount, employees, templates: 1, total: estimates + projectCount + employees + 1 };
}

async function storageAccess(actor: ReturnType<typeof getCommandActor>) {
  if (actor.accessLevel === "Company Owner") return { allowed: true, canConfigure: true, accessLevel: actor.accessLevel, designations: ["Company Owner"] };
  const { getDb } = await import("../../../db");
  const db = getDb();
  const rows = await db.select({ accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson, isActive: companyMembers.isActive }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
  const row = rows[0];
  let designations: string[] = [];
  try { const parsed = JSON.parse(row?.designationsJson || "[]") as unknown; if (Array.isArray(parsed)) designations = parsed.map(String); } catch { designations = []; }
  const allowed = Boolean(row?.isActive) && (["Company Owner", "Administrator"].includes(row?.accessLevel || "") || designations.includes("IT Administrator"));
  return { allowed, canConfigure: allowed, accessLevel: row?.accessLevel || actor.accessLevel, designations };
}
