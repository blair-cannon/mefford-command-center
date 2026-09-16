"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MEETING_DEFAULTS, MEETING_SECTIONS, type MeetingType } from "../lib/meetings";

import { isDepartmentMeeting } from "../lib/meeting-agenda-settings";
import { MeetingAgendaSettings, type AgendaConfiguration } from "./meeting-agenda-settings";
import type { AgendaSignal } from "../lib/meeting-agenda";
import { isTurnover, type TurnoverView } from "../lib/turnovers";
import { TurnoverControls } from "./turnover-controls";
import { ProjectBonusControls } from "./project-bonus-controls";
import "./meetings-center.css";

type AgendaDraft = { notes: string; status: string; timebox: number; version: string };

type Row = Record<string, string | number | null>;

type Bundle = {
  turnover?: TurnoverView | null;
  bonusProjectId?: string;
  turnoverRecovery?: {pendingFailures:number;errors:string[]} | null;
  series: Row[];
  occurrences: Row[];
  selectedOccurrenceId: string;
  attendees: Row[];
  agenda: Row[];
  decisions: Row[];
  actions: Row[];
  attachments: Row[];
  audits: Row[];
  syncEvents: Row[];
  microsoft: { configured: boolean; mailbox: string; requiredSettings: string[] };
  actor: { name: string; email: string; accessLevel: string };
  policy: { aiBoundary: string; lifecycle: string[] };
  permissions: { canEdit: boolean; canCreate: boolean; canManageAgenda?: boolean; canConfigureManagers?: boolean };
  agendaConfiguration?: AgendaConfiguration | null;
  refresh?: { refreshedAt?: string; frozen?: boolean; error?: string };
  agendaPreview?: AgendaSignal[];
  setupDefaults?: { leaderName: string; leaderEmail: string; attendees: Array<{ name: string; email: string; attendeeRole: string }> } | null;
  error?: string;
};

type Project = {
  number: string;
  name: string;
  timeZone: string;
  projectManager: string;
  superintendent: string;
};

const EMPTY_BUNDLE: Bundle = {
  series: [], occurrences: [], selectedOccurrenceId: "", attendees: [], agenda: [], decisions: [], actions: [], attachments: [], audits: [], syncEvents: [],
  permissions: { canEdit: false, canCreate: false },
  microsoft: { configured: false, mailbox: "", requiredSettings: [] }, actor: { name: "", email: "", accessLevel: "" }, policy: { aiBoundary: "", lifecycle: [] },
};

const DEFAULT_ACTION_DUE_AT = dateInput(new Date(Date.now() + 7 * 86_400_000).toISOString());

function dateInput(value?: string | number | null) {
  const parsed = value ? new Date(String(value)) : new Date(Date.now() + 86_400_000);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function displayDate(value?: string | number | null) {
  if (!value) return "Not Scheduled";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function jsonObject(value: unknown) {
  try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; }
}

function statusTone(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (/final|complete|accepted|confirmed|sent|succeeded/.test(value)) return "complete";
  if (/blocked|overdue|failed|clarification|unconfirmed/.test(value)) return "risk";
  if (/progress|draft|proposed|pending|not responded/.test(value)) return "pending";
  return "active";
}

export function MeetingsCenter({ meetingType, project, actor }: { meetingType: MeetingType; project?: Project; actor: { name: string; email: string; accessLevel: string } }) {
  const projectId = project?.number || "MEFFORD-COMPANY";
  const defaults = MEETING_DEFAULTS[meetingType];
  const [data, setData] = useState<Bundle>(EMPTY_BUNDLE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedOccurrence, setSelectedOccurrence] = useState("");
  const [tab, setTab] = useState("Agenda");
  const [agendaDrafts, setAgendaDrafts] = useState<Record<string, AgendaDraft>>({});
  const minutesDirty = useRef(false);
  const [agendaFilter, setAgendaFilter] = useState("All Topics");
  const [agendaSearch, setAgendaSearch] = useState("");
  const savingRef = useRef(false);
  const loadSequence = useRef(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const [newOccurrenceOpen, setNewOccurrenceOpen] = useState(false);
  const [setup, setSetup] = useState({ title: `${meetingType}${project ? ` · ${project.name}` : ""}`, startAt: dateInput(), cadence: defaults.cadence, durationMinutes: defaults.durationMinutes, timeZone: project?.timeZone || "America/New_York", meetingMode: "Teams Remote", location: "Microsoft Teams", leaderName: meetingType === "Project Subcontractor" ? project?.superintendent || actor.name : project?.projectManager || actor.name, leaderEmail: actor.email, attendees: "", syncMicrosoft: false, useSuggestedAttendees: true });
  const [topicOpen, setTopicOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Row | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topic, setTopic] = useState({ title: "", sectionKey: MEETING_SECTIONS[meetingType][0].key, notes: "", timeboxMinutes: 5 });
  const [newAction, setNewAction] = useState({ title: "", definitionOfDone: "", assigneeName: "", assigneeEmail: "", dueAt: DEFAULT_ACTION_DUE_AT, priority: "Normal", itemKind: "To-Do" });
  const [decision, setDecision] = useState({ statement: "", decisionMakerName: "", decisionMakerEmail: "" });
  const [attendee, setAttendee] = useState({ name: "", email: "", requirement: "Required", external: false, role: "Participant" });
  const [recordingReason, setRecordingReason] = useState("");
  const [minutesSummary, setMinutesSummary] = useState("");

  const load = useCallback(async (occurrenceId = selectedOccurrence) => {
    const sequence = ++loadSequence.current;
    const query = new URLSearchParams({ projectId, meetingType });
    if (occurrenceId) query.set("occurrenceId", occurrenceId);
    const response = await fetch(`/api/meetings?${query}`);
    const result = await response.json() as Bundle;
    if (!response.ok) throw new Error(result.error || "Meetings Are Unavailable");
    if (sequence !== loadSequence.current) return;
    setData(result);
    const next = occurrenceId || result.selectedOccurrenceId;
    setSelectedOccurrence(next);
    const selected = result.occurrences.find((item) => String(item.id) === next);
    if (!minutesDirty.current || occurrenceId !== selectedOccurrence) { minutesDirty.current = false; setMinutesSummary(String(selected?.minutes_summary || "")); }
  }, [meetingType, projectId, selectedOccurrence]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setLoading(true); });
    fetch(`/api/meetings?${new URLSearchParams({ projectId, meetingType })}`)
      .then(async (response) => {
        const result = await response.json() as Bundle;
        if (!response.ok) throw new Error(result.error || "Meetings Are Unavailable");
        return result;
      })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if (result.setupDefaults) setSetup(current => ({ ...current, leaderName: result.setupDefaults!.leaderName, leaderEmail: result.setupDefaults!.leaderEmail }));
        setSelectedOccurrence(result.selectedOccurrenceId);
        const selected = result.occurrences.find((item) => String(item.id) === result.selectedOccurrenceId);
        setMinutesSummary(String(selected?.minutes_summary || ""));
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Meetings Are Unavailable"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [meetingType, projectId]);

  useEffect(() => {
    if (!selectedOccurrence) return;
    const refresh = () => { if (document.visibilityState === "visible" && !savingRef.current) void load().catch(error => setNotice(error.message)); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load, selectedOccurrence]);

  const visibleAttendees = useMemo(() => {
    if (!isTurnover(meetingType)) return data.attendees;
    const people = new Map<string, Row>();
    for (const person of data.attendees) {
      const email = String(person.email).toLowerCase(), prior = people.get(email);
      people.set(email, prior ? { ...prior, attendee_role:[...new Set(`${prior.attendee_role}; ${person.attendee_role}`.split("; "))].join("; ") } : person);
    }
    return [...people.values()];
  }, [data.attendees,meetingType]);

  const selected = useMemo(() => data.occurrences.find((item) => String(item.id) === selectedOccurrence), [data.occurrences, selectedOccurrence]);
  const series = useMemo(() => data.series.find((item) => String(item.id) === String(selected?.series_id || "")) || data.series[0], [data.series, selected]);
  const financial = useMemo(() => jsonObject(selected?.financial_snapshot_json), [selected]);
  const canLead = data.permissions.canEdit;
  const canCreate = data.permissions.canCreate;
  const canManage = Boolean(data.permissions.canManageAgenda);
  const department = isDepartmentMeeting(meetingType);
  const canEditTopic = (item: Row) => canLead || canManage || (item.source_type === "User Submitted" && String(jsonObject(item.source_version).requestedByEmail || "").toLowerCase() === actor.email.toLowerCase());
  const signals = data.agenda.filter(item => item.visibility === "Attendees").map(readSignal).filter((signal): signal is AgendaSignal & { active: boolean } => Boolean(signal && signal.active));
  const metrics = signals.filter(signal => signal.metric);
  const sourceIssues = signals.filter(signal => !signal.metric);
  const isFinal = String(selected?.status) === "Finalized/Distributed";

  async function act(action: string, payload: Record<string, unknown> = {}) {
    if (savingRef.current) return false;
    if (["publish", "start", "finish", "finalize", "create_series", "create_occurrence", "turnover_accept"].includes(action) && Object.keys(agendaDrafts).length && !await saveDiscussions()) return false;
    savingRef.current = true;
    setSaving(action);
    setNotice("");
    try {
      const response = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, occurrenceId: selectedOccurrence || undefined, ...payload }) });
      const result = await response.json() as { error?: string; occurrenceId?: string; distribution?: { status: string; detail: string }; microsoft?: { status: string; detail: string } };
      if (!response.ok) throw new Error(result.error || "The Meeting Could Not Be Updated");
      await load(result.occurrenceId || selectedOccurrence);
      setNotice(result.distribution ? `Minutes Finalized · ${result.distribution.detail}` : result.microsoft ? `Meeting Series Created · Microsoft: ${result.microsoft.detail}` : "Meeting Record Updated Permanently.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Meeting Could Not Be Updated");
      return false;
    } finally { savingRef.current = false; setSaving(""); }
  }

  function agendaMatches(item: Row) {
    if (agendaFilter === "Removed Topics") return item.status === "Removed";
    if (item.status === "Removed") return false;
    if (agendaFilter === "Manual Topics" && item.source_type !== "User Submitted") return false;
    if (agendaFilter === "Topic Requests" && item.status !== "Requested") return false;
    const signal = readSignal(item);
    const search = agendaSearch.trim().toLowerCase();
    if (search && !`${item.title} ${item.source_reason} ${item.notes}`.toLowerCase().includes(search)) return false;
    if (agendaFilter === "Critical / High") return Boolean(signal && ["Critical", "High"].includes(signal.priority) && signal.active);
    if (agendaFilter === "Needs Discussion") return ["Requested", "Open", "Deferred"].includes(String(item.status));
    if (agendaFilter === "Source Cleared") return signal?.active === false || item.status === "Source Cleared";
    return true;
  }

  function assignSource(item: Row) {
    const signal = readSignal(item);
    setNewAction(current => ({ ...current, title: String(item.title), definitionOfDone: signal?.nextStep || String(item.source_reason || ""), priority: signal?.priority === "Critical" ? "Critical" : signal?.priority === "High" ? "High" : "Normal", dueAt: signal?.dueAt ? `${signal.dueAt}T16:00` : dateInput(new Date(Date.now() + 7 * 86_400_000).toISOString()) }));
    setTab("Decisions & Actions");
  }

  async function changeOccurrence(id: string) {
    if (!await saveDiscussions()) return;
    setAgendaDrafts({});
    await load(id);
  }

  function openTopic(item?: Row) {
    setEditingTopic(item || null);
    setTopic(item ? { title: String(item.title), sectionKey: String(item.section_key), notes: agendaDrafts[String(item.id)]?.notes ?? String(item.notes || ""), timeboxMinutes: agendaDrafts[String(item.id)]?.timebox ?? Number(item.timebox_minutes) }
      : { title: "", sectionKey: MEETING_SECTIONS[meetingType][0].key, notes: "", timeboxMinutes: 5 });
    setTopicOpen(true);
  }

  async function saveTopic() {
    const saved = await act(editingTopic ? "update_agenda" : "add_agenda", { ...topic, ...(editingTopic ? { entityId: editingTopic.id, expectedVersion: agendaDrafts[String(editingTopic.id)]?.version || String(editingTopic.updated_at) } : {}) });
    if (saved) {
      if (editingTopic) setAgendaDrafts(current => { const next = { ...current }; delete next[String(editingTopic.id)]; return next; });
      setTopicOpen(false); setAgendaFilter("Manual Topics"); setAgendaSearch(""); setTab("Agenda");
    }
  }

  async function removeTopic(item: Row) {
    if (agendaDrafts[String(item.id)]) { setNotice("Save Or Reload This Topic's Discussion Changes Before Removing It."); return; }
    const reason = window.prompt(item.status === "Removed" ? "Reason For Restoring This Topic:" : "Reason For Removing This Topic (Its History Will Be Kept):");
    if (reason?.trim()) await act(item.status === "Removed" ? "restore_agenda" : "remove_agenda", { entityId: item.id, expectedVersion: item.updated_at, reason });
  }

  async function saveDiscussions() {
    for (const [entityId, draft] of Object.entries(agendaDrafts)) {
      if (!await act("update_agenda", { entityId, notes: draft.notes, status: draft.status, timeboxMinutes: draft.timebox, expectedVersion: draft.version })) return false;
      setAgendaDrafts(current => { const next = { ...current }; delete next[entityId]; return next; });
    }
    return true;
  }

  async function printAgenda() {
    const page = window.open("about:blank", "_blank");
    if (!page) { setNotice("Allow A New Tab To Open The Printable Agenda."); return; }
    page.opener = null;
    if (!await saveDiscussions()) { page.close(); return; }
    page.location.href = `/api/meetings/document?${new URLSearchParams({ occurrenceId: selectedOccurrence, kind: "agenda" })}`;
  }

  async function createSeries() {
    const attendees = setup.attendees.split(/\n|,/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/);
      const email = match?.[2] || (entry.includes("@") ? entry : "");
      return { name: match?.[1]?.trim() || email.split("@")[0] || entry, email, attendanceRequirement: "Required" };
    }).filter((item) => item.email);
    const ok = await act("create_series", { ...setup, projectId, meetingType, attendees });
    if (ok) setSetupOpen(false);
  }

  async function uploadFile(file: File, includeWithMinutes: boolean) {
    setSaving("file");
    try {
      const form = new FormData();
      form.set("occurrenceId", selectedOccurrence);
      form.set("file", file);
      form.set("includeWithMinutes", String(includeWithMinutes));
      const response = await fetch("/api/meetings/files", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Meeting File Upload Failed");
      await load();
      setNotice(`${file.name} Uploaded And Version-Locked To This Meeting.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Meeting File Upload Failed"); }
    finally { setSaving(""); }
  }

  if (loading) return <div className="meetings-loading">Loading Controlled Meeting Records…</div>;

  return <div className="meetings-center">
    <section className="meetings-hero">
      <div><h1>{meetingType}</h1>{project ? <p>{project.name} · {project.number}</p> : null}</div>
      <div className="meetings-hero-actions">{canCreate && !isTurnover(meetingType) ? <button className="primary-action large" disabled={Boolean(saving)} onClick={() => setSetupOpen(true)}>＋ Schedule Meeting</button> : null}{!isTurnover(meetingType) ? <span className="meeting-connection-label">{data.microsoft.configured ? "Outlook / Teams Connected" : "Outlook / Teams Not Connected"}</span> : null}</div>
    </section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    {data.turnoverRecovery?.pendingFailures ? <div className="meeting-refresh-error" role="alert">{data.turnoverRecovery.pendingFailures} turnover source(s) need recovery. {data.turnoverRecovery.errors.join("; ")}<button className="secondary-action" disabled={Boolean(saving)} onClick={() => void load().catch(error => setNotice(error.message))}>Check Recovery</button></div> : null}
    {data.refresh?.error ? <div className="meeting-refresh-error" role="alert"><strong>Agenda Sources Could Not Be Refreshed</strong><span>{data.refresh.error}</span><span>The saved agenda remains available. Retry before relying on it for current issues.</span><button className="secondary-action" disabled={Boolean(saving)} onClick={() => void load().catch(error => setNotice(String(error.message)))}>Retry</button></div> : null}

    {!data.series.length ? <section className="meeting-empty"><h2>{isTurnover(meetingType) ? "No Turnovers Pending" : "No Meetings Scheduled"}</h2>{canCreate && !isTurnover(meetingType) ? <button className="primary-action" onClick={() => setSetupOpen(true)}>Create First Meeting</button> : !isTurnover(meetingType) ? <p>Ask the meeting leader to add you as a participant.</p> : null}</section> : <>
      <section className="meeting-control-row">
        <label>Series<select value={String(series?.id || "")} onChange={(event) => { const occurrence = data.occurrences.find((item) => String(item.series_id) === event.target.value); if (occurrence) void changeOccurrence(String(occurrence.id)).catch(error => setNotice(error.message)); }}>
          {data.series.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.title} · {item.status}</option>)}
        </select></label>
        <label>Occurrence<select value={selectedOccurrence} onChange={(event) => void changeOccurrence(event.target.value).catch(error => setNotice(error.message))}>{data.occurrences.filter((item) => String(item.series_id) === String(series?.id)).map((item) => <option key={String(item.id)} value={String(item.id)}>{item.meeting_number} · {displayDate(item.scheduled_start)} · {item.status}</option>)}</select></label>
        {canLead && !isTurnover(meetingType) && String(series?.status) === "Active" ? <button className="secondary-action" onClick={() => setNewOccurrenceOpen(true)}>＋ Next Meeting</button> : null}
      </section>
      {String(series?.status) === "Not Required" ? <section className="meeting-not-required"><strong>Not Required · Owner-Controlled Decision</strong><span>{series.not_required_reason}</span><small>{series.not_required_by} · {displayDate(series.not_required_at)} · Permanent audit retained</small></section> : selected ? <>
        <section className="meeting-status-card">
          <div><span className={`meeting-status ${statusTone(selected.status)}`}>{selected.status}</span><h2>{selected.meeting_number}</h2><p>{displayDate(selected.scheduled_start)} · {series.meeting_mode} · {series.location}</p></div>
          <div className="meeting-lifecycle-actions">
            {series.teams_join_url ? <a className="teams-link" href={String(series.teams_join_url)} target="_blank" rel="noreferrer">Join In Teams</a> : !isTurnover(meetingType) ? <span className="teams-link disabled">Teams Link Pending Connection</span> : null}
            {selected.status === "Draft Agenda" && canLead ? <button className="primary-action" disabled={Boolean(saving)} onClick={() => void act("publish")}>Publish Agenda</button> : null}
            {selected.status === "Draft Agenda" && canLead ? <button className="secondary-action" disabled={Boolean(saving)} onClick={() => { if (Number(selected.publication_hold)) void act("publication_hold", { value: false }); else { const reason = window.prompt("Reason to hold the pre-approved auto-publication deadline:"); if (reason) void act("publication_hold", { value: true, reason }); } }}>{Number(selected.publication_hold) ? "Release Publication Hold" : "Hold Auto-Publish"}</button> : null}
            {selected.status === "Published Agenda" && canLead ? <button className="primary-action" disabled={Boolean(saving)} onClick={() => void act("start")}>Start Meeting</button> : null}
            {selected.status === "Meeting In Progress" && canLead ? <button className="primary-action" disabled={Boolean(saving)} onClick={() => void act("finish", { minutesSummary })}>Generate Draft Minutes</button> : null}
            {selected.status === "Draft Minutes" && canLead ? <button className="primary-action" disabled={Boolean(saving)} onClick={() => void act("finalize", { minutesSummary })}>Finalize And Distribute</button> : null}
            <button className="secondary-action" disabled={Boolean(saving)} onClick={() => void printAgenda()}>Print Agenda / PDF</button>
            {selected.status === "Draft Minutes" || isFinal ? <a className="secondary-action" href={`/api/meetings/document?occurrenceId=${encodeURIComponent(selectedOccurrence)}&kind=minutes`} target="_blank">Minutes PDF</a> : null}
          </div>
        </section>
        {data.turnover ? <TurnoverControls turnover={data.turnover} canLead={canLead} owner={actor.accessLevel === "Company Owner"} saving={Boolean(saving) || Boolean(data.refresh?.error)} started={Boolean(selected.started_at)} onAction={act} /> : null}
        {data.bonusProjectId ? <ProjectBonusControls projectId={data.bonusProjectId} key={`${data.bonusProjectId}:${selected.status}`} onSaved={() => { void load(); }} /> : null}
        {meetingType === "Project Owner" ? <section className="owner-contract-snapshot"><header><div><h2>Owner Contract Value</h2></div>{financial.reconciliationWarning ? <span className="reconciliation-alert">RECONCILIATION REQUIRED</span> : <span className="snapshot-lock">Snapshot Locked</span>}</header><div className="snapshot-grid"><article><span>ORIGINAL EXECUTED</span><strong>{money(financial.originalExecutedContract)}</strong></article><article><span>APPROVED CHANGES</span><strong>{money(financial.approvedChanges)}</strong></article><article className="current"><span>CURRENT OWNER CONTRACT</span><strong>{money(financial.currentOwnerContract)}</strong></article><article><span>CHANGE SINCE {String(financial.priorMeetingNumber || "PRIOR MEETING")}</span><strong>{money(financial.changeSincePreviousMeeting)}</strong></article><article><span>PENDING EXPOSURE</span><strong>{money(financial.pendingChangeExposure)}</strong></article><article><span>BILLED TO DATE</span><strong>{money(financial.billedToDate)}</strong></article></div><p>{String(financial.formula || "Contract formula awaiting source record.")} · Captured {displayDate(String(financial.capturedAt || selected.created_at))}</p></section> : null}
        <nav className="meeting-tabs">{["Agenda", "Live Meeting", "People", "Decisions & Actions", "Files", "Minutes & Audit"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
        {tab === "Agenda" ? <section className="meeting-panel meeting-agenda-workspace"><header><div><h2>Agenda</h2><p>{data.refresh?.frozen ? (department ? "Meeting Source Snapshot Saved" : "Source Snapshot Locked At Meeting Start") : data.refresh?.refreshedAt ? `Sources Refreshed ${displayDate(data.refresh.refreshedAt)}` : "Saved Meeting Sources"}</p></div><div className="agenda-refresh-actions"><span>{sourceIssues.length} Source Issues · {sourceIssues.filter(item => item.priority === "Critical").length} Critical</span>{(canLead || canManage) && ["Draft Agenda", "Published Agenda", ...(department ? ["Meeting In Progress"] : [])].includes(String(selected.status)) ? <button className="secondary-action" disabled={Boolean(saving)} onClick={() => void act("refresh_agenda")}>{saving === "refresh_agenda" ? "Refreshing…" : "Refresh Sources"}</button> : null}</div></header>
          <div className="agenda-work-actions">{!isFinal ? <button className="primary-action" disabled={Boolean(saving)} onClick={() => openTopic()}>＋ Request Topic</button> : null}{Object.keys(agendaDrafts).length ? <button className="secondary-action" disabled={Boolean(saving)} onClick={() => void saveDiscussions()}>Save Discussion Changes ({Object.keys(agendaDrafts).length})</button> : null}{data.agendaConfiguration && canManage && ["Draft Agenda", "Published Agenda"].includes(String(selected.status)) ? <button className="secondary-action" disabled={Boolean(saving)} onClick={() => setSettingsOpen(true)}>Agenda Sources And Managers</button> : null}</div>
          {metrics.length ? <div className="meeting-scorecard">{metrics.map(signal => <a key={signal.key} href={sourceLink(signal)} target="_blank" rel="noreferrer"><span>{signal.title}</span><strong>{signal.metric!.unit === "currency" ? money(signal.metric!.value) : signal.metric!.value}</strong><small>Open Supporting Workspace ↗</small></a>)}</div> : null}
          <div className="agenda-filter-row"><label>Find A Topic<input type="search" value={agendaSearch} onChange={event => setAgendaSearch(event.target.value)} placeholder="Project, issue, or source" /></label><label>Show<select value={agendaFilter} onChange={event => setAgendaFilter(event.target.value)}>{["All Topics", "Manual Topics", "Topic Requests", "Needs Discussion", "Critical / High", "Source Cleared", ...(canManage ? ["Removed Topics"] : [])].map(value => <option key={value}>{value}</option>)}</select></label><span>{data.agenda.filter(agendaMatches).length} Matching Items</span></div>
          <div className="meeting-agenda-sections">{MEETING_SECTIONS[meetingType].map((section, index) => {
            const items = data.agenda.filter(item => item.section_key === section.key);
            const show = items.some(agendaMatches);
            return <section className="meeting-agenda-section" key={section.key} hidden={!show}><header><span className="meeting-section-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{section.title}</h3></div><b>{section.minutes} min</b></header><div className="agenda-list">{items.map(item => <AgendaRow key={String(item.id)} item={item} draft={agendaDrafts[String(item.id)]} onDraft={draft => setAgendaDrafts(current => ({ ...current, [String(item.id)]: draft }))} hidden={!agendaMatches(item)} locked={isFinal || !canEditTopic(item) || item.status === "Removed"} canDispose={!department ? canLead : canManage} canRemove={!isFinal && canManage} onReload={() => { if (window.confirm("Discard Your Unsaved Edit And Reload This Topic?")) { setAgendaDrafts(current => { const next = { ...current }; delete next[String(item.id)]; return next; }); void load().catch(error => setNotice(error.message)); } }} onRemove={() => void removeTopic(item)} onEdit={item.source_type === "User Submitted" && canEditTopic(item) && !isFinal && item.status !== "Removed" ? () => openTopic(item) : undefined} saving={saving} onAssign={() => assignSource(item)} onSave={async (notes, status, timeboxMinutes) => { const saved = await act("update_agenda", { entityId: item.id, notes, status, timeboxMinutes, expectedVersion: agendaDrafts[String(item.id)]?.version || String(item.updated_at) }); if (saved) setAgendaDrafts(current => { const next = { ...current }; delete next[String(item.id)]; return next; }); return saved; }} />)}</div></section>;
          })}</div>
          {!data.agenda.some(agendaMatches) ? <p className="meeting-no-match">No Agenda Items Match These Filters.</p> : null}

        </section> : null}
        {tab === "Live Meeting" ? <section className="meeting-panel live-meeting-panel"><header><div><h2>Run The Meeting</h2></div><span className={`recording-state ${Number(selected.recording_enabled) ? "on" : "off"}`}>● Recording {Number(selected.recording_enabled) ? "On" : "Off By Override"}</span></header><div className="live-meeting-grid"><div><h3>Current Agenda</h3>{data.agenda.filter(item => item.visibility === "Attendees").map((item) => <article key={String(item.id)}><span>{item.position}</span><div><strong>{item.title}</strong><small>{item.timebox_minutes} min · {item.status}</small></div></article>)}</div><aside><h3>Attendance Confirmation</h3><button className="primary-action" onClick={() => void act("attendance", { attendanceStatus: "Present", attendanceSource: "Command Center Live Check-In" })}>I Am Present</button><button className="secondary-action" onClick={() => void act("attendance", { attendanceStatus: "Ended", attendanceSource: "Command Center End Prompt", rating: 10 })}>Confirm End · Rate 10</button>{canLead && data.microsoft.configured ? <button className="secondary-action" onClick={() => void act("sync_teams_evidence")}>Import Teams Attendance + Transcript</button> : null}<small>{selected.transcript_status}</small>{canLead ? <div className="recording-override"><label>Override reason<textarea value={recordingReason} onChange={(event) => setRecordingReason(event.target.value)} /></label><button className="danger-action" onClick={() => void act("recording_override", { value: !Number(selected.recording_enabled), reason: recordingReason })}>{Number(selected.recording_enabled) ? "Disable Recording" : "Re-enable Recording"}</button></div> : null}</aside></div></section> : null}
        {tab === "People" ? <section className="meeting-panel"><header><div><h2>Attendees</h2></div></header><div className="attendee-table" data-reflow-table=""><div className="meeting-table-head" data-reflow-head="medium"><span>Person</span><span>Requirement</span><span>Calendar</span><span>Attendance</span><span>Source</span></div>{visibleAttendees.map((item) => <div key={String(item.id)} data-reflow-row="medium"><span data-label="Person"><strong>{item.name}</strong><small>{item.email} · {item.attendee_role}{Number(item.external) ? " · Restricted Guest" : ""}</small></span><span data-label="Requirement">{item.attendance_requirement}</span><span className={`mini-status ${statusTone(item.calendar_response)}`} data-label="Calendar">{item.calendar_response}</span><span className={`mini-status ${statusTone(item.attendance_status)}`} data-label="Attendance">{item.attendance_status}</span><span data-label="Source">{item.attendance_source || "Awaiting check-in"}</span></div>)}</div>{canLead && !isFinal ? <div className="meeting-inline-form attendee-form"><input placeholder="Name" value={attendee.name} onChange={(event) => setAttendee({ ...attendee, name: event.target.value })} /><input type="email" placeholder="Email" value={attendee.email} onChange={(event) => setAttendee({ ...attendee, email: event.target.value })} /><select value={attendee.requirement} onChange={(event) => setAttendee({ ...attendee, requirement: event.target.value })}><option>Required</option><option>Optional</option></select>{isTurnover(meetingType) ? <select aria-label="Turnover role" value={attendee.role} onChange={event => setAttendee({ ...attendee, role:event.target.value })}>{["Participant","Chief Estimator","Director of Operations","Project Accountant"].map(role => <option key={role}>{role}</option>)}</select> : <label className="compact-check"><input type="checkbox" checked={attendee.external} onChange={(event) => setAttendee({ ...attendee, external: event.target.checked })} />Restricted Guest</label>}<button className="primary-action" onClick={async () => { if (await act("add_attendee", { assigneeName: attendee.name, assigneeEmail: attendee.email, status: attendee.requirement, value: attendee.role, reason: attendee.external ? "external" : "internal" })) setAttendee({ name: "", email: "", requirement: "Required", external: false, role: "Participant" }); }}>Add Attendee</button></div> : null}</section> : null}
        {tab === "Decisions & Actions" ? <section className="meeting-panel decision-action-panel"><div className="meeting-split"><div><header><h2>Decision Log</h2></header>{data.decisions.map((item) => <article className="decision-card" key={String(item.id)}><span className={`mini-status ${statusTone(item.status)}`}>{item.status}</span><strong>{item.statement}</strong><small>{item.id} · Decision-maker: {item.decision_maker_name}</small>{String(item.status) === "Proposed" && (String(item.decision_maker_email).toLowerCase() === actor.email.toLowerCase() || actor.accessLevel === "Company Owner") ? <button className="primary-action" onClick={() => void act("confirm_decision", { entityId: item.id })}>Confirm Decision</button> : null}</article>)}{!isFinal ? <div className="stacked-form"><input placeholder="Decision statement" value={decision.statement} onChange={(event) => setDecision({ ...decision, statement: event.target.value })} /><input placeholder="Decision-maker name" value={decision.decisionMakerName} onChange={(event) => setDecision({ ...decision, decisionMakerName: event.target.value })} /><input type="email" placeholder="Decision-maker email" value={decision.decisionMakerEmail} onChange={(event) => setDecision({ ...decision, decisionMakerEmail: event.target.value })} /><button className="primary-action" onClick={async () => { if (await act("add_decision", decision)) setDecision({ statement: "", decisionMakerName: "", decisionMakerEmail: "" }); }}>Propose Decision</button></div> : null}</div><div><header><h2>Actions, To-Dos + Rocks</h2></header>{data.actions.map((item) => <ActionCard key={String(item.id)} item={item} actorEmail={actor.email} canLead={canLead} onStatus={(status, reason) => act("action_status", { entityId: item.id, status, reason })} />)}{!isFinal ? <div className="stacked-form"><input placeholder="Action title" value={newAction.title} onChange={(event) => setNewAction({ ...newAction, title: event.target.value })} /><textarea placeholder="Definition of done" value={newAction.definitionOfDone} onChange={(event) => setNewAction({ ...newAction, definitionOfDone: event.target.value })} /><div className="field-grid"><input placeholder="Assignee name" value={newAction.assigneeName} onChange={(event) => setNewAction({ ...newAction, assigneeName: event.target.value })} /><input type="email" placeholder="Assignee email" value={newAction.assigneeEmail} onChange={(event) => setNewAction({ ...newAction, assigneeEmail: event.target.value })} /><input type="datetime-local" value={newAction.dueAt} onChange={(event) => setNewAction({ ...newAction, dueAt: event.target.value })} /><select value={newAction.itemKind} onChange={(event) => setNewAction({ ...newAction, itemKind: event.target.value })}><option>To-Do</option><option>Rock</option></select><select value={newAction.priority} onChange={(event) => setNewAction({ ...newAction, priority: event.target.value })}><option>Normal</option><option>High</option><option>Critical</option></select></div><button className="primary-action" onClick={async () => { if (await act("add_action", newAction)) setNewAction({ ...newAction, title: "", definitionOfDone: "", assigneeName: "", assigneeEmail: "" }); }}>Assign To My Work</button></div> : null}</div></div></section> : null}
        {tab === "Files" ? <section className="meeting-panel"><header><div><h2>Meeting Packet And Files</h2></div><label className="meeting-upload primary-action">Upload File<input type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file, true); event.currentTarget.value = ""; }} /></label></header><div className="meeting-files">{data.attachments.map((item) => <article key={String(item.id)}><div><strong>{item.name}</strong><small>{item.source_type} · {item.source_version} · {Math.ceil(Number(item.size_bytes || 0) / 1024)} KB</small></div><span>{Number(item.include_with_minutes) ? "Include With Minutes" : "Secure Link Only"}</span><a href={`/api/meetings/files?id=${encodeURIComponent(String(item.id))}`} target="_blank">Open</a></article>)}{!data.attachments.length ? <div className="empty-attention-state"><strong>No Meeting Files Yet</strong></div> : null}</div></section> : null}
        {tab === "Minutes & Audit" ? <section className="meeting-panel minutes-audit-panel"><div className="meeting-split"><div><header><h2>Minutes</h2></header><textarea className="minutes-editor" value={minutesSummary} readOnly={isFinal || !canLead} onChange={(event) => { minutesDirty.current = true; setMinutesSummary(event.target.value); }} placeholder="Draft minutes are generated from the controlled agenda, decisions, and action items when the meeting ends." />{selected.status === "Draft Minutes" && canLead ? <button className="primary-action" disabled={Boolean(saving)} onClick={async () => { if (await act("save_minutes", { minutesSummary })) minutesDirty.current = false; }}>Save Draft Minutes</button> : null}{isFinal && canLead ? <button className="secondary-action" onClick={() => { const revised = window.prompt("Enter the full corrected minutes. The original remains permanent.", minutesSummary); if (!revised || revised === minutesSummary) return; const reason = window.prompt("Permanent change summary / reason for this numbered revision:"); if (reason) void act("revise_minutes", { minutesSummary: revised, reason }); }}>Create Numbered Revision</button> : null}</div><div><header><h2>Audit Trail</h2></header><div className="audit-timeline">{data.audits.map((item) => <article key={String(item.id)}><i /><div><strong>{item.action}</strong><span>{item.entity_type} · {item.entity_id}</span><small>{item.actor_name} · {displayDate(item.created_at)}{item.reason ? ` · ${item.reason}` : ""}</small></div></article>)}</div><header className="sync-heading"><p className="eyebrow orange-text">MICROSOFT SYNC LOG</p></header><div className="sync-list">{data.syncEvents.map((item) => <div key={String(item.id)}><span className={`mini-status ${statusTone(item.status)}`}>{item.status}</span><strong>{item.event_type}</strong><small>{item.detail}</small></div>)}</div></div></div></section> : null}
      </> : null}
    </>}

    {settingsOpen && data.agendaConfiguration ? <MeetingAgendaSettings configuration={data.agendaConfiguration} attendees={data.attendees} owner={Boolean(data.permissions.canConfigureManagers)} leaderEmail={String(series?.leader_email || "")} saving={Boolean(saving)} onSave={input => act("agenda_settings", input)} onClose={() => setSettingsOpen(false)} /> : null}
    {topicOpen ? <div className="modal-layer" role="presentation"><section className="record-modal meeting-topic-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-topic-title"><div className="modal-heading"><h2 id="meeting-topic-title">{editingTopic ? "Edit Discussion Topic" : "Request Discussion Topic"}</h2><button aria-label="Close Topic" disabled={Boolean(saving)} onClick={() => setTopicOpen(false)}>×</button></div>
      <label className="field-label">Topic<input maxLength={500} value={topic.title} onChange={event => setTopic(current => ({ ...current, title: event.target.value }))} /></label>
      <div className="field-grid"><label className="field-label">Agenda Section<select value={topic.sectionKey} onChange={event => setTopic(current => ({ ...current, sectionKey: event.target.value }))}>{MEETING_SECTIONS[meetingType].map(section => <option key={section.key} value={section.key}>{section.title}</option>)}</select></label><label className="field-label">Minutes<input type="number" min="0" max="120" value={topic.timeboxMinutes} onChange={event => setTopic(current => ({ ...current, timeboxMinutes: Number(event.target.value) }))} /></label></div>
      <label className="field-label">Details And Discussion Notes<textarea maxLength={20000} rows={7} value={topic.notes} onChange={event => setTopic(current => ({ ...current, notes: event.target.value }))} /></label>
      <div className="modal-actions"><button className="secondary-action" disabled={Boolean(saving)} onClick={() => setTopicOpen(false)}>Cancel</button><button className="primary-action" disabled={Boolean(saving) || !topic.title.trim()} onClick={() => void saveTopic()}>{editingTopic ? "Save Topic" : "Submit Topic Request"}</button></div>
    </section></div> : null}

    {setupOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && setSetupOpen(false)}><section className="record-modal wide meeting-setup-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-setup-title"><div className="modal-heading"><div><h2 id="meeting-setup-title">Schedule {meetingType}</h2></div><button aria-label="Close Meeting Setup" disabled={Boolean(saving)} onClick={() => setSetupOpen(false)}>×</button></div><div className="field-grid"><label className="field-label">Series Title<input value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} /></label><label className="field-label">First Meeting<input type="datetime-local" value={setup.startAt} onChange={(event) => setSetup({ ...setup, startAt: event.target.value })} /></label><label className="field-label">Cadence<select value={setup.cadence} onChange={(event) => setSetup({ ...setup, cadence: event.target.value })}><option>Weekly</option><option>Biweekly</option><option>Monthly</option><option>Quarterly</option><option>As Needed</option></select></label><label className="field-label">Duration (Minutes)<input type="number" min="15" max="480" value={setup.durationMinutes} onChange={(event) => setSetup({ ...setup, durationMinutes: Number(event.target.value) })} /></label><label className="field-label">Meeting Mode<select value={setup.meetingMode} onChange={(event) => setSetup({ ...setup, meetingMode: event.target.value })}><option>Teams Remote</option><option>In Person</option><option>Hybrid</option></select></label><label className="field-label">Location<input value={setup.location} onChange={(event) => setSetup({ ...setup, location: event.target.value })} /></label><label className="field-label">Leader Name<input value={setup.leaderName} onChange={(event) => setSetup({ ...setup, leaderName: event.target.value })} /></label><label className="field-label">Leader Email<input type="email" value={setup.leaderEmail} onChange={(event) => setSetup({ ...setup, leaderEmail: event.target.value })} /></label></div><label className="field-label">Designated Attendees <small>One per line as Name &lt;email@company.com&gt;. Company Owners are added automatically to company leadership meetings.</small><textarea value={setup.attendees} onChange={(event) => setSetup({ ...setup, attendees: event.target.value })} /></label><label className="setting-toggle"><span><strong>Create Outlook Series And Teams Meeting</strong><small>{data.microsoft.configured ? "Your owner-approved Mefford Microsoft account will be the organizer. A typed leader email cannot override it." : "Microsoft synchronization remains blocked until IT finishes the connection and the owner approves your individual Microsoft identity mapping."}</small></span><input type="checkbox" disabled={!data.microsoft.configured || Boolean(saving)} checked={setup.syncMicrosoft} onChange={(event) => setSetup({ ...setup, syncMicrosoft: event.target.checked })} /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setSetupOpen(false)}>Cancel</button><div className="meeting-suggested-people"><label className="compact-check"><input type="checkbox" checked={setup.useSuggestedAttendees} onChange={event => setSetup({ ...setup, useSuggestedAttendees: event.target.checked })} />Include The Assigned Team</label><p>{data.setupDefaults?.attendees.map(person => person.name).join(" · ") || "Meeting leader and company owners are included."}</p></div><button className="primary-action large" disabled={Boolean(saving)} onClick={() => void createSeries()}>{saving ? "Creating…" : "Create Controlled Series"}</button></div></section></div> : null}
    {newOccurrenceOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNewOccurrenceOpen(false)}><section className="record-modal"><div className="modal-heading"><div><h2>Add Meeting Occurrence</h2></div><button onClick={() => setNewOccurrenceOpen(false)}>×</button></div><label className="field-label">Start Date And Time<input type="datetime-local" value={setup.startAt} onChange={(event) => setSetup({ ...setup, startAt: event.target.value })} /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setNewOccurrenceOpen(false)}>Cancel</button><button className="primary-action" onClick={async () => { if (await act("create_occurrence", { seriesId: series?.id, startAt: setup.startAt, durationMinutes: series?.duration_minutes })) setNewOccurrenceOpen(false); }}>Create Occurrence</button></div></section></div> : null}
  </div>;
}

function readSignal(item: Row): (AgendaSignal & { active: boolean }) | null {
  if (item.source_type !== "Automatic Agenda") return null;
  try { return JSON.parse(String(item.source_version)) as AgendaSignal & { active: boolean }; } catch { return null; }
}

function sourceLink(signal: AgendaSignal) {
  const source = signal.source;
  return `/?${new URLSearchParams({ target: source.target, project: source.projectId, record: source.recordType === "Live Scorecard" ? "" : source.id })}`;
}

function AgendaRow({ item, draft, onDraft, hidden, locked, saving, onSave, onAssign, canDispose, canRemove, onRemove, onEdit, onReload }: { item: Row; onReload: () => void; canDispose: boolean; canRemove: boolean; onRemove: () => void; onEdit?: () => void; draft?: AgendaDraft; onDraft: (draft: AgendaDraft) => void; hidden: boolean; locked: boolean; saving: string; onAssign: () => void; onSave: (notes: string, status: string, timeboxMinutes: number) => Promise<boolean> }) {
  const notes = draft?.notes ?? String(item.notes || ""), status = draft?.status ?? String(item.status || "Open"), timebox = draft?.timebox ?? Number(item.timebox_minutes || 0);
  const signal = readSignal(item);
  const standard = item.source_type === "Standard Section";
  return <article hidden={hidden} className={`agenda-row ${standard ? "agenda-standard" : "agenda-source"} ${signal?.active === false ? "agenda-cleared" : ""}`}>
    <div className="agenda-main"><div className="agenda-item-heading"><strong>{standard ? "Discussion Record" : item.title}</strong>{signal && !standard ? <span className={`agenda-priority priority-${signal.active ? signal.priority.toLowerCase() : "routine"}`}>{signal.active ? signal.priority : "Source Cleared"}</span> : null}<span className="mini-status">{status}</span>{Number(item.addendum_number) ? <em>Addendum {item.addendum_number}</em> : null}</div>
      {!standard && item.source_reason ? <p className="agenda-evidence">{item.source_reason}</p> : null}
      {signal?.metric ? <strong className="agenda-metric-value">{signal.metric.unit === "currency" ? money(signal.metric.value) : signal.metric.value}</strong> : null}
      {signal?.nextStep ? <p className="agenda-next-step"><b>Discussion:</b> {signal.nextStep}</p> : null}
      {signal ? <div className="agenda-source-reference"><a href={sourceLink(signal)} target="_blank" rel="noreferrer">Open {signal.source.recordType} ↗</a><span>{signal.source.id} · Updated {displayDate(signal.source.updatedAt)}</span></div> : !standard ? <p className="agenda-source-reference">{item.source_type} · {item.source_id}</p> : null}
      <label className="agenda-notes-label">{standard ? "Section Notes" : "Discussion Notes"}<textarea value={notes} readOnly={locked || Boolean(saving)} placeholder="Record the discussion, decision, or next step." onChange={event => { onDraft({ notes: event.target.value, status, timebox, version: draft?.version || String(item.updated_at) }); }} /></label>
    </div><div className="agenda-controls"><label>Minutes<input aria-label={`${item.title} minutes`} type="number" min="0" max="120" value={timebox} disabled={locked || Boolean(saving)} onChange={event => { onDraft({ notes, status, timebox: Number(event.target.value), version: draft?.version || String(item.updated_at) }); }} /></label><label>Disposition<select value={status} disabled={locked || !canDispose || Boolean(saving)} onChange={event => { onDraft({ notes, status: event.target.value, timebox, version: draft?.version || String(item.updated_at) }); }}><option>Requested</option><option>Open</option><option>Discussed</option><option>Reviewed—Nothing to Report</option><option>Deferred</option><option>Complete</option><option>Source Cleared</option></select></label>{draft ? <button className="secondary-action" disabled={Boolean(saving)} onClick={onReload}>Reload Saved Discussion</button> : null}{onEdit ? <button className="secondary-action" disabled={Boolean(saving)} onClick={onEdit}>Edit Topic</button> : null}{canRemove ? <button className="secondary-action" disabled={Boolean(saving)} onClick={onRemove}>{item.status === "Removed" ? "Restore Topic" : "Remove Topic"}</button> : null}{!locked ? <button className="secondary-action" disabled={Boolean(saving)} onClick={async () => { await onSave(notes, status, timebox); }}>Save Discussion</button> : null}{!locked && !standard && !signal?.metric ? <button className="primary-action" disabled={Boolean(saving)} onClick={onAssign}>Assign Action</button> : null}</div>
  </article>;
}

function ActionCard({ item, actorEmail, canLead, onStatus }: { item: Row; actorEmail: string; canLead: boolean; onStatus: (status: string, reason?: string) => Promise<boolean> }) {
  const owns = String(item.assignee_email).toLowerCase() === actorEmail.toLowerCase();
  return <article className="action-card"><div><span className={`mini-status ${statusTone(item.status)}`}>{item.item_kind} · {item.status}</span><strong>{item.title}</strong><p>{item.definition_of_done}</p><small>{item.id} · {item.assignee_name} · Due {displayDate(item.due_at)} · Carry {item.carry_count}{item.my_work_status ? ` · My Work ${item.my_work_status}` : ""}</small>{item.blocker ? <em>Blocked: {item.blocker}</em> : null}</div>{owns || canLead ? <div className="action-buttons">{String(item.status) === "Assignment Not Confirmed" ? <><button onClick={() => void onStatus("Accepted")}>Accept</button><button onClick={() => { const reason = window.prompt("What needs clarification?"); if (reason) void onStatus("Needs Clarification", reason); }}>Needs Clarification</button></> : null}{!["Complete", "Cancelled With Reason", "Carried Forward"].includes(String(item.status)) ? <><button onClick={() => void onStatus("In Progress")}>In Progress</button><button onClick={() => { const reason = window.prompt("What is blocking this action?"); if (reason) void onStatus("Blocked", reason); }}>Blocked</button><button className="primary-action" onClick={() => void onStatus("Complete")}>Complete</button></> : null}</div> : null}</article>;
}
