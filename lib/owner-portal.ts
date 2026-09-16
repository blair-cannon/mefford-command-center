export const OWNER_CONTRACT_PHASES = [
  "Draft Preparation",
  "Internal Review",
  "Approved for Owner Review",
  "Owner Review",
  "Changes Requested",
  "Mefford Revision",
  "Owner Review Complete",
  "Final Approval",
  "Ready for Signature",
  "Owner Signed",
  "Phase 1 Executed",
  "GMP Exhibit A Draft",
  "Executed",
] as const;

export const OWNER_VISIBLE_RECORD_TYPES = [
  "Change Orders",
  "Owner Billing",
  "Owner Invoices",
  "Schedule",
  "Selections",
  "Closeout Requirements",
  "Project Owner Messages",
] as const;

export async function ensureOwnerPortalSchema(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_portal_access (
      project_id text PRIMARY KEY NOT NULL,
      contract_record_id text NOT NULL,
      status text DEFAULT 'Dormant' NOT NULL,
      contact_name text DEFAULT '' NOT NULL,
      contact_email text DEFAULT '' NOT NULL,
      approved_revision_id text DEFAULT '' NOT NULL,
      approved_by text DEFAULT '' NOT NULL,
      approved_at text,
      invited_at text,
      last_review_at text,
      revoked_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_portal_access_status_idx ON owner_portal_access (status)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_portal_invites (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      contract_record_id text NOT NULL,
      contact_name text NOT NULL,
      email text NOT NULL,
      code_hash text NOT NULL,
      status text DEFAULT 'Issued' NOT NULL,
      expires_at text NOT NULL,
      attempts integer DEFAULT 0 NOT NULL,
      verified_at text,
      revoked_at text,
      session_hash text,
      session_expires_at text,
      created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_portal_invites_project_idx ON owner_portal_invites (project_id)`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_portal_invites_email_idx ON owner_portal_invites (email)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_contract_revisions (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      contract_record_id text NOT NULL,
      revision_number integer NOT NULL,
      phase text NOT NULL,
      contract_type text NOT NULL,
      fields_json text DEFAULT '{}' NOT NULL,
      snapshot_hash text NOT NULL,
      note text DEFAULT '' NOT NULL,
      created_by_type text NOT NULL,
      created_by_name text NOT NULL,
      created_by_email text NOT NULL,
      frozen_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS owner_contract_revision_number_idx ON owner_contract_revisions (project_id, contract_record_id, revision_number)`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_contract_revision_project_idx ON owner_contract_revisions (project_id, created_at)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_contract_change_requests (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      contract_record_id text NOT NULL,
      revision_id text NOT NULL,
      clause_key text NOT NULL,
      request_type text NOT NULL,
      original_text text DEFAULT '' NOT NULL,
      proposed_text text DEFAULT '' NOT NULL,
      comment text DEFAULT '' NOT NULL,
      status text DEFAULT 'Open' NOT NULL,
      mefford_response text DEFAULT '' NOT NULL,
      created_by_name text NOT NULL,
      created_by_email text NOT NULL,
      resolved_by_name text DEFAULT '' NOT NULL,
      resolved_by_email text DEFAULT '' NOT NULL,
      resolved_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_contract_change_project_idx ON owner_contract_change_requests (project_id, status, created_at)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS owner_portal_audits (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id text NOT NULL,
      contract_record_id text DEFAULT '' NOT NULL,
      actor_type text NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      action text NOT NULL,
      detail text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    database.prepare(`CREATE INDEX IF NOT EXISTS owner_portal_audit_project_idx ON owner_portal_audits (project_id, created_at)`),
  ]);
}

export async function hashOwnerSecret(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomOwnerToken(bytes = 24) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function randomOwnerCode() {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (values[0] % 900000));
}

export async function ownerPortalSession(database: D1Database, request: Request) {
  const inviteId = request.headers.get("x-owner-invite")?.trim() || "";
  const sessionToken = request.headers.get("x-owner-session")?.trim() || "";
  if (!inviteId || !sessionToken) return null;
  const invite = await database.prepare(
    `SELECT id, project_id, contract_record_id, contact_name, email, status,
            expires_at, revoked_at, session_hash, session_expires_at
     FROM owner_portal_invites WHERE id = ? LIMIT 1`,
  ).bind(inviteId).first<{
    id: string; project_id: string; contract_record_id: string; contact_name: string;
    email: string; status: string; expires_at: string; revoked_at: string | null;
    session_hash: string | null; session_expires_at: string | null;
  }>();
  if (!invite || invite.revoked_at || invite.status === "Revoked" || !invite.session_hash || !invite.session_expires_at) return null;
  if (new Date(invite.session_expires_at) <= new Date()) return null;
  if ((await hashOwnerSecret(sessionToken)) !== invite.session_hash) return null;
  return invite;
}

export function parseOwnerObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function ownerPhase(status: string, data: Record<string, unknown>) {
  return String(data.contractPhase || status || "Draft Preparation");
}

export function maskOwnerEmail(value: string) {
  const [name, domain] = value.split("@");
  if (!name || !domain) return "Invited email";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, name.length - 2))}@${domain}`;
}
