import { and, eq } from "drizzle-orm";
import { commandRecords, projects, recordAudits } from "../../../../db/schema";
import { canQueueOfflineAction, resolveOfflineConflict } from "../../../../lib/mobile-core.js";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { resolveCommandActor } from "../../../../lib/server-actor";

type OfflineSyncPayload = {
  id?: string;
  projectId?: string;
  recordType?: string;
  queuedAt?: string;
  record?: {
    id?: string;
    title?: string;
    owner?: string;
    due?: string;
    status?: string;
    meta?: string;
    recordDate?: string;
    recordTime?: string;
    dateLocked?: boolean;
    data?: Record<string, unknown>;
    initialAudit?: string;
  };
};

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as OfflineSyncPayload;
  const projectId = clean(input.projectId, 80);
  const recordType = clean(input.recordType, 100);
  const queuedAt = clean(input.queuedAt, 50);
  const record = input.record;
  if (
    !projectId ||
    !canQueueOfflineAction(recordType) ||
    !queuedAt ||
    !record?.id ||
    !record.title ||
    !record.owner ||
    !record.due ||
    !record.status
  ) {
    return Response.json(
      { error: "Only complete approved field records may sync from an offline queue" },
      { status: 400 },
    );
  }
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const [existing, project] = await Promise.all([
    db
      .select()
      .from(commandRecords)
      .where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, record.id)))
      .limit(1),
    db
      .select({ projectManager: projects.projectManager })
      .from(projects)
      .where(eq(projects.number, projectId))
      .limit(1),
  ]);
  const conflict = existing[0]
    ? resolveOfflineConflict(existing[0].updatedAt, queuedAt) === "preserve_both_review_required"
    : false;
  const suffix = clean(input.id, 80).replace(/[^a-zA-Z0-9]/g, "").slice(-8) || Date.now().toString(36);
  const storedRecordId = conflict ? `${record.id}-OFF-${suffix.toUpperCase()}` : record.id;
  const owner = conflict ? project[0]?.projectManager || record.owner : record.owner;
  const status = conflict ? "PM Review" : record.status;
  const title = conflict ? `Offline Conflict — ${record.title}` : record.title;
  const meta = conflict
    ? `Preserved beside ${record.id} · PM resolution required · ${record.meta || "Offline field update"}`
    : record.meta || "Synced from approved offline field workflow";
  const now = new Date().toISOString();
  const data = {
    ...(record.data || {}),
    mobileOffline: {
      queuedAt,
      syncedAt: now,
      submittedBy: actor.name,
      submittedByEmail: actor.email,
      sourceRecordId: record.id,
      preservedConflict: conflict,
      resolutionRequired: conflict,
    },
  };
  const values = {
    projectId,
    id: storedRecordId,
    recordType,
    title,
    owner,
    due: record.due,
    status,
    meta,
    recordDate: record.recordDate || null,
    recordTime: record.recordTime || null,
    dateLocked: record.dateLocked === true,
    dataJson: JSON.stringify(data),
    updatedAt: now,
  };
  await db
    .insert(commandRecords)
    .values(values)
    .onConflictDoUpdate({
      target: [commandRecords.projectId, commandRecords.id],
      set: values,
    });
  const summary = conflict
    ? `${actor.name}'s offline ${recordType} conflicted with a newer server record. Both versions were preserved as ${record.id} and ${storedRecordId}; PM review is required.`
    : `${actor.name}'s offline ${recordType} synced from the trusted mobile queue without overwriting a newer server record.`;
  await db.insert(recordAudits).values({
    projectId,
    recordId: storedRecordId,
    fieldName: conflict ? "Offline Conflict" : "Offline Sync",
    oldValue: conflict ? record.id : "Queued Offline",
    newValue: storedRecordId,
    reason: conflict ? "Preserve Both And Require Reviewed Resolution" : "Approved Offline Field Workflow",
    actorName: actor.name,
    actorEmail: actor.email,
    summary,
  });
  return Response.json({
    synced: true,
    conflict,
    storedRecordId,
    status,
    audit: summary,
  });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
