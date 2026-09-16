import { eq } from "drizzle-orm";
import {
  commandNotifications,
  commandRecords,
  companyMembers,
  projectFiles,
  recordAudits,
} from "../../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";

type ResetPayload = {
  projectId?: string;
  projectName?: string;
  confirmation?: string;
};

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const payload = (await request.json()) as ResetPayload;
    const projectId = payload.projectId?.trim() || "";
    const projectName = payload.projectName?.trim() || "";
    if (!projectId || !projectName) {
      return Response.json(
        { error: "Project information is required." },
        { status: 400 },
      );
    }
    if (payload.confirmation?.trim() !== projectName) {
      return Response.json(
        { error: `Type ${projectName} exactly to confirm the reset.` },
        { status: 400 },
      );
    }

    const [{ getDb }, { env }] = await Promise.all([
      import("../../../../db"),
      import("cloudflare:workers"),
    ]);
    const db = getDb();
    if (!(await isCompanyOwner(db, actor))) {
      return Response.json(
        { error: "Company Owner access is required." },
        { status: 403 },
      );
    }
    const [recordRows, auditRows, notificationRows, fileRows] = await Promise.all([
      db.select({ id: commandRecords.id }).from(commandRecords).where(eq(commandRecords.projectId, projectId)),
      db.select({ id: recordAudits.id }).from(recordAudits).where(eq(recordAudits.projectId, projectId)),
      db.select({ id: commandNotifications.id }).from(commandNotifications).where(eq(commandNotifications.projectId, projectId)),
      db.select({ id: projectFiles.id, storageKey: projectFiles.storageKey }).from(projectFiles).where(eq(projectFiles.projectId, projectId)),
    ]);

    const storageKeys = fileRows.map((file) => file.storageKey);
    for (let index = 0; index < storageKeys.length; index += 100) {
      await env.BUCKET.delete(storageKeys.slice(index, index + 100));
    }
    await db.delete(recordAudits).where(eq(recordAudits.projectId, projectId));
    await db.delete(commandNotifications).where(eq(commandNotifications.projectId, projectId));
    await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
    await db.delete(commandRecords).where(eq(commandRecords.projectId, projectId));

    return Response.json({
      reset: true,
      deleted: {
        records: recordRows.length,
        audits: auditRows.length,
        notifications: notificationRows.length,
        files: fileRows.length,
      },
    });
  } catch {
    return Response.json(
      { error: "Command Center could not complete the project reset." },
      { status: 500 },
    );
  }
}

async function isCompanyOwner(
  db: ReturnType<(typeof import("../../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (actor.accessLevel === "Company Owner") return true;
  if (!actor.email) return false;
  const member = await db
    .select({ accessLevel: companyMembers.companyAccessLevel })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  return member[0]?.accessLevel === "Company Owner";
}
