import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CLEAN_START_FULL_RESET_TABLES,
  runOwnerAuthorizedCleanStart,
} from "../lib/clean-start.ts";

class PreparedStatement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new PreparedStatement(this.database, this.query, values);
  }

  async first() {
    return this.database.prepare(this.query).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.query).all(...this.values) };
  }

  async run() {
    return this.database.prepare(this.query).run(...this.values);
  }
}

class IsolatedD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(query) {
    return new PreparedStatement(this.database, query);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) await statement.run();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class IsolatedBucket {
  constructor(keys) {
    this.keys = new Set(keys);
  }

  async list() {
    return { objects: [...this.keys].sort().map((key) => ({ key })), truncated: false };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.keys.delete(key);
  }
}

test("the clean-start operation deletes live-like data and preserves only controlled masters", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = new IsolatedD1(sqlite);
  sqlite.exec(`
    CREATE TABLE command_records (project_id text NOT NULL, id text NOT NULL, record_type text NOT NULL, owner text NOT NULL, PRIMARY KEY(project_id, id));
    CREATE TABLE record_audits (id integer PRIMARY KEY AUTOINCREMENT, project_id text NOT NULL, record_id text NOT NULL);
    CREATE TABLE project_files (id integer PRIMARY KEY AUTOINCREMENT, project_id text NOT NULL, storage_key text NOT NULL);
    CREATE TABLE company_members (email text PRIMARY KEY, display_name text NOT NULL, company_access_level text NOT NULL, designations_json text NOT NULL, is_active integer NOT NULL, identity_provider text NOT NULL, provider_subject text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  for (const table of CLEAN_START_FULL_RESET_TABLES) {
    sqlite.exec(`CREATE TABLE "${table}" (id text, project_id text)`);
    sqlite.prepare(`INSERT INTO "${table}" (id, project_id) VALUES (?, ?)`).run(`ROW-${table}`, "26001");
  }
  const insertRecord = sqlite.prepare("INSERT INTO command_records (project_id, id, record_type, owner) VALUES (?, ?, ?, ?)");
  insertRecord.run("26001", "RFI-1", "RFIs", "Removed User");
  insertRecord.run("MEFFORD-SALES", "OPP-1", "Sales Opportunities", "Removed User");
  insertRecord.run("MEFFORD-REVIEW", "TR-owner-contract-2026", "Template Annual Review", "Jordan Mefford");
  insertRecord.run("MEFFORD-COMPANY", "SCHEDULE-TEMPLATE-1", "Schedule Template", "Jordan Mefford");
  insertRecord.run("MEFFORD-PEOPLE", "ONBOARDING-TEMPLATE-MASTER", "Onboarding Template", "Company Administration");
  insertRecord.run("MEFFORD-PEOPLE", "EMP-jmefford@meffcon.com", "Employee Onboarding", "Jordan Mefford");
  insertRecord.run("MEFFORD-PEOPLE", "EMP-it@meffcon.com", "Employee Onboarding", "Blain Faulkner");
  insertRecord.run("MEFFORD-PEOPLE", "EMP-old@meffcon.com", "Employee Onboarding", "Old Employee");
  insertRecord.run("MEFFORD-PEOPLE", "ONBOARDING-DOC-old", "Onboarding Document Submission", "old@meffcon.com");
  insertRecord.run("MEFFORD-PEOPLE", "ONBOARDING-DOC-blain", "Onboarding Document Submission", "it@meffcon.com");
  sqlite.exec(`
    INSERT INTO record_audits (project_id, record_id) VALUES ('26001', 'RFI-1'), ('MEFFORD-REVIEW', 'owner-contract:master-files');
    INSERT INTO project_files (project_id, storage_key) VALUES ('26001', 'projects/rfi.pdf'), ('MEFFORD-REVIEW', 'masters/contract.docx'), ('MEFFORD-PEOPLE', 'people/training.mp4');
    INSERT INTO company_members (email, display_name, company_access_level, designations_json, is_active, identity_provider) VALUES
      ('jmefford@meffcon.com', 'Jordan Mefford', 'Company Owner', '[]', 1, 'microsoft_entra_pending'),
      ('it@meffcon.com', 'Blain Faulkner', 'Employee', '["IT Administrator"]', 1, 'microsoft_entra_pending'),
      ('old@meffcon.com', 'Old Employee', 'Employee', '[]', 1, 'microsoft_entra_pending');
  `);
  const bucket = new IsolatedBucket([
    "projects/rfi.pdf",
    "masters/contract.docx",
    "people/training.mp4",
    "orphaned/old-file.pdf",
  ]);

  const result = await runOwnerAuthorizedCleanStart(db, bucket);
  assert.equal(result.status, "Completed");
  assert.equal(result.verification.verified, true);
  assert.equal(sqlite.prepare("SELECT count(*) count FROM projects").get().count, 0);
  assert.deepEqual(
    sqlite.prepare("SELECT email FROM company_members ORDER BY email").all().map((row) => row.email),
    ["it@meffcon.com", "jmefford@meffcon.com"],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT project_id, id FROM command_records ORDER BY project_id, id").all().map((row) => ({ project_id: row.project_id, id: row.id })),
    [
      { project_id: "MEFFORD-COMPANY", id: "SCHEDULE-TEMPLATE-1" },
      { project_id: "MEFFORD-PEOPLE", id: "EMP-it@meffcon.com" },
      { project_id: "MEFFORD-PEOPLE", id: "EMP-jmefford@meffcon.com" },
      { project_id: "MEFFORD-PEOPLE", id: "ONBOARDING-DOC-blain" },
      { project_id: "MEFFORD-PEOPLE", id: "ONBOARDING-TEMPLATE-MASTER" },
      { project_id: "MEFFORD-REVIEW", id: "TR-owner-contract-2026" },
    ],
  );
  assert.deepEqual([...bucket.keys].sort(), ["masters/contract.docx", "people/training.mp4"]);
  assert.equal((await runOwnerAuthorizedCleanStart(db, bucket)).status, "Already Completed");
  sqlite.close();
});
