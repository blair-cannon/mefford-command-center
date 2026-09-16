import { MEETING_SECTIONS, type MeetingType } from "./meetings";
import { canManageAgenda, agendaSettings, DEPARTMENT_METRICS, isDepartmentMeeting, isSelectableScorecard, scorecardKey, selectedAgendaSources, type AgendaSelection } from "./meeting-agenda-settings";
import type { MeetingActor } from "./meeting-server";

type Row = Record<string, string | number | null>;
type TopicPayload = { action: string; entityId?: string; title?: string; notes?: string; sectionKey?: string; timeboxMinutes?: number; status?: string; reason?: string; expectedVersion?: string };
export class MeetingAgendaError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}

async function commitAgenda(database: D1Database, context: Row, actor: MeetingActor, input: {
  entityType: string; id: string; action: string; before: unknown; after: unknown; reason?: string;
  guard: string; bindings: (string | number | null)[]; writes: D1PreparedStatement[];
}) {
  try {
    await database.batch([
      database.prepare(`INSERT INTO meeting_audits (series_id, occurrence_id, entity_type, entity_id, action, before_json, after_json, reason, actor_name, actor_email)
        VALUES (?, ?, ?, (SELECT ? WHERE (${input.guard}) AND EXISTS (SELECT 1 FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id
        WHERE o.id = ? AND o.status NOT IN ('Finalized/Distributed','Superseded') AND s.access_json = ?)), ?, ?, ?, ?, ?, ?)`)
        .bind(context.series_id, context.id, input.entityType, input.id, ...input.bindings, context.id, context.access_json || "{}", input.action,
          JSON.stringify(input.before), JSON.stringify(input.after), input.reason || "", actor.name, actor.email),
      ...input.writes,
      database.prepare(`UPDATE meeting_occurrences SET agenda_pdf_key = '', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), context.id),
    ]);
  } catch (error) {
    if (/NOT NULL constraint failed: meeting_audits.entity_id/.test(String(error))) throw new MeetingAgendaError("This Meeting Changed. Reload Before Saving; Your Edit Has Not Replaced The Newer Record.");
    throw error;
  }
}

export async function changeAgendaTopic(database: D1Database, actor: MeetingActor, context: Row, payload: TopicPayload, canEdit: boolean) {
  const manager = canManageAgenda(actor, context), department = isDepartmentMeeting(context.meeting_type);
  const sectionList = MEETING_SECTIONS[String(context.meeting_type) as MeetingType];
  if (payload.timeboxMinutes !== undefined && (!Number.isFinite(payload.timeboxMinutes) || payload.timeboxMinutes < 0 || payload.timeboxMinutes > 120)) throw new MeetingAgendaError("Use A Timebox From 0 To 120 Minutes", 400);
  if ((payload.title?.length || 0) > 500 || (payload.notes?.length || 0) > 20000) throw new MeetingAgendaError("Keep The Topic Under 500 Characters And Notes Under 20,000 Characters.", 400);
  const now = new Date().toISOString();
  const addendum = context.published_at ? Number((await database.prepare(`SELECT MAX(addendum_number) AS n FROM meeting_agenda_items WHERE occurrence_id = ?`).bind(context.id).first<{ n: number }>())?.n || 0) + 1 : 0;
  if (payload.action === "add_agenda") {
    if (!payload.title?.trim()) throw new MeetingAgendaError("Agenda Topic Is Required", 400);
    const index = sectionList.findIndex(section => section.key === (payload.sectionKey || "conclusion"));
    if (index < 0) throw new MeetingAgendaError("Choose A Valid Agenda Section", 400);
    const id = crypto.randomUUID(), status = department && !manager ? "Requested" : "Open";
    const metadata = JSON.stringify({ requestedByEmail: actor.email.toLowerCase(), requestedByName: actor.name, requestedAt: now });
    await commitAgenda(database, context, actor, { entityType: "Agenda Item", id, action: status === "Requested" ? "Topic Requested" : "Topic Added", before: null,
      after: { ...payload, status }, guard: "1 = 1", bindings: [], writes: [
        database.prepare(`INSERT INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_id, source_version, source_reason, visibility, addendum_number, published_at, created_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'User Submitted', ?, ?, ?, 'Attendees', ?, ?, ?, ?)`)
          .bind(id, context.id, sectionList[index].key, payload.title.trim(), (index + 1) * 10000 + 8000, payload.timeboxMinutes ?? 5, status, payload.notes || "", id, metadata, `Requested By ${actor.name}`, addendum, context.published_at ? now : null, actor.name, now),
      ] });
    return { saved: true, id, addendum };
  }
  const item = await database.prepare(`SELECT * FROM meeting_agenda_items WHERE id = ? AND occurrence_id = ?`).bind(payload.entityId || "", context.id).first<Row>();
  if (!item || item.status === "Superseded" || !["Attendees", "Removed"].includes(String(item.visibility))) throw new MeetingAgendaError("Agenda Item Not Found", 404);
  if (department && !payload.expectedVersion) throw new MeetingAgendaError("Reload This Topic Before Updating It.");
  if (payload.expectedVersion && payload.expectedVersion !== item.updated_at) throw new MeetingAgendaError("This Topic Changed. Your Unsaved Text Is Kept; Reload The Topic Before Replacing The Newer Discussion.");
  const before = { ...item, previousAgendaPdfKey: context.agenda_pdf_key };
  const guard = "EXISTS (SELECT 1 FROM meeting_agenda_items WHERE id = ? AND occurrence_id = ? AND updated_at = ? AND source_version = ?)";
  const bindings = [item.id, context.id, item.updated_at, item.source_version];
  if (["remove_agenda", "restore_agenda"].includes(payload.action)) {
    if (!manager) throw new MeetingAgendaError("Only A Company Owner Or Designated Agenda Manager Can Remove Or Restore Topics.", 403);
    if (!payload.reason?.trim()) throw new MeetingAgendaError("A Reason Is Required To Remove Or Restore A Topic.", 400);
    const remove = payload.action === "remove_agenda";
    const version: Record<string, unknown> = { ...agendaSettings(item.source_version), ...(remove ? { previousStatus: item.status, removedBy: actor.email, removedAt: now, removalReason: payload.reason.trim() } : { restoredBy: actor.email, restoredAt: now }) };
    const status = remove ? "Removed" : String(version.previousStatus || "Open");
    await commitAgenda(database, context, actor, { entityType: "Agenda Item", id: String(item.id), action: remove ? "Topic Removed" : "Topic Restored", before, after: { status }, reason: payload.reason.trim(), guard, bindings, writes: [
      database.prepare(`UPDATE meeting_agenda_items SET status = ?, visibility = ?, source_version = ?, addendum_number = ?, updated_at = ? WHERE id = ? AND occurrence_id = ?`)
        .bind(status, remove ? "Removed" : "Attendees", JSON.stringify(version), addendum, now, item.id, context.id),
    ] });
    return { saved: true };
  }
  const manual = item.source_type === "User Submitted";
  const requester = String(agendaSettings(item.source_version).requestedByEmail || "").toLowerCase() === actor.email.toLowerCase();
  if (item.status === "Removed" || (!canEdit && !manager && !(manual && requester))) throw new MeetingAgendaError("Only The Requester Or Meeting Editors Can Update This Topic.", 403);
  const status = payload.status || String(item.status);
  if (!["Requested", "Open", "Discussed", "Reviewed—Nothing to Report", "Deferred", "Complete", "Source Cleared"].includes(status)) throw new MeetingAgendaError("Unknown Agenda Status", 400);
  if (department && !manager && status !== item.status) throw new MeetingAgendaError("Only A Designated Agenda Manager Can Accept Or Close Topics.", 403);
  if (payload.title !== undefined && (!manual || !payload.title.trim())) throw new MeetingAgendaError("A Manual Topic Needs A Title. Automatic Titles Follow Their Source.", 400);
  const section = payload.sectionKey || String(item.section_key), index = sectionList.findIndex(s => s.key === section);
  if (index < 0 || (!manual && section !== item.section_key)) throw new MeetingAgendaError("Choose A Valid Manual Topic Section", 400);
  await commitAgenda(database, context, actor, { entityType: "Agenda Item", id: String(item.id), action: "Topic Updated", before, after: payload, guard, bindings, writes: [
    database.prepare(`UPDATE meeting_agenda_items SET title = ?, section_key = ?, position = ?, notes = ?, status = ?, timebox_minutes = ?, addendum_number = ?, updated_at = ? WHERE id = ? AND occurrence_id = ?`)
      .bind(payload.title?.trim() || item.title, section, section === item.section_key ? item.position : (index + 1) * 10000 + 8000, payload.notes ?? item.notes, status, payload.timeboxMinutes ?? item.timebox_minutes, addendum, now, item.id, context.id),
  ] });
  return { saved: true };
}

export async function saveAgendaSettings(database: D1Database, actor: MeetingActor, context: Row, payload: {
  selection?: AgendaSelection; managerEmails?: string[]; expectedAccess?: string; reason?: string;
}) {
  if (!isDepartmentMeeting(context.meeting_type) || !canManageAgenda(actor, context)) throw new MeetingAgendaError("Designated Agenda Manager Permission Required", 403);
  if (!["Draft Agenda", "Published Agenda"].includes(String(context.status))) throw new MeetingAgendaError("Source Settings Are Locked For A Meeting That Has Started. Set Up The Next Meeting To Change Its Sources.");
  if (payload.expectedAccess !== context.access_json) throw new MeetingAgendaError("Agenda Settings Changed. Reload Before Saving.");
  if (!payload.reason?.trim()) throw new MeetingAgendaError("Enter A Reason For The Agenda Settings Change.", 400);
  const type = String(context.meeting_type) as MeetingType, access = agendaSettings(context.access_json), oldSelection = selectedAgendaSources(type, context.access_json);
  const selection = payload.selection;
  if (!selection || ![selection.sections, selection.metrics, selection.scorecards].every(value => Array.isArray(value) && value.every(item => typeof item === "string") && value.length <= 100)) throw new MeetingAgendaError("Choose Valid Agenda Sources", 400);
  if (selection.sections.some(id => !MEETING_SECTIONS[type].some(section => section.key === id)) || selection.metrics.some(id => !DEPARTMENT_METRICS[type].some(metric => metric.id === id))) throw new MeetingAgendaError("A Selected Source Does Not Belong To This Department", 400);
  if (JSON.stringify([...selection.scorecards].sort()) !== JSON.stringify([...oldSelection.scorecards].sort())) {
    if (actor.accessLevel !== "Company Owner") throw new MeetingAgendaError("A Company Owner Selects Company Scorecards For Department Sharing.", 403);
    const rows = await database.prepare(`SELECT project_id, record_type, id FROM command_records WHERE project_id = 'MEFFORD-COMPANY' AND record_type IN ('Scorecard','Company Scorecard','Scorecard Metrics','Metrics')`).all<Row>();
    const keys = rows.results.map(row => ({ projectId: String(row.project_id), recordType: String(row.record_type), id: String(row.id) })).filter(isSelectableScorecard).map(scorecardKey);
    if (selection.scorecards.some(key => !keys.includes(key))) throw new MeetingAgendaError("One Of The Selected Scorecards Is No Longer Available.");
  }
  let emails = access.agendaManagerEmails || [];
  if (payload.managerEmails !== undefined) {
    if (actor.accessLevel !== "Company Owner") throw new MeetingAgendaError("Only A Company Owner Can Designate Agenda Managers.", 403);
    if (!Array.isArray(payload.managerEmails) || payload.managerEmails.some(email => typeof email !== "string")) throw new MeetingAgendaError("Select Agenda Managers From The Meeting Participants.", 400);
    const attendees = await database.prepare(`SELECT lower(a.email) AS email FROM meeting_attendees a JOIN company_members m ON lower(m.email) = lower(a.email) AND m.is_active = 1 WHERE a.occurrence_id = ?`).bind(context.id).all<Row>();
    emails = [...new Set(payload.managerEmails.map(email => email.toLowerCase()))];
    if (emails.some(email => !attendees.results.some(row => row.email === email))) throw new MeetingAgendaError("Agenda Managers Must Be Active Company Participants In This Meeting.", 400);
  }
  const after = { ...access, agendaSelection: selection, agendaManagerEmails: emails };
  await commitAgenda(database, context, actor, { entityType: "Agenda Settings", id: String(context.series_id), action: "Agenda Sources And Managers Updated", before: access, after, reason: payload.reason,
    guard: "EXISTS (SELECT 1 FROM meeting_series WHERE id = ? AND access_json = ?) AND EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status IN ('Draft Agenda','Published Agenda')) AND NOT EXISTS (SELECT 1 FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND expires_at > ?)", bindings: [context.series_id, context.access_json || "{}", context.id, context.id, new Date().toISOString()],
    writes: [database.prepare(`UPDATE meeting_series SET access_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(after), new Date().toISOString(), context.series_id)],
  });
  return { saved: true };
}

export async function carryManualAgendaTopics(database: D1Database, actor: MeetingActor, context: Row) {
  const previous = await database.prepare(`SELECT * FROM (
    SELECT g.*, o.meeting_number, ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(g.source_id, ''), g.id) ORDER BY o.scheduled_start DESC, g.created_at DESC) AS latest
    FROM meeting_agenda_items g JOIN meeting_occurrences o ON o.id = g.occurrence_id
    WHERE o.series_id = ? AND o.id <> ? AND datetime(o.scheduled_start) < datetime(?) AND g.source_type = 'User Submitted'
  ) WHERE latest = 1 AND status NOT IN ('Complete','Reviewed—Nothing to Report','Removed','Superseded')`)
    .bind(context.series_id, context.id, context.scheduled_start).all<Row>();
  for (const topic of previous.results) {
    const root = String(topic.source_id || topic.id), id = `topic:${context.id}:${root}`;
    if (await database.prepare(`SELECT id FROM meeting_agenda_items WHERE id = ? OR (occurrence_id = ? AND source_type = 'User Submitted' AND source_id = ?)`).bind(id, context.id, root).first()) continue;
    const now = new Date().toISOString();
    const version = JSON.stringify({ ...agendaSettings(topic.source_version), carriedFrom: topic.id, priorMeetingNumber: topic.meeting_number });
    await commitAgenda(database, context, actor, { entityType: "Agenda Item", id, action: "Unresolved Topic Carried Forward", before: { topicId: topic.id, meeting: topic.meeting_number }, after: { id, title: topic.title }, guard: "1 = 1", bindings: [], writes: [
      database.prepare(`INSERT INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_id, source_version, source_reason, visibility, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'User Submitted', ?, ?, ?, 'Attendees', ?, ?)`)
        .bind(id, context.id, topic.section_key, topic.title, topic.position, topic.timebox_minutes, topic.status, topic.notes, root, version, `Carried From ${topic.meeting_number} · Requested By ${agendaSettings(topic.source_version).requestedByName || topic.created_by}`, topic.created_by, now),
    ] });
  }
}
