import type { CommandActor } from "./server-actor";
import {
  accessStatusAllowsSignIn,
  isEmployeeAccountCandidate,
  normalizeAccessLevel,
  normalizeDirectoryPerson,
  normalizeProjectScopes,
  ownerDecisionReason,
  statusAfterOwnerGrant,
  statusAfterOwnerRestore,
  validOwnerDecisionReason,
} from "./microsoft-access";
import { listMicrosoftDirectoryUsers, microsoftDirectoryConnection } from "./microsoft-graph";
import { microsoftEntraAuthConnection, microsoftEntraProofStatus } from "./microsoft-entra-auth";
import {
  PEOPLE_PROJECT_ID,
  employeeRecordId,
  getEmployeeOnboardingData,
  getOnboardingRequirements,
  onboardingState,
} from "./onboarding";
import { normalizeDesignations } from "./team-access";

type AccessStatement = {
  bind: (...values: unknown[]) => AccessStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

export type MicrosoftAccessDatabase = {
  prepare: (query: string) => AccessStatement;
  batch: (statements: AccessStatement[]) => Promise<unknown>;
};

type DirectoryRow = {
  provider_subject: string;
  display_name: string;
  user_principal_name: string;
  mail: string;
  job_title: string;
  department: string;
  user_type: string;
  account_enabled: number;
  directory_present: number;
  first_seen_at: string;
  last_seen_at: string;
  last_sync_run_id: string;
  updated_at: string;
};

type GrantRow = {
  provider_subject: string;
  microsoft_email: string;
  access_status: string;
  company_access_level: string;
  designations_json: string;
  project_scopes_json: string;
  previous_access_status: string;
  owner_approved_by_name: string;
  owner_approved_by_email: string;
  owner_approved_at: string | null;
  activated_at: string | null;
  last_sign_in_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  decision_reason: string;
  created_at: string;
  updated_at: string;
};

type CompanyMemberRow = {
  email: string;
  display_name: string;
  company_access_level: string;
  designations_json: string;
  is_active: number;
  identity_provider: string;
  provider_subject: string | null;
  updated_at: string;
};

type AuditRow = {
  id: string;
  provider_subject: string;
  microsoft_email: string;
  action: string;
  prior_status: string;
  next_status: string;
  actor_name: string;
  actor_email: string;
  actor_type: string;
  reason: string;
  detail_json: string;
  created_at: string;
};

type SyncRow = {
  id: string;
  trigger_source: string;
  status: string;
  source_count: number;
  imported_count: number;
  updated_count: number;
  disabled_count: number;
  missing_count: number;
  error_message: string;
  started_at: string;
  completed_at: string;
};

export async function ensureMicrosoftAccessSchema(database?: MicrosoftAccessDatabase) {
  const db = database || await accessDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_directory_users (
      provider_subject text PRIMARY KEY NOT NULL,
      display_name text NOT NULL,
      user_principal_name text NOT NULL,
      mail text NOT NULL DEFAULT '',
      job_title text NOT NULL DEFAULT '',
      department text NOT NULL DEFAULT '',
      user_type text NOT NULL DEFAULT 'Member',
      account_enabled integer NOT NULL DEFAULT true,
      directory_present integer NOT NULL DEFAULT true,
      first_seen_at text NOT NULL,
      last_seen_at text NOT NULL,
      last_sync_run_id text NOT NULL,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS microsoft_directory_users_upn_idx ON microsoft_directory_users (user_principal_name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_directory_users_access_idx ON microsoft_directory_users (directory_present, account_enabled, user_type)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_access_grants (
      provider_subject text PRIMARY KEY NOT NULL,
      microsoft_email text NOT NULL,
      access_status text NOT NULL DEFAULT 'No Access',
      company_access_level text NOT NULL DEFAULT 'Employee',
      designations_json text NOT NULL DEFAULT '[]',
      project_scopes_json text NOT NULL DEFAULT '[]',
      previous_access_status text NOT NULL DEFAULT 'No Access',
      owner_approved_by_name text NOT NULL DEFAULT '',
      owner_approved_by_email text NOT NULL DEFAULT '',
      owner_approved_at text,
      activated_at text,
      last_sign_in_at text,
      suspended_at text,
      revoked_at text,
      decision_reason text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS microsoft_access_grants_email_idx ON microsoft_access_grants (microsoft_email)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_access_grants_status_idx ON microsoft_access_grants (access_status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_access_audits (
      id text PRIMARY KEY NOT NULL,
      provider_subject text NOT NULL,
      microsoft_email text NOT NULL,
      action text NOT NULL,
      prior_status text NOT NULL DEFAULT '',
      next_status text NOT NULL DEFAULT '',
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      actor_type text NOT NULL DEFAULT 'Human',
      reason text NOT NULL DEFAULT '',
      detail_json text NOT NULL DEFAULT '{}',
      sync_run_id text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_access_audits_subject_idx ON microsoft_access_audits (provider_subject, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_access_audits_actor_idx ON microsoft_access_audits (actor_email, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_directory_sync_runs (
      id text PRIMARY KEY NOT NULL,
      trigger_source text NOT NULL,
      status text NOT NULL DEFAULT 'Running',
      source_count integer NOT NULL DEFAULT 0,
      imported_count integer NOT NULL DEFAULT 0,
      updated_count integer NOT NULL DEFAULT 0,
      disabled_count integer NOT NULL DEFAULT 0,
      missing_count integer NOT NULL DEFAULT 0,
      error_message text NOT NULL DEFAULT '',
      started_at text NOT NULL,
      completed_at text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_directory_sync_runs_status_idx ON microsoft_directory_sync_runs (status, started_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS microsoft_activity_audits (
      id text PRIMARY KEY NOT NULL,
      provider_subject text NOT NULL DEFAULT '',
      microsoft_email text NOT NULL,
      command_actor_email text NOT NULL,
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text NOT NULL DEFAULT '',
      status text NOT NULL,
      detail_json text NOT NULL DEFAULT '{}',
      error_message text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_activity_audits_email_idx ON microsoft_activity_audits (microsoft_email, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS microsoft_activity_audits_status_idx ON microsoft_activity_audits (status, created_at)`),
  ]);
}

export async function microsoftAccessControlConnection() {
  const connection = await microsoftDirectoryConnection();
  const entra = await microsoftEntraAuthConnection();
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return {
    ...connection,
    entra,
    enforced: String(values.MICROSOFT_ACCESS_CONTROL_ENFORCED || "").toLowerCase() === "true",
    directoryCadence: "Hourly And On Demand",
    authorizationRule: "Microsoft Account Discovery Never Grants Command Center Access",
  };
}

export async function syncMicrosoftDirectory(input: {
  triggerSource: "Owner Request" | "IT Request" | "Scheduled Reconciliation";
  actorName: string;
  actorEmail: string;
}) {
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  const connection = await microsoftDirectoryConnection();
  if (!connection.configured) {
    return {
      scheduledOutcome: "Deferred" as const,
      reason: "Microsoft 365 directory credentials are not configured",
      configured: false,
    };
  }
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.prepare(`INSERT INTO microsoft_directory_sync_runs (id, trigger_source, status, started_at) VALUES (?, ?, 'Running', ?)`)
    .bind(runId, input.triggerSource, startedAt).run();
  try {
    const source = await listMicrosoftDirectoryUsers();
    const bySubject = new Map<string, NonNullable<ReturnType<typeof normalizeDirectoryPerson>>>();
    const usedEmails = new Set<string>();
    for (const raw of source) {
      const person = normalizeDirectoryPerson(raw);
      if (!person) continue;
      const email = person.mail || person.userPrincipalName;
      if (bySubject.has(person.providerSubject) || usedEmails.has(email)) continue;
      bySubject.set(person.providerSubject, person);
      usedEmails.add(email);
    }
    const people = [...bySubject.values()];
    const priorResult = await db.prepare(`SELECT * FROM microsoft_directory_users`).all<DirectoryRow>();
    const grantResult = await db.prepare(`SELECT * FROM microsoft_access_grants`).all<GrantRow>();
    const prior = new Map((priorResult.results || []).map((row) => [row.provider_subject, row]));
    const grants = new Map((grantResult.results || []).map((row) => [row.provider_subject, row]));
    await db.prepare(`UPDATE microsoft_directory_users SET directory_present = 0, updated_at = ?`).bind(startedAt).run();
    let importedCount = 0;
    let updatedCount = 0;
    const statements: AccessStatement[] = [];
    for (const person of people) {
      const email = person.mail || person.userPrincipalName;
      statements.push(db.prepare(`DELETE FROM microsoft_directory_users WHERE lower(user_principal_name) = ? AND provider_subject <> ? AND directory_present = 0`).bind(person.userPrincipalName, person.providerSubject));
      statements.push(db.prepare(`INSERT INTO microsoft_directory_users
        (provider_subject, display_name, user_principal_name, mail, job_title, department, user_type, account_enabled, directory_present, first_seen_at, last_seen_at, last_sync_run_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(provider_subject) DO UPDATE SET
          display_name = excluded.display_name,
          user_principal_name = excluded.user_principal_name,
          mail = excluded.mail,
          job_title = excluded.job_title,
          department = excluded.department,
          user_type = excluded.user_type,
          account_enabled = excluded.account_enabled,
          directory_present = 1,
          last_seen_at = excluded.last_seen_at,
          last_sync_run_id = excluded.last_sync_run_id,
          updated_at = excluded.updated_at`)
        .bind(person.providerSubject, person.displayName, person.userPrincipalName, person.mail, person.jobTitle, person.department, person.userType, person.accountEnabled ? 1 : 0, startedAt, startedAt, runId, startedAt));
      if (prior.has(person.providerSubject)) updatedCount += 1;
      else importedCount += 1;
      const grant = grants.get(person.providerSubject);
      if (!person.accountEnabled && grant && accessStatusAllowsSignIn(grant.access_status)) {
        statements.push(...disabledAccessStatements(db, {
          grant,
          email,
          providerSubject: person.providerSubject,
          runId,
          reason: "Microsoft 365 reported that the account is disabled",
          now: startedAt,
        }));
      }
    }
    const seen = new Set(people.map((person) => person.providerSubject));
    let missingCount = 0;
    for (const row of prior.values()) {
      if (seen.has(row.provider_subject)) continue;
      missingCount += 1;
      const grant = grants.get(row.provider_subject);
      if (grant && accessStatusAllowsSignIn(grant.access_status)) {
        statements.push(...disabledAccessStatements(db, {
          grant,
          email: grant.microsoft_email,
          providerSubject: row.provider_subject,
          runId,
          reason: "The Microsoft 365 account was not present in the completed directory reconciliation",
          now: startedAt,
        }));
      }
    }
    for (let index = 0; index < statements.length; index += 40) {
      await db.batch(statements.slice(index, index + 40));
    }
    const disabledCount = people.filter((person) => !person.accountEnabled).length + missingCount;
    const completedAt = new Date().toISOString();
    await db.prepare(`UPDATE microsoft_directory_sync_runs SET status = 'Completed', source_count = ?, imported_count = ?, updated_count = ?, disabled_count = ?, missing_count = ?, completed_at = ? WHERE id = ?`)
      .bind(source.length, importedCount, updatedCount, disabledCount, missingCount, completedAt, runId).run();
    return { configured: true, status: "Completed" as const, runId, sourceCount: source.length, importedCount, updatedCount, disabledCount, missingCount };
  } catch (error) {
    const message = safeError(error);
    const completedAt = new Date().toISOString();
    await db.prepare(`UPDATE microsoft_directory_sync_runs SET status = 'Failed', error_message = ?, completed_at = ? WHERE id = ?`)
      .bind(message, completedAt, runId).run();
    throw error;
  }
}

export async function loadMicrosoftAccessSnapshot(actor: CommandActor) {
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  const connection = await microsoftAccessControlConnection();
  const [directoryResult, grantResult, memberResult, auditResult, syncResult] = await Promise.all([
    db.prepare(`SELECT * FROM microsoft_directory_users ORDER BY display_name, user_principal_name`).all<DirectoryRow>(),
    db.prepare(`SELECT * FROM microsoft_access_grants ORDER BY microsoft_email`).all<GrantRow>(),
    db.prepare(`SELECT * FROM company_members ORDER BY display_name`).all<CompanyMemberRow>(),
    db.prepare(`SELECT * FROM microsoft_access_audits ORDER BY created_at DESC LIMIT 100`).all<AuditRow>(),
    db.prepare(`SELECT * FROM microsoft_directory_sync_runs ORDER BY started_at DESC LIMIT 1`).all<SyncRow>(),
  ]);
  const grants = new Map((grantResult.results || []).map((row) => [row.provider_subject, row]));
  const members = new Map((memberResult.results || []).map((row) => [row.email.toLowerCase(), row]));
  const requirements = await getOnboardingRequirements();
  const users = await Promise.all((directoryResult.results || []).map(async (row) => {
    const grant = grants.get(row.provider_subject);
    const email = (row.mail || row.user_principal_name).toLowerCase();
    const member = members.get(email);
    const employee = await getEmployeeOnboardingData(email);
    const onboarding = employee ? onboardingState(employee, requirements) : null;
    const accessStatus = row.account_enabled && row.directory_present
      ? grant?.access_status || "No Access"
      : "Microsoft Account Disabled";
    return {
      providerSubject: row.provider_subject,
      displayName: row.display_name,
      email,
      userPrincipalName: row.user_principal_name,
      jobTitle: row.job_title,
      department: row.department,
      userType: row.user_type,
      accountEnabled: Boolean(row.account_enabled),
      directoryPresent: Boolean(row.directory_present),
      lastSeenAt: row.last_seen_at,
      accessStatus,
      accessLevel: grant?.company_access_level || member?.company_access_level || "",
      designations: parseJsonArray(grant?.designations_json || member?.designations_json),
      projectScopes: parseJsonArray(grant?.project_scopes_json),
      onboardingComplete: Boolean(onboarding && !onboarding.permissionLocked),
      onboardingStatus: onboarding?.status || "Employee Record Required",
      existingCommandCenterMember: Boolean(member),
      commandCenterMemberActive: Boolean(member?.is_active),
      candidate: isEmployeeAccountCandidate({ userType: row.user_type, email, accountEnabled: Boolean(row.account_enabled), directoryPresent: Boolean(row.directory_present) }),
      ownerApprovedBy: grant?.owner_approved_by_name || "",
      ownerApprovedAt: grant?.owner_approved_at || "",
      decisionReason: grant?.decision_reason || "",
    };
  }));
  const directoryEmails = new Set(users.map((user) => user.email));
  const pendingDirectoryLinks = [...members.values()]
    .filter((member) => !directoryEmails.has(member.email.toLowerCase()))
    .map((member) => ({
      displayName: member.display_name,
      email: member.email,
      accessLevel: member.company_access_level,
      designations: parseJsonArray(member.designations_json),
      active: Boolean(member.is_active),
      identityProvider: member.identity_provider,
      status: connection.configured ? "Awaiting Directory Match" : "Microsoft Connection Pending",
    }));
  const canManage = actor.accessLevel === "Company Owner";
  const actorMember = members.get(actor.email.toLowerCase());
  const canSync = canManage || parseJsonArray(actorMember?.designations_json).includes("IT Administrator");
  return {
    connection,
    actor: { canManage, canSync, role: canManage ? "Company Owner" : canSync ? "IT Administrator" : "Read Only" },
    summary: {
      directoryAccounts: users.length,
      employeeCandidates: users.filter((user) => user.candidate).length,
      noAccess: users.filter((user) => user.accessStatus === "No Access").length,
      onboarding: users.filter((user) => user.accessStatus === "Onboarding Access").length,
      active: users.filter((user) => user.accessStatus === "Active").length,
      suspended: users.filter((user) => user.accessStatus === "Suspended").length,
      disabled: users.filter((user) => user.accessStatus === "Microsoft Account Disabled").length,
    },
    users,
    pendingDirectoryLinks,
    latestSync: syncResult.results?.[0] || null,
    audits: (auditResult.results || []).map((row) => ({
      id: row.id,
      email: row.microsoft_email,
      action: row.action,
      priorStatus: row.prior_status,
      nextStatus: row.next_status,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorType: row.actor_type,
      reason: row.reason,
      detail: parseJsonObject(row.detail_json),
      createdAt: row.created_at,
    })),
  };
}

export async function applyOwnerMicrosoftAccessDecision(actor: CommandActor, input: {
  action: "grant-access" | "update-access" | "activate-access" | "suspend-access" | "revoke-access" | "restore-access";
  providerSubject: string;
  accessLevel?: unknown;
  designations?: unknown;
  projectScopes?: unknown;
  reason?: unknown;
}) {
  if (actor.accessLevel !== "Company Owner") throw new AccessControlError("Only A Company Owner Can Change Command Center Access", 403);
  if (!validOwnerDecisionReason(input.reason)) throw new AccessControlError("Add A Specific Owner Decision Reason Of At Least Eight Characters", 400);
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  const directory = await db.prepare(`SELECT * FROM microsoft_directory_users WHERE provider_subject = ?`).bind(input.providerSubject).first<DirectoryRow>();
  if (!directory) throw new AccessControlError("Select A Microsoft 365 Directory Account", 404);
  const email = (directory.mail || directory.user_principal_name).toLowerCase();
  if (!directory.directory_present || !directory.account_enabled) throw new AccessControlError("The Microsoft 365 Account Must Be Present And Enabled Before Access Can Be Approved", 409);
  if (!isEmployeeAccountCandidate({ userType: directory.user_type, email, accountEnabled: true, directoryPresent: true })) {
    throw new AccessControlError("Only Enabled Mefford Microsoft 365 Member Accounts Can Receive Command Center Access", 409);
  }
  const grant = await db.prepare(`SELECT * FROM microsoft_access_grants WHERE provider_subject = ?`).bind(directory.provider_subject).first<GrantRow>();
  const member = await db.prepare(`SELECT * FROM company_members WHERE lower(email) = ?`).bind(email).first<CompanyMemberRow>();
  const reason = ownerDecisionReason(input.reason);
  const now = new Date().toISOString();
  const onboarding = await onboardingReadiness(email);
  const requestedLevel = member?.company_access_level === "Company Owner" ? "Company Owner" : normalizeAccessLevel(input.accessLevel || grant?.company_access_level);
  const designations = normalizeDesignations(input.designations ?? parseJsonArray(grant?.designations_json || member?.designations_json));
  const projectScopes = normalizeProjectScopes(input.projectScopes ?? parseJsonArray(grant?.project_scopes_json));
  const priorStatus = grant?.access_status || "No Access";
  let nextStatus = priorStatus;
  let actionLabel = "Access Package Updated";
  if (input.action === "grant-access") {
    if (grant && priorStatus !== "No Access") throw new AccessControlError("Use The Existing Access Record To Update, Suspend, Revoke, Or Restore This Account", 409);
    nextStatus = statusAfterOwnerGrant({ onboardingComplete: onboarding.complete, existingAccessLevel: member?.company_access_level });
    actionLabel = "Owner Granted Command Center Access";
  } else if (input.action === "update-access") {
    if (!grant) throw new AccessControlError("Grant Command Center Access Before Updating Its Access Package", 409);
  } else if (input.action === "activate-access") {
    if (!grant) throw new AccessControlError("Grant Command Center Access Before Activating It", 409);
    if (!["Onboarding Access", "Approved"].includes(priorStatus)) throw new AccessControlError("Only An Approved Onboarding Access Record Can Be Activated", 409);
    if (!onboarding.complete) throw new AccessControlError(`Full Access Is Blocked: ${onboarding.status}`, 409);
    nextStatus = "Active";
    actionLabel = "Owner Activated Full Command Center Access";
  } else if (input.action === "suspend-access") {
    if (!grant) throw new AccessControlError("No Command Center Access Grant Exists", 409);
    if (!accessStatusAllowsSignIn(priorStatus)) throw new AccessControlError("Only An Enabled Access Record Can Be Suspended", 409);
    nextStatus = "Suspended";
    actionLabel = "Owner Suspended Command Center Access";
  } else if (input.action === "revoke-access") {
    if (!grant) throw new AccessControlError("No Command Center Access Grant Exists", 409);
    if (priorStatus === "Revoked") throw new AccessControlError("This Access Record Is Already Revoked", 409);
    nextStatus = "Revoked";
    actionLabel = "Owner Revoked Command Center Access";
  } else if (input.action === "restore-access") {
    if (!grant) throw new AccessControlError("No Prior Command Center Access Grant Exists", 409);
    if (!["Suspended", "Revoked", "Microsoft Account Disabled"].includes(priorStatus)) throw new AccessControlError("Only Suspended, Revoked, Or Microsoft-Disabled Access Can Be Restored", 409);
    nextStatus = statusAfterOwnerRestore({ onboardingComplete: onboarding.complete });
    actionLabel = "Owner Reapproved Command Center Access";
  }
  const activeMember = nextStatus === "Active" || nextStatus === "Onboarding Access" || nextStatus === "Approved";
  const auditId = crypto.randomUUID();
  const employeeId = employeeRecordId(email);
  const existingEmployee = await db.prepare(`SELECT id FROM command_records WHERE project_id = ? AND id = ?`).bind(PEOPLE_PROJECT_ID, employeeId).first<{ id: string }>();
  const statements: AccessStatement[] = [
    db.prepare(`INSERT INTO microsoft_access_grants
      (provider_subject, microsoft_email, access_status, company_access_level, designations_json, project_scopes_json, previous_access_status, owner_approved_by_name, owner_approved_by_email, owner_approved_at, activated_at, suspended_at, revoked_at, decision_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_subject) DO UPDATE SET
        microsoft_email = excluded.microsoft_email,
        access_status = excluded.access_status,
        company_access_level = excluded.company_access_level,
        designations_json = excluded.designations_json,
        project_scopes_json = excluded.project_scopes_json,
        previous_access_status = excluded.previous_access_status,
        owner_approved_by_name = excluded.owner_approved_by_name,
        owner_approved_by_email = excluded.owner_approved_by_email,
        owner_approved_at = excluded.owner_approved_at,
        activated_at = excluded.activated_at,
        suspended_at = excluded.suspended_at,
        revoked_at = excluded.revoked_at,
        decision_reason = excluded.decision_reason,
        updated_at = excluded.updated_at`)
      .bind(directory.provider_subject, email, nextStatus, requestedLevel, JSON.stringify(designations), JSON.stringify(projectScopes), priorStatus, actor.name, actor.email, now, nextStatus === "Active" ? now : grant?.activated_at || null, nextStatus === "Suspended" ? now : null, nextStatus === "Revoked" ? now : null, reason, now),
    db.prepare(`INSERT INTO company_members
      (email, display_name, company_access_level, designations_json, is_active, identity_provider, provider_subject, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'microsoft_entra_authorized', ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        company_access_level = CASE WHEN company_members.company_access_level = 'Company Owner' THEN 'Company Owner' ELSE excluded.company_access_level END,
        designations_json = excluded.designations_json,
        is_active = excluded.is_active,
        identity_provider = excluded.identity_provider,
        provider_subject = excluded.provider_subject,
        updated_at = excluded.updated_at`)
      .bind(email, directory.display_name, requestedLevel, JSON.stringify(designations), activeMember ? 1 : 0, directory.provider_subject, now, now),
    accessAuditStatement(db, {
      id: auditId,
      providerSubject: directory.provider_subject,
      email,
      action: actionLabel,
      priorStatus,
      nextStatus,
      actorName: actor.name,
      actorEmail: actor.email,
      actorType: "Human",
      reason,
      detail: { accessLevel: requestedLevel, designations, projectScopes, onboardingStatus: onboarding.status },
    }),
  ];
  if (!existingEmployee) {
    statements.push(db.prepare(`INSERT INTO command_records
      (project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, created_at, updated_at)
      VALUES (?, ?, 'Employee Onboarding', ?, ?, ?, 'Hire Date Required', ?, ?, ?, ?, ?)`)
      .bind(PEOPLE_PROJECT_ID, employeeId, `${directory.display_name} Employee Lifecycle`, directory.display_name, now.slice(0, 10), `${requestedLevel} · Microsoft Account Confirmed · Owner Approved For Onboarding`, now.slice(0, 10), JSON.stringify({
        email,
        name: directory.display_name,
        hireDate: "",
        birthDate: "",
        position: directory.job_title || designations[0] || "Employee",
        department: directory.department || "Unassigned",
        supervisor: "Company Leadership",
        workLocation: "Mefford Company Operations",
        checklistOwner: "Company Administration",
        accessLevel: requestedLevel,
        designations,
        lifecycleStatus: "Pre-Boarding",
        microsoftProviderSubject: directory.provider_subject,
        microsoftAccountConfirmedAt: now,
        ownerAccessApprovedAt: now,
        ownerAccessApprovedBy: actor.email,
        completions: {},
      }), now, now));
  }
  await db.batch(statements);
  return { saved: true, notice: `${directory.display_name}: ${nextStatus}.`, accessStatus: nextStatus, onboardingStatus: onboarding.status };
}

export async function microsoftAccessGateForActor(actor: CommandActor) {
  if (!actor.authenticated || !actor.email) return { allowed: false, status: "Authentication Required", enforced: true };
  const connection = await microsoftAccessControlConnection();
  if (actor.accessLevel === "Company Owner" && !connection.enforced) return { allowed: true, status: "Owner Bootstrap Access", enforced: false, microsoftEmail: actor.email };
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  const grant = await db.prepare(`SELECT g.*, d.account_enabled, d.directory_present
    FROM microsoft_access_grants g
    LEFT JOIN microsoft_directory_users d ON d.provider_subject = g.provider_subject
    WHERE lower(g.microsoft_email) = ? LIMIT 1`).bind(actor.email.toLowerCase()).first<GrantRow & { account_enabled: number | null; directory_present: number | null }>();
  if (!connection.enforced) return { allowed: true, status: grant?.access_status || "Legacy Access Until Microsoft Enforcement", enforced: false, microsoftEmail: actor.email, providerSubject: grant?.provider_subject || "" };
  const allowed = Boolean(grant && grant.account_enabled && grant.directory_present && accessStatusAllowsSignIn(grant.access_status));
  return { allowed, status: grant?.access_status || "Owner Approval Required", enforced: true, microsoftEmail: grant?.microsoft_email || actor.email, providerSubject: grant?.provider_subject || "" };
}

export async function approvedMicrosoftIdentityForActor(actor: CommandActor) {
  const gate = await microsoftAccessGateForActor(actor);
  if (!gate.allowed) throw new AccessControlError(`Microsoft Identity Is Not Authorized: ${gate.status}`, 403);
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  const grant = await db.prepare(`SELECT g.*, d.account_enabled, d.directory_present
    FROM microsoft_access_grants g
    LEFT JOIN microsoft_directory_users d ON d.provider_subject = g.provider_subject
    WHERE lower(g.microsoft_email) = ? LIMIT 1`).bind(actor.email.toLowerCase()).first<GrantRow & { account_enabled: number | null; directory_present: number | null }>();
  if (!grant || !grant.account_enabled || !grant.directory_present || !accessStatusAllowsSignIn(grant.access_status)) {
    throw new AccessControlError("Link And Owner-Approve This Microsoft Account Before Outlook, Calendar, Or Teams Can Be Used", 403);
  }
  return { microsoftEmail: grant.microsoft_email, providerSubject: grant.provider_subject, accessStatus: grant.access_status };
}

export async function authorizedMicrosoftIdentityForActor(actor: CommandActor) {
  const identity = await approvedMicrosoftIdentityForActor(actor);
  const proof = await microsoftEntraProofStatus(actor, identity);
  if (proof.required && !proof.verified) {
    throw new AccessControlError("Complete The Single-Tenant Microsoft Sign-In Proof Before Outlook, Calendar, Or Teams Can Be Used", 403);
  }
  return { ...identity, entraVerified: proof.verified, entraVerifiedAt: proof.verifiedAt };
}

export async function recordMicrosoftActivity(input: {
  actor: CommandActor;
  microsoftEmail: string;
  providerSubject?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  status: "Succeeded" | "Failed";
  detail?: Record<string, unknown>;
  error?: unknown;
}) {
  const db = await accessDb();
  await ensureMicrosoftAccessSchema(db);
  await db.prepare(`INSERT INTO microsoft_activity_audits
    (id, provider_subject, microsoft_email, command_actor_email, action, resource_type, resource_id, status, detail_json, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.providerSubject || "", input.microsoftEmail, input.actor.email, input.action, input.resourceType, input.resourceId || "", input.status, JSON.stringify(input.detail || {}), input.error ? safeError(input.error) : "", new Date().toISOString()).run();
}

export class AccessControlError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function onboardingReadiness(email: string) {
  const employee = await getEmployeeOnboardingData(email);
  if (!employee) return { complete: false, status: "Employee Record Required" };
  const state = onboardingState(employee, await getOnboardingRequirements());
  return { complete: !state.permissionLocked, status: state.status };
}

function disabledAccessStatements(db: MicrosoftAccessDatabase, input: {
  grant: GrantRow;
  email: string;
  providerSubject: string;
  runId: string;
  reason: string;
  now: string;
}) {
  return [
    db.prepare(`UPDATE microsoft_access_grants SET previous_access_status = access_status, access_status = 'Microsoft Account Disabled', decision_reason = ?, updated_at = ? WHERE provider_subject = ? AND access_status <> 'Microsoft Account Disabled'`)
      .bind(input.reason, input.now, input.providerSubject),
    db.prepare(`UPDATE company_members SET is_active = 0, updated_at = ? WHERE lower(email) = ?`).bind(input.now, input.email.toLowerCase()),
    accessAuditStatement(db, {
      id: crypto.randomUUID(),
      providerSubject: input.providerSubject,
      email: input.email,
      action: "Microsoft Directory Automatically Blocked Access",
      priorStatus: input.grant.access_status,
      nextStatus: "Microsoft Account Disabled",
      actorName: "Microsoft Directory Reconciliation",
      actorEmail: "system@command-center.internal",
      actorType: "Automation",
      reason: input.reason,
      detail: { restorationRule: "Owner reapproval required after Microsoft re-enables the account" },
      syncRunId: input.runId,
    }),
  ];
}

function accessAuditStatement(db: MicrosoftAccessDatabase, input: {
  id: string;
  providerSubject: string;
  email: string;
  action: string;
  priorStatus: string;
  nextStatus: string;
  actorName: string;
  actorEmail: string;
  actorType: string;
  reason: string;
  detail: Record<string, unknown>;
  syncRunId?: string;
}) {
  return db.prepare(`INSERT INTO microsoft_access_audits
    (id, provider_subject, microsoft_email, action, prior_status, next_status, actor_name, actor_email, actor_type, reason, detail_json, sync_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, input.providerSubject, input.email, input.action, input.priorStatus, input.nextStatus, input.actorName, input.actorEmail, input.actorType, input.reason, JSON.stringify(input.detail), input.syncRunId || "", new Date().toISOString());
}

async function accessDb() {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: MicrosoftAccessDatabase }).DB;
}

function parseJsonArray(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown Microsoft access error"))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1_000);
}
