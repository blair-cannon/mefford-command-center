"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type DisplayRow = { id: string; title: string; subtitle: string; status: string; value?: string };
type DisplayMetric = { label: string; value: string; detail: string; tone?: "good" | "warn" | "risk"; rows: DisplayRow[] };
type DisplayReview = { id: string; rating: number; stars: string; respondent: string; project: string; milestone: string; comment: string; photoUrls: string[]; displayConsent: boolean; displaySeconds: 5 | 30; responseDate: string };
type DisplayDashboard = { id: string; title: string; eyebrow: string; metrics: DisplayMetric[]; sections: Array<{ title: string; rows: DisplayRow[] }>; reviews?: DisplayReview[] };
type DisplayPayload = { account: string; readOnly: true; generatedAt: string; refreshSeconds: number; dashboards: DisplayDashboard[] };

const dashboardOrder = ["customer-reviews", "sales", "project-health", "marketing", "estimating", "company-health"];

export function DashboardDisplay() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [payload, setPayload] = useState<DisplayPayload | null>(null);
  const [selectedId, setSelectedId] = useState("company-health");
  const [report, setReport] = useState<{ title: string; rows: DisplayRow[] } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(() => typeof window === "undefined" ? 0 : Number(window.localStorage.getItem("mefford-review-cycle-index") || 0));

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard-display", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); setPayload(null); return; }
    const result = await response.json() as DisplayPayload & { error?: string };
    if (!response.ok) { setError(result.error || "The dashboard display could not be loaded."); return; }
    setAuthenticated(true); setPayload(result); setError("");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [authenticated, load]);
  const selectedReviews = useMemo(() => payload?.dashboards.find((dashboard) => dashboard.id === "customer-reviews")?.reviews || [], [payload]);
  useEffect(() => {
    if (selectedId !== "customer-reviews" || !selectedReviews.length) return;
    const current = selectedReviews[reviewIndex % selectedReviews.length];
    const timer = window.setTimeout(() => setReviewIndex((index) => { const next = (index + 1) % selectedReviews.length; window.localStorage.setItem("mefford-review-cycle-index", String(next)); return next; }), Math.max(5, current.displaySeconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [selectedId, selectedReviews, reviewIndex]);

  async function login(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError("");
    const response = await fetch("/api/dashboard-display-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", email: "dashboards@meffcon.com", password }) });
    const result = await response.json() as { error?: string };
    setWorking(false);
    if (!response.ok) { setError(result.error || "Dashboard login failed."); return; }
    setPassword(""); await load();
  }

  async function logout() {
    await fetch("/api/dashboard-display-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setPayload(null); setAuthenticated(false); setReport(null);
  }

  if (authenticated === null) return <main className="dashboard-display-login"><section><img src="/mefford-logo.png" alt="Mefford Contracting" /><span>Opening dashboard display…</span></section></main>;
  if (!authenticated) return <main className="dashboard-display-login"><form onSubmit={login}><img src="/mefford-logo.png" alt="Mefford Contracting" /><p>COMMAND CENTER DISPLAY</p><h1>Read-Only Dashboards</h1><label><span>Display Account</span><input value="dashboards@meffcon.com" readOnly /></label><label><span>Password</span><input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error ? <div role="alert">{error}</div> : null}<button disabled={working || !password}>{working ? "Signing In…" : "Open Dashboards"}</button><small>The Company Owner controls this password from Admin → Team &amp; Access.</small></form></main>;

  const selected = payload?.dashboards.find((dashboard) => dashboard.id === selectedId) || payload?.dashboards[0];
  return <main className="dashboard-display-shell">
    <header className="dashboard-display-header"><div><img src="/mefford-logo.png" alt="Mefford Contracting" /><span><b>MEFFORD CONTRACTING</b><small>COMMAND CENTER · READ ONLY</small></span></div><nav aria-label="Choose dashboard">{dashboardOrder.map((id) => { const dashboard = payload?.dashboards.find((item) => item.id === id); return dashboard ? <button key={id} className={selected?.id === id ? "active" : ""} onClick={() => { setSelectedId(id); setReport(null); }}>{dashboard.title.replace(" Dashboard", "")}</button> : null; })}</nav><button onClick={() => void logout()}>Log Out</button></header>
    {selected ? <section className="dashboard-display-content"><header><div><p>{selected.eyebrow}</p><h1>{selected.title}</h1></div><aside><i />LIVE <span>Updated {new Date(payload?.generatedAt || "").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></aside></header>
      <section className="dashboard-display-metrics">{selected.metrics.map((metric) => <button key={metric.label} className={metric.tone || ""} onClick={() => setReport({ title: metric.label, rows: metric.rows })}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small><b>OPEN {metric.rows.length} RECORD{metric.rows.length === 1 ? "" : "S"} →</b></button>)}</section>
      {selected.id === "customer-reviews" && !report ? <CustomerReviewStage review={selectedReviews[reviewIndex % Math.max(1, selectedReviews.length)]} index={reviewIndex} total={selectedReviews.length} /> : <section className="dashboard-display-sections">{(report ? [report] : selected.sections).map((section) => <article key={section.title}><header><h2>{section.title}</h2><span>{section.rows.length} RECORD{section.rows.length === 1 ? "" : "S"}</span>{report ? <button onClick={() => setReport(null)}>Close Report ×</button> : null}</header><div>{section.rows.map((row) => <div key={row.id}><span><strong>{row.title}</strong><small>{row.subtitle}</small></span><i className={tone(row.status)}>{row.status}</i>{row.value ? <b>{row.value}</b> : null}</div>)}{!section.rows.length ? <p>Nothing currently matches this report.</p> : null}</div></article>)}</section>}
    </section> : null}
  </main>;
}

function CustomerReviewStage({ review, index, total }: { review?: DisplayReview; index: number; total: number }) {
  if (!review) return <section className="customer-review-stage empty"><div><span>★★★★★</span><h2>Customer reviews will appear here automatically.</h2><p>Every verified response will count in the totals above.</p></div></section>;
  return <section className={`customer-review-stage ${review.rating >= 4 ? "featured" : "transparent"}`}><div className="customer-review-copy"><header><span>{review.stars}</span><strong>{review.rating.toFixed(1)} / 5</strong></header><blockquote>{review.comment ? `“${review.comment}”` : "Rating recorded. The customer chose to keep their written details private."}</blockquote><footer><div><strong>{review.respondent}</strong><span>{review.project} · {review.milestone}</span></div><small>REVIEW {index % total + 1} OF {total} · {review.displaySeconds} SECONDS</small></footer></div>{review.photoUrls.length ? <div className="customer-review-photos">{review.photoUrls.slice(0, 4).map((url, photoIndex) => <img key={url} src={url} alt={`${review.project} customer photo ${photoIndex + 1}`} />)}</div> : null}<div className="customer-review-progress" key={`${review.id}-${index}`} style={{ animationDuration: `${review.displaySeconds}s` }} /></section>;
}

function tone(status: string) {
  const value = status.toLowerCase();
  if (/red|late|missing|overdue|blocked|failed/.test(value)) return "risk";
  if (/yellow|pending|review|draft|open/.test(value)) return "warn";
  if (/green|filed|connected|complete|published|awarded/.test(value)) return "good";
  return "";
}
