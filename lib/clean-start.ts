const CLEAN_START_ID = "OWNER-AUTHORIZED-CLEAN-START-2026-08-23";
const CLEAN_START_ACTOR = "Jordan Mefford";
const CLEAN_START_ACTOR_EMAIL = "jmefford@meffcon.com";

export const RETAINED_COMPANY_USERS = [
  {
    email: "jmefford@meffcon.com",
    displayName: "Jordan Mefford",
    accessLevel: "Company Owner",
    designationsJson: "[]",
  },
  {
    email: "it@meffcon.com",
    displayName: "Blain Faulkner",
    accessLevel: "Employee",
    designationsJson: "[\"IT Administrator\"]",
  },
] as const;

export const PRESERVED_FILE_PROJECTS = ["MEFFORD-REVIEW", "MEFFORD-PEOPLE"] as const;

// This registry is deliberately explicit. The reset never builds table names
// from live data, and it never touches migrations, static templates, or the
// one-time reset evidence table.
export const CLEAN_START_FULL_RESET_TABLES = [
  "accounting_bank_reconciliations",
  "accounting_bank_transactions",
  "accounting_cash_forecast_items",
  "accounting_close_tasks",
  "accounting_collection_actions",
  "accounting_cutover_controls",
  "accounting_events",
  "accounting_journal_entries",
  "accounting_journal_lines",
  "accounting_periods",
  "accounting_wip_forecasts",
  "assistant_audits",
  "automation_heartbeat_claims",
  "command_notifications",
  "command_work_items",
  "employee_feedback",
  "employee_leave_balances",
  "employee_leave_requests",
  "employee_profiles",
  "employee_service_requests",
  "meeting_action_items",
  "meeting_agenda_items",
  "meeting_attachments",
  "meeting_attendees",
  "meeting_audits",
  "meeting_decisions",
  "meeting_occurrences",
  "meeting_series",
  "meeting_sync_events",
  "microsoft_access_audits",
  "microsoft_access_grants",
  "microsoft_activity_audits",
  "microsoft_directory_sync_runs",
  "microsoft_directory_users",
  "microsoft_graph_subscription_audits",
  "microsoft_graph_subscriptions",
  "mobile_device_audits",
  "mobile_device_sessions",
  "notification_delivery_events",
  "notification_preferences",
  "owner_contract_change_requests",
  "owner_contract_revisions",
  "owner_deletion_receipts",
  "owner_portal_access",
  "owner_portal_audits",
  "owner_portal_invites",
  "proposal_customer_branding",
  "proposal_profiles",
  "proposal_project_experience",
  "projects",
  "scheduled_operation_dead_letters",
  "scheduled_operation_gaps",
  "scheduled_operation_leases",
  "scheduled_operation_runs",
  "scheduler_cycle_checkpoints",
  "scheduler_cycle_cursors",
  "scheduler_trigger_receipts",
  "vendor_audits",
  "vendor_compliance_documents",
  "vendor_compliance_overrides",
  "vendor_invites",
  "vendor_profiles",
  "vendor_project_access",
  "vendor_submissions",
  "work_item_audits",
] as const;

type TableRow = { name: string };
type CountRow = { count: number };
type ResetRow = { status: string; claim_token: string; lease_expires_at: string };
type FileKeyRow = { storage_key: string };

type ResetStatement = {
  bind: (...values: unknown[]) => ResetStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type CleanStartDatabase = {
  prepare(query: string): ResetStatement;
  batch(statements: ResetStatement[]): Promise<unknown>;
};

export type CleanStartBucket = {
  list: (options: { limit: number; cursor?: string }) => Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete: (keys: string | string[]) => Promise<void>;
};

export async function runOwnerAuthorizedCleanStart(
  db: CleanStartDatabase,
  bucket: CleanStartBucket,
) {
  await ensureResetEvidenceTable(db);
  const now = new Date();
  const existing = await db.prepare(
    "SELECT status, claim_token, lease_expires_at FROM system_data_resets WHERE id = ?",
  ).bind(CLEAN_START_ID).first<ResetRow>();
  if (existing?.status === "Completed") return { status: "Already Completed" as const };

  const claimToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  await db.prepare(`INSERT OR IGNORE INTO system_data_resets
    (id, status, requested_by, requested_by_email, preservation_policy, claim_token, lease_expires_at, started_at, updated_at)
    VALUES (?, 'Pending', ?, ?, ?, '', '', '', ?)`)
    .bind(CLEAN_START_ID, CLEAN_START_ACTOR, CLEAN_START_ACTOR_EMAIL, preservationPolicy(), now.toISOString()).run();
  await db.prepare(`UPDATE system_data_resets
    SET status = 'Running', claim_token = ?, lease_expires_at = ?, started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END, error_message = '', updated_at = ?
    WHERE id = ? AND (status IN ('Pending', 'Failed') OR (status = 'Running' AND lease_expires_at <= ?))`)
    .bind(claimToken, leaseExpiresAt, now.toISOString(), now.toISOString(), CLEAN_START_ID, now.toISOString()).run();
  const claim = await db.prepare(
    "SELECT status, claim_token, lease_expires_at FROM system_data_resets WHERE id = ?",
  ).bind(CLEAN_START_ID).first<ResetRow>();
  if (claim?.claim_token !== claimToken || claim.status !== "Running") return { status: "Already Running" as const };

  try {
    const existingTables = await existingApplicationTables(db);
    const inventory = await inventoryCounts(db, existingTables);
    await db.prepare(`UPDATE system_data_resets SET inventory_json = CASE WHEN inventory_json = '{}' THEN ? ELSE inventory_json END, updated_at = ? WHERE id = ? AND claim_token = ?`)
      .bind(JSON.stringify(inventory), new Date().toISOString(), CLEAN_START_ID, claimToken).run();

    await clearOperationalTables(db, existingTables);
    await preserveOnlyAuthorizedCoreData(db);
    const storage = await clearUnpreservedStorage(db, bucket);
    const verification = await verifyCleanStart(db, existingTables);
    if (!verification.verified) throw new Error(`Clean-start verification failed: ${JSON.stringify(verification)}`);

    const completedAt = new Date().toISOString();
    const result = { inventory, storage, verification };
    await db.prepare(`UPDATE system_data_resets
      SET status = 'Completed', completed_at = ?, counts_json = ?, error_message = '', lease_expires_at = '', updated_at = ?
      WHERE id = ? AND claim_token = ?`)
      .bind(completedAt, JSON.stringify(result), completedAt, CLEAN_START_ID, claimToken).run();
    console.info("Owner-authorized Command Center clean start completed", JSON.stringify(result));
    return { status: "Completed" as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown clean-start failure";
    const failedAt = new Date().toISOString();
    await db.prepare(`UPDATE system_data_resets
      SET status = 'Failed', error_message = ?, lease_expires_at = '', updated_at = ?
      WHERE id = ? AND claim_token = ?`)
      .bind(message.slice(0, 2_000), failedAt, CLEAN_START_ID, claimToken).run();
    console.error("Owner-authorized Command Center clean start failed", message);
    throw error;
  }
}

async function ensureResetEvidenceTable(db: CleanStartDatabase) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS system_data_resets (
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
}

async function existingApplicationTables(db: CleanStartDatabase) {
  const rows = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all<TableRow>();
  return new Set((rows.results || []).map((row) => row.name));
}

async function inventoryCounts(db: CleanStartDatabase, existingTables: Set<string>) {
  const tables = [
    ...CLEAN_START_FULL_RESET_TABLES,
    "command_records",
    "record_audits",
    "project_files",
    "company_members",
  ].filter((table) => existingTables.has(table));
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db.prepare(`SELECT count(*) AS count FROM "${table}"`).first<CountRow>();
    counts[table] = Number(row?.count || 0);
  }
  return counts;
}

async function clearOperationalTables(db: CleanStartDatabase, existingTables: Set<string>) {
  const statements = CLEAN_START_FULL_RESET_TABLES
    .filter((table) => existingTables.has(table))
    .map((table) => db.prepare(`DELETE FROM "${table}"`));
  for (let index = 0; index < statements.length; index += 40) {
    await db.batch(statements.slice(index, index + 40));
  }
}

async function preserveOnlyAuthorizedCoreData(db: CleanStartDatabase) {
  await db.batch([
    db.prepare(`DELETE FROM command_records WHERE NOT (
      project_id = 'MEFFORD-REVIEW'
      OR (project_id = 'MEFFORD-COMPANY' AND record_type = 'Schedule Template')
      OR (project_id = 'MEFFORD-PEOPLE' AND (
        id IN ('ONBOARDING-TEMPLATE-MASTER', 'ONBOARDING-OUTSIDE-COUNSEL', 'EMPLOYEE-EXPERIENCE-RESOURCES', 'EMP-jmefford@meffcon.com', 'EMP-it@meffcon.com')
        OR record_type = 'Onboarding Document Template'
        OR (record_type = 'Onboarding Document Submission' AND lower(owner) IN ('jmefford@meffcon.com', 'it@meffcon.com'))
      ))
    )`),
    db.prepare(`DELETE FROM record_audits WHERE project_id <> 'MEFFORD-REVIEW' AND NOT EXISTS (
      SELECT 1 FROM command_records
      WHERE command_records.project_id = record_audits.project_id
        AND command_records.id = record_audits.record_id
    )`),
    db.prepare("DELETE FROM project_files WHERE project_id NOT IN ('MEFFORD-REVIEW', 'MEFFORD-PEOPLE')"),
    db.prepare("DELETE FROM company_members WHERE lower(email) NOT IN ('jmefford@meffcon.com', 'it@meffcon.com')"),
  ]);
  for (const user of RETAINED_COMPANY_USERS) {
    await db.prepare(`INSERT OR IGNORE INTO company_members
      (email, display_name, company_access_level, designations_json, is_active, identity_provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'microsoft_entra_pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(user.email, user.displayName, user.accessLevel, user.designationsJson).run();
  }
}

async function clearUnpreservedStorage(db: CleanStartDatabase, bucket: CleanStartBucket) {
  const preservedRows = await db.prepare(
    "SELECT storage_key FROM project_files WHERE project_id IN ('MEFFORD-REVIEW', 'MEFFORD-PEOPLE')",
  ).all<FileKeyRow>();
  const preserved = new Set((preservedRows.results || []).map((row) => row.storage_key).filter(Boolean));
  let cursor: string | undefined;
  let inspected = 0;
  const remove: string[] = [];
  do {
    const page = await bucket.list({ limit: 1_000, ...(cursor ? { cursor } : {}) });
    const keys = page.objects.map((object) => object.key);
    inspected += keys.length;
    remove.push(...keys.filter((key) => !preserved.has(key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let index = 0; index < remove.length; index += 100) {
    await bucket.delete(remove.slice(index, index + 100));
  }
  return { inspected, deleted: remove.length, preserved: preserved.size };
}

async function verifyCleanStart(db: CleanStartDatabase, existingTables: Set<string>) {
  let operationalRows = 0;
  for (const table of CLEAN_START_FULL_RESET_TABLES.filter((name) => existingTables.has(name))) {
    const row = await db.prepare(`SELECT count(*) AS count FROM "${table}"`).first<CountRow>();
    operationalRows += Number(row?.count || 0);
  }
  const [projects, unauthorizedUsers, unauthorizedRecords, unauthorizedFiles, retainedUsers] = await Promise.all([
    db.prepare("SELECT count(*) AS count FROM projects").first<CountRow>(),
    db.prepare("SELECT count(*) AS count FROM company_members WHERE lower(email) NOT IN ('jmefford@meffcon.com', 'it@meffcon.com')").first<CountRow>(),
    db.prepare(`SELECT count(*) AS count FROM command_records WHERE NOT (
      project_id = 'MEFFORD-REVIEW'
      OR (project_id = 'MEFFORD-COMPANY' AND record_type = 'Schedule Template')
      OR (project_id = 'MEFFORD-PEOPLE' AND (
        id IN ('ONBOARDING-TEMPLATE-MASTER', 'ONBOARDING-OUTSIDE-COUNSEL', 'EMPLOYEE-EXPERIENCE-RESOURCES', 'EMP-jmefford@meffcon.com', 'EMP-it@meffcon.com')
        OR record_type = 'Onboarding Document Template'
        OR (record_type = 'Onboarding Document Submission' AND lower(owner) IN ('jmefford@meffcon.com', 'it@meffcon.com'))
      ))
    )`).first<CountRow>(),
    db.prepare("SELECT count(*) AS count FROM project_files WHERE project_id NOT IN ('MEFFORD-REVIEW', 'MEFFORD-PEOPLE')").first<CountRow>(),
    db.prepare("SELECT count(*) AS count FROM company_members WHERE lower(email) IN ('jmefford@meffcon.com', 'it@meffcon.com')").first<CountRow>(),
  ]);
  const result = {
    projects: Number(projects?.count || 0),
    operationalRows,
    unauthorizedUsers: Number(unauthorizedUsers?.count || 0),
    unauthorizedRecords: Number(unauthorizedRecords?.count || 0),
    unauthorizedFiles: Number(unauthorizedFiles?.count || 0),
    retainedUsers: Number(retainedUsers?.count || 0),
  };
  return {
    ...result,
    verified: result.projects === 0
      && result.operationalRows === 0
      && result.unauthorizedUsers === 0
      && result.unauthorizedRecords === 0
      && result.unauthorizedFiles === 0
      && result.retainedUsers === RETAINED_COMPANY_USERS.length,
  };
}

function preservationPolicy() {
  return JSON.stringify({
    retainedUsers: RETAINED_COMPANY_USERS.map((user) => user.email),
    retainedFileScopes: PRESERVED_FILE_PROJECTS,
    retainedRecords: [
      "Controlled Review Center masters and review history",
      "Annual onboarding and onboarding-document templates",
      "Jordan and Blain employee lifecycle records",
      "Employee resource and outside-counsel company configuration",
      "Saved company schedule templates",
    ],
    staticTemplates: "All version-controlled contract, spreadsheet, quality, safety, and workflow templates remain in application source",
  });
}
