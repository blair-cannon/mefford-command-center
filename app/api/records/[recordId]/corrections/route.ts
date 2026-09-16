import { and, eq } from "drizzle-orm";
import {
  commandNotifications,
  commandRecords,
  companyMembers,
  projects,
} from "../../../../../db/schema";
import { resolveCommandActor } from "../../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../../lib/onboarding";

type CorrectionPayload = {
  projectId?: string;
  recordType?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
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
  };
  changes?: {
    title?: string;
    owner?: string;
    due?: string;
    status?: string;
    meta?: string;
    recordDate?: string;
    recordTime?: string;
  };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const { recordId } = await context.params;
    const payload = (await request.json()) as CorrectionPayload;
    const projectId = payload.projectId?.trim() ?? "";
    const recordType = payload.recordType?.trim() ?? "";
    const fieldName = payload.fieldName?.trim() ?? "";
    let oldValue = payload.oldValue?.trim() ?? "";
    let newValue = payload.newValue?.trim() ?? "";
    const reason = payload.reason?.trim() ?? "";
    const record = payload.record;
    if (
      !projectId ||
      !recordType ||
      !recordId ||
      !fieldName ||
      !newValue ||
      !reason ||
      !record?.title ||
      !record.owner ||
      !record.due ||
      !record.status
    ) {
      return Response.json(
        { error: "The record, changed field, and reason are required" },
        { status: 400 },
      );
    }

    const { getDb } = await import("../../../../../db");
    const db = getDb();
    let accessLevel = actor.accessLevel;
    if (actor.email) {
      const member = await db
        .select({ accessLevel: companyMembers.companyAccessLevel })
        .from(companyMembers)
        .where(eq(companyMembers.email, actor.email))
        .limit(1);
      if (member[0]?.accessLevel === "Administrator") {
        accessLevel = "Administrator";
      } else if (member[0]?.accessLevel === "Company Owner") {
        accessLevel = "Company Owner";
      }
    }
    if (accessLevel !== "Administrator" && accessLevel !== "Company Owner") {
      return Response.json(
        { error: "Administrator or Company Owner access is required" },
        { status: 403 },
      );
    }

    const existing = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId))).limit(1))[0];
    if (!existing || existing.recordType !== recordType) return Response.json({ error: "The Existing Record Is Required" }, { status: 404 });
    const changes = payload.changes ?? {};
    const allowed = ["title", "owner", "due", "meta", "recordDate", "recordTime"] as const;
    if (Object.keys(changes).some(key => !allowed.includes(key as typeof allowed[number])) || record.status !== existing.status) {
      return Response.json({ error: "Status Changes Require The Record's Controlled Workflow; Corrections Cannot Approve, Pay, Or Execute Records" }, { status: 409 });
    }
    const fields = allowed.filter(key => changes[key] !== undefined);
    if (!fields.length) return Response.json({ error: "At Least One Corrected Field Is Required" }, { status: 400 });
    if (fields.some(key => String(record[key] ?? "") !== String(existing[key] ?? ""))) return Response.json({ error: "This Record Changed. Reload It Before Applying A Correction." }, { status: 409 });
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(existing.dataJson || "{}"); } catch { /* Preserve the stored data unchanged. */ }
    if ((data.livePosting || data.accountingEventId || data.executedAt || ["Paid", "Sent", "Partially Paid", "Executed", "Phase 1 Executed"].includes(existing.status)) && fields.some(key => ["recordDate", "recordTime", "due"].includes(key))) {
      return Response.json({ error: "Posted Or Executed Dates Require The Dedicated Accounting Or Contract Adjustment Workflow" }, { status: 409 });
    }
    oldValue = fields.map(key => key + ": " + String(existing[key] ?? "")).join(" · ");
    newValue = fields.map(key => key + ": " + String(changes[key] ?? "")).join(" · ");
    const next = {
      ...existing,
      ...Object.fromEntries(fields.map(key => [key, changes[key]])),
    };
    const summary = `${accessLevel} ${actor.name} changed ${fieldName} from ${oldValue} to ${newValue} · ${reason}`;
    const { env } = await import("cloudflare:workers");
    const update = db.update(commandRecords).set({
      title: next.title, owner: next.owner, due: next.due, meta: next.meta,
      recordDate: next.recordDate, recordTime: next.recordTime, updatedAt: new Date().toISOString(),
    }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId))).toSQL();
    // The non-null audit record ID is also a stale-write guard. Both writes roll back together.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
        VALUES (?, (SELECT id FROM command_records WHERE project_id = ? AND id = ? AND updated_at = ? AND status = ? AND data_json = ?), ?, ?, ?, ?, ?, ?, ?)`)
        .bind(projectId, projectId, recordId, existing.updatedAt, existing.status, existing.dataJson, fieldName, oldValue, newValue, reason, actor.name, actor.email, summary),
      env.DB.prepare(update.sql).bind(...update.params),
    ]);

    const [projectRows, stakeholderMembers] = await Promise.all([
      db
        .select({ projectManager: projects.projectManager })
        .from(projects)
        .where(eq(projects.number, projectId))
        .limit(1),
      db
        .select({
          name: companyMembers.displayName,
          email: companyMembers.email,
          accessLevel: companyMembers.companyAccessLevel,
          active: companyMembers.isActive,
        })
        .from(companyMembers),
    ]);
    const recipients = new Map<string, { name: string; email: string | null }>();
    for (const member of stakeholderMembers) {
      if (
        member.active &&
        ["Company Owner", "Administrator"].includes(member.accessLevel)
      ) {
        recipients.set(member.name, { name: member.name, email: member.email });
      }
    }
    const projectManager = projectRows[0]?.projectManager;
    if (projectManager) {
      const managerMember = stakeholderMembers.find(
        (member) => member.name === projectManager,
      );
      recipients.set(projectManager, {
        name: projectManager,
        email: managerMember?.email ?? null,
      });
    }
    for (const recipient of recipients.values()) {
      await db.insert(commandNotifications).values({
        projectId,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        kind: "finalized_record_correction",
        title: `${recordId} Was Corrected`,
        message: `${actor.name} corrected ${fieldName}. Reason: ${reason}. The original value remains in the permanent audit history.`,
      });
    }

    const saved = await db
      .select()
      .from(commandRecords)
      .where(
        and(
          eq(commandRecords.projectId, projectId),
          eq(commandRecords.id, recordId),
        ),
      )
      .limit(1);
    return Response.json({
      saved: saved[0],
      audit: summary,
      notified: "Project Manager Owners And Administrators",
      notifiedNames: [...recipients.keys()],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json(
      { error: message.includes("no such table") ? "Permanent storage is initializing." : "The correction could not be saved." },
      { status: 500 },
    );
  }
}
