import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [worker, scheduler, commandScheduler, vite, api, ui] = await Promise.all([
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/scheduled-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/integration-health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/integration-health.tsx", import.meta.url), "utf8"),
]);

test("scheduled operations run from an independent five-minute platform trigger", () => {
  assert.match(vite, /crons: \["\*\/5 \* \* \* \*"\]/);
  assert.match(worker, /runCommandSchedulerCycle/);
  assert.match(worker, /source: "Platform Cron"/);
  assert.match(worker, /await runCommandSchedulerCycle/);
  assert.match(scheduler, /scheduler_trigger_receipts/);
});

test("every run has an idempotent ledger, exclusive lease, timeout, and bounded retries", () => {
  assert.match(scheduler, /CREATE TABLE IF NOT EXISTS scheduled_operation_runs/);
  assert.match(scheduler, /CREATE TABLE IF NOT EXISTS scheduled_operation_leases/);
  assert.match(scheduler, /lease_expires_at/);
  assert.match(scheduler, /scheduledAt\.toISOString\(\)/);
  assert.match(scheduler, /Already Succeeded/);
  assert.match(scheduler, /Already Running/);
  assert.match(scheduler, /Math\.min\(3/);
  assert.match(scheduler, /retryDelayMilliseconds/);
  assert.match(scheduler, /const status = deferred \? "Deferred" : "Succeeded"/);
  assert.match(scheduler, /status = 'Failed'/);
  assert.match(scheduler, /status = 'Timed Out'/);
  assert.match(scheduler, /attempt_count/);
});

test("jobs share one scheduler path and remain isolated across operation groups", () => {
  for (const job of ["domain-outbox-reconciliation", "integration-health", "operational-notice-delivery", "closeout-reconciliation", "morning-work-digests", "meeting-rules", "customer-survey-milestones", "asset-readiness", "project-health-nightly", "quarterly-performance-reviews"]) {
    assert.match(scheduler, new RegExp(`name: "${job}"`));
    assert.match(commandScheduler, new RegExp(`case "${job}"`));
  }
  assert.match(commandScheduler, /runScheduledOperation/);
  assert.match(commandScheduler, /beginSchedulerGroupCheckpoint/);
  assert.match(commandScheduler, /completeSchedulerGroupCheckpoint/);
  assert.match(commandScheduler, /maxGroups/);
  assert.match(scheduler, /return \{ id, jobName: input\.name, status: "Failed"/);
});

test("missed slots, stale runs, and exhausted failures become actionable evidence", () => {
  assert.match(scheduler, /prepareScheduledOperationCycle/);
  assert.match(scheduler, /planRecoverySlots/);
  assert.match(scheduler, /recoverStaleScheduledOperations/);
  assert.match(scheduler, /scheduled_operation_gaps/);
  assert.match(scheduler, /scheduled_operation_dead_letters/);
  assert.match(scheduler, /Scheduled Operation Gap/);
  assert.match(scheduler, /Automatic retries are exhausted/);
});

test("scheduler health and execution evidence are visible in IT and Integrations", () => {
  assert.match(api, /loadScheduledOperationSnapshot/);
  assert.match(api, /automation,/);
  assert.match(ui, /Scheduled Operations/);
  assert.match(ui, /Permanent Run And Failure Ledger/);
  assert.match(ui, /Isolated Retries And Outcomes/);
  assert.match(ui, /failureCount24h/);
  assert.match(ui, /Independent Platform Scheduler/);
  assert.match(ui, /Dead Letters/);
});

test("permanent failures create leadership-visible work without taking approval authority", () => {
  assert.match(scheduler, /routeScheduledFailureToLeadership/);
  assert.match(scheduler, /Company Owner/);
  assert.match(scheduler, /Administrator/);
  assert.match(scheduler, /upsertWorkItem/);
  assert.match(scheduler, /review the dead-letter evidence in IT & Integrations/);
  assert.doesNotMatch(scheduler, /approveWork: true|payVendor: true|postFinancials: true/);
});
