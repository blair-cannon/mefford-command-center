import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  accountingWipForecasts,
  commandNotifications,
  commandRecords,
  commandWorkItems,
  companyMembers,
  meetingActionItems,
  mobileDeviceSessions,
  notificationDeliveryEvents,
  notificationPreferences,
  projects,
  vendorProfiles,
  vendorSubmissions,
  workItemAudits,
} from "../db/schema";
import {
  DEFAULT_ONBOARDING_REQUIREMENTS,
  PEOPLE_PROJECT_ID,
  employeeRecordId,
  onboardingState,
  parseEmployeeData,
} from "./onboarding";
import type { CommandActor } from "./server-actor";
import { deliverOperationalPush } from "./mobile-push";
import { deliveryStatusAfterFailure, nextDeliveryAttempt, queueAgeMinutes, scheduledDeliveryOutcome } from "./delivery-control";
import { operationalEmailConnection, sendOperationalEmail } from "./operational-email";
import {
  REVIEW_PROJECT_ID,
  TEMPLATE_REVIEW_CATALOG,
  TEMPLATE_REVIEW_RECORD_TYPE,
} from "./template-review";
import { MEETING_TARGET_BY_TYPE, type MeetingType } from "./meetings";
import {
  PROFITABILITY_FLOOR_BASIS_POINTS,
  ROLE_DOCTRINE,
  alignOperatingWork,
  parseDesignationJson,
  primaryOperatingRole,
} from "./operating-doctrine";

type CommandDb = ReturnType<(typeof import("../db"))["getDb"]>;

const CLOSED_RECORD_STATUSES = new Set([
  "Approved",
  "Approved Unpaid",
  "Complete",
  "Completed",
  "Closed",
  "Executed",
  "Final",
  "Lost",
  "Paid",
  "Released",
  "Passed",
  "Override Documented",
  "Owner Signed Off",
  "Current Set",
  "Record Set",
  "Basis Of Sale Locked",
  "Terminated",
  "Void",
  "Voided",
  "Do Not Award",
  "Buyout - Do Not Award",
]);

const HIGH_PRIORITY_STATUSES = new Set([
  "Owner Approval",
  "Overdue",
  "Due Today",
  "Awaiting Release",
  "Ready For Activation",
  "Ready For Reactivation",
  "PM Review",
  "Response Received",
  "Returned To PM",
  "Consultant Review",
  "Designer Approved",
  "Revision Required",
  "Superintendent Action Required",
  "Follow-Up Required",
  "Failed — Follow-Up Required",
  "Verification Requested",
  "Designer Acceptance Required",
  "PM Award Decision",
]);

export type WorkItemStatus = "Open" | "Acknowledged" | "Snoozed" | "Completed";

export type WorkItemInput = {
  dedupeKey: string;
  projectId: string;
  recipientName: string;
  recipientEmail: string;
  kind: string;
  title: string;
  message: string;
  priority?: "Normal" | "High" | "Critical";
  sourceType: string;
  sourceRecordId?: string;
  actionTarget: string;
  dueAt?: string | null;
  createdBy?: string;
};

const MY_WORK_RECONCILIATION_PREFIXES = [
  "annual-template-review:",
  "legacy-notification:",
  "meeting-action:",
  "meeting-action-leader:",
  "meeting-minutes-finalize:",
  "onboarding:",
  "onboarding-approval:",
  "operating:",
  "record:",
  "system:",
  "vendor-submission:",
] as const;

export function isMyWorkReconciliationManagedKey(dedupeKey: string) {
  return MY_WORK_RECONCILIATION_PREFIXES.some((prefix) => dedupeKey.startsWith(prefix));
}

export async function ensureMyWorkTables() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_notifications (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id text NOT NULL,
      recipient_name text NOT NULL,
      recipient_email text,
      kind text NOT NULL,
      title text NOT NULL,
      message text NOT NULL,
      is_read integer DEFAULT false NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_work_items (
      id text PRIMARY KEY NOT NULL,
      dedupe_key text NOT NULL UNIQUE,
      project_id text DEFAULT 'MEFFORD-COMPANY' NOT NULL,
      recipient_name text NOT NULL,
      recipient_email text NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      message text NOT NULL,
      priority text DEFAULT 'Normal' NOT NULL,
      item_kind text DEFAULT 'To-Do' NOT NULL,
      status text DEFAULT 'Open' NOT NULL,
      source_type text DEFAULT 'Notification' NOT NULL,
      source_record_id text DEFAULT '' NOT NULL,
      action_target text DEFAULT 'Dashboard' NOT NULL,
      due_at text,
      snoozed_until text,
      read_at text,
      acknowledged_at text,
      completed_at text,
      escalated_at text,
      escalation_level integer DEFAULT 0 NOT NULL,
      created_by text DEFAULT 'Command Center' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS command_work_items_dedupe_idx ON command_work_items (dedupe_key)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS command_work_items_recipient_status_idx ON command_work_items (recipient_email, status)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS command_work_items_due_idx ON command_work_items (due_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notification_preferences (
      recipient_email text PRIMARY KEY NOT NULL,
      in_app_enabled integer DEFAULT true NOT NULL,
      email_enabled integer DEFAULT true NOT NULL,
      quiet_hours_enabled integer DEFAULT false NOT NULL,
      quiet_start text DEFAULT '19:00' NOT NULL,
      quiet_end text DEFAULT '07:00' NOT NULL,
      digest_mode text DEFAULT 'Immediate' NOT NULL,
      time_zone text DEFAULT 'America/New_York' NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notification_delivery_events (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      dedupe_key text NOT NULL UNIQUE,
      work_item_id text NOT NULL,
      recipient_email text NOT NULL,
      channel text DEFAULT 'Email' NOT NULL,
      event_type text NOT NULL,
      status text DEFAULT 'Queued' NOT NULL,
      attempts integer DEFAULT 0 NOT NULL,
      last_attempt_at text,
      next_attempt_at text,
      error text DEFAULT '' NOT NULL,
      error_class text DEFAULT '' NOT NULL,
      deferred_reason text DEFAULT '' NOT NULL,
      provider text DEFAULT '' NOT NULL,
      provider_receipt_id text DEFAULT '' NOT NULL,
      provider_status integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      sent_at text,
      accepted_at text,
      dead_lettered_at text
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS notification_delivery_status_idx ON notification_delivery_events (status, channel)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS work_item_audits (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      work_item_id text NOT NULL,
      action text NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      detail text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS work_item_audits_item_idx ON work_item_audits (work_item_id)`),
  ]);
  for (const statement of [
    `ALTER TABLE notification_delivery_events ADD COLUMN next_attempt_at text`,
    `ALTER TABLE notification_delivery_events ADD COLUMN error_class text DEFAULT '' NOT NULL`,
    `ALTER TABLE notification_delivery_events ADD COLUMN deferred_reason text DEFAULT '' NOT NULL`,
    `ALTER TABLE notification_delivery_events ADD COLUMN provider text DEFAULT '' NOT NULL`,
    `ALTER TABLE notification_delivery_events ADD COLUMN provider_receipt_id text DEFAULT '' NOT NULL`,
    `ALTER TABLE notification_delivery_events ADD COLUMN provider_status integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE notification_delivery_events ADD COLUMN accepted_at text`,
    `ALTER TABLE notification_delivery_events ADD COLUMN dead_lettered_at text`,
  ]) {
    try { await env.DB.prepare(statement).run(); } catch { /* Existing production columns are expected. */ }
  }
}

export async function effectiveActor(actor: CommandActor) {
  const { getDb } = await import("../db");
  const db = getDb();
  const member = actor.email
    ? await db
        .select({
          name: companyMembers.displayName,
          accessLevel: companyMembers.companyAccessLevel,
          designationsJson: companyMembers.designationsJson,
        })
        .from(companyMembers)
        .where(eq(companyMembers.email, actor.email))
        .limit(1)
    : [];
  return {
    ...actor,
    name: member[0]?.name || actor.name,
    accessLevel: member[0]?.accessLevel || actor.accessLevel,
    designations: parseStringArray(member[0]?.designationsJson),
  };
}

export async function syncMyWork(actor: Awaited<ReturnType<typeof effectiveActor>>) {
  const { getDb } = await import("../db");
  const db = getDb();
  const now = new Date();
  const sourceKeys = new Set<string>();
  const [records, legacyNotifications, members, projectRows, vendorSubmissionRows, vendorRows, forecastRows] = await Promise.all([
    db.select().from(commandRecords),
    db
      .select()
      .from(commandNotifications)
      .where(
        or(
          eq(commandNotifications.recipientEmail, actor.email),
          eq(commandNotifications.recipientName, actor.name),
        ),
      ),
    db
      .select({
        name: companyMembers.displayName,
        email: companyMembers.email,
        level: companyMembers.companyAccessLevel,
        active: companyMembers.isActive,
        designationsJson: companyMembers.designationsJson,
      })
      .from(companyMembers),
    db.select().from(projects),
    db.select().from(vendorSubmissions),
    db.select().from(vendorProfiles),
    db.select().from(accountingWipForecasts),
  ]);

  const today = localDate(now, "America/New_York");
  const currentPeriod = today.slice(0, 7);
  const latestForecastByProject = new Map<string, typeof forecastRows[number]>();
  for (const forecast of [...forecastRows].sort((left, right) => right.periodId.localeCompare(left.periodId) || right.updatedAt.localeCompare(left.updatedAt))) {
    if (!latestForecastByProject.has(forecast.projectId)) latestForecastByProject.set(forecast.projectId, forecast);
  }
  const isAccounting = actor.designations.some((item) => ["Accountant", "Financial Administrator", "Accounting Manager"].includes(item));
  const isEstimator = actor.designations.some((item) => ["Estimator", "Estimating Manager"].includes(item));
  const isSales = actor.designations.some((item) => ["Sales Representative", "Sales Manager"].includes(item));

  for (const project of projectRows.filter((item) => item.status === "Active")) {
    const projectRecords = records.filter((record) => record.projectId === project.number);
    const assignedPm = actor.name.trim().toLowerCase() === project.projectManager.trim().toLowerCase();
    const assignedSuperintendent = actor.name.trim().toLowerCase() === project.superintendent.trim().toLowerCase();
    const forecast = latestForecastByProject.get(project.number);
    const authoritativeForecast = forecast && ["Accounting Reviewed", "Owner Approved", "Locked"].includes(forecast.status) ? forecast : null;
    if ((assignedPm || isAccounting) && (!authoritativeForecast || authoritativeForecast.periodId !== currentPeriod)) {
      const dedupeKey = `operating:${project.number}:current-wip:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: project.number,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: assignedPm ? "PM Profit Protection" : "Accounting Decision Support",
        title: `${project.name} · Current PM Forecast Required`,
        message: assignedPm
          ? `You are operating without a current ${currentPeriod} ETC, EAC, risk reserve, and projected-profit decision. Accounting supplies reconciled cost and billing truth; you own the forecast and recovery action.`
          : `${project.projectManager} needs a current ${currentPeriod} cost and cash decision pack. Reconcile actual cost, commitments, AP, billing, receipts, and exceptions so the PM can update ETC, EAC, and recovery action.`,
        priority: "High",
        sourceType: "Operating Doctrine",
        sourceRecordId: `WIP-${currentPeriod}`,
        actionTarget: "WIP And Close",
        dueAt: now.toISOString(),
        createdBy: "Profit Protection Rule",
      });
    }
    if ((assignedPm || isAccounting || ["Company Owner", "Administrator"].includes(actor.accessLevel)) && authoritativeForecast && authoritativeForecast.forecastProfitCents <= 0) {
      const dedupeKey = `operating:${project.number}:project-loss:${actor.email}`;
      sourceKeys.add(dedupeKey);
      const loss = Math.abs(authoritativeForecast.forecastProfitCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const leadership = ["Company Owner", "Administrator"].includes(actor.accessLevel);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: project.number,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: leadership ? "Ownership Red Flag" : assignedPm ? "PM Profit Protection" : "Accounting Decision Support",
        title: `${leadership ? "Ownership Red Flag · " : ""}${project.name} · Forecast Loss ${loss}`,
        message: assignedPm
          ? `The latest forecast is at or below zero profit. Publish the dated recovery plan through schedule, buyout, productivity, change management, billing, and remaining risk. Accounting reconciles every input with you.`
          : isAccounting
            ? `Immediately reconcile cost, commitments, AP, billing, receipts, and forecast inputs with ${project.projectManager}. The PM owns the recovery decision; Accounting must make the numbers actionable.`
            : `${project.projectManager} owns the project recovery plan. Ownership must verify the accountable role, barrier, action, and deadline because Mefford does not allow a forecast loss to remain a PM-only problem.`,
        priority: "Critical",
        sourceType: "Operating Doctrine",
        sourceRecordId: authoritativeForecast.id,
        actionTarget: "WIP And Close",
        dueAt: now.toISOString(),
        createdBy: "Project Loss Guardrail",
      });
    } else if ((assignedPm || isAccounting) && authoritativeForecast && authoritativeForecast.projectedMarginBasisPoints < PROFITABILITY_FLOOR_BASIS_POINTS) {
      const dedupeKey = `operating:${project.number}:margin-floor:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: project.number,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: assignedPm ? "PM Profit Protection" : "Accounting Decision Support",
        title: `${project.name} · Margin Recovery Required`,
        message: `Forecast gross margin is ${(authoritativeForecast.projectedMarginBasisPoints / 100).toFixed(1)}%, below the ${PROFITABILITY_FLOOR_BASIS_POINTS / 100}% company floor. ${assignedPm ? "Document the PM recovery decision; Accounting confirms the source-backed variance." : `Give ${project.projectManager} the cost-code variance and reconciled decision data needed to recover margin.`}`,
        priority: "High",
        sourceType: "Operating Doctrine",
        sourceRecordId: authoritativeForecast.id,
        actionTarget: "WIP And Close",
        dueAt: now.toISOString(),
        createdBy: "Margin Protection Rule",
      });
    }
    if (assignedSuperintendent && !projectRecords.some((record) => record.recordType === "Daily Logs" && record.recordDate === today)) {
      const dedupeKey = `operating:${project.number}:field-truth:${today}:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: project.number,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: "Field Safety And Schedule",
        title: `${project.name} · Record Today's Field Truth`,
        message: "Record manpower, work completed, schedule conditions, weather, safety, quality, and tomorrow's plan so the PM can protect completion and project cost.",
        priority: "High",
        sourceType: "Operating Doctrine",
        sourceRecordId: `DAILY-LOG-${today}`,
        actionTarget: "Daily Logs",
        dueAt: normalizeDueAt(today, now),
        createdBy: "Field Execution Rule",
      });
    }
  }

  const salesRecords = records.filter((record) => record.projectId === "MEFFORD-SALES" && record.recordType === "Sales Opportunities");
  for (const record of salesRecords) {
    const row = parseData(record.dataJson);
    const stage = String(row.stage || record.status);
    if (["Awarded", "Lost", "On Hold"].includes(stage)) continue;
    const assignedRep = String(row.assignedRep || record.owner).trim().toLowerCase();
    const nextFollowUp = String(row.nextFollowUpDate || "").slice(0, 10);
    if (isSales && (assignedRep === actor.name.trim().toLowerCase() || actor.designations.includes("Sales Manager")) && (!nextFollowUp || nextFollowUp <= today)) {
      const dedupeKey = `operating:sales-next-move:${record.id}:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, { dedupeKey, projectId: "MEFFORD-SALES", recipientName: actor.name, recipientEmail: actor.email, kind: "Sales Pipeline", title: `${record.title} · Define The Next Client Move`, message: nextFollowUp ? `The saved client follow-up was due ${nextFollowUp}. Record the specific move, decision maker, close obstacle, and next date.` : "This active opportunity has no dated next move. Every real opportunity must have an owner, a next move, and a close strategy.", priority: Number(row.estimatedValue || 0) >= 500_000 ? "High" : "Normal", sourceType: "Operating Doctrine", sourceRecordId: record.id, actionTarget: "Sales Funnel", dueAt: now.toISOString(), createdBy: "Pipeline Discipline Rule" });
    }
    const assignedEstimator = String(row.assignedEstimator || "").trim().toLowerCase();
    const bidDue = String(row.bidDueDate || record.due || "").slice(0, 10);
    const estimateStatus = String(row.estimateStatus || "Not Started");
    const bidControlDate = new Date(`${today}T12:00:00Z`); bidControlDate.setUTCDate(bidControlDate.getUTCDate() + 7);
    if (isEstimator && (assignedEstimator === actor.name.trim().toLowerCase() || actor.designations.includes("Estimating Manager")) && bidDue && bidDue <= bidControlDate.toISOString().slice(0, 10) && !["Proposal Submitted", "Approved", "Awarded"].includes(estimateStatus)) {
      const dedupeKey = `operating:proposal-deadline:${record.id}:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, { dedupeKey, projectId: "MEFFORD-SALES", recipientName: actor.name, recipientEmail: actor.email, kind: "Proposal Reliability", title: `${record.title} · Proposal ${bidDue < today ? "Overdue" : "Due Soon"}`, message: `Bid due ${bidDue}. Estimating owns complete, competitive, defensible pricing and on-time submission; Sales confirms scope strategy and the company's best client-facing position.`, priority: bidDue <= today ? "Critical" : "High", sourceType: "Operating Doctrine", sourceRecordId: record.id, actionTarget: "Estimating", dueAt: normalizeDueAt(bidDue, now), createdBy: "Proposal Reliability Rule" });
    }
  }

  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    for (const project of projectRows.filter((item) => item.status === "Active")) {
      const projectRecords = records.filter((record) => record.projectId === project.number);
      const budgetControl = projectRecords.find((record) => record.id === "BUDGET-CONTROL");
      const selectedBudget = projectRecords
        .filter((record) => record.recordType === "Budget")
        .map((record) => parseData(record.dataJson))
        .filter((data) => data.selectedForProject === true && Number(data.originalBudget || 0) > 0);
      if (parseData(budgetControl?.dataJson || "{}").locked !== true || !selectedBudget.length) {
        const dedupeKey = `system:${project.number}:budget-lock:${actor.email}`;
        sourceKeys.add(dedupeKey);
        await upsertWorkItem(db, {
          dedupeKey,
          projectId: project.number,
          recipientName: actor.name,
          recipientEmail: actor.email,
          kind: "Financial Control",
          title: `Lock The Original Project Budget · ${project.name}`,
          message: "Subcontracts change orders and owner billing cannot be reliably controlled until the original budget is approved and locked.",
          priority: "Critical",
          sourceType: "System Control",
          sourceRecordId: "BUDGET-CONTROL",
          actionTarget: "Budget",
          dueAt: now.toISOString(),
          createdBy: "Executive Action Center",
        });
      }
      const executedOwnerContract = projectRecords.some(
        (record) => record.recordType === "Contracts" && ["Executed", "Approved"].includes(record.status),
      );
      if (!executedOwnerContract) {
        const dedupeKey = `system:${project.number}:owner-contract:${actor.email}`;
        sourceKeys.add(dedupeKey);
        await upsertWorkItem(db, {
          dedupeKey,
          projectId: project.number,
          recipientName: actor.name,
          recipientEmail: actor.email,
          kind: "Contract Control",
          title: `Confirm Owner Contract Execution · ${project.name}`,
          message: "The active project does not have an executed owner contract recorded in Command Center.",
          priority: "High",
          sourceType: "System Control",
          sourceRecordId: "OWNER-CONTRACT",
          actionTarget: "Contracts",
          dueAt: now.toISOString(),
          createdBy: "Executive Action Center",
        });
      }
    }
    const salesGoals = records.some(
      (record) => record.projectId === "MEFFORD-SALES" && record.recordType === "Sales Goals",
    );
    if (!salesGoals) {
      const dedupeKey = `system:mefford-sales:annual-goals:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: "MEFFORD-SALES",
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: "Sales Direction",
        title: `Set The ${now.getFullYear()} Sales Goal`,
        message: "Company and salesperson targets must be established to measure pace and quarterly performance.",
        priority: "High",
        sourceType: "System Control",
        sourceRecordId: `SALES-GOALS-${now.getFullYear()}`,
        actionTarget: "Sales Goals",
        dueAt: now.toISOString(),
        createdBy: "Executive Action Center",
      });
    }
    if (actor.accessLevel === "Company Owner") {
      const reviewYear = String(now.getFullYear());
      const signedTemplateIds = new Set(records
        .filter((record) => record.projectId === REVIEW_PROJECT_ID && record.recordType === TEMPLATE_REVIEW_RECORD_TYPE)
        .map((record) => parseData(record.dataJson))
        .filter((data) => String(data.reviewYear || "") === reviewYear)
        .map((data) => String(data.templateId || "")));
      const remaining = TEMPLATE_REVIEW_CATALOG.filter((template) => !signedTemplateIds.has(template.id));
      if (remaining.length) {
        const dedupeKey = `annual-template-review:${reviewYear}:${actor.email}`;
        sourceKeys.add(dedupeKey);
        await upsertWorkItem(db, {
          dedupeKey,
          projectId: REVIEW_PROJECT_ID,
          recipientName: actor.name,
          recipientEmail: actor.email,
          kind: "Annual Company Review",
          title: `Complete ${reviewYear} Owner Template Review`,
          message: `${remaining.length} of ${TEMPLATE_REVIEW_CATALOG.length} controlled templates still require annual Owner signoff or update.`,
          priority: "High",
          sourceType: TEMPLATE_REVIEW_RECORD_TYPE,
          sourceRecordId: `ANNUAL-${reviewYear}`,
          actionTarget: "Review",
          dueAt: `${reviewYear}-12-31T17:00:00-05:00`,
          createdBy: "Review Center",
        });
      }
    }
  }

  for (const project of projectRows.filter((item) => item.status === "Active")) {
    const projectRecords = records.filter((record) => record.projectId === project.number);
    if (actor.name === project.projectManager && !projectRecords.some((record) => record.recordType === "Schedule")) {
      const dedupeKey = `system:${project.number}:baseline-schedule:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: project.number,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: "Schedule Control",
        title: `Establish The Baseline Schedule · ${project.name}`,
        message: "No schedule activities are recorded, so completion risk cannot be measured yet.",
        priority: "High",
        sourceType: "System Control",
        sourceRecordId: "BASELINE-SCHEDULE",
        actionTarget: "Schedule",
        dueAt: now.toISOString(),
        createdBy: "Executive Action Center",
      });
    }
  }
  for (const record of records) {
    if (CLOSED_RECORD_STATUSES.has(record.status)) continue;
    const assignedByName = record.owner.trim().toLowerCase() === actor.name.trim().toLowerCase();
    const ownerApproval =
      actor.accessLevel === "Company Owner" &&
      ["Owner Approval", "Awaiting Owner Approval"].includes(record.status);
    const adminApproval =
      ["Company Owner", "Administrator"].includes(actor.accessLevel) &&
      ["Administrator Review", "Ready For Activation", "Ready For Reactivation"].includes(record.status);
    if (!assignedByName && !ownerApproval && !adminApproval) continue;
    if (record.projectId === PEOPLE_PROJECT_ID && record.recordType === "Employee Onboarding") continue;
    const dedupeKey = `record:${record.projectId}:${record.id}:${actor.email}`;
    sourceKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: record.projectId,
      recipientName: actor.name,
      recipientEmail: actor.email,
      kind: record.recordType,
      title: record.title,
      message: `${record.id} · ${record.status}${record.meta ? ` · ${record.meta}` : ""}`,
      priority: HIGH_PRIORITY_STATUSES.has(record.status) ? "High" : "Normal",
      sourceType: record.recordType,
      sourceRecordId: record.id,
      actionTarget: actionTargetForRecord(record.recordType, record.projectId),
      dueAt: normalizeDueAt(record.due, now),
      createdBy: record.owner,
    });
  }

  for (const notification of legacyNotifications) {
    const dedupeKey = `legacy-notification:${notification.id}:${actor.email}`;
    sourceKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: notification.projectId,
      recipientName: actor.name,
      recipientEmail: actor.email,
      kind: notification.kind,
      title: notification.title,
      message: notification.message,
      priority: /discrepancy|ready|overdue|approval/i.test(`${notification.title} ${notification.kind}`) ? "High" : "Normal",
      sourceType: "Notification",
      sourceRecordId: String(notification.id),
      actionTarget: actionTargetForRecord(notification.kind),
      createdBy: "Command Center",
    });
  }

  const actorCanReviewVendorBilling =
    ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
    actor.designations.some((item) => ["Accountant", "Financial Administrator"].includes(item));
  for (const submission of vendorSubmissionRows.filter(
    (item) => !item.apRecordId && !["Returned To Vendor", "Rejected"].includes(item.status),
  )) {
    const project = projectRows.find((item) => item.number === submission.projectId);
    if (!actorCanReviewVendorBilling && project?.projectManager !== actor.name) continue;
    const vendor = vendorRows.find((item) => item.id === submission.vendorId);
    const dedupeKey = `vendor-submission:${submission.id}:${actor.email}`;
    sourceKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: submission.projectId,
      recipientName: actor.name,
      recipientEmail: actor.email,
      kind: "Vendor Billing",
      title: `${vendor?.legalName || "Vendor"} Submitted Billing`,
      message: `${submission.title} · $${Number(submission.amount).toFixed(2)} · ${submission.status}. Review in Vendor Management before AP handoff.`,
      priority: submission.status === "Submitted" ? "High" : "Critical",
      sourceType: "Vendor Submission",
      sourceRecordId: submission.id,
      actionTarget: "Vendor Management",
      dueAt: submission.submittedAt,
      createdBy: "Vendor Portal",
    });
  }

  const employeeRow = records.find(
    (record) => record.projectId === PEOPLE_PROJECT_ID && record.id === employeeRecordId(actor.email),
  );
  const employee = parseEmployeeData(employeeRow?.dataJson || "");
  if (employee) {
    const state = onboardingState(employee, DEFAULT_ONBOARDING_REQUIREMENTS, now);
    if (!employee.hireDate) {
      const dedupeKey = `onboarding:${employee.email}:hire-date`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: PEOPLE_PROJECT_ID,
        recipientName: employee.name,
        recipientEmail: employee.email,
        kind: "Employee Onboarding",
        title: "Add Original Hire Date And Checklist Profile",
        message: "Original hire date position department supervisor work location and checklist owner are required before annual and 30/60/90 dates can be controlled.",
        priority: "High",
        sourceType: "Employee Onboarding",
        sourceRecordId: employeeRecordId(employee.email),
        actionTarget: "Employee Onboarding",
        dueAt: now.toISOString(),
        createdBy: "Mefford People System",
      });
    }
    for (const requirement of (employee.hireDate ? state.requirements : []).filter((item) => !item.completion)) {
      const dedupeKey = `onboarding:${employee.email}:${state.cycleKey}:${requirement.id}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: PEOPLE_PROJECT_ID,
        recipientName: employee.name,
        recipientEmail: employee.email,
        kind: "Employee Onboarding",
        title: requirement.title,
        message: `${requirement.section} · ${requirement.responsible} · ${requirement.blocksActivation ? "Required Before Access Unlocks" : "Scheduled Follow-Up"}`,
        priority: requirement.blocksActivation ? "High" : "Normal",
        sourceType: "Onboarding Requirement",
        sourceRecordId: requirement.id,
        actionTarget: "Employee Onboarding",
        dueAt: requirement.dueAt || state.deadline || null,
        createdBy: requirement.responsible,
      });
    }
  }

  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    for (const record of records.filter(
      (item) => item.projectId === PEOPLE_PROJECT_ID && item.recordType === "Employee Onboarding",
    )) {
      const employeeData = parseEmployeeData(record.dataJson);
      if (!employeeData) continue;
      const state = onboardingState(employeeData, DEFAULT_ONBOARDING_REQUIREMENTS, now);
      if (!["Ready For Activation", "Ready For Reactivation"].includes(state.status)) continue;
      const dedupeKey = `onboarding-approval:${employeeData.email}:${state.cycleKey}:${actor.email}`;
      sourceKeys.add(dedupeKey);
      await upsertWorkItem(db, {
        dedupeKey,
        projectId: PEOPLE_PROJECT_ID,
        recipientName: actor.name,
        recipientEmail: actor.email,
        kind: "Approval",
        title: `Activate ${employeeData.name}`,
        message: `${employeeData.name} completed every access-gate requirement. Administrator approval is required before permissions unlock.`,
        priority: "High",
        sourceType: "Employee Onboarding",
        sourceRecordId: employeeRecordId(employeeData.email),
        actionTarget: "Employee Onboarding",
        dueAt: new Date().toISOString(),
        createdBy: "Employee Onboarding",
      });
    }
  }

  const { env } = await import("cloudflare:workers");
  const meetingActions = await env.DB.prepare(`SELECT a.*, s.meeting_type, o.meeting_number, s.leader_name, s.leader_email FROM meeting_action_items a JOIN meeting_occurrences o ON o.id = a.occurrence_id JOIN meeting_series s ON s.id = a.series_id WHERE (lower(a.assignee_email) = lower(?) OR lower(s.leader_email) = lower(?)) AND a.status NOT IN ('Complete','Cancelled With Reason','Carried Forward') ORDER BY a.due_at`).bind(actor.email, actor.email).all<Record<string, string | number | null>>();
  for (const action of meetingActions.results) {
    const dedupeKey = `meeting-action:${action.id}`;
    sourceKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: String(action.project_id),
      recipientName: String(action.assignee_name),
      recipientEmail: String(action.assignee_email),
      kind: Number(action.carry_count || 0) > 0 ? `Meeting Action · Carry ${action.carry_count}` : "Meeting Action",
      title: String(action.title),
      message: `${action.meeting_number} · ${action.definition_of_done} · ${action.status}. Accept it or request clarification, then keep it current until complete.`,
      priority: ["High", "Critical"].includes(String(action.priority)) ? String(action.priority) as "High" | "Critical" : "Normal",
      sourceType: "Meeting Action",
      sourceRecordId: String(action.id),
      actionTarget: MEETING_TARGET_BY_TYPE[String(action.meeting_type) as MeetingType] || "My Work",
      dueAt: String(action.due_at),
      createdBy: String(action.created_by),
    });
    const overdueDays = (now.getTime() - new Date(String(action.due_at)).getTime()) / 86_400_000;
    if (overdueDays >= 3 && action.leader_email) {
      const leaderKey = `meeting-action-leader:${action.id}:${String(action.leader_email).toLowerCase()}`;
      if (String(action.leader_email).toLowerCase() === actor.email.toLowerCase()) sourceKeys.add(leaderKey);
      await upsertWorkItem(db, {
        dedupeKey: leaderKey,
        projectId: String(action.project_id),
        recipientName: String(action.leader_name),
        recipientEmail: String(action.leader_email),
        kind: "Meeting Action Escalation",
        title: `3-Day Overdue · ${action.title}`,
        message: `${action.assignee_name} has an incomplete action from ${action.meeting_number}. Review the blocker, reassign through the normal meeting controls, or carry it into IDS.`,
        priority: "High",
        sourceType: "Meeting Action Escalation",
        sourceRecordId: String(action.id),
        actionTarget: MEETING_TARGET_BY_TYPE[String(action.meeting_type) as MeetingType] || "My Work",
        dueAt: String(action.due_at),
        createdBy: "Meeting Action Rule",
      });
    }
  }
  const unfinalized = await env.DB.prepare(`SELECT o.*, s.meeting_type, s.project_id, s.leader_name, s.leader_email FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE o.status = 'Draft Minutes' AND datetime(o.draft_minutes_at) <= datetime('now','-24 hours') AND (lower(s.leader_email) = lower(?) OR ? IN ('Company Owner','Administrator'))`).bind(actor.email, actor.accessLevel).all<Record<string, string | number | null>>();
  for (const meeting of unfinalized.results) {
    const dedupeKey = `meeting-minutes-finalize:${meeting.id}:${actor.email}`;
    sourceKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: String(meeting.project_id),
      recipientName: actor.name,
      recipientEmail: actor.email,
      kind: "Meeting Minutes Escalation",
      title: `Finalize ${meeting.meeting_number}`,
      message: "Draft minutes have remained unfinalized for more than 24 hours. Review every action disposition, finalize the controlled record, and distribute through the normal channel.",
      priority: "High",
      sourceType: "Meeting Minutes",
      sourceRecordId: String(meeting.id),
      actionTarget: MEETING_TARGET_BY_TYPE[String(meeting.meeting_type) as MeetingType] || "My Work",
      dueAt: String(meeting.draft_minutes_at),
      createdBy: "Meeting Finalization Rule",
    });
  }

  await closeResolvedSourceItems(db, actor.email, sourceKeys);
  await queueDueEventsAndEscalations(db, members, now);
  return loadMyWorkSnapshot(actor, now);
}

export async function loadMyWorkSnapshot(
  actor: Awaited<ReturnType<typeof effectiveActor>>,
  now = new Date(),
) {
  const { getDb } = await import("../db");
  const db = getDb();
  const [items, preferenceRows, emailConnection, enabledDevices] = await Promise.all([
    db
      .select()
      .from(commandWorkItems)
      .where(eq(commandWorkItems.recipientEmail, actor.email))
      .orderBy(asc(commandWorkItems.dueAt), asc(commandWorkItems.createdAt)),
    db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.recipientEmail, actor.email))
      .limit(1),
    operationalEmailConnection(),
    db
      .select({ id: mobileDeviceSessions.id })
      .from(mobileDeviceSessions)
      .where(and(
        eq(mobileDeviceSessions.userEmail, actor.email),
        eq(mobileDeviceSessions.status, "Trusted"),
        eq(mobileDeviceSessions.pushEnabled, true),
      ))
      .limit(1),
  ]);
  const preferences = preferenceRows[0] || {
    recipientEmail: actor.email,
    inAppEnabled: true,
    emailEnabled: true,
    quietHoursEnabled: false,
    quietStart: "19:00",
    quietEnd: "07:00",
    digestMode: "Immediate",
    timeZone: "America/New_York",
    updatedAt: "",
  };
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as Record<string, unknown>;
  const pushConfigured = Boolean(
    String(bindings.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim()
    && String(bindings.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim(),
  );
  const audits = items.length
    ? await db
        .select()
        .from(workItemAudits)
        .where(inArray(workItemAudits.workItemId,
          db.select({ id: commandWorkItems.id }).from(commandWorkItems)
            .where(eq(commandWorkItems.recipientEmail, actor.email))))
        .orderBy(asc(workItemAudits.id))
    : [];
  const auditMap = new Map<string, typeof audits>();
  for (const audit of audits) {
    auditMap.set(audit.workItemId, [...(auditMap.get(audit.workItemId) || []), audit]);
  }
  return {
    items: items.map((item) => decorateWorkItem(item, now, auditMap.get(item.id) || [])),
    preferences,
    delivery: {
      status: emailConnection.mode,
      detail: emailConnection.configured
        ? `Operational email is connected through ${emailConnection.mode}. Delivery attempts run only in the scheduled delivery worker.`
        : "In-app delivery is active. External email remains explicitly deferred until Microsoft 365 or the approved adapter is connected.",
      pushStatus: !pushConfigured ? "Connection Required" : enabledDevices.length ? "Device Enabled" : "No Enabled Device",
      pushDetail: !pushConfigured
        ? "Push is explicitly deferred until signing keys are configured."
        : enabledDevices.length
          ? "A trusted device is enabled. Push attempts run only in the scheduled delivery worker."
          : "Push signing is configured, but this user has not enabled a trusted device.",
    },
  };
}

export async function sendMorningWorkDigests(
  now = new Date(),
  origin = "https://mefford-project-command.jordan-mefor-1272.chatgpt.site",
) {
  const { getDb } = await import("../db");
  const db = getDb();
  const connection = await operationalEmailConnection();
  const [members, preferences, workItems] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(notificationPreferences),
    db.select().from(commandWorkItems).where(inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"])),
  ]);
  let accepted = 0;
  let eligible = 0;
  let deferred = 0;
  let failures = 0;
  for (const member of members) {
    const preference = preferences.find((item) => item.recipientEmail === member.email);
    const timeZone = preference?.timeZone || "America/New_York";
    const local = localDigestClock(now, timeZone);
    if (local.hour !== "06") continue;
    const id = `MORNING-${local.date}-${member.email.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const existing = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-COMPANY"), eq(commandRecords.id, id))).limit(1))[0];
    if (["Sent", "Provider Accepted"].includes(existing?.status || "")) continue;
    eligible += 1;
    const active = workItems.filter((item) => item.recipientEmail === member.email && !(item.status === "Snoozed" && item.snoozedUntil && new Date(item.snoozedUntil) > now));
    const overdue = active.filter((item) => item.dueAt && new Date(item.dueAt) < now);
    const stale = active.filter((item) => now.getTime() - new Date(item.updatedAt.endsWith("Z") ? item.updatedAt : `${item.updatedAt}Z`).getTime() >= 48 * 3_600_000);
    const dueToday = active.filter((item) => item.dueAt && localDate(new Date(item.dueAt), timeZone) === local.date);
    const upcoming = active.filter((item) => !overdue.includes(item) && !dueToday.includes(item)).sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")));
    const weekend = ["Sat", "Sun"].includes(local.weekday);
    const tone = digestTone(active.length, overdue.length, stale.length);
    const operatingRole = primaryOperatingRole(member.companyAccessLevel, parseDesignationJson(member.designationsJson));
    const doctrine = ROLE_DOCTRINE[operatingRole];
    const lines = [
      tone.heading.replace("{name}", member.displayName.split(" ")[0] || "Team"),
      "",
      tone.message,
      "",
      `${doctrine.shortRole}: ${doctrine.mission}`,
      `${doctrine.promise}`,
      "",
      `OVERDUE: ${overdue.length}  |  DUE TODAY: ${dueToday.length}  |  ACTIVE: ${active.length}`,
      "",
      ...digestSection("OVERDUE", overdue, weekend ? 3 : 8),
      ...digestSection("DUE TODAY", dueToday, weekend ? 3 : 6),
      ...digestSection("UPCOMING", upcoming, weekend ? 2 : 5),
      "",
      `Open My Work: ${origin}/?target=My%20Work`,
      "",
      "This is an operational work summary only. It never sends, approves, posts, or pays an invoice.",
    ];
    const data = { localDate: local.date, timeZone, active: active.length, overdue: overdue.length, stale: stale.length, dueToday: dueToday.length, tone: tone.kind, operatingRole, roleMission: doctrine.mission, mandatoryForActiveUsers: true, weekendBrief: weekend, attemptedAt: now.toISOString() };
    if (!existing) {
      await db.insert(commandRecords).values({ projectId: "MEFFORD-COMPANY", id, recordType: "Morning Work Digest History", title: `Morning My Work · ${member.displayName} · ${local.date}`, owner: member.displayName, due: local.date, status: connection.configured ? "Queued" : "Deferred · Connection Required", meta: `${tone.kind} · ${active.length} Active · ${overdue.length} Overdue`, recordDate: local.date, recordTime: "06:00", dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now.toISOString() });
    } else {
      await db.update(commandRecords).set({ status: connection.configured ? "Queued" : "Deferred · Connection Required", meta: `${tone.kind} · ${active.length} Active · ${overdue.length} Overdue`, dataJson: JSON.stringify(data), updatedAt: now.toISOString() }).where(and(eq(commandRecords.projectId, "MEFFORD-COMPANY"), eq(commandRecords.id, id)));
    }
    const delivery = await sendOperationalEmail({ to: member.email, subject: `${doctrine.shortRole} · ${tone.subject} · ${overdue.length} Overdue`, text: lines.join("\n"), idempotencyKey: id, safeguards: { sendInvoice: false, postInvoice: false, approveWork: false, payVendor: false } });
    const completedAt = new Date().toISOString();
    const status = delivery.outcome === "Provider Accepted" ? "Provider Accepted" : delivery.outcome === "Deferred" ? "Deferred · Connection Required" : delivery.outcome === "Retry" ? "Retry Scheduled" : "Dead Letter";
    await db.update(commandRecords).set({ status, dataJson: JSON.stringify({ ...data, providerReceipt: delivery, acceptedAt: delivery.acceptedAt, deliveryAttemptedAt: completedAt, deliveryError: delivery.error }), updatedAt: completedAt }).where(and(eq(commandRecords.projectId, "MEFFORD-COMPANY"), eq(commandRecords.id, id)));
    if (delivery.outcome === "Provider Accepted") accepted += 1;
    else if (delivery.outcome === "Deferred") deferred += 1;
    else failures += 1;
  }
  if (failures) throw new Error(`${failures} morning digest delivery attempt${failures === 1 ? "" : "s"} failed before provider acceptance`);
  return {
    accepted,
    eligible,
    deferred,
    activeUsers: members.length,
    policy: "Every activated user · 6:00 AM local time · Seven days a week",
    ...(eligible && !accepted && deferred === eligible ? { scheduledOutcome: "Deferred" as const, reason: `${deferred} morning digest${deferred === 1 ? " is" : "s are"} waiting for an operational email connection` } : {}),
  };
}

function localDigestClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, weekday: parts.weekday };
}

function localDate(value: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function digestTone(active: number, overdue: number, stale: number) {
  if (!active) return { kind: "All Clear", subject: "You Are All Clear", heading: "Good morning {name} — you are all clear!", message: "Great work. Your Command Center queue is current, so you can start the day focused instead of chasing loose ends." };
  if (!overdue && active <= 4) return { kind: "Strong Momentum", subject: "Strong Momentum This Morning", heading: "Good morning {name} — you are knocking it out!", message: `You have ${active} active item${active === 1 ? "" : "s"} and nothing overdue. Keep the momentum moving.` };
  if (overdue <= 2 && stale <= 2) return { kind: "Focused", subject: "Your Morning Priorities", heading: "Good morning {name} — here is the short list.", message: "Handle the overdue work first, update anything that changed, and then move into today’s approvals and assignments." };
  return { kind: "Direct", subject: "Action Required On Your Work Queue", heading: "Good morning {name} — your queue needs attention.", message: `You have ${overdue} overdue item${overdue === 1 ? "" : "s"} and ${stale} item${stale === 1 ? " has" : "s have"} not been updated in at least 48 hours. Open Command Center, update the record, and complete or reassign the work today.` };
}

function digestSection(title: string, items: Array<typeof commandWorkItems.$inferSelect>, limit: number) {
  if (!items.length) return [];
  return [title, ...items.slice(0, limit).map((item) => { const alignment = alignOperatingWork(item); return `• [${alignment.accountableRole} · ${alignment.operatingOutcome}] ${item.title} — ${item.projectId} — ${item.dueAt ? new Date(item.dueAt).toLocaleDateString("en-US") : "No due date"}`; }), items.length > limit ? `• +${items.length - limit} more in Command Center` : "", ""].filter(Boolean);
}

export async function getPreferences(email: string) {
  const { getDb } = await import("../db");
  const db = getDb();
  await db
    .insert(notificationPreferences)
    .values({ recipientEmail: email })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.recipientEmail, email))
    .limit(1);
  return rows[0];
}

export async function savePreferences(
  email: string,
  input: {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    quietHoursEnabled?: boolean;
    quietStart?: string;
    quietEnd?: string;
    digestMode?: string;
  },
) {
  const { getDb } = await import("../db");
  const db = getDb();
  const values = {
    recipientEmail: email,
    inAppEnabled: input.inAppEnabled !== false,
    emailEnabled: input.emailEnabled !== false,
    quietHoursEnabled: input.quietHoursEnabled === true,
    quietStart: validTime(input.quietStart) ? input.quietStart! : "19:00",
    quietEnd: validTime(input.quietEnd) ? input.quietEnd! : "07:00",
    digestMode: ["Immediate", "Daily Digest"].includes(input.digestMode || "") ? input.digestMode! : "Immediate",
    timeZone: "America/New_York",
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(notificationPreferences)
    .values(values)
    .onConflictDoUpdate({ target: notificationPreferences.recipientEmail, set: values });
  return values;
}

export async function updateWorkItem(
  actor: Awaited<ReturnType<typeof effectiveActor>>,
  itemId: string,
  action: "read" | "unread" | "acknowledge" | "complete" | "snooze",
  snoozedUntil?: string,
) {
  const { getDb } = await import("../db");
  const db = getDb();
  const rows = await db
    .select()
    .from(commandWorkItems)
    .where(eq(commandWorkItems.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) return { error: "Work Item Was Not Found", status: 404 } as const;
  if (item.recipientEmail !== actor.email && !["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    return { error: "This Work Item Is Assigned To Another Employee", status: 403 } as const;
  }
  if (item.sourceType === "Project Bonus" && item.kind === "Turnover Signature" && action === "complete") return { error: "Sign the agreement in the controlled turnover workflow.", status: 409 } as const;
  if (item.sourceType === "Meeting Action" && item.sourceRecordId && ["acknowledge", "complete"].includes(action)) {
    const current = (await db.select({ workItemId: meetingActionItems.workItemId }).from(meetingActionItems).where(eq(meetingActionItems.id,item.sourceRecordId)).limit(1))[0];
    if (!current || current.workItemId !== item.id) return { error: "This Meeting Assignment Has Been Replaced. Open The Current Assignment.", status: 409 } as const;
  }
  const now = new Date().toISOString();
  const changes =
    action === "read"
      ? { readAt: now }
      : action === "unread"
        ? { readAt: null }
        : action === "acknowledge"
          ? { readAt: now, acknowledgedAt: now, status: "Acknowledged" }
          : action === "complete"
            ? { readAt: now, completedAt: now, status: "Completed", snoozedUntil: null }
            : { status: "Snoozed", snoozedUntil: validDateTime(snoozedUntil) ? snoozedUntil : addHours(now, 24) };
  await db
    .update(commandWorkItems)
    .set({ ...changes, updatedAt: now })
    .where(eq(commandWorkItems.id, itemId));
  await db.insert(workItemAudits).values({
    workItemId: itemId,
    action: titleCase(action),
    actorName: actor.name,
    actorEmail: actor.email,
    detail: action === "snooze" ? `Snoozed Until ${changes.snoozedUntil}` : "",
  });
  if (item.sourceType === "Meeting Action" && item.sourceRecordId) {
    if (action === "acknowledge") {
      await db.update(meetingActionItems).set({ status: "Accepted", updatedAt: now }).where(and(eq(meetingActionItems.id, item.sourceRecordId),eq(meetingActionItems.workItemId,item.id)));
    }
    if (action === "complete") {
      await db.update(meetingActionItems).set({ status: "Complete", completedAt: now, updatedAt: now }).where(and(eq(meetingActionItems.id, item.sourceRecordId),eq(meetingActionItems.workItemId,item.id)));
    }
  }
  return { saved: true } as const;
}

export async function upsertWorkItem(db: CommandDb, input: WorkItemInput) {
  await upsertWorkItems(db, [input]);
}

export async function upsertWorkItems(db: CommandDb, inputs: WorkItemInput[]) {
  const now = new Date().toISOString();
  const operations = inputs.flatMap((input) => {
    const id = workItemId(input.dedupeKey);
    return [
      db
        .insert(commandWorkItems)
        .values({
          id,
          dedupeKey: input.dedupeKey,
          projectId: input.projectId,
          recipientName: input.recipientName,
          recipientEmail: input.recipientEmail,
          kind: input.kind,
          title: input.title,
          message: input.message,
          priority: input.priority || "Normal",
          sourceType: input.sourceType,
          sourceRecordId: input.sourceRecordId || "",
          actionTarget: input.actionTarget,
          dueAt: input.dueAt || null,
          createdBy: input.createdBy || "Command Center",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: commandWorkItems.dedupeKey,
          set: {
            projectId: input.projectId,
            recipientName: input.recipientName,
            title: input.title,
            message: input.message,
            priority: input.priority || "Normal",
            sourceType: input.sourceType,
            sourceRecordId: input.sourceRecordId || "",
            actionTarget: input.actionTarget,
            dueAt: input.dueAt || null,
            status: sql`CASE WHEN ${commandWorkItems.status} = 'Completed' THEN 'Open' ELSE ${commandWorkItems.status} END`,
            readAt: sql`CASE WHEN ${commandWorkItems.status} = 'Completed' THEN NULL ELSE ${commandWorkItems.readAt} END`,
            acknowledgedAt: sql`CASE WHEN ${commandWorkItems.status} = 'Completed' THEN NULL ELSE ${commandWorkItems.acknowledgedAt} END`,
            completedAt: sql`CASE WHEN ${commandWorkItems.status} = 'Completed' THEN NULL ELSE ${commandWorkItems.completedAt} END`,
            snoozedUntil: sql`CASE WHEN ${commandWorkItems.status} = 'Completed' THEN NULL ELSE ${commandWorkItems.snoozedUntil} END`,
            updatedAt: now,
          },
        }),
      db
        .insert(notificationDeliveryEvents)
        .values([
          { dedupeKey: `${id}:assignment`, workItemId: id, recipientEmail: input.recipientEmail, eventType: "Assignment", channel: "Email" },
          { dedupeKey: `${id}:assignment:push`, workItemId: id, recipientEmail: input.recipientEmail, eventType: "Assignment", channel: "Push" },
        ])
        .onConflictDoNothing(),
    ];
  });
  if (operations.length) {
    await db.batch(operations as [typeof operations[number], ...Array<typeof operations[number]>]);
  }
}

export async function closeResolvedSourceItems(
  db: CommandDb,
  email: string,
  sourceKeys: Set<string>,
) {
  const current = await db
    .select({ id: commandWorkItems.id, dedupeKey: commandWorkItems.dedupeKey })
    .from(commandWorkItems)
    .where(
      and(
        eq(commandWorkItems.recipientEmail, email),
        inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
      ),
    );
  const resolved = current.filter((item) =>
    isMyWorkReconciliationManagedKey(item.dedupeKey) && !sourceKeys.has(item.dedupeKey));
  if (!resolved.length) return;
  const now = new Date().toISOString();
  // D1 permits 100 bound parameters per statement, including SET values.
  const updates = [];
  for (let offset = 0; offset < resolved.length; offset += 90) {
    updates.push(db.update(commandWorkItems)
      .set({ status: "Completed", completedAt: now, updatedAt: now })
      .where(and(eq(commandWorkItems.recipientEmail, email),
        inArray(commandWorkItems.id, resolved.slice(offset, offset + 90).map(item => item.id)))));
  }
  await db.batch(updates as [typeof updates[number], ...Array<typeof updates[number]>]);
}

async function queueDueEventsAndEscalations(
  db: CommandDb,
  members: Array<{ name: string; email: string; level: string; active: boolean; designationsJson: string }>,
  now: Date,
) {
  const activeItems = await db
    .select()
    .from(commandWorkItems)
    .where(inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]));
  const administrators = members.filter(
    (member) => member.active && ["Company Owner", "Administrator"].includes(member.level),
  );
  const owners = members.filter((member) => member.active && member.level === "Company Owner");
  const projectRows = await db.select().from(projects);
  for (const item of activeItems) {
    if (!item.dueAt) continue;
    const due = new Date(item.dueAt);
    if (Number.isNaN(due.getTime()) || due > now) continue;
    await queueDeliveryEvent(db, item.id, item.recipientEmail, "Due Reminder");
    const overdueHours = (now.getTime() - due.getTime()) / 3_600_000;
    const nowIso = now.toISOString();
    if (overdueHours >= 48 && item.escalationLevel < 1) {
      await db.update(commandWorkItems).set({ priority: "Critical", escalatedAt: nowIso, escalationLevel: 1, updatedAt: nowIso }).where(eq(commandWorkItems.id, item.id));
      await queueDeliveryEvent(db, item.id, item.recipientEmail, "48-Hour Direct Escalation");
      await db.insert(workItemAudits).values({ workItemId: item.id, action: "48-Hour Direct Escalation", actorName: "Command Center", actorEmail: "system@meffcon.com", detail: "The responsible user received the first persistent-inactivity escalation." });
    }
    if (overdueHours >= 72 && item.escalationLevel < 2) {
      const project = projectRows.find((candidate) => candidate.number === item.projectId);
      const alignment = alignOperatingWork(item);
      const managerDesignation = alignment.accountableRole === "Sales" ? "Sales Manager" : alignment.accountableRole === "Estimator" ? "Estimating Manager" : alignment.accountableRole === "Accounting" ? "Accounting Manager" : "";
      const managerName = alignment.accountableRole === "Superintendent" ? project?.projectManager || "" : "";
      const manager = members.find((member) => member.active && member.email !== item.recipientEmail && ((managerName && member.name === managerName) || (managerDesignation && parseDesignationJson(member.designationsJson).includes(managerDesignation)))) || administrators.find((member) => member.email !== item.recipientEmail);
      await db.update(commandWorkItems).set({ priority: "Critical", escalatedAt: nowIso, escalationLevel: 2, updatedAt: nowIso }).where(eq(commandWorkItems.id, item.id));
      if (manager) await upsertWorkItem(db, {
        dedupeKey: `${item.dedupeKey}:manager-72:${manager.email}`,
        projectId: item.projectId,
        recipientName: manager.name,
        recipientEmail: manager.email,
        kind: "Escalation",
        title: `72-Hour ${alignment.accountableRole} Manager Escalation · ${item.title}`,
        message: `${item.recipientName}'s ${alignment.operatingOutcome} work item is more than 72 hours overdue. ${alignment.businessImpact} Manager action: identify the blocker, preserve role accountability, and set the recovery deadline. ${item.message}`,
        priority: "Critical",
        sourceType: "Escalation",
        sourceRecordId: item.sourceRecordId,
        actionTarget: item.actionTarget,
        dueAt: nowIso,
        createdBy: "Command Center Escalation Engine",
      });
      await db.insert(workItemAudits).values({ workItemId: item.id, action: "72-Hour Manager Escalation", actorName: "Command Center", actorEmail: "system@meffcon.com", detail: `${manager?.name || "Company management"} was included.` });
    }
    if (overdueHours >= 96 && item.escalationLevel < 3) {
      await db.update(commandWorkItems).set({ priority: "Critical", escalatedAt: nowIso, escalationLevel: 3, updatedAt: nowIso }).where(eq(commandWorkItems.id, item.id));
      const alignment = alignOperatingWork({ ...item, priority: "Critical" });
      const ownershipRecipients = owners.length ? owners : administrators;
      for (const administrator of ownershipRecipients.filter((member) => member.email !== item.recipientEmail)) {
      await upsertWorkItem(db, {
        dedupeKey: `${item.dedupeKey}:owner-96:${administrator.email}`,
        projectId: item.projectId,
        recipientName: administrator.name,
        recipientEmail: administrator.email,
        kind: "Escalation",
        title: `Ownership Red Flag · ${alignment.accountableRole} · ${item.title}`, // 96-Hour Owner/Admin Escalation retained as the compatibility audit name.
        message: `${item.recipientName}'s ${alignment.operatingOutcome} work item is more than 96 hours overdue. ${alignment.ownerEscalationReason} Ownership must see the consequence, accountable role, recovery action, and deadline. ${item.message}`,
        priority: "Critical",
        sourceType: "Escalation",
        sourceRecordId: item.sourceRecordId,
        actionTarget: item.actionTarget,
        dueAt: nowIso,
        createdBy: "Command Center Escalation Engine",
      });
      }
      await db.insert(workItemAudits).values({ workItemId: item.id, action: "96-Hour Ownership Red Flag", actorName: "Command Center", actorEmail: "system@meffcon.com", detail: `${alignment.accountableRole} accountability and ${alignment.operatingOutcome} consequence were escalated to ownership.` });
    }
  }
}

async function queueDeliveryEvent(
  db: CommandDb,
  workItemIdValue: string,
  recipientEmail: string,
  eventType: string,
) {
  const eventKey = eventType.toLowerCase().replaceAll(" ", "-");
  await db.insert(notificationDeliveryEvents).values([
    { dedupeKey: `${workItemIdValue}:${eventKey}`, workItemId: workItemIdValue, recipientEmail, eventType, channel: "Email" },
    { dedupeKey: `${workItemIdValue}:${eventKey}:push`, workItemId: workItemIdValue, recipientEmail, eventType, channel: "Push" },
  ]).onConflictDoNothing();
}

async function processOperationalEmailQueue(origin: string, now: Date) {
  const { getDb } = await import("../db");
  const db = getDb();
  const connection = await operationalEmailConnection();
  const [candidates, activeMembers] = await Promise.all([
    db.select({ event: notificationDeliveryEvents, item: commandWorkItems, preferences: notificationPreferences }).from(notificationDeliveryEvents).innerJoin(commandWorkItems, eq(notificationDeliveryEvents.workItemId, commandWorkItems.id)).leftJoin(notificationPreferences, eq(notificationDeliveryEvents.recipientEmail, notificationPreferences.recipientEmail)).where(and(inArray(notificationDeliveryEvents.status, ["Queued", "Deferred", "Retry Scheduled"]), eq(notificationDeliveryEvents.channel, "Email"))).limit(20),
    db.select({ email: companyMembers.email }).from(companyMembers).where(eq(companyMembers.isActive, true)),
  ]);
  const activeEmails = new Set(activeMembers.map((member) => member.email.toLowerCase()));
  for (const row of candidates.filter((item) => !activeEmails.has(item.event.recipientEmail.toLowerCase()))) {
    await db.update(notificationDeliveryEvents).set({ status: "Suppressed", deferredReason: "Recipient no longer has active Command Center company access", errorClass: "", error: "", nextAttemptAt: null }).where(eq(notificationDeliveryEvents.id, row.event.id));
  }
  const pending = candidates.filter((row) => activeEmails.has(row.event.recipientEmail.toLowerCase()) && (!row.event.nextAttemptAt || new Date(row.event.nextAttemptAt) <= now));
  if (!connection.configured) {
    for (const row of pending) await db.update(notificationDeliveryEvents).set({ status: "Deferred", deferredReason: "Operational email connection required", errorClass: "Connection Required", error: "", nextAttemptAt: null }).where(eq(notificationDeliveryEvents.id, row.event.id));
    return { status: "Connection Required", accepted: 0, pending: pending.length, deferred: pending.length, retrying: 0, deadLetters: 0, detail: "In-app delivery is active. External email remains explicitly deferred until Microsoft 365 or the approved adapter is connected." };
  }
  let accepted = 0;
  let deferred = 0;
  let retrying = 0;
  let deadLetters = 0;
  for (const row of pending) {
    const preferences = row.preferences;
    if (preferences?.emailEnabled === false) {
      await db.update(notificationDeliveryEvents).set({ status: "Suppressed", deferredReason: "Email delivery disabled by the recipient preference", errorClass: "", error: "", nextAttemptAt: null }).where(eq(notificationDeliveryEvents.id, row.event.id));
      continue;
    }
    if (preferences?.quietHoursEnabled && isQuietTime(now, preferences.quietStart, preferences.quietEnd, preferences.timeZone)) {
      await db.update(notificationDeliveryEvents).set({ status: "Retry Scheduled", deferredReason: "Recipient quiet hours", errorClass: "", error: "", nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString() }).where(eq(notificationDeliveryEvents.id, row.event.id));
      retrying += 1;
      continue;
    }
    if (preferences?.digestMode === "Daily Digest" && !/Escalation$/.test(row.event.eventType)) {
      await db.update(notificationDeliveryEvents).set({ status: "Suppressed", deferredReason: "Immediate email replaced by the recipient daily digest preference", errorClass: "", error: "", nextAttemptAt: null }).where(eq(notificationDeliveryEvents.id, row.event.id));
      continue;
    }
    const attemptAt = new Date().toISOString();
    const attempt = row.event.attempts + 1;
    const alignment = alignOperatingWork(row.item);
    const delivery = await sendOperationalEmail({
      to: row.event.recipientEmail,
      subject: `[Mefford · ${alignment.accountableRole}] ${row.item.title}`,
      text: `${row.event.eventType}\n\nACCOUNTABLE ROLE: ${alignment.accountableRole}\nOPERATING OUTCOME: ${alignment.operatingOutcome}\nWHY IT MATTERS: ${alignment.businessImpact}\n\n${row.item.message}\n\nOpen Command Center: ${origin}/?target=${encodeURIComponent(row.item.actionTarget)}&project=${encodeURIComponent(row.item.projectId)}&record=${encodeURIComponent(row.item.sourceRecordId)}`,
      idempotencyKey: row.event.dedupeKey,
      safeguards: { sendInvoice: false, postInvoice: false },
    });
    if (delivery.outcome === "Provider Accepted") {
      await db
        .update(notificationDeliveryEvents)
        .set({ status: "Provider Accepted", attempts: attempt, lastAttemptAt: attemptAt, sentAt: delivery.acceptedAt, acceptedAt: delivery.acceptedAt, provider: delivery.provider, providerReceiptId: delivery.providerReceiptId, providerStatus: delivery.providerStatus, nextAttemptAt: null, deferredReason: "", errorClass: "", error: "" })
        .where(eq(notificationDeliveryEvents.id, row.event.id));
      accepted += 1;
    } else {
      const status = deliveryStatusAfterFailure(attempt, delivery.errorClass);
      const deadLetteredAt = status === "Dead Letter" ? attemptAt : null;
      await db
        .update(notificationDeliveryEvents)
        .set({ status, attempts: attempt, lastAttemptAt: attemptAt, nextAttemptAt: status === "Retry Scheduled" ? nextDeliveryAttempt(attempt, now, delivery.retryAfterSeconds) : null, deferredReason: status === "Deferred" ? delivery.error : "", error: delivery.error, errorClass: delivery.errorClass, provider: delivery.provider, providerReceiptId: delivery.providerReceiptId, providerStatus: delivery.providerStatus, deadLetteredAt })
        .where(eq(notificationDeliveryEvents.id, row.event.id));
      if (status === "Deferred") deferred += 1;
      else if (status === "Dead Letter") deadLetters += 1;
      else retrying += 1;
    }
  }
  return {
    status: connection.mode,
    accepted,
    pending: accepted + deferred + retrying,
    deferred,
    retrying,
    deadLetters,
    detail: accepted ? `${accepted} operational email notification${accepted === 1 ? " was" : "s were"} accepted by the provider with receipts.` : "Operational email is connected; no provider acceptance occurred in this run.",
  };
}

async function processOperationalPushQueue(now: Date) {
  const { getDb } = await import("../db");
  const db = getDb();
  const [candidates, activeMembers] = await Promise.all([
    db.select({ event: notificationDeliveryEvents, item: commandWorkItems, preferences: notificationPreferences }).from(notificationDeliveryEvents).innerJoin(commandWorkItems, eq(notificationDeliveryEvents.workItemId, commandWorkItems.id)).leftJoin(notificationPreferences, eq(notificationDeliveryEvents.recipientEmail, notificationPreferences.recipientEmail)).where(and(inArray(notificationDeliveryEvents.status, ["Queued", "Deferred", "Retry Scheduled"]), eq(notificationDeliveryEvents.channel, "Push"))).limit(20),
    db.select({ email: companyMembers.email }).from(companyMembers).where(eq(companyMembers.isActive, true)),
  ]);
  const activeEmails = new Set(activeMembers.map((member) => member.email.toLowerCase()));
  for (const row of candidates.filter((item) => !activeEmails.has(item.event.recipientEmail.toLowerCase()))) {
    await db.update(notificationDeliveryEvents).set({ status: "Suppressed", deferredReason: "Recipient no longer has active Command Center company access", errorClass: "", error: "", nextAttemptAt: null }).where(eq(notificationDeliveryEvents.id, row.event.id));
  }
  const pending = candidates.filter((row) => activeEmails.has(row.event.recipientEmail.toLowerCase()) && (!row.event.nextAttemptAt || new Date(row.event.nextAttemptAt) <= now));
  let accepted = 0;
  let enabled = false;
  let deferred = 0;
  let retrying = 0;
  let deadLetters = 0;
  for (const row of pending) {
    const preferences = row.preferences;
    if (preferences?.quietHoursEnabled && isQuietTime(now, preferences.quietStart, preferences.quietEnd, preferences.timeZone) && !/Escalation$/.test(row.event.eventType)) {
      await db.update(notificationDeliveryEvents).set({ status: "Retry Scheduled", deferredReason: "Recipient quiet hours", errorClass: "", error: "", nextAttemptAt: new Date(now.getTime() + 60 * 60_000).toISOString() }).where(eq(notificationDeliveryEvents.id, row.event.id));
      retrying += 1;
      continue;
    }
    const delivery = await deliverOperationalPush(row.event.recipientEmail);
    enabled ||= delivery.status !== "Connection Required";
    const attemptAt = new Date().toISOString();
    const attempt = row.event.attempts + 1;
    if (delivery.sent) {
      const receipt = delivery.receipts[0];
      await db.update(notificationDeliveryEvents).set({ status: "Provider Accepted", attempts: attempt, lastAttemptAt: attemptAt, sentAt: receipt?.acceptedAt || attemptAt, acceptedAt: receipt?.acceptedAt || attemptAt, provider: "Web Push Service", providerReceiptId: receipt?.receiptId || row.event.dedupeKey, providerStatus: receipt?.status || 201, nextAttemptAt: null, deferredReason: "", errorClass: "", error: "" }).where(eq(notificationDeliveryEvents.id, row.event.id));
      accepted += 1;
      continue;
    }
    const errorClass = delivery.status === "Connection Required" || delivery.status === "No Enabled Device" ? "Connection Required" : delivery.permanentFailures && !delivery.transientFailures ? "Permanent" : "Transient";
    const status = deliveryStatusAfterFailure(attempt, errorClass);
    const error = delivery.status === "No Enabled Device" ? "No trusted device has enabled push notifications" : delivery.status === "Connection Required" ? "Web-push VAPID credentials are not configured" : "The push service did not accept the signal";
    await db.update(notificationDeliveryEvents).set({ status, attempts: attempt, lastAttemptAt: attemptAt, nextAttemptAt: status === "Retry Scheduled" ? nextDeliveryAttempt(attempt, now) : null, deferredReason: status === "Deferred" ? error : "", error, errorClass, provider: "Web Push Service", deadLetteredAt: status === "Dead Letter" ? attemptAt : null }).where(eq(notificationDeliveryEvents.id, row.event.id));
    if (status === "Deferred") deferred += 1;
    else if (status === "Dead Letter") deadLetters += 1;
    else retrying += 1;
  }
  return {
    status: enabled ? "Connected" : "Connection Required",
    accepted,
    pending: accepted + deferred + retrying,
    deferred,
    retrying,
    deadLetters,
    detail: accepted ? `${accepted} operational push notification${accepted === 1 ? " was" : "s were"} accepted by a push service with receipts.` : enabled ? "Push is connected, but no provider acceptance occurred in this run." : "Push is explicitly deferred until signing keys are configured and a trusted device opts in.",
  };
}

export async function deliverQueuedOperationalNotices(
  now = new Date(),
  origin = "https://mefford-project-command.jordan-mefor-1272.chatgpt.site",
) {
  const email = await processOperationalEmailQueue(origin, now);
  const push = await processOperationalPushQueue(now);
  const totals = {
    accepted: email.accepted + push.accepted,
    pending: email.pending + push.pending,
    deferred: email.deferred + push.deferred,
    retrying: email.retrying + push.retrying,
    deadLetters: email.deadLetters + push.deadLetters,
  };
  return { email, push, ...totals, ...scheduledDeliveryOutcome({ ...totals, reason: `${email.detail} ${push.detail}` }) };
}

export async function loadDeliveryControlSnapshot(now = new Date()) {
  const { getDb } = await import("../db");
  const db = getDb();
  const rows = await db.select().from(notificationDeliveryEvents).orderBy(asc(notificationDeliveryEvents.createdAt)).limit(1_500);
  const acceptedRows = rows.filter((row) => ["Provider Accepted", "Sent"].includes(row.status));
  const pendingRows = rows.filter((row) => ["Queued", "Deferred", "Retry Scheduled"].includes(row.status));
  const deferredRows = rows.filter((row) => row.status === "Deferred");
  const retryRows = rows.filter((row) => row.status === "Retry Scheduled");
  const deadRows = rows.filter((row) => ["Dead Letter", "Failed"].includes(row.status));
  const oldest = pendingRows[0];
  const oldestAgeMinutes = oldest ? queueAgeMinutes(oldest.createdAt, now) : 0;
  const receiptRows = acceptedRows.filter((row) => Boolean(row.providerReceiptId));
  const status = deadRows.length
    ? "Action Required"
    : oldestAgeMinutes >= 60
      ? "Degraded"
      : deferredRows.length
        ? "Connection Required"
        : retryRows.length
          ? "Retrying"
          : pendingRows.length
            ? "Pending"
            : acceptedRows.length
              ? "Verified"
              : "No Evidence";
  return {
    status,
    total: rows.length,
    queued: rows.filter((row) => row.status === "Queued").length,
    pending: pendingRows.length,
    deferred: deferredRows.length,
    retrying: retryRows.length,
    providerAccepted: acceptedRows.length,
    deadLetters: deadRows.length,
    oldestQueuedAt: oldest?.createdAt || "",
    oldestQueuedAgeMinutes: oldestAgeMinutes,
    providerReceiptCoverage: acceptedRows.length ? Math.round(receiptRows.length / acceptedRows.length * 100) : 0,
    certifications: ["Email", "Push"].map((channel) => {
      const accepted = acceptedRows.filter((row) => row.channel === channel && row.eventType === "Certification Test");
      const receipted = accepted.filter((row) => Boolean(row.providerReceiptId));
      return { channel, status: receipted.length ? "Provider Acceptance Certified" : "Awaiting Test Receipt", accepted: accepted.length, receipts: receipted.length };
    }),
    byChannel: ["Email", "Push"].map((channel) => ({
      channel,
      pending: pendingRows.filter((row) => row.channel === channel).length,
      accepted: acceptedRows.filter((row) => row.channel === channel).length,
      deadLetters: deadRows.filter((row) => row.channel === channel).length,
    })),
    recent: [...rows].reverse().slice(0, 30).map((row) => ({
      id: row.id,
      channel: row.channel,
      eventType: row.eventType,
      recipient: maskDeliveryRecipient(row.recipientEmail),
      status: row.status,
      attempts: row.attempts,
      provider: row.provider,
      providerReceiptId: row.providerReceiptId,
      providerStatus: row.providerStatus,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt || row.sentAt || "",
      nextAttemptAt: row.nextAttemptAt || "",
      error: row.error || row.deferredReason,
    })),
    truthRule: "Provider Accepted proves provider intake only. It does not claim inbox delivery, reading, or action completion.",
  };
}

export async function runControlledDeliveryTest(actor: { name: string; email: string }, origin: string) {
  const { getDb } = await import("../db");
  const db = getDb();
  const dedupeKey = `delivery-certification:${actor.email}:${crypto.randomUUID()}`;
  const id = workItemId(dedupeKey);
  await upsertWorkItem(db, {
    dedupeKey,
    projectId: "MEFFORD-COMPANY",
    recipientName: actor.name,
    recipientEmail: actor.email,
    kind: "Delivery Certification",
    title: "Controlled F-03 Email And Push Test",
    message: "This controlled test proves whether the external provider accepted a notification. It does not approve work or claim that a person read it.",
    priority: "Normal",
    sourceType: "Delivery Certification",
    sourceRecordId: id,
    actionTarget: "IT & Integrations",
    createdBy: actor.name,
  });
  const events = await db.select().from(notificationDeliveryEvents).where(eq(notificationDeliveryEvents.workItemId, id));
  const emailEvent = events.find((event) => event.channel === "Email");
  const pushEvent = events.find((event) => event.channel === "Push");
  const now = new Date();
  const email = await sendOperationalEmail({
    to: actor.email,
    senderEmail: actor.email,
    subject: "Mefford Command Center · Controlled F-03 Delivery Test",
    text: `This is a controlled provider-acceptance test requested by ${actor.name}.\n\nOpen IT & Integrations: ${origin}/?target=${encodeURIComponent("IT & Integrations")}\n\nNo approval, posting, payment, or business record is created by this message.`,
    idempotencyKey: emailEvent?.dedupeKey || `${dedupeKey}:email`,
    safeguards: { approveWork: false, postInvoice: false, releasePayment: false },
  });
  if (emailEvent) await recordCertificationResult(db, emailEvent, email, now);
  const push = await deliverOperationalPush(actor.email);
  if (pushEvent) {
    const receipt = push.receipts[0];
    const result = push.sent
      ? { outcome: "Provider Accepted" as const, provider: "Web Push Service", providerReceiptId: receipt?.receiptId || pushEvent.dedupeKey, providerStatus: receipt?.status || 201, acceptedAt: receipt?.acceptedAt || now.toISOString(), error: "", errorClass: "" as const, retryAfterSeconds: 0 }
      : { outcome: "Deferred" as const, provider: "Web Push Service", providerReceiptId: "", providerStatus: 0, acceptedAt: "", error: push.status === "Connection Required" ? "Web-push signing keys are not configured" : "No trusted push-enabled device accepted the test", errorClass: "Connection Required" as const, retryAfterSeconds: 0 };
    await recordCertificationResult(db, pushEvent, result, now);
  }
  return { email, push: { status: push.status, accepted: push.sent, receipts: push.receipts }, truthRule: "A provider acceptance receipt is required; this test does not prove inbox delivery or that the recipient read the notification." };
}

async function recordCertificationResult(db: CommandDb, event: typeof notificationDeliveryEvents.$inferSelect, delivery: Awaited<ReturnType<typeof sendOperationalEmail>>, now: Date) {
  const attemptAt = now.toISOString();
  const attempt = event.attempts + 1;
  const status = delivery.outcome === "Provider Accepted" ? "Provider Accepted" : deliveryStatusAfterFailure(attempt, delivery.errorClass);
  await db.update(notificationDeliveryEvents).set({
    eventType: "Certification Test",
    status,
    attempts: attempt,
    lastAttemptAt: attemptAt,
    nextAttemptAt: status === "Retry Scheduled" ? nextDeliveryAttempt(attempt, now, delivery.retryAfterSeconds) : null,
    error: delivery.error,
    errorClass: delivery.errorClass,
    deferredReason: status === "Deferred" ? delivery.error : "",
    provider: delivery.provider,
    providerReceiptId: delivery.providerReceiptId,
    providerStatus: delivery.providerStatus,
    sentAt: delivery.acceptedAt || null,
    acceptedAt: delivery.acceptedAt || null,
    deadLetteredAt: status === "Dead Letter" ? attemptAt : null,
  }).where(eq(notificationDeliveryEvents.id, event.id));
}

function maskDeliveryRecipient(email: string) {
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "Recipient Protected";
}

function decorateWorkItem(
  item: typeof commandWorkItems.$inferSelect,
  now: Date,
  audits: Array<typeof workItemAudits.$inferSelect>,
) {
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const snoozed = item.snoozedUntil ? new Date(item.snoozedUntil) : null;
  const hiddenBySnooze = item.status === "Snoozed" && snoozed && snoozed > now;
  const overdue = Boolean(due && due < now && item.status !== "Completed" && !hiddenBySnooze);
  const dueSoon = Boolean(due && due >= now && due.getTime() - now.getTime() <= 72 * 3_600_000);
  const operatingAlignment = alignOperatingWork(item);
  return {
    ...item,
    ...operatingAlignment,
    isRead: Boolean(item.readAt),
    overdue,
    dueSoon,
    hiddenBySnooze,
    auditHistory: audits.map((audit) => ({
      action: audit.action,
      actorName: audit.actorName,
      detail: audit.detail,
      createdAt: audit.createdAt,
    })),
  };
}

function actionTargetForRecord(recordType: string, projectId = "") {
  if (/onboarding/i.test(recordType)) return "Employee Onboarding";
  if (/design package|design team/i.test(recordType)) return "Design & Drawings";
  if (/quality/i.test(recordType)) return "Quality";
  if (/template annual review|annual company review/i.test(recordType)) return "Review";
  if (/vendor submission|vendor billing/i.test(recordType)) return "Vendor Management";
  if (/owner billing|owner invoice|billing documentation/i.test(recordType)) return "Owner Billing";
  if (/ap invoice|payment batch|recurring payment/i.test(recordType)) return "Accounts Payable";
  if (recordType === "Owner Contract") return "Contracts";
  if (recordType === "Toolbox Talks") return "Safety";
  if (recordType === "Sales Opportunities") return "Sales Funnel";
  if (/marketing/i.test(recordType)) return "Marketing";
  if (recordType === "Bid Packages") return projectId === "MEFFORD-SALES" ? "Bid Management" : "Procurement";
  return recordType || "Dashboard";
}

function normalizeDueAt(value: string, now: Date) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return validDateTime(trimmed) ? new Date(trimmed).toISOString() : null;
  let isoDate = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) isoDate = trimmed;
  const numeric = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) isoDate = `${numeric[3]}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  if (!isoDate) return null;
  const offset = easternOffsetForDate(isoDate, now);
  return new Date(`${isoDate}T17:00:00${offset}`).toISOString();
}

function easternOffsetForDate(value: string, fallback: Date) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return fallback.getTimezoneOffset() === 240 ? "-04:00" : "-05:00";
  const zoneName = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  return zoneName === "EDT" ? "-04:00" : "-05:00";
}

function isQuietTime(now: Date, start: string, end: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const clock = `${parts.find((part) => part.type === "hour")?.value || "00"}:${parts.find((part) => part.type === "minute")?.value || "00"}`;
  return start <= end ? clock >= start && clock < end : clock >= start || clock < end;
}

function workItemId(dedupeKey: string) {
  let hash = 2166136261;
  for (let index = 0; index < dedupeKey.length; index += 1) {
    hash ^= dedupeKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `WI-${(hash >>> 0).toString(36).toUpperCase()}`;
}

function parseStringArray(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function validTime(value?: string) {
  return Boolean(value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function validDateTime(value?: string) {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 3_600_000).toISOString();
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
