import { and, eq, inArray } from "drizzle-orm";
import { commandWorkItems, companyMembers, workItemAudits } from "../db/schema";
import { upsertWorkItem, upsertWorkItems, type WorkItemInput } from "./my-work";
import {
  expectedScheduleSlots,
  planRecoverySlots,
  retryDelayMilliseconds,
  schedulerEvidenceStatus,
  TERMINAL_STATUSES,
} from "./scheduler-reliability.js";

export const SCHEDULED_OPERATION_DEFINITIONS = [
  { name: "template-governance-review", label: "Controlled Template Approval And Expiration Review", cadence: "Daily At 3:30 AM UTC", intervalMinutes: 1_440, offsetMinutes: 210, graceMinutes: 30, recoveryWindowMinutes: 2_880, catchUpLimit: 1, maxDelayMinutes: 1_500, maxRunMinutes: 30 },
  { name: "domain-outbox-reconciliation", label: "Cross-Module Handoff Reconciliation", cadence: "Every 5 Minutes", intervalMinutes: 5, offsetMinutes: 0, graceMinutes: 5, recoveryWindowMinutes: 60, catchUpLimit: 3, maxDelayMinutes: 15, maxRunMinutes: 10 },
  { name: "integration-health", label: "Integration Health Reconciliation", cadence: "Every 5 Minutes", intervalMinutes: 5, offsetMinutes: 0, graceMinutes: 5, recoveryWindowMinutes: 60, catchUpLimit: 3, maxDelayMinutes: 15, maxRunMinutes: 10 },
  { name: "microsoft-directory-sync", label: "Microsoft 365 Directory Reconciliation", cadence: "Hourly At 15 Minutes Past", intervalMinutes: 60, offsetMinutes: 15, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "microsoft-subscription-renewal", label: "Microsoft Graph Subscription Renewal", cadence: "Hourly At 30 Minutes Past", intervalMinutes: 60, offsetMinutes: 30, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "sharepoint-file-reconciliation", label: "SharePoint Folder And File Reconciliation", cadence: "Hourly At 45 Minutes Past", intervalMinutes: 60, offsetMinutes: 45, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 30 },
  { name: "operational-notice-delivery", label: "Operational Notice Delivery", cadence: "Every 5 Minutes", intervalMinutes: 5, offsetMinutes: 0, graceMinutes: 5, recoveryWindowMinutes: 60, catchUpLimit: 3, maxDelayMinutes: 15, maxRunMinutes: 10 },
  { name: "closeout-reconciliation", label: "Closeout Reconciliation", cadence: "Hourly", intervalMinutes: 60, offsetMinutes: 0, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "morning-work-digests", label: "Morning Work Digest Evaluation", cadence: "Hourly", intervalMinutes: 60, offsetMinutes: 0, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "meeting-rules", label: "Meeting Agenda Rules", cadence: "Hourly", intervalMinutes: 60, offsetMinutes: 0, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "customer-survey-milestones", label: "Customer Survey Milestone Evaluation", cadence: "Hourly", intervalMinutes: 60, offsetMinutes: 0, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "asset-readiness", label: "Asset Maintenance And Compliance Alerts", cadence: "Hourly", intervalMinutes: 60, offsetMinutes: 0, graceMinutes: 10, recoveryWindowMinutes: 180, catchUpLimit: 2, maxDelayMinutes: 90, maxRunMinutes: 20 },
  { name: "project-health-nightly", label: "Project Health Nightly Snapshot", cadence: "Daily At 4:00 AM UTC", intervalMinutes: 1_440, offsetMinutes: 240, graceMinutes: 30, recoveryWindowMinutes: 2_880, catchUpLimit: 1, maxDelayMinutes: 1_500, maxRunMinutes: 30 },
  { name: "quarterly-performance-reviews", label: "Quarterly Performance Evidence Snapshot", cadence: "Daily At 5:00 AM UTC", intervalMinutes: 1_440, offsetMinutes: 300, graceMinutes: 30, recoveryWindowMinutes: 2_880, catchUpLimit: 1, maxDelayMinutes: 1_500, maxRunMinutes: 30 },
] as const;

export type ScheduledOperationName = typeof SCHEDULED_OPERATION_DEFINITIONS[number]["name"];
export type SchedulerTriggerSource = "Platform Cron" | "Authenticated Session Fallback";

type OperationResult = {
  id: string;
  jobName: ScheduledOperationName;
  status: "Succeeded" | "Failed" | "Deferred" | "Already Succeeded" | "Already Running";
  attempts: number;
  durationMs: number;
  error: string;
};

type RunRow = {
  id: string;
  job_name: string;
  cadence: string;
  cron: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string;
  status: string;
  attempt_count: number;
  duration_ms: number;
  result_json: string;
  error_message: string;
  created_at: string;
  updated_at: string;
};

type TriggerRow = { id: string; source: string; cron: string; scheduled_at: string; received_at: string };
type GapRow = { id: string; job_name: string; first_missing_at: string; last_missing_at: string; missing_count: number; detected_at: string; status: string };
type DeadLetterRow = { run_id: string; job_name: string; scheduled_at: string; failure_type: string; error_message: string; attempt_count: number; opened_at: string; last_failed_at: string; status: string };

type ScheduledD1Statement = {
  bind: (...values: unknown[]) => ScheduledD1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type ScheduledD1Database = {
  prepare(query: string): ScheduledD1Statement;
  batch(statements: ScheduledD1Statement[]): Promise<unknown>;
};

export const SCHEDULER_INVOCATION_BUDGET_MS = 6_000;
export const SCHEDULER_GROUP_LIMIT = 1;

type SchedulerCheckpointRow = {
  id: string;
  source: string;
  scheduled_at: string;
  group_name: string;
  group_index: number;
  status: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  error_message: string;
  next_group_index: number;
};

export async function ensureScheduledOperationSchema(db: ScheduledD1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_operation_runs (
      id text PRIMARY KEY NOT NULL,
      job_name text NOT NULL,
      cadence text NOT NULL,
      cron text NOT NULL,
      scheduled_at text NOT NULL,
      started_at text NOT NULL,
      completed_at text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Running',
      attempt_count integer NOT NULL DEFAULT 1,
      duration_ms integer NOT NULL DEFAULT 0,
      result_json text NOT NULL DEFAULT '{}',
      error_message text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduled_operation_runs_job_idx ON scheduled_operation_runs (job_name, scheduled_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduled_operation_runs_status_idx ON scheduled_operation_runs (status, scheduled_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduler_trigger_receipts (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      cron text NOT NULL,
      scheduled_at text NOT NULL,
      received_at text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduler_trigger_receipts_source_idx ON scheduler_trigger_receipts (source, scheduled_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_operation_leases (
      run_id text PRIMARY KEY NOT NULL,
      job_name text NOT NULL,
      scheduled_at text NOT NULL,
      lease_token text NOT NULL,
      lease_owner text NOT NULL,
      lease_expires_at text NOT NULL,
      heartbeat_at text NOT NULL,
      state text NOT NULL DEFAULT 'Active',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduled_operation_leases_expiry_idx ON scheduled_operation_leases (state, lease_expires_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_operation_dead_letters (
      run_id text PRIMARY KEY NOT NULL,
      job_name text NOT NULL,
      scheduled_at text NOT NULL,
      failure_type text NOT NULL,
      error_message text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      opened_at text NOT NULL,
      last_failed_at text NOT NULL,
      status text NOT NULL DEFAULT 'Open',
      recovered_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduled_operation_dead_letters_status_idx ON scheduled_operation_dead_letters (status, last_failed_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_operation_gaps (
      id text PRIMARY KEY NOT NULL,
      job_name text NOT NULL,
      first_missing_at text NOT NULL,
      last_missing_at text NOT NULL,
      missing_count integer NOT NULL,
      detected_at text NOT NULL,
      source text NOT NULL,
      status text NOT NULL DEFAULT 'Open',
      resolved_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduled_operation_gaps_status_idx ON scheduled_operation_gaps (status, detected_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduler_cycle_cursors (
      source text PRIMARY KEY NOT NULL,
      next_group_index integer NOT NULL DEFAULT 0,
      last_group_name text NOT NULL DEFAULT '',
      last_checkpoint_at text NOT NULL DEFAULT '',
      last_cycle_id text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduler_cycle_checkpoints (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      scheduled_at text NOT NULL,
      group_name text NOT NULL,
      group_index integer NOT NULL,
      status text NOT NULL DEFAULT 'Running',
      started_at text NOT NULL,
      completed_at text NOT NULL DEFAULT '',
      duration_ms integer NOT NULL DEFAULT 0,
      result_json text NOT NULL DEFAULT '{}',
      error_message text NOT NULL DEFAULT '',
      next_group_index integer NOT NULL,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduler_cycle_checkpoints_status_idx ON scheduler_cycle_checkpoints (status, started_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS scheduler_cycle_checkpoints_source_idx ON scheduler_cycle_checkpoints (source, scheduled_at)`),
  ]);
}

export async function loadSchedulerGroupCursor(db: ScheduledD1Database, source: SchedulerTriggerSource) {
  const row = await db.prepare(`SELECT next_group_index FROM scheduler_cycle_cursors WHERE source = ?`).bind(source).first<{ next_group_index: number }>();
  return Math.max(0, Number(row?.next_group_index || 0));
}

export async function beginSchedulerGroupCheckpoint(db: ScheduledD1Database, input: { source: SchedulerTriggerSource; scheduledAt: Date; groupName: ScheduledOperationName; groupIndex: number; nextGroupIndex: number; now?: Date }) {
  const now = input.now || new Date();
  const id = `${input.source}:${input.scheduledAt.toISOString()}:${input.groupName}`;
  await db.prepare(`INSERT INTO scheduler_cycle_checkpoints
    (id, source, scheduled_at, group_name, group_index, status, started_at, next_group_index, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Running', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'Running', started_at = excluded.started_at, completed_at = '', duration_ms = 0, result_json = '{}', error_message = '', next_group_index = excluded.next_group_index, updated_at = excluded.updated_at
    WHERE scheduler_cycle_checkpoints.status IN ('Canceled', 'Failed')`)
    .bind(id, input.source, input.scheduledAt.toISOString(), input.groupName, input.groupIndex, now.toISOString(), input.nextGroupIndex, now.toISOString()).run();
  return { id, startedAt: now };
}

export async function completeSchedulerGroupCheckpoint(db: ScheduledD1Database, input: { id: string; source: SchedulerTriggerSource; groupName: ScheduledOperationName; nextGroupIndex: number; startedAt: Date; result: unknown; now?: Date }) {
  const now = input.now || new Date();
  const durationMs = Math.max(0, now.getTime() - input.startedAt.getTime());
  await db.batch([
    db.prepare(`UPDATE scheduler_cycle_checkpoints SET status = 'Completed', completed_at = ?, duration_ms = ?, result_json = ?, error_message = '', next_group_index = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
      .bind(now.toISOString(), durationMs, safeJson(input.result), input.nextGroupIndex, now.toISOString(), input.id),
    db.prepare(`INSERT INTO scheduler_cycle_cursors (source, next_group_index, last_group_name, last_checkpoint_at, last_cycle_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET next_group_index = excluded.next_group_index, last_group_name = excluded.last_group_name, last_checkpoint_at = excluded.last_checkpoint_at, last_cycle_id = excluded.last_cycle_id, updated_at = excluded.updated_at`)
      .bind(input.source, input.nextGroupIndex, input.groupName, now.toISOString(), input.id, now.toISOString()),
  ]);
  await resolveSchedulerWork(input.groupName, "Scheduler Invocation Canceled", "A later scheduler invocation completed the durable group checkpoint.")
    .catch((error) => console.error(`Canceled scheduler alert could not be resolved: ${safeError(error)}`));
  return durationMs;
}

export async function failSchedulerGroupCheckpoint(db: ScheduledD1Database, input: { id: string; startedAt: Date; error: unknown; now?: Date }) {
  const now = input.now || new Date();
  const message = safeError(input.error);
  await db.prepare(`UPDATE scheduler_cycle_checkpoints SET status = 'Failed', completed_at = ?, duration_ms = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
    .bind(now.toISOString(), Math.max(0, now.getTime() - input.startedAt.getTime()), message, now.toISOString(), input.id).run();
  return message;
}

export async function recoverCanceledSchedulerGroups(db: ScheduledD1Database, now = new Date(), budgetMs = SCHEDULER_INVOCATION_BUDGET_MS) {
  const cutoff = new Date(now.getTime() - Math.max(15_000, budgetMs * 2)).toISOString();
  const rows = await db.prepare(`SELECT * FROM scheduler_cycle_checkpoints WHERE status = 'Running' AND started_at < ? ORDER BY started_at ASC LIMIT 100`).bind(cutoff).all<SchedulerCheckpointRow>();
  for (const row of rows.results || []) {
    const error = `Scheduler invocation ended before ${row.group_name} checkpointed completion. The durable cursor remains at group ${row.group_index} for automatic resume.`;
    await db.prepare(`UPDATE scheduler_cycle_checkpoints SET status = 'Canceled', completed_at = ?, duration_ms = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
      .bind(now.toISOString(), Math.max(0, now.getTime() - new Date(row.started_at).getTime()), error, now.toISOString(), row.id).run();
    await routeSchedulerWork({ name: row.group_name as ScheduledOperationName, label: row.group_name, scheduledAt: row.scheduled_at, kind: "Scheduler Invocation Canceled", title: `${row.group_name} Scheduler Invocation Was Canceled`, message: `${error} Review the recovery checkpoint in IT & Integrations.`, priority: "Critical" }).catch((routeError) => console.error(`Canceled scheduler escalation could not be recorded: ${safeError(routeError)}`));
  }
  return (rows.results || []).length;
}

export async function recordSchedulerTrigger(
  db: ScheduledD1Database,
  input: { source: SchedulerTriggerSource; scheduledAt: Date; cron: string; receivedAt?: Date },
) {
  const receivedAt = input.receivedAt || new Date();
  const id = `${input.source}:${input.scheduledAt.toISOString()}`;
  await db.prepare(`INSERT OR IGNORE INTO scheduler_trigger_receipts (id, source, cron, scheduled_at, received_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, input.source, input.cron, input.scheduledAt.toISOString(), receivedAt.toISOString()).run();
  await db.prepare(`DELETE FROM scheduler_trigger_receipts WHERE received_at < ?`)
    .bind(new Date(receivedAt.getTime() - 35 * 86_400_000).toISOString()).run();
  return { id, source: input.source, scheduledAt: input.scheduledAt.toISOString(), receivedAt: receivedAt.toISOString() };
}

export async function prepareScheduledOperationCycle(
  db: ScheduledD1Database,
  input: { source: SchedulerTriggerSource; scheduledAt: Date; cron: string; now?: Date },
) {
  const now = input.now || new Date();
  await recordSchedulerTrigger(db, { ...input, receivedAt: now });
  const recoveredTimedOut = await recoverStaleScheduledOperations(db, now);
  const oldestWindow = Math.max(...SCHEDULED_OPERATION_DEFINITIONS.map((definition) => definition.recoveryWindowMinutes));
  const result = await db.prepare(`SELECT job_name, scheduled_at, status FROM scheduled_operation_runs WHERE scheduled_at >= ? ORDER BY scheduled_at ASC`)
    .bind(new Date(now.getTime() - oldestWindow * 60_000).toISOString())
    .all<{ job_name: string; scheduled_at: string; status: string }>();
  const rows = result.results || [];
  const plans: Array<{ name: ScheduledOperationName; slots: Date[]; missingCount: number; unrecoveredCount: number }> = [];
  const gaps: Array<{ name: ScheduledOperationName; label: string; missing: string[] }> = [];
  for (const definition of SCHEDULED_OPERATION_DEFINITIONS) {
    const plan = planRecoverySlots({
      now,
      intervalMinutes: definition.intervalMinutes,
      offsetMinutes: definition.offsetMinutes,
      windowMinutes: definition.recoveryWindowMinutes,
      graceMinutes: 0,
      catchUpLimit: definition.catchUpLimit,
      runs: rows.filter((row) => row.job_name === definition.name).map((row) => ({ scheduledAt: row.scheduled_at, status: row.status })),
    });
    if (plan.unrecovered.length) gaps.push({ name: definition.name, label: definition.label, missing: plan.unrecovered });
    plans.push({ name: definition.name, slots: plan.selected.map((slot) => new Date(slot)), missingCount: plan.missing.length, unrecoveredCount: plan.unrecovered.length });
  }
  await recordScheduleGaps(db, gaps, input.source, now);
  return { trigger: input.source, recoveredTimedOut, plans };
}

export async function runScheduledOperation(
  db: ScheduledD1Database,
  input: { name: ScheduledOperationName; scheduledAt: Date; cron: string; maxAttempts?: number; leaseOwner?: string },
  operation: () => Promise<unknown>,
): Promise<OperationResult> {
  const definition = SCHEDULED_OPERATION_DEFINITIONS.find((item) => item.name === input.name)!;
  const scheduledAt = input.scheduledAt.toISOString();
  const id = `${scheduledAt}:${input.name}`;
  let prior = await db.prepare(`SELECT * FROM scheduled_operation_runs WHERE id = ?`).bind(id).first<RunRow>();
  if (prior?.status === "Succeeded") return { id, jobName: input.name, status: "Already Succeeded", attempts: prior.attempt_count, durationMs: 0, error: "" };

  const started = new Date();
  if (prior?.status === "Running") {
    const ageMinutes = (started.getTime() - new Date(prior.started_at).getTime()) / 60_000;
    if (Number.isFinite(ageMinutes) && ageMinutes <= definition.maxRunMinutes) return { id, jobName: input.name, status: "Already Running", attempts: prior.attempt_count, durationMs: 0, error: "An active lease already owns this execution slot" };
    await expireRun(db, prior, definition.maxRunMinutes, started);
    prior = await db.prepare(`SELECT * FROM scheduled_operation_runs WHERE id = ?`).bind(id).first<RunRow>();
  }

  const leaseToken = crypto.randomUUID();
  const leaseOwner = input.leaseOwner || "Scheduled Operations Engine";
  const leaseExpiresAt = new Date(started.getTime() + definition.maxRunMinutes * 60_000).toISOString();
  await db.prepare(`INSERT INTO scheduled_operation_leases
    (run_id, job_name, scheduled_at, lease_token, lease_owner, lease_expires_at, heartbeat_at, state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
    ON CONFLICT(run_id) DO UPDATE SET lease_token = excluded.lease_token, lease_owner = excluded.lease_owner, lease_expires_at = excluded.lease_expires_at, heartbeat_at = excluded.heartbeat_at, state = 'Active', updated_at = excluded.updated_at
    WHERE scheduled_operation_leases.state != 'Completed' AND scheduled_operation_leases.lease_expires_at <= ?`)
    .bind(id, input.name, scheduledAt, leaseToken, leaseOwner, leaseExpiresAt, started.toISOString(), started.toISOString(), started.toISOString()).run();
  const lease = await db.prepare(`SELECT lease_token, state FROM scheduled_operation_leases WHERE run_id = ?`).bind(id).first<{ lease_token: string; state: string }>();
  if (lease?.lease_token !== leaseToken || lease.state !== "Active") return { id, jobName: input.name, status: prior?.status === "Succeeded" ? "Already Succeeded" : "Already Running", attempts: Number(prior?.attempt_count || 0), durationMs: 0, error: "Another execution owns this slot" };

  const baseAttempts = Number(prior?.attempt_count || 0);
  await db.prepare(`INSERT INTO scheduled_operation_runs
    (id, job_name, cadence, cron, scheduled_at, started_at, status, attempt_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'Running', ?, ?)
    ON CONFLICT(id) DO UPDATE SET cron = excluded.cron, started_at = excluded.started_at, status = 'Running', completed_at = '', duration_ms = 0, result_json = '{}', error_message = '', updated_at = excluded.updated_at
    WHERE scheduled_operation_runs.status != 'Succeeded'`)
    .bind(id, input.name, definition.cadence, input.cron, scheduledAt, started.toISOString(), baseAttempts, started.toISOString()).run();

  const maxAttempts = Math.max(1, Math.min(3, Number(input.maxAttempts || 2)));
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptNumber = baseAttempts + attempt;
    const heartbeat = new Date();
    await db.prepare(`UPDATE scheduled_operation_leases SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE run_id = ? AND lease_token = ? AND state = 'Active'`)
      .bind(heartbeat.toISOString(), new Date(heartbeat.getTime() + definition.maxRunMinutes * 60_000).toISOString(), heartbeat.toISOString(), id, leaseToken).run();
    await db.prepare(`UPDATE scheduled_operation_runs SET attempt_count = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
      .bind(attemptNumber, heartbeat.toISOString(), id).run();
    try {
      const result = await operation();
      if (!await ownsActiveLease(db, id, leaseToken)) {
        return { id, jobName: input.name, status: "Already Running", attempts: attemptNumber, durationMs: new Date().getTime() - started.getTime(), error: "The execution lease expired or was replaced before its result could be committed" };
      }
      const deferred = deferredOutcome(result);
      const completed = new Date();
      const durationMs = completed.getTime() - started.getTime();
      const status = deferred ? "Deferred" : "Succeeded";
      await db.prepare(`UPDATE scheduled_operation_runs SET completed_at = ?, status = ?, duration_ms = ?, result_json = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
        .bind(completed.toISOString(), status, durationMs, safeJson(result), deferred, completed.toISOString(), id).run();
      await db.prepare(`UPDATE scheduled_operation_leases SET state = 'Completed', heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE run_id = ? AND lease_token = ?`)
        .bind(completed.toISOString(), completed.toISOString(), completed.toISOString(), id, leaseToken).run();
      if (!deferred) {
        await db.prepare(`UPDATE scheduled_operation_dead_letters SET status = 'Recovered', recovered_at = ?, updated_at = ? WHERE job_name = ? AND status = 'Open' AND scheduled_at <= ?`)
          .bind(completed.toISOString(), completed.toISOString(), input.name, scheduledAt).run();
        const remainingDeadLetters = await db.prepare(`SELECT count(*) AS count FROM scheduled_operation_dead_letters WHERE job_name = ? AND status = 'Open'`)
          .bind(input.name).first<{ count: number }>();
        if (!Number(remainingDeadLetters?.count || 0)) await resolveSchedulerWork(
          input.name,
          "Scheduled Operation Failure",
          "A later scheduled run completed successfully and superseded the open failure.",
        ).catch((error) => console.error(`Recovered scheduler failure alert could not be resolved: ${safeError(error)}`));
      }
      return { id, jobName: input.name, status, attempts: attemptNumber, durationMs, error: deferred };
    } catch (error) {
      lastError = safeError(error);
      if (attempt < maxAttempts) await delay(retryDelayMilliseconds(attempt));
    }
  }

  const completed = new Date();
  const attempts = baseAttempts + maxAttempts;
  const durationMs = completed.getTime() - started.getTime();
  if (!await ownsActiveLease(db, id, leaseToken)) {
    return { id, jobName: input.name, status: "Already Running", attempts, durationMs, error: "The execution lease expired or was replaced before its failure could be committed" };
  }
  await db.prepare(`UPDATE scheduled_operation_runs SET completed_at = ?, status = 'Failed', duration_ms = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
    .bind(completed.toISOString(), durationMs, lastError, completed.toISOString(), id).run();
  await db.prepare(`UPDATE scheduled_operation_leases SET state = 'Dead Letter', heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE run_id = ? AND lease_token = ?`)
    .bind(completed.toISOString(), completed.toISOString(), completed.toISOString(), id, leaseToken).run();
  await upsertDeadLetter(db, { id, name: input.name, scheduledAt, failureType: "Failed", error: lastError, attempts, now: completed });
  console.error(`Scheduled operation failed: ${input.name}: ${lastError}`);
  await routeScheduledFailureToLeadership(input.name, definition.label, scheduledAt, lastError).catch((error) => console.error(`Scheduled failure escalation could not be recorded: ${safeError(error)}`));
  return { id, jobName: input.name, status: "Failed", attempts, durationMs, error: lastError };
}

export async function recoverStaleScheduledOperations(db: ScheduledD1Database, now = new Date()) {
  const result = await db.prepare(`SELECT * FROM scheduled_operation_runs WHERE status = 'Running' ORDER BY started_at ASC LIMIT 5000`).all<RunRow>();
  let recovered = 0;
  for (const row of result.results || []) {
    const definition = SCHEDULED_OPERATION_DEFINITIONS.find((item) => item.name === row.job_name);
    const maxRunMinutes = definition?.maxRunMinutes || 30;
    const ageMinutes = (now.getTime() - new Date(row.started_at).getTime()) / 60_000;
    if (!Number.isFinite(ageMinutes) || ageMinutes <= maxRunMinutes) continue;
    await expireRun(db, row, maxRunMinutes, now);
    recovered += 1;
  }
  return recovered;
}

export async function loadScheduledOperationSnapshot(now = new Date()) {
  const { env } = await import("cloudflare:workers");
  const db = (env as unknown as { DB: ScheduledD1Database }).DB;
  const cutoff = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const [runResult, triggerResult, gapResult, deadLetterResult, checkpointResult, cursorResult] = await Promise.all([
    db.prepare(`SELECT * FROM scheduled_operation_runs ORDER BY scheduled_at DESC LIMIT 5000`).all<RunRow>(),
    db.prepare(`SELECT * FROM scheduler_trigger_receipts WHERE received_at >= ? ORDER BY received_at DESC LIMIT 1000`).bind(cutoff).all<TriggerRow>(),
    db.prepare(`SELECT * FROM scheduled_operation_gaps WHERE detected_at >= ? AND status = 'Open' ORDER BY detected_at DESC`).bind(cutoff).all<GapRow>(),
    db.prepare(`SELECT * FROM scheduled_operation_dead_letters WHERE status = 'Open' ORDER BY last_failed_at DESC LIMIT 1000`).all<DeadLetterRow>(),
    db.prepare(`SELECT * FROM scheduler_cycle_checkpoints ORDER BY started_at DESC LIMIT 120`).all<SchedulerCheckpointRow>(),
    db.prepare(`SELECT source, next_group_index, last_group_name, last_checkpoint_at, last_cycle_id FROM scheduler_cycle_cursors ORDER BY source`).all<{ source: string; next_group_index: number; last_group_name: string; last_checkpoint_at: string; last_cycle_id: string }>(),
  ]);
  const rows = runResult.results || [];
  const gaps = gapResult.results || [];
  const deadLetters = deadLetterResult.results || [];
  const checkpoints = checkpointResult.results || [];
  const cursors = cursorResult.results || [];
  const jobs = SCHEDULED_OPERATION_DEFINITIONS.map((definition) => {
    const runs = rows.filter((row) => row.job_name === definition.name);
    const latest = runs[0];
    const latestSuccess = runs.find((row) => row.status === "Succeeded");
    const expected = expectedScheduleSlots({ now, intervalMinutes: definition.intervalMinutes, offsetMinutes: definition.offsetMinutes, windowMinutes: 1_440, graceMinutes: definition.graceMinutes });
    const expectedSet = new Set(expected);
    const recentRuns = runs.filter((row) => expectedSet.has(new Date(row.scheduled_at).toISOString()));
    const terminalRuns = new Set(recentRuns.filter((row) => TERMINAL_STATUSES.has(row.status)).map((row) => new Date(row.scheduled_at).toISOString())).size;
    const failedRuns = recentRuns.filter((row) => row.status === "Failed").length;
    const timedOutRuns = recentRuns.filter((row) => row.status === "Timed Out").length;
    const stuck = runs.filter((row) => row.status === "Running" && now.getTime() - new Date(row.started_at).getTime() > definition.maxRunMinutes * 60_000);
    const oldestStuckAgeMinutes = stuck.length ? Math.max(...stuck.map((row) => Math.max(0, (now.getTime() - new Date(row.started_at).getTime()) / 60_000))) : 0;
    const ageMinutes = latestSuccess ? Math.max(0, (now.getTime() - new Date(latestSuccess.completed_at || latestSuccess.scheduled_at).getTime()) / 60_000) : null;
    const openGapSlots = gaps.filter((gap) => gap.job_name === definition.name).reduce((sum, gap) => sum + Number(gap.missing_count || 0), 0);
    const status = schedulerEvidenceStatus({ expectedRuns: expected.length, terminalRuns, failedRuns, timedOutRuns, stuckRuns: stuck.length, latestSuccessAgeMinutes: ageMinutes, maxDelayMinutes: definition.maxDelayMinutes, openGapSlots });
    const problem = stuck.length
      ? `${stuck.length} run${stuck.length === 1 ? " is" : "s are"} still Running beyond the ${definition.maxRunMinutes}-minute lease`
      : timedOutRuns
        ? `${timedOutRuns} run${timedOutRuns === 1 ? " timed" : "s timed"} out in the measured window`
        : failedRuns
          ? `${failedRuns} run${failedRuns === 1 ? " failed" : "s failed"} in the measured window`
          : openGapSlots
            ? `${openGapSlots} missed execution slot${openGapSlots === 1 ? " is" : "s are"} being recovered`
            : terminalRuns < expected.length
              ? `${terminalRuns} of ${expected.length} expected 24-hour execution slots produced a terminal result`
              : "";
    return {
      ...definition,
      status,
      lastRunAt: latest?.scheduled_at || "",
      lastSuccessAt: latestSuccess?.completed_at || latestSuccess?.scheduled_at || "",
      lastFailureAt: runs.find((row) => ["Failed", "Timed Out"].includes(row.status))?.scheduled_at || "",
      attempts: Number(latest?.attempt_count || 0),
      durationMs: Number(latest?.duration_ms || 0),
      expectedRuns24h: expected.length,
      observedRuns24h: terminalRuns,
      failedRuns24h: failedRuns,
      timedOutRuns24h: timedOutRuns,
      stuckRuns: stuck.length,
      oldestStuckAgeMinutes,
      openGapSlots,
      openDeadLetters: deadLetters.filter((row) => row.job_name === definition.name).length,
      error: problem || (latest?.status === "Failed" ? latest.error_message : ""),
    };
  });

  const triggers = triggerResult.results || [];
  const platformTriggers = triggers.filter((row) => row.source === "Platform Cron");
  const fallbackTriggers = triggers.filter((row) => row.source === "Authenticated Session Fallback");
  const firstPlatform = platformTriggers.at(-1);
  const expectedPlatformTriggers24h = firstPlatform ? Math.max(1, Math.floor((now.getTime() - new Date(firstPlatform.scheduled_at).getTime()) / (5 * 60_000)) + 1) : 288;
  const latestPlatformAt = platformTriggers[0]?.received_at || "";
  const platformAgeMinutes = latestPlatformAt ? Math.max(0, (now.getTime() - new Date(latestPlatformAt).getTime()) / 60_000) : null;
  const triggerStatus = !latestPlatformAt
    ? fallbackTriggers.length && now.getTime() - new Date(fallbackTriggers[0].received_at).getTime() > 15 * 60_000 ? "Failed" : "Awaiting First Run"
    : platformAgeMinutes! > 15 || platformTriggers.length < expectedPlatformTriggers24h ? "Late" : "Healthy";
  const canceledCheckpoints24h = checkpoints.filter((row) => row.status === "Canceled" && new Date(row.started_at) >= new Date(cutoff)).length;
  const failedCheckpoints24h = checkpoints.filter((row) => row.status === "Failed" && new Date(row.started_at) >= new Date(cutoff)).length;
  const failureCount24h = rows.filter((row) => ["Failed", "Timed Out"].includes(row.status) && new Date(row.scheduled_at) >= new Date(cutoff)).length + canceledCheckpoints24h + failedCheckpoints24h;
  const overall = triggerStatus === "Failed" || canceledCheckpoints24h > 0 || failedCheckpoints24h > 0 || jobs.some((job) => job.status === "Failed")
    ? "Failed"
    : triggerStatus === "Late" || jobs.some((job) => job.status === "Late")
      ? "Late"
      : jobs.every((job) => job.status === "Healthy") && triggerStatus === "Healthy"
        ? "Healthy"
        : "Awaiting First Run";
  return {
    overall,
    failureCount24h,
    cadence: "Independent five-minute platform trigger · bounded missed-slot recovery · hourly lifecycle rules · nightly evidence",
    retention: "Permanent trigger receipts, leases, terminal results, gaps, retries, timeouts, and dead letters",
    trigger: {
      status: triggerStatus,
      expectedRuns24h: expectedPlatformTriggers24h,
      observedRuns24h: platformTriggers.length,
      lastPlatformTriggerAt: latestPlatformAt,
      lastFallbackTriggerAt: fallbackTriggers[0]?.received_at || "",
      source: "Cloud platform cron; authenticated-session heartbeat is safety fallback only",
      error: triggerStatus === "Failed" ? "No current independent platform-trigger evidence was received" : triggerStatus === "Late" ? `${platformTriggers.length} of ${expectedPlatformTriggers24h} expected platform trigger receipts were observed` : "",
    },
    openGapSlots: gaps.reduce((sum, gap) => sum + Number(gap.missing_count || 0), 0),
    openDeadLetters: deadLetters.length,
    boundedExecution: {
      timeBudgetMs: SCHEDULER_INVOCATION_BUDGET_MS,
      maxGroupsPerInvocation: SCHEDULER_GROUP_LIMIT,
      completedCheckpoints24h: checkpoints.filter((row) => row.status === "Completed" && new Date(row.started_at) >= new Date(cutoff)).length,
      canceledCheckpoints24h,
      failedCheckpoints24h,
      cursors: cursors.map((row) => ({ source: row.source, nextGroupIndex: Number(row.next_group_index || 0), lastGroupName: row.last_group_name, lastCheckpointAt: row.last_checkpoint_at, lastCycleId: row.last_cycle_id })),
      recentCheckpoints: checkpoints.slice(0, 40).map((row) => ({ id: row.id, source: row.source, scheduledAt: row.scheduled_at, groupName: row.group_name, groupIndex: Number(row.group_index || 0), status: row.status, startedAt: row.started_at, completedAt: row.completed_at, durationMs: Number(row.duration_ms || 0), error: row.error_message, nextGroupIndex: Number(row.next_group_index || 0) })),
    },
    jobs,
    recentRuns: rows.slice(0, 120).map((row) => ({ id: row.id, jobName: row.job_name, scheduledAt: row.scheduled_at, completedAt: row.completed_at, status: row.status, attempts: Number(row.attempt_count || 0), durationMs: Number(row.duration_ms || 0), error: row.error_message })),
  };
}

async function expireRun(db: ScheduledD1Database, row: RunRow, maxRunMinutes: number, now: Date) {
  const ageMinutes = Math.max(0, (now.getTime() - new Date(row.started_at).getTime()) / 60_000);
  const error = `Run lease expired after ${Math.round(ageMinutes)} minutes; maximum allowed runtime is ${maxRunMinutes} minutes`;
  await db.prepare(`UPDATE scheduled_operation_runs SET completed_at = ?, status = 'Timed Out', duration_ms = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'Running'`)
    .bind(now.toISOString(), Math.round(ageMinutes * 60_000), error, now.toISOString(), row.id).run();
  await db.prepare(`UPDATE scheduled_operation_leases SET state = 'Expired', lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE run_id = ? AND state = 'Active'`)
    .bind(now.toISOString(), now.toISOString(), now.toISOString(), row.id).run();
  const name = row.job_name as ScheduledOperationName;
  await upsertDeadLetter(db, { id: row.id, name, scheduledAt: row.scheduled_at, failureType: "Timed Out", error, attempts: Number(row.attempt_count || 0), now });
  const definition = SCHEDULED_OPERATION_DEFINITIONS.find((item) => item.name === name);
  if (definition) await routeScheduledFailureToLeadership(name, definition.label, row.scheduled_at, error).catch((routeError) => console.error(`Scheduled timeout escalation could not be recorded: ${safeError(routeError)}`));
}

async function upsertDeadLetter(db: ScheduledD1Database, input: { id: string; name: ScheduledOperationName; scheduledAt: string; failureType: string; error: string; attempts: number; now: Date }) {
  const nowIso = input.now.toISOString();
  await db.prepare(`INSERT INTO scheduled_operation_dead_letters
    (run_id, job_name, scheduled_at, failure_type, error_message, attempt_count, opened_at, last_failed_at, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?)
    ON CONFLICT(run_id) DO UPDATE SET failure_type = excluded.failure_type, error_message = excluded.error_message, attempt_count = excluded.attempt_count, last_failed_at = excluded.last_failed_at, status = 'Open', recovered_at = '', updated_at = excluded.updated_at`)
    .bind(input.id, input.name, input.scheduledAt, input.failureType, input.error, input.attempts, nowIso, nowIso, nowIso).run();
}

async function recordScheduleGaps(
  db: ScheduledD1Database,
  gaps: Array<{ name: ScheduledOperationName; label: string; missing: string[] }>,
  source: SchedulerTriggerSource,
  now: Date,
) {
  if (!gaps.length) return;
  const nowIso = now.toISOString();
  const statements = gaps.flatMap(({ name, missing }) => {
    const first = missing[0];
    const last = missing.at(-1)!;
    return [
      db.prepare(`INSERT INTO scheduled_operation_gaps
        (id, job_name, first_missing_at, last_missing_at, missing_count, detected_at, source, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?)
        ON CONFLICT(id) DO UPDATE SET first_missing_at = CASE WHEN scheduled_operation_gaps.status != 'Open' THEN excluded.first_missing_at WHEN scheduled_operation_gaps.first_missing_at < excluded.first_missing_at THEN scheduled_operation_gaps.first_missing_at ELSE excluded.first_missing_at END, last_missing_at = excluded.last_missing_at, missing_count = excluded.missing_count, detected_at = excluded.detected_at, source = excluded.source, status = 'Open', resolved_at = '', updated_at = excluded.updated_at`)
        .bind(name, name, first, last, missing.length, nowIso, source, nowIso),
      db.prepare(`UPDATE scheduled_operation_gaps SET status = 'Consolidated', resolved_at = ?, updated_at = ? WHERE job_name = ? AND status = 'Open' AND id != ?`)
        .bind(nowIso, nowIso, name, name),
    ];
  });
  await db.batch(statements);
  await routeScheduleGapsToLeadership(gaps).catch((error) => console.error(`Scheduled gap escalations could not be recorded: ${safeError(error)}`));
}

export async function resolveCurrentScheduleGap(db: ScheduledD1Database, name: ScheduledOperationName, now: Date) {
  await db.prepare(`UPDATE scheduled_operation_gaps SET status = 'Recovered', resolved_at = ?, updated_at = ? WHERE job_name = ? AND status = 'Open'`)
    .bind(now.toISOString(), now.toISOString(), name).run();
  await resolveSchedulerWork(name, "Scheduled Operation Gap", "Every currently planned missed slot completed within the bounded recovery window.");
}

async function routeScheduledFailureToLeadership(name: ScheduledOperationName, label: string, scheduledAt: string, error: string) {
  await routeSchedulerWork({ name, label, scheduledAt, kind: "Scheduled Operation Failure", title: `${label} Failed`, message: `${error}. Automatic retries are exhausted; review the dead-letter evidence in IT & Integrations.`, priority: "Critical" });
}

export function schedulerWorkDedupeKey(kind: string, name: ScheduledOperationName, email: string) {
  return `${kind.toLowerCase().replaceAll(" ", "-")}:${name}:${email.toLowerCase()}`;
}

async function routeScheduleGapsToLeadership(gaps: Array<{ name: ScheduledOperationName; label: string; missing: string[] }>) {
  const { getDb } = await import("../db");
  const db = getDb();
  const leaders = await db.select({ name: companyMembers.displayName, email: companyMembers.email }).from(companyMembers).where(and(eq(companyMembers.isActive, true), inArray(companyMembers.companyAccessLevel, ["Company Owner", "Administrator"])));
  const work: WorkItemInput[] = gaps.flatMap(({ name, label, missing }) => {
    const first = missing[0];
    const last = missing.at(-1)!;
    return leaders.map((leader) => ({
      dedupeKey: schedulerWorkDedupeKey("Scheduled Operation Gap", name, leader.email),
      projectId: "MEFFORD-INTEGRATIONS",
      recipientName: leader.name,
      recipientEmail: leader.email,
      kind: "Scheduled Operation Gap",
      title: `${label} Missed ${missing.length} Execution Slot${missing.length === 1 ? "" : "s"}`,
      message: `Missing scheduler evidence from ${first} through ${last}. The engine is backfilling bounded slots and preserving the remaining gap for review.`,
      priority: "High",
      sourceType: "Scheduled Operation",
      sourceRecordId: name,
      actionTarget: "IT & Integrations",
      dueAt: last,
      createdBy: "Scheduled Operations Engine",
    }));
  });
  await upsertWorkItems(db, work);
}

async function routeSchedulerWork(input: { name: ScheduledOperationName; label: string; scheduledAt: string; kind: string; title: string; message: string; priority: "High" | "Critical" }) {
  const { getDb } = await import("../db");
  const db = getDb();
  const leaders = await db.select({ name: companyMembers.displayName, email: companyMembers.email }).from(companyMembers).where(and(eq(companyMembers.isActive, true), inArray(companyMembers.companyAccessLevel, ["Company Owner", "Administrator"])));
  for (const leader of leaders) {
    await upsertWorkItem(db, {
      dedupeKey: schedulerWorkDedupeKey(input.kind, input.name, leader.email),
      projectId: "MEFFORD-INTEGRATIONS",
      recipientName: leader.name,
      recipientEmail: leader.email,
      kind: input.kind,
      title: input.title,
      message: input.message,
      priority: input.priority,
      sourceType: "Scheduled Operation",
      sourceRecordId: input.name,
      actionTarget: "IT & Integrations",
      dueAt: input.scheduledAt,
      createdBy: "Scheduled Operations Engine",
    });
  }
}

async function resolveSchedulerWork(name: ScheduledOperationName, kind: string, detail: string) {
  const { getDb } = await import("../db");
  const db = getDb();
  const active = await db
    .select({ id: commandWorkItems.id })
    .from(commandWorkItems)
    .where(and(
      eq(commandWorkItems.sourceType, "Scheduled Operation"),
      eq(commandWorkItems.sourceRecordId, name),
      eq(commandWorkItems.kind, kind),
      inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
    ));
  if (!active.length) return;
  const now = new Date().toISOString();
  await db
    .update(commandWorkItems)
    .set({ status: "Completed", completedAt: now, snoozedUntil: null, updatedAt: now })
    .where(inArray(commandWorkItems.id, active.map((item) => item.id)));
  await db.insert(workItemAudits).values(active.map((item) => ({
    workItemId: item.id,
    action: "Automatically Resolved",
    actorName: "Scheduled Operations Engine",
    actorEmail: "system@command-center.internal",
    detail,
  })));
}

function deferredOutcome(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return record.scheduledOutcome === "Deferred" ? safeError(record.reason || "The operation was deferred without a completed business outcome") : "";
}

async function ownsActiveLease(db: ScheduledD1Database, runId: string, leaseToken: string) {
  const lease = await db.prepare(`SELECT lease_token, state, lease_expires_at FROM scheduled_operation_leases WHERE run_id = ?`).bind(runId).first<{ lease_token: string; state: string; lease_expires_at: string }>();
  return lease?.lease_token === leaseToken && lease.state === "Active" && new Date(lease.lease_expires_at).getTime() > Date.now();
}

function safeJson(value: unknown) {
  try {
    const json = JSON.stringify(value ?? {});
    return json.length > 4_000 ? JSON.stringify({ summary: json.slice(0, 3_900), truncated: true }) : json;
  } catch {
    return JSON.stringify({ result: "Completed; result was not serializable" });
  }
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error || "Unknown scheduled operation failure");
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 1_000);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
