import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";

import { issueCommandSessionCookie } from "../../lib/microsoft-entra-auth";

const F06_TEST_AUTH_STATE_KEY = "3evP3Z_nDO9_oM5wDUyhT6uY0qOBoAt5jZsLpIledEY";

const projectRoot = new URL("../../", import.meta.url);

export const F06_ACTORS = Object.freeze({
  jordan: { name: "Jordan Mefford", email: "jmefford@meffcon.com", accessLevel: "Company Owner", designations: ["Company Leadership"] },
  blain: { name: "Blain Faulkner", email: "it@meffcon.com", accessLevel: "Administrator", designations: ["IT Administrator"] },
  projectManager: { name: "Pat Project", email: "pm.test@meffcon.com", accessLevel: "Employee", designations: ["Project Manager"] },
  superintendent: { name: "Sam Superintendent", email: "super.test@meffcon.com", accessLevel: "Employee", designations: ["Superintendent"] },
  accountant: { name: "Alex Accountant", email: "accounting.test@meffcon.com", accessLevel: "Employee", designations: ["Accountant"] },
  employee: { name: "Erin Employee", email: "employee.test@meffcon.com", accessLevel: "Employee", designations: [] },
  inactive: { name: "Ian Inactive", email: "inactive.test@meffcon.com", accessLevel: "Employee", designations: [] },
});

export class F06D1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    if (bindings.length > (this.database.maxBindings ?? Infinity)) throw new Error("D1 bound parameter limit exceeded");
    return new F06D1Statement(this.database, this.sql, bindings);
  }

  async first(columnName) {
    this.database.beforeStatement(this.sql);
    const row = this.database.sqlite.prepare(this.sql).get(...this.bindings) || null;
    if (columnName) return row ? row[columnName] ?? null : null;
    return row;
  }

  async all() {
    this.database.beforeStatement(this.sql);
    const results = this.database.sqlite.prepare(this.sql).all(...this.bindings);
    return { success: true, results, meta: this.database.meta(0) };
  }

  async raw(options = {}) {
    this.database.beforeStatement(this.sql);
    const statement = this.database.sqlite.prepare(this.sql);
    const rows = statement.all(...this.bindings);
    const columns = statement.columns().map((column) => column.name);
    const values = rows.map((row) => columns.map((column) => row[column]));
    return options.columnNames ? [columns, ...values] : values;
  }

  async run() {
    return this.runNow();
  }

  runNow() {
    this.database.beforeStatement(this.sql);
    // D1 batch returns rows for SELECT statements, just like .all(). Keeping
    // that behavior matters for bundles containing several independent reads.
    if (/^\s*SELECT\b/i.test(this.sql)) {
      const results = this.database.sqlite.prepare(this.sql).all(...this.bindings);
      return { success: true, results, meta: this.database.meta(0) };
    }
    const result = this.database.sqlite.prepare(this.sql).run(...this.bindings);
    const changes = Number(result.changes || 0);
    return {
      success: true,
      results: [],
      meta: this.database.meta(changes, result.lastInsertRowid),
    };
  }
}

export class F06D1Database {
  constructor(sqlite = new DatabaseSync(":memory:")) {
    this.sqlite = sqlite;
    this.statementCount = 0;
    this.failure = null;
  }

  prepare(sql) {
    return new F06D1Statement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      // D1 executes a batch atomically. Do not yield between SQLite statements,
      // which would let a second request enter this in-memory transaction.
      for (const statement of statements) results.push(statement.runNow());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.beforeStatement(sql);
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  beforeStatement(sql) {
    this.statementCount += 1;
    if (!this.failure) return;
    const patternMatches = !this.failure.pattern || this.failure.pattern.test(sql);
    const countMatches = !this.failure.after || this.statementCount >= this.failure.after;
    if (patternMatches && countMatches) {
      if (this.failure.once) this.failure = null;
      throw new Error("F-06 injected D1 failure");
    }
  }

  injectFailure({ pattern, after = 0, once = true } = {}) {
    this.failure = { pattern, after, once };
  }

  clearFailure() {
    this.failure = null;
  }

  query(sql, ...bindings) {
    return this.sqlite.prepare(sql).all(...bindings);
  }

  one(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) || null;
  }

  meta(changes, lastInsertRowid = 0) {
    return {
      changed_db: changes > 0,
      changes,
      duration: 0,
      last_row_id: Number(lastInsertRowid || 0),
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
    };
  }

  close() {
    this.sqlite.close();
  }
}

class F06R2Object {
  constructor(key, bytes, metadata = {}) {
    this.key = key;
    this.bytes = bytes;
    this.size = bytes.byteLength;
    this.etag = `f06-${key}-${bytes.byteLength}`;
    this.uploaded = new Date("2026-08-23T12:00:00.000Z");
    this.httpMetadata = metadata.httpMetadata || {};
    this.customMetadata = metadata.customMetadata || {};
    this.body = new Blob([bytes]).stream();
  }

  async arrayBuffer() { return this.bytes.slice().buffer; }
  async text() { return new TextDecoder().decode(this.bytes); }
  async json() { return JSON.parse(await this.text()); }
  writeHttpMetadata(headers) {
    for (const [name, value] of Object.entries(this.httpMetadata)) headers.set(name, String(value));
  }
}

export class F06R2Bucket {
  constructor() {
    this.objects = new Map();
    this.uploads = new Map();
    this.operationCount = 0;
    this.failure = null;
  }

  async put(key, value, options = {}) {
    this.beforeOperation("put", key);
    const bytes = await toBytes(value);
    this.objects.set(key, { bytes, options });
    return new F06R2Object(key, bytes, options);
  }

  async createMultipartUpload(key, options = {}) {
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { key, options, parts: new Map() });
    return this.resumeMultipartUpload(key, uploadId);
  }

  resumeMultipartUpload(key, uploadId) {
    const state = () => {
      const upload = this.uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("Unknown multipart upload");
      return upload;
    };
    return {
      key, uploadId,
      uploadPart: async (partNumber, value) => {
        const bytes = await toBytes(value);
        const part = { partNumber, etag: "part-" + partNumber + "-" + bytes.length, bytes };
        state().parts.set(partNumber, part);
        return { partNumber, etag: part.etag };
      },
      complete: async parts => {
        const upload = state();
        const bytes = parts.map(part => {
          const stored = upload.parts.get(part.partNumber);
          if (!stored || stored.etag !== part.etag) throw new Error("Invalid multipart part");
          return stored.bytes;
        });
        const object = await this.put(key, new Blob(bytes), upload.options);
        this.uploads.delete(uploadId);
        return object;
      },
      abort: async () => { state(); this.uploads.delete(uploadId); },
    };
  }

  async get(key) {
    this.beforeOperation("get", key);
    const stored = this.objects.get(key);
    return stored ? new F06R2Object(key, stored.bytes, stored.options) : null;
  }

  async head(key) {
    this.beforeOperation("head", key);
    const stored = this.objects.get(key);
    return stored ? new F06R2Object(key, stored.bytes, stored.options) : null;
  }

  async delete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      this.beforeOperation("delete", key);
      this.objects.delete(key);
    }
  }

  async list({ prefix = "", cursor } = {}) {
    this.beforeOperation("list", prefix);
    const all = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const keys = all.slice(start, start + 1000);
    const next = start + keys.length;
    return {
      objects: keys.map((key) => new F06R2Object(key, this.objects.get(key).bytes, this.objects.get(key).options)),
      truncated: next < all.length,
      cursor: next < all.length ? String(next) : undefined,
    };
  }

  injectFailure({ operation, keyPattern, after = 0, once = true } = {}) {
    this.failure = { operation, keyPattern, after, once };
  }

  clearFailure() { this.failure = null; }

  beforeOperation(operation, key) {
    this.operationCount += 1;
    if (!this.failure) return;
    const operationMatches = !this.failure.operation || this.failure.operation === operation;
    const keyMatches = !this.failure.keyPattern || this.failure.keyPattern.test(key);
    const countMatches = !this.failure.after || this.operationCount >= this.failure.after;
    if (operationMatches && keyMatches && countMatches) {
      if (this.failure.once) this.failure = null;
      throw new Error("F-06 injected R2 failure");
    }
  }
}

export async function createF06Runtime({ env = {} } = {}) {
  const database = new F06D1Database();
  await applyAllMigrations(database);
  const bucket = new F06R2Bucket();
  const runtimeEnv = {
    DB: database,
    BUCKET: bucket,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    MICROSOFT_ACCESS_CONTROL_ENFORCED: "false",
    MICROSOFT_GRAPH_AUTH_STATE_KEY: F06_TEST_AUTH_STATE_KEY,
    ...env,
  };
  globalThis.__MEFFORD_F06_RUNTIME_ENV__ = runtimeEnv;
  await seedActors(database);
  return {
    database,
    bucket,
    env: runtimeEnv,
    request: (path, options = {}) => makeRequest(path, options),
    async dispose() {
      delete globalThis.__MEFFORD_F06_RUNTIME_ENV__;
      database.close();
    },
  };
}

export async function applyAllMigrations(database) {
  const migrationDirectory = new URL("../../drizzle/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  database.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationDirectory), "utf8");
    database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
        database.sqlite.exec(statement);
      }
      database.sqlite.exec("COMMIT");
    } catch (error) {
      database.sqlite.exec("ROLLBACK");
      throw new Error(`F-06 migration replay failed at ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return files;
}

export async function seedActors(database) {
  const insert = database.sqlite.prepare(`INSERT OR REPLACE INTO company_members
    (email, display_name, company_access_level, designations_json, is_active, identity_provider, provider_subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'f06_test_identity', ?, '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z')`);
  for (const actor of Object.values(F06_ACTORS)) {
    insert.run(actor.email, actor.name, actor.accessLevel, JSON.stringify(actor.designations), actor === F06_ACTORS.inactive ? 0 : 1, `f06-${actor.email}`);
  }
}

export async function activateActor(database, actor, { department = "Office" } = {}) {
  const now = "2026-08-23T12:00:00.000Z";
  const data = {
    email: actor.email,
    name: actor.name,
    hireDate: "2020-01-01",
    department,
    accessLevel: actor.accessLevel,
    designations: actor.designations,
    lifecycleStatus: "Active",
    grandfathered: true,
    initialActivatedAt: now,
    lastApprovedCycle: 2026,
    completions: {},
  };
  await database.prepare(`INSERT OR REPLACE INTO command_records
    (project_id, id, record_type, title, status, owner, due, meta, data_json, record_date, created_at, updated_at)
    VALUES ('MEFFORD-PEOPLE', ?, 'Employee Onboarding', ?, 'Active', ?, '', 'F-06 activated test identity', ?, '2026-08-23', ?, ?)`)
    .bind(`EMP-${actor.email}`, `${actor.name} Onboarding`, actor.name, JSON.stringify(data), now, now)
    .run();
}

export async function markCleanStartCompleted(database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS system_data_resets (
    id text PRIMARY KEY NOT NULL,
    status text NOT NULL,
    requested_by text NOT NULL,
    requested_by_email text NOT NULL,
    preservation_policy text NOT NULL,
    claim_token text NOT NULL DEFAULT '',
    lease_expires_at text NOT NULL DEFAULT '',
    inventory_json text NOT NULL DEFAULT '{}',
    counts_json text NOT NULL DEFAULT '{}',
    error_message text NOT NULL DEFAULT '',
    started_at text NOT NULL DEFAULT '',
    completed_at text NOT NULL DEFAULT '',
    created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await database.prepare(`INSERT OR REPLACE INTO system_data_resets
    (id, status, requested_by, requested_by_email, preservation_policy, completed_at, updated_at)
    VALUES ('OWNER-AUTHORIZED-CLEAN-START-2026-08-23', 'Completed', 'Jordan Mefford', 'jmefford@meffcon.com', 'F-06 isolated harness', '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z')`).run();
}

// A real browser reuses one session cookie across many requests rather than
// negotiating a fresh one each time; caching by email also keeps concurrent
// requests in a test from being skewed apart by the cookie's AES-GCM
// encryption, which otherwise perturbs races the test intentionally creates
// (e.g. two simultaneous mutations where one must lose with a 409).
const sessionCookiePairs = new Map();
async function sessionCookiePairFor(email) {
  if (!sessionCookiePairs.has(email)) {
    sessionCookiePairs.set(email, issueCommandSessionCookie(email).then((cookie) => cookie.split(";")[0]));
  }
  return sessionCookiePairs.get(email);
}

export async function makeRequest(path, { actor, method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (actor) {
    const sessionCookiePair = await sessionCookiePairFor(actor.email);
    const existingCookie = requestHeaders.get("cookie");
    requestHeaders.set("cookie", existingCookie ? `${existingCookie}; ${sessionCookiePair}` : sessionCookiePair);
  }
  const binary = body instanceof Uint8Array || body instanceof ArrayBuffer;
  if (body !== undefined && !(body instanceof FormData) && !binary) requestHeaders.set("content-type", "application/json");
  return new Request(new URL(path, "https://command-center.f06.test"), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : body instanceof FormData || binary ? body : JSON.stringify(body),
  });
}

export function projectRootUrl(path = "") {
  return new URL(path, projectRoot);
}

async function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}
