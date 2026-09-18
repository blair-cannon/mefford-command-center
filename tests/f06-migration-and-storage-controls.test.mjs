import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyAllMigrations,
  F06D1Database,
  F06R2Bucket,
} from "./support/f06-runtime-harness.mjs";

test("every migration replays from zero and produces the complete critical schema", async (t) => {
  const database = new F06D1Database();
  t.after(() => database.close());
  const files = await applyAllMigrations(database);
  assert.equal(files.length, 41);
  assert.equal(files[0], "0000_robust_mockingbird.sql");
  assert.equal(files.at(-1), "0040_fine_salo.sql");
  assert.equal(database.one("SELECT count(*) AS count FROM accounting_account_number_crosswalk").count, 900);

  const tables = database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  assert.ok(tables.length >= 64, `only ${tables.length} application tables were created`);
  for (const table of [
    "projects",
    "project_files",
    "project_bonus_controls", "project_bonus_agreements", "project_bonus_audits",
    "command_records",
    "company_members",
    "proposal_write_guards",
    "estimate_write_guards",
    "meeting_agenda_refresh_guards",
    "meeting_turnovers",
    "meeting_turnover_recovery",
    "accounting_events",
    "accounting_journal_entries",
    "accounting_journal_lines",
    "accounting_periods",
    "scheduler_cycle_checkpoints",
    "scheduler_cycle_cursors",
    "automation_heartbeat_claims",
    "scheduled_operation_runs",
    "owner_contract_revisions",
    "microsoft_access_grants",
    "microsoft_graph_subscriptions",
    "microsoft_graph_webhook_security_events",
    "command_identity_aliases",
    "owner_deletion_requests",
    "runtime_failure_events",
    "domain_events",
    "domain_event_consumers",
    "domain_event_audits",
    "template_governance_versions",
    "template_governance_approvals",
    "template_output_evidence",
    "dashboard_change_revisions",
    "proposal_profiles",
    "proposal_project_experience",
    "proposal_customer_branding",
    "owner_approval_snapshots",
  ]) assert.ok(tables.includes(table), `${table} is absent after a clean migration replay`);

  const indexes = new Set(database.query("SELECT name FROM sqlite_master WHERE type = 'index'").map((row) => row.name));
  for (const index of [
    "accounting_events_idempotency_key_unique",
    "accounting_journal_entries_event_id_unique",
    "project_files_storage_key_unique",
    "project_bonus_revision_idx", "project_bonus_payment_idx", "project_bonus_audit_agreement_idx",
    "owner_contract_revision_number_idx",
    "owner_approval_snapshots_source_idx",
    "meeting_turnover_source_idx",
    "meeting_turnovers_occurrence_id_unique",
    "microsoft_access_grants_email_idx",
    "domain_events_idempotency_idx",
    "domain_event_consumers_event_key_idx",
    "template_governance_current_idx",
    "template_governance_approval_version_idx",
    "template_output_evidence_template_idx",
    "automation_heartbeat_claims_claimed_idx",
    "scheduled_operation_runs_status_idx",
  ]) assert.ok(indexes.has(index), `${index} is missing`);
});

test("critical uniqueness controls reject duplicate financial, file, contract, and Microsoft identities", async (t) => {
  const database = new F06D1Database();
  t.after(() => database.close());
  await applyAllMigrations(database);

  database.sqlite.prepare(`INSERT INTO accounting_events
    (id, idempotency_key, event_type, source_type, source_project_id, source_record_id, event_date, description, status, amount_cents, actor_name, actor_email, metadata_json)
    VALUES (?, 'SAME-EVENT', 'Test', 'Test', '', 'R1', '2026-08-23', 'Test', 'Posted', 100, 'Jordan', 'jmefford@meffcon.com', '{}')`).run("AE-1");
  assert.throws(() => database.sqlite.prepare(`INSERT INTO accounting_events
    (id, idempotency_key, event_type, source_type, source_project_id, source_record_id, event_date, description, status, amount_cents, actor_name, actor_email, metadata_json)
    VALUES (?, 'SAME-EVENT', 'Test', 'Test', '', 'R2', '2026-08-23', 'Test', 'Posted', 100, 'Jordan', 'jmefford@meffcon.com', '{}')`).run("AE-2"), /UNIQUE/i);

  const fileInsert = database.sqlite.prepare(`INSERT INTO project_files
    (project_id, name, category, revision, storage_key, content_type, size_bytes, uploaded_by, access)
    VALUES (?, ?, 'Contract', '1', 'same/storage/key', 'application/pdf', 12, 'Jordan', 'Internal')`);
  fileInsert.run("26001", "one.pdf");
  assert.throws(() => fileInsert.run("26002", "two.pdf"), /UNIQUE/i);

  const revisionInsert = database.sqlite.prepare(`INSERT INTO owner_contract_revisions
    (id, project_id, contract_record_id, revision_number, phase, contract_type, fields_json, snapshot_hash, created_by_type, created_by_name, created_by_email)
    VALUES (?, '26001', 'CONTRACT-1', 1, 'Draft', 'Plan & Spec Lump Sum', '{}', ?, 'Internal', 'Jordan', 'jmefford@meffcon.com')`);
  revisionInsert.run("REV-1", "HASH-1");
  assert.throws(() => revisionInsert.run("REV-2", "HASH-2"), /UNIQUE/i);

  const grantInsert = database.sqlite.prepare(`INSERT INTO microsoft_access_grants
    (provider_subject, microsoft_email, access_status, company_access_level)
    VALUES (?, 'employee@meffcon.com', 'No Access', 'Employee')`);
  grantInsert.run("entra-1");
  assert.throws(() => grantInsert.run("entra-2"), /UNIQUE/i);
});

test("D1 batch failure rolls back the entire business transaction", async (t) => {
  const database = new F06D1Database();
  t.after(() => database.close());
  database.sqlite.exec("CREATE TABLE atomic_control (id text PRIMARY KEY, value text NOT NULL)");
  database.injectFailure({ pattern: /SECOND-CONTROL/, once: true });
  await assert.rejects(() => database.batch([
    database.prepare("INSERT INTO atomic_control (id, value) VALUES ('FIRST-CONTROL', 'saved')"),
    database.prepare("INSERT INTO atomic_control (id, value) VALUES ('SECOND-CONTROL', 'must fail')"),
  ]), /injected D1 failure/);
  assert.equal(database.one("SELECT count(*) AS count FROM atomic_control").count, 0);
});

test("R2 failures are observable and never masquerade as a successful file operation", async () => {
  const bucket = new F06R2Bucket();
  bucket.injectFailure({ operation: "put", keyPattern: /controlled/, once: true });
  await assert.rejects(() => bucket.put("projects/controlled.pdf", "evidence"), /injected R2 failure/);
  assert.equal(await bucket.head("projects/controlled.pdf"), null);

  await bucket.put("projects/controlled.pdf", "evidence");
  bucket.injectFailure({ operation: "delete", keyPattern: /controlled/, once: true });
  await assert.rejects(() => bucket.delete("projects/controlled.pdf"), /injected R2 failure/);
  assert.ok(await bucket.head("projects/controlled.pdf"), "failed delete must leave the source object observable");
});
