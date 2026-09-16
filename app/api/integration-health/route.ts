import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  commandWorkItems,
  companyMembers,
  projects,
  recordAudits,
  workItemAudits,
} from "../../../db/schema";
import {
  INTEGRATION_COMPANY_ID,
  INTEGRATION_CONFLICT_TYPE,
  INTEGRATION_EVENT_TYPE,
  INTEGRATION_GO_LIVE_CHECKLIST,
  INTEGRATION_HEALTH_STATUSES,
  INTEGRATION_INCIDENT_TYPE,
  INTEGRATION_MAINTENANCE_TYPE,
  INTEGRATION_RECORD_TYPE,
  INTEGRATION_REPLAY_TYPE,
  INTEGRATION_SAFEGUARDS,
  MEFFORD_INTEGRATIONS,
  addHours,
  integrationSystemColor,
  parseIntegrationData,
  safeIntegrationText,
  validIntegrationStatus,
  type IntegrationDefinition,
  type IntegrationHealthStatus,
} from "../../../lib/integration-health";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";
import { ensureMyWorkTables, loadDeliveryControlSnapshot, runControlledDeliveryTest, upsertWorkItem } from "../../../lib/my-work";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { loadScheduledOperationSnapshot } from "../../../lib/scheduled-operations";
import { applicationReadinessSnapshot } from "../../../lib/section-readiness";
import { integrationRuntimeSnapshot } from "../../../lib/integration-runtime";
import { ensureMicrosoftSubscriptionSchema } from "../../../lib/microsoft-subscriptions";
import { loadMicrosoftWebhookHealthSnapshot } from "../../../lib/microsoft-webhook-security";
import { collectSystemHealthRuntimeEvidence } from "../../../lib/system-health-runtime";
import { systemAuditSnapshot } from "../../../lib/system-audit";
import { loadDomainOutboxSnapshot } from "../../../lib/domain-outbox";

type Db = ReturnType<(typeof import("../../../db"))["getDb"]>;
type IntegrationRole = "Owner/Admin" | "IT Administrator" | "Accounting" | "Project Manager" | "Marketing";
type IntegrationContext = {
  name: string;
  email: string;
  accessLevel: string;
  designations: string[];
  role: IntegrationRole;
  canConfigure: boolean;
  canApproveFinancial: boolean;
  canReviewFinancial: boolean;
  assignedProjectIds: string[];
};

type IntegrationPayload = {
  action?: string;
  integrationKey?: string;
  status?: string;
  cause?: string;
  impact?: string;
  primaryOwnerName?: string;
  primaryOwnerEmail?: string;
  backupOwnerName?: string;
  backupOwnerEmail?: string;
  reconnectors?: string[];
  providerStatusUrl?: string;
  oneDriveFolder?: string;
  notes?: string;
  affectedProjectIds?: string[];
  sourceCount?: number;
  importedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  duplicatesPrevented?: number;
  sampleRecordIds?: string;
  checklist?: string[];
  environment?: "Test" | "Production";
  recordId?: string;
  reason?: string;
  maintenanceDate?: string;
  expectedEndTime?: string;
  providerReference?: string;
  sourceVersion?: string;
  commandVersion?: string;
  resolution?: string;
  resolutionNote?: string;
  decision?: "Approved" | "Rejected";
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMyWorkTables();
    const context = await integrationContext(actor);
    if ("error" in context) return Response.json({ error: context.error }, { status: context.status });
    const db = await commandDb();
    await ensureIntegrationRecords(db, context);
    await reconcileIntegrationHealth({ actorName: context.name, actorEmail: context.email });
    return Response.json(await buildResponse(db, context));
  } catch (error) {
    return integrationError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMyWorkTables();
    const context = await integrationContext(actor);
    if ("error" in context) return Response.json({ error: context.error }, { status: context.status });
    const input = (await request.json()) as IntegrationPayload;
    const db = await commandDb();
    await ensureIntegrationRecords(db, context);
    const definition = MEFFORD_INTEGRATIONS.find((item) => item.key === input.integrationKey);
    const now = new Date().toISOString();

    if (input.action === "test-delivery") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const test = await runControlledDeliveryTest({ name: context.name, email: context.email }, new URL(request.url).origin);
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id: `DELIVERY-CERTIFICATION-${crypto.randomUUID()}`, recordType: INTEGRATION_EVENT_TYPE, title: "F-03 Controlled Delivery Certification", owner: context.name, due: now.slice(0, 10), status: test.email.outcome === "Provider Accepted" || test.push.accepted ? "Provider Acceptance Recorded" : "Deferred · Connection Required", meta: `Email ${test.email.outcome} · Push ${test.push.status}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify({ integrationKey: "operational-email", action: "Controlled Delivery Certification", email: test.email, push: test.push, truthRule: test.truthRule, actorEmail: context.email, at: now }), updatedAt: now });
      return Response.json({ saved: true, test, response: await buildResponse(db, context) });
    }

    if (input.action === "save-connection") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      if (!definition) return badRequest("Select A Valid Integration");
      const runtime = (await integrationRuntimeSnapshot())[definition.key];
      if (runtime?.activationState === "Not Implemented") return Response.json({ error: `${definition.name} Is Inventory Only. A Server-Side Provider Adapter Must Be Implemented And Tested Before It Can Be Configured.` }, { status: 409 });
      const row = await integrationRow(db, definition.key);
      const current = parseIntegrationData(row?.dataJson);
      const primaryOwnerName = safeIntegrationText(input.primaryOwnerName, 120);
      const primaryOwnerEmail = normalizeEmail(input.primaryOwnerEmail);
      const backupOwnerName = safeIntegrationText(input.backupOwnerName, 120);
      const backupOwnerEmail = normalizeEmail(input.backupOwnerEmail);
      if (!primaryOwnerName || !primaryOwnerEmail || !backupOwnerName || !backupOwnerEmail) {
        return badRequest("Primary And Backup Owners With Valid Email Addresses Are Required");
      }
      const checklist = normalizeStrings(input.checklist).filter((item) => INTEGRATION_GO_LIVE_CHECKLIST.includes(item as (typeof INTEGRATION_GO_LIVE_CHECKLIST)[number]));
      const next = {
        ...current,
        primaryOwnerName,
        primaryOwnerEmail,
        backupOwnerName,
        backupOwnerEmail,
        reconnectors: normalizeStrings(input.reconnectors),
        providerStatusUrl: safeHttpsUrl(input.providerStatusUrl) || definition.providerStatusUrl,
        oneDriveFolder: safeIntegrationText(input.oneDriveFolder, 240),
        notes: safeIntegrationText(input.notes, 1000),
        checklist,
        environment: input.environment === "Production" ? "Production" : "Test",
        productionSeparated: true,
        configuredBy: context.name,
        configuredAt: now,
      };
      await db.update(commandRecords).set({ owner: primaryOwnerName, meta: `${row?.status || "Not Configured"} · ${primaryOwnerName} + ${backupOwnerName}`, dataJson: JSON.stringify(next), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connectionId(definition.key))));
      await audit(db, connectionId(definition.key), context, "Connection Ownership & Configuration", String(current.primaryOwnerName || "Unassigned"), `${primaryOwnerName} + ${backupOwnerName}`, "Connection owners, reconnectors, environment separation and restricted records folder were updated");
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "record-health") {
      if (!definition) return badRequest("Select A Valid Integration");
      const runtime = (await integrationRuntimeSnapshot())[definition.key];
      if (runtime?.activationState === "Not Implemented") return Response.json({ error: `${definition.name} Has No Implemented Adapter And Cannot Receive An Operational Health Certification.` }, { status: 409 });
      if (!context.canConfigure && !(context.role === "Accounting" && definition.sensitive)) return forbidden("Authorized Integration Ownership Is Required");
      if (!validIntegrationStatus(input.status)) return badRequest("Select A Valid Health Status");
      if (input.status === "Connected") return badRequest(`${definition.name} Cannot Be Marked Connected Manually. Connected Requires A Server-Executed Provider Probe Or Verified Provider Event With Reconciliation Evidence.`);
      const cause = safeIntegrationText(input.cause, 600);
      const impact = safeIntegrationText(input.impact, 600);
      if (input.status !== "Not Configured" && (!cause || !impact)) return badRequest("Cause And Operational Impact Are Required");
      const row = await integrationRow(db, definition.key);
      const current = parseIntegrationData(row?.dataJson);
      const counts = reconciliationCounts(input);
      const priorStatus = String(row?.status || "Not Configured");
      const next = {
        ...current,
        cause,
        impact,
        affectedProjectIds: normalizeStrings(input.affectedProjectIds),
        lastCheckedAt: now,
        lastSuccessfulAt: current.lastSuccessfulAt || "",
        failureStartedAt: ["Failed", "Reauthorization Required"].includes(input.status) ? current.failureStartedAt || now : "",
        retryAttempts: Number(current.retryAttempts || 0),
        nextRetryAt: ["Failed", "Degraded"].includes(input.status) ? addHours(now, 5 / 60) : "",
        reconciliation: { ...counts, sampleRecordIds: maskedSamples(input.sampleRecordIds), recordedAt: now, recordedBy: context.name },
      };
      await db.update(commandRecords).set({ status: input.status, meta: `${input.status} · ${cause || "Health Check Passed"}`, dataJson: JSON.stringify(next), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connectionId(definition.key))));
      await integrationEvent(db, definition, context, "Health Status Changed", priorStatus, input.status, cause || "Connection test and reconciliation passed", { impact, reconciliation: next.reconciliation });
      await syncIntegrationWork(db, definition, input.status, next, now);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "schedule-maintenance") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      if (!definition) return badRequest("Select A Valid Integration");
      const reason = safeIntegrationText(input.reason, 800);
      const date = safeIntegrationText(input.maintenanceDate, 10);
      const expectedEndTime = safeIntegrationText(input.expectedEndTime, 5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(expectedEndTime) || reason.length < 10) return badRequest("Saturday Date Expected End Time And A Specific Reason Are Required");
      if (new Date(`${date}T12:00:00Z`).getUTCDay() !== 6) return badRequest("The Standard Maintenance Window Must Begin On Saturday");
      const overrunExpected = expectedEndTime > "06:00";
      const id = `INTEGRATION-MAINT-${date}-${definition.key}-${crypto.randomUUID().slice(0, 8)}`;
      const data = { integrationKey: definition.key, scheduledDate: date, startTime: "00:00", expectedEndTime, reason, overrunExpected, statusBeforeMaintenance: (await integrationRow(db, definition.key))?.status || "Not Configured", scheduledBy: context.name, scheduledAt: now, notifications: overrunExpected ? "All Users · In-App + Email" : "Affected Roles" };
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_MAINTENANCE_TYPE, title: `${definition.name} · Scheduled Maintenance`, owner: context.name, due: date, status: "Scheduled", meta: `Saturday 12:00 AM–${expectedEndTime} ET${overrunExpected ? " · All-User Warning Required" : ""}`, recordDate: date, recordTime: "00:00", dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, id, context, "Maintenance Window", "None", `Saturday ${date} 12:00 AM–${expectedEndTime} ET`, reason);
      if (overrunExpected) await notifyAllActiveMembers(db, id, `${definition.name} Maintenance May Extend Beyond 6:00 AM`, `${reason} Expected completion is ${expectedEndTime} Eastern.`, now);
      return Response.json({ saved: true, warningSent: overrunExpected, response: await buildResponse(db, context) }, { status: 201 });
    }

    if (input.action === "complete-maintenance") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const row = await recordById(db, input.recordId, INTEGRATION_MAINTENANCE_TYPE);
      if (!row) return notFound("Maintenance Window Not Found");
      const data = parseIntegrationData(row.dataJson);
      const reason = safeIntegrationText(input.reason, 600);
      if (reason.length < 8) return badRequest("Record The Completion And Verification Note");
      const key = String(data.integrationKey || "");
      const integration = MEFFORD_INTEGRATIONS.find((item) => item.key === key);
      await db.update(commandRecords).set({ status: "Completed", meta: `Restored Early Or On Time · ${context.name}`, dataJson: JSON.stringify({ ...data, completedAt: now, completedBy: context.name, completionNote: reason }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      if (integration) {
        const connection = await integrationRow(db, key);
        const connectionData = parseIntegrationData(connection?.dataJson);
        const restoredStatus = validIntegrationStatus(data.statusBeforeMaintenance) ? data.statusBeforeMaintenance : "Connected";
        await db.update(commandRecords).set({ status: restoredStatus, meta: `${restoredStatus} · Maintenance Complete`, dataJson: JSON.stringify({ ...connectionData, maintenanceId: "", lastCheckedAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connectionId(key))));
        await integrationEvent(db, integration, context, "Maintenance Completed", "Maintenance", restoredStatus, reason);
      }
      await audit(db, row.id, context, "Maintenance Status", row.status, "Completed", reason);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "report-conflict") {
      if (!definition) return badRequest("Select A Valid Integration");
      if (!context.canConfigure && !(context.role === "Accounting" && definition.sensitive)) return forbidden("Authorized Integration Access Is Required");
      const reason = safeIntegrationText(input.reason, 700);
      if (reason.length < 10 || !safeIntegrationText(input.sourceVersion, 1000) || !safeIntegrationText(input.commandVersion, 1000)) return badRequest("Describe The Conflict And Preserve Both Source Versions");
      const id = `INTEGRATION-CONFLICT-${crypto.randomUUID()}`;
      const data = { integrationKey: definition.key, reason, sourceVersion: safeIntegrationText(input.sourceVersion, 1000), commandVersion: safeIntegrationText(input.commandVersion, 1000), affectedProjectIds: normalizeStrings(input.affectedProjectIds), quarantinedAt: now, quarantinedBy: context.name, resolution: "", resolutionNote: "" };
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_CONFLICT_TYPE, title: `${definition.name} · Sync Conflict`, owner: context.name, due: now.slice(0, 10), status: "Quarantined", meta: "Both Versions Preserved · Review Required", recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, id, context, "Conflict", "None", "Quarantined", reason);
      await assignLeadershipWork(db, id, "Integration Conflict Requires Resolution", `${definition.name}: ${reason}`, "Critical", now);
      return Response.json({ saved: true, recordId: id, response: await buildResponse(db, context) }, { status: 201 });
    }

    if (input.action === "resolve-conflict") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const row = await recordById(db, input.recordId, INTEGRATION_CONFLICT_TYPE);
      if (!row) return notFound("Conflict Record Not Found");
      const resolution = safeIntegrationText(input.resolution, 80);
      const note = safeIntegrationText(input.resolutionNote, 800);
      if (!["Source Version Accepted", "Command Center Version Accepted", "Reviewed Merge"].includes(resolution) || note.length < 10) return badRequest("Choose A Resolution And Record The Specific Basis");
      const data = parseIntegrationData(row.dataJson);
      await db.update(commandRecords).set({ status: "Resolved", meta: `${resolution} · Both Originals Retained`, dataJson: JSON.stringify({ ...data, resolution, resolutionNote: note, resolvedBy: context.name, resolvedAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      await audit(db, row.id, context, "Conflict Resolution", "Quarantined", resolution, note);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "request-replay") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      if (!definition) return badRequest("Select A Valid Integration");
      const reason = safeIntegrationText(input.reason, 800);
      if (reason.length < 10) return badRequest("A Specific Replay Reason Is Required");
      const id = `INTEGRATION-REPLAY-${crypto.randomUUID()}`;
      const status = definition.sensitive ? "Pending Accounting Review" : "Approved For Safe Replay";
      const data = { integrationKey: definition.key, reason, requestedBy: context.name, requestedAt: now, sensitive: definition.sensitive, accountingDecision: "", ownerDecision: "", safeguards: ["Duplicate check", "Idempotency key", "No automatic posting/payment/payroll approval"] };
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_REPLAY_TYPE, title: `${definition.name} · Manual Replay`, owner: definition.sensitive ? "Accounting" : context.name, due: now.slice(0, 10), status, meta: definition.sensitive ? "Accounting Review → Company Owner Approval" : "Safe Replay · Duplicate Prevention Active", recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, id, context, "Manual Replay", "None", status, reason);
      if (definition.sensitive) await assignRoleWork(db, id, "Accounting", `${definition.name} Replay Requires Accounting Review`, reason, "Critical", now);
      return Response.json({ saved: true, recordId: id, response: await buildResponse(db, context) }, { status: 201 });
    }

    if (input.action === "decide-replay") {
      const row = await recordById(db, input.recordId, INTEGRATION_REPLAY_TYPE);
      if (!row) return notFound("Replay Request Not Found");
      const data = parseIntegrationData(row.dataJson);
      const decision = input.decision;
      const reason = safeIntegrationText(input.reason, 800);
      if (!decision || reason.length < 8) return badRequest("Decision And Review Note Are Required");
      let status = row.status;
      const next = { ...data };
      if (row.status === "Pending Accounting Review") {
        if (!context.canReviewFinancial) return forbidden("Accounting Review Is Required");
        next.accountingDecision = decision;
        next.accountingNote = reason;
        next.accountingActor = context.name;
        next.accountingAt = now;
        status = decision === "Approved" ? "Pending Owner Approval" : "Rejected";
        if (decision === "Approved") await assignRoleWork(db, row.id, "Company Owner", `${row.title} Requires Company Owner Approval`, reason, "Critical", now);
      } else if (row.status === "Pending Owner Approval") {
        if (!context.canApproveFinancial) return forbidden("Company Owner Approval Is Required");
        next.ownerDecision = decision;
        next.ownerNote = reason;
        next.ownerActor = context.name;
        next.ownerAt = now;
        status = decision === "Approved" ? "Approved For Safe Replay" : "Rejected";
      } else return badRequest("This Replay Is Not Awaiting The Current Approval Step");
      await db.update(commandRecords).set({ owner: status === "Pending Owner Approval" ? "Company Owner" : context.name, status, meta: `${status} · Duplicate Prevention Active`, dataJson: JSON.stringify(next), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      await audit(db, row.id, context, "Replay Approval", row.status, status, reason);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "record-replay-result") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const row = await recordById(db, input.recordId, INTEGRATION_REPLAY_TYPE);
      if (!row || row.status !== "Approved For Safe Replay") return badRequest("Replay Must Be Approved Before Its Result Can Be Recorded");
      const counts = reconciliationCounts(input);
      if (counts.failedCount > 0) return badRequest("A Replay With Failed Records Cannot Be Marked Complete");
      const data = parseIntegrationData(row.dataJson);
      await db.update(commandRecords).set({ status: "Completed", meta: `${counts.importedCount} Imported · ${counts.duplicatesPrevented} Duplicates Prevented`, dataJson: JSON.stringify({ ...data, result: counts, sampleRecordIds: maskedSamples(input.sampleRecordIds), completedBy: context.name, completedAt: now }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      await audit(db, row.id, context, "Replay Result", "Approved For Safe Replay", "Completed", `${counts.importedCount} imported; ${counts.duplicatesPrevented} duplicates prevented; zero failures`);
      const { env } = await import("cloudflare:workers");
      const handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "integration-accountability", eventId: `integration-replay-reconciled:${row.id}`, aggregateType: INTEGRATION_REPLAY_TYPE, aggregateId: row.id, projectId: INTEGRATION_COMPANY_ID, actorName: context.name, actorEmail: context.email, occurredAt: now, payload: { replayId: row.id, ...counts } });
      return Response.json({ saved: true, response: await buildResponse(db, context), handoff });
    }

    if (input.action === "open-incident") {
      if (!definition) return badRequest("Select A Valid Integration");
      if (!context.canConfigure && !(context.role === "Accounting" && definition.sensitive)) return forbidden("Authorized Integration Access Is Required");
      const reason = safeIntegrationText(input.reason, 900);
      if (reason.length < 10) return badRequest("Describe The Provider Outage And Its Operational Impact");
      const id = `INTEGRATION-INCIDENT-${crypto.randomUUID()}`;
      const critical = ["command-center-platform", "microsoft-identity", "ramp", "chase-banking", "paylocity"].includes(definition.key);
      const data = { integrationKey: definition.key, reason, providerReference: safeIntegrationText(input.providerReference, 300), providerStatusUrl: definition.providerStatusUrl, critical, safeQueue: true, temporaryInstructions: safeIntegrationText(input.notes, 800), openedBy: context.name, openedAt: now };
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_INCIDENT_TYPE, title: `${definition.name} · Provider Incident`, owner: context.name, due: now.slice(0, 10), status: "Open", meta: `${critical ? "System Red" : "Operational Incident"} · Safe Queue Active`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
      await audit(db, id, context, "Provider Incident", "None", "Open", reason);
      await assignLeadershipWork(db, id, `${definition.name} Provider Incident`, reason, critical ? "Critical" : "High", now);
      return Response.json({ saved: true, recordId: id, response: await buildResponse(db, context) }, { status: 201 });
    }

    if (input.action === "acknowledge-incident") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const row = await recordById(db, input.recordId, INTEGRATION_INCIDENT_TYPE);
      if (!row || row.status !== "Open") return badRequest("Choose An Open Provider Incident");
      const note = safeIntegrationText(input.reason, 800);
      if (note.length < 10) return badRequest("Record The Initial Assessment And Immediate Operating Response");
      const data = parseIntegrationData(row.dataJson);
      if (data.acknowledgedAt) return badRequest("This Incident Has Already Been Acknowledged");
      await db.update(commandRecords).set({ meta: "Acknowledged · Safe Queue Active · Recovery In Progress", dataJson: JSON.stringify({ ...data, acknowledgedBy: context.name, acknowledgedByEmail: context.email, acknowledgedAt: now, initialAssessment: note }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      await audit(db, row.id, context, "Incident Response", "Unacknowledged", "Acknowledged", note);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    if (input.action === "close-incident") {
      if (!context.canConfigure) return forbidden("Owner Admin Or Designated IT Administrator Access Is Required");
      const row = await recordById(db, input.recordId, INTEGRATION_INCIDENT_TYPE);
      if (!row) return notFound("Provider Incident Not Found");
      const reason = safeIntegrationText(input.reason, 800);
      if (reason.length < 10) return badRequest("Successful Reconciliation Evidence Is Required Before Closing The Incident");
      const counts = reconciliationCounts(input);
      if (counts.failedCount > 0 || counts.sourceCount !== counts.importedCount + counts.skippedCount) return badRequest("Reconciliation Must Balance With Zero Failed Records Before Returning To Connected");
      const data = parseIntegrationData(row.dataJson);
      await db.update(commandRecords).set({ status: "Closed", meta: "Reconciled · Connected Status May Resume", dataJson: JSON.stringify({ ...data, reconciliation: counts, sampleRecordIds: maskedSamples(input.sampleRecordIds), closedBy: context.name, closedAt: now, closureNote: reason }), updatedAt: now }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, row.id)));
      await audit(db, row.id, context, "Provider Incident", "Open", "Closed", reason);
      return Response.json({ saved: true, response: await buildResponse(db, context) });
    }

    return badRequest("A Valid IT & Integrations Action Is Required");
  } catch (error) {
    return integrationError(error);
  }
}

export async function reconcileIntegrationHealth(options: { actorName?: string; actorEmail?: string; nightly?: boolean } = {}) {
  const db = await commandDb();
  const context = { name: options.actorName || "Integration Health Engine", email: options.actorEmail || "system@meffcon.com" };
  await ensureIntegrationRecords(db, context);
  const now = new Date();
  const nowIso = now.toISOString();
  const runtime = await integrationRuntimeSnapshot();
  const rows = await db.select().from(commandRecords).where(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID));
  const connections = rows.filter((row) => row.recordType === INTEGRATION_RECORD_TYPE);
  const trackedConnections = connections.filter((connection) => MEFFORD_INTEGRATIONS.some((definition) => connection.id === connectionId(definition.key)));
  const maintenance = rows.filter((row) => row.recordType === INTEGRATION_MAINTENANCE_TYPE && ["Scheduled", "Active"].includes(row.status));
  for (const window of maintenance) {
    const data = parseIntegrationData(window.dataJson);
    const start = easternWindowInstant(String(data.scheduledDate || ""), "00:00");
    const expectedEnd = easternWindowInstant(String(data.scheduledDate || ""), String(data.expectedEndTime || "06:00"));
    if (window.status === "Scheduled" && start && now >= start && (!expectedEnd || now <= expectedEnd)) {
      await db.update(commandRecords).set({ status: "Active", meta: `${window.meta} · In Progress`, dataJson: JSON.stringify({ ...data, startedAt: nowIso }), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, window.id)));
      const connection = connections.find((item) => item.id === connectionId(String(data.integrationKey || "")));
      if (connection) await db.update(commandRecords).set({ status: "Maintenance", meta: `Maintenance · Expected Complete ${data.expectedEndTime} ET`, dataJson: JSON.stringify({ ...parseIntegrationData(connection.dataJson), maintenanceId: window.id, maintenanceStartedAt: nowIso }), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connection.id)));
    }
    if (window.status === "Active" && expectedEnd && now > expectedEnd) {
      await assignLeadershipWork(db, window.id, "Maintenance Window Has Exceeded Its Expected Completion", `${window.title} remains active after ${data.expectedEndTime} Eastern. Update all users and record the revised restoration plan.`, "Critical", nowIso);
    }
  }
  for (const connection of trackedConnections) {
    const definition = MEFFORD_INTEGRATIONS.find((item) => connection.id === connectionId(item.key));
    if (!definition) continue;
    let data = parseIntegrationData(connection.dataJson);
    let connectionStatus = connection.status as IntegrationHealthStatus;
    const configuration = runtime[definition.key];
    if (connectionStatus === "Connected" && configuration && !configuration.ready) {
      connectionStatus = "Reauthorization Required";
      const priorAdapterState = data.adapterState || "Unknown";
      data = { ...data, cause: configuration.detail, impact: "Automated provider data exchange is disabled until production configuration and reconciliation pass again", failureStartedAt: String(data.failureStartedAt || nowIso), lastCheckedAt: nowIso, adapterState: "Connection Required" };
      await db.update(commandRecords).set({ status: connectionStatus, meta: `${connectionStatus} · Runtime Configuration Missing`, dataJson: JSON.stringify(data), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connection.id)));
      await integrationEvent(db, definition, context, "Runtime Configuration Check", connection.status, connectionStatus, configuration.detail, { priorAdapterState });
    }
    if (["Failed", "Degraded"].includes(connectionStatus) && String(data.nextRetryAt || "") && new Date(String(data.nextRetryAt)) <= now) {
      const retry = await attemptAutomatedRetry(definition);
      if (retry.attempted) {
        const attempts = Number(data.retryAttempts || 0) + 1;
        const backoffMinutes = [5, 15, 60, 240, 1440][Math.min(attempts, 5) - 1];
        const nextStatus = validIntegrationStatus(retry.status) ? retry.status : connectionStatus;
        data = { ...data, retryAttempts: attempts, lastRetryAt: nowIso, nextRetryAt: nextStatus === "Connected" ? "" : addHours(nowIso, backoffMinutes / 60), adapterState: "Connected", cause: retry.cause || data.cause, impact: retry.impact || data.impact, lastCheckedAt: nowIso, lastSuccessfulAt: nextStatus === "Connected" ? nowIso : data.lastSuccessfulAt || "" };
        await db.update(commandRecords).set({ status: nextStatus, meta: `${nextStatus} · Automated Safe Retry ${attempts}`, dataJson: JSON.stringify(data), updatedAt: nowIso }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connection.id)));
        await integrationEvent(db, definition, context, "Automated Safe Retry", connectionStatus, nextStatus, retry.cause || `Provider adapter retry ${attempts} completed`, { retryAttempt: attempts, nextRetryAt: data.nextRetryAt });
        connectionStatus = nextStatus;
      }
    }
    if (["Failed", "Degraded", "Reauthorization Required", "Not Configured"].includes(connectionStatus)) await syncIntegrationWork(db, definition, connectionStatus, data, nowIso);
    const failureAt = String(data.failureStartedAt || connection.updatedAt || "");
    if (["Failed", "Reauthorization Required"].includes(connectionStatus) && failureAt && now.getTime() - new Date(failureAt.endsWith("Z") ? failureAt : `${failureAt}Z`).getTime() >= 24 * 3_600_000) {
      await assignLeadershipWork(db, connection.id, `24-Hour Integration Escalation · ${definition.name}`, `${data.cause || connectionStatus}. ${data.impact || "Operational impact requires review."}`, "Critical", nowIso);
    }
    if (options.nightly) {
      const date = nowIso.slice(0, 10);
      const id = `INTEGRATION-SNAPSHOT-${date}-${definition.key}`;
      const snapshot = { integrationKey: definition.key, status: connectionStatus, cause: data.cause || "", impact: data.impact || "", lastCheckedAt: data.lastCheckedAt || "", lastSuccessfulAt: data.lastSuccessfulAt || "", reconciliation: data.reconciliation || {}, capturedAt: nowIso };
      await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_EVENT_TYPE, title: `${definition.name} · Daily Health Snapshot`, owner: "Integration Health Engine", due: date, status: connectionStatus, meta: `Permanent Daily Snapshot · ${connectionStatus}`, recordDate: date, recordTime: nowIso.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(snapshot), updatedAt: nowIso }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { status: connectionStatus, meta: `Permanent Daily Snapshot · ${connectionStatus}`, dataJson: JSON.stringify(snapshot), updatedAt: nowIso } });
    }
  }
  return { reconciled: trackedConnections.length, at: nowIso };
}

async function buildResponse(db: Db, context: IntegrationContext) {
  await ensureMicrosoftSubscriptionSchema();
  const [automation, runtime, delivery, microsoftWebhook, handoffs] = await Promise.all([loadScheduledOperationSnapshot(), integrationRuntimeSnapshot(), loadDeliveryControlSnapshot(), loadMicrosoftWebhookHealthSnapshot(), loadDomainOutboxSnapshot()]);
  const evidence = await collectSystemHealthRuntimeEvidence(db, { automation, runtime, actor: { authenticated: true, email: context.email, name: context.name } });
  const application = applicationReadinessSnapshot({ evidenceBySection: evidence.evidenceBySection });
  const workflowAudit = systemAuditSnapshot({ openAiConfigured: Boolean(runtime["openai-command-ai"]?.ready), automationOverall: automation.overall, evidenceByWorkflow: evidence.evidenceByWorkflow, evidenceByIntelligence: evidence.evidenceByIntelligence });
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), inArray(commandRecords.recordType, [INTEGRATION_RECORD_TYPE, INTEGRATION_EVENT_TYPE, INTEGRATION_CONFLICT_TYPE, INTEGRATION_MAINTENANCE_TYPE, INTEGRATION_REPLAY_TYPE, INTEGRATION_INCIDENT_TYPE]))).orderBy(desc(commandRecords.updatedAt));
  const records = rows.map((row) => ({ id: row.id, type: row.recordType, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, createdAt: row.createdAt, updatedAt: row.updatedAt, data: parseIntegrationData(row.dataJson) }));
  const connections = MEFFORD_INTEGRATIONS.map((definition) => {
    const record = records.find((item) => item.id === connectionId(definition.key));
    const configuration = runtime[definition.key];
    const recordedStatus = record?.status || "Not Configured";
    const status = configuration?.activationState === "Not Implemented"
      ? "Not Configured"
      : recordedStatus === "Connected" && configuration && !configuration.ready ? "Reauthorization Required" : recordedStatus;
    return { ...definition, ...record, status, recordedStatus, runtime: configuration, data: record?.data || {} };
  }).filter((connection) => visibleConnection(context, connection));
  const visibleKeys = new Set(connections.map((item) => item.key));
  const visibleRecords = records.filter((record) => record.type !== INTEGRATION_RECORD_TYPE && (!record.data.integrationKey || visibleKeys.has(String(record.data.integrationKey))));
  const openIncidents = visibleRecords.filter((record) => record.type === INTEGRATION_INCIDENT_TYPE && record.status === "Open");
  const criticalIncident = openIncidents.some((record) => record.data.critical === true);
  const connectionColor = integrationSystemColor(connections.map((item) => item.status as IntegrationHealthStatus), criticalIncident);
  const evidenceFailed = application.overall === "Failed" || workflowAudit.overall === "Failed";
  const evidenceUnverified = application.overall !== "Verified" || workflowAudit.overall !== "Verified";
  const systemColor = automation.overall === "Failed" || evidenceFailed
    ? "Red"
    : (automation.overall === "Late" || evidenceUnverified) && connectionColor === "Green"
      ? "Yellow"
      : connectionColor;
  const counts = Object.fromEntries(INTEGRATION_HEALTH_STATUSES.map((status) => [status, connections.filter((item) => item.status === status).length]));
  return {
    actor: { name: context.name, email: context.email, role: context.role, canConfigure: context.canConfigure, canApproveFinancial: context.canApproveFinancial, canReviewFinancial: context.canReviewFinancial },
    system: { color: systemColor, counts, visibleConnections: connections.length, openConflicts: visibleRecords.filter((item) => item.type === INTEGRATION_CONFLICT_TYPE && item.status === "Quarantined").length, openIncidents: openIncidents.length, lastReconciledAt: new Date().toISOString() },
    application,
    audit: workflowAudit,
    automation,
    handoffs,
    delivery,
    microsoftWebhook,
    platformEvidence: evidence.platform,
    connections,
    events: visibleRecords.filter((item) => item.type === INTEGRATION_EVENT_TYPE).slice(0, 120),
    conflicts: visibleRecords.filter((item) => item.type === INTEGRATION_CONFLICT_TYPE),
    maintenance: visibleRecords.filter((item) => item.type === INTEGRATION_MAINTENANCE_TYPE),
    replays: visibleRecords.filter((item) => item.type === INTEGRATION_REPLAY_TYPE),
    incidents: visibleRecords.filter((item) => item.type === INTEGRATION_INCIDENT_TYPE),
    policy: { safeguards: INTEGRATION_SAFEGUARDS, checklist: INTEGRATION_GO_LIVE_CHECKLIST, statuses: INTEGRATION_HEALTH_STATUSES, secretFolder: "SharePoint / Mefford Contracting / Restricted / Integration Recovery Records", reporting: "Live dashboard · immediate critical alerts · daily exception-only Owner/Admin/IT digest", retention: "Permanent connection, failure, retry, conflict, replay, reconciliation and configuration audit history" },
  };
}

async function integrationContext(actor: ReturnType<typeof getCommandActor>) {
  const db = await commandDb();
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0];
  if (member?.isActive === false) return { error: "Company Access Is Inactive", status: 403 } as const;
  const accessLevel = member?.companyAccessLevel || actor.accessLevel;
  const designations = parseStrings(member?.designationsJson);
  const isOwner = accessLevel === "Company Owner";
  const isAdmin = accessLevel === "Administrator";
  const isIT = designations.includes("IT Administrator");
  const isAccounting = designations.some((item) => ["Accountant", "Financial Administrator", "Accounting"].includes(item));
  const isPM = designations.includes("Project Manager");
  const isMarketing = designations.includes("Marketing");
  const role: IntegrationRole | null = isOwner || isAdmin ? "Owner/Admin" : isIT ? "IT Administrator" : isAccounting ? "Accounting" : isPM ? "Project Manager" : isMarketing ? "Marketing" : null;
  if (!role) return { error: "IT & Integrations Requires Owner Administrator IT Accounting Marketing Or Project Manager Access", status: 403 } as const;
  const name = member?.displayName || actor.name;
  const assigned = isPM ? (await db.select({ number: projects.number }).from(projects).where(eq(projects.projectManager, name))).map((item) => item.number) : [];
  return { name, email: actor.email, accessLevel, designations, role, canConfigure: isOwner || isAdmin || isIT, canApproveFinancial: isOwner, canReviewFinancial: isOwner || isAccounting, assignedProjectIds: assigned } satisfies IntegrationContext;
}

async function ensureIntegrationRecords(db: Db, context: Pick<IntegrationContext, "name" | "email">) {
  const existing = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.recordType, INTEGRATION_RECORD_TYPE)));
  const ids = new Set(existing.map((item) => item.id));
  const now = new Date().toISOString();
  for (const definition of MEFFORD_INTEGRATIONS) {
    const id = connectionId(definition.key);
    if (ids.has(id)) continue;
    const data = { integrationKey: definition.key, category: definition.category, sensitive: definition.sensitive, primaryOwnerName: "", primaryOwnerEmail: "", backupOwnerName: "", backupOwnerEmail: "", reconnectors: [], providerStatusUrl: definition.providerStatusUrl, oneDriveFolder: "SharePoint / Mefford Contracting / Restricted / Integration Recovery Records", checklist: [], environment: "Test", productionSeparated: true, purpose: definition.purpose, cause: "Provider authorization and production validation have not been completed", impact: "No automated data exchange is active", affectedProjectIds: [], lastCheckedAt: "", lastSuccessfulAt: "", reconciliation: {}, retryAttempts: 0, nextRetryAt: "", adapterState: "Connection Required" };
    await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_RECORD_TYPE, title: definition.name, owner: definition.defaultOwnerRole, due: now.slice(0, 10), status: "Not Configured", meta: `Not Configured · ${definition.defaultOwnerRole} Ownership Required`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now }).onConflictDoNothing();
    await audit(db, id, context, "Integration Register", "None", "Not Configured", `${definition.name} added to the permanent Mefford integration inventory`);
  }
  const platform = await integrationRow(db, "command-center-platform");
  if (platform) {
    const current = parseIntegrationData(platform.dataJson);
    await db.update(commandRecords).set({
      status: "Connected",
      meta: "Connected · Application And Database Responding",
      dataJson: JSON.stringify({ ...current, cause: "", impact: "No Known Operational Impact", lastCheckedAt: now, lastSuccessfulAt: now, adapterState: "Native Platform Health" }),
      updatedAt: now,
    }).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, platform.id)));
  }
}

async function syncIntegrationWork(db: Db, definition: IntegrationDefinition, status: IntegrationHealthStatus, data: Record<string, unknown>, now: string) {
  const sourceRecordId = connectionId(definition.key);
  if (status === "Connected" || status === "Maintenance") {
    await closeResolvedIntegrationWork(db, sourceRecordId, new Set(), `The current integration state is ${status}.`);
    return;
  }
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  const primaryEmail = normalizeEmail(data.primaryOwnerEmail);
  const backupEmail = normalizeEmail(data.backupOwnerEmail);
  const direct = members.filter((member) => [primaryEmail, backupEmail].includes(member.email));
  const fallback = members.filter((member) => ["Company Owner", "Administrator"].includes(member.companyAccessLevel)).sort((left, right) => left.email.localeCompare(right.email));
  const recipients = direct.length ? direct : status === "Not Configured" ? fallback.slice(0, 1) : fallback;
  const priority = ["Failed", "Reauthorization Required"].includes(status) ? "Critical" : "High";
  const dueAt = ["Failed", "Reauthorization Required"].includes(status) ? now : addHours(now, 24);
  const activeKeys = new Set(recipients.map((member) => `integration:${definition.key}:${status}:${member.email}`));
  for (const member of recipients) await upsertWorkItem(db, { dedupeKey: `integration:${definition.key}:${status}:${member.email}`, projectId: INTEGRATION_COMPANY_ID, recipientName: member.displayName, recipientEmail: member.email, kind: "Integration Health", title: `${definition.name} · ${status}`, message: `${data.cause || "Connection action is required"}. ${data.impact || "Review the IT & Integrations Center."}`, priority, sourceType: "Integration Health", sourceRecordId, actionTarget: "IT & Integrations", dueAt, createdBy: "Integration Health Engine" });
  await closeResolvedIntegrationWork(db, sourceRecordId, activeKeys, `The integration now reports ${status}; older integration-health states were superseded.`);
}

export async function closeResolvedIntegrationWork(
  db: Db,
  sourceRecordId: string,
  activeKeys: Set<string>,
  detail: string,
) {
  const current = await db
    .select({ id: commandWorkItems.id, dedupeKey: commandWorkItems.dedupeKey })
    .from(commandWorkItems)
    .where(and(
      eq(commandWorkItems.sourceType, "Integration Health"),
      eq(commandWorkItems.sourceRecordId, sourceRecordId),
      inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
    ));
  const resolved = current.filter((item) => !activeKeys.has(item.dedupeKey));
  if (!resolved.length) return;
  const completedAt = new Date().toISOString();
  await db
    .update(commandWorkItems)
    .set({ status: "Completed", completedAt, snoozedUntil: null, updatedAt: completedAt })
    .where(inArray(commandWorkItems.id, resolved.map((item) => item.id)));
  await db.insert(workItemAudits).values(resolved.map((item) => ({
    workItemId: item.id,
    action: "Automatically Resolved",
    actorName: "Integration Health Engine",
    actorEmail: "system@meffcon.com",
    detail,
  })));
}

async function notifyAllActiveMembers(db: Db, sourceId: string, title: string, message: string, now: string) {
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  for (const member of members) await upsertWorkItem(db, { dedupeKey: `integration-maintenance:${sourceId}:${member.email}`, projectId: INTEGRATION_COMPANY_ID, recipientName: member.displayName, recipientEmail: member.email, kind: "System Maintenance", title, message, priority: "High", sourceType: "Integration Maintenance", sourceRecordId: sourceId, actionTarget: "IT & Integrations", dueAt: now, createdBy: "Integration Health Engine" });
}

async function assignLeadershipWork(db: Db, sourceId: string, title: string, message: string, priority: "High" | "Critical", now: string) {
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  for (const member of members.filter((item) => ["Company Owner", "Administrator"].includes(item.companyAccessLevel))) await upsertWorkItem(db, { dedupeKey: `integration-leadership:${sourceId}:${member.email}`, projectId: INTEGRATION_COMPANY_ID, recipientName: member.displayName, recipientEmail: member.email, kind: "Integration Health", title, message, priority, sourceType: "Integration Health", sourceRecordId: sourceId, actionTarget: "IT & Integrations", dueAt: now, createdBy: "Integration Health Engine" });
}

async function assignRoleWork(db: Db, sourceId: string, role: "Accounting" | "Company Owner", title: string, message: string, priority: "High" | "Critical", now: string) {
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  const recipients = members.filter((member) => role === "Company Owner" ? member.companyAccessLevel === "Company Owner" : parseStrings(member.designationsJson).some((item) => ["Accountant", "Financial Administrator", "Accounting"].includes(item)));
  for (const member of recipients) await upsertWorkItem(db, { dedupeKey: `integration-role:${sourceId}:${role}:${member.email}`, projectId: INTEGRATION_COMPANY_ID, recipientName: member.displayName, recipientEmail: member.email, kind: "Integration Approval", title, message, priority, sourceType: "Integration Replay", sourceRecordId: sourceId, actionTarget: "IT & Integrations", dueAt: now, createdBy: "Integration Health Engine" });
}

async function integrationEvent(db: Db, definition: IntegrationDefinition, context: Pick<IntegrationContext, "name" | "email">, action: string, oldValue: string, newValue: string, reason: string, detail: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const id = `INTEGRATION-EVENT-${crypto.randomUUID()}`;
  await db.insert(commandRecords).values({ projectId: INTEGRATION_COMPANY_ID, id, recordType: INTEGRATION_EVENT_TYPE, title: `${definition.name} · ${action}`, owner: context.name, due: now.slice(0, 10), status: newValue, meta: `${oldValue} → ${newValue} · ${reason}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify({ integrationKey: definition.key, action, oldValue, newValue, reason, ...detail, actorName: context.name, actorEmail: context.email, at: now }), updatedAt: now });
  await audit(db, connectionId(definition.key), context, action, oldValue, newValue, reason);
}

async function attemptAutomatedRetry(definition: IntegrationDefinition) {
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const url = safeHttpsUrl(binding.INTEGRATION_RETRY_ADAPTER_URL);
  const token = safeIntegrationText(binding.INTEGRATION_RETRY_ADAPTER_TOKEN, 1000);
  if (!url) return { attempted: false, status: "", cause: "", impact: "" };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: "safe-retry", integrationKey: definition.key, safeguards: { idempotent: true, preventDuplicates: true, postFinancials: false, pay: false, sendInvoice: false, approvePayroll: false } }),
    });
    const result = await response.json().catch(() => ({})) as { status?: string; cause?: string; impact?: string };
    return { attempted: true, status: response.ok ? String(result.status || "Connected") : "Failed", cause: safeIntegrationText(result.cause || (response.ok ? "Automated provider retry completed" : `Provider adapter returned ${response.status}`), 600), impact: safeIntegrationText(result.impact, 600) };
  } catch (error) {
    return { attempted: true, status: "Failed", cause: error instanceof Error ? error.message : "Provider adapter retry failed", impact: "The existing safe queue remains active; no records were overwritten or posted" };
  }
}

async function audit(db: Db, recordId: string, context: Pick<IntegrationContext, "name" | "email">, fieldName: string, oldValue: string, newValue: string, reason: string) {
  await db.insert(recordAudits).values({ projectId: INTEGRATION_COMPANY_ID, recordId, fieldName, oldValue, newValue, reason, actorName: context.name, actorEmail: context.email, summary: `${fieldName}: ${oldValue} → ${newValue}` });
}

function visibleConnection(context: IntegrationContext, connection: { category: string; sensitive: boolean; projectImpact: boolean; status?: string; data: Record<string, unknown> }) {
  if (["Owner/Admin", "IT Administrator"].includes(context.role)) return true;
  if (context.role === "Marketing") return connection.category === "Marketing";
  if (context.role === "Accounting") return connection.sensitive || connection.status === "Failed";
  const affected = normalizeStrings(connection.data.affectedProjectIds);
  return connection.projectImpact && ["Failed", "Degraded", "Reauthorization Required"].includes(String(connection.status || "")) && affected.some((id) => context.assignedProjectIds.includes(id));
}

function reconciliationCounts(input: IntegrationPayload) {
  return { sourceCount: whole(input.sourceCount), importedCount: whole(input.importedCount), skippedCount: whole(input.skippedCount), failedCount: whole(input.failedCount), duplicatesPrevented: whole(input.duplicatesPrevented) };
}

function whole(value: unknown) { const number = Number(value || 0); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; }
function maskedSamples(value: unknown) { return safeIntegrationText(value, 500).split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 10).map((item) => item.length > 8 ? `${item.slice(0, 4)}…${item.slice(-3)}` : item).join(", "); }
function normalizeStrings(value: unknown) { return Array.isArray(value) ? [...new Set(value.map((item) => safeIntegrationText(item, 180)).filter(Boolean))] : []; }
function parseStrings(value: unknown) { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return normalizeStrings(parsed); } catch { return []; } }
function normalizeEmail(value: unknown) { const email = safeIntegrationText(value, 180).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""; }
function safeHttpsUrl(value: unknown) { const text = safeIntegrationText(value, 500); try { const url = new URL(text); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function connectionId(key: string) { return `INTEGRATION-${key.toUpperCase()}`; }
function easternWindowInstant(date: string, time: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null; const month = Number(date.slice(5, 7)); const offset = month >= 3 && month <= 11 ? "-04:00" : "-05:00"; const parsed = new Date(`${date}T${time}:00${offset}`); return Number.isNaN(parsed.getTime()) ? null : parsed; }

async function integrationRow(db: Db, key: string) { return (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, connectionId(key)))).limit(1))[0]; }
async function recordById(db: Db, id: unknown, type: string) { const value = safeIntegrationText(id, 160); if (!value) return undefined; return (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, INTEGRATION_COMPANY_ID), eq(commandRecords.id, value), eq(commandRecords.recordType, type))).limit(1))[0]; }
async function commandDb() { const { getDb } = await import("../../../db"); return getDb(); }

function badRequest(error: string) { return Response.json({ error }, { status: 400 }); }
function forbidden(error: string) { return Response.json({ error }, { status: 403 }); }
function notFound(error: string) { return Response.json({ error }, { status: 404 }); }
function integrationError(error: unknown) { console.error("IT & Integrations Error", error); return Response.json({ error: error instanceof Error ? error.message : "IT & Integrations Is Temporarily Unavailable" }, { status: 500 }); }
