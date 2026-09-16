"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MyWorkItem } from "./my-work";

type EmailAddress = { emailAddress?: { name?: string; address?: string } };
type Folder = { id: string; displayName: string; totalItemCount: number; unreadItemCount: number };
type Message = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  importance?: string;
  webLink?: string;
  flag?: { flagStatus?: string };
  from?: EmailAddress;
  toRecipients?: EmailAddress[];
  ccRecipients?: EmailAddress[];
};
type CalendarEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  organizer?: EmailAddress;
  attendees?: Array<EmailAddress & { type?: string; status?: { response?: string } }>;
  webLink?: string;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
};
type MicrosoftData = {
  configured?: boolean;
  employeeEmail?: string;
  entra?: { configured: boolean; required: boolean; verified: boolean; verifiedAt: string; microsoftEmail: string; connectUrl: string };
  folders?: Folder[];
  messages?: Message[];
  message?: Message;
  events?: CalendarEvent[];
  folderId?: string;
  boundary?: string;
  permissionError?: boolean;
  directLinks: { mail: string; calendar: string; teams: string };
  error?: string;
};
type WorkData = { items?: MyWorkItem[]; error?: string };
export type HomeDestination = "Work & Time" | "Email" | "Calendar" | "Requests & PTO" | "Benefits" | "Growth & Training";
type AppIconName = "mail" | "calendar" | "check" | "clock" | "search" | "compose" | "refresh" | "team" | "reply" | "forward" | "archive" | "trash" | "flag" | "attach" | "grid" | "list";
type Attachment = { name: string; contentType: string; base64: string; size: number };
type ComposeDraft = { mode: "new" | "reply" | "replyAll" | "forward"; messageId: string; recipients: string; subject: string; bodyText: string; attachments: Attachment[] };
type EventDraft = { eventId: string; subject: string; startAt: string; endAt: string; location: string; bodyText: string; attendees: string };

const DIRECT_LINKS = { mail: "https://outlook.office.com/mail/", calendar: "https://outlook.office.com/calendar/", teams: "https://teams.microsoft.com/" };

export function EmployeeHomeOverview({ firstName, onNavigate, onOpenWorkItem }: { firstName: string; onNavigate: (target: HomeDestination) => void; onOpenWorkItem?: (item: MyWorkItem) => void }) {
  const [mail, setMail] = useState<MicrosoftData | null>(null);
  const [calendar, setCalendar] = useState<MicrosoftData | null>(null);
  const [work, setWork] = useState<WorkData | null>(null);
  const [refreshedAt, setRefreshedAt] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setNotice("");
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 7 * 24 * 60 * 60_000);
    const results = await Promise.allSettled([
      fetch("/api/employee-microsoft?view=mail&folderId=inbox", { cache: "no-store" }).then((response) => response.json() as Promise<MicrosoftData>),
      fetch(`/api/employee-microsoft?view=calendar&start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`, { cache: "no-store" }).then((response) => response.json() as Promise<MicrosoftData>),
      fetch("/api/my-work", { cache: "no-store" }).then((response) => response.json() as Promise<WorkData>),
    ]);
    if (results[0].status === "fulfilled") setMail(results[0].value);
    if (results[1].status === "fulfilled") setCalendar(results[1].value);
    if (results[2].status === "fulfilled") setWork(results[2].value);
    if (results.some((result) => result.status === "rejected")) setNotice("One live panel is reconnecting. The rest of My Work remains available.");
    setRefreshedAt(new Date().toISOString());
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const live = window.setInterval(() => void refresh(), 30_000);
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(live);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const visibleWork = useMemo(() => (work?.items || []).filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).sort(workSort), [work]);
  const unread = mail?.folders?.find((folder) => folder.displayName.toLowerCase() === "inbox")?.unreadItemCount ?? mail?.messages?.filter((message) => !message.isRead).length ?? 0;
  const todayKey = dateKey(new Date());
  const refreshedTime = refreshedAt ? new Date(refreshedAt).getTime() : 0;
  const todayEvents = (calendar?.events || []).filter((event) => event.start?.dateTime && dateKey(new Date(event.start.dateTime)) === todayKey);
  const upcomingEvents = (calendar?.events || []).filter((event) => event.start?.dateTime && new Date(event.start.dateTime).getTime() >= refreshedTime).slice(0, 5);
  const nextEvent = upcomingEvents[0];
  const microsoftLive = Boolean(mail?.configured && !mail.permissionError && calendar?.configured && !calendar.permissionError);

  return <section className="employee-live-home">
    <header className="employee-live-header">
      <div><p>{longDate(new Date()).toUpperCase()}</p><h2>{dayGreeting()}, {firstName}</h2><span>Today’s Work, Email And Calendar</span></div>
      <aside><span className={microsoftLive ? "live" : "reconnecting"}><i />{microsoftLive ? "MICROSOFT 365 LIVE" : "MICROSOFT CONNECTION REQUIRED"}</span><button aria-label="Refresh My Work" onClick={() => void refresh()}><AppIcon name="refresh" />Refresh</button>{refreshedAt ? <small>Updated {timeOnly(refreshedAt)}</small> : null}</aside>
    </header>
    {notice ? <div className="employee-live-notice" role="status">{notice}</div> : null}
    <section className="employee-live-vitals" aria-label="Today at a glance">
      <button onClick={() => onNavigate("Work & Time")}><AppIcon name="check" /><span><small>NEEDS YOUR ATTENTION</small><strong>{visibleWork.length}</strong><em>{visibleWork.filter((item) => item.overdue).length} overdue</em></span></button>
      <button onClick={() => onNavigate("Email")}><AppIcon name="mail" /><span><small>UNREAD INBOX</small><strong>{unread}</strong><em>{mail?.messages?.length || 0} recent messages</em></span></button>
      <button onClick={() => onNavigate("Calendar")}><AppIcon name="calendar" /><span><small>TODAY&apos;S SCHEDULE</small><strong>{todayEvents.length}</strong><em>{nextEvent ? `Next · ${timeOnly(nextEvent.start?.dateTime)}` : "No remaining events"}</em></span></button>
      <button onClick={() => onNavigate("Work & Time")}><AppIcon name="clock" /><span><small>TIME &amp; ACTIVITY</small><strong>OPEN</strong><em>Enter time or review your queue</em></span></button>
    </section>
    <div className="employee-live-grid">
      <article className="employee-home-focus">
        <header><div><AppIcon name="check" /><span><small>PRIORITY QUEUE</small><strong>Needs Your Attention</strong></span></div><button onClick={() => onNavigate("Work & Time")}>Open My Work <b>→</b></button></header>
        <div>{visibleWork.slice(0, 5).map((item, index) => <button key={item.id} className={item.overdue ? "overdue" : ""} onClick={() => onOpenWorkItem ? onOpenWorkItem(item) : onNavigate("Work & Time")}><em>{String(index + 1).padStart(2, "0")}</em><span><small>{item.kind}</small><strong>{item.title}</strong><b>{item.projectId} · {item.dueAt ? dueShort(item.dueAt) : "No due date"}</b></span><i className={`priority-${item.priority.toLowerCase()}`}>{item.priority}</i></button>)}{!visibleWork.length ? <EmptyLivePanel title="You Are Current" detail="New assignments, approvals, and escalations will appear here automatically." /> : null}</div>
      </article>
      <article className="employee-home-inbox">
        <header><div><AppIcon name="mail" /><span><small>LIVE MAIL</small><strong>Inbox</strong></span></div><button onClick={() => onNavigate("Email")}>Open Mail <b>→</b></button></header>
        <div>{(mail?.messages || []).slice(0, 5).map((message) => <button key={message.id} className={message.isRead ? "" : "unread"} onClick={() => onNavigate("Email")}><i>{senderInitial(message)}</i><span><strong>{senderName(message)}</strong><b>{message.subject || "(No Subject)"}</b><small>{message.bodyPreview || "Open this message to read it."}</small></span><time>{relativeMailTime(message.receivedDateTime)}</time></button>)}{mail && !mail.configured ? <EmptyLivePanel title="Connect Microsoft 365" detail={mail.boundary || "Live mailbox data will appear here after IT completes the connection."} /> : !mail?.messages?.length ? <EmptyLivePanel title="Inbox Clear" detail="No recent messages need your attention." /> : null}</div>
      </article>
      <article className="employee-home-calendar">
        <header><div><AppIcon name="calendar" /><span><small>LIVE CALENDAR</small><strong>Coming Up</strong></span></div><button onClick={() => onNavigate("Calendar")}>Open Calendar <b>→</b></button></header>
        <div className="home-date-rail">{Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() + index); return <button key={date.toISOString()} className={index === 0 ? "today" : ""} onClick={() => onNavigate("Calendar")}><small>{date.toLocaleDateString("en-US", { weekday: "short" })}</small><strong>{date.getDate()}</strong><i>{(calendar?.events || []).some((event) => event.start?.dateTime && dateKey(new Date(event.start.dateTime)) === dateKey(date)) ? "" : undefined}</i></button>; })}</div>
        <div className="home-agenda">{upcomingEvents.map((event) => <button key={event.id} onClick={() => onNavigate("Calendar")}><time><b>{event.start?.dateTime ? new Date(event.start.dateTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</b><span>{timeOnly(event.start?.dateTime)}</span></time><i /><span><strong>{event.subject || "Calendar Event"}</strong><small>{event.location?.displayName || (event.isOnlineMeeting ? "Microsoft Teams" : "No location")}</small></span>{event.onlineMeeting?.joinUrl ? <em>TEAMS</em> : null}</button>)}{calendar && !calendar.configured ? <EmptyLivePanel title="Connect Microsoft 365" detail={calendar.boundary || "Live calendar data will appear here after IT completes the connection."} /> : !upcomingEvents.length ? <EmptyLivePanel title="Schedule Open" detail="No upcoming events in the next seven days." /> : null}</div>
      </article>

    </div>
    <nav className="employee-quick-dock" aria-label="Employee quick actions">
      <button onClick={() => onNavigate("Email")}><AppIcon name="compose" /><span><strong>Compose Email</strong><small>Send from Mefford</small></span></button>
      <button onClick={() => onNavigate("Calendar")}><AppIcon name="calendar" /><span><strong>New Event</strong><small>Calendar or Teams Invite</small></span></button>
      <button onClick={() => onNavigate("Work & Time")}><AppIcon name="clock" /><span><strong>Enter Time</strong><small>Save or submit</small></span></button>
      <button onClick={() => onNavigate("Requests & PTO")}><AppIcon name="check" /><span><strong>Request PTO</strong><small>Route to your manager</small></span></button>
      <button onClick={() => onNavigate("Benefits")}><AppIcon name="grid" /><span><strong>Pay &amp; Benefits</strong><small>Paylocity and plans</small></span></button>
      <a href={DIRECT_LINKS.teams} target="_blank" rel="noreferrer"><AppIcon name="team" /><span><strong>Open Teams</strong><small>Chat, calls and meetings</small></span></a>
    </nav>
  </section>;
}

export function EmployeeOutlookCenter({ initialView = "mail" }: { initialView?: "mail" | "calendar" }) {
  const [view, setView] = useState<"mail" | "calendar">(initialView);
  const [data, setData] = useState<MicrosoftData | null>(null);
  const [folderId, setFolderId] = useState("inbox");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");
  const [query, setQuery] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [calendarAnchor, setCalendarAnchor] = useState(() => firstOfMonth(new Date()));
  const [calendarMode, setCalendarMode] = useState<"month" | "agenda">("month");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);

  async function fetchWorkspace(nextView: "mail" | "calendar", nextFolder = folderId, nextAnchor = calendarAnchor) {
    const range = calendarRange(nextAnchor);
    const queryString = nextView === "calendar"
      ? `?view=calendar&start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`
      : `?view=mail&folderId=${encodeURIComponent(nextFolder)}`;
    const response = await fetch(`/api/employee-microsoft${queryString}`, { cache: "no-store" });
    const result = await response.json() as MicrosoftData;
    if (!response.ok && !result.permissionError) throw new Error(result.error || "Microsoft 365 Is Unavailable.");
    return result;
  }

  async function load(nextView = view, nextFolder = folderId, nextAnchor = calendarAnchor) {
    const result = await fetchWorkspace(nextView, nextFolder, nextAnchor);
    setData(result);
    if (result.error) setNotice(result.error);
    if (nextView === "mail" && result.messages?.length) {
      const preferred = result.messages.find((message) => message.id === selectedMessage?.id) || result.messages[0];
      await openMessage(preferred, result);
    }
    if (nextView === "calendar" && result.events?.length && !selectedEvent) setSelectedEvent(result.events[0]);
  }

  useEffect(() => {
    let cancelled = false;
    fetchWorkspace(initialView, "inbox", firstOfMonth(new Date()))
      .then(async (result) => {
        if (cancelled) return;
        setData(result);
        if (result.error) setNotice(result.error);
        if (initialView === "mail" && result.messages?.length) {
          const response = await fetch(`/api/employee-microsoft?view=message&messageId=${encodeURIComponent(result.messages[0].id)}`, { cache: "no-store" });
          const detail = await response.json() as MicrosoftData;
          if (!cancelled && detail.message) setSelectedMessage(detail.message);
        } else if (initialView === "calendar" && result.events?.length) setSelectedEvent(result.events[0]);
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Microsoft 365 Is Unavailable."));
    return () => { cancelled = true; };
  }, [initialView]);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (document.visibilityState !== "visible" || saving || compose || eventDraft) return;
      void fetchWorkspace(view, folderId, calendarAnchor)
        .then((result) => {
          if (cancelled) return;
          setData(result);
          if (selectedEvent) setSelectedEvent(result.events?.find((event) => event.id === selectedEvent.id) || selectedEvent);
        })
        .catch(() => undefined);
    };
    const live = window.setInterval(sync, 30_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      window.clearInterval(live);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [view, folderId, calendarAnchor, saving, compose, eventDraft, selectedEvent]);

  async function openMessage(message: Message, source = data) {
    setSaving("message");
    try {
      const response = await fetch(`/api/employee-microsoft?view=message&messageId=${encodeURIComponent(message.id)}`, { cache: "no-store" });
      const result = await response.json() as MicrosoftData;
      if (!response.ok) throw new Error(result.error || "That Message Could Not Be Opened.");
      setSelectedMessage(result.message || message);
      if (!message.isRead) {
        setData(source ? { ...source, messages: source.messages?.map((item) => item.id === message.id ? { ...item, isRead: true } : item) } : source);
        await post({ action: "set_read", messageId: message.id, isRead: true }, false);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "That Message Could Not Be Opened."); }
    finally { setSaving(""); }
  }

  async function post(payload: Record<string, unknown>, reload = true) {
    setSaving(String(payload.action || "saving")); setNotice("");
    try {
      const response = await fetch("/api/employee-microsoft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; notice?: string };
      if (!response.ok) throw new Error(result.error || "Microsoft 365 Could Not Complete This Action.");
      if (reload) await load();
      setNotice(result.notice || "Microsoft 365 Updated.");
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Microsoft 365 Could Not Complete This Action."); return false; }
    finally { setSaving(""); }
  }

  async function switchView(next: "mail" | "calendar") {
    setView(next); setNotice(""); setSelectedMessage(null); setSelectedEvent(null);
    try { await load(next); } catch (error) { setNotice(error instanceof Error ? error.message : "Microsoft 365 Is Unavailable."); }
  }

  async function switchFolder(next: string) {
    setFolderId(next); setSelectedMessage(null); setNotice("");
    try { await load("mail", next); } catch (error) { setNotice(error instanceof Error ? error.message : "That Mail Folder Is Unavailable."); }
  }

  async function moveCalendar(months: number) {
    const next = firstOfMonth(new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth() + months, 1));
    setCalendarAnchor(next); setSelectedEvent(null);
    try { await load("calendar", folderId, next); } catch (error) { setNotice(error instanceof Error ? error.message : "That Calendar Period Is Unavailable."); }
  }

  async function sendCompose() {
    if (!compose) return;
    const recipients = parseEmails(compose.recipients);
    const payload = compose.mode === "new"
      ? { action: "send_mail", recipients, subject: compose.subject, bodyText: compose.bodyText, attachments: compose.attachments }
      : compose.mode === "forward"
        ? { action: "forward_message", messageId: compose.messageId, recipients, bodyText: compose.bodyText }
        : { action: "reply_message", messageId: compose.messageId, bodyText: compose.bodyText, replyAll: compose.mode === "replyAll" };
    const sent = await post(payload);
    if (sent) setCompose(null);
  }

  async function addAttachments(files: FileList | null) {
    if (!files || !compose) return;
    const selected = Array.from(files);
    const total = compose.attachments.reduce((sum, file) => sum + file.size, 0) + selected.reduce((sum, file) => sum + file.size, 0);
    if (selected.length + compose.attachments.length > 6 || total > 8 * 1024 * 1024) { setNotice("Use no more than six attachments totaling eight megabytes."); return; }
    try {
      const encoded = await Promise.all(selected.map(fileAttachment));
      setCompose({ ...compose, attachments: [...compose.attachments, ...encoded] });
    } catch {
      setNotice("One attachment could not be read. Choose the file again or send it from Outlook.");
    }
  }

  async function saveEvent() {
    if (!eventDraft) return;
    const saved = await post({ action: eventDraft.eventId ? "update_event" : "create_event", ...eventDraft, attendees: parseEmails(eventDraft.attendees), startAt: new Date(eventDraft.startAt).toISOString(), endAt: new Date(eventDraft.endAt).toISOString() });
    if (saved) setEventDraft(null);
  }

  const messages = useMemo(() => (data?.messages || []).filter((message) => `${senderName(message)} ${message.subject || ""} ${message.bodyPreview || ""}`.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const days = useMemo(() => calendarDays(calendarAnchor), [calendarAnchor]);
  const eventsByDay = useMemo(() => groupEvents(data?.events || []), [data]);
  const directLinks = data?.directLinks || DIRECT_LINKS;
  const connected = Boolean(data?.configured && !data.permissionError);

  if (!data) return <section className="employee-home-card native-office-loading"><span>{notice || "Opening Your Microsoft Workspace…"}</span></section>;
  return <section className="native-office-app">
    <header className="native-office-header">
      <div className="native-office-title"><span><AppIcon name={view === "mail" ? "mail" : "calendar"} /></span><div><small>MY MEFFORD WORKSPACE</small><h2>{view === "mail" ? "Mail" : "Calendar"}</h2><p>{connected ? `${data.employeeEmail} · Changes sync directly with Microsoft 365` : "Your Microsoft workspace is ready when the owner-approved connection is complete."}</p></div></div>
      <nav className="native-office-switcher"><button className={view === "mail" ? "active" : ""} onClick={() => void switchView("mail")}><AppIcon name="mail" />Mail</button><button className={view === "calendar" ? "active" : ""} onClick={() => void switchView("calendar")}><AppIcon name="calendar" />Calendar</button><a href={directLinks.teams} target="_blank" rel="noreferrer"><AppIcon name="team" />Teams</a></nav>
      <div className="native-office-status"><span className={connected ? "live" : "setup"}><i />{connected ? "LIVE" : "CONNECTION REQUIRED"}</span><a href={view === "mail" ? directLinks.mail : directLinks.calendar} target="_blank" rel="noreferrer">Open In Microsoft 365 ↗</a></div>
    </header>
    {notice ? <div className="native-office-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}
    {data.entra?.configured && !data.entra.verified ? <div className="employee-microsoft-boundary native-auth-boundary"><strong>Verify Your Owner-Approved Microsoft Account</strong><span>Sign in to the Mefford Microsoft tenant as {data.entra.microsoftEmail}. This verifies identity without storing Microsoft access tokens in Command Center.</span><a href={data.entra.connectUrl}>Verify Microsoft Identity</a></div> : null}
    {!connected ? <div className="native-connection-state"><span><AppIcon name={view === "mail" ? "mail" : "calendar"} /></span><small>CONNECTION REQUIRED</small><h3>Your Native {view === "mail" ? "Mailbox" : "Calendar"} Will Appear Here</h3><p>{data.boundary || "IT must complete the owner-approved Microsoft 365 connection before live employee data can load."}</p><code>Mail.ReadWrite · Mail.Send · Calendars.ReadWrite</code><a href={view === "mail" ? directLinks.mail : directLinks.calendar} target="_blank" rel="noreferrer">Use Microsoft 365 Now ↗</a></div> : view === "mail" ? <>
      <div className="native-mail-toolbar"><button className="native-compose-button" onClick={() => setCompose(newCompose())}><AppIcon name="compose" />New Message</button><label><AppIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" /></label><button onClick={() => void load("mail")}><AppIcon name="refresh" />Refresh</button><span>{messages.length} message{messages.length === 1 ? "" : "s"}</span></div>
      <div className="native-mail-shell">
        <aside className="native-folder-pane"><div className="native-folder-heading"><span>FOLDERS</span><button onClick={() => { const name = window.prompt("New Outlook folder name"); if (name?.trim()) void post({ action: "create_folder", folderName: name.trim() }); }}>＋</button></div>{data.folders?.map((folder) => <button key={folder.id} className={folder.id === folderId || folder.displayName.toLowerCase() === folderId ? "active" : ""} onClick={() => void switchFolder(folder.id)}><span><AppIcon name="mail" />{folder.displayName}</span>{folder.unreadItemCount ? <b>{folder.unreadItemCount}</b> : null}</button>)}<footer><span>Mailbox</span><strong>{data.employeeEmail}</strong><small>Authenticated Mefford identity</small></footer></aside>
        <section className="native-message-pane"><header><div><strong>{folderName(data.folders, folderId)}</strong><span>Newest first</span></div><button onClick={() => setQuery("")} disabled={!query}>Clear Search</button></header><div>{messages.map((message) => <button key={message.id} className={`${message.isRead ? "" : "unread"} ${selectedMessage?.id === message.id ? "selected" : ""}`} onClick={() => void openMessage(message)}><i>{senderInitial(message)}</i><span><strong>{senderName(message)}</strong><b>{message.subject || "(No Subject)"}</b><small>{message.bodyPreview || "Open this message to read it."}</small></span><time>{relativeMailTime(message.receivedDateTime)}</time><em>{message.flag?.flagStatus === "flagged" ? "◆" : message.hasAttachments ? "⌕" : ""}</em></button>)}{!messages.length ? <EmptyLivePanel title="No Messages Here" detail={query ? "Try another search." : "This Outlook folder is clear."} /> : null}</div></section>
        <MessageReadingPane message={selectedMessage} busy={Boolean(saving)} onCompose={setCompose} onAction={async (payload) => { const complete = await post(payload); if (complete && ["move_message", "delete_message"].includes(String(payload.action))) setSelectedMessage(null); }} />
      </div>
      {compose ? <MailComposer draft={compose} busy={Boolean(saving)} onChange={setCompose} onAttach={(files) => void addAttachments(files)} onSend={() => void sendCompose()} onClose={() => setCompose(null)} /> : null}
    </> : <>
      <div className="native-calendar-toolbar"><div><button aria-label="Previous month" onClick={() => void moveCalendar(-1)}>‹</button><button onClick={() => { const today = firstOfMonth(new Date()); setCalendarAnchor(today); void load("calendar", folderId, today); }}>Today</button><button aria-label="Next month" onClick={() => void moveCalendar(1)}>›</button><strong>{calendarAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong></div><nav><button className={calendarMode === "month" ? "active" : ""} onClick={() => setCalendarMode("month")}><AppIcon name="grid" />Month</button><button className={calendarMode === "agenda" ? "active" : ""} onClick={() => setCalendarMode("agenda")}><AppIcon name="list" />Agenda</button></nav><button className="native-new-event" onClick={() => setEventDraft(newEventDraft(new Date()))}><AppIcon name="compose" />New Event</button></div>
      <div className="native-calendar-shell">
        <section className="native-calendar-canvas">{calendarMode === "month" ? <><header>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => <span key={day}>{day}</span>)}</header><div className="native-month-grid">{days.map((day) => { const events = eventsByDay.get(dateKey(day)) || []; const currentMonth = day.getMonth() === calendarAnchor.getMonth(); const today = dateKey(day) === dateKey(new Date()); return <article key={day.toISOString()} data-calendar-date={day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} className={`${currentMonth ? "" : "outside"} ${today ? "today" : ""}`} onDoubleClick={() => setEventDraft(newEventDraft(day))}><button className="day-number" onClick={() => setEventDraft(newEventDraft(day))}>{day.getDate()}</button><div>{events.slice(0, 4).map((event) => <button key={event.id} className={event.isOnlineMeeting ? "teams" : ""} onClick={() => setSelectedEvent(event)}><i />{timeOnly(event.start?.dateTime)} <b>{event.subject || "Event"}</b></button>)}{events.length > 4 ? <span>＋{events.length - 4} more</span> : null}</div></article>; })}</div></> : <CalendarAgenda events={data.events || []} onSelect={setSelectedEvent} />}</section>
        <CalendarInspector event={selectedEvent} directLink={directLinks.calendar} onNew={() => setEventDraft(newEventDraft(new Date()))} onEdit={() => selectedEvent && setEventDraft(editEventDraft(selectedEvent))} onDelete={async () => { if (!selectedEvent) return; const removed = await post({ action: "delete_event", eventId: selectedEvent.id }); if (removed) setSelectedEvent(null); }} />
      </div>
      {eventDraft ? <EventComposer draft={eventDraft} busy={Boolean(saving)} onChange={setEventDraft} onSave={() => void saveEvent()} onClose={() => setEventDraft(null)} /> : null}
    </>}
  </section>;
}

function MessageReadingPane({ message, busy, onCompose, onAction }: { message: Message | null; busy: boolean; onCompose: (draft: ComposeDraft) => void; onAction: (payload: Record<string, unknown>) => Promise<void> }) {
  if (!message) return <section className="native-reading-pane empty"><span><AppIcon name="mail" /></span><h3>Select A Message</h3><p>Choose an email to open the full reading panel.</p></section>;
  const sender = message.from?.emailAddress;
  return <section className="native-reading-pane"><header><div className="reading-subject"><small>{message.importance === "high" ? "HIGH IMPORTANCE" : "MESSAGE"}</small><h3>{message.subject || "(No Subject)"}</h3><span>{message.receivedDateTime ? new Date(message.receivedDateTime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span></div><div className="reading-toolbar"><button title="Reply" onClick={() => onCompose(replyDraft(message, "reply"))}><AppIcon name="reply" /></button><button title="Reply all" onClick={() => onCompose(replyDraft(message, "replyAll"))}><AppIcon name="reply" /><b>ALL</b></button><button title="Forward" onClick={() => onCompose(replyDraft(message, "forward"))}><AppIcon name="forward" /></button><button title={message.flag?.flagStatus === "flagged" ? "Clear flag" : "Flag"} disabled={busy} onClick={() => void onAction({ action: "set_flag", messageId: message.id, isRead: message.flag?.flagStatus !== "flagged" })}><AppIcon name="flag" /></button><button title="Archive" disabled={busy} onClick={() => void onAction({ action: "move_message", messageId: message.id, destinationId: "archive" })}><AppIcon name="archive" /></button><button title="Delete" disabled={busy} onClick={() => void onAction({ action: "delete_message", messageId: message.id })}><AppIcon name="trash" /></button></div></header><div className="reading-sender"><i>{senderInitial(message)}</i><span><strong>{sender?.name || sender?.address || "Unknown Sender"}</strong><small>{sender?.address || ""}</small><em>To {recipientLine(message.toRecipients)}</em></span>{message.hasAttachments ? <b><AppIcon name="attach" />Attachments</b> : null}</div><article>{message.body?.content || message.bodyPreview || "This message does not contain a readable text body. Open it in Microsoft 365 to view the original formatting."}</article><footer><button onClick={() => onCompose(replyDraft(message, "reply"))}><AppIcon name="reply" />Reply</button><button onClick={() => onCompose(replyDraft(message, "replyAll"))}><AppIcon name="reply" />Reply All</button><button onClick={() => onCompose(replyDraft(message, "forward"))}><AppIcon name="forward" />Forward</button>{message.webLink ? <a href={message.webLink} target="_blank" rel="noreferrer">Open Original In Outlook ↗</a> : null}</footer></section>;
}

function MailComposer({ draft, busy, onChange, onAttach, onSend, onClose }: { draft: ComposeDraft; busy: boolean; onChange: (draft: ComposeDraft) => void; onAttach: (files: FileList | null) => void; onSend: () => void; onClose: () => void }) {
  const needsRecipients = draft.mode === "new" || draft.mode === "forward";
  return <div className="native-composer-layer" role="presentation"><section className="native-composer" role="dialog" aria-modal="true" aria-label="Compose email"><header><div><AppIcon name="compose" /><strong>{draft.mode === "new" ? "New Message" : draft.mode === "forward" ? "Forward Message" : draft.mode === "replyAll" ? "Reply All" : "Reply"}</strong></div><button aria-label="Close composer" onClick={onClose}>×</button></header>{needsRecipients ? <label><span>To</span><input autoFocus value={draft.recipients} onChange={(event) => onChange({ ...draft, recipients: event.target.value })} placeholder="Name or email address" /></label> : null}{draft.mode === "new" ? <label><span>Subject</span><input value={draft.subject} onChange={(event) => onChange({ ...draft, subject: event.target.value })} placeholder="Add a subject" /></label> : <div className="composer-context"><small>{draft.mode.toUpperCase()}</small><strong>{draft.subject}</strong></div>}<textarea autoFocus={!needsRecipients} value={draft.bodyText} onChange={(event) => onChange({ ...draft, bodyText: event.target.value })} placeholder="Write your message…" />{draft.attachments.length ? <div className="composer-attachments">{draft.attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><AppIcon name="attach" /><b>{attachment.name}</b><small>{fileSize(attachment.size)}</small><button onClick={() => onChange({ ...draft, attachments: draft.attachments.filter((_, itemIndex) => itemIndex !== index) })}>×</button></span>)}</div> : null}<footer>{draft.mode === "new" ? <label className="composer-attach"><input type="file" multiple onChange={(event) => { onAttach(event.target.files); event.currentTarget.value = ""; }} /><AppIcon name="attach" />Attach</label> : null}<small>Sent securely from your Mefford Microsoft 365 mailbox.</small><button className="composer-send" disabled={busy || !draft.bodyText.trim() || (needsRecipients && !parseEmails(draft.recipients).length) || (draft.mode === "new" && !draft.subject.trim())} onClick={onSend}>{busy ? "Sending…" : "Send"}<span>➤</span></button></footer></section></div>;
}

function CalendarAgenda({ events, onSelect }: { events: CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  const groups = groupAgenda(events);
  return <div className="native-agenda-view">{groups.map(([date, items]) => <section key={date}><header><time>{new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</time><span>{items.length} event{items.length === 1 ? "" : "s"}</span></header>{items.map((event) => <button key={event.id} onClick={() => onSelect(event)}><time>{timeOnly(event.start?.dateTime)}<small>{timeOnly(event.end?.dateTime)}</small></time><i /><span><strong>{event.subject || "Calendar Event"}</strong><small>{event.location?.displayName || (event.isOnlineMeeting ? "Microsoft Teams" : "No location")}</small></span>{event.onlineMeeting?.joinUrl ? <em>TEAMS</em> : null}</button>)}</section>)}{!groups.length ? <EmptyLivePanel title="Calendar Clear" detail="No events are scheduled in this period." /> : null}</div>;
}

function CalendarInspector({ event, directLink, onNew, onEdit, onDelete }: { event: CalendarEvent | null; directLink: string; onNew: () => void; onEdit: () => void; onDelete: () => void }) {
  if (!event) return <aside className="calendar-inspector empty"><span><AppIcon name="calendar" /></span><h3>Your Calendar</h3><p>Select an event for details or add something new.</p><button onClick={onNew}>＋ New Event</button></aside>;
  return <aside className="calendar-inspector"><header><small>EVENT DETAILS</small><h3>{event.subject || "Calendar Event"}</h3></header><div className="event-detail-time"><span><b>{event.start?.dateTime ? new Date(event.start.dateTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "Date unavailable"}</b><small>{timeOnly(event.start?.dateTime)} – {timeOnly(event.end?.dateTime)}</small></span></div><dl><div><dt>Location</dt><dd>{event.location?.displayName || (event.isOnlineMeeting ? "Microsoft Teams" : "No location")}</dd></div><div><dt>Organizer</dt><dd>{event.organizer?.emailAddress?.name || event.organizer?.emailAddress?.address || "Mefford Calendar"}</dd></div><div><dt>Attendees</dt><dd>{event.attendees?.length || 0}</dd></div></dl>{event.bodyPreview ? <p>{event.bodyPreview}</p> : null}{event.attendees?.length ? <div className="event-attendees">{event.attendees.slice(0, 8).map((attendee, index) => <span key={`${attendee.emailAddress?.address}-${index}`}><i>{(attendee.emailAddress?.name || attendee.emailAddress?.address || "?").slice(0, 1).toUpperCase()}</i><b>{attendee.emailAddress?.name || attendee.emailAddress?.address}</b><small>{attendee.status?.response || attendee.type || "required"}</small></span>)}</div> : null}<footer>{event.onlineMeeting?.joinUrl ? <a className="join-teams" href={event.onlineMeeting.joinUrl} target="_blank" rel="noreferrer"><AppIcon name="team" />Join Teams</a> : null}<button onClick={onEdit}>Edit</button><button onClick={onDelete}>Delete</button><a href={event.webLink || directLink} target="_blank" rel="noreferrer">Open In Outlook ↗</a></footer></aside>;
}

function EventComposer({ draft, busy, onChange, onSave, onClose }: { draft: EventDraft; busy: boolean; onChange: (draft: EventDraft) => void; onSave: () => void; onClose: () => void }) {
  return <div className="native-composer-layer" role="presentation"><section className="native-event-composer" role="dialog" aria-modal="true" aria-label="Calendar event"><header><div><AppIcon name="calendar" /><strong>{draft.eventId ? "Edit Event" : "New Event"}</strong></div><button aria-label="Close event editor" onClick={onClose}>×</button></header><label><span>Title</span><input autoFocus value={draft.subject} onChange={(event) => onChange({ ...draft, subject: event.target.value })} placeholder="What is happening?" /></label><div className="event-date-fields"><label><span>Starts</span><input type="datetime-local" value={draft.startAt} onChange={(event) => onChange({ ...draft, startAt: event.target.value })} /></label><label><span>Ends</span><input type="datetime-local" value={draft.endAt} onChange={(event) => onChange({ ...draft, endAt: event.target.value })} /></label></div><label><span>Invite People</span><textarea value={draft.attendees} onChange={(event) => onChange({ ...draft, attendees: event.target.value })} placeholder="Emails separated by commas or lines" /></label><label><span>Location</span><input value={draft.location} onChange={(event) => onChange({ ...draft, location: event.target.value })} placeholder="Room, jobsite, or Microsoft Teams" /></label><label><span>Notes</span><textarea value={draft.bodyText} onChange={(event) => onChange({ ...draft, bodyText: event.target.value })} placeholder="Add an agenda or context" /></label><footer><small>Invited attendees receive this from your Mefford mailbox.</small><button disabled={busy || !draft.subject.trim() || !draft.startAt || !draft.endAt} onClick={onSave}>{busy ? "Saving…" : draft.eventId ? "Save Changes" : draft.attendees.trim() ? "Send Invitation" : "Add To Calendar"}</button></footer></section></div>;
}

function EmptyLivePanel({ title, detail }: { title: string; detail: string }) { return <div className="employee-live-empty"><strong>{title}</strong><span>{detail}</span></div>; }

function AppIcon({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    check: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
    compose: <><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M18 9a7 7 0 0 0-12-2l-2 2M6 15a7 7 0 0 0 12 2l2-2" /></>,
    team: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="8" r="2" /><path d="M3 20c0-4 2-6 6-6s6 2 6 6M15 13c4 0 6 2 6 5" /></>,
    reply: <path d="m9 17-6-5 6-5v3h4c5 0 8 3 8 8-2-3-4-4-8-4H9v3Z" />,
    forward: <path d="m15 17 6-5-6-5v3h-4c-5 0-8 3-8 8 2-3 4-4 8-4h4v3Z" />,
    archive: <><path d="M4 7h16v14H4zM3 3h18v4H3zM9 11h6" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    flag: <path d="M5 21V4M5 5h11l-2 4 2 4H5" />,
    attach: <path d="m9 12 6-6a4 4 0 0 1 6 6l-8 8a6 6 0 0 1-9-9l8-8" />,
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

function newCompose(): ComposeDraft { return { mode: "new", messageId: "", recipients: "", subject: "", bodyText: "", attachments: [] }; }
function replyDraft(message: Message, mode: ComposeDraft["mode"]): ComposeDraft { return { mode, messageId: message.id, recipients: "", subject: `${mode === "forward" ? "Fwd:" : "Re:"} ${message.subject || ""}`.replace(/^(Re: ){2,}/i, "Re: "), bodyText: "", attachments: [] }; }
function defaultEvent(start = new Date(Date.now() + 60 * 60_000)) { start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0); const end = new Date(start.getTime() + 60 * 60_000); return { startAt: localInput(start), endAt: localInput(end) }; }
function newEventDraft(date: Date): EventDraft { const start = new Date(date); if (dateKey(start) !== dateKey(new Date())) start.setHours(9, 0, 0, 0); const times = defaultEvent(start); return { eventId: "", subject: "", ...times, location: "", bodyText: "", attendees: "" }; }
function editEventDraft(event: CalendarEvent): EventDraft { return { eventId: event.id, subject: event.subject || "", startAt: localInput(new Date(event.start?.dateTime || Date.now())), endAt: localInput(new Date(event.end?.dateTime || Date.now() + 60 * 60_000)), location: event.location?.displayName || "", bodyText: event.bodyPreview || "", attendees: (event.attendees || []).map((attendee) => attendee.emailAddress?.address).filter(Boolean).join(", ") }; }
function localInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function firstOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function calendarRange(anchor: Date) { const start = new Date(anchor); start.setDate(start.getDate() - start.getDay()); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 42); return { start, end }; }
function calendarDays(anchor: Date) { const { start } = calendarRange(anchor); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }
function groupEvents(events: CalendarEvent[]) { const map = new Map<string, CalendarEvent[]>(); for (const event of events) { if (!event.start?.dateTime) continue; const key = dateKey(new Date(event.start.dateTime)); map.set(key, [...(map.get(key) || []), event]); } return map; }
function groupAgenda(events: CalendarEvent[]) { return [...groupEvents(events).entries()].sort(([a], [b]) => a.localeCompare(b)); }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function longDate(date: Date) { return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); }
function timeOnly(value?: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function dayGreeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; }
function senderName(message: Message) { return message.from?.emailAddress?.name || message.from?.emailAddress?.address || "Unknown Sender"; }
function senderInitial(message: Message) { return senderName(message).slice(0, 1).toUpperCase(); }
function recipientLine(recipients?: EmailAddress[]) { return recipients?.map((recipient) => recipient.emailAddress?.name || recipient.emailAddress?.address).filter(Boolean).join(", ") || "your Mefford mailbox"; }
function relativeMailTime(value?: string) { if (!value) return ""; const date = new Date(value); const sameDay = dateKey(date) === dateKey(new Date()); return sameDay ? timeOnly(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function dueShort(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "No due date" : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${timeOnly(value)}`; }
function workSort(a: MyWorkItem, b: MyWorkItem) { return Number(b.overdue) - Number(a.overdue) || ({ Critical: 3, High: 2, Normal: 1 }[b.priority] - { Critical: 3, High: 2, Normal: 1 }[a.priority]) || String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")); }
function folderName(folders: Folder[] | undefined, id: string) { return folders?.find((folder) => folder.id === id || folder.displayName.toLowerCase() === id)?.displayName || "Mailbox"; }
function parseEmails(value: string) { return [...new Set(value.split(/[,;\n]/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))]; }
function fileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function fileAttachment(file: File) { return new Promise<Attachment>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, contentType: file.type || "application/octet-stream", base64: String(reader.result || "").split(",").pop() || "", size: file.size }); reader.onerror = () => reject(new Error(`${file.name} could not be attached.`)); reader.readAsDataURL(file); }); }
