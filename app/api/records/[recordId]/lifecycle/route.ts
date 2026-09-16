import { and, eq } from "drizzle-orm";
import {
  commandNotifications,
  commandRecords,
  companyMembers,
  projects,
  recordAudits,
} from "../../../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../../lib/onboarding";

type LifecycleAction =
  | "return_to_draft"
  | "void_archive"
  | "create_amendment"
  | "permanent_delete";

type LifecyclePayload = {
  projectId?: string;
  recordType?: string;
  action?: LifecycleAction;
  reason?: string;
};

type StoredAllocation = {
  costCode?: string;
  amount?: number | string;
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
    const payload = (await request.json()) as LifecyclePayload;
    const projectId = payload.projectId?.trim() ?? "";
    const recordType = payload.recordType?.trim() ?? "";
    const action = payload.action;
    const reason = payload.reason?.trim() ?? "";
    if (!projectId || !recordId || !recordType || !action || !reason) {
      return Response.json(
        { error: "The record action and required explanation are required" },
        { status: 400 },
      );
    }
    if (!["Contracts", "Subcontracts"].includes(recordType)) {
      return Response.json(
        { error: "This controlled lifecycle is limited to Contracts And Subcontracts" },
        { status: 400 },
      );
    }

    const { getDb } = await import("../../../../../db");
    const db = getDb();
    const accessLevel = await companyAccessLevel(db, actor);
    const canAdminister = ["Company Owner", "Administrator"].includes(
      accessLevel,
    );
    if (!canAdminister) {
      return Response.json(
        { error: "A Company Owner Or Administrator Is Required" },
        { status: 403 },
      );
    }
    if (action === "permanent_delete" && accessLevel !== "Company Owner") {
      return Response.json(
        { error: "Only A Company Owner Can Permanently Delete A Record" },
        { status: 403 },
      );
    }

    const stored = await db
      .select()
      .from(commandRecords)
      .where(
        and(
          eq(commandRecords.projectId, projectId),
          eq(commandRecords.id, recordId),
          eq(commandRecords.recordType, recordType),
        ),
      )
      .limit(1);
    const record = stored[0];
    if (!record) {
      return Response.json({ error: "The record was not found" }, { status: 404 });
    }
    const data = parseData(record.dataJson);
    const wasExecuted =
      record.status === "Executed" ||
      record.status === "Voided & Archived" ||
      Boolean(data.executedAt);
    const today = new Date().toISOString();
    let audit = "";
    let nextRecord: typeof record | undefined;
    let amendment: typeof record | undefined;
    let deleted = false;
    const changedBudgetRecords: Array<{
      id: string;
      data: Record<string, unknown>;
      meta: string;
    }> = [];

    if (action === "permanent_delete") {
      if (wasExecuted || record.status !== "Draft") {
        return Response.json(
          {
            error:
              "Only Draft Records Can Be Permanently Deleted. Approved Or Executed Records Must Be Returned Or Voided And Archived.",
          },
          { status: 409 },
        );
      }
      audit = `${accessLevel} ${actor.name} Permanently Deleted ${recordId} · ${reason}`;
      await db
        .delete(commandRecords)
        .where(
          and(
            eq(commandRecords.projectId, projectId),
            eq(commandRecords.id, recordId),
          ),
        );
      deleted = true;
    } else if (action === "return_to_draft") {
      if (wasExecuted) {
        return Response.json(
          { error: "Executed Records Cannot Return To Draft. Create An Amendment Or Void And Archive The Original." },
          { status: 409 },
        );
      }
      if (record.status === "Draft") {
        return Response.json({ error: "This Record Is Already A Draft" }, { status: 409 });
      }
      audit = `${accessLevel} ${actor.name} Returned ${recordId} To Draft · ${reason}`;
      nextRecord = {
        ...record,
        status: "Draft",
        meta: `Returned To Draft · ${reason}`,
        dateLocked: false,
        dataJson: JSON.stringify({
          ...data,
          returnedToDraftBy: actor.name,
          returnedToDraftAt: today,
          returnReason: reason,
        }),
        updatedAt: today,
      };
      await saveRecord(db, nextRecord);
    } else if (action === "void_archive") {
      if (!wasExecuted) {
        return Response.json(
          { error: "Only Executed Records Can Be Voided And Archived" },
          { status: 409 },
        );
      }
      if (record.status === "Voided & Archived") {
        return Response.json(
          { error: "This Record Is Already Voided And Archived" },
          { status: 409 },
        );
      }
      if (recordType === "Subcontracts") {
        const allocations = Array.isArray(data.costAllocations)
          ? (data.costAllocations as StoredAllocation[])
          : [];
        const budgetRows = await db
          .select()
          .from(commandRecords)
          .where(
            and(
              eq(commandRecords.projectId, projectId),
              eq(commandRecords.recordType, "Budget"),
            ),
          );
        for (const allocation of allocations) {
          const costCode = String(allocation.costCode || "");
          const amount = Number(allocation.amount || 0);
          const budgetRow = budgetRows.find((row) => row.id === costCode);
          if (!budgetRow || !amount) continue;
          const budgetData = parseData(budgetRow.dataJson);
          const nextCommitted = Math.max(
            0,
            Number(budgetData.committedCost || 0) - amount,
          );
          const nextBudgetData = {
            ...budgetData,
            committedCost: nextCommitted,
            forecastCost: Math.max(
              nextCommitted,
              Number(budgetData.actualCost || 0),
            ),
          };
          const nextMeta = `${String(budgetData.division || "Project Budget")} · Commitment Reversed By ${recordId}`;
          await db
            .update(commandRecords)
            .set({
              dataJson: JSON.stringify(nextBudgetData),
              meta: nextMeta,
              updatedAt: today,
            })
            .where(
              and(
                eq(commandRecords.projectId, projectId),
                eq(commandRecords.id, costCode),
              ),
            );
          changedBudgetRecords.push({
            id: costCode,
            data: nextBudgetData,
            meta: nextMeta,
          });
        }
      }
      audit = `${accessLevel} ${actor.name} Voided And Archived ${recordId} · ${reason}`;
      nextRecord = {
        ...record,
        status: "Voided & Archived",
        meta: `Voided And Archived · ${reason}`,
        dateLocked: true,
        dataJson: JSON.stringify({
          ...data,
          wasExecuted: true,
          voidedBy: actor.name,
          voidedAt: today,
          voidReason: reason,
        }),
        updatedAt: today,
      };
      await saveRecord(db, nextRecord);
    } else {
      if (!wasExecuted || record.status !== "Executed") {
        return Response.json(
          { error: "Numbered Amendments Can Only Be Created From An Executed Original Record" },
          { status: 409 },
        );
      }
      const baseId = recordId.replace(/-A\d+$/, "");
      const relatedRows = await db
        .select({ id: commandRecords.id })
        .from(commandRecords)
        .where(
          and(
            eq(commandRecords.projectId, projectId),
            eq(commandRecords.recordType, recordType),
          ),
        );
      const matcher = new RegExp(`^${escapeRegExp(baseId)}-A(\\d+)$`);
      const nextSequence =
        relatedRows.reduce((largest, row) => {
          const match = row.id.match(matcher);
          return match ? Math.max(largest, Number(match[1])) : largest;
        }, 0) + 1;
      const amendmentId = `${baseId}-A${String(nextSequence).padStart(2, "0")}`;
      const amendmentData = {
        amendsRecordId: baseId,
        sourceRecordId: recordId,
        amendmentNumber: nextSequence,
        amendmentReason: reason,
        originalStatus: record.status,
        createdBy: actor.name,
        createdAt: today,
      };
      amendment = {
        ...record,
        id: amendmentId,
        title: `${record.title} · Amendment ${String(nextSequence).padStart(2, "0")}`,
        status: "Draft",
        meta: `Draft Amendment To ${baseId} · ${reason}`,
        dateLocked: false,
        dataJson: JSON.stringify(amendmentData),
        createdAt: today,
        updatedAt: today,
      };
      await saveRecord(db, amendment);
      audit = `${accessLevel} ${actor.name} Created ${amendmentId} For ${recordId} · ${reason}`;
    }

    await db.insert(recordAudits).values({
      projectId,
      recordId: amendment?.id || recordId,
      fieldName: actionLabel(action),
      oldValue: record.status,
      newValue: amendment?.status || nextRecord?.status || "Permanently Deleted",
      reason,
      actorName: actor.name,
      actorEmail: actor.email,
      summary: audit,
    });
    const notifiedNames = await notifyLegalStakeholders(
      db,
      projectId,
      amendment?.id || recordId,
      actionLabel(action),
      `${actor.name} completed ${actionLabel(action).toLowerCase()} for ${recordId}. Reason: ${reason}`,
    );

    return Response.json({
      saved: nextRecord ? serializeRecord(nextRecord) : undefined,
      amendment: amendment ? serializeRecord(amendment) : undefined,
      deleted,
      audit,
      changedBudgetRecords,
      notifiedNames,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json(
      {
        error: message.includes("no such table")
          ? "Permanent storage is initializing."
          : "The controlled record action could not be completed.",
      },
      { status: 500 },
    );
  }
}

async function companyAccessLevel(
  db: Awaited<ReturnType<typeof import("../../../../../db").getDb>>,
  actor: ReturnType<typeof getCommandActor>,
) {
  let accessLevel = actor.accessLevel;
  if (!actor.email) return accessLevel;
  const member = await db
    .select({ accessLevel: companyMembers.companyAccessLevel })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  if (["Company Owner", "Administrator"].includes(member[0]?.accessLevel || "")) {
    accessLevel = member[0]!.accessLevel as typeof accessLevel;
  }
  return accessLevel;
}

async function saveRecord(
  db: Awaited<ReturnType<typeof import("../../../../../db").getDb>>,
  record: typeof commandRecords.$inferSelect,
) {
  await db
    .insert(commandRecords)
    .values(record)
    .onConflictDoUpdate({
      target: [commandRecords.projectId, commandRecords.id],
      set: {
        recordType: record.recordType,
        title: record.title,
        owner: record.owner,
        due: record.due,
        status: record.status,
        meta: record.meta,
        recordDate: record.recordDate,
        recordTime: record.recordTime,
        dateLocked: record.dateLocked,
        dataJson: record.dataJson,
        updatedAt: record.updatedAt,
      },
    });
}

async function notifyLegalStakeholders(
  db: Awaited<ReturnType<typeof import("../../../../../db").getDb>>,
  projectId: string,
  recordId: string,
  title: string,
  message: string,
) {
  const [projectRows, members] = await Promise.all([
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
  for (const member of members) {
    if (
      member.active &&
      ["Company Owner", "Administrator"].includes(member.accessLevel)
    ) {
      recipients.set(member.name, { name: member.name, email: member.email });
    }
  }
  const projectManager = projectRows[0]?.projectManager;
  if (projectManager) {
    const managerMember = members.find((member) => member.name === projectManager);
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
      kind: "controlled_legal_record_action",
      title: `${recordId} · ${title}`,
      message,
    });
  }
  return [...recipients.keys()];
}

function actionLabel(action: LifecycleAction) {
  return {
    return_to_draft: "Returned To Draft",
    void_archive: "Voided And Archived",
    create_amendment: "Amendment Created",
    permanent_delete: "Permanent Deletion",
  }[action];
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function serializeRecord(record: typeof commandRecords.$inferSelect) {
  return {
    id: record.id,
    title: record.title,
    owner: record.owner,
    due: record.due,
    status: record.status,
    meta: record.meta,
    recordDate: record.recordDate,
    recordTime: record.recordTime,
    dateLocked: record.dateLocked,
    data: parseData(record.dataJson),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
