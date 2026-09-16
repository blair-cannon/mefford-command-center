import { isTurnover } from "./turnovers";
import { eq } from "drizzle-orm";
import { commandRecords, commandWorkItems, projects } from "../db/schema";
import type { MeetingType } from "./meetings";
import { DEPARTMENT_MEETING_ROLES, MEETING_SECTIONS, isCompanyMeeting, parseJson } from "./meetings";
import { loadMeetingSources, refreshMeetingAgenda, type MeetingSources } from "./meeting-agenda-server";
import { canReadProjectId } from "./project-access";
import type { CommandActor } from "./server-actor";
import { canManageAgenda, isDepartmentMeeting } from "./meeting-agenda-settings";
import { carryManualAgendaTopics } from "./meeting-agenda-control";

export type MeetingActor = CommandActor & { designations?: string[] };

type D1Row = Record<string, string | number | null>;

export async function ensureMeetingTables() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_series (id text PRIMARY KEY NOT NULL, meeting_type text NOT NULL, project_id text DEFAULT 'MEFFORD-COMPANY' NOT NULL, title text NOT NULL, status text DEFAULT 'Active' NOT NULL, cadence text NOT NULL, start_at text NOT NULL, duration_minutes integer NOT NULL, time_zone text DEFAULT 'America/New_York' NOT NULL, meeting_mode text DEFAULT 'Teams Remote' NOT NULL, location text DEFAULT 'Microsoft Teams' NOT NULL, leader_name text NOT NULL, leader_email text NOT NULL, organizer_email text NOT NULL, recording_default integer DEFAULT true NOT NULL, auto_publish_hours integer DEFAULT 24 NOT NULL, graph_event_id text DEFAULT '' NOT NULL, graph_change_key text DEFAULT '' NOT NULL, teams_join_url text DEFAULT '' NOT NULL, access_json text DEFAULT '{}' NOT NULL, not_required_reason text DEFAULT '' NOT NULL, not_required_by text DEFAULT '' NOT NULL, not_required_at text, created_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_series_scope_idx ON meeting_series (project_id, meeting_type, status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_occurrences (id text PRIMARY KEY NOT NULL, series_id text NOT NULL, meeting_number text NOT NULL UNIQUE, scheduled_start text NOT NULL, scheduled_end text NOT NULL, status text DEFAULT 'Draft Agenda' NOT NULL, recording_enabled integer DEFAULT true NOT NULL, recording_override_reason text DEFAULT '' NOT NULL, recording_override_by text DEFAULT '' NOT NULL, recording_override_at text, publication_hold integer DEFAULT false NOT NULL, publication_hold_reason text DEFAULT '' NOT NULL, publication_hold_by text DEFAULT '' NOT NULL, publication_hold_at text, transcript_status text DEFAULT 'Awaiting Meeting' NOT NULL, graph_event_id text DEFAULT '' NOT NULL, teams_meeting_id text DEFAULT '' NOT NULL, published_at text, started_at text, held_at text, draft_minutes_at text, finalized_at text, distributed_at text, finalized_by text DEFAULT '' NOT NULL, minutes_revision integer DEFAULT 0 NOT NULL, minutes_summary text DEFAULT '' NOT NULL, financial_snapshot_json text DEFAULT '{}' NOT NULL, distribution_json text DEFAULT '[]' NOT NULL, agenda_pdf_key text DEFAULT '' NOT NULL, minutes_pdf_key text DEFAULT '' NOT NULL, leader_rating integer, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_occurrence_series_idx ON meeting_occurrences (series_id, scheduled_start)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_attendees (id text PRIMARY KEY NOT NULL, occurrence_id text NOT NULL, name text NOT NULL, email text NOT NULL, attendee_role text DEFAULT 'Participant' NOT NULL, attendance_requirement text DEFAULT 'Required' NOT NULL, external integer DEFAULT false NOT NULL, calendar_response text DEFAULT 'Not Responded' NOT NULL, attendance_status text DEFAULT 'Unconfirmed' NOT NULL, attendance_source text DEFAULT '' NOT NULL, check_in_at text, check_out_at text, end_confirmed_at text, rating integer, exception_reason text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_attendee_occurrence_idx ON meeting_attendees (occurrence_id, email)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_agenda_items (id text PRIMARY KEY NOT NULL, occurrence_id text NOT NULL, section_key text NOT NULL, title text NOT NULL, position integer NOT NULL, timebox_minutes integer NOT NULL, status text DEFAULT 'Open' NOT NULL, notes text DEFAULT '' NOT NULL, source_type text DEFAULT 'Standard Section' NOT NULL, source_id text DEFAULT '' NOT NULL, source_version text DEFAULT '' NOT NULL, source_reason text DEFAULT '' NOT NULL, ai_suggested integer DEFAULT false NOT NULL, ai_confidence text DEFAULT '' NOT NULL, visibility text DEFAULT 'Attendees' NOT NULL, addendum_number integer DEFAULT 0 NOT NULL, published_at text, created_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_agenda_occurrence_idx ON meeting_agenda_items (occurrence_id, position)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_decisions (id text PRIMARY KEY NOT NULL, occurrence_id text NOT NULL, statement text NOT NULL, decision_maker_name text NOT NULL, decision_maker_email text NOT NULL, status text DEFAULT 'Proposed' NOT NULL, participants_json text DEFAULT '[]' NOT NULL, source_links_json text DEFAULT '[]' NOT NULL, impacts_json text DEFAULT '[]' NOT NULL, implementation_owner text DEFAULT '' NOT NULL, evidence text DEFAULT '' NOT NULL, proposed_by text NOT NULL, confirmed_by text DEFAULT '' NOT NULL, confirmed_at text, supersedes_id text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_decision_occurrence_idx ON meeting_decisions (occurrence_id, status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_action_items (id text PRIMARY KEY NOT NULL, occurrence_id text NOT NULL, series_id text NOT NULL, project_id text NOT NULL, title text NOT NULL, definition_of_done text NOT NULL, assignee_name text NOT NULL, assignee_email text NOT NULL, collaborators_json text DEFAULT '[]' NOT NULL, due_at text NOT NULL, priority text DEFAULT 'Normal' NOT NULL, item_kind text DEFAULT 'To-Do' NOT NULL, status text DEFAULT 'Assignment Not Confirmed' NOT NULL, blocker text DEFAULT '' NOT NULL, evidence text DEFAULT '' NOT NULL, source_type text DEFAULT 'Meeting' NOT NULL, source_id text DEFAULT '' NOT NULL, carry_count integer DEFAULT 0 NOT NULL, carried_from_id text DEFAULT '' NOT NULL, cancelled_reason text DEFAULT '' NOT NULL, work_item_id text DEFAULT '' NOT NULL, created_by text NOT NULL, completed_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_action_occurrence_idx ON meeting_action_items (occurrence_id, status)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_action_assignee_idx ON meeting_action_items (assignee_email, status, due_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_attachments (id text PRIMARY KEY NOT NULL, occurrence_id text NOT NULL, name text NOT NULL, category text DEFAULT 'Meeting File' NOT NULL, storage_key text DEFAULT '' NOT NULL, content_type text DEFAULT 'application/octet-stream' NOT NULL, size_bytes integer DEFAULT 0 NOT NULL, source_type text DEFAULT 'Command Center' NOT NULL, source_id text DEFAULT '' NOT NULL, source_version text DEFAULT 'Current' NOT NULL, access text DEFAULT 'Attendees' NOT NULL, include_with_minutes integer DEFAULT false NOT NULL, uploaded_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_attachment_occurrence_idx ON meeting_attachments (occurrence_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_audits (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, series_id text DEFAULT '' NOT NULL, occurrence_id text DEFAULT '' NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, action text NOT NULL, before_json text DEFAULT '{}' NOT NULL, after_json text DEFAULT '{}' NOT NULL, reason text DEFAULT '' NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_audit_occurrence_idx ON meeting_audits (occurrence_id, created_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS meeting_sync_events (id text PRIMARY KEY NOT NULL, series_id text DEFAULT '' NOT NULL, occurrence_id text DEFAULT '' NOT NULL, provider text DEFAULT 'Microsoft Graph' NOT NULL, direction text NOT NULL, event_type text NOT NULL, status text NOT NULL, provider_id text DEFAULT '' NOT NULL, detail text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS meeting_sync_status_idx ON meeting_sync_events (status, created_at)`),
  ]);
}

export class MeetingAccessError extends Error {
  status = 403;
}

export function canManageMeetings(actor: MeetingActor, type?: MeetingType) {
  if (actor.accessLevel === "Company Owner") return true;
  const roles = actor.designations || [];
  if (type === "Accounting Department") return roles.some(role => (DEPARTMENT_MEETING_ROLES[type] || []).includes(role));
  if (actor.accessLevel === "Administrator") return true;
  if (type && DEPARTMENT_MEETING_ROLES[type]) return roles.some(role => DEPARTMENT_MEETING_ROLES[type]!.includes(role));
  if (type && isCompanyMeeting(type)) return false;
  return roles.some(role => ["Project Manager", "Superintendent"].includes(role));
}

export async function canCreateMeeting(actor: MeetingActor, type: MeetingType, projectId: string) {
  if (!canManageMeetings(actor, type)) return false;
  if (isCompanyMeeting(type)) return true;
  const { getDb } = await import("../db");
  return canReadProjectId(getDb(), actor, projectId);
}

export function canEditMeeting(actor: MeetingActor, context: D1Row) {
  const type = String(context.meeting_type) as MeetingType;
  if (type === "Accounting Department" && !canManageMeetings(actor, type)) return false;
  return ["Company Owner", "Administrator"].includes(actor.accessLevel) || String(context.leader_email || "").toLowerCase() === actor.email.toLowerCase();
}

export async function canAccessMeeting(actor: MeetingActor, context: D1Row, occurrenceId?: string) {
  if (String(context.meeting_type) === "Accounting Department" && !canManageMeetings(actor, "Accounting Department")) return false;
  if (canEditMeeting(actor, context)) return true;
  const { env } = await import("cloudflare:workers");
  const attendee = occurrenceId
    ? await env.DB.prepare(`SELECT id FROM meeting_attendees WHERE occurrence_id = ? AND lower(email) = lower(?)`).bind(occurrenceId, actor.email).first()
    : await env.DB.prepare(`SELECT a.id FROM meeting_attendees a JOIN meeting_occurrences o ON o.id = a.occurrence_id WHERE o.series_id = ? AND lower(a.email) = lower(?)`).bind(context.id, actor.email).first();
  return Boolean(attendee);
}

export function canFinalizeMeeting(actor: MeetingActor, series: D1Row) {
  return canEditMeeting(actor, series);
}

export async function runDeterministicMeetingRules(projectId?: string) {
  const { env } = await import("cloudflare:workers");
  const system: MeetingActor = { name: "Command Center Agenda Rules", email: "system@meffcon.com", accessLevel: "Company Owner", authenticated: true, identityProvider: "sites_authenticated_user", designations: [] };
  // The scheduler stays bounded. Opening an agenda and explicit publication also
  // refresh the selected occurrence, so a busy queue cannot publish stale sources.
  const ready = await env.DB.prepare(`SELECT o.id, o.series_id, s.meeting_type, s.project_id FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE o.status IN ('Draft Agenda','Published Agenda') AND s.status = 'Active' AND datetime(o.scheduled_start) BETWEEN datetime('now','-7 days') AND datetime('now','+28 days') ${projectId ? "AND s.project_id = ?" : ""} ORDER BY COALESCE((SELECT MAX(a.created_at) FROM meeting_audits a WHERE a.occurrence_id = o.id AND a.entity_type = 'Agenda Refresh Check'), '1900-01-01'), o.scheduled_start LIMIT 8`).bind(...(projectId ? [projectId] : [])).all<D1Row>();
  const sources = ready.results.length ? await loadMeetingSources() : undefined;
  let published = 0;
  for (const row of ready.results) {
    const refreshed = await automatedAgendaItems({ type: String(row.meeting_type) as MeetingType, projectId: String(row.project_id), occurrenceId: String(row.id), seriesId: String(row.series_id), actor: system, sources });
    if (refreshed.busy) continue;
    const now = new Date().toISOString();
    const due = await env.DB.prepare(`SELECT o.id FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE o.id = ? AND o.status = 'Draft Agenda' AND o.publication_hold = 0 AND datetime(o.scheduled_start) <= datetime('now', '+' || s.auto_publish_hours || ' hours')`).bind(row.id).first();
    if (due) {
      const publication = await env.DB.batch([
        env.DB.prepare(`UPDATE meeting_occurrences SET status = 'Published Agenda', published_at = ?, updated_at = ? WHERE id = ? AND status = 'Draft Agenda' AND publication_hold = 0 AND NOT EXISTS (SELECT 1 FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND expires_at > ?)`).bind(now, now, row.id, row.id, now),
        env.DB.prepare(`UPDATE meeting_agenda_items SET published_at = COALESCE(published_at, ?) WHERE occurrence_id = ? AND visibility = 'Attendees' AND EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status = 'Published Agenda' AND published_at = ?)`).bind(now, row.id, row.id, now),
      ]);
      if (!Number(publication[0].meta.changes || 0)) continue;
      await auditMeeting({ actor: system, seriesId: String(row.series_id), occurrenceId: String(row.id), entityType: "Meeting Occurrence", entityId: String(row.id), action: "Agenda Auto-Published", reason: "Pre-approved deterministic publication deadline reached after source refresh." });
      published++;
    }
    await auditMeeting({ actor: system, seriesId: String(row.series_id), occurrenceId: String(row.id), entityType: "Agenda Refresh Check", entityId: String(row.id), action: "Scheduled Agenda Refresh Checked" });
  }
  return published;
}

export async function getMeetingContext(occurrenceId: string) {
  const { env } = await import("cloudflare:workers");
  const result = await env.DB.prepare(`SELECT o.*, s.meeting_type, s.project_id, s.title AS series_title, s.status AS series_status, s.cadence, s.time_zone, s.meeting_mode, s.location, s.leader_name, s.leader_email, s.organizer_email, s.access_json, s.recording_default, s.auto_publish_hours, s.teams_join_url, s.graph_event_id AS series_graph_event_id FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE o.id = ?`).bind(occurrenceId).first<D1Row>();
  return result || null;
}

export async function meetingBundle(input: { projectId: string; meetingType?: string; occurrenceId?: string }, actor: MeetingActor) {
  const { env } = await import("cloudflare:workers");
  const conditions = ["s.project_id = ?"];
  const bindings: string[] = [input.projectId];
  if (!canManageMeetings(actor, "Accounting Department")) conditions.push("s.meeting_type <> 'Accounting Department'");
  if (input.meetingType) { conditions.push("s.meeting_type = ?"); bindings.push(input.meetingType); }
  if (!["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    conditions.push("(lower(s.leader_email) = lower(?) OR EXISTS (SELECT 1 FROM meeting_attendees ma JOIN meeting_occurrences mo ON mo.id = ma.occurrence_id WHERE mo.series_id = s.id AND lower(ma.email) = lower(?)))");
    bindings.push(actor.email, actor.email);
  }
  const series = await env.DB.prepare(`SELECT s.* FROM meeting_series s WHERE ${conditions.join(" AND ")} ORDER BY s.start_at DESC`).bind(...bindings).all<D1Row>();
  const seriesIds = series.results.map((item) => String(item.id));
  const occurrences = seriesIds.length
    ? await env.DB.prepare(`SELECT * FROM meeting_occurrences WHERE series_id IN (${seriesIds.map(() => "?").join(",")}) ORDER BY scheduled_start DESC`).bind(...seriesIds).all<D1Row>()
    : { results: [] as D1Row[] };
  const selectedId = input.occurrenceId || String(occurrences.results[0]?.id || "");
  if (selectedId && !occurrences.results.some(row => String(row.id) === selectedId)) throw new MeetingAccessError("You Do Not Have Access To This Meeting");
  const context = selectedId ? await getMeetingContext(selectedId) : null;
  if (context && !await canAccessMeeting(actor, context, selectedId)) throw new MeetingAccessError("You Do Not Have Access To This Meeting");
  const canEdit = context ? canEditMeeting(actor, context) : false;
  const detailQueries = selectedId
    ? await env.DB.batch([
        env.DB.prepare(`SELECT * FROM meeting_attendees WHERE occurrence_id = ? ORDER BY attendance_requirement DESC, name`).bind(selectedId),
        env.DB.prepare(`SELECT * FROM meeting_agenda_items WHERE occurrence_id = ? ORDER BY position, created_at`).bind(selectedId),
        env.DB.prepare(`SELECT * FROM meeting_decisions WHERE occurrence_id = ? ORDER BY created_at`).bind(selectedId),
        env.DB.prepare(`SELECT a.*, w.status AS my_work_status FROM meeting_action_items a LEFT JOIN command_work_items w ON w.id = a.work_item_id WHERE a.occurrence_id = ? OR (a.series_id = (SELECT series_id FROM meeting_occurrences WHERE id = ?) AND a.status NOT IN ('Complete','Cancelled With Reason','Carried Forward')) ORDER BY a.due_at, a.created_at`).bind(selectedId, selectedId),
        env.DB.prepare(`SELECT * FROM meeting_attachments WHERE occurrence_id = ? ORDER BY created_at DESC`).bind(selectedId),
        env.DB.prepare(`SELECT * FROM meeting_audits WHERE occurrence_id = ? ORDER BY created_at DESC LIMIT 100`).bind(selectedId),
        env.DB.prepare(`SELECT * FROM meeting_sync_events WHERE occurrence_id = ? OR series_id IN (SELECT series_id FROM meeting_occurrences WHERE id = ?) ORDER BY created_at DESC LIMIT 30`).bind(selectedId, selectedId),
      ])
    : [];
  return {
    series: series.results,
    occurrences: occurrences.results,
    selectedOccurrenceId: selectedId,
    attendees: detailQueries[0]?.results || [],
    agenda: ((detailQueries[1]?.results || []) as D1Row[]).filter(row => row.status !== "Superseded" && (row.visibility === "Attendees" || (context && canManageAgenda(actor, context) && row.visibility === "Removed") || (canEdit && row.visibility === "Leader Until Promoted"))),
    decisions: detailQueries[2]?.results || [],
    actions: detailQueries[3]?.results || [],
    attachments: detailQueries[4]?.results || [],
    audits: canEdit ? detailQueries[5]?.results || [] : [],
    syncEvents: canEdit ? detailQueries[6]?.results || [] : [],
    permissions: { canEdit, canManageAgenda: context ? canManageAgenda(actor, context) : false, canConfigureManagers: actor.accessLevel === "Company Owner", canCreate: input.meetingType ? await canCreateMeeting(actor, input.meetingType as MeetingType, input.projectId) : false },
  };
}

export async function auditMeeting(input: {
  actor: MeetingActor;
  seriesId?: string;
  occurrenceId?: string;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}) {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`INSERT INTO meeting_audits (series_id, occurrence_id, entity_type, entity_id, action, before_json, after_json, reason, actor_name, actor_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    input.seriesId || "", input.occurrenceId || "", input.entityType, input.entityId, input.action,
    JSON.stringify(input.before || {}), JSON.stringify(input.after || {}), input.reason || "", input.actor.name, input.actor.email,
  ).run();
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function ownerFinancialSnapshot(projectId: string) {
  if (!projectId || projectId === "MEFFORD-COMPANY") return {};
  const { getDb } = await import("../db");
  const db = getDb();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const records = await db.select().from(commandRecords).where(eq(commandRecords.projectId, projectId));
  const project = projectRows[0];
  if (!project) return { warning: "Project Record Not Found" };
  const changes = records.filter((record) => record.recordType === "Change Orders").map((record) => ({ record, data: parseJson<Record<string, unknown>>(record.dataJson, {}) }));
  const approved = changes.filter(({ record, data }) => ["Approved", "Executed", "Owner Approved"].includes(record.status) || data.ownerApproved === true);
  const pending = changes.filter(({ record, data }) => !approved.some((item) => item.record.id === record.id) && !["Void", "Voided", "Rejected"].includes(record.status) && data.cancelled !== true);
  const amount = ({ record, data }: (typeof changes)[number]) => numberFromUnknown(data.amount ?? data.price ?? data.value ?? record.meta);
  const original = numberFromUnknown(project.contractAmount);
  const approvedChanges = approved.reduce((total, item) => total + amount(item), 0);
  const current = original + approvedChanges;
  const recordedCurrent = numberFromUnknown(project.currentContractAmount);
  const billing = records.filter((record) => record.recordType === "Owner Billing" && ["Sent", "Partially Paid", "Paid", "Overdue"].includes(record.status)).map((record) => parseJson<Record<string, unknown>>(record.dataJson, {}));
  const billedToDate = billing.reduce((total, item) => total + numberFromUnknown(item.amount ?? item.currentPaymentDue ?? item.billedToDate), 0);
  return {
    projectId,
    contractType: project.ownerContractType,
    ownerContractRecordId: project.ownerContractRecordId,
    originalExecutedContract: original,
    approvedChanges,
    currentOwnerContract: current,
    recordedCurrentContract: recordedCurrent,
    reconciliationWarning: recordedCurrent > 0 && Math.abs(recordedCurrent - current) > 0.01,
    pendingChangeExposure: pending.reduce((total, item) => total + amount(item), 0),
    billedToDate,
    approvedChangeOrders: approved.map(({ record, data }) => ({ id: record.id, status: record.status, amount: amount({ record, data }), updatedAt: record.updatedAt })),
    pendingChangeOrders: pending.map(({ record, data }) => ({ id: record.id, status: record.status, amount: amount({ record, data }), updatedAt: record.updatedAt })),
    capturedAt: new Date().toISOString(),
    formula: ["T&M", "Time & Materials"].includes(project.ownerContractType) ? "Authorized/NTE + Approved Changes; Incurred Cost Reported Separately" : "Original Executed Contract + Approved Additive/Deductive Changes",
  };
}

type AgendaInput = { type: MeetingType; projectId: string; occurrenceId: string; seriesId: string; actor: MeetingActor; sources?: MeetingSources };
export async function automatedAgendaItems(input: AgendaInput): Promise<Record<string, unknown>> {
  const { env } = await import("cloudflare:workers");
  const now = new Date().toISOString(), token = crypto.randomUUID();
  const claimed = await env.DB.prepare(`INSERT INTO meeting_agenda_refresh_guards (occurrence_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(occurrence_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE meeting_agenda_refresh_guards.expires_at <= ?`).bind(input.occurrenceId, token, new Date(Date.now() + 120000).toISOString(), now).run();
  if (!Number(claimed.meta.changes || 0)) return { busy: true, refreshed: false };
  try { return await populateMeetingAgenda(input); }
  finally { await env.DB.prepare(`DELETE FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND token = ?`).bind(input.occurrenceId, token).run(); }
}

async function populateMeetingAgenda(input: AgendaInput) {
  if (isTurnover(input.type)) return import("./turnover-server").then(m => m.refreshTurnoverMeeting(input.occurrenceId));
  const { env } = await import("cloudflare:workers");
  const refreshed = await refreshMeetingAgenda(input);
  if (refreshed.frozen) return refreshed;
  const sections = MEETING_SECTIONS[input.type];
  const occurrence = await getMeetingContext(input.occurrenceId);
  if (!occurrence) throw new Error("Meeting Occurrence Not Found");
  if (isDepartmentMeeting(input.type)) await carryManualAgendaTopics(env.DB, input.actor, occurrence);
  if (input.type === "Project Owner") {
    const current = await ownerFinancialSnapshot(input.projectId) as Record<string, unknown>;
    const prior = await env.DB.prepare(`SELECT meeting_number, financial_snapshot_json FROM meeting_occurrences WHERE series_id = ? AND id <> ? AND datetime(scheduled_start) < datetime(?) ORDER BY scheduled_start DESC LIMIT 1`).bind(input.seriesId, input.occurrenceId, occurrence.scheduled_start).first<D1Row>();
    const previous = parseJson<Record<string, unknown>>(String(prior?.financial_snapshot_json || "{}"), {});
    const next = { ...current, changeSincePreviousMeeting: prior ? Number(current.currentOwnerContract || 0) - Number(previous.currentOwnerContract || 0) : 0, priorMeetingNumber: prior?.meeting_number || "First Owner Meeting" };
    const old = parseJson<Record<string, unknown>>(String(occurrence.financial_snapshot_json), {});
    if (JSON.stringify({ ...old, capturedAt: "" }) !== JSON.stringify({ ...next, capturedAt: "" })) {
      await env.DB.prepare(`UPDATE meeting_occurrences SET financial_snapshot_json = ?, agenda_pdf_key = '' WHERE id = ? AND status IN ('Draft Agenda','Published Agenda')`).bind(JSON.stringify(next), input.occurrenceId).run();
      await auditMeeting({ actor: input.actor, seriesId: input.seriesId, occurrenceId: input.occurrenceId, entityType: "Owner Financial Snapshot", entityId: input.occurrenceId, action: "Pre-Meeting Contract And Billing Snapshot Refreshed", before: { snapshot: old, priorAgendaPdfKey: occurrence.agenda_pdf_key }, after: next });
    }
  }
  const addendum = occurrence.status === "Published Agenda" ? Number((await env.DB.prepare(`SELECT MAX(addendum_number) AS number FROM meeting_agenda_items WHERE occurrence_id = ?`).bind(input.occurrenceId).first<{ number: number }>())?.number || 0) + 1 : 0;
  const beforeReferences = (await env.DB.prepare(`SELECT id, source_type, source_id, title, status, source_reason FROM meeting_agenda_items WHERE occurrence_id = ? AND source_type IN ('Meeting Action','Quarterly Rock') ORDER BY id`).bind(input.occurrenceId).all<D1Row>()).results;
  const carry = await env.DB.prepare(`SELECT a.* FROM meeting_action_items a JOIN meeting_occurrences o ON o.id = a.occurrence_id WHERE a.series_id = ? AND a.occurrence_id <> ? AND datetime(o.scheduled_start) < datetime(?) AND a.status NOT IN ('Complete','Cancelled With Reason','Carried Forward') ORDER BY a.due_at, a.id`).bind(input.seriesId, input.occurrenceId, occurrence.scheduled_start).all<D1Row>();
  const carrySection = input.type === "Quarterly Rock/Review" ? "quarter-actions" : input.type === "Project Design" ? "previous-actions" : isCompanyMeeting(input.type) ? "previous-todos" : "prior-commitments";
  const position = (sections.findIndex(s => s.key === carrySection) + 1) * 10000 + 5000;
  for (const action of carry.results) {
    const priorReference = beforeReferences.find(row => row.source_type === "Meeting Action" && row.source_id === action.id);
    const id = priorReference ? String(priorReference.id) : `carry:${input.occurrenceId}:${action.id}`;
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_id, source_version, source_reason, visibility, addendum_number, published_at, created_by) VALUES (?, ?, ?, ?, ?, 0, 'Open', '', 'Meeting Action', ?, ?, ?, 'Attendees', ?, ?, ?)`).bind(id, input.occurrenceId, carrySection, String(action.title), position, action.id, action.updated_at, `${action.assignee_name} · ${action.status} · Due ${action.due_at}. Incomplete From A Prior Meeting.`, addendum, occurrence.published_at ? new Date().toISOString() : null, input.actor.name).run();
    if (Number(inserted.meta.changes || 0)) {
      await env.DB.prepare(`UPDATE meeting_action_items SET carry_count = (SELECT COUNT(DISTINCT occurrence_id) FROM meeting_agenda_items WHERE source_type = 'Meeting Action' AND source_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(action.id, action.id).run();
      await auditMeeting({ actor: input.actor, seriesId: input.seriesId, occurrenceId: input.occurrenceId, entityType: "Agenda Item", entityId: id, action: "Unfinished Commitment Carried Forward", after: { actionId: action.id, assignee: action.assignee_name, dueAt: action.due_at } });
    }
  }
  // Carryforward is a reference to the original accountable action, never a copy.
  const references = await env.DB.prepare(`SELECT g.id, g.source_id, a.status, a.assignee_name, a.due_at FROM meeting_agenda_items g JOIN meeting_action_items a ON a.id = g.source_id WHERE g.occurrence_id = ? AND g.source_type = 'Meeting Action'`).bind(input.occurrenceId).all<D1Row>();
  for (const ref of references.results) await env.DB.prepare(`UPDATE meeting_agenda_items SET source_reason = ?, status = CASE WHEN ? IN ('Complete','Cancelled With Reason') AND status = 'Open' THEN 'Source Cleared' WHEN ? NOT IN ('Complete','Cancelled With Reason') AND status = 'Source Cleared' THEN 'Open' ELSE status END WHERE id = ?`).bind(`${ref.assignee_name} · ${ref.status} · Due ${ref.due_at}. Original Commitment Retained.`, ref.status, ref.status, ref.id).run();
  if (["Weekly L10", "Quarterly Rock/Review"].includes(input.type)) {
    const rockSection = input.type === "Weekly L10" ? "rock-review" : "prior-rocks";
    const rocks = await env.DB.prepare(`SELECT * FROM meeting_action_items WHERE project_id = 'MEFFORD-COMPANY' AND item_kind = 'Rock' AND status NOT IN ('Complete','Cancelled With Reason') ORDER BY due_at`).all<D1Row>();
    for (const rock of rocks.results) await env.DB.prepare(`INSERT INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_id, source_reason, visibility, created_by) VALUES (?, ?, ?, ?, ?, 0, 'Open', '', 'Quarterly Rock', ?, ?, 'Attendees', ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, source_reason = excluded.source_reason, status = CASE WHEN meeting_agenda_items.status = 'Source Cleared' THEN 'Open' ELSE meeting_agenda_items.status END`).bind(String(beforeReferences.find(row => row.source_type === "Quarterly Rock" && row.source_id === rock.id)?.id || `rock:${input.occurrenceId}:${rock.id}`), input.occurrenceId, rockSection, String(rock.title), (sections.findIndex(s => s.key === rockSection) + 1) * 10000 + 5000, rock.id, `${rock.assignee_name} · ${rock.status} · Due ${rock.due_at}`, input.actor.name).run();
    await env.DB.prepare(`UPDATE meeting_agenda_items SET status = 'Source Cleared' WHERE occurrence_id = ? AND source_type = 'Quarterly Rock' AND status = 'Open' AND source_id IN (SELECT id FROM meeting_action_items WHERE status IN ('Complete','Cancelled With Reason'))`).bind(input.occurrenceId).run();
  }
  const afterReferences = (await env.DB.prepare(`SELECT id, source_type, source_id, title, status, source_reason FROM meeting_agenda_items WHERE occurrence_id = ? AND source_type IN ('Meeting Action','Quarterly Rock') ORDER BY id`).bind(input.occurrenceId).all<D1Row>()).results;
  if (JSON.stringify(beforeReferences) !== JSON.stringify(afterReferences)) {
    await env.DB.prepare(`UPDATE meeting_occurrences SET agenda_pdf_key = '' WHERE id = ?`).bind(input.occurrenceId).run();
    await auditMeeting({ actor: input.actor, seriesId: input.seriesId, occurrenceId: input.occurrenceId, entityType: "Agenda Commitments", entityId: input.occurrenceId, action: "Commitment References Refreshed", before: { references: beforeReferences, previousAgendaPdfKey: occurrence.agenda_pdf_key }, after: { references: afterReferences } });
  }
  return { ...refreshed, carriedItems: carry.results.length };
}

export async function closeMeetingWorkItem(actionId: string) {
  const { getDb } = await import("../db");
  const db = getDb();
  await db.update(commandWorkItems).set({ status: "Completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(commandWorkItems.sourceRecordId, actionId));
}
