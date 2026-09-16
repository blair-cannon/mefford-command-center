import { desc, eq } from "drizzle-orm";
import { commandWorkItems } from "../../../../../db/schema";
import { resolveCommandActor } from "../../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../../lib/onboarding";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const { getDb } = await import("../../../../../db");
  const item = (await getDb()
    .select()
    .from(commandWorkItems)
    .where(eq(commandWorkItems.recipientEmail, actor.email))
    .orderBy(desc(commandWorkItems.updatedAt))
    .limit(1))[0];
  if (!item) return Response.json({ title: "Command Center", body: "Open Command Center to review your work.", url: "/?target=My%20Work", priority: "Normal" });
  return Response.json({
    title: item.priority === "Critical" ? `Critical · ${item.title}` : item.title,
    body: item.message,
    url: `/?target=${encodeURIComponent(item.actionTarget)}&project=${encodeURIComponent(item.projectId)}&record=${encodeURIComponent(item.sourceRecordId)}`,
    priority: item.priority,
    tag: `command-work-${item.id}`,
  });
}
