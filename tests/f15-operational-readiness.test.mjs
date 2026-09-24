import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { applyAllMigrations, F06D1Database } from "./support/f06-runtime-harness.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("F-15 application shell is below the de-optimization threshold and major workspaces are lazy boundaries", async () => {
  const [shell, shellStat] = await Promise.all([read("app/page.tsx"), stat(new URL("app/page.tsx", root))]);
  assert.ok(shellStat.size < 500_000, `application shell is ${shellStat.size} bytes`);
  assert.match(shell, /lazy\(\(\) => import\("\.\/schedule-workspace"\)/);
  assert.match(shell, /lazy\(\(\) => import\("\.\/team-access-workspace"\)/);
});

test("F-15 repository contains production operator, deployment, recovery, retention, cutover, and architecture controls", async () => {
  const required = ["README.md", "docs/OPERATOR_HANDBOOK.md", "docs/DEPLOYMENT_AND_ROLLBACK.md", "docs/BACKUP_RESTORE_DR.md", "docs/RETENTION_POLICY.md", "docs/INTEGRATION_CUTOVER.md", "docs/architecture/ADR-0001-BOUNDARIES_AND_OWNERSHIP.md"];
  for (const path of required) assert.ok((await read(path)).length > 300, `${path} is not operationally substantive`);
  assert.match(await read("docs/BACKUP_RESTORE_DR.md"), /RPO[\s\S]*RTO[\s\S]*Quarterly/);
  assert.match(await read("docs/RETENTION_POLICY.md"), /legal hold[\s\S]*controlled quarantine/i);
  const cutover = await read("docs/INTEGRATION_CUTOVER.md");
  assert.match(cutover, /one provider and workflow at a time/i);
  assert.match(cutover, /verified provider evidence/i);
});

test("F-15 clean recovery target can replay the complete production schema and accept critical records", async (t) => {
  const database = new F06D1Database();
  t.after(() => database.close());
  const files = await applyAllMigrations(database);
  assert.equal(files.at(-1), "0042_aromatic_the_executioner.sql");
  assert.equal(database.one("SELECT account_number FROM accounting_account_number_crosswalk WHERE legacy_number = '402'").account_number, "4020");
  database.sqlite.prepare("INSERT INTO command_records (project_id,id,record_type,title,owner,due,status,meta,data_json) VALUES ('DR-TEST','REC-1','Recovery Drill','Verified Schema','IT Administrator','2026-08-23','Recovered','','{}')").run();
  database.sqlite.prepare("INSERT INTO record_audits (project_id,record_id,field_name,old_value,new_value,reason,actor_name,actor_email,summary) VALUES ('DR-TEST','REC-1','Recovery','Unavailable','Verified','F-15 isolated restore drill','IT Administrator','it@meffcon.com','Clean migration replay accepted linked audit evidence')").run();
  assert.equal(database.one("SELECT count(*) AS count FROM record_audits WHERE project_id='DR-TEST'").count, 1);
});
