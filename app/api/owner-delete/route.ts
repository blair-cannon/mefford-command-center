import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { resolveCommandActor, type CommandActor } from "../../../lib/server-actor";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const QUARANTINE_DAYS = 30;
const OPERATION_LEASE_MINUTES = 15;
const FINAL_PURGE_PREFIX = "PERMANENTLY DELETE ";

type DeleteKind = "project" | "estimate";
type DeletePayload = { kind?: DeleteKind; targetId?: string; confirmation?: string };
type LifecyclePayload = { action?: "restore" | "purge"; requestId?: string; confirmation?: string };
type ProjectRow = { number: string; name: string; status: string } & Record<string, unknown>;
type CommandRow = { project_id: string; id: string; record_type: string; title: string; status: string; data_json: string } & Record<string, unknown>;
type CountRow = { count: number };
type DeletionRequestRow = {
  id: string;
  target_kind: DeleteKind;
  target_id: string;
  target_name: string;
  state: string;
  phase: string;
  manifest_storage_key: string;
  manifest_hash: string;
  manifest_counts_json: string;
  requested_by_name: string;
  requested_by_email: string;
  requested_at: string;
  purge_after: string;
  restored_at: string | null;
  database_purged_at: string | null;
  storage_purged_at: string | null;
  manifest_purged_at: string | null;
  operation_token: string;
  operation_started_at: string | null;
  error_message: string;
};

type ProjectManifest = {
  schemaVersion: "OWNER-DELETION-MANIFEST-1";
  requestId: string;
  kind: "project";
  capturedAt: string;
  target: { id: string; name: string };
  project: ProjectRow;
  directTables: Array<{ table: string; rows: Array<Record<string, unknown>> }>;
  seriesIds: string[];
  occurrenceIds: string[];
  dependentTables: Array<{ table: string; rows: Array<Record<string, unknown>> }>;
  workItemIds: string[];
  journalEntries: Array<{ id: string; event_id: string }>;
  linkedGlobalRows: CommandRow[];
  salesLinks: CommandRow[];
  fileKeys: string[];
  counts: Record<string, number>;
};

type EstimateManifest = {
  schemaVersion: "OWNER-DELETION-MANIFEST-1";
  requestId: string;
  kind: "estimate";
  capturedAt: string;
  target: { id: string; name: string };
  targetRow: CommandRow;
  relatedRows: CommandRow[];
  relatedSubmissions: Array<Record<string, unknown>>;
  relatedWorkItems: Array<Record<string, unknown>>;
  fileScopes: string[];
  files: Array<Record<string, unknown>>;
  fileKeys: string[];
  counts: Record<string, number>;
};

type DeletionManifest = ProjectManifest | EstimateManifest;

const PROJECT_SCOPED_TABLES = [
  "accounting_cash_forecast_items", "accounting_collection_actions", "accounting_journal_lines",
  "accounting_wip_forecasts", "assistant_audits", "command_notifications", "command_records",
  "command_work_items", "meeting_action_items", "meeting_series", "owner_contract_change_requests",
  "owner_contract_revisions", "owner_portal_access", "owner_portal_audits", "owner_portal_invites",
  "project_files", "record_audits", "vendor_compliance_overrides", "vendor_project_access", "vendor_submissions",
] as const;

const DEPENDENT_MEETING_TABLES = [
  "meeting_attendees", "meeting_agenda_items", "meeting_decisions", "meeting_attachments",
  "meeting_audits", "meeting_sync_events",
] as const;

export async function GET(request: Request) {
  const access = await ownerAccess(request);
  if (access.response) return access.response;
  const url = new URL(request.url);
  await ensureDeletionSchema(access.database!);
  if (url.searchParams.get("view") === "quarantine") {
    const rows = await access.database!.prepare(
      `SELECT id, target_kind, target_id, target_name, state, phase, manifest_counts_json,
              requested_by_name, requested_by_email, requested_at, purge_after,
              database_purged_at, storage_purged_at, operation_started_at, error_message
       FROM owner_deletion_requests
       WHERE state IN ('Quarantined', 'Restore Failed', 'Restoring', 'Purge Failed', 'Purging', 'Database Purged', 'Storage Purged')
       ORDER BY requested_at DESC`,
    ).all<Record<string, unknown>>();
    const now = Date.now();
    return Response.json({
      requests: rows.results.map((row) => ({
        ...row,
        counts: parseObject(String(row.manifest_counts_json || "{}")),
        purgeReady: new Date(String(row.purge_after || "")).getTime() <= now,
        operationStale: operationIsStale(String(row.operation_started_at || ""), now),
        restoreAvailable: restoreIsAvailable(row, now),
        purgeAvailable: purgeIsAvailable(row, now),
        purgeConfirmation: finalPurgeConfirmation(String(row.target_name || "")),
      })),
      policy: deletionPolicy(),
    });
  }
  const kind = url.searchParams.get("kind") === "estimate" ? "estimate" : "project";
  const targetId = url.searchParams.get("targetId")?.trim() || "";
  if (!targetId) return Response.json({ error: "A deletion target is required." }, { status: 400 });
  try {
    const preview = kind === "project"
      ? await previewProject(access.database!, targetId)
      : await previewEstimate(access.database!, targetId);
    return Response.json({ preview: { ...preview, recoveryDays: QUARANTINE_DAYS }, policy: deletionPolicy() });
  } catch (error) {
    return deletionError(error);
  }
}

export async function DELETE(request: Request) {
  const access = await ownerAccess(request);
  if (access.response) return access.response;
  try {
    await ensureDeletionSchema(access.database!);
    const payload = (await request.json()) as DeletePayload;
    const kind = payload.kind === "estimate" ? "estimate" : "project";
    const targetId = payload.targetId?.trim() || "";
    if (!targetId) return Response.json({ error: "A deletion target is required." }, { status: 400 });
    const preview = kind === "project"
      ? await previewProject(access.database!, targetId)
      : await previewEstimate(access.database!, targetId);
    if (payload.confirmation?.trim() !== preview.targetName) {
      return Response.json({ error: `Type ${preview.targetName} exactly to confirm deletion quarantine.` }, { status: 400 });
    }
    const active = await access.database!.prepare(
      `SELECT id, state, purge_after FROM owner_deletion_requests
       WHERE target_kind = ? AND target_id = ? AND state IN ('Quarantined', 'Restore Failed', 'Restoring', 'Purge Failed', 'Purging', 'Database Purged', 'Storage Purged')
       ORDER BY requested_at DESC LIMIT 1`,
    ).bind(kind, targetId).first<{ id: string; state: string; purge_after: string }>();
    if (active) return Response.json({ error: "This item is already in deletion quarantine.", requestId: active.id, purgeAfter: active.purge_after }, { status: 409 });

    const requestId = `DELETE-${kind.toUpperCase()}-${crypto.randomUUID()}`;
    const manifest = kind === "project"
      ? await snapshotProject(access.database!, targetId, requestId)
      : await snapshotEstimate(access.database!, targetId, requestId);
    const manifestText = JSON.stringify(manifest);
    const manifestHash = await sha256(manifestText);
    const manifestStorageKey = `deletion-quarantine/${requestId}/manifest.json`;
    const { env } = await import("cloudflare:workers");
    await env.BUCKET.put(manifestStorageKey, manifestText, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { schemaVersion: manifest.schemaVersion, sha256: manifestHash, targetKind: kind, targetId },
    });
    const verifiedObject = await env.BUCKET.get(manifestStorageKey);
    if (!verifiedObject || await sha256(await verifiedObject.text()) !== manifestHash) throw new Error("MANIFEST_VERIFICATION_FAILED");

    const now = new Date();
    const requestedAt = now.toISOString();
    const purgeAfter = new Date(now.getTime() + QUARANTINE_DAYS * 86_400_000).toISOString();
    const statements: D1PreparedStatement[] = [
      access.database!.prepare(
        `INSERT INTO owner_deletion_requests
          (id, target_kind, target_id, target_name, state, phase, manifest_storage_key, manifest_hash,
           manifest_counts_json, requested_by_name, requested_by_email, requested_at, purge_after, updated_at)
         VALUES (?, ?, ?, ?, 'Quarantined', 'Snapshot Verified', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(requestId, kind, targetId, preview.targetName, manifestStorageKey, manifestHash, JSON.stringify(manifest.counts), access.actor!.name, access.actor!.email, requestedAt, purgeAfter, requestedAt),
    ];
    if (kind === "project") {
      statements.push(access.database!.prepare("UPDATE projects SET status = 'Deletion Quarantine', updated_at = ? WHERE number = ?").bind(requestedAt, targetId));
      statements.push(access.database!.prepare("UPDATE command_work_items SET status = 'Quarantined', updated_at = ? WHERE project_id = ? AND status <> 'Completed'").bind(requestedAt, targetId));
    } else {
      statements.push(access.database!.prepare("UPDATE command_records SET status = 'Deletion Quarantine', updated_at = ? WHERE project_id = ? AND id = ?").bind(requestedAt, SALES_PROJECT_ID, targetId));
      for (const item of (manifest as EstimateManifest).relatedWorkItems) statements.push(access.database!.prepare("UPDATE command_work_items SET status = 'Quarantined', updated_at = ? WHERE id = ? AND status <> 'Completed'").bind(requestedAt, String(item.id || "")));
    }
    await access.database!.batch(statements);
    return Response.json({
      deleted: true,
      quarantined: true,
      kind,
      targetId,
      targetName: preview.targetName,
      requestId,
      purgeAfter,
      recoveryDays: QUARANTINE_DAYS,
      counts: manifest.counts,
      retained: "All database rows and file objects remain recoverable until a separately verified purge after the cooling period.",
    });
  } catch (error) {
    return deletionError(error);
  }
}

export async function POST(request: Request) {
  const access = await ownerAccess(request);
  if (access.response) return access.response;
  try {
    await ensureDeletionSchema(access.database!);
    const payload = (await request.json()) as LifecyclePayload;
    const requestId = payload.requestId?.trim() || "";
    if (!requestId || !["restore", "purge"].includes(payload.action || "")) return Response.json({ error: "A deletion request and supported action are required." }, { status: 400 });
    const row = await access.database!.prepare("SELECT * FROM owner_deletion_requests WHERE id = ? LIMIT 1").bind(requestId).first<DeletionRequestRow>();
    if (!row) return Response.json({ error: "Deletion request not found." }, { status: 404 });
    if (payload.action === "purge") {
      const required = finalPurgeConfirmation(row.target_name);
      if (payload.confirmation !== required) return Response.json({ error: `Type ${required} exactly to authorize the irreversible purge.` }, { status: 400 });
      if (new Date(row.purge_after).getTime() > Date.now()) return Response.json({ error: `The recovery cooling period remains active until ${row.purge_after}.` }, { status: 409 });
    }
    let manifest: DeletionManifest | null = null;
    try {
      manifest = await verifiedManifest(row);
    } catch (error) {
      const missingAfterDataDisposition = isMissingManifest(error) && (
        (payload.action === "restore" && Boolean(row.restored_at))
        || (payload.action === "purge" && Boolean(row.database_purged_at) && Boolean(row.storage_purged_at))
      );
      if (!missingAfterDataDisposition) throw error;
    }
    const operationToken = await claimDeletionOperation(access.database!, row, payload.action!, access.actor!);
    if (payload.action === "restore") return restoreDeletion(access.database!, row, manifest, access.actor!, operationToken);
    return purgeDeletion(access.database!, row, manifest, access.actor!, operationToken);
  } catch (error) {
    return deletionError(error);
  }
}

async function ownerAccess(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return { response: Response.json({ error: "Authentication required" }, { status: 401 }) };
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return { response: onboardingLock };
  if (actor.accessLevel !== "Company Owner") return { response: Response.json({ error: "Company Owner access is required for controlled deletion." }, { status: 403 }) };
  const { env } = await import("cloudflare:workers");
  return { actor, database: env.DB, response: null as Response | null };
}

async function claimDeletionOperation(database: D1Database, request: DeletionRequestRow, action: "restore" | "purge", actor: CommandActor) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - OPERATION_LEASE_MINUTES * 60_000).toISOString();
  const statement = action === "restore"
    ? database.prepare(`UPDATE owner_deletion_requests
        SET state = 'Restoring', phase = 'Restore In Progress', operation_token = ?, operation_started_at = ?, operation_actor_email = ?, error_message = '', updated_at = ?
        WHERE id = ? AND (
          state IN ('Quarantined', 'Restore Failed')
          OR (state = 'Purge Failed' AND database_purged_at IS NULL)
          OR (state = 'Restoring' AND (operation_started_at IS NULL OR operation_started_at <= ?))
        )`).bind(token, now, actor.email, now, request.id, staleBefore)
    : database.prepare(`UPDATE owner_deletion_requests
        SET state = 'Purging', phase = ?, operation_token = ?, operation_started_at = ?, operation_actor_email = ?, purge_started_at = COALESCE(purge_started_at, ?), error_message = '', updated_at = ?
        WHERE id = ? AND (
          state IN ('Quarantined', 'Purge Failed', 'Database Purged', 'Storage Purged')
          OR (state = 'Purging' AND (operation_started_at IS NULL OR operation_started_at <= ?))
        )`).bind(request.database_purged_at ? request.storage_purged_at ? "Recovery Manifest Purge" : "Storage Purge" : "Database Purge", token, now, actor.email, now, now, request.id, staleBefore);
  if (affectedRows(await statement.run()) !== 1) throw new Error("DELETION_OPERATION_CONFLICT");
  return token;
}

async function guardedRun(statement: D1PreparedStatement) {
  if (affectedRows(await statement.run()) !== 1) throw new Error("DELETION_OPERATION_CONFLICT");
}

function affectedRows(result: unknown) {
  const value = result as { changes?: number; meta?: { changes?: number } };
  return Number(value.meta?.changes ?? value.changes ?? 0);
}

function operationIsStale(value: string, now = Date.now()) {
  const started = new Date(value).getTime();
  return !Number.isFinite(started) || started <= now - OPERATION_LEASE_MINUTES * 60_000;
}

function restoreIsAvailable(row: Record<string, unknown>, now = Date.now()) {
  const state = String(row.state || "");
  if (state === "Quarantined" || state === "Restore Failed") return true;
  if (state === "Purge Failed" && !row.database_purged_at) return true;
  return state === "Restoring" && operationIsStale(String(row.operation_started_at || ""), now);
}

function purgeIsAvailable(row: Record<string, unknown>, now = Date.now()) {
  if (new Date(String(row.purge_after || "")).getTime() > now) return false;
  const state = String(row.state || "");
  if (["Quarantined", "Purge Failed", "Database Purged", "Storage Purged"].includes(state)) return true;
  return state === "Purging" && operationIsStale(String(row.operation_started_at || ""), now);
}

export function finalPurgeConfirmation(targetName: string) {
  return `${FINAL_PURGE_PREFIX}${targetName}`;
}

async function previewProject(database: D1Database, projectId: string) {
  const project = await database.prepare("SELECT number, name FROM projects WHERE number = ? AND status <> 'Deletion Quarantine' LIMIT 1").bind(projectId).first<{ number: string; name: string }>();
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const [records, files, linked] = await Promise.all([
    database.prepare("SELECT count(*) AS count FROM command_records WHERE project_id = ?").bind(projectId).first<CountRow>(),
    database.prepare("SELECT count(*) AS count FROM project_files WHERE project_id = ?").bind(projectId).first<CountRow>(),
    countProjectRows(database, projectId),
  ]);
  return { kind: "project" as const, targetId: project.number, targetName: project.name, records: records?.count || 0, files: files?.count || 0, linkedRows: linked, linkedProjectNumber: "" };
}

async function previewEstimate(database: D1Database, opportunityId: string) {
  const target = await database.prepare("SELECT project_id, id, record_type, title, status, data_json FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Sales Opportunities' AND status <> 'Deletion Quarantine' LIMIT 1").bind(SALES_PROJECT_ID, opportunityId).first<CommandRow>();
  if (!target) throw new Error("ESTIMATE_NOT_FOUND");
  const rows = await salesRows(database);
  const related = relatedEstimateRows(rows, opportunityId);
  const fileScopes = [`ESTIMATE-${opportunityId}`, `DESIGN-${opportunityId}`];
  const files = await countAcrossScopes(database, "project_files", fileScopes);
  const data = parseObject(target.data_json);
  return { kind: "estimate" as const, targetId: opportunityId, targetName: target.title, records: related.length, files, linkedRows: related.length + files, linkedProjectNumber: String(data.awardedProjectNumber || data.projectNumber || "") };
}

async function snapshotProject(database: D1Database, projectId: string, requestId: string): Promise<ProjectManifest> {
  const project = await database.prepare("SELECT * FROM projects WHERE number = ? LIMIT 1").bind(projectId).first<ProjectRow>();
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const directTables = await tablesWithProjectRows(database, projectId);
  const seriesIds = rowsFrom(directTables, "meeting_series").map((row) => String(row.id || ""));
  const occurrenceRows = await rowsForValues(database, "meeting_occurrences", "series_id", seriesIds);
  const occurrenceIds = occurrenceRows.map((row) => String(row.id || ""));
  const dependentTables: ProjectManifest["dependentTables"] = [{ table: "meeting_occurrences", rows: occurrenceRows }];
  for (const table of DEPENDENT_MEETING_TABLES) {
    const occurrenceDependents = await rowsForValues(database, table, "occurrence_id", occurrenceIds);
    const seriesDependents = ["meeting_audits", "meeting_sync_events"].includes(table)
      ? await rowsForValues(database, table, "series_id", seriesIds)
      : [];
    const uniqueRows = new Map<string, Record<string, unknown>>();
    [...occurrenceDependents, ...seriesDependents].forEach((row) => uniqueRows.set(String(row.id || JSON.stringify(row)), row));
    dependentTables.push({ table, rows: [...uniqueRows.values()] });
  }
  const workItemIds = rowsFrom(directTables, "command_work_items").map((row) => String(row.id || ""));
  dependentTables.push({ table: "notification_delivery_events", rows: await rowsForValues(database, "notification_delivery_events", "work_item_id", workItemIds) });
  dependentTables.push({ table: "work_item_audits", rows: await rowsForValues(database, "work_item_audits", "work_item_id", workItemIds) });
  const journal = await database.prepare("SELECT DISTINCT e.* FROM accounting_journal_entries e LEFT JOIN accounting_journal_lines l ON l.entry_id = e.id WHERE e.source_project_id = ? OR l.project_id = ?").bind(projectId, projectId).all<Record<string, unknown>>();
  const journalEntries = journal.results.map((row) => ({ id: String(row.id || ""), event_id: String(row.event_id || "") }));
  dependentTables.push({ table: "accounting_journal_entries", rows: journal.results });
  dependentTables.push({ table: "accounting_events", rows: await rowsForValues(database, "accounting_events", "id", journalEntries.map((row) => row.event_id).filter(Boolean)) });
  const global = await database.prepare("SELECT project_id, id, record_type, title, status, data_json FROM command_records WHERE project_id <> ?").bind(projectId).all<CommandRow>();
  const linkedGlobalRows = global.results.filter((row) => row.project_id !== SALES_PROJECT_ID && containsExactValue(parseObject(row.data_json), projectId));
  const salesLinks = global.results.filter((row) => row.project_id === SALES_PROJECT_ID && row.record_type === "Sales Opportunities" && containsExactValue(parseObject(row.data_json), projectId));
  const fileKeys = new Set<string>();
  rowsFrom(directTables, "project_files").forEach((row) => row.storage_key && fileKeys.add(String(row.storage_key)));
  occurrenceRows.forEach((row) => { if (row.agenda_pdf_key) fileKeys.add(String(row.agenda_pdf_key)); if (row.minutes_pdf_key) fileKeys.add(String(row.minutes_pdf_key)); });
  rowsFrom(dependentTables, "meeting_attachments").forEach((row) => row.storage_key && fileKeys.add(String(row.storage_key)));
  rowsFrom(directTables, "vendor_submissions").forEach((row) => row.attachment_storage_key && fileKeys.add(String(row.attachment_storage_key)));
  const counts = { directRows: directTables.reduce((sum, table) => sum + table.rows.length, 0), dependentRows: dependentTables.reduce((sum, table) => sum + table.rows.length, 0), linkedRows: linkedGlobalRows.length + salesLinks.length, files: fileKeys.size };
  return { schemaVersion: "OWNER-DELETION-MANIFEST-1", requestId, kind: "project", capturedAt: new Date().toISOString(), target: { id: projectId, name: project.name }, project, directTables, seriesIds, occurrenceIds, dependentTables, workItemIds, journalEntries, linkedGlobalRows, salesLinks, fileKeys: [...fileKeys].sort(), counts };
}

async function snapshotEstimate(database: D1Database, opportunityId: string, requestId: string): Promise<EstimateManifest> {
  const target = await database.prepare("SELECT project_id, id, record_type, title, status, data_json FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Sales Opportunities' LIMIT 1").bind(SALES_PROJECT_ID, opportunityId).first<CommandRow>();
  if (!target) throw new Error("ESTIMATE_NOT_FOUND");
  const relatedRows = relatedEstimateRows(await salesRows(database), opportunityId);
  const relatedIds = new Set(relatedRows.map((row) => row.id));
  const fileScopes = [`ESTIMATE-${opportunityId}`, `DESIGN-${opportunityId}`];
  const files: Array<Record<string, unknown>> = [];
  for (const scope of fileScopes) files.push(...(await database.prepare("SELECT * FROM project_files WHERE project_id = ?").bind(scope).all<Record<string, unknown>>()).results);
  const submissions = await database.prepare("SELECT * FROM vendor_submissions WHERE project_id = ?").bind(SALES_PROJECT_ID).all<Record<string, unknown>>();
  const relatedSubmissions = submissions.results.filter((row) => containsAnyExactValue(parseObject(String(row.payload_json || "{}")), relatedIds));
  const workItems = await database.prepare("SELECT * FROM command_work_items WHERE project_id IN (?, ?, ?)").bind(SALES_PROJECT_ID, ...fileScopes).all<Record<string, unknown>>();
  const relatedWorkItems = workItems.results.filter((row) => fileScopes.includes(String(row.project_id || "")) || relatedIds.has(String(row.source_record_id || "")));
  const fileKeys = new Set<string>();
  files.forEach((row) => row.storage_key && fileKeys.add(String(row.storage_key)));
  relatedSubmissions.forEach((row) => row.attachment_storage_key && fileKeys.add(String(row.attachment_storage_key)));
  const counts = { records: relatedRows.length, submissions: relatedSubmissions.length, workItems: relatedWorkItems.length, files: fileKeys.size };
  return { schemaVersion: "OWNER-DELETION-MANIFEST-1", requestId, kind: "estimate", capturedAt: new Date().toISOString(), target: { id: opportunityId, name: target.title }, targetRow: target, relatedRows, relatedSubmissions, relatedWorkItems, fileScopes, files, fileKeys: [...fileKeys].sort(), counts };
}

async function restoreDeletion(database: D1Database, request: DeletionRequestRow, manifest: DeletionManifest | null, actor: CommandActor, operationToken: string) {
  let dataRestored = Boolean(request.restored_at);
  try {
    const now = new Date().toISOString();
    if (!dataRestored) {
      if (!manifest) throw new Error("VERIFIED_MANIFEST_MISSING");
      const statements: D1PreparedStatement[] = [];
      if (manifest.kind === "project") {
        statements.push(database.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE number = ?").bind(String(manifest.project.status || "Active"), now, manifest.target.id));
        for (const item of rowsFrom(manifest.directTables, "command_work_items")) statements.push(database.prepare("UPDATE command_work_items SET status = ?, updated_at = ? WHERE id = ?").bind(String(item.status || "Open"), now, String(item.id || "")));
      } else {
        statements.push(database.prepare("UPDATE command_records SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?").bind(manifest.targetRow.status, now, SALES_PROJECT_ID, manifest.target.id));
        for (const item of manifest.relatedWorkItems) statements.push(database.prepare("UPDATE command_work_items SET status = ?, updated_at = ? WHERE id = ?").bind(String(item.status || "Open"), now, String(item.id || "")));
      }
      statements.push(database.prepare("UPDATE owner_deletion_requests SET phase = 'Data Restored; Manifest Disposal Pending', restored_at = ?, restored_by_email = ?, operation_started_at = ?, error_message = '', updated_at = ? WHERE id = ? AND operation_token = ?").bind(now, actor.email, now, now, request.id, operationToken));
      await runBatches(database, statements);
      dataRestored = true;
    }

    const { env } = await import("cloudflare:workers");
    if (await env.BUCKET.head(request.manifest_storage_key)) await env.BUCKET.delete(request.manifest_storage_key);
    if (await env.BUCKET.head(request.manifest_storage_key)) throw new Error("MANIFEST_DISPOSAL_FAILED");
    const completedAt = new Date().toISOString();
    await guardedRun(database.prepare("UPDATE owner_deletion_requests SET state = 'Restored', phase = 'Restored And Recovery Manifest Destroyed', manifest_purged_at = ?, error_message = '', operation_token = '', operation_started_at = NULL, operation_actor_email = '', updated_at = ? WHERE id = ? AND operation_token = ?").bind(completedAt, completedAt, request.id, operationToken));
    return Response.json({ restored: true, requestId: request.id, targetId: request.target_id, targetName: request.target_name, manifestDestroyed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore failed";
    await database.prepare("UPDATE owner_deletion_requests SET state = 'Restore Failed', phase = ?, error_message = ?, operation_token = '', operation_started_at = NULL, operation_actor_email = '', updated_at = ? WHERE id = ? AND operation_token = ?")
      .bind(dataRestored ? "Data Restored; Manifest Disposal Failed" : "Resumable Restore Failed", message.slice(0, 1000), new Date().toISOString(), request.id, operationToken).run();
    throw error;
  }
}

async function purgeDeletion(database: D1Database, request: DeletionRequestRow, manifest: DeletionManifest | null, actor: CommandActor, operationToken: string) {
  let databasePurged = Boolean(request.database_purged_at);
  let storagePurged = Boolean(request.storage_purged_at);
  try {
    if (!databasePurged) {
      if (!manifest) throw new Error("VERIFIED_MANIFEST_MISSING");
      const current = manifest.kind === "project"
        ? await snapshotProject(database, manifest.target.id, manifest.requestId)
        : await snapshotEstimate(database, manifest.target.id, manifest.requestId);
      if (deletionScopeIdentity(current) !== deletionScopeIdentity(manifest)) throw new Error("QUARANTINE_SCOPE_DRIFT");
      if (manifest.kind === "project") await purgeProjectDatabase(database, manifest);
      else await purgeEstimateDatabase(database, manifest);
      const databaseCompletedAt = new Date().toISOString();
      await guardedRun(database.prepare("UPDATE owner_deletion_requests SET phase = 'Storage Purge Pending', database_purged_at = ?, operation_started_at = ?, updated_at = ? WHERE id = ? AND operation_token = ?").bind(databaseCompletedAt, databaseCompletedAt, databaseCompletedAt, request.id, operationToken));
      databasePurged = true;
    }
    const { env } = await import("cloudflare:workers");
    if (!storagePurged) {
      if (!manifest) throw new Error("VERIFIED_MANIFEST_MISSING");
      for (let index = 0; index < manifest.fileKeys.length; index += 100) await env.BUCKET.delete(manifest.fileKeys.slice(index, index + 100));
      for (const key of manifest.fileKeys) if (await env.BUCKET.head(key)) throw new Error(`STORAGE_RECONCILIATION_FAILED:${key}`);
      const storageCompletedAt = new Date().toISOString();
      await guardedRun(database.prepare("UPDATE owner_deletion_requests SET phase = 'Recovery Manifest Purge Pending', storage_purged_at = ?, operation_started_at = ?, updated_at = ? WHERE id = ? AND operation_token = ?").bind(storageCompletedAt, storageCompletedAt, storageCompletedAt, request.id, operationToken));
      storagePurged = true;
    }
    if (await env.BUCKET.head(request.manifest_storage_key)) await env.BUCKET.delete(request.manifest_storage_key);
    if (await env.BUCKET.head(request.manifest_storage_key)) throw new Error("MANIFEST_DISPOSAL_FAILED");
    const completedAt = new Date().toISOString();
    await guardedRun(database.prepare("UPDATE owner_deletion_requests SET phase = 'Receipt Finalization', operation_started_at = ?, updated_at = ? WHERE id = ? AND operation_token = ?").bind(completedAt, completedAt, request.id, operationToken));
    const finalResults = await database.batch([
      database.prepare("UPDATE owner_deletion_requests SET state = 'Purged', phase = 'Reconciled Complete; Recovery Manifest Destroyed', manifest_purged_at = ?, completed_at = ?, purge_confirmed_at = ?, purge_confirmed_by_email = ?, error_message = '', operation_token = '', operation_started_at = NULL, operation_actor_email = '', updated_at = ? WHERE id = ? AND operation_token = ?").bind(completedAt, completedAt, completedAt, actor.email, completedAt, request.id, operationToken),
      deletionReceipt(database, request.id, request.target_kind, request.target_id, request.target_name, actor, parseObject(request.manifest_counts_json)),
    ]);
    if (affectedRows((finalResults as unknown[])[0]) !== 1) throw new Error("DELETION_OPERATION_CONFLICT");
    return Response.json({ purged: true, requestId: request.id, targetId: request.target_id, targetName: request.target_name, counts: parseObject(request.manifest_counts_json), recoveryManifestDestroyed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purge failed";
    await database.prepare("UPDATE owner_deletion_requests SET state = 'Purge Failed', phase = ?, error_message = ?, operation_token = '', operation_started_at = NULL, operation_actor_email = '', updated_at = ? WHERE id = ? AND operation_token = ?")
      .bind(storagePurged ? "Recovery Manifest Purge Failed" : databasePurged ? "Storage Purge Failed" : "Resumable Purge Failed", message.slice(0, 1000), new Date().toISOString(), request.id, operationToken).run();
    throw error;
  }
}

async function purgeProjectDatabase(database: D1Database, manifest: ProjectManifest) {
  const statements: D1PreparedStatement[] = [];
  for (const id of manifest.workItemIds) {
    statements.push(database.prepare("DELETE FROM notification_delivery_events WHERE work_item_id = ?").bind(id));
    statements.push(database.prepare("DELETE FROM work_item_audits WHERE work_item_id = ?").bind(id));
  }
  for (const id of manifest.occurrenceIds) for (const table of DEPENDENT_MEETING_TABLES) statements.push(database.prepare(`DELETE FROM "${table}" WHERE occurrence_id = ?`).bind(id));
  for (const id of manifest.seriesIds) {
    statements.push(database.prepare("DELETE FROM meeting_audits WHERE series_id = ?").bind(id));
    statements.push(database.prepare("DELETE FROM meeting_sync_events WHERE series_id = ?").bind(id));
  }
  for (const id of manifest.seriesIds) statements.push(database.prepare("DELETE FROM meeting_occurrences WHERE series_id = ?").bind(id));
  for (const entry of manifest.journalEntries) {
    statements.push(database.prepare("DELETE FROM accounting_journal_lines WHERE entry_id = ?").bind(entry.id));
    statements.push(database.prepare("DELETE FROM accounting_journal_entries WHERE id = ?").bind(entry.id));
    if (entry.event_id) statements.push(database.prepare("DELETE FROM accounting_events WHERE id = ?").bind(entry.event_id));
  }
  for (const row of manifest.linkedGlobalRows) {
    statements.push(database.prepare("DELETE FROM record_audits WHERE project_id = ? AND record_id = ?").bind(row.project_id, row.id));
    statements.push(database.prepare("DELETE FROM command_records WHERE project_id = ? AND id = ?").bind(row.project_id, row.id));
  }
  for (const row of manifest.salesLinks) {
    const next = unlinkAwardedProject(parseObject(row.data_json), manifest.target.id);
    statements.push(database.prepare("UPDATE command_records SET status = ?, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?").bind(String(next.stage || row.status), JSON.stringify(next), new Date().toISOString(), SALES_PROJECT_ID, row.id));
  }
  for (const table of manifest.directTables.map((item) => item.table).filter((name) => name !== "accounting_journal_lines")) statements.push(database.prepare(`DELETE FROM "${table}" WHERE project_id = ?`).bind(manifest.target.id));
  statements.push(database.prepare("DELETE FROM accounting_events WHERE source_project_id = ?").bind(manifest.target.id));
  statements.push(database.prepare("DELETE FROM accounting_journal_entries WHERE source_project_id = ?").bind(manifest.target.id));
  statements.push(database.prepare("DELETE FROM projects WHERE number = ?").bind(manifest.target.id));
  await runBatches(database, statements);
}

async function purgeEstimateDatabase(database: D1Database, manifest: EstimateManifest) {
  const statements: D1PreparedStatement[] = [];
  for (const item of manifest.relatedWorkItems) {
    const id = String(item.id || "");
    statements.push(database.prepare("DELETE FROM notification_delivery_events WHERE work_item_id = ?").bind(id));
    statements.push(database.prepare("DELETE FROM work_item_audits WHERE work_item_id = ?").bind(id));
    statements.push(database.prepare("DELETE FROM command_work_items WHERE id = ?").bind(id));
  }
  for (const row of manifest.relatedRows) {
    statements.push(database.prepare("DELETE FROM record_audits WHERE project_id = ? AND record_id = ?").bind(SALES_PROJECT_ID, row.id));
    statements.push(database.prepare("DELETE FROM command_notifications WHERE project_id = ? AND (title LIKE ? OR message LIKE ?)").bind(SALES_PROJECT_ID, `%${row.id}%`, `%${row.id}%`));
    statements.push(database.prepare("DELETE FROM command_records WHERE project_id = ? AND id = ?").bind(SALES_PROJECT_ID, row.id));
  }
  for (const row of manifest.relatedSubmissions) statements.push(database.prepare("DELETE FROM vendor_submissions WHERE id = ?").bind(String(row.id || "")));
  for (const scope of manifest.fileScopes) statements.push(database.prepare("DELETE FROM project_files WHERE project_id = ?").bind(scope));
  await runBatches(database, statements);
}

async function verifiedManifest(request: DeletionRequestRow): Promise<DeletionManifest> {
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(request.manifest_storage_key);
  if (!object) throw new Error("VERIFIED_MANIFEST_MISSING");
  const text = await object.text();
  if (await sha256(text) !== request.manifest_hash) throw new Error("VERIFIED_MANIFEST_HASH_MISMATCH");
  const manifest = JSON.parse(text) as DeletionManifest;
  if (manifest.schemaVersion !== "OWNER-DELETION-MANIFEST-1" || manifest.requestId !== request.id || manifest.kind !== request.target_kind || manifest.target.id !== request.target_id) throw new Error("VERIFIED_MANIFEST_IDENTITY_MISMATCH");
  return manifest;
}

async function tablesWithProjectRows(database: D1Database, projectId: string) {
  const existing = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const names = new Set(existing.results.map((row) => row.name));
  const tables: ProjectManifest["directTables"] = [];
  for (const table of PROJECT_SCOPED_TABLES.filter((name) => names.has(name))) {
    const result = await database.prepare(`SELECT * FROM "${table}" WHERE project_id = ?`).bind(projectId).all<Record<string, unknown>>();
    tables.push({ table, rows: result.results });
  }
  return tables;
}

async function countProjectRows(database: D1Database, projectId: string) {
  const tables = await tablesWithProjectRows(database, projectId);
  return tables.reduce((sum, table) => sum + table.rows.length, 0);
}

async function rowsForValues(database: D1Database, table: string, column: string, values: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const value of values) rows.push(...(await database.prepare(`SELECT * FROM "${table}" WHERE "${column}" = ?`).bind(value).all<Record<string, unknown>>()).results);
  return rows;
}

function rowsFrom(tables: Array<{ table: string; rows: Array<Record<string, unknown>> }>, table: string) {
  return tables.find((item) => item.table === table)?.rows || [];
}

export function deletionScopeIdentity(manifest: DeletionManifest) {
  const identity = manifest.kind === "project"
    ? {
        kind: manifest.kind,
        target: manifest.target.id,
        direct: tableScopeIdentity(manifest.directTables),
        dependent: tableScopeIdentity(manifest.dependentTables),
        seriesIds: [...manifest.seriesIds].sort(),
        occurrenceIds: [...manifest.occurrenceIds].sort(),
        workItemIds: [...manifest.workItemIds].sort(),
        journalEntries: manifest.journalEntries.map((row) => `${row.id}:${row.event_id}`).sort(),
        linkedGlobalRows: manifest.linkedGlobalRows.map((row) => `${row.project_id}:${row.id}`).sort(),
        salesLinks: manifest.salesLinks.map((row) => `${row.project_id}:${row.id}`).sort(),
        fileKeys: [...manifest.fileKeys].sort(),
      }
    : {
        kind: manifest.kind,
        target: manifest.target.id,
        relatedRows: manifest.relatedRows.map((row) => `${row.project_id}:${row.id}`).sort(),
        submissions: manifest.relatedSubmissions.map((row) => rowScopeIdentity(row)).sort(),
        workItems: manifest.relatedWorkItems.map((row) => rowScopeIdentity(row)).sort(),
        fileScopes: [...manifest.fileScopes].sort(),
        files: manifest.files.map((row) => rowScopeIdentity(row)).sort(),
        fileKeys: [...manifest.fileKeys].sort(),
      };
  return JSON.stringify(identity);
}

function tableScopeIdentity(tables: Array<{ table: string; rows: Array<Record<string, unknown>> }>) {
  return tables
    .map((item) => ({ table: item.table, rows: item.rows.map((row) => rowScopeIdentity(row)).sort() }))
    .sort((left, right) => left.table.localeCompare(right.table));
}

function rowScopeIdentity(row: Record<string, unknown>) {
  const identityKeys = [
    "id", "number", "project_id", "record_id", "work_item_id", "series_id", "occurrence_id",
    "entry_id", "event_id", "contract_record_id", "revision_number", "billing_id", "line_number",
    "source_record_id", "storage_key", "attachment_storage_key",
  ];
  const identity = Object.fromEntries(identityKeys.filter((key) => key in row).map((key) => [key, row[key]]));
  return JSON.stringify(Object.keys(identity).length ? identity : stableObject(row));
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableObject(item)]));
}

async function salesRows(database: D1Database) {
  return (await database.prepare("SELECT project_id, id, record_type, title, status, data_json FROM command_records WHERE project_id = ?").bind(SALES_PROJECT_ID).all<CommandRow>()).results;
}

function relatedEstimateRows(rows: CommandRow[], opportunityId: string) {
  const ids = new Set([opportunityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!ids.has(row.id) && containsAnyExactValue(parseObject(row.data_json), ids)) { ids.add(row.id); changed = true; }
  }
  return rows.filter((row) => ids.has(row.id));
}

async function countAcrossScopes(database: D1Database, table: string, scopes: string[]) {
  let count = 0;
  for (const scope of scopes) count += (await database.prepare(`SELECT count(*) AS count FROM "${table}" WHERE project_id = ?`).bind(scope).first<CountRow>())?.count || 0;
  return count;
}

function containsAnyExactValue(value: unknown, targets: Set<string>): boolean {
  if (typeof value === "string") return targets.has(value);
  if (Array.isArray(value)) return value.some((item) => containsAnyExactValue(item, targets));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => containsAnyExactValue(item, targets));
  return false;
}

function containsExactValue(value: unknown, target: string) { return containsAnyExactValue(value, new Set([target])); }

function parseObject(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

function unlinkAwardedProject(data: Record<string, unknown>, projectId: string) {
  const next = structuredClone(data);
  for (const key of ["awardedProjectNumber", "projectNumber", "projectId"]) if (next[key] === projectId) next[key] = "";
  if (next.stage === "Awarded") next.stage = "Proposal Submitted";
  if (next.estimateStatus === "Awarded") next.estimateStatus = "Approved";
  if (next.estimate && typeof next.estimate === "object") {
    const estimate = next.estimate as Record<string, unknown>;
    if (estimate.awardedProjectNumber === projectId) estimate.awardedProjectNumber = "";
    if (estimate.status === "Awarded") estimate.status = "Approved";
  }
  return next;
}

async function ensureDeletionSchema(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_deletion_requests (id text PRIMARY KEY NOT NULL, target_kind text NOT NULL, target_id text NOT NULL, target_name text NOT NULL, state text DEFAULT 'Quarantined' NOT NULL, phase text DEFAULT 'Snapshot Verified' NOT NULL, manifest_storage_key text NOT NULL, manifest_hash text NOT NULL, manifest_counts_json text DEFAULT '{}' NOT NULL, requested_by_name text NOT NULL, requested_by_email text NOT NULL, requested_at text NOT NULL, purge_after text NOT NULL, restored_at text, restored_by_email text DEFAULT '' NOT NULL, purge_started_at text, purge_confirmed_at text, purge_confirmed_by_email text DEFAULT '' NOT NULL, database_purged_at text, storage_purged_at text, manifest_purged_at text, operation_token text DEFAULT '' NOT NULL, operation_started_at text, operation_actor_email text DEFAULT '' NOT NULL, completed_at text, error_message text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    database.prepare("CREATE INDEX IF NOT EXISTS owner_deletion_requests_target_idx ON owner_deletion_requests (target_kind, target_id, state)"),
    database.prepare("CREATE INDEX IF NOT EXISTS owner_deletion_requests_purge_idx ON owner_deletion_requests (state, purge_after)"),
    database.prepare("CREATE TABLE IF NOT EXISTS owner_deletion_receipts (id text PRIMARY KEY NOT NULL, target_kind text NOT NULL, target_id text NOT NULL, target_name text NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL, counts_json text DEFAULT '{}' NOT NULL, deleted_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
  ]);
}

function deletionReceipt(database: D1Database, requestId: string, kind: string, targetId: string, targetName: string, actor: CommandActor, counts: Record<string, unknown>) {
  return database.prepare("INSERT INTO owner_deletion_receipts (id, target_kind, target_id, target_name, actor_name, actor_email, counts_json, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(`PURGE-RECEIPT-${requestId}`, kind, targetId, targetName, actor.name, actor.email, JSON.stringify(counts), new Date().toISOString());
}

async function runBatches(database: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 60) await database.batch(statements.slice(index, index + 60));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deletionPolicy() {
  return { coolingPeriodDays: QUARANTINE_DAYS, snapshot: "Immutable SHA-256 verified R2 manifest", fileRule: "No file object is deleted during quarantine", restore: "Company Owner may restore before database purge begins; restored recovery manifests are destroyed", purge: "Owner-only exact-phrase confirmation after cooling period; scope drift blocks deletion; database, storage, and manifest disposal are leased, resumable, and reconciled" };
}

function deletionError(error: unknown) {
  console.error("Owner controlled deletion failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message === "PROJECT_NOT_FOUND") return Response.json({ error: "Project not found." }, { status: 404 });
  if (message === "ESTIMATE_NOT_FOUND") return Response.json({ error: "Estimate not found." }, { status: 404 });
  if (message === "DELETION_OPERATION_CONFLICT") return Response.json({ error: "Another restore or purge operation owns this deletion request. Refresh the recovery center before trying again." }, { status: 409 });
  if (message === "QUARANTINE_SCOPE_DRIFT") return Response.json({ error: "Deletion stopped because the quarantined data scope changed after the recovery snapshot. Restore the item, review the new activity, and start a new quarantine period." }, { status: 409 });
  if (message === "MANIFEST_DISPOSAL_FAILED") return Response.json({ error: "The data action completed, but final recovery-manifest destruction could not be verified. The operation remains resumable and is not marked complete." }, { status: 409 });
  if (message.startsWith("VERIFIED_MANIFEST") || message === "MANIFEST_VERIFICATION_FAILED") return Response.json({ error: "Deletion stopped because the immutable recovery manifest could not be verified." }, { status: 409 });
  return Response.json({ error: "Command Center could not complete the controlled deletion action." }, { status: 500 });
}

function isMissingManifest(error: unknown) {
  return error instanceof Error && error.message === "VERIFIED_MANIFEST_MISSING";
}
