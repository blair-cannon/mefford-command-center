"use client";

import { useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";
import type { OperatingOutcome, OperatingRole } from "../lib/operating-doctrine";
import { nextWorkStep, workActionLabel } from "../lib/workspace-usability";

export type MyWorkItem = {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  message: string;
  priority: "Normal" | "High" | "Critical";
  status: "Open" | "Acknowledged" | "Snoozed" | "Completed";
  sourceType: string;
  sourceRecordId: string;
  actionTarget: string;
  dueAt?: string | null;
  snoozedUntil?: string | null;
  createdAt: string;
  isRead: boolean;
  overdue: boolean;
  dueSoon: boolean;
  hiddenBySnooze: boolean;
  escalationLevel: number;
  createdBy: string;
  accountableRole: OperatingRole;
  operatingOutcome: OperatingOutcome;
  roleMission: string;
  businessImpact: string;
  ownerEscalationReason: string;
  auditHistory: Array<{ action: string; actorName: string; detail: string; createdAt: string }>;
};

type Preferences = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  digestMode: string;
};

type MyWorkResponse = {
  items: MyWorkItem[];
  preferences: Preferences;
  delivery: { status: string; detail: string; pushStatus?: string; pushDetail?: string };
  policy: {
    channels: string[];
    dueReminder: string;
    morningDigest?: string;
    escalation: string;
    externalDelivery: string;
    invoiceSafeguard: string;
  };
  error?: string;
};

function dueLabel(value?: string | null) {
  if (!value) return "No Due Date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No Due Date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function nextSnooze(hours: number) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function workdayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function MyWorkWorkspace({
  actor,
  onOpenItem,
  onItemsChange,
}: {
  actor: { name: string; accessLevel?: string; designations?: string[] };
  onOpenItem: (item: MyWorkItem) => void;
  onItemsChange?: (items: MyWorkItem[]) => void;
}) {
  const [data, setData] = useState<MyWorkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"Open" | "Due Soon" | "Overdue" | "Snoozed" | "Completed">("Open");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState<Preferences | null>(null);

  async function load() {
    const response = await fetch("/api/my-work");
    const result = (await response.json()) as MyWorkResponse;
    if (!response.ok) throw new Error(result.error || "My Work Is Unavailable.");
    setData(result);
    setPreferenceDraft(result.preferences);
    onItemsChange?.(result.items);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my-work")
      .then(async (response) => {
        const result = (await response.json()) as MyWorkResponse;
        if (!response.ok) throw new Error(result.error || "My Work Is Unavailable.");
        return result;
      })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setPreferenceDraft(result.preferences);
        onItemsChange?.(result.items);
        const reconciliationKey = "mefford-my-work-last-reconciled";
        let lastReconciledAt = 0;
        try { lastReconciledAt = Number(sessionStorage.getItem(reconciliationKey) || 0); } catch { /* Reconciliation still runs when browser storage is unavailable. */ }
        if (Date.now() - lastReconciledAt < 5 * 60_000) return;
        try { sessionStorage.setItem(reconciliationKey, String(Date.now())); } catch { /* The server remains the durable source of truth. */ }
        void fetch("/api/my-work", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reconcile" }),
        })
          .then(async (response) => {
            const reconciled = (await response.json()) as MyWorkResponse;
            if (!response.ok) throw new Error(reconciled.error || "My Work reconciliation is pending.");
            return reconciled;
          })
          .then((reconciled) => {
            if (cancelled) return;
            setData(reconciled);
            setPreferenceDraft(reconciled.preferences);
            onItemsChange?.(reconciled.items);
          })
          .catch(() => {
            try { sessionStorage.removeItem(reconciliationKey); } catch { /* A later page load can retry. */ }
          });
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "My Work Is Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [onItemsChange]);

  const counts = useMemo(() => {
    const items = data?.items || [];
    return {
      open: items.filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).length,
      dueSoon: items.filter((item) => item.status !== "Completed" && item.dueSoon && !item.hiddenBySnooze).length,
      overdue: items.filter((item) => item.status !== "Completed" && item.overdue).length,
      approvals: items.filter((item) => item.status !== "Completed" && /approval|activate/i.test(`${item.kind} ${item.title}`)).length,
      unread: items.filter((item) => item.status !== "Completed" && !item.isRead).length,
    };
  }, [data]);

  const filtered = useMemo(() => (data?.items || []).filter((item) => {
    if (filter === "Completed") return item.status === "Completed";
    if (filter === "Snoozed") return item.status === "Snoozed" && item.hiddenBySnooze;
    if (filter === "Overdue") return item.status !== "Completed" && item.overdue;
    if (filter === "Due Soon") return item.status !== "Completed" && item.dueSoon && !item.hiddenBySnooze;
    return item.status !== "Completed" && !item.hiddenBySnooze;
  }), [data, filter]);

  async function itemAction(item: MyWorkItem, action: "read" | "acknowledge" | "complete" | "snooze", snoozedUntil?: string) {
    setSaving(`${item.id}:${action}`);
    setNotice("");
    try {
      const response = await fetch("/api/my-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, action, snoozedUntil }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Work Item Could Not Be Updated.");
      await load();
      setNotice(action === "snooze" ? "Work Item Snoozed." : action === "complete" ? (item.sourceType === "Meeting Action" ? "Assignment Completed." : "Notice Dismissed. The Source Record Is Unchanged.") : "Work Item Acknowledged.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Work Item Could Not Be Updated.");
    } finally {
      setSaving("");
    }
  }

  async function openItem(item: MyWorkItem) {
    if (!item.isRead) await itemAction(item, "read");
    onOpenItem(item);
  }

  async function savePreferenceChanges() {
    if (!preferenceDraft) return;
    setSaving("preferences");
    try {
      const response = await fetch("/api/my-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_preferences", preferences: preferenceDraft }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Notification Preferences Could Not Be Saved.");
      await load();
      setPreferencesOpen(false);
      setNotice("Notification Preferences Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Notification Preferences Could Not Be Saved.");
    } finally {
      setSaving("");
    }
  }

  if (loading) return <div className="my-work-loading">Building {actor.name.split(" ")[0]}&apos;s Personal Work Queue...</div>;

  return <div className="my-work-workspace">
    <section className="my-work-hero"><div><h1>My Tasks</h1><small>{workdayLabel()} · {actor.name}</small></div><div className="my-work-hero-actions"><button className="secondary-action" onClick={() => void load().catch((error) => setNotice(error instanceof Error ? error.message : "Your tasks could not be refreshed."))}>Refresh Tasks</button><button className="secondary-action" onClick={() => setPreferencesOpen(true)}>Notification Settings</button></div></section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <section className="my-work-summary">
      <article {...summaryDrilldownProps({ title: "Open Personal Work", rows: (data?.items || []).filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).map((item) => workSummaryRow(item, openItem)) })}><span>OPEN TASKS</span><strong>{counts.open}</strong><small>Active assignments and notices</small></article>
      <article {...summaryDrilldownProps({ title: "Work Due In The Next 72 Hours", rows: (data?.items || []).filter((item) => item.status !== "Completed" && item.dueSoon && !item.hiddenBySnooze).map((item) => workSummaryRow(item, openItem)) })}><span>DUE SOON</span><strong>{counts.dueSoon}</strong><small>Next 72 Hours</small></article>
      <article {...summaryDrilldownProps({ title: "Overdue Personal Work", rows: (data?.items || []).filter((item) => item.status !== "Completed" && item.overdue).map((item) => workSummaryRow(item, openItem)) }, counts.overdue ? "risk" : "")}><span>OVERDUE</span><strong>{counts.overdue}</strong><small>Past Their Due Date</small></article>
      <article {...summaryDrilldownProps({ title: "Approvals Waiting On You", rows: (data?.items || []).filter((item) => item.status !== "Completed" && /approval|activate/i.test(`${item.kind} ${item.title}`)).map((item) => workSummaryRow(item, openItem)) })}><span>APPROVALS</span><strong>{counts.approvals}</strong><small>Decisions Waiting On You</small></article>
      <article {...summaryDrilldownProps({ title: "Unread Operational Notices", rows: (data?.items || []).filter((item) => item.status !== "Completed" && !item.isRead).map((item) => workSummaryRow(item, openItem)) })}><span>UNREAD</span><strong>{counts.unread}</strong><small>New Operational Notices</small></article>
    </section>
    <section className="my-work-panel"><header><div><h2>Your Active Work</h2></div><div className="my-work-tabs">{(["Open", "Due Soon", "Overdue", "Snoozed", "Completed"] as const).map((tab) => <button key={tab} className={filter === tab ? "active" : ""} onClick={() => setFilter(tab)}>{tab}</button>)}</div></header>
      <div className="my-work-list">{filtered.map((item) => <article key={item.id} className={`${item.isRead ? "" : "unread"} ${item.overdue ? "overdue" : ""} priority-${item.priority.toLowerCase()}`}>
        <div className="work-copy"><div className="work-state"><b className={item.priority !== "Normal" ? "urgent" : ""}>{item.priority}</b><span>{item.kind}</span>{item.escalationLevel ? <b className="urgent">Escalated</b> : null}</div><h3>{item.title}</h3><p>{item.message}</p><small>{item.projectId}{item.sourceRecordId ? ` · ${item.sourceRecordId}` : ""}</small><div className="work-state">{nextWorkStep(item)}</div></div>
        <div className="work-due"><span>{item.overdue ? "Overdue" : item.dueSoon ? "Due Soon" : "Due"}</span><strong>{dueLabel(item.dueAt)}</strong>{item.snoozedUntil ? <small>Snoozed Until {dueLabel(item.snoozedUntil)}</small> : null}</div>
        <div className="work-actions"><button className="primary-action" onClick={() => void openItem(item)}>{workActionLabel(item)}</button><details><summary>More Actions</summary>{item.status === "Open" ? <button disabled={Boolean(saving)} onClick={() => void itemAction(item, "acknowledge")}>{item.sourceType === "Meeting Action" ? "Accept Assignment" : "Acknowledge"}</button> : null}<select aria-label={`Snooze ${item.title}`} value="" disabled={Boolean(saving)} onChange={(event) => { if (event.target.value) void itemAction(item, "snooze", nextSnooze(Number(event.target.value))); }}><option value="">Snooze…</option><option value="1">1 Hour</option><option value="24">Tomorrow</option><option value="168">One Week</option></select>{["Notification", "Escalation", "Meeting Action"].includes(item.sourceType) ? <button disabled={Boolean(saving)} onClick={() => void itemAction(item, "complete")}>{item.sourceType === "Meeting Action" ? "Mark Assignment Complete" : "Dismiss Notice"}</button> : null}</details></div>
        <details className="work-audit"><summary>Details &amp; History</summary><p>{item.businessImpact}</p><p>Assigned By {item.createdBy || "Command Center"} · {item.accountableRole}</p>{item.escalationLevel >= 3 ? <p>{item.ownerEscalationReason}</p> : null}{item.auditHistory.map((audit, index) => <small key={`${audit.createdAt}-${index}`}><b>{audit.action}</b> · {audit.actorName} · {new Date(audit.createdAt).toLocaleString("en-US")}{audit.detail ? ` · ${audit.detail}` : ""}</small>)}</details>
      </article>)}{!filtered.length ? <div className="empty-attention-state"><strong>No {filter} Tasks</strong><span>New assignments will appear here.</span></div> : null}</div>
    </section>
    {preferencesOpen && preferenceDraft ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreferencesOpen(false)}><section className="record-modal my-work-settings" role="dialog" aria-modal="true" aria-label="Notification Settings"><div className="modal-heading"><div><p className="eyebrow orange-text">DELIVERY CONTROLS</p><h2>Notification Settings</h2></div><button aria-label="Close Notification Settings" onClick={() => setPreferencesOpen(false)}>×</button></div><div className="form-rule"><strong>Required Morning Email:</strong> Every activated user receives a 6:00 AM local summary seven days a week. The tone reflects current, overdue, and stale work.</div><label className="setting-toggle"><span><strong>In-App Notifications</strong><small>Keep durable read and unread alerts inside Command Center.</small></span><input type="checkbox" checked={preferenceDraft.inAppEnabled} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, inAppEnabled: event.target.checked })} /></label><label className="setting-toggle"><span><strong>Additional Operational Email</strong><small>Controls individual assignment notices outside the required morning summary. Invoice documents are never sent.</small></span><input type="checkbox" checked={preferenceDraft.emailEnabled} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, emailEnabled: event.target.checked })} /></label><label className="setting-toggle"><span><strong>Quiet Hours</strong><small>Hold non-critical individual emails and pushes during the selected hours; critical escalations and the 6:00 AM summary remain active.</small></span><input type="checkbox" checked={preferenceDraft.quietHoursEnabled} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, quietHoursEnabled: event.target.checked })} /></label>{preferenceDraft.quietHoursEnabled ? <div className="field-grid"><label className="field-label">Quiet Start<input type="time" value={preferenceDraft.quietStart} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, quietStart: event.target.value })} /></label><label className="field-label">Quiet End<input type="time" value={preferenceDraft.quietEnd} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, quietEnd: event.target.value })} /></label></div> : null}<label className="field-label">Additional Delivery Rhythm<select value={preferenceDraft.digestMode} onChange={(event) => setPreferenceDraft({ ...preferenceDraft, digestMode: event.target.value })}><option>Immediate</option><option>Daily Digest</option></select></label><div className="form-rule"><strong>Email Connection:</strong> {data?.delivery.detail}<br /><strong>Push Connection:</strong> {data?.delivery.pushDetail || "Enable push from Mobile Device Security on an installed phone or tablet."}</div><div className="modal-actions"><button className="secondary-action" onClick={() => setPreferencesOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving === "preferences"} onClick={() => void savePreferenceChanges()}>{saving === "preferences" ? "Saving..." : "Save Notification Settings"}</button></div></section></div> : null}
  </div>;
}

function workSummaryRow(item: MyWorkItem, openItem: (item: MyWorkItem) => Promise<void>) {
  return { id: item.id, title: item.title, subtitle: `${item.kind} · ${item.projectId}`, status: item.overdue ? "Overdue" : item.dueSoon ? "Due Soon" : item.status, meta: `${item.priority} · ${dueLabel(item.dueAt)}`, onOpen: () => void openItem(item), openLabel: workActionLabel(item) };
}
