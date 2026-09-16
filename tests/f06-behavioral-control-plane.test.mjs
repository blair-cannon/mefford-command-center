import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  ownerBillingLines,
  postAccountingEvent,
} from "../lib/accounting-ledger.ts";
import {
  ensureScheduledOperationSchema,
  prepareScheduledOperationCycle,
  recoverStaleScheduledOperations,
  resolveCurrentScheduleGap,
  runScheduledOperation,
  schedulerWorkDedupeKey,
} from "../lib/scheduled-operations.ts";
import { getDb } from "../db/index.ts";
import { upsertWorkItem } from "../lib/my-work.ts";
import { createF06Runtime, F06_ACTORS } from "./support/f06-runtime-harness.mjs";

let runtime;

before(async () => {
  runtime = await createF06Runtime();
});

after(async () => {
  await runtime.dispose();
});

test("accounting posts a balanced event once and preserves its immutable journal detail", async () => {
  const input = {
    idempotencyKey: "F06:OWNER-BILLING:1",
    eventType: "Owner Invoice Sent",
    sourceType: "Owner Billing",
    sourceProjectId: "26001",
    sourceRecordId: "BILL-1",
    eventDate: "2026-08-23",
    reference: "BILL-1",
    description: "F-06 owner billing",
    actor: { name: "Jordan Mefford", email: "jmefford@meffcon.com" },
    lines: ownerBillingLines(1234.56, "26001", "F-06 owner billing"),
  };
  const first = await postAccountingEvent(runtime.database, input);
  const second = await postAccountingEvent(runtime.database, input);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.eventId, second.eventId);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM accounting_events WHERE idempotency_key = ?", input.idempotencyKey).count, 1);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM accounting_journal_entries WHERE event_id = ?", first.eventId).count, 1);
  const totals = runtime.database.one("SELECT sum(debit_cents) AS debit, sum(credit_cents) AS credit FROM accounting_journal_lines WHERE entry_id = ?", first.entryId);
  assert.equal(totals.debit, 123456);
  assert.equal(totals.credit, 123456);
});

test("accounting rejects unbalanced entries and hard-closed periods without partial writes", async () => {
  await assert.rejects(() => postAccountingEvent(runtime.database, {
    idempotencyKey: "F06:UNBALANCED",
    eventType: "Invalid",
    sourceType: "Test",
    sourceRecordId: "BAD-1",
    eventDate: "2026-08-23",
    reference: "BAD-1",
    description: "Must not post",
    actor: { name: "Jordan Mefford", email: "jmefford@meffcon.com" },
    lines: [
      { accountNumber: "102", accountName: "Cash", debitCents: 100 },
      { accountNumber: "402", accountName: "AP", creditCents: 99 },
    ],
  }), /balance exactly/i);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM accounting_events WHERE idempotency_key = 'F06:UNBALANCED'").count, 0);

  runtime.database.sqlite.prepare("UPDATE accounting_periods SET status = 'Hard Closed' WHERE id = '2026-08'").run();
  await assert.rejects(() => postAccountingEvent(runtime.database, {
    idempotencyKey: "F06:CLOSED",
    eventType: "Closed",
    sourceType: "Test",
    sourceRecordId: "CLOSED-1",
    eventDate: "2026-08-23",
    reference: "CLOSED-1",
    description: "Must not post in closed period",
    actor: { name: "Jordan Mefford", email: "jmefford@meffcon.com" },
    lines: ownerBillingLines(10, "26001", "Closed"),
  }), /Hard Closed/i);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM accounting_events WHERE idempotency_key = 'F06:CLOSED'").count, 0);
});

test("scheduler commits one successful outcome per execution slot", async () => {
  const scheduledAt = new Date("2026-08-23T12:00:00.000Z");
  let executions = 0;
  const first = await runScheduledOperation(runtime.database, {
    name: "integration-health",
    scheduledAt,
    cron: "*/5 * * * *",
    maxAttempts: 1,
  }, async () => ({ executions: ++executions }));
  const second = await runScheduledOperation(runtime.database, {
    name: "integration-health",
    scheduledAt,
    cron: "*/5 * * * *",
    maxAttempts: 1,
  }, async () => ({ executions: ++executions }));
  assert.equal(first.status, "Succeeded");
  assert.equal(second.status, "Already Succeeded");
  assert.equal(executions, 1);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM scheduled_operation_runs WHERE id = ?", first.id).count, 1);
});

test("scheduler records deferred outcomes and dead-letters exhausted failures", async () => {
  const deferred = await runScheduledOperation(runtime.database, {
    name: "microsoft-directory-sync",
    scheduledAt: new Date("2026-08-23T12:15:00.000Z"),
    cron: "15 * * * *",
    maxAttempts: 1,
  }, async () => ({ scheduledOutcome: "Deferred", reason: "Provider connection is not configured" }));
  assert.equal(deferred.status, "Deferred");
  assert.match(deferred.error, /not configured/i);

  const failed = await runScheduledOperation(runtime.database, {
    name: "sharepoint-file-reconciliation",
    scheduledAt: new Date("2026-08-23T12:45:00.000Z"),
    cron: "45 * * * *",
    maxAttempts: 1,
  }, async () => { throw new Error("F-06 simulated provider outage"); });
  assert.equal(failed.status, "Failed");
  assert.match(failed.error, /simulated provider outage/);
  const deadLetter = runtime.database.one("SELECT status, failure_type, error_message FROM scheduled_operation_dead_letters WHERE run_id = ?", failed.id);
  assert.equal(deadLetter.status, "Open");
  assert.equal(deadLetter.failure_type, "Failed");
  assert.match(deadLetter.error_message, /simulated provider outage/);
});

test("stale running jobs become timed-out evidence instead of staying falsely healthy", async () => {
  await ensureScheduledOperationSchema(runtime.database);
  const id = "2026-08-20T00:00:00.000Z:integration-health";
  runtime.database.sqlite.prepare(`INSERT INTO scheduled_operation_runs
    (id, job_name, cadence, cron, scheduled_at, started_at, status, attempt_count)
    VALUES (?, 'integration-health', 'Every 5 Minutes', '*/5 * * * *', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 'Running', 1)`).run(id);
  runtime.database.sqlite.prepare(`INSERT INTO scheduled_operation_leases
    (run_id, job_name, scheduled_at, lease_token, lease_owner, lease_expires_at, heartbeat_at, state)
    VALUES (?, 'integration-health', '2026-08-20T00:00:00.000Z', 'expired', 'F-06', '2026-08-20T00:10:00.000Z', '2026-08-20T00:00:00.000Z', 'Active')`).run(id);
  const recovered = await recoverStaleScheduledOperations(runtime.database, new Date("2026-08-20T01:00:00.000Z"));
  assert.equal(recovered, 1);
  assert.equal(runtime.database.one("SELECT status FROM scheduled_operation_runs WHERE id = ?", id).status, "Timed Out");
  assert.equal(runtime.database.one("SELECT state FROM scheduled_operation_leases WHERE run_id = ?", id).state, "Expired");
  assert.equal(runtime.database.one("SELECT status FROM scheduled_operation_dead_letters WHERE run_id = ?", id).status, "Open");
});

test("scheduler incidents use one stable work item per job and recipient", () => {
  const first = schedulerWorkDedupeKey("Scheduled Operation Gap", "integration-health", "JMEFFORD@MEFFCON.COM");
  const second = schedulerWorkDedupeKey("Scheduled Operation Gap", "integration-health", "jmefford@meffcon.com");
  assert.equal(first, second);
  assert.equal(first, "scheduled-operation-gap:integration-health:jmefford@meffcon.com");
  assert.doesNotMatch(first, /2026-\d{2}-\d{2}/);
});

test("scheduler gap persistence and leadership routing use bounded D1 batches", async () => {
  const originalBatch = runtime.database.batch.bind(runtime.database);
  let batchCalls = 0;
  let largestBatch = 0;
  runtime.database.batch = async (statements) => {
    batchCalls += 1;
    largestBatch = Math.max(largestBatch, statements.length);
    return originalBatch(statements);
  };
  try {
    await prepareScheduledOperationCycle(runtime.database, {
      source: "Authenticated Session Fallback",
      scheduledAt: new Date("2026-09-02T17:00:00.000Z"),
      cron: "authenticated-session-fallback",
      now: new Date("2026-09-02T17:00:00.000Z"),
    });
  } finally {
    runtime.database.batch = originalBatch;
  }
  assert.equal(batchCalls, 2);
  assert.ok(largestBatch >= 28, `largest scheduler persistence batch was only ${largestBatch} statements`);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM scheduled_operation_gaps WHERE status = 'Open'").count, 14);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM command_work_items WHERE kind = 'Scheduled Operation Gap'").count, 28);
});

test("a completed recovery closes the gap ledger and its leadership work", async () => {
  const now = new Date("2026-08-23T14:00:00.000Z");
  await runtime.database.prepare(`INSERT INTO scheduled_operation_gaps
    (id, job_name, first_missing_at, last_missing_at, missing_count, detected_at, source, status, updated_at)
    VALUES ('integration-health:legacy', 'integration-health', '2026-08-23T13:00:00.000Z', '2026-08-23T13:55:00.000Z', 12, '2026-08-23T14:00:00.000Z', 'Authenticated Session Fallback', 'Open', '2026-08-23T14:00:00.000Z')`).run();
  const db = getDb();
  for (const leader of [F06_ACTORS.jordan, F06_ACTORS.blain]) {
    await upsertWorkItem(db, {
      dedupeKey: schedulerWorkDedupeKey("Scheduled Operation Gap", "integration-health", leader.email),
      projectId: "MEFFORD-INTEGRATIONS",
      recipientName: leader.name,
      recipientEmail: leader.email,
      kind: "Scheduled Operation Gap",
      title: "Integration Health Reconciliation Missed 12 Execution Slots",
      message: "The bounded recovery window is active.",
      priority: "High",
      sourceType: "Scheduled Operation",
      sourceRecordId: "integration-health",
      actionTarget: "IT & Integrations",
      dueAt: now.toISOString(),
      createdBy: "Scheduled Operations Engine",
    });
  }

  await resolveCurrentScheduleGap(runtime.database, "integration-health", now);

  assert.equal(runtime.database.one("SELECT count(*) AS count FROM scheduled_operation_gaps WHERE job_name = 'integration-health' AND status = 'Open'").count, 0);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM command_work_items WHERE kind = 'Scheduled Operation Gap' AND source_record_id = 'integration-health' AND status != 'Completed'").count, 0);
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM work_item_audits WHERE action = 'Automatically Resolved'").count, 2);
});

test("a later successful run recovers prior dead letters and closes the failure alert", async () => {
  const failed = await runScheduledOperation(runtime.database, {
    name: "integration-health",
    scheduledAt: new Date("2026-08-23T14:05:00.000Z"),
    cron: "*/5 * * * *",
    maxAttempts: 1,
  }, async () => { throw new Error("F-06 temporary integration-health outage"); });
  assert.equal(failed.status, "Failed");
  assert.equal(runtime.database.one("SELECT status FROM scheduled_operation_dead_letters WHERE run_id = ?", failed.id).status, "Open");
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM command_work_items WHERE kind = 'Scheduled Operation Failure' AND source_record_id = 'integration-health' AND status = 'Open'").count, 2);

  const recovered = await runScheduledOperation(runtime.database, {
    name: "integration-health",
    scheduledAt: new Date("2026-08-23T14:10:00.000Z"),
    cron: "*/5 * * * *",
    maxAttempts: 1,
  }, async () => ({ reconciled: true }));

  assert.equal(recovered.status, "Succeeded");
  assert.equal(runtime.database.one("SELECT status FROM scheduled_operation_dead_letters WHERE run_id = ?", failed.id).status, "Recovered");
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM command_work_items WHERE kind = 'Scheduled Operation Failure' AND source_record_id = 'integration-health' AND status != 'Completed'").count, 0);
});
