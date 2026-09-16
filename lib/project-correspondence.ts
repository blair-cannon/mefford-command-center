import { and, eq } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  projects,
  recordAudits,
} from "../db/schema";
import { ensureMyWorkTables } from "./my-work";

type CommandDb = ReturnType<(typeof import("../db"))["getDb"]>;

export type ImpactAnswer = "No" | "Yes" | "Unknown";

export function parseCorrespondenceData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function createCorrespondenceImpactActions(input: {
  db: CommandDb;
  projectId: string;
  recordId: string;
  recordType: "RFIs" | "Submittals" | "Design Packages";
  title: string;
  projectManager: string;
  projectManagerEmail: string;
  costImpact: ImpactAnswer;
  scheduleImpact: ImpactAnswer;
  actorName: string;
  actorEmail: string;
}) {
  const { db, projectId, recordId, recordType, title } = input;
  const now = new Date().toISOString();
  let changeExposureId = "";
  let scheduleRiskWorkItemId = "";

  if (input.costImpact !== "No") {
    changeExposureId = `PCO-${recordId}`;
    const existingExposure = await db
      .select({ id: commandRecords.id })
      .from(commandRecords)
      .where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, changeExposureId)))
      .limit(1);
    if (!existingExposure[0]) {
      await db.insert(commandRecords).values({
        projectId,
        id: changeExposureId,
        recordType: "Change Orders",
        title: `Exposure · ${title}`,
        owner: input.projectManager,
        due: now.slice(0, 10),
        status: "Requested",
        meta: `${input.costImpact} Cost Impact · Auto-Created From ${recordId}`,
        recordDate: now.slice(0, 10),
        recordTime: now.slice(11, 16),
        dateLocked: true,
        dataJson: JSON.stringify({
          sourceCorrespondenceId: recordId,
          sourceCorrespondenceType: recordType,
          impactAssessment: input.costImpact,
          autoCreatedFromImpact: true,
          amount: 0,
          approvedAmount: 0,
          approvalStatus: "Unapproved Exposure",
          createdBy: input.actorName,
          createdAt: now,
        }),
        updatedAt: now,
      });
      await db.insert(recordAudits).values({
        projectId,
        recordId: changeExposureId,
        fieldName: "Cost Exposure",
        oldValue: "None",
        newValue: input.costImpact,
        reason: `${recordId} initiated a ${input.costImpact.toLowerCase()} cost impact`,
        actorName: input.actorName,
        actorEmail: input.actorEmail,
        summary: `${changeExposureId} created as an unapproved linked exposure. No cost was approved or posted.`,
      });
    }
  }

  if (input.scheduleImpact !== "No") {
    await ensureMyWorkTables();
    const project = await db
      .select({ projectManager: projects.projectManager })
      .from(projects)
      .where(eq(projects.number, projectId))
      .limit(1);
    const recipientName = input.projectManager || project[0]?.projectManager || "Project Manager";
    const dedupeKey = `schedule-risk:${projectId}:${recordId}:${input.projectManagerEmail}`;
    scheduleRiskWorkItemId = `SRI-${crypto.randomUUID()}`;
    await db
      .insert(commandWorkItems)
      .values({
        id: scheduleRiskWorkItemId,
        dedupeKey,
        projectId,
        recipientName,
        recipientEmail: input.projectManagerEmail,
        kind: "Schedule Risk",
        title: `Assess Schedule Impact · ${recordId}`,
        message: `${title} was answered with ${input.scheduleImpact} schedule impact. Assess the linked project schedule and record the mitigation.`,
        priority: input.scheduleImpact === "Yes" ? "Critical" : "High",
        sourceType: "Schedule Risk",
        sourceRecordId: recordId,
        actionTarget: "Schedule",
        dueAt: now,
        createdBy: "Correspondence Impact Control",
        updatedAt: now,
      })
      .onConflictDoNothing({ target: commandWorkItems.dedupeKey });
    const existing = await db
      .select({ id: commandWorkItems.id })
      .from(commandWorkItems)
      .where(eq(commandWorkItems.dedupeKey, dedupeKey))
      .limit(1);
    scheduleRiskWorkItemId = existing[0]?.id || scheduleRiskWorkItemId;
  }

  return { changeExposureId, scheduleRiskWorkItemId };
}

export async function updateCorrespondenceRecord(input: {
  db: CommandDb;
  projectId: string;
  recordId: string;
  status: string;
  data: Record<string, unknown>;
  actorName: string;
  actorEmail: string;
  oldStatus: string;
  summary: string;
}) {
  const now = new Date().toISOString();
  await input.db
    .update(commandRecords)
    .set({
      status: input.status,
      dataJson: JSON.stringify(input.data),
      updatedAt: now,
    })
    .where(
      and(
        eq(commandRecords.projectId, input.projectId),
        eq(commandRecords.id, input.recordId),
      ),
    );
  await input.db.insert(recordAudits).values({
    projectId: input.projectId,
    recordId: input.recordId,
    fieldName: "Workflow Status",
    oldValue: input.oldStatus,
    newValue: input.status,
    reason: input.summary,
    actorName: input.actorName,
    actorEmail: input.actorEmail,
    summary: `${input.recordId} · ${input.oldStatus} → ${input.status} · ${input.summary}`,
  });
  const { reconcileProjectHealthAfterUpdate } = await import("../app/api/project-health/route");
  await reconcileProjectHealthAfterUpdate(input.projectId, { name: input.actorName, email: input.actorEmail });
}
