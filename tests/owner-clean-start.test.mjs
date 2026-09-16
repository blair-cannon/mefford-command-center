import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [cleanStart, worker, directory, actor, onboarding, snapshot] = await Promise.all([
  readFile(new URL("../lib/clean-start.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/company-directory.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/server-actor.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/meta/0020_snapshot.json", import.meta.url), "utf8").then(JSON.parse),
]);

const removedPeople = [
  "khenry@meffcon.com",
  "emefford@meffcon.com",
  "hfrye@meffcon.com",
  "janderson@meffcon.com",
  "aneal@meffcon.com",
];

test("the owner-authorized clean start runs before recurring automation", () => {
  const resetIndex = worker.indexOf("await runOwnerAuthorizedCleanStart");
  const schedulerIndex = worker.indexOf("await runCommandSchedulerCycle");
  assert.ok(resetIndex >= 0);
  assert.ok(schedulerIndex > resetIndex);
  assert.match(cleanStart, /OWNER-AUTHORIZED-CLEAN-START-2026-08-23/);
  assert.match(cleanStart, /status = 'Completed'/);
  assert.match(cleanStart, /Clean-start verification failed/);
  assert.match(worker, /request\.method === "GET" && url\.pathname === "\/"/);
  assert.match(worker, /Home-page clean-start trigger failed; the independent scheduler will retry/);
});

test("every current operational table is explicitly covered or deliberately preserved", () => {
  const deliberatelyHandled = new Set([
    "command_records",
    "company_members",
    "project_files",
    "record_audits",
  ]);
  for (const table of Object.keys(snapshot.tables)) {
    assert.ok(
      deliberatelyHandled.has(table) || cleanStart.includes(`"${table}"`),
      `${table} is missing from the clean-start policy`,
    );
  }
  for (const runtimeTable of ["automation_heartbeat_claims", "owner_deletion_receipts", "scheduled_operation_runs"]) {
    assert.match(cleanStart, new RegExp(`"${runtimeTable}"`));
  }
  assert.doesNotMatch(cleanStart, /DELETE FROM system_data_resets/);
});

test("the reset preserves controlled masters and company-required files", () => {
  assert.match(cleanStart, /project_id = 'MEFFORD-REVIEW'/);
  assert.match(cleanStart, /ONBOARDING-TEMPLATE-MASTER/);
  assert.match(cleanStart, /Onboarding Document Template/);
  assert.match(cleanStart, /Schedule Template/);
  assert.match(cleanStart, /project_id NOT IN \('MEFFORD-REVIEW', 'MEFFORD-PEOPLE'\)/);
  assert.match(cleanStart, /bucket\.list/);
  assert.match(cleanStart, /bucket\.delete/);
});

test("only Jordan and Blain remain and removed users cannot be automatically recreated", () => {
  assert.match(cleanStart, /jmefford@meffcon\.com/);
  assert.match(cleanStart, /it@meffcon\.com/);
  assert.match(directory, /Jordan Mefford/);
  assert.match(directory, /Blain Faulkner/);
  for (const email of removedPeople) {
    assert.doesNotMatch(directory, new RegExp(email.replace(".", "\\.")));
    assert.doesNotMatch(actor, new RegExp(email.replace(".", "\\.")));
  }
  assert.doesNotMatch(onboarding, /Initial Safety Director Assignment|PEOPLE-ROLE-SAFETY-DIRECTOR/);
});

test("the reset records inventory, a preservation policy, storage counts, and final verification", () => {
  assert.match(cleanStart, /inventory_json/);
  assert.match(cleanStart, /preservation_policy/);
  assert.match(cleanStart, /storage/);
  assert.match(cleanStart, /unauthorizedUsers/);
  assert.match(cleanStart, /unauthorizedRecords/);
  assert.match(cleanStart, /unauthorizedFiles/);
  assert.match(cleanStart, /retainedUsers === RETAINED_COMPANY_USERS\.length/);
});
