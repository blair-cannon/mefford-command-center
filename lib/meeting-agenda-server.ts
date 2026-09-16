import { MEETING_SECTIONS, type MeetingType } from "./meetings";
import { buildMeetingAgenda, compactAgendaData, MEETING_SOURCE_TYPES, type AgendaRecord, type AgendaProject, type AgendaSignal } from "./meeting-agenda";
import type { MeetingActor } from "./meeting-server";
import { agendaSignalSelected, isDepartmentMeeting, selectedAgendaSources } from "./meeting-agenda-settings";
import { loadSalesContracts } from "./sales-contract-server";
import { withSalesContract } from "./sales-contract";

type Row = Record<string, string | number | null>;
export type MeetingSources = { records: AgendaRecord[]; projects: AgendaProject[]; loadedAt: string };

export async function loadMeetingSources(): Promise<MeetingSources> {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  const salesContracts = await loadSalesContracts(database);
  const projectRows = await database.prepare(`SELECT number, name, status, final_date, start_date, project_manager, superintendent, contract_amount, owner_contract_status FROM projects`).all<Row>();
  const projects = projectRows.results.map(p => ({ number: String(p.number), name: String(p.name), status: String(p.status), finalDate: String(p.final_date), startDate: String(p.start_date), projectManager: String(p.project_manager), superintendent: String(p.superintendent), contractAmount: salesContracts.get(String(p.number))?.contractValue.toFixed(2) || String(p.contract_amount), ownerContractStatus: String(p.owner_contract_status), contractAuthorized: salesContracts.get(String(p.number))?.signed === true }));
  const records: AgendaRecord[] = [];
  let cursor = 0;
  // Page the source rows so full quote/estimate payloads are not all resident at once.
  for (;;) {
    const page = await database.prepare(`SELECT rowid AS cursor, project_id, id, record_type, title, owner, due, status, updated_at, record_date, data_json FROM command_records WHERE rowid > ? AND record_type IN (${MEETING_SOURCE_TYPES.map(() => "?").join(",")}) AND status NOT IN ('Deletion Quarantine','Deleted') ORDER BY rowid LIMIT 150`).bind(cursor, ...MEETING_SOURCE_TYPES).all<Row>();
    for (const r of page.results) {
      const parsed: unknown = JSON.parse(String(r.data_json || "{}"));
      const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      records.push({ projectId: String(r.project_id), id: String(r.id), recordType: String(r.record_type), title: String(r.title), owner: String(r.owner), due: String(r.due), status: String(r.status), updatedAt: String(r.updated_at), recordDate: String(r.record_date || ""), data: compactAgendaData(r.record_type === "Sales Opportunities" ? withSalesContract(data, salesContracts) : data) });
    }
    if (page.results.length < 150) break;
    cursor = Number(page.results.at(-1)!.cursor);
  }
  const [close, collections, wip, actions] = await Promise.all([
    database.prepare(`SELECT * FROM accounting_close_tasks WHERE status NOT IN ('Complete','Completed','Closed')`).all<Row>(),
    database.prepare(`SELECT a.* FROM accounting_collection_actions a WHERE a.promise_date <> '' AND NOT EXISTS (SELECT 1 FROM accounting_collection_actions newer WHERE newer.project_id = a.project_id AND newer.billing_id = a.billing_id AND (newer.action_date > a.action_date OR (newer.action_date = a.action_date AND newer.created_at > a.created_at)))`).all<Row>(),
    database.prepare(`SELECT f.* FROM accounting_wip_forecasts f WHERE NOT EXISTS (SELECT 1 FROM accounting_wip_forecasts newer WHERE newer.project_id = f.project_id AND (newer.period_id > f.period_id OR (newer.period_id = f.period_id AND newer.updated_at > f.updated_at)))`).all<Row>(),
    database.prepare(`SELECT a.*, s.meeting_type FROM meeting_action_items a JOIN meeting_series s ON s.id = a.series_id WHERE a.status NOT IN ('Complete','Cancelled With Reason','Carried Forward') AND s.meeting_type IN ('Weekly L10','Quarterly Rock/Review','Sales/Estimating Department','Operations Department','Accounting Department','Sales To Estimating Turnover','Estimating To Operations Turnover')`).all<Row>(),
  ]);
  for (const r of wip.results) records.push({ projectId: String(r.project_id), id: String(r.id), recordType: "WIP Forecast", title: "WIP Forecast Review", owner: String(r.prepared_by), due: "", status: String(r.status), updatedAt: String(r.updated_at), data: { period: r.period_id, forecastProfitCents: r.forecast_profit_cents, riskReserveCents: r.risk_reserve_cents } });
  for (const r of actions.results) records.push({ projectId: String(r.project_id), id: String(r.id), recordType: "Escalated Meeting Action", title: String(r.title), owner: String(r.assignee_name), due: String(r.due_at), status: String(r.status), updatedAt: String(r.updated_at), data: { priority: r.priority, carryCount: r.carry_count, meetingType: r.meeting_type } });
  for (const r of close.results) records.push({ projectId: "MEFFORD-ACCOUNTING", id: String(r.id), recordType: "Accounting Close Task", title: String(r.description), owner: String(r.assigned_role), due: String(r.due_date), status: String(r.status), updatedAt: String(r.updated_at), data: { assignedRole: r.assigned_role } });
  for (const r of collections.results) records.push({ projectId: String(r.project_id), id: String(r.id), recordType: "Collection Promise", title: "Owner Payment Commitment", owner: String(r.created_by), due: String(r.promise_date), status: "Open", updatedAt: String(r.created_at), data: { projectId: r.project_id, billingId: r.billing_id, promiseDate: r.promise_date } });
  return { records, projects, loadedAt: new Date().toISOString() };
}

export function readAgendaSignal(row: Row): (AgendaSignal & { active: boolean }) | null {
  if (row.source_type !== "Automatic Agenda") return null;
  try { return JSON.parse(String(row.source_version)) as AgendaSignal & { active: boolean }; } catch { return null; }
}

export async function refreshMeetingAgenda(input: { type: MeetingType; projectId: string; occurrenceId: string; seriesId: string; actor: MeetingActor; sources?: MeetingSources }) {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  const occurrence = await database.prepare(`SELECT * FROM meeting_occurrences WHERE id = ? AND series_id = ?`).bind(input.occurrenceId, input.seriesId).first<Row>();
  if (!occurrence) throw new Error("Meeting Occurrence Not Found");
  const liveStatuses = isDepartmentMeeting(input.type) ? ["Draft Agenda", "Published Agenda", "Meeting In Progress"] : ["Draft Agenda", "Published Agenda"];
  const editableSql = liveStatuses.map(status => `'${status}'`).join(",");
  if (!liveStatuses.includes(String(occurrence.status))) return { refreshed: false, frozen: true };
  const sources = input.sources || await loadMeetingSources();
  const series = await database.prepare(`SELECT access_json FROM meeting_series WHERE id = ?`).bind(input.seriesId).first<Row>();
  const selection = isDepartmentMeeting(input.type) ? selectedAgendaSources(input.type, series?.access_json) : undefined;
  const signals = buildMeetingAgenda({ ...input, ...sources, selection });
  const existing = (await database.prepare(`SELECT * FROM meeting_agenda_items WHERE occurrence_id = ?`).bind(input.occurrenceId).all<Row>()).results;
  const bySource = new Map(existing.filter(r => r.source_type === "Automatic Agenda").map(r => [String(r.source_id), r]));
  const sections = MEETING_SECTIONS[input.type];
  const published = Boolean(occurrence.published_at);
  const addendum = published ? Math.max(0, ...existing.map(r => Number(r.addendum_number || 0))) + 1 : 0;
  const now = sources.loadedAt;
  const writes: D1PreparedStatement[] = [];
  const changes: Array<{ id: string; statementIndex: number; before: unknown; after: unknown }> = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (existing.some(row => row.source_type === "Standard Section" && row.section_key === section.key)) continue;
    writes.push(database.prepare(`INSERT OR IGNORE INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_reason, visibility, created_by, published_at) SELECT ?, ?, ?, ?, ?, ?, 'Open', '', 'Standard Section', ?, 'Attendees', ?, ? WHERE EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status IN (${editableSql}))`).bind(`standard:${input.occurrenceId}:${section.key}`, input.occurrenceId, section.key, section.title, (index + 1) * 10000, section.minutes, section.prompt || "Review this topic and record the discussion or confirm nothing to report.", input.actor.name, published ? now : null, input.occurrenceId));
  }
  const sectionOffsets = new Map<string, number>();
  for (const signal of signals) {
    const prior = bySource.get(signal.key);
    const removed = prior?.status === "Removed" ? JSON.parse(String(prior.source_version || "{}")) : null;
    const version = JSON.stringify({ ...signal, active: true, ...(removed ? { previousStatus: removed.previousStatus, removedBy: removed.removedBy, removedAt: removed.removedAt, removalReason: removed.removalReason } : {}) });
    const sectionIndex = sections.findIndex(s => s.key === signal.sectionKey);
    const offset = (sectionOffsets.get(signal.sectionKey) || 0) + 1;
    sectionOffsets.set(signal.sectionKey, offset);
    const position = (sectionIndex + 1) * 10000 + offset;
    if (prior?.source_version === version && Number(prior.position) === position) continue;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${input.occurrenceId}:${signal.key}`)));
    const id = prior ? String(prior.id) : `auto:${Array.from(digest).map(b => b.toString(16).padStart(2, "0")).join("")}`;
    writes.push(database.prepare(`INSERT INTO meeting_agenda_items (id, occurrence_id, section_key, title, position, timebox_minutes, status, notes, source_type, source_id, source_version, source_reason, ai_suggested, ai_confidence, visibility, addendum_number, published_at, created_by, updated_at) SELECT ?, ?, ?, ?, ?, 0, 'Open', '', 'Automatic Agenda', ?, ?, ?, 0, 'Source-Based Routing', 'Attendees', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status IN (${editableSql})) ON CONFLICT(id) DO UPDATE SET visibility = CASE WHEN meeting_agenda_items.visibility = 'Source Settings Excluded' THEN 'Attendees' ELSE meeting_agenda_items.visibility END, section_key = excluded.section_key, title = excluded.title, position = excluded.position, source_version = excluded.source_version, source_reason = excluded.source_reason, status = CASE WHEN meeting_agenda_items.status = 'Source Cleared' THEN 'Open' ELSE meeting_agenda_items.status END, addendum_number = excluded.addendum_number, updated_at = excluded.updated_at WHERE meeting_agenda_items.source_version <> excluded.source_version OR meeting_agenda_items.position <> excluded.position`).bind(id, input.occurrenceId, signal.sectionKey, signal.title, position, signal.key, version, signal.reason, addendum, published ? now : null, input.actor.name, now, input.occurrenceId));
    changes.push({ id, statementIndex: writes.length - 1, before: prior ? { sourceVersion: prior.source_version, title: prior.title } : null, after: { sourceVersion: version, title: signal.title } });
  }
  const current = new Set(signals.map(s => s.key));
  for (const prior of existing) {
    const old = readAgendaSignal(prior);
    if (old && !current.has(String(prior.source_id))) {
      const excluded = Boolean(selection && !agendaSignalSelected(old, selection));
      const version = JSON.stringify({ ...old, active: false, ...(excluded ? { excludedBySelection: true } : {}) });
      if (prior.source_version === version && (!excluded || prior.visibility === "Source Settings Excluded" || prior.visibility === "Removed")) continue;
      writes.push(database.prepare(`UPDATE meeting_agenda_items SET source_version = ?, visibility = CASE WHEN ? = 1 AND visibility <> 'Removed' THEN 'Source Settings Excluded' ELSE visibility END, status = CASE WHEN status = 'Open' THEN 'Source Cleared' ELSE status END, updated_at = ?, addendum_number = ? WHERE id = ? AND source_version = ? AND EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status IN (${editableSql}))`).bind(version, excluded ? 1 : 0, now, addendum, prior.id, prior.source_version, input.occurrenceId));
      changes.push({ id: String(prior.id), statementIndex: writes.length - 1, before: { sourceVersion: prior.source_version }, after: { sourceVersion: version } });
    }
    // Preserve the previous generic rule's evidence, but retire its indiscriminate
    // audience routing. Notes remain in the stored row and audit history.
    if (prior.source_id && prior.source_type !== "Automatic Agenda" && /Deterministic source rule/.test(String(prior.ai_confidence)) && prior.status !== "Superseded") {
      writes.push(database.prepare(`UPDATE meeting_agenda_items SET status = 'Superseded', visibility = 'Leader Until Promoted', updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status IN (${editableSql}))`).bind(now, prior.id, input.occurrenceId));
      changes.push({ id: String(prior.id), statementIndex: writes.length - 1, before: prior, after: { status: "Superseded", reason: "Replaced By Audience-Specific Source Routing" } });
    }
  }
  // Keep standard headings in their true section order when upgrading existing meetings.
  for (const row of existing.filter(r => r.source_type === "Standard Section")) {
    const index = sections.findIndex(s => s.key === row.section_key);
    if (index < 0 || Number(row.position) === (index + 1) * 10000) continue;
    writes.push(database.prepare(`UPDATE meeting_agenda_items SET position = ?, source_reason = ?, notes = CASE WHEN status = 'Open' AND notes = 'Reviewed—Nothing to Report' THEN '' ELSE notes END WHERE id = ?`).bind((index + 1) * 10000, sections[index].prompt || "Review this topic and record the discussion or confirm nothing to report.", row.id));
  }
  for (let offset = 0; offset < writes.length; offset += 38) {
    const chunkChanges = changes.filter(change => change.statementIndex >= offset && change.statementIndex < offset + 38);
    await database.batch([
      ...writes.slice(offset, offset + 38),
      database.prepare(`INSERT INTO meeting_audits (series_id, occurrence_id, entity_type, entity_id, action, before_json, after_json, reason, actor_name, actor_email) VALUES (?, ?, 'Automatic Agenda', ?, ?, ?, ?, 'Source changes and their history were saved in the same transaction. Discussion notes and dispositions were preserved.', ?, ?)`).bind(input.seriesId, input.occurrenceId, input.occurrenceId, published ? `Agenda Sources Refreshed · Addendum ${addendum}` : "Agenda Sources Refreshed", JSON.stringify({ changedSources: chunkChanges.map(c => ({ id: c.id, ...c.before as object })), previousAgendaPdfKey: offset === 0 ? occurrence.agenda_pdf_key : "" }), JSON.stringify({ activeSignals: signals.length, changes: chunkChanges.map(c => ({ id: c.id, ...c.after as object })), refreshedAt: now }), input.actor.name, input.actor.email),
      database.prepare(`UPDATE meeting_occurrences SET agenda_pdf_key = '', updated_at = ? WHERE id = ? AND status IN (${editableSql})`).bind(now, input.occurrenceId),
    ]);
  }
  return { refreshed: true, frozen: false, refreshedAt: now, standardSections: sections.length, platformSignals: signals.length, changedSignals: changes.length, critical: signals.filter(s => s.priority === "Critical").length };
}
