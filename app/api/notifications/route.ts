import { and, desc, eq } from "drizzle-orm";
import { commandNotifications } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const projectId = search.get("projectId")?.trim() ?? "";
  const recipient = search.get("recipient")?.trim() ?? "";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }
  const { getDb } = await import("../../../db");
  const db = getDb();
  const rows = await db
    .select()
    .from(commandNotifications)
    .where(
      recipient
        ? and(
            eq(commandNotifications.projectId, projectId),
            eq(commandNotifications.recipientName, recipient),
          )
        : eq(commandNotifications.projectId, projectId),
    )
    .orderBy(desc(commandNotifications.id))
    .limit(30);
  return Response.json({ notifications: rows });
}
