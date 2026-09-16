import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("F-18 caps every scheduler invocation below the observed cancellation boundary", async () => {
  const [scheduler, heartbeat, worker] = await Promise.all([
    source("lib/command-scheduler.ts"),
    source("app/api/automation-heartbeat/route.ts"),
    source("worker/index.ts"),
  ]);
  assert.match(scheduler, /SCHEDULER_INVOCATION_BUDGET_MS/);
  assert.match(scheduler, /timeBudgetMs - 750/);
  assert.match(heartbeat, /timeBudgetMs: 6_000/);
  assert.match(heartbeat, /maxGroups: 1/);
  assert.match(worker, /timeBudgetMs: 6_000/);
  assert.match(worker, /maxGroups: 1/);
});

test("F-18 checkpoints each operation group and advances one durable cursor only after completion", async () => {
  const operations = await source("lib/scheduled-operations.ts");
  for (const table of ["scheduler_cycle_cursors", "scheduler_cycle_checkpoints"]) assert.match(operations, new RegExp(table));
  assert.match(operations, /beginSchedulerGroupCheckpoint/);
  assert.match(operations, /completeSchedulerGroupCheckpoint/);
  assert.match(operations, /WHERE id = \? AND status = 'Running'/);
  assert.match(operations, /ON CONFLICT\(source\) DO UPDATE SET next_group_index/);
});

test("F-18 leaves the cursor unchanged on cancellation and alerts leadership", async () => {
  const operations = await source("lib/scheduled-operations.ts");
  assert.match(operations, /recoverCanceledSchedulerGroups/);
  assert.match(operations, /status = 'Canceled'/);
  assert.match(operations, /durable cursor remains at group/);
  assert.match(operations, /Scheduler Invocation Canceled/);
  assert.match(operations, /priority: "Critical"/);
  assert.match(operations, /IT & Integrations/);
});

test("F-18 exposes production recovery evidence and fails health on recent cancellation", async () => {
  const [operations, ui] = await Promise.all([
    source("lib/scheduled-operations.ts"),
    source("app/integration-health.tsx"),
  ]);
  assert.match(operations, /canceledCheckpoints24h > 0/);
  assert.match(operations, /recentCheckpoints/);
  assert.doesNotMatch(ui, /F-18 BOUNDED EXECUTION/);
  assert.match(ui, /Durable Scheduler Cursor &amp; Recovery/);
  assert.match(ui, /CANCELED \/ FAILED · 24H/);
});

test("F-18 migration contains only the new bounded-execution tables", async () => {
  const migration = await source("drizzle/0028_last_ser_duncan.sql");
  assert.match(migration, /scheduler_cycle_checkpoints/);
  assert.match(migration, /scheduler_cycle_cursors/);
  assert.doesNotMatch(migration, /template_governance/);
});

test("scheduler hot paths rely on migrations instead of repeating schema DDL", async () => {
  const [operations, heartbeat, heartbeatMigration, runMigration] = await Promise.all([
    source("lib/scheduled-operations.ts"),
    source("app/api/automation-heartbeat/route.ts"),
    source("drizzle/0032_lazy_bishop.sql"),
    source("drizzle/0033_material_puck.sql"),
  ]);
  assert.equal((operations.match(/ensureScheduledOperationSchema\(/g) || []).length, 1);
  assert.doesNotMatch(heartbeat, /CREATE TABLE|ensureScheduledOperationSchema/);
  assert.match(heartbeatMigration, /CREATE TABLE IF NOT EXISTS `automation_heartbeat_claims`/);
  assert.match(heartbeatMigration, /automation_heartbeat_claims_claimed_idx/);
  assert.match(runMigration, /CREATE TABLE IF NOT EXISTS `scheduled_operation_runs`/);
  assert.match(runMigration, /scheduled_operation_runs_status_idx/);
});
