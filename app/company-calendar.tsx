"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CalendarCategory = "Estimating" | "People" | "Projects" | "Meetings" | "Company" | "Sales";
type CalendarEvent = { id: string; title: string; date: string; time?: string; category: CalendarCategory; owner: string; projectId?: string; source: string; annual?: boolean; notes?: string };
type CalendarResponse = { events: CalendarEvent[]; outlook: { status: string; synchronized: boolean; calendarName: string; boundary: string }; error?: string };

const categories: Array<"All" | CalendarCategory> = ["All", "Estimating", "People", "Projects", "Meetings", "Company", "Sales"];
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function CompanyCalendarWorkspace({ initialFilter = "All", canManage = false }: { initialFilter?: "All" | CalendarCategory; canManage?: boolean }) {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [filter, setFilter] = useState<"All" | CalendarCategory>(initialFilter);
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({ title: "", date: "", time: "", category: initialFilter === "Estimating" ? "Estimating" as CalendarCategory : "Company" as CalendarCategory, owner: "", annual: false, notes: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/company-calendar", { cache: "no-store" });
      const body = await response.json() as CalendarResponse;
      if (!response.ok) throw new Error(body.error || "Calendar Could Not Load");
      setData(body);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Calendar Could Not Load"); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/company-calendar", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as CalendarResponse;
        if (!response.ok) throw new Error(body.error || "Calendar Could Not Load");
        return body;
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Calendar Could Not Load"); });
    return () => { cancelled = true; };
  }, []);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const visible = useMemo(() => (data?.events || [])
    .map((event) => event.annual ? { ...event, date: `${monthKey.slice(0, 4)}${event.date.slice(4)}` } : event)
    .filter((event) => event.date.startsWith(monthKey) && (filter === "All" || event.category === filter)), [data, filter, monthKey]);
  const firstWeekday = new Date(`${monthKey}-01T12:00:00Z`).getUTCDay();
  const dayCount = new Date(Date.UTC(cursor.getFullYear(), cursor.getMonth() + 1, 0)).getUTCDate();
  const calendarCells = Array.from({ length: Math.ceil((firstWeekday + dayCount) / 7) * 7 }, (_, index) => index - firstWeekday + 1);

  async function saveEvent() {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/company-calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...draft }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Event Could Not Be Saved");
      setOpen(false); setDraft({ title: "", date: "", time: "", category: initialFilter === "Estimating" ? "Estimating" : "Company", owner: "", annual: false, notes: "" });
      await load(); setNotice("Company Calendar Event Saved Permanently.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Event Could Not Be Saved"); }
    finally { setSaving(false); }
  }

  return <div className="module-workspace company-calendar-workspace">
    <section className="workspace-heading"><div><h1>{initialFilter === "Estimating" ? "Estimating Calendar" : "Company Calendar"}</h1></div>{canManage ? <button className="primary-action" onClick={() => setOpen(true)}>＋ New Calendar Event</button> : null}</section>
    {notice ? <div className="notice-banner">{notice}</div> : null}
    <section className={`calendar-outlook-boundary ${data?.outlook.synchronized ? "connected" : "held"}`}><div><strong>{data?.outlook.calendarName || "Mefford Contracting Master Calendar"}</strong><span>{data?.outlook.boundary || "Checking Microsoft calendar connection..."}</span></div><i>{data?.outlook.status || "Checking"}</i></section>
    <section className="calendar-controls"><div>{categories.map((category) => <button key={category} className={filter === category ? "active" : ""} onClick={() => setFilter(category)}>{category}</button>)}</div><nav><button aria-label="Previous Month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button><strong>{monthLabel.format(cursor)}</strong><button aria-label="Next Month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button></nav></section>
    <section className="master-calendar-grid"><div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-days">{calendarCells.map((day, index) => { const date = `${monthKey}-${String(day).padStart(2, "0")}`; const dayEvents = day > 0 && day <= dayCount ? visible.filter((event) => event.date === date) : []; return <article key={`${date}-${index}`} data-calendar-date={day > 0 && day <= dayCount ? dateLabel.format(new Date(`${date}T12:00:00Z`)) : ""} className={day < 1 || day > dayCount ? "outside" : ""}><b>{day > 0 && day <= dayCount ? day : ""}</b>{dayEvents.slice(0, 4).map((event) => <button key={event.id} className={`calendar-event ${event.category.toLowerCase()}`} title={`${event.title} · ${event.owner}`}><i>{event.time || event.category.slice(0, 3).toUpperCase()}</i><span>{event.title}</span></button>)}{dayEvents.length > 4 ? <small>+{dayEvents.length - 4} more</small> : null}</article>; })}</div></section>
    <section className="calendar-agenda"><header><div><h2>Month Agenda</h2><span>{visible.length} coordinated event{visible.length === 1 ? "" : "s"}</span></div></header>{visible.length ? visible.map((event) => <article key={`agenda-${event.id}`}><time>{dateLabel.format(new Date(`${event.date}T12:00:00Z`))}{event.time ? ` · ${event.time}` : ""}</time><i className={event.category.toLowerCase()}>{event.category}</i><div><strong>{event.title}</strong><span>{event.owner} · {event.source}{event.annual ? " · Repeats Annually" : ""}</span></div></article>) : <div className="empty-attention-state"><strong>No Events In This View</strong><span>Adjust the month or category, or add a controlled company event.</span></div>}</section>
    {canManage && open ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title"><div className="modal-heading"><div><h2 id="calendar-event-title">New Calendar Event</h2></div><button aria-label="Close Calendar Event" onClick={() => setOpen(false)}>×</button></div><label className="field-label">Event Title<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><div className="field-grid"><label className="field-label">Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label className="field-label">Time (Optional)<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label><label className="field-label">Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as CalendarCategory })}>{categories.filter((item) => item !== "All").map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Primary Owner<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Defaults to creator" /></label></div><label className="field-label">Notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><label className="calendar-annual"><input type="checkbox" checked={draft.annual} onChange={(event) => setDraft({ ...draft, annual: event.target.checked })} /><span>Repeat annually (birthdays, hire dates, company anniversaries)</span></label><div className="modal-actions"><button className="secondary-action" onClick={() => setOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !draft.title || !draft.date} onClick={() => void saveEvent()}>{saving ? "Saving..." : "Save Company Event"}</button></div></section></div> : null}
  </div>;
}
