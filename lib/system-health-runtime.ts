import { desc } from "drizzle-orm";
import {
  assistantAudits,
  commandRecords,
  notificationDeliveryEvents,
} from "../db/schema";
import { SECTION_READINESS } from "./section-readiness";
import { WORKFLOW_AUDIT } from "./system-audit";
import { workflowReleaseControl } from "./workflow-release-controls";
import type { SystemHealthEvidenceCheck } from "./system-health-evidence.js";
import { queueAgeMinutes } from "./delivery-control";

type Db = ReturnType<(typeof import("../db"))["getDb"]>;
type RuntimeSnapshot = Record<string, { ready?: boolean; detail?: string }>;
type AutomationJob = {
  name: string;
  label: string;
  status: string;
  lastRunAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
  observedRuns24h?: number;
  expectedRuns24h?: number;
  stuckRuns?: number;
  oldestStuckAgeMinutes?: number;
  error: string;
};

export type SystemHealthRuntimeEvidence = {
  evidenceBySection: Record<string, SystemHealthEvidenceCheck[]>;
  evidenceByWorkflow: Record<string, SystemHealthEvidenceCheck[]>;
  evidenceByIntelligence: Record<string, SystemHealthEvidenceCheck[]>;
  platform: SystemHealthEvidenceCheck[];
};

const HEALTH_PROJECT_ID = "MEFFORD-SYSTEM-HEALTH";
const HEALTH_RECORD_TYPE = "System Health Runtime Probe";
const ACTIVITY_WINDOW_DAYS = 120;

const SECTION_JOB_MAP: Record<string, string[]> = {
  "my-work": ["operational-notice-delivery", "morning-work-digests"],
  "project-health": ["project-health-nightly"],
  "quarterly-review": ["meeting-rules"],
  "weekly-l10": ["meeting-rules"],
  "customer-voice": ["customer-survey-milestones"],
  "assets-fleet": ["asset-readiness"],
  "performance-reviews": ["quarterly-performance-reviews"],
  "it-integrations": ["integration-health"],
  "project-meetings": ["meeting-rules"],
  closeout: ["closeout-reconciliation"],
};

const WORKFLOW_JOB_MAP: Record<string, string[]> = {
  "schedule-to-quality": ["project-health-nightly"],
  "field-to-performance": ["project-health-nightly", "quarterly-performance-reviews"],
  "customer-voice": ["customer-survey-milestones"],
  "asset-accounting": ["asset-readiness"],
  "closeout-payment": ["closeout-reconciliation"],
  "meeting-accountability": ["meeting-rules"],
  "integration-accountability": ["integration-health"],
};

const SECTION_ACTIVITY_ALIASES: Record<string, string[]> = {
  "company-dashboard": ["Project", "Dashboard"],
  "my-work": ["Morning Work Digest", "Work Item"],
  "project-health": ["Project Health"],
  "quarterly-review": ["Quarterly", "Meeting"],
  "weekly-l10": ["L10", "Meeting"],
  "sales-dashboard": ["Sales Opportunity", "Sales Goal"],
  "sales-contacts": ["Sales Contact", "Business Card"],
  "sales-funnel": ["Sales Opportunity"],
  "sales-design": ["Design Package"],
  estimating: ["Estimate"],
  "bid-management": ["Bid Package", "Quote"],
  marketing: ["Marketing"],
  "customer-voice": ["Customer Survey"],
  "sales-goals": ["Sales Goal"],
  "employee-portal": ["Employee"],
  "employee-onboarding": ["Employee Onboarding"],
  "accounting-command": ["Accounting", "AP Invoice", "Owner Billing"],
  "chart-of-accounts": ["Chart Of Accounts", "Account"],
  "general-ledger": ["Journal Entry", "General Ledger"],
  "accounts-payable": ["AP Invoice", "Payment Batch"],
  "company-lien-waivers": ["Lien Waiver"],
  "owner-billing": ["Owner Billing"],
  "cash-management": ["Cash", "Wire", "Payment Batch"],
  "payroll-reports": ["Payroll Report"],
  "wip-close": ["WIP", "Close Period"],
  "financial-reports": ["Financial Report"],
  "vendor-management": ["Vendor"],
  "assets-fleet": ["Asset"],
  "review-center": ["Template Review", "Legal Review"],
  "performance-reviews": ["Performance Review"],
  "it-integrations": ["Integration"],
  "project-overview": ["Project"],
  "owner-contract": ["Contract"],
  subcontracts: ["Subcontract"],
  "change-orders": ["Change Order"],
  "purchase-orders": ["Purchase Order"],
  "project-meetings": ["Meeting"],
  "daily-logs": ["Daily Log"],
  safety: ["Safety", "Toolbox Talk", "Incident"],
  rfis: ["RFI"],
  submittals: ["Submittal"],
  schedule: ["Schedule"],
  selections: ["Selection"],
  budget: ["Budget", "Job Cost"],
  procurement: ["Procurement", "Bid Package"],
  quality: ["Quality"],
  "design-drawings": ["Design", "Drawing"],
  "project-files": ["Drawing", "Document", "File"],
  closeout: ["Closeout", "Warranty"],
  "project-lien-waivers": ["Lien Waiver"],
  "team-access": ["Team", "Access", "Employee"],
};

export async function collectSystemHealthRuntimeEvidence(
  db: Db,
  input: {
    automation: { jobs: AutomationJob[]; trigger?: { status: string; expectedRuns24h: number; observedRuns24h: number; lastPlatformTriggerAt: string; lastFallbackTriggerAt: string; source: string; error: string } };
    runtime: RuntimeSnapshot;
    actor: { authenticated: boolean; email: string; name: string };
    now?: Date;
  },
): Promise<SystemHealthRuntimeEvidence> {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const expiry = new Date(now.getTime() + 15 * 60_000).toISOString();
  const platform: SystemHealthEvidenceCheck[] = [];

  const schedulerTrigger = input.automation.trigger;
  platform.push(check(
    "scheduler-trigger",
    "Independent Platform Scheduler",
    schedulerTrigger?.status === "Healthy" ? "Verified" : schedulerTrigger?.status === "Failed" ? "Failed" : schedulerTrigger?.status === "Late" ? "Degraded" : "Unknown",
    true,
    schedulerTrigger?.lastPlatformTriggerAt || "",
    "",
    schedulerTrigger?.source || "scheduler_trigger_receipts",
    schedulerTrigger ? `${schedulerTrigger.observedRuns24h}/${schedulerTrigger.expectedRuns24h} expected platform triggers observed. ${schedulerTrigger.error || "The authenticated-session heartbeat is fallback evidence only."}` : "No independent platform-trigger snapshot was returned.",
  ));

  let recentRecords: Array<{ projectId: string; id: string; recordType: string; status: string; updatedAt: string }> = [];
  try {
    recentRecords = await db.select({ projectId: commandRecords.projectId, id: commandRecords.id, recordType: commandRecords.recordType, status: commandRecords.status, updatedAt: commandRecords.updatedAt }).from(commandRecords).orderBy(desc(commandRecords.updatedAt)).limit(1_500);
    await db.insert(commandRecords).values({
      projectId: HEALTH_PROJECT_ID,
      id: "SYSTEM-HEALTH-D1-READ-WRITE",
      recordType: HEALTH_RECORD_TYPE,
      title: "D1 Read And Write Probe",
      owner: "System Health Probe",
      due: expiry.slice(0, 10),
      status: "Verified",
      meta: `Independent D1 read/write completed · Expires ${expiry}`,
      recordDate: nowIso.slice(0, 10),
      recordTime: nowIso.slice(11, 16),
      dateLocked: true,
      dataJson: JSON.stringify({ observedAt: nowIso, expiresAt: expiry, rowSampleCount: recentRecords.length, source: "Server-executed D1 read and evidence upsert" }),
      updatedAt: nowIso,
    }).onConflictDoUpdate({
      target: [commandRecords.projectId, commandRecords.id],
      set: { due: expiry.slice(0, 10), status: "Verified", meta: `Independent D1 read/write completed · Expires ${expiry}`, recordDate: nowIso.slice(0, 10), recordTime: nowIso.slice(11, 16), dataJson: JSON.stringify({ observedAt: nowIso, expiresAt: expiry, rowSampleCount: recentRecords.length, source: "Server-executed D1 read and evidence upsert" }), updatedAt: nowIso },
    });
    platform.push(check("database", "D1 Read And Write", "Verified", true, nowIso, expiry, "Server-Executed D1 Probe", `${recentRecords.length} recent operational records were read and the durable evidence record was written.`));
  } catch (error) {
    platform.push(check("database", "D1 Read And Write", "Failed", true, nowIso, "", "Server-Executed D1 Probe", safeError(error)));
  }

  platform.push(check(
    "authenticated-request",
    "Current Request Authentication",
    input.actor.authenticated && Boolean(input.actor.email) ? "Verified" : "Failed",
    true,
    nowIso,
    expiry,
    "Server Authentication Boundary",
    input.actor.authenticated && input.actor.email ? `Authenticated request verified for ${input.actor.email}. This does not substitute for the missing full role matrix test.` : "The System Health request was not authenticated.",
  ));

  const objectStorage = await probeObjectStorage(nowIso, expiry);
  platform.push(objectStorage);

  const deliveries = await deliveryEvidence(db, input.runtime, nowIso);
  const activityCutoff = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const evidenceBySection: Record<string, SystemHealthEvidenceCheck[]> = {};
  for (const section of SECTION_READINESS) {
    const sectionEvidence: SystemHealthEvidenceCheck[] = [
      copyCheck(platform.find((item) => item.key === "database")!, "persistence", "Persistent Data Probe"),
      activityEvidence(section.id, section.name, recentRecords, activityCutoff),
      copyCheck(platform.find((item) => item.key === "authenticated-request")!, "current-authentication", "Current Request Authentication", false),
    ];
    if (["project-files", "design-drawings", "safety", "closeout", "owner-contract", "accounts-payable", "assets-fleet"].includes(section.id)) {
      sectionEvidence.push(copyCheck(objectStorage, "object-storage", "Private File-Store Probe"));
    }
    for (const jobName of SECTION_JOB_MAP[section.id] || []) {
      const job = input.automation.jobs.find((item) => item.name === jobName);
      sectionEvidence.push(jobEvidence(jobName, job));
    }
    if (section.id === "my-work") sectionEvidence.push(deliveries);
    evidenceBySection[section.id] = sectionEvidence;
  }

  const evidenceByWorkflow: Record<string, SystemHealthEvidenceCheck[]> = {};
  for (const workflow of WORKFLOW_AUDIT) {
    const releaseControl = workflowReleaseControl(workflow.id);
    const workflowEvidence: SystemHealthEvidenceCheck[] = [
      releaseControlEvidence(workflow.id, releaseControl),
      authorityControlEvidence(workflow.id, releaseControl),
      await reconciledHandoffEvidence(workflow.id, releaseControl, now),
      copyCheck(platform.find((item) => item.key === "authenticated-request")!, "current-authentication", "Current Request Authentication", false),
      workflowActivityEvidence(workflow.id, workflow.systems, recentRecords, activityCutoff),
    ];
    for (const jobName of WORKFLOW_JOB_MAP[workflow.id] || []) {
      const job = input.automation.jobs.find((item) => item.name === jobName);
      workflowEvidence.push(jobEvidence(jobName, job));
    }
    if (["meeting-accountability", "customer-voice", "quotes-to-proposal"].includes(workflow.id)) workflowEvidence.push({ ...deliveries, key: "external-delivery", required: false });
    evidenceByWorkflow[workflow.id] = workflowEvidence;
  }

  const assistantRows = await safeAssistantEvidence(db);
  const evidenceByIntelligence: Record<string, SystemHealthEvidenceCheck[]> = {
    "drawing-ocr": [intelligenceActivity("Drawing OCR", ["Drawing Intelligence", "Drawing"], recentRecords, activityCutoff)],
    "business-card-ocr": [intelligenceActivity("Business Card OCR", ["Business Card", "Sales Contact"], recentRecords, activityCutoff)],
    "quote-ocr": [intelligenceActivity("Quote OCR", ["Quote", "Bid Package"], recentRecords, activityCutoff)],
    "invoice-ocr": [intelligenceActivity("Invoice OCR", ["AP Invoice"], recentRecords, activityCutoff)],
    "mobile-ocr": [intelligenceActivity("Mobile OCR", ["Mobile", "OCR"], recentRecords, activityCutoff)],
    "closeout-ocr": [intelligenceActivity("Closeout OCR", ["Closeout", "Permit"], recentRecords, activityCutoff)],
    "asset-ocr": [intelligenceActivity("Asset OCR", ["Asset"], recentRecords, activityCutoff)],
    "native-forms": [intelligenceActivity("Native Forms", ["Contract", "Purchase Order", "Lien Waiver", "Employee Onboarding"], recentRecords, activityCutoff)],
    "assistant-ai": [assistantActivity("Assistant Request", assistantRows, activityCutoff)],
    "schedule-ai": [intelligenceActivity("Schedule Intelligence", ["Schedule Intelligence"], recentRecords, activityCutoff)],
    "performance-ai": [assistantActivity("Performance Narrative", assistantRows.filter((row) => /performance/i.test(row.activeTarget)), activityCutoff)],
  };

  return { evidenceBySection, evidenceByWorkflow, evidenceByIntelligence, platform };
}

function releaseControlEvidence(workflowId: string, control?: ReturnType<typeof workflowReleaseControl>): SystemHealthEvidenceCheck {
  if (!control?.releaseTests.length) return check("release-test", "Current Release End-To-End Test", "Unknown", true, "", "", "Release Verification", `No mandatory release-test mapping exists for ${workflowId}.`);
  return check("release-test", "Current Release End-To-End Test", "Verified", true, "", "", "Mandatory Production Build Gate", `${control.releaseTests.join(", ")} are executed by the fail-closed production build for this exact source artifact.`);
}

function authorityControlEvidence(workflowId: string, control?: ReturnType<typeof workflowReleaseControl>): SystemHealthEvidenceCheck {
  if (!control?.authorityEvidence.length) return check("authorization", "Human Authority Boundary Test", "Unknown", true, "", "", "Executable Permission Test", `No authority-boundary evidence is registered for ${workflowId}.`);
  return check("authorization", "Human Authority Boundary Test", "Verified", true, "", "", "Mandatory Production Build Gate", control.authorityEvidence.join(" · "));
}

async function reconciledHandoffEvidence(workflowId: string, control: ReturnType<typeof workflowReleaseControl>, now: Date): Promise<SystemHealthEvidenceCheck> {
  if (!control?.reconciledEventTypes.length) return check("runtime-handoff", "Upstream-To-Downstream Reconciliation", "Unknown", true, "", "", "Production Handoff Ledger", `No reconciled domain event is registered for ${workflowId}; source activity cannot substitute for a completed handoff.`);
  try {
    const { env } = await import("cloudflare:workers");
    const placeholders = control.reconciledEventTypes.map(() => "?").join(",");
    const row = await env.DB.prepare(`SELECT e.id, e.event_type, e.completed_at,
      sum(CASE WHEN c.mandatory = 1 THEN 1 ELSE 0 END) AS mandatory_count,
      sum(CASE WHEN c.mandatory = 1 AND c.status = 'Succeeded' THEN 1 ELSE 0 END) AS succeeded_count
      FROM domain_events e JOIN domain_event_consumers c ON c.event_id = e.id
      WHERE e.event_type IN (${placeholders}) AND e.status = 'Completed'
      GROUP BY e.id ORDER BY e.completed_at DESC LIMIT 1`).bind(...control.reconciledEventTypes).first<{ id: string; event_type: string; completed_at: string; mandatory_count: number; succeeded_count: number }>();
    const complete = row && Number(row.mandatory_count) > 0 && Number(row.mandatory_count) === Number(row.succeeded_count);
    const current = complete && safeDate(row.completed_at) >= new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);
    return check("runtime-handoff", "Upstream-To-Downstream Reconciliation", current ? "Verified" : "Unknown", true, row?.completed_at || "", "", row ? `${row.event_type} · Permanent Consumer Ledger` : "Production Handoff Ledger", row ? `${row.succeeded_count}/${row.mandatory_count} mandatory consumers succeeded. ${current ? "The reconciled handoff is current." : "The last reconciled handoff is outside the evidence window."}` : "No completed reconciled handoff has been observed.");
  } catch (error) {
    return check("runtime-handoff", "Upstream-To-Downstream Reconciliation", "Unknown", true, "", "", "Production Handoff Ledger", `Reconciliation evidence unavailable: ${safeError(error)}`);
  }
}

function activityEvidence(sectionId: string, sectionName: string, rows: Array<{ projectId: string; id: string; recordType: string; status: string; updatedAt: string }>, cutoff: Date): SystemHealthEvidenceCheck {
  const aliases = SECTION_ACTIVITY_ALIASES[sectionId] || [sectionName];
  const row = rows.find((item) => item.projectId !== HEALTH_PROJECT_ID && aliases.some((alias) => matchesActivity(item.recordType, alias)));
  if (!row) return check("runtime-workflow", "Runtime Workflow Evidence", "Unknown", true, "", "", "Production Activity", "No linked production activity was found. A dedicated functional probe is still required.");
  const observed = safeDate(row.updatedAt);
  const current = observed && observed >= cutoff;
  return check("runtime-workflow", "Runtime Workflow Evidence", current ? "Verified" : "Unknown", true, row.updatedAt, "", `${row.recordType} · ${row.id}`, current ? `Observed production record ${row.status}. This proves activity only; authorization and current-release tests remain separate.` : `Last observed production record is older than ${ACTIVITY_WINDOW_DAYS} days.`);
}

function workflowActivityEvidence(workflowId: string, systems: string[], rows: Array<{ projectId: string; id: string; recordType: string; status: string; updatedAt: string }>, cutoff: Date): SystemHealthEvidenceCheck {
  const matched = rows.filter((row) => row.projectId !== HEALTH_PROJECT_ID && systems.some((system) => matchesActivity(row.recordType, system)));
  const distinctTypes = new Set(matched.map((row) => row.recordType));
  const latest = matched[0];
  const current = latest && safeDate(latest.updatedAt) >= cutoff;
  return check(
    "observed-source-activity",
    "Observed Source Activity",
    current ? "Verified" : "Unknown",
    false,
    latest?.updatedAt || "",
    "",
    latest ? `${workflowId} · command_records` : "Production Activity",
    latest ? `${matched.length} records across ${distinctTypes.size} matching record types were observed. This does not prove the full handoff or replace reconciliation.` : "No matching production source activity was observed.",
  );
}

function intelligenceActivity(label: string, aliases: string[], rows: Array<{ id: string; recordType: string; status: string; updatedAt: string }>, cutoff: Date): SystemHealthEvidenceCheck {
  const row = rows.find((item) => aliases.some((alias) => matchesActivity(item.recordType, alias)));
  const current = row && safeDate(row.updatedAt) >= cutoff;
  return check("runtime-use", "Observed Production Result", current ? "Verified" : "Unknown", true, row?.updatedAt || "", "", label, row ? `${row.recordType} ${row.id} was observed with status ${row.status}.` : "No linked production result was observed.");
}

function assistantActivity(label: string, rows: Array<{ status: string; activeTarget: string; createdAt: string }>, cutoff: Date): SystemHealthEvidenceCheck {
  const row = rows[0];
  const current = row && safeDate(row.createdAt) >= cutoff && row.status === "Succeeded";
  return check("runtime-use", "Observed Production Result", current ? "Verified" : row && row.status !== "Succeeded" ? "Failed" : "Unknown", true, row?.createdAt || "", "", label, row ? `${row.status} assistant evidence for ${row.activeTarget}.` : "No linked production result was observed.");
}

function jobEvidence(jobName: string, job?: AutomationJob): SystemHealthEvidenceCheck {
  if (!job) return check(`automation-${jobName}`, "Scheduled Operation Evidence", "Unknown", true, "", "", "scheduled_operation_runs", `${jobName} is registered but no runtime snapshot was returned.`);
  const status = job.status === "Healthy" ? "Verified" : job.status === "Failed" ? "Failed" : job.status === "Late" ? "Degraded" : "Unknown";
  const coverage = job.expectedRuns24h ? `${job.observedRuns24h || 0}/${job.expectedRuns24h} expected runs observed in 24 hours` : "Run coverage is not available";
  const stuck = job.stuckRuns ? ` · ${job.stuckRuns} stuck run(s), oldest ${Math.round(job.oldestStuckAgeMinutes || 0)} minutes` : "";
  return check(`automation-${jobName}`, job.label || "Scheduled Operation Evidence", status, true, job.lastSuccessAt || job.lastRunAt, "", "scheduled_operation_runs", `${coverage}${stuck}${job.error ? ` · ${job.error}` : ""}`);
}

async function deliveryEvidence(db: Db, runtime: RuntimeSnapshot, nowIso: string): Promise<SystemHealthEvidenceCheck> {
  try {
    const rows = await db.select({ status: notificationDeliveryEvents.status, channel: notificationDeliveryEvents.channel, sentAt: notificationDeliveryEvents.sentAt, acceptedAt: notificationDeliveryEvents.acceptedAt, createdAt: notificationDeliveryEvents.createdAt, providerReceiptId: notificationDeliveryEvents.providerReceiptId, error: notificationDeliveryEvents.error }).from(notificationDeliveryEvents).orderBy(desc(notificationDeliveryEvents.createdAt)).limit(1_500);
    const queued = rows.filter((row) => row.status === "Queued").length;
    const deferred = rows.filter((row) => row.status === "Deferred").length;
    const retrying = rows.filter((row) => row.status === "Retry Scheduled").length;
    const acceptedRows = rows.filter((row) => ["Provider Accepted", "Sent"].includes(row.status));
    const failed = rows.filter((row) => ["Dead Letter", "Failed"].includes(row.status)).length;
    const pendingRows = rows.filter((row) => ["Queued", "Deferred", "Retry Scheduled"].includes(row.status));
    const oldestMinutes = pendingRows.length ? Math.max(...pendingRows.map((row) => queueAgeMinutes(row.createdAt, new Date(nowIso)))) : 0;
    const receipted = acceptedRows.filter((row) => Boolean(row.providerReceiptId)).length;
    const providersReady = Boolean(runtime["operational-email"]?.ready || runtime["web-push-notifications"]?.ready);
    const latestAccepted = acceptedRows[0]?.acceptedAt || acceptedRows[0]?.sentAt || "";
    const status = failed ? "Degraded" : oldestMinutes >= 60 ? "Degraded" : pendingRows.length && !providersReady ? "Not Configured" : pendingRows.length ? "Degraded" : acceptedRows.length && receipted === acceptedRows.length ? "Verified" : acceptedRows.length ? "Degraded" : "Unknown";
    return check("notification-delivery", "External Notification Delivery", status, false, latestAccepted || rows[0]?.createdAt || nowIso, "", "notification_delivery_events", `${queued} queued · ${deferred} deferred · ${retrying} retrying · ${acceptedRows.length} provider accepted (${receipted} receipted) · ${failed} dead letter/failed · oldest pending ${oldestMinutes} minutes. Provider acceptance is not represented as inbox delivery.`);
  } catch (error) {
    return check("notification-delivery", "External Notification Delivery", "Unknown", false, nowIso, "", "notification_delivery_events", safeError(error));
  }
}

async function probeObjectStorage(observedAt: string, expiresAt: string): Promise<SystemHealthEvidenceCheck> {
  try {
    const { env } = await import("cloudflare:workers");
    const bucket = (env as unknown as { BUCKET?: { list: (options: { limit: number }) => Promise<{ objects?: unknown[] }> } }).BUCKET;
    if (!bucket) return check("object-storage", "Private File Store", "Failed", true, observedAt, "", "R2 Runtime Binding", "The required private file-store binding is unavailable.");
    const result = await bucket.list({ limit: 1 });
    return check("object-storage", "Private File Store", "Verified", true, observedAt, expiresAt, "Server-Executed R2 List Probe", `${Array.isArray(result.objects) ? result.objects.length : 0} object metadata rows sampled without exposing file contents.`);
  } catch (error) {
    return check("object-storage", "Private File Store", "Failed", true, observedAt, "", "Server-Executed R2 List Probe", safeError(error));
  }
}

async function safeAssistantEvidence(db: Db) {
  try {
    return await db.select({ status: assistantAudits.status, activeTarget: assistantAudits.activeTarget, createdAt: assistantAudits.createdAt }).from(assistantAudits).orderBy(desc(assistantAudits.createdAt)).limit(200);
  } catch {
    return [];
  }
}

function copyCheck(source: SystemHealthEvidenceCheck, key: string, label: string, required = true): SystemHealthEvidenceCheck {
  return { ...source, key, label, required };
}

function check(key: string, label: string, status: SystemHealthEvidenceCheck["status"], required: boolean, observedAt: string, expiresAt: string, source: string, detail: string): SystemHealthEvidenceCheck {
  return { key, label, status, required, observedAt, expiresAt, source, detail };
}

function matchesActivity(value: string, alias: string) {
  const left = normalize(value);
  const right = normalize(alias);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const rightTokens = right.split(" ").filter((token) => token.length >= 3 && !["company", "project", "center", "control", "command", "management"].includes(token));
  if (!rightTokens.length) return false;
  const matched = rightTokens.filter((token) => left.includes(token)).length;
  return matched >= Math.min(2, rightTokens.length);
}

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeDate(value: string) {
  const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Probe failed")).replace(/[\r\n\t]+/g, " ").slice(0, 600);
}
