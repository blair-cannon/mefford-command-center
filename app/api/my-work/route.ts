import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { recordFirstPartyFailure } from "../../../lib/runtime-observability";
import {
  effectiveActor,
  loadMyWorkSnapshot,
  savePreferences,
  syncMyWork,
  updateWorkItem,
} from "../../../lib/my-work";

type MyWorkPayload = {
  action?: "read" | "unread" | "acknowledge" | "complete" | "snooze" | "update_preferences" | "reconcile";
  itemId?: string;
  snoozedUntil?: string;
  preferences?: {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    quietHoursEnabled?: boolean;
    quietStart?: string;
    quietEnd?: string;
    digestMode?: string;
  };
};

const MY_WORK_POLICY = {
  channels: ["In-App", "Email", "Push"],
  dueReminder: "At Due Time",
  morningDigest: "Every Activated User · 6:00 AM Local Time · Seven Days A Week",
  escalation: "48 Hours Responsible User · 72 Hours Manager · 96 Hours Owner/Admin",
  externalDelivery: "Operational Notices Only",
  invoiceSafeguard: "No Invoice Is Automatically Sent Or Posted",
};

async function myWorkFailure(error: unknown, actorEmail: string, operation: string) {
  const requestId = crypto.randomUUID();
  const reason = error instanceof Error ? error.message : `My Work ${operation} failed`;
  console.error(`My Work ${operation} failed · ${requestId} · ${reason}`);
  await recordFirstPartyFailure({
    route: "/api/my-work",
    status: 500,
    reason: `${operation}: ${reason}`,
    actorEmail,
  });
  return Response.json(
    { error: "My Work Is Temporarily Unavailable", requestId },
    { status: 500, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const authorizedActor = await effectiveActor(actor);
    const result = await loadMyWorkSnapshot(authorizedActor);
    return Response.json({
      ...result,
      policy: MY_WORK_POLICY,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return myWorkFailure(error, actor.email, "snapshot read");
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const authorizedActor = await effectiveActor(actor);
    const payload = (await request.json()) as MyWorkPayload;
    if (payload.action === "reconcile") {
      const result = await syncMyWork(authorizedActor);
      return Response.json({ ...result, policy: MY_WORK_POLICY });
    }
    if (payload.action === "update_preferences") {
      const preferences = await savePreferences(actor.email, payload.preferences || {});
      return Response.json({ saved: true, preferences });
    }
    if (!payload.itemId || !payload.action || !["read", "unread", "acknowledge", "complete", "snooze"].includes(payload.action)) {
      return Response.json({ error: "A Valid Work Item Action Is Required" }, { status: 400 });
    }
    const result = await updateWorkItem(
      authorizedActor,
      payload.itemId,
      payload.action as "read" | "unread" | "acknowledge" | "complete" | "snooze",
      payload.snoozedUntil,
    );
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch (error) {
    return myWorkFailure(error, actor.email, "mutation or reconciliation");
  }
}
