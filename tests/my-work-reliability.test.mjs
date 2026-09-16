import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { getDb } from "../db/index.ts";
import { closeResolvedIntegrationWork } from "../app/api/integration-health/route.ts";
import {
  closeResolvedSourceItems,
  isMyWorkReconciliationManagedKey,
  loadMyWorkSnapshot,
  upsertWorkItem,
} from "../lib/my-work.ts";
import { createF06Runtime, F06_ACTORS } from "./support/f06-runtime-harness.mjs";

let runtime;
let db;

before(async () => {
  runtime = await createF06Runtime();
  db = getDb();
});

after(async () => {
  await runtime.dispose();
});

function workItem(dedupeKey, overrides = {}) {
  return {
    dedupeKey,
    projectId: "MEFFORD-COMPANY",
    recipientName: F06_ACTORS.jordan.name,
    recipientEmail: F06_ACTORS.jordan.email,
    kind: "System Control",
    title: "Unresolved control",
    message: "The authoritative source still reports this control as unresolved.",
    priority: "High",
    sourceType: "System Control",
    sourceRecordId: "F06-CONTROL",
    actionTarget: "IT & Integrations",
    createdBy: "F-06 Reliability Test",
    ...overrides,
  };
}

test("an authoritative generator reopens a completed issue that is still unresolved", async () => {
  const input = workItem(`system:f06:reopen:${F06_ACTORS.jordan.email}`);
  await upsertWorkItem(db, input);
  runtime.database.sqlite.prepare(`UPDATE command_work_items
    SET status = 'Completed', read_at = '2026-08-23T12:00:00.000Z', acknowledged_at = '2026-08-23T12:00:00.000Z', completed_at = '2026-08-23T12:00:00.000Z'
    WHERE dedupe_key = ?`).run(input.dedupeKey);

  await upsertWorkItem(db, { ...input, title: "Unresolved control remains active" });

  const row = runtime.database.one(`SELECT status, title, read_at, acknowledged_at, completed_at
    FROM command_work_items WHERE dedupe_key = ?`, input.dedupeKey);
  assert.equal(row.status, "Open");
  assert.equal(row.title, "Unresolved control remains active");
  assert.equal(row.read_at, null);
  assert.equal(row.acknowledged_at, null);
  assert.equal(row.completed_at, null);
});

test("actor reconciliation closes only the source families it owns", async () => {
  const managed = workItem(`system:f06:managed:${F06_ACTORS.jordan.email}`);
  const scheduler = workItem(`scheduled-operation-gap:integration-health:${F06_ACTORS.jordan.email}`, {
    kind: "Scheduled Operation Gap",
    sourceType: "Scheduled Operation",
    sourceRecordId: "integration-health",
  });
  await upsertWorkItem(db, managed);
  await upsertWorkItem(db, scheduler);

  await closeResolvedSourceItems(db, F06_ACTORS.jordan.email, new Set());

  assert.equal(runtime.database.one("SELECT status FROM command_work_items WHERE dedupe_key = ?", managed.dedupeKey).status, "Completed");
  assert.equal(runtime.database.one("SELECT status FROM command_work_items WHERE dedupe_key = ?", scheduler.dedupeKey).status, "Open");
  assert.equal(isMyWorkReconciliationManagedKey(managed.dedupeKey), true);
  assert.equal(isMyWorkReconciliationManagedKey(scheduler.dedupeKey), false);
});

test("integration reconciliation keeps only the current unresolved state active", async () => {
  const sourceRecordId = "INTEGRATION-F06-ALERT-TRUTH";
  const current = workItem(`integration:f06:Failed:${F06_ACTORS.jordan.email}`, {
    kind: "Integration Health",
    sourceType: "Integration Health",
    sourceRecordId,
  });
  const superseded = workItem(`integration:f06:Degraded:${F06_ACTORS.jordan.email}`, {
    kind: "Integration Health",
    sourceType: "Integration Health",
    sourceRecordId,
  });
  await upsertWorkItem(db, current);
  await upsertWorkItem(db, superseded);

  await closeResolvedIntegrationWork(db, sourceRecordId, new Set([current.dedupeKey]), "F-06 state transition");

  assert.equal(runtime.database.one("SELECT status FROM command_work_items WHERE dedupe_key = ?", current.dedupeKey).status, "Open");
  assert.equal(runtime.database.one("SELECT status FROM command_work_items WHERE dedupe_key = ?", superseded.dedupeKey).status, "Completed");
  assert.equal(runtime.database.one("SELECT count(*) AS count FROM work_item_audits WHERE work_item_id = (SELECT id FROM command_work_items WHERE dedupe_key = ?) AND action = 'Automatically Resolved'", superseded.dedupeKey).count, 1);
});

test("the My Work snapshot is read-only", async () => {
  const beforeChanges = runtime.database.one("SELECT total_changes() AS count").count;
  const snapshot = await loadMyWorkSnapshot(F06_ACTORS.jordan, new Date("2026-08-23T13:00:00.000Z"));
  const afterChanges = runtime.database.one("SELECT total_changes() AS count").count;

  assert.equal(afterChanges, beforeChanges);
  assert.ok(snapshot.items.length >= 2);
  assert.equal(snapshot.preferences.recipientEmail, F06_ACTORS.jordan.email);
  assert.equal(snapshot.delivery.status, "Connection Required");
});

test("the interactive GET path loads a snapshot and never runs reconciliation or delivery", async () => {
  const [route, myWork] = await Promise.all([
    readFile(new URL("../app/api/my-work/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/my-work.ts", import.meta.url), "utf8"),
  ]);
  const getRoute = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const reconciliation = myWork.slice(myWork.indexOf("export async function syncMyWork"), myWork.indexOf("export async function loadMyWorkSnapshot"));

  assert.match(getRoute, /loadMyWorkSnapshot/);
  assert.doesNotMatch(getRoute, /ensureMyWorkTables|syncMyWork/);
  assert.doesNotMatch(reconciliation, /ensureVendorSchema|ensureMeetingTables|runDeterministicMeetingRules|processOperationalEmailQueue|processOperationalPushQueue/);
  assert.match(route, /recordFirstPartyFailure/);
  assert.match(route, /X-Request-Id/);
});
