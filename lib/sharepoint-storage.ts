import { microsoftGraphRequest, microsoftGraphUploadContent } from "./microsoft-graph";

export type SharePointWorkspaceType = "Estimate" | "Project" | "Employee" | "Company Templates";
export type SharePointPermissionClass =
  | "Project Team"
  | "Preconstruction Team"
  | "Employee Shared"
  | "HR Restricted"
  | "Payroll Restricted"
  | "Benefits Restricted"
  | "Owner Restricted"
  | "Template Administrators";

export type SharePointFolderDefinition = {
  key: string;
  label: string;
  parentKey?: string;
  permissionClass: SharePointPermissionClass;
  description: string;
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Like = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

type WorkspaceRow = {
  id: string;
  entity_type: SharePointWorkspaceType;
  entity_id: string;
  display_name: string;
  library_key: string;
  logical_root_path: string;
  source_project_id: string;
  source_record_id: string;
  status: string;
  site_id: string;
  drive_id: string;
  root_item_id: string;
  web_url: string;
  folder_manifest_json: string;
  no_delete_guard: number;
  last_attempt_at: string;
  verified_at: string;
  error_message: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type FileCopyRow = {
  id: string;
  project_file_id: number;
  workspace_id: string;
  folder_key: string;
  source_storage_key: string;
  source_name: string;
  source_size_bytes: number;
  drive_id: string;
  folder_item_id: string;
};

type DriveItem = {
  id: string;
  name: string;
  webUrl?: string;
  folder?: Record<string, unknown>;
  eTag?: string;
  size?: number;
};

const ESTIMATE_FOLDERS: SharePointFolderDefinition[] = [
  folder("client", "01_Client_And_Opportunity", "Preconstruction Team", "Owner contacts, opportunity notes, qualification and sales handoff."),
  folder("drawings", "02_Drawings_And_Specifications", "Preconstruction Team", "Issued drawings, specifications, addenda and revision evidence."),
  folder("scope", "03_Scope_And_Bid_Documents", "Preconstruction Team", "Scopes, bid instructions, clarifications and estimate criteria."),
  folder("quotes", "04_Subcontractor_Quotes", "Preconstruction Team", "Vendor quotes, bid comparisons and leveling records."),
  folder("workpapers", "05_Estimate_Workpapers", "Preconstruction Team", "Estimate exports, takeoffs, assumptions and internal calculations."),
  folder("proposal", "06_Proposal_And_LOE", "Preconstruction Team", "Controlled proposals, letters of engagement and submission records."),
  folder("handoff", "07_Award_And_Project_Handoff", "Preconstruction Team", "Approved estimate snapshot and permanent project handoff references."),
  folder("archive", "99_Archive", "Preconstruction Team", "Superseded estimate material retained for audit."),
];

const PROJECT_FOLDERS: SharePointFolderDefinition[] = [
  folder("owner-contract", "01_Owner_Contract_And_Insurance", "Project Team", "Owner agreements, amendments, insurance and required contract exhibits."),
  folder("design", "02_Design_Drawings_And_Specifications", "Project Team", "Design criteria, current drawings, specifications, permits and revisions."),
  folder("preconstruction", "03_Preconstruction_Estimate_And_Buyout", "Project Team", "Awarded estimate snapshot, bid tabs, scopes and buyout evidence."),
  folder("commitments", "04_Subcontracts_And_Purchase_Orders", "Project Team", "Executed commitments, purchase orders and vendor documentation."),
  folder("rfi-submittals", "05_RFIs_Submittals_And_Selections", "Project Team", "RFIs, submittals, selections and controlled responses."),
  folder("schedule", "06_Schedule_And_Planning", "Project Team", "Baseline schedules, updates, look-aheads and recovery plans."),
  folder("financial", "07_Cost_Billing_And_Lien_Waivers", "Owner Restricted", "Budgets, owner billing, AP support, change pricing and lien waivers."),
  folder("field", "08_Field_Daily_Logs_And_Photos", "Project Team", "Daily logs, progress photos, reports and site evidence."),
  folder("safety", "09_Safety_SDS_And_Incidents", "Owner Restricted", "Safety plans, toolbox talks, SDS records and restricted incident files."),
  folder("quality", "10_Quality_Inspections_And_Punch", "Project Team", "Pre-work, quality inspections, deficiencies and punch evidence."),
  folder("change-orders", "11_Change_Orders", "Project Team", "Change requests, proposals, approvals and executed amendments."),
  folder("meetings", "12_Meetings_And_Correspondence", "Project Team", "Agendas, minutes, decisions and project correspondence."),
  folder("closeout", "13_Closeout_Warranties_And_OM", "Project Team", "O&M manuals, warranties, permits, releases and turnover packages."),
  folder("archive", "99_Archive", "Project Team", "Superseded project material retained for audit."),
];

const EMPLOYEE_FOLDERS: SharePointFolderDefinition[] = [
  folder("onboarding", "01_Onboarding_And_Acknowledgements", "Employee Shared", "Employee-visible onboarding forms, acknowledgements and completion evidence."),
  folder("employment", "02_Employment_And_HR", "HR Restricted", "Employment records, HR matters, discipline and confidential correspondence."),
  folder("benefits", "03_Benefits_And_Enrollment", "Benefits Restricted", "Employee-specific benefit elections and enrollment evidence."),
  folder("payroll", "04_Payroll_Tax_And_Compensation", "Payroll Restricted", "Payroll, tax, compensation and banking records."),
  folder("training", "05_Training_Licenses_And_Certifications", "Employee Shared", "Training, licenses, certifications and annual renewal evidence."),
  folder("performance", "06_Performance_Goals_And_Reviews", "Owner Restricted", "Goals, performance evidence and finalized review records."),
  folder("leave", "07_Leave_Accommodations_And_Claims", "HR Restricted", "Leave, accommodation and claim records with restricted access."),
  folder("equipment", "08_Equipment_Assets_And_Returns", "Employee Shared", "Issued equipment, vehicles, access devices and return acknowledgements."),
  folder("separation", "09_Separation_And_Access_Closure", "HR Restricted", "Offboarding, access revocation and return or deletion certifications."),
  folder("archive", "99_Archive", "HR Restricted", "Superseded employee records retained under the applicable retention policy."),
];

const TEMPLATE_FOLDERS: SharePointFolderDefinition[] = [
  folder("contracts", "01_Owner_Contracts_And_Exhibits", "Template Administrators", "Current approved owner contract masters and exhibits."),
  folder("subcontracts", "02_Subcontracts_POs_And_Commitments", "Template Administrators", "Current subcontract, purchase order and commitment masters."),
  folder("accounting", "03_Accounting_Billing_And_Waivers", "Template Administrators", "Billing, waiver, accounting and financial-report templates."),
  folder("safety", "04_Safety_Quality_And_Field", "Template Administrators", "Safety plans, toolbox talks, inspections and field templates."),
  folder("people", "05_HR_Onboarding_And_Benefits", "Owner Restricted", "Legally reviewed onboarding, HR and benefits masters."),
  folder("operations", "06_Project_Operations_And_Closeout", "Template Administrators", "Schedules, meetings, correspondence and closeout masters."),
  folder("archive", "99_Superseded_And_Legal_Hold", "Owner Restricted", "Superseded versions and legal-hold copies retained for audit."),
];

export const SHAREPOINT_BLUEPRINTS: Record<SharePointWorkspaceType, {
  libraryKey: string;
  rootLabel: string;
  folders: SharePointFolderDefinition[];
}> = {
  Estimate: { libraryKey: "Preconstruction", rootLabel: "Estimates", folders: ESTIMATE_FOLDERS },
  Project: { libraryKey: "Projects", rootLabel: "Projects", folders: PROJECT_FOLDERS },
  Employee: { libraryKey: "People", rootLabel: "Employees", folders: EMPLOYEE_FOLDERS },
  "Company Templates": { libraryKey: "Company Templates", rootLabel: "Company Templates", folders: TEMPLATE_FOLDERS },
};

export async function ensureSharePointStorageSchema(database?: D1Like) {
  const db = database || await storageDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sharepoint_workspaces (
      id text PRIMARY KEY NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      display_name text NOT NULL,
      library_key text NOT NULL,
      logical_root_path text NOT NULL,
      source_project_id text NOT NULL DEFAULT '',
      source_record_id text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Mapping Pending',
      site_id text NOT NULL DEFAULT '',
      drive_id text NOT NULL DEFAULT '',
      root_item_id text NOT NULL DEFAULT '',
      web_url text NOT NULL DEFAULT '',
      folder_manifest_json text NOT NULL DEFAULT '[]',
      no_delete_guard integer NOT NULL DEFAULT true,
      last_attempt_at text NOT NULL DEFAULT '',
      verified_at text NOT NULL DEFAULT '',
      error_message text NOT NULL DEFAULT '',
      created_by text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS sharepoint_workspace_entity_idx ON sharepoint_workspaces (entity_type, entity_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sharepoint_workspace_status_idx ON sharepoint_workspaces (status, entity_type)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sharepoint_folder_mappings (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      folder_key text NOT NULL,
      label text NOT NULL,
      parent_key text NOT NULL DEFAULT '',
      relative_path text NOT NULL,
      permission_class text NOT NULL,
      drive_item_id text NOT NULL DEFAULT '',
      web_url text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Mapping Pending',
      last_verified_at text NOT NULL DEFAULT '',
      error_message text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS sharepoint_folder_workspace_key_idx ON sharepoint_folder_mappings (workspace_id, folder_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sharepoint_folder_status_idx ON sharepoint_folder_mappings (status, permission_class)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sharepoint_file_mappings (
      id text PRIMARY KEY NOT NULL,
      project_file_id integer NOT NULL UNIQUE,
      workspace_id text NOT NULL,
      folder_key text NOT NULL,
      source_project_id text NOT NULL,
      source_storage_key text NOT NULL,
      source_name text NOT NULL,
      source_size_bytes integer NOT NULL DEFAULT 0,
      drive_item_id text NOT NULL DEFAULT '',
      web_url text NOT NULL DEFAULT '',
      e_tag text NOT NULL DEFAULT '',
      sha256 text NOT NULL DEFAULT '',
      state text NOT NULL DEFAULT 'Local Primary · Mapping Pending',
      no_source_delete integer NOT NULL DEFAULT true,
      last_synced_at text NOT NULL DEFAULT '',
      verified_at text NOT NULL DEFAULT '',
      error_message text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sharepoint_file_state_idx ON sharepoint_file_mappings (state, workspace_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sharepoint_sync_events (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL DEFAULT '',
      file_mapping_id text NOT NULL DEFAULT '',
      action text NOT NULL,
      status text NOT NULL,
      detail text NOT NULL DEFAULT '',
      actor_name text NOT NULL,
      actor_email text NOT NULL DEFAULT '',
      provider_id text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sharepoint_sync_event_status_idx ON sharepoint_sync_events (status, created_at)`),
  ]);
}

export async function sharePointStorageConnection() {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  const authReady = ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET"].every((key) => present(values[key]));
  const mappings = Object.fromEntries((Object.keys(SHAREPOINT_BLUEPRINTS) as SharePointWorkspaceType[]).map((type) => {
    const prefix = type === "Estimate" ? "ESTIMATES" : type === "Project" ? "PROJECTS" : type === "Employee" ? "PEOPLE" : "TEMPLATES";
    const driveId = text(values[`MICROSOFT_SHAREPOINT_${prefix}_DRIVE_ID`] || values.MICROSOFT_SHAREPOINT_DRIVE_ID);
    const rootItemId = text(values[`MICROSOFT_SHAREPOINT_${prefix}_ROOT_ITEM_ID`] || values.MICROSOFT_SHAREPOINT_ROOT_ITEM_ID);
    return [type, { driveId, rootItemId, ready: Boolean(driveId && rootItemId) }];
  })) as Record<SharePointWorkspaceType, { driveId: string; rootItemId: string; ready: boolean }>;
  const siteId = text(values.MICROSOFT_SHAREPOINT_SITE_ID);
  const permissionPolicyVerified = text(values.MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED).toLowerCase() === "true";
  const modeValue = text(values.MICROSOFT_SHAREPOINT_MODE);
  const mode = ["Copy Only", "Dual Store", "SharePoint Primary"].includes(modeValue) ? modeValue : "Mapping Pending";
  const mappedTypes = (Object.keys(mappings) as SharePointWorkspaceType[]).filter((type) => mappings[type].ready);
  return {
    authReady,
    siteId,
    mappings,
    mappedTypes,
    configured: authReady && Boolean(siteId) && mappedTypes.length === Object.keys(SHAREPOINT_BLUEPRINTS).length && permissionPolicyVerified,
    provisioningEnabled: authReady && Boolean(siteId) && mode !== "Mapping Pending" && permissionPolicyVerified,
    mode,
    noDeleteGuard: true,
    deleteCapability: "Prohibited In Every Microsoft Storage Mode",
    permissionPolicyVerified,
    permissionBoundary: "Provisioning remains blocked until SharePoint library inheritance and restricted group access are tested outside Command Center and IT records MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED=true.",
    sourceOfTruth: mode === "SharePoint Primary" ? "SharePoint For Verified Files; Command Center Retains Workflow Metadata And Original Safety Copy" : "Command Center R2",
    missing: [
      ...(!authReady ? ["Microsoft Graph tenant credentials"] : []),
      ...(!siteId ? ["MICROSOFT_SHAREPOINT_SITE_ID"] : []),
      ...(mappedTypes.length !== Object.keys(SHAREPOINT_BLUEPRINTS).length ? ["Drive and root-item mappings for Estimates, Projects, People and Company Templates"] : []),
      ...(!permissionPolicyVerified ? ["Verified SharePoint library and restricted-group permission policy"] : []),
      ...(mode === "Mapping Pending" ? ["Owner-approved MICROSOFT_SHAREPOINT_MODE"] : []),
    ],
  };
}

export async function registerSharePointWorkspace(input: {
  entityType: SharePointWorkspaceType;
  entityId: string;
  displayName: string;
  sourceProjectId?: string;
  sourceRecordId?: string;
  actorName: string;
  actorEmail?: string;
  provisionWhenReady?: boolean;
}) {
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const entityId = cleanIdentifier(input.entityId);
  if (!entityId) throw new Error("A Stable Entity Identifier Is Required For SharePoint Mapping");
  const blueprint = SHAREPOINT_BLUEPRINTS[input.entityType];
  const displayName = cleanDisplay(input.displayName) || entityId;
  const workspaceId = workspaceKey(input.entityType, entityId);
  const logicalRootPath = `${blueprint.rootLabel}/${safeSegment(`${entityId} - ${displayName}`)}`;
  const connection = await sharePointStorageConnection();
  const status = connection.provisioningEnabled && connection.mappings[input.entityType].ready ? "Provisioning Queued" : "Mapping Pending";
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO sharepoint_workspaces
    (id, entity_type, entity_id, display_name, library_key, logical_root_path, source_project_id, source_record_id, status, folder_manifest_json, no_delete_guard, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, logical_root_path = excluded.logical_root_path,
      source_project_id = excluded.source_project_id, source_record_id = excluded.source_record_id,
      folder_manifest_json = excluded.folder_manifest_json, updated_at = excluded.updated_at`)
    .bind(workspaceId, input.entityType, entityId, displayName, blueprint.libraryKey, logicalRootPath, input.sourceProjectId || "", input.sourceRecordId || "", status, JSON.stringify(blueprint.folders), input.actorName, now).run();
  for (const definition of blueprint.folders) {
    await db.prepare(`INSERT INTO sharepoint_folder_mappings
      (id, workspace_id, folder_key, label, parent_key, relative_path, permission_class, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Mapping Pending', ?)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, parent_key = excluded.parent_key,
        relative_path = excluded.relative_path, permission_class = excluded.permission_class, updated_at = excluded.updated_at`)
      .bind(`${workspaceId}:${definition.key}`, workspaceId, definition.key, definition.label, definition.parentKey || "", definition.label, definition.permissionClass, now).run();
  }
  await event(db, { workspaceId, action: "Workspace Registered", status, detail: `${logicalRootPath} · Existing Command Center files remain untouched.`, actorName: input.actorName, actorEmail: input.actorEmail });
  if (input.provisionWhenReady !== false && connection.provisioningEnabled && connection.mappings[input.entityType].ready) {
    return provisionSharePointWorkspace(workspaceId, { actorName: input.actorName, actorEmail: input.actorEmail || "" }).catch(async (error) => {
      const message = safeError(error);
      await db.prepare(`UPDATE sharepoint_workspaces SET status = 'Provisioning Failed · Local Files Preserved', error_message = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?`).bind(message, now, now, workspaceId).run();
      await event(db, { workspaceId, action: "Workspace Provisioning", status: "Failed · Local Files Preserved", detail: message, actorName: input.actorName, actorEmail: input.actorEmail });
      return { workspaceId, status: "Provisioning Failed · Local Files Preserved", error: message, noDeleteGuard: true };
    });
  }
  return { workspaceId, status, logicalRootPath, noDeleteGuard: true };
}

export async function provisionSharePointWorkspace(workspaceId: string, actor: { actorName: string; actorEmail: string }) {
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const workspace = await db.prepare(`SELECT * FROM sharepoint_workspaces WHERE id = ?`).bind(workspaceId).first<WorkspaceRow>();
  if (!workspace) throw new Error("SharePoint Workspace Mapping Was Not Found");
  const connection = await sharePointStorageConnection();
  const mapping = connection.mappings[workspace.entity_type];
  if (!connection.provisioningEnabled || !mapping.ready) throw new Error("SharePoint Mapping Is Not Yet Approved For Provisioning");
  const startedAt = new Date().toISOString();
  await db.prepare(`UPDATE sharepoint_workspaces SET status = 'Provisioning', last_attempt_at = ?, error_message = '', updated_at = ? WHERE id = ?`).bind(startedAt, startedAt, workspaceId).run();
  const root = await ensureChildFolder(mapping.driveId, mapping.rootItemId, safeSegment(`${workspace.entity_id} - ${workspace.display_name}`));
  const blueprint = SHAREPOINT_BLUEPRINTS[workspace.entity_type];
  const itemByKey = new Map<string, DriveItem>();
  for (const definition of blueprint.folders) {
    const parent = definition.parentKey ? itemByKey.get(definition.parentKey) : root;
    if (!parent) throw new Error(`SharePoint Parent Mapping Is Missing For ${definition.label}`);
    const item = await ensureChildFolder(mapping.driveId, parent.id, definition.label);
    itemByKey.set(definition.key, item);
    await db.prepare(`UPDATE sharepoint_folder_mappings SET drive_item_id = ?, web_url = ?, status = 'Provisioned · Verification Required', error_message = '', updated_at = ? WHERE workspace_id = ? AND folder_key = ?`)
      .bind(item.id, item.webUrl || "", new Date().toISOString(), workspaceId, definition.key).run();
  }
  const completedAt = new Date().toISOString();
  await db.prepare(`UPDATE sharepoint_workspaces SET status = 'Provisioned · Verification Required', site_id = ?, drive_id = ?, root_item_id = ?, web_url = ?, error_message = '', updated_at = ? WHERE id = ?`)
    .bind(connection.siteId, mapping.driveId, root.id, root.webUrl || "", completedAt, workspaceId).run();
  await event(db, { workspaceId, action: "Workspace Provisioned", status: "Verification Required", detail: `${blueprint.folders.length} folders created or matched. No source file was moved or deleted.`, actorName: actor.actorName, actorEmail: actor.actorEmail, providerId: root.id });
  return { workspaceId, status: "Provisioned · Verification Required", rootItemId: root.id, webUrl: root.webUrl || "", folderCount: blueprint.folders.length, noDeleteGuard: true };
}

export async function queueProjectFileForSharePoint(input: {
  projectFileId: number;
  projectId: string;
  name: string;
  category: string;
  storageKey: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByEmail?: string;
}) {
  const target = workspaceTargetForFile(input.projectId, input.category);
  if (!target) return { queued: false, reason: "A Person Or Company Mapping Must Be Selected Before This Restricted File Can Be Routed" };
  const workspace = await registerSharePointWorkspace({
    entityType: target.entityType,
    entityId: target.entityId,
    displayName: target.displayName,
    sourceProjectId: input.projectId,
    sourceRecordId: String(input.projectFileId),
    actorName: input.uploadedBy,
    actorEmail: input.uploadedByEmail,
  });
  const db = await storageDatabase();
  const id = `file:${input.projectFileId}`;
  await db.prepare(`INSERT INTO sharepoint_file_mappings
    (id, project_file_id, workspace_id, folder_key, source_project_id, source_storage_key, source_name, source_size_bytes, state, no_source_delete, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Local Primary · Mapping Pending', 1, ?)
    ON CONFLICT(project_file_id) DO UPDATE SET workspace_id = excluded.workspace_id, folder_key = excluded.folder_key,
      source_project_id = excluded.source_project_id, source_storage_key = excluded.source_storage_key,
      source_name = excluded.source_name, source_size_bytes = excluded.source_size_bytes, updated_at = excluded.updated_at`)
    .bind(id, input.projectFileId, workspace.workspaceId, target.folderKey, input.projectId, input.storageKey, input.name, input.sizeBytes, new Date().toISOString()).run();
  await event(db, { workspaceId: workspace.workspaceId, fileMappingId: id, action: "File Mapping Registered", status: "Local Primary · Mapping Pending", detail: `${input.name} → ${target.folderKey}. Command Center content retained.`, actorName: input.uploadedBy, actorEmail: input.uploadedByEmail });
  return { queued: true, workspaceId: workspace.workspaceId, folderKey: target.folderKey, state: "Local Primary · Mapping Pending", noSourceDelete: true };
}

export async function sharePointControlSnapshot() {
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const [workspaces, folders, files, events, connection] = await Promise.all([
    db.prepare(`SELECT * FROM sharepoint_workspaces ORDER BY updated_at DESC LIMIT 200`).all<WorkspaceRow>(),
    db.prepare(`SELECT workspace_id, folder_key, label, permission_class, status, web_url, last_verified_at, error_message FROM sharepoint_folder_mappings ORDER BY workspace_id, relative_path LIMIT 1000`).all<Record<string, string>>(),
    db.prepare(`SELECT id, project_file_id, workspace_id, folder_key, source_name, source_size_bytes, state, web_url, verified_at, error_message, no_source_delete FROM sharepoint_file_mappings ORDER BY updated_at DESC LIMIT 500`).all<Record<string, string | number>>(),
    db.prepare(`SELECT * FROM sharepoint_sync_events ORDER BY created_at DESC LIMIT 100`).all<Record<string, string>>(),
    sharePointStorageConnection(),
  ]);
  const counts = workspaces.results.reduce<Record<string, number>>((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {});
  return {
    connection,
    policy: {
      automaticRoots: ["New Estimate", "New Project", "New Employee"],
      migrationSequence: ["Register Mapping", "Provision Folders", "Copy Only", "Verify Size + Hash + Permissions", "Dual Store", "Owner-Approved Primary Read"],
      hardRules: ["No Automatic Delete", "No Silent Overwrite", "No Source Replacement Before Verification", "Permission Class Required For Every Folder", "Command Center Workflow Metadata Remains Authoritative"],
    },
    blueprints: SHAREPOINT_BLUEPRINTS,
    counts,
    workspaces: workspaces.results.map((row) => ({ ...row, noDeleteGuard: Boolean(row.no_delete_guard), folderManifest: parseArray(row.folder_manifest_json) })),
    folders: folders.results,
    files: files.results,
    events: events.results,
  };
}

export async function provisionPendingSharePointWorkspaces(actor: { actorName: string; actorEmail: string }, limit = 10) {
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const rows = await db.prepare(`SELECT id FROM sharepoint_workspaces WHERE status IN ('Mapping Pending', 'Provisioning Queued', 'Provisioning Failed · Local Files Preserved') ORDER BY created_at LIMIT ?`).bind(Math.max(1, Math.min(25, limit))).all<{ id: string }>();
  const results = [];
  for (const row of rows.results) {
    try { results.push(await provisionSharePointWorkspace(row.id, actor)); }
    catch (error) { results.push({ workspaceId: row.id, status: "Deferred", error: safeError(error), noDeleteGuard: true }); }
  }
  return results;
}

export async function registerUnmappedSharePointFiles(actor: { actorName: string; actorEmail: string }, limit = 200) {
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const rows = await db.prepare(`SELECT pf.id, pf.project_id, pf.name, pf.category, pf.storage_key, pf.size_bytes, pf.uploaded_by
    FROM project_files pf LEFT JOIN sharepoint_file_mappings sf ON sf.project_file_id = pf.id
    WHERE sf.project_file_id IS NULL ORDER BY pf.created_at ASC LIMIT ?`).bind(Math.max(1, Math.min(500, limit))).all<{
      id: number; project_id: string; name: string; category: string; storage_key: string; size_bytes: number; uploaded_by: string;
    }>();
  const results = [];
  for (const row of rows.results) {
    const result = await queueProjectFileForSharePoint({
      projectFileId: row.id,
      projectId: row.project_id,
      name: row.name,
      category: row.category,
      storageKey: row.storage_key,
      sizeBytes: Number(row.size_bytes || 0),
      uploadedBy: row.uploaded_by || actor.actorName,
      uploadedByEmail: actor.actorEmail,
    });
    if (result.queued) results.push(result);
  }
  return { inspected: rows.results.length, registered: results.length, results };
}

export async function runSharePointStorageAutomation() {
  const actor = { actorName: "Command Center Scheduler", actorEmail: "system@command-center.internal" };
  const registered = await registerUnmappedSharePointFiles(actor, 250);
  const connection = await sharePointStorageConnection();
  if (!connection.provisioningEnabled) return { configured: false, mode: connection.mode, registered, provisioned: [], copied: [], sourceFilesRetained: true };
  const provisioned = await provisionPendingSharePointWorkspaces(actor, 25);
  const copied = await copyPendingSharePointFiles(actor, 25);
  return { configured: true, mode: connection.mode, registered, provisioned, copied, sourceFilesRetained: true };
}

export async function copyPendingSharePointFiles(actor: { actorName: string; actorEmail: string }, limit = 10) {
  const connection = await sharePointStorageConnection();
  if (!connection.provisioningEnabled || connection.mode === "Mapping Pending") throw new Error("SharePoint Copy Mode Is Not Yet Owner Approved");
  const db = await storageDatabase();
  await ensureSharePointStorageSchema(db);
  const rows = await db.prepare(`SELECT f.id, f.project_file_id, f.workspace_id, f.folder_key, f.source_storage_key,
      f.source_name, f.source_size_bytes, w.drive_id, m.drive_item_id AS folder_item_id
    FROM sharepoint_file_mappings f
    JOIN sharepoint_workspaces w ON w.id = f.workspace_id
    JOIN sharepoint_folder_mappings m ON m.workspace_id = f.workspace_id AND m.folder_key = f.folder_key
    WHERE f.state IN ('Local Primary · Mapping Pending', 'Copy Failed · Local Primary Preserved')
      AND w.status = 'Provisioned · Verification Required' AND m.drive_item_id <> ''
    ORDER BY f.created_at LIMIT ?`).bind(Math.max(1, Math.min(25, limit))).all<FileCopyRow>();
  const results = [];
  for (const row of rows.results) {
    const startedAt = new Date().toISOString();
    await db.prepare(`UPDATE sharepoint_file_mappings SET state = 'Copying · Local Primary Preserved', error_message = '', updated_at = ? WHERE id = ?`).bind(startedAt, row.id).run();
    try {
      const copied = await copyR2ObjectToSharePoint(row);
      const verified = Number(copied.size || 0) === Number(row.source_size_bytes || 0);
      const completedAt = new Date().toISOString();
      const state = verified ? "Copied · Size Verified · Local Primary Preserved" : "Copied · Verification Required · Local Primary Preserved";
      await db.prepare(`UPDATE sharepoint_file_mappings SET drive_item_id = ?, web_url = ?, e_tag = ?, state = ?, last_synced_at = ?, verified_at = ?, error_message = '', no_source_delete = 1, updated_at = ? WHERE id = ?`)
        .bind(copied.id, copied.webUrl || "", copied.eTag || "", state, completedAt, verified ? completedAt : "", completedAt, row.id).run();
      await event(db, { workspaceId: row.workspace_id, fileMappingId: row.id, action: "File Copied To SharePoint", status: state, detail: `${row.source_name} copied; Command Center source retained.`, actorName: actor.actorName, actorEmail: actor.actorEmail, providerId: copied.id });
      results.push({ fileMappingId: row.id, state, providerId: copied.id, webUrl: copied.webUrl || "", sourceRetained: true });
    } catch (error) {
      const message = safeError(error);
      await db.prepare(`UPDATE sharepoint_file_mappings SET state = 'Copy Failed · Local Primary Preserved', error_message = ?, no_source_delete = 1, updated_at = ? WHERE id = ?`).bind(message, new Date().toISOString(), row.id).run();
      await event(db, { workspaceId: row.workspace_id, fileMappingId: row.id, action: "File Copy To SharePoint", status: "Failed · Local Primary Preserved", detail: message, actorName: actor.actorName, actorEmail: actor.actorEmail });
      results.push({ fileMappingId: row.id, state: "Copy Failed · Local Primary Preserved", error: message, sourceRetained: true });
    }
  }
  return results;
}

async function copyR2ObjectToSharePoint(row: FileCopyRow) {
  const { env } = await import("cloudflare:workers");
  const bucket = env.BUCKET;
  const object = await bucket.get(row.source_storage_key);
  if (!object) throw new Error("The Command Center Source File Was Not Found; Nothing Was Deleted");
  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const fileName = safeSegment(row.source_name);
  const encodedName = encodeURIComponent(fileName).replace(/%2F/gi, "-");
  if (row.source_size_bytes <= 4 * 1024 * 1024) {
    return microsoftGraphUploadContent<DriveItem>(`/drives/${encodeURIComponent(row.drive_id)}/items/${encodeURIComponent(row.folder_item_id)}:/${encodedName}:/content`, await object.arrayBuffer(), contentType);
  }
  const session = await microsoftGraphRequest<{ uploadUrl?: string }>(`/drives/${encodeURIComponent(row.drive_id)}/items/${encodeURIComponent(row.folder_item_id)}:/${encodedName}:/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name: fileName } }),
  });
  if (!session.uploadUrl || !session.uploadUrl.startsWith("https://")) throw new Error("Microsoft Graph Did Not Return A Valid Upload Session");
  const chunkSize = 10 * 1024 * 1024;
  let finalItem: DriveItem | null = null;
  for (let offset = 0; offset < row.source_size_bytes; offset += chunkSize) {
    const length = Math.min(chunkSize, row.source_size_bytes - offset);
    const chunk = await bucket.get(row.source_storage_key, { range: { offset, length } });
    if (!chunk) throw new Error(`The Command Center Source Could Not Be Read At Byte ${offset}`);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${row.source_size_bytes}` },
      body: await chunk.arrayBuffer(),
    });
    const result = await response.json().catch(() => ({})) as DriveItem & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message || `SharePoint Upload Session Returned ${response.status}`);
    if (response.status === 200 || response.status === 201) finalItem = result;
  }
  if (!finalItem?.id) throw new Error("SharePoint Upload Completed Without A Verifiable Drive Item");
  return finalItem;
}

function workspaceTargetForFile(projectId: string, category: string) {
  if (projectId.startsWith("ESTIMATE-")) return { entityType: "Estimate" as const, entityId: projectId.slice("ESTIMATE-".length), displayName: projectId, folderKey: estimateFolderForCategory(category) };
  if (projectId.startsWith("EMPLOYEE-")) return { entityType: "Employee" as const, entityId: projectId.slice("EMPLOYEE-".length).toLowerCase(), displayName: projectId.slice("EMPLOYEE-".length), folderKey: employeeFolderForCategory(category) };
  if (/^\d{2}-\d{3}$/.test(projectId)) return { entityType: "Project" as const, entityId: projectId, displayName: projectId, folderKey: projectFolderForCategory(category) };
  if (projectId === "MEFFORD-REVIEW") return { entityType: "Company Templates" as const, entityId: "MEFFORD-TEMPLATES", displayName: "Mefford Controlled Templates", folderKey: templateFolderForCategory(category) };
  return null;
}

function employeeFolderForCategory(category: string) {
  const value = category.toLowerCase();
  if (/benefit|enrollment|insurance/.test(value)) return "benefits";
  if (/payroll|tax|compensation|bank|direct deposit/.test(value)) return "payroll";
  if (/training|license|certification|qualification/.test(value)) return "training";
  if (/performance|review|goal/.test(value)) return "performance";
  if (/leave|accommodation|claim/.test(value)) return "leave";
  if (/equipment|asset|vehicle|device|return/.test(value)) return "equipment";
  if (/separation|termination|offboard|access closure/.test(value)) return "separation";
  if (/hr|employment|discipline|confidential/.test(value)) return "employment";
  return "onboarding";
}

function estimateFolderForCategory(category: string) {
  const value = category.toLowerCase();
  if (/drawing|spec|design|addenda/.test(value)) return "drawings";
  if (/quote|bid|vendor|subcontractor/.test(value)) return "quotes";
  if (/proposal|loe|letter/.test(value)) return "proposal";
  if (/takeoff|estimate|workpaper/.test(value)) return "workpapers";
  if (/award|handoff/.test(value)) return "handoff";
  return "scope";
}

function projectFolderForCategory(category: string) {
  const value = category.toLowerCase();
  if (/owner contract|insurance|contract exhibit/.test(value)) return "owner-contract";
  if (/drawing|spec|design|permit/.test(value)) return "design";
  if (/estimate|bid|buyout|quote/.test(value)) return "preconstruction";
  if (/subcontract|purchase order|commitment/.test(value)) return "commitments";
  if (/rfi|submittal|selection/.test(value)) return "rfi-submittals";
  if (/schedule|look.?ahead|planning/.test(value)) return "schedule";
  if (/billing|invoice|cost|waiver|financial/.test(value)) return "financial";
  if (/daily|photo|field|progress/.test(value)) return "field";
  if (/safety|sds|incident|visitor|toolbox/.test(value)) return "safety";
  if (/quality|inspection|punch|deficien/.test(value)) return "quality";
  if (/change order|change request/.test(value)) return "change-orders";
  if (/meeting|minute|correspondence/.test(value)) return "meetings";
  if (/closeout|warrant|o&m|manual|turnover/.test(value)) return "closeout";
  return "field";
}

function templateFolderForCategory(category: string) {
  const value = category.toLowerCase();
  if (/owner contract|exhibit/.test(value)) return "contracts";
  if (/subcontract|purchase order|commitment/.test(value)) return "subcontracts";
  if (/account|billing|waiver|invoice/.test(value)) return "accounting";
  if (/safety|quality|field|daily/.test(value)) return "safety";
  if (/hr|onboarding|benefit|employee/.test(value)) return "people";
  return "operations";
}

async function ensureChildFolder(driveId: string, parentItemId: string, name: string) {
  const children = await microsoftGraphRequest<{ value?: DriveItem[] }>(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}/children?$top=999&$select=id,name,webUrl,folder,eTag,size`);
  const existing = (children.value || []).find((item) => item.folder && item.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  return microsoftGraphRequest<DriveItem>(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}/children`, {
    method: "POST",
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
}

async function event(db: D1Like, input: { workspaceId?: string; fileMappingId?: string; action: string; status: string; detail: string; actorName: string; actorEmail?: string; providerId?: string }) {
  await db.prepare(`INSERT INTO sharepoint_sync_events (id, workspace_id, file_mapping_id, action, status, detail, actor_name, actor_email, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.workspaceId || "", input.fileMappingId || "", input.action, input.status, input.detail, input.actorName, input.actorEmail || "", input.providerId || "").run();
}

function workspaceKey(type: SharePointWorkspaceType, id: string) {
  return `${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${id.toLowerCase()}`;
}

function folder(key: string, label: string, permissionClass: SharePointPermissionClass, description: string, parentKey = ""): SharePointFolderDefinition {
  return { key, label, permissionClass, description, ...(parentKey ? { parentKey } : {}) };
}

function safeSegment(value: string) {
  return value.replace(/[~"#%&*:<>?/\\{|}]+/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 120) || "Untitled";
}

function cleanIdentifier(value: string) {
  return value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 240);
}

function cleanDisplay(value: string) {
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function parseArray(value: string) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function present(value: unknown) { return Boolean(text(value)); }
function text(value: unknown) { return String(value || "").trim(); }
function safeError(error: unknown) { return (error instanceof Error ? error.message : String(error || "Unknown SharePoint Error")).replace(/[\r\n\t]+/g, " ").slice(0, 1000); }

async function storageDatabase() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1Like }).DB;
}
