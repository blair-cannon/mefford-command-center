"use client";

import { useEffect, useMemo, useState } from "react";

type Period = { start: string; end: string; payDate: string; label: string };
type Destination = { id: string; label: string };
type TimeEntry = { id: string; date: string; destination: string; code: string; description: string; timeType: "Regular" | "Overtime" | "PTO" | "Holiday"; hours: number; note: string };
type TimeResponse = { periods: Period[]; selectedPeriod: Period; timesheet: { status: string; entries: TimeEntry[]; updatedAt: string } | null; destinations: Destination[]; boundary: string; error?: string };

function newLine(period?: Period): TimeEntry {
  const today = new Date().toISOString().slice(0, 10);
  return { id: crypto.randomUUID(), date: period && today >= period.start && today <= period.end ? today : period?.start || today, destination: "", code: "", description: "", timeType: "Regular", hours: 0, note: "" };
}

export function EmployeeTimeEntry() {
  const [data, setData] = useState<TimeResponse | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  async function load(periodEnd?: string) {
    const response = await fetch(`/api/employee-time${periodEnd ? `?periodEnd=${encodeURIComponent(periodEnd)}` : ""}`, { cache: "no-store" });
    const result = await response.json() as TimeResponse;
    if (!response.ok) throw new Error(result.error || "Employee Time Is Unavailable.");
    setData(result);
    setEntries(result.timesheet?.entries?.length ? result.timesheet.entries : [newLine(result.selectedPeriod)]);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employee-time", { cache: "no-store" })
      .then(async (response) => { const result = await response.json() as TimeResponse; if (!response.ok) throw new Error(result.error || "Employee Time Is Unavailable."); return result; })
      .then((result) => { if (!cancelled) { setData(result); setEntries(result.timesheet?.entries?.length ? result.timesheet.entries : [newLine(result.selectedPeriod)]); } })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Employee Time Is Unavailable."));
    return () => { cancelled = true; };
  }, []);
  const totals = useMemo(() => entries.reduce((value, entry) => { value.total += Number(entry.hours || 0); value[entry.timeType] += Number(entry.hours || 0); return value; }, { Regular: 0, Overtime: 0, PTO: 0, Holiday: 0, total: 0 }), [entries]);

  function update(id: string, changes: Partial<TimeEntry>) {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  }

  async function save(status: "Employee Draft" | "Employee Submitted") {
    if (!data) return;
    setSaving(status);
    setNotice("");
    try {
      const response = await fetch("/api/employee-time", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodEnd: data.selectedPeriod.end, status, entries }) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "Employee Time Could Not Be Saved.");
      await load(data.selectedPeriod.end);
      setNotice(result.notice || "Employee Time Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Employee Time Could Not Be Saved.");
    } finally {
      setSaving("");
    }
  }

  if (!data) return <section className="employee-home-card employee-time-card"><span>{notice || "Opening Your Timesheet..."}</span></section>;
  return <section className="employee-home-card employee-time-card" id="my-time">
    <header><div><p className="eyebrow orange-text">MY TIME</p><h2>Enter Time Once</h2><span>Your lines feed the accounting payroll report. Save as you go, then submit when the period is right.</span></div><label>PAY PERIOD<select value={data.selectedPeriod.end} onChange={(event) => void load(event.target.value).catch((error) => setNotice(error instanceof Error ? error.message : "That Period Could Not Be Opened."))}>{data.periods.map((period) => <option key={period.end} value={period.end}>{period.label}</option>)}</select></label></header>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <div className="employee-time-status"><span><small>STATUS</small><strong>{data.timesheet?.status || "Not Started"}</strong></span><span><small>PAY DATE</small><strong>{data.selectedPeriod.payDate}</strong></span><span><small>TOTAL HOURS</small><strong>{totals.total.toFixed(2)}</strong></span><span><small>REG / OT / PTO / HOL</small><strong>{totals.Regular.toFixed(2)} / {totals.Overtime.toFixed(2)} / {totals.PTO.toFixed(2)} / {totals.Holiday.toFixed(2)}</strong></span></div>
    <div className="employee-time-sheet" data-reflow-table=""><div className="employee-time-head" data-reflow-head="wide"><span>Date</span><span>Project / Overhead</span><span>Cost Code</span><span>Work Description</span><span>Type</span><span>Hours</span><span /></div>{entries.map((entry) => <div className="employee-time-row" key={entry.id} data-reflow-row="wide"><label className="reflow-field" data-label="Date"><input aria-label="Work date" type="date" min={data.selectedPeriod.start} max={data.selectedPeriod.end} value={entry.date} onChange={(event) => update(entry.id, { date: event.target.value })} /></label><label className="reflow-field" data-label="Project / Overhead"><select aria-label="Project or overhead" value={entry.destination} onChange={(event) => update(entry.id, { destination: event.target.value })}><option value="">Choose…</option>{data.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></label><label className="reflow-field" data-label="Cost Code"><input aria-label="Cost code" placeholder="03-300" value={entry.code} onChange={(event) => update(entry.id, { code: event.target.value })} /></label><label className="reflow-field" data-label="Work Description"><input aria-label="Work description" placeholder="What you worked on" value={entry.description} onChange={(event) => update(entry.id, { description: event.target.value })} /></label><label className="reflow-field" data-label="Type"><select aria-label="Time type" value={entry.timeType} onChange={(event) => update(entry.id, { timeType: event.target.value as TimeEntry["timeType"] })}><option>Regular</option><option>Overtime</option><option>PTO</option><option>Holiday</option></select></label><label className="reflow-field" data-label="Hours"><input aria-label="Hours" type="number" min="0" max="24" step="0.25" value={entry.hours || ""} onChange={(event) => update(entry.id, { hours: Number(event.target.value) })} /></label><button aria-label="Remove time line" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} data-label="Actions">×</button></div>)}</div>
    <div className="employee-time-actions"><button className="secondary-action" onClick={() => setEntries((current) => [...current, newLine(data.selectedPeriod)])}>＋ Add Time Line</button><span>{data.boundary}</span><button className="secondary-action" disabled={Boolean(saving)} onClick={() => void save("Employee Draft")}>{saving === "Employee Draft" ? "Saving..." : "Save Draft"}</button><button className="primary-action large" disabled={Boolean(saving)} onClick={() => void save("Employee Submitted")}>{saving === "Employee Submitted" ? "Submitting..." : "Submit To Accounting"}</button></div>
  </section>;
}

type GoalResponse = { quarter: string; status: string; finalized: boolean; goals: string[]; roleFocus: Array<{ key: string; label: string; category: string; description: string }>; progress: null | { systemScore: number | null; finalScore: number | null; grade: string; evidenceCoverage: number; metrics: Array<{ key: string; label: string; category: string; score: number | null; confidence: string; detail: string }> }; privacy: string; error?: string };

export function EmployeeGoals() {
  const [data, setData] = useState<GoalResponse | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { let cancelled = false; fetch("/api/employee-goals", { cache: "no-store" }).then(async (response) => { const result = await response.json() as GoalResponse; if (!response.ok) throw new Error(result.error || "Your Goals Are Unavailable."); return result; }).then((result) => !cancelled && setData(result)).catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Your Goals Are Unavailable.")); return () => { cancelled = true; }; }, []);
  if (!data) return <section className="employee-home-card employee-goals-card"><span>{notice || "Preparing Your Goals..."}</span></section>;
  const score = data.progress?.finalScore ?? data.progress?.systemScore;
  const metrics = data.progress?.metrics?.length ? data.progress.metrics : data.roleFocus.map((item) => ({ ...item, score: null, confidence: "Not Yet Measured", detail: item.description }));
  return <section className="employee-home-card employee-goals-card" id="my-goals"><header><div><p className="eyebrow orange-text">MY GOALS</p><h2>Your Quarter, Without The Guessing</h2><span>{data.finalized ? "Your finalized goals and results are below." : "This is your own operational progress snapshot. Owner review notes remain private until the review is finalized."}</span></div><div className="employee-goal-score"><strong>{score === null || score === undefined ? "—" : score}</strong><span>{data.progress?.grade || "Building Evidence"}</span><small>{data.quarter} · {data.progress?.evidenceCoverage || 0}% Evidence Coverage</small></div></header>
    {data.goals.length ? <div className="employee-goal-list"><strong>MY AGREED GOALS</strong>{data.goals.map((goal, index) => <div key={`${goal}-${index}`}><b>{index + 1}</b><span>{goal}</span></div>)}</div> : <div className="employee-goal-empty"><strong>Individual Goals Are Being Established</strong><span>Your role focus is visible now. Finalized quarterly goals will appear here automatically—no separate spreadsheet needed.</span></div>}
    <div className="employee-metric-grid">{metrics.map((metric) => <article key={metric.key}><div><span>{metric.category}</span><strong>{metric.label}</strong></div><b>{metric.score === null ? "—" : `${metric.score}%`}</b><p>{metric.detail}</p><small>{metric.confidence}</small></article>)}</div><footer>{data.privacy}</footer>
  </section>;
}

type MeetingConnection = { configured: boolean; organizer: string; directLinks: { teams: string; calendar: string }; error?: string };

function defaultMeetingStart() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EmployeeMicrosoftTools() {
  const [connection, setConnection] = useState<MeetingConnection | null>(null);
  const [form, setForm] = useState({ title: "", startAt: defaultMeetingStart(), durationMinutes: 30, attendees: "", message: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { let cancelled = false; fetch("/api/employee-meetings", { cache: "no-store" }).then(async (response) => { const result = await response.json() as MeetingConnection; if (!response.ok) throw new Error(result.error || "Microsoft Tools Are Unavailable."); return result; }).then((result) => !cancelled && setConnection(result)).catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Microsoft Tools Are Unavailable.")); return () => { cancelled = true; }; }, []);
  async function send() {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/employee-meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, startAt: new Date(form.startAt).toISOString(), attendees: form.attendees.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean) }) });
      const result = await response.json() as { error?: string; notice?: string; joinUrl?: string };
      if (!response.ok) throw new Error(result.error || "The Teams Invite Could Not Be Sent.");
      setNotice(result.notice || "Teams Invite Sent.");
      setForm({ title: "", startAt: defaultMeetingStart(), durationMinutes: 30, attendees: "", message: "" });
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Teams Invite Could Not Be Sent."); } finally { setSaving(false); }
  }
  return <section className="employee-home-card employee-microsoft-card" id="my-microsoft"><header><div><p className="eyebrow orange-text">MICROSOFT WORK TOOLS</p><h2>Email, Calendar And Teams</h2><span>Open your everyday tools or create a real Teams meeting without leaving your employee home.</span></div><b className={connection?.configured ? "connected" : "setup"}>{connection?.configured ? "CONNECTED" : "CONNECTION REQUIRED"}</b></header>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <div className="employee-microsoft-grid"><div className="employee-microsoft-links"><a href="https://outlook.office.com/mail/" target="_blank" rel="noreferrer"><i>@</i><span><strong>Check Email</strong><small>Open Outlook inbox</small></span><b>OPEN ↗</b></a><a href="https://outlook.office.com/calendar/" target="_blank" rel="noreferrer"><i>CAL</i><span><strong>Update Calendar</strong><small>Open Outlook calendar</small></span><b>OPEN ↗</b></a><a href="https://teams.microsoft.com/" target="_blank" rel="noreferrer"><i>TM</i><span><strong>Open Teams</strong><small>Chat, calls and meetings</small></span><b>OPEN ↗</b></a></div><div className="employee-invite-form"><div><strong>Send A Teams Invite</strong><small>{connection?.configured ? "The invite will send now and appear on the Mefford calendar." : "IT must finish the Microsoft 365 connection before Command Center can send it."}</small></div><label>Meeting Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What is this meeting for?" /></label><div className="field-grid"><label>Start<input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label><label>Minutes<select value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })}><option value={15}>15</option><option value={30}>30</option><option value={45}>45</option><option value={60}>60</option><option value={90}>90</option></select></label></div><label>Attendee Emails<textarea value={form.attendees} onChange={(event) => setForm({ ...form, attendees: event.target.value })} placeholder="One per line or separated by commas" /></label><label>Message<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Optional meeting context" /></label><button className="primary-action large" disabled={saving || !connection?.configured || !form.title.trim() || !form.attendees.trim()} onClick={() => void send()}>{saving ? "Sending..." : "Send Teams Invite"}</button></div></div>
  </section>;
}
