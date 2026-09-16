import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  vendorComplianceDocuments,
  vendorComplianceOverrides,
  vendorInvites,
  vendorProjectAccess,
} from "../db/schema";
import { QUALITY_ITEM_RECORD_TYPE, parseQualityData } from "./quality-control";
import { CLOSEOUT_REQUIREMENT_TYPE, parseCloseoutData } from "./closeout";
import type { CommandActor } from "./server-actor";

type CommandDb = ReturnType<(typeof import("../db"))["getDb"]>;

export const REQUIRED_VENDOR_COMPLIANCE = [
  "W-9",
  "General Liability",
  "Workers Compensation",
  "Auto Liability",
] as const;

export const REQUIRED_FINAL_CLOSEOUT = [
  "Final Lien Waiver",
  "Warranty",
  "O&M Manuals",
  "As-Built Drawings",
] as const;

export const VENDOR_DOCUMENT_KINDS = [
  ...REQUIRED_VENDOR_COMPLIANCE,
  "Umbrella Insurance",
  "Trade License",
  "Safety Program",
  ...REQUIRED_FINAL_CLOSEOUT,
] as const;

export async function ensureVendorSchema() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_profiles (
      id text PRIMARY KEY NOT NULL, legal_name text NOT NULL, dba_name text DEFAULT '' NOT NULL,
      vendor_type text DEFAULT 'Subcontractor' NOT NULL, status text DEFAULT 'Prospective' NOT NULL,
      contact_name text NOT NULL, contact_email text NOT NULL, contact_phone text DEFAULT '' NOT NULL,
      address_json text DEFAULT '{}' NOT NULL, trades_json text DEFAULT '[]' NOT NULL,
      service_areas_json text DEFAULT '[]' NOT NULL, payment_terms text DEFAULT 'Net 30' NOT NULL,
      tax_id_last_four text DEFAULT '' NOT NULL, approved_by text DEFAULT '' NOT NULL, approved_at text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_profiles_status_idx ON vendor_profiles (status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_invites (
      id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, email text NOT NULL, code_hash text NOT NULL,
      expires_at text NOT NULL, attempts integer DEFAULT 0 NOT NULL, verified_at text, revoked_at text,
      session_hash text, session_expires_at text, created_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_invites_vendor_idx ON vendor_invites (vendor_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_invites_email_idx ON vendor_invites (email)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_compliance_documents (
      id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, kind text NOT NULL, effective_date text,
      expiration_date text, status text DEFAULT 'Pending Review' NOT NULL, storage_key text NOT NULL,
      file_name text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL,
      reviewed_by text DEFAULT '' NOT NULL, reviewed_at text, review_note text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_compliance_vendor_kind_idx ON vendor_compliance_documents (vendor_id, kind)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_compliance_expiration_idx ON vendor_compliance_documents (expiration_date)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_project_access (
      id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, project_id text NOT NULL, project_name text NOT NULL,
      status text DEFAULT 'Active' NOT NULL, trade text DEFAULT '' NOT NULL,
      contract_reference text DEFAULT '' NOT NULL, cost_code text DEFAULT '' NOT NULL,
      committed_amount text DEFAULT '0' NOT NULL, permissions_json text DEFAULT '[]' NOT NULL,
      shared_records_json text DEFAULT '[]' NOT NULL, granted_by text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_project_access_vendor_idx ON vendor_project_access (vendor_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_project_access_project_idx ON vendor_project_access (project_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_submissions (
      id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, project_id text NOT NULL,
      submission_type text NOT NULL, title text NOT NULL, amount text DEFAULT '0' NOT NULL,
      period_end text, status text DEFAULT 'Submitted' NOT NULL, payload_json text DEFAULT '{}' NOT NULL,
      attachment_storage_key text DEFAULT '' NOT NULL, attachment_name text DEFAULT '' NOT NULL,
      compliance_snapshot_json text DEFAULT '{}' NOT NULL, ap_record_id text DEFAULT '' NOT NULL,
      submitted_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_submissions_vendor_idx ON vendor_submissions (vendor_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_submissions_project_idx ON vendor_submissions (project_id)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_submissions_status_idx ON vendor_submissions (status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_compliance_overrides (
      id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, project_id text DEFAULT 'ALL' NOT NULL,
      reason text NOT NULL, expires_at text NOT NULL, owner_name text NOT NULL, owner_email text NOT NULL,
      revoked_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_overrides_vendor_idx ON vendor_compliance_overrides (vendor_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS vendor_audits (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL, vendor_id text NOT NULL,
      submission_id text DEFAULT '' NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL,
      action text NOT NULL, detail text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS vendor_audits_vendor_idx ON vendor_audits (vendor_id)`),
  ]);
}

export async function vendorInternalActor(actor: CommandActor) {
  if (!actor.authenticated || !actor.email) return null;
  const { getDb } = await import("../db");
  const rows = await getDb()
    .select({
      name: companyMembers.displayName,
      level: companyMembers.companyAccessLevel,
      designationsJson: companyMembers.designationsJson,
    })
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  const level = rows[0]?.level || actor.accessLevel;
  const designations = parseStringArray(rows[0]?.designationsJson || "[]");
  if (
    !["Company Owner", "Administrator"].includes(level) &&
    !designations.some((item) => ["Accountant", "Financial Administrator"].includes(item))
  ) return null;
  return { ...actor, name: rows[0]?.name || actor.name, accessLevel: level, designations };
}

export async function complianceState(db: CommandDb, vendorId: string, projectId = "ALL") {
  const now = new Date();
  const [documents, overrides] = await Promise.all([
    db
      .select()
      .from(vendorComplianceDocuments)
      .where(eq(vendorComplianceDocuments.vendorId, vendorId))
      .orderBy(desc(vendorComplianceDocuments.createdAt), desc(vendorComplianceDocuments.id)),
    db
      .select()
      .from(vendorComplianceOverrides)
      .where(
        and(
          eq(vendorComplianceOverrides.vendorId, vendorId),
          or(
            eq(vendorComplianceOverrides.projectId, "ALL"),
            eq(vendorComplianceOverrides.projectId, projectId),
          ),
        ),
      ),
  ]);
  const currentByKind = new Map<string, typeof documents[number]>();
  for (const document of documents) {
    if (!currentByKind.has(document.kind)) currentByKind.set(document.kind, document);
  }
  const missing = REQUIRED_VENDOR_COMPLIANCE.filter((kind) => {
    const document = currentByKind.get(kind);
    return !document || document.status !== "Approved";
  });
  const expired = REQUIRED_VENDOR_COMPLIANCE.filter((kind) => {
    const document = currentByKind.get(kind);
    return Boolean(
      document?.status === "Approved" &&
      document.expirationDate &&
      new Date(`${document.expirationDate}T23:59:59-04:00`) < now,
    );
  });
  const activeOverride = overrides.find(
    (item) => !item.revokedAt && new Date(item.expiresAt) > now,
  );
  const incomplete = Boolean(missing.length || expired.length);
  const paymentBlocked = incomplete && !activeOverride;
  return {
    blocked: paymentBlocked,
    paymentBlocked,
    projectBlocked: false,
    incomplete,
    missing,
    expired,
    activeOverride: activeOverride || null,
    documents,
  };
}

export async function finalCloseoutState(db: CommandDb, vendorId: string, projectId = "") {
  const documents = await db
    .select()
    .from(vendorComplianceDocuments)
    .where(
      and(
        eq(vendorComplianceDocuments.vendorId, vendorId),
        inArray(vendorComplianceDocuments.kind, [...REQUIRED_FINAL_CLOSEOUT]),
      ),
    )
    .orderBy(desc(vendorComplianceDocuments.id));
  const approved = new Set(documents.filter((item) => item.status === "Approved").map((item) => item.kind));
  const legacyMissing = REQUIRED_FINAL_CLOSEOUT.filter((kind) => !approved.has(kind));
  const closeoutRows = projectId ? await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE))) : [];
  const assignedCloseout = closeoutRows.filter((item) => String(parseCloseoutData(item.dataJson).vendorId || "") === vendorId);
  const controlledMissing = assignedCloseout.filter((item) => !["Approved", "Not Applicable"].includes(item.status)).map((item) => `${item.id} ${item.title}`);
  const missing = assignedCloseout.length ? controlledMissing : legacyMissing;
  const qualityItems = projectId ? await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, QUALITY_ITEM_RECORD_TYPE))) : [];
  const openQuality = qualityItems.filter((item) => item.status !== "Closed" && String(parseQualityData(item.dataJson).responsibleVendorId || "") === vendorId);
  const qualityMissing = openQuality.map((item) => `Open Quality Item ${item.id}`);
  return { blocked: missing.length > 0 || qualityMissing.length > 0, missing: [...missing, ...qualityMissing], openQualityItems: openQuality.map((item) => ({ id: item.id, title: item.title, status: item.status })) };
}

export async function vendorPortalSession(request: Request) {
  const inviteId = request.headers.get("x-vendor-invite")?.trim() || "";
  const session = request.headers.get("x-vendor-session")?.trim() || "";
  if (!inviteId || !session) return null;
  const { getDb } = await import("../db");
  const invite = await getDb()
    .select()
    .from(vendorInvites)
    .where(eq(vendorInvites.id, inviteId))
    .limit(1);
  const row = invite[0];
  if (
    !row || row.revokedAt || !row.sessionHash || !row.sessionExpiresAt ||
    new Date(row.sessionExpiresAt) <= new Date() ||
    (await hashSecret(session)) !== row.sessionHash
  ) return null;
  return row;
}

export async function refreshProjectAccessStatus(db: CommandDb, vendorId: string) {
  const access = await db
    .select()
    .from(vendorProjectAccess)
    .where(eq(vendorProjectAccess.vendorId, vendorId));
  for (const row of access) {
    if (row.status === "Compliance Blocked") {
      await db
        .update(vendorProjectAccess)
        .set({ status: "Active", updatedAt: new Date().toISOString() })
        .where(eq(vendorProjectAccess.id, row.id));
    }
  }
}

export async function hashSecret(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
