"use client";

import { useEffect, useState } from "react";

type Status = { email: string; configured: boolean; updatedAt: string; updatedBy: string; route: string };

export function DashboardDisplayAccessControl() {
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/dashboard-display-auth?scope=owner", { cache: "no-store" });
    if (response.ok) setStatus(await response.json() as Status);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setNotice("");
    const response = await fetch("/api/dashboard-display-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-password", password, confirmation }) });
    const result = await response.json() as { error?: string };
    setSaving(false);
    if (!response.ok) { setNotice(result.error || "The dashboard password could not be saved."); return; }
    setPassword(""); setConfirmation(""); setNotice("Dashboard password saved. All prior display sessions were logged out."); await load();
  }

  return <section className="dashboard-access-control"><header><div><small>OWNER-CONTROLLED DISPLAY ACCOUNT</small><h2>Company Dashboard Screens</h2></div><a href="/dashboard-display" target="_blank" rel="noreferrer">Open Display Login ↗</a></header><div className="dashboard-access-account"><span><b>PERMANENT LOGIN</b><strong>{status?.email || "dashboards@meffcon.com"}</strong><small>Sales · Project Health · Marketing · Estimating · Company Health</small></span><i className={status?.configured ? "ready" : "pending"}>{status?.configured ? "PASSWORD SET" : "PASSWORD REQUIRED"}</i></div><form onSubmit={save}><label><span>{status?.configured ? "New Password" : "Password"}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label><span>Confirm Password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button disabled={saving || password.length < 12 || password !== confirmation}>{saving ? "Saving…" : status?.configured ? "Reset Display Password" : "Set Display Password"}</button></form>{notice ? <p role="status">{notice}</p> : null}<footer>Read-only dashboard data only. This login cannot open files, employee records, approvals, accounting detail, or any editing workflow.{status?.updatedAt ? ` Last changed ${new Date(status.updatedAt).toLocaleString("en-US")} by ${status.updatedBy}.` : ""}</footer></section>;
}
