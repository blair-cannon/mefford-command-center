"use client";

import { useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";

type HealthCategory = { category: string; weight: number; earned: number; lost: number; status: "Green" | "Yellow" | "Red" };
type HealthFactor = { id: string; ruleId: string; category: string; deduction: number; title: string; explanation: string; action: string; owner: string; due: string; critical: boolean; protected: boolean; exceptionActive: boolean };
type HealthProject = {
  project: { number: string; name: string; status: string; site: string; startDate: string; substantialDate: string; finalDate: string; projectManager: string; superintendent: string };
  health: { score: number; color: "Green" | "Yellow" | "Red"; calculatedAt: string; categories: HealthCategory[]; factors: HealthFactor[]; criticalTriggers: HealthFactor[]; recommendations: Array<{ id: string; action: string; owner: string; due: string; priority: string }>; financial?: { revisedBudget: number; forecastCost: number; committedCost: number; overrun: number; overrunThreshold: number; changeExposure: number; forecastProfitCents: number | null; forecastMarginBasisPoints: number | null; forecastPeriodId: string }; financialVisibility?: string };
  exceptions: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
};
type HealthRule = { id: string; name: string; description: string; category: string; protected: boolean; critical?: boolean; enabled?: boolean; source: string; deduction?: number; recordType?: string; statusIncludes?: string; targetRole?: string };
type HealthResponse = {
  actor: { name: string; role: "Owner/Admin" | "Project Manager" | "Superintendent"; canManageRules: boolean; canRequestException: boolean };
  policy: { weights: Record<string, number>; bands: Record<string, string>; permittedAutomation: string[]; prohibitedAutomation: string[]; exceptionMaximumDays: number; criticalOverrides: string[] };
  portfolio: { average: number; counts: { Green: number; Yellow: number; Red: number }; visibleProjects: number; criticalTriggers: number };
  rules: HealthRule[];
  projects: HealthProject[];
};

const categories = ["Financial", "Schedule", "Safety", "Quality", "Project Controls", "Vendor / Procurement", "Closeout"];
const recordTypes = ["Schedule", "RFIs", "Submittals", "Daily Logs", "Toolbox Talks", "Quality Items", "Quality Inspections", "Bid Packages", "Change Orders", "Closeout"];

export function ProjectHealthWorkspace({ initialProjectId = "" }: { initialProjectId?: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [view, setView] = useState<"Scorecard" | "Rules" | "Exceptions" | "History">("Scorecard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [decisionId, setDecisionId] = useState("");
  const [ruleDraft, setRuleDraft] = useState({ name: "", description: "", category: "Project Controls", deduction: "2", recordType: "RFIs", statusIncludes: "", overdueOnly: true, targetRole: "Project Manager", recommendedAction: "" });
  const [exceptionDraft, setExceptionDraft] = useState({ ruleId: "", reason: "", mitigation: "", expiresAt: "" });
  const [decisionDraft, setDecisionDraft] = useState({ decision: "Approved", decisionNote: "" });

  async function load(projectId = "", recalculate = false) {
    setLoading(true); setError("");
    try {
      const response = recalculate
        ? await fetch("/api/project-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalculate", projectId }) })
        : await fetch(`/api/project-health${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { cache: "no-store" });
      const result = await response.json() as HealthResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Project Health Could Not Be Loaded");
      setData(result);
      setSelectedId((current) => current && result.projects.some((item) => item.project.number === current) ? current : result.projects[0]?.project.number || "");
      if (recalculate) setNotice("Health recalculated and permanent history reconciled.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Project Health Could Not Be Loaded"); }
    finally { setLoading(false); }
  }

  useEffect(() => { queueMicrotask(() => void load()); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3200); return () => window.clearTimeout(timer); }, [notice]);

  const selected = useMemo(() => data?.projects.find((item) => item.project.number === selectedId) || data?.projects[0], [data, selectedId]);
  const exceptionRules = (data?.rules || []).filter((rule) => !rule.critical && rule.enabled !== false);

  async function post(payload: Record<string, unknown>, success: string) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/project-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Health Workflow Could Not Be Saved");
      setNotice(success); await load(); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The Health Workflow Could Not Be Saved"); return false; }
    finally { setSaving(false); }
  }

  async function createRule() {
    const saved = await post({ action: "create-rule", ...ruleDraft, deduction: Number(ruleDraft.deduction) }, "Owner/Admin custom rule added to the protected company library.");
    if (saved) { setRuleOpen(false); setRuleDraft({ name: "", description: "", category: "Project Controls", deduction: "2", recordType: "RFIs", statusIncludes: "", overdueOnly: true, targetRole: "Project Manager", recommendedAction: "" }); }
  }

  async function requestException() {
    if (!selected) return;
    const saved = await post({ action: "request-exception", projectId: selected.project.number, ...exceptionDraft }, "Exception request routed to Owner/Admin review.");
    if (saved) { setExceptionOpen(false); setExceptionDraft({ ruleId: "", reason: "", mitigation: "", expiresAt: "" }); }
  }

  async function decideException() {
    if (!selected || !decisionId) return;
    const saved = await post({ action: "decide-exception", projectId: selected.project.number, ruleId: decisionId, ...decisionDraft }, `Exception ${decisionDraft.decision.toLowerCase()} with a permanent audit entry.`);
    if (saved) { setDecisionId(""); setDecisionDraft({ decision: "Approved", decisionNote: "" }); }
  }

  if (loading && !data) return <div className="health-loading"><span /><strong>Calculating Project Health…</strong><p>Financial, schedule, safety, quality, controls, procurement, and closeout signals are being reconciled.</p></div>;
  if (!data) return <div className="health-loading error"><strong>Project Health Is Unavailable</strong><p>{error}</p><button onClick={() => void load()}>Try Again</button></div>;

  return (
    <div className="project-health-workspace">
      {notice ? <div className="health-notice">✓ {notice}</div> : null}
      {error ? <div className="health-error">{error}<button onClick={() => setError("")}>×</button></div> : null}
      <section className="health-hero">
        <div><h1>Project Health & Automation</h1></div>
        <div {...summaryDrilldownProps({ title: "Visible Project Health Portfolio", description: "Every project contributing to the average score and Green, Yellow, or Red count.", rows: data.projects.map((item) => ({ id: item.project.number, title: item.project.name, subtitle: `${item.project.number} · ${item.project.site}`, status: item.health.color, value: `${item.health.score}/100`, meta: item.health.factors[0]?.title || "No active deductions", onOpen: () => { setSelectedId(item.project.number); setView("Scorecard"); }, openLabel: "Open Scorecard →" })) }, "health-portfolio-score")}><small>VISIBLE PORTFOLIO</small><strong>{data.portfolio.average}</strong><span>Average Health Score</span><div><i className="green">{data.portfolio.counts.Green} Green</i><i className="yellow">{data.portfolio.counts.Yellow} Yellow</i><i className="red">{data.portfolio.counts.Red} Red</i></div></div>
      </section>
      <section className="health-policy-strip">
        <div {...summaryDrilldownProps({
          title: "Green Projects",
          rows: data.projects.filter((item) => item.health.color === "Green").map((item) => ({ id: item.project.number, title: item.project.name, subtitle: item.project.number, status: "Green", value: `${item.health.score}/100`, onOpen: () => { setSelectedId(item.project.number); setView("Scorecard"); } })),
        })}><b>90–100</b><span>Green</span></div>
        <div {...summaryDrilldownProps({
          title: "Yellow Projects",
          rows: data.projects.filter((item) => item.health.color === "Yellow").map((item) => ({ id: item.project.number, title: item.project.name, subtitle: item.project.number, status: "Yellow", value: `${item.health.score}/100`, onOpen: () => { setSelectedId(item.project.number); setView("Scorecard"); } })),
        })}><b>75–89</b><span>Yellow</span></div>
        <div {...summaryDrilldownProps({
          title: "Red Projects",
          rows: data.projects.filter((item) => item.health.color === "Red").map((item) => ({ id: item.project.number, title: item.project.name, subtitle: item.project.number, status: "Red", value: `${item.health.score}/100`, meta: item.health.criticalTriggers.map((factor) => factor.title).join(" · ") || item.health.factors[0]?.title, onOpen: () => { setSelectedId(item.project.number); setView("Scorecard"); } })),
        })}><b>&lt; 75</b><span>Red</span></div>
        <div {...summaryDrilldownProps({
          title: "Critical Red Triggers",
          description: "Every protected trigger forcing a project to Red.",
          rows: data.projects.flatMap((item) => item.health.criticalTriggers.map((factor) => ({ id: `${item.project.number}-${factor.id}`, title: factor.title, subtitle: `${item.project.name} · ${item.project.number}`, status: "Critical", meta: `${factor.owner} · Due ${dateLabel(factor.due)}`, onOpen: () => { setSelectedId(item.project.number); setView("Scorecard"); }, openLabel: "Open Project →" }))),
        }, "critical")}><b>{data.portfolio.criticalTriggers}</b><span>Critical Red Triggers</span></div>
        <div><b>{data.actor.role}</b><span>Your Visibility</span></div>
        <button disabled={loading || !selected} onClick={() => void load(selected?.project.number || "", true)}>{loading ? "Reconciling…" : "↻ Recalculate Now"}</button>
      </section>

      <div className="health-layout">
        <aside className="health-project-list">
          <header><span>YOUR PROJECTS</span><b>{data.portfolio.visibleProjects}</b></header>
          {data.projects.map((item) => <button key={item.project.number} className={selected?.project.number === item.project.number ? "selected" : ""} onClick={() => { setSelectedId(item.project.number); setView("Scorecard"); }}><i className={item.health.color.toLowerCase()}>{item.health.score}</i><span><strong>{item.project.name}</strong><small>{item.project.number} · {item.project.site}</small><em>{item.health.factors[0]?.title || "No active deductions"}</em></span><b className={item.health.color.toLowerCase()}>{item.health.color}</b></button>)}
          {!data.projects.length ? <div className="health-empty"><strong>No Assigned Projects</strong><span>Project Managers and Superintendents see only projects assigned to their name.</span></div> : null}
        </aside>

        <section className="health-detail">
          {!selected ? <div className="health-empty large"><strong>No Visible Project Health Records</strong><span>Assign this employee to a project to activate role-filtered health visibility.</span></div> : <>
            <header className="health-detail-header">
              <div><p>{selected.project.number} · {selected.project.status}</p><h2>{selected.project.name}</h2><span>{selected.project.projectManager} · PM &nbsp; | &nbsp; {selected.project.superintendent} · Superintendent</span></div>
              <div className={`health-score ${selected.health.color.toLowerCase()}`}><small>PROJECT HEALTH</small><strong>{selected.health.score}</strong><b>{selected.health.color}</b></div>
            </header>
            {selected.health.criticalTriggers.length ? <div className="health-critical-banner"><b>Critical</b><span>{selected.health.criticalTriggers.map((item) => item.title).join(" · ")}</span></div> : null}
            <nav className="health-tabs">{(["Scorecard", "Rules", "Exceptions", "History"] as const).map((tab) => <button key={tab} className={view === tab ? "active" : ""} onClick={() => setView(tab)}>{tab}{tab === "Exceptions" && selected.exceptions.filter((item) => item.status === "Owner/Admin Review").length ? <i>{selected.exceptions.filter((item) => item.status === "Owner/Admin Review").length}</i> : null}</button>)}</nav>

            {view === "Scorecard" ? <>
              <section className="health-category-grid">{selected.health.categories.map((category) => <article key={category.category}><header><span>{category.category}</span><b className={category.status.toLowerCase()}>{category.earned} / {category.weight}</b></header><div><i style={{ width: `${(category.earned / category.weight) * 100}%` }} className={category.status.toLowerCase()} /></div><small>{category.lost ? `${category.lost} Point${category.lost === 1 ? "" : "s"} Deducted` : "Full Weight Earned"}</small></article>)}</section>
              {selected.health.financial ? <section className="health-financial"><article><span>Revised Budget</span><strong>{money(selected.health.financial.revisedBudget)}</strong></article><article><span>Forecast Cost</span><strong>{money(selected.health.financial.forecastCost)}</strong></article><article><span>Forecast Variance</span><strong className={selected.health.financial.overrun > 0 ? "negative" : ""}>{money(selected.health.financial.overrun)}</strong></article><article><span>Projected Profit</span><strong className={(selected.health.financial.forecastProfitCents ?? 1) <= 0 ? "negative" : ""}>{selected.health.financial.forecastProfitCents === null ? "No WIP Forecast" : money(selected.health.financial.forecastProfitCents / 100)}</strong></article><article><span>Projected Margin</span><strong className={(selected.health.financial.forecastMarginBasisPoints ?? 1_500) < 1_500 ? "negative" : ""}>{selected.health.financial.forecastMarginBasisPoints === null ? "No WIP Forecast" : `${(selected.health.financial.forecastMarginBasisPoints / 100).toFixed(1)}%`}</strong></article><article><span>WIP Period</span><strong>{selected.health.financial.forecastPeriodId || "Not Current"}</strong></article></section> : <div className="health-restricted"><b>Financial Causes Restricted</b><span>Superintendent access includes assigned nonfinancial health details only.</span></div>}
              <section className="health-causes"><header><div><h3>Ranked Causes & Required Actions</h3></div><span>{selected.health.factors.filter((item) => item.deduction > 0).length} Active Deductions</span></header>{selected.health.factors.map((item) => <article key={`${item.id}-${item.title}`} className={item.critical ? "critical" : item.exceptionActive ? "excepted" : ""}><div className="health-deduction"><strong>{item.exceptionActive ? "EX" : item.critical ? "RED" : `−${item.deduction}`}</strong><span>{item.category}</span></div><div><small>{item.protected ? "MEFFORD STANDARD" : "OWNER/ADMIN CUSTOM"}{item.exceptionActive ? " · APPROVED EXCEPTION ACTIVE" : ""}</small><h4>{item.title}</h4><p>{item.explanation}</p><b>{item.action}</b></div><aside><span>RESPONSIBLE</span><strong>{item.owner}</strong><span>DUE</span><b>{dateLabel(item.due)}</b></aside></article>)}{!selected.health.factors.length ? <div className="health-clear"><span>✓</span><div><strong>No Active Health Deductions</strong><p>All measured categories currently earn their full weight.</p></div></div> : null}</section>
            </> : null}

            {view === "Rules" ? <section className="health-rules"><header><div><h3>Protected Standards & Custom Rules</h3></div>{data.actor.canManageRules ? <button onClick={() => setRuleOpen(true)}>＋ Create Custom Rule</button> : null}</header><div className="health-safeguards"><b>PERMITTED</b>{data.policy.permittedAutomation.map((item) => <span key={item}>✓ {item}</span>)}<b>PROHIBITED</b>{data.policy.prohibitedAutomation.map((item) => <span key={item}>× {item}</span>)}</div><div className="health-rule-list">{data.rules.map((rule) => <article key={rule.id}><i className={rule.protected ? "protected" : "custom"}>{rule.protected ? "LOCK" : "CUSTOM"}</i><div><small>{rule.category} · {rule.source}</small><h4>{rule.name}</h4><p>{rule.description}</p>{rule.recordType ? <span>Trigger: {rule.recordType}{rule.statusIncludes ? ` · Status Contains “${rule.statusIncludes}”` : ""}</span> : null}</div><aside>{rule.critical ? <b className="red">FORCES RED</b> : rule.deduction ? <b>−{rule.deduction} POINTS</b> : <b>WEIGHTED STANDARD</b>}{!rule.protected && data.actor.canManageRules ? <button disabled={saving} onClick={() => void post({ action: "set-rule-enabled", ruleId: rule.id, enabled: rule.enabled === false }, `Custom rule ${rule.enabled === false ? "activated" : "deactivated"}.`)}>{rule.enabled === false ? "Activate" : "Deactivate"}</button> : <span>{rule.protected ? "Protected" : rule.enabled === false ? "Inactive" : "Active"}</span>}</aside></article>)}</div></section> : null}

            {view === "Exceptions" ? <section className="health-exceptions"><header><div><h3>Maximum 30 Days · New Reason For Every Renewal</h3></div>{data.actor.canRequestException ? <button onClick={() => setExceptionOpen(true)}>＋ Request Exception</button> : null}</header><div className="health-exception-list">{selected.exceptions.map((item) => <article key={String(item.id)}><i className={String(item.status || "").toLowerCase().replaceAll(" ", "-")}>{String(item.status || "Pending")}</i><div><small>{String(item.ruleName || "Health Rule")}</small><h4>{String(item.reason || "Temporary project exception")}</h4><p>{String(item.mitigation || "Owner/Admin decision and expiration remain permanently reviewable.")}</p><span>Requested By {String(item.requestedBy || "Project Manager")} · Expires {dateLabel(String(item.expiresAt || ""))}</span></div><aside>{item.status === "Owner/Admin Review" && data.actor.canManageRules ? <button onClick={() => { setDecisionId(String(item.id)); setDecisionDraft({ decision: "Approved", decisionNote: "" }); }}>Review Decision</button> : <b>{String(item.status || "")}</b>}</aside></article>)}{!selected.exceptions.length ? <div className="health-empty"><strong>No Rule Exceptions</strong><span>No temporary project exception has been requested.</span></div> : null}</div></section> : null}

            {view === "History" ? <section className="health-history"><header><div><h3>Daily Snapshots & Material Changes</h3></div><b>{selected.history.length} Records</b></header><div>{selected.history.map((item) => <article key={String(item.id)}><time><strong>{new Date(String(item.at || "")).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong><span>{new Date(String(item.at || "")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></time><i className={String(item.color || item.status || "").toLowerCase()}>{String(item.kind || "Health Change")}</i><section><h4>{String(item.summary || item.event || `${item.color || "Health"} · ${item.score || ""}`)}</h4><p>{item.score !== undefined ? `Score ${String(item.score)}/100 · ${String(item.color || "")}` : String(item.status || "Permanent audit event")}</p></section></article>)}{!selected.history.length ? <div className="health-empty"><strong>History Begins With First Reconciliation</strong></div> : null}</div></section> : null}
          </>}
        </section>
      </div>

      {ruleOpen ? <div className="health-modal-layer"><section className="health-modal"><header><div><h2>Create Custom Health Rule</h2></div><button onClick={() => setRuleOpen(false)}>×</button></header><div className="health-form-grid"><label className="wide">Rule Name<input value={ruleDraft.name} onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))} /></label><label className="wide">Purpose & Explanation<textarea rows={3} value={ruleDraft.description} onChange={(event) => setRuleDraft((current) => ({ ...current, description: event.target.value }))} /></label><label>Health Category<select value={ruleDraft.category} onChange={(event) => setRuleDraft((current) => ({ ...current, category: event.target.value }))}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Point Deduction<input type="number" min="1" max={data.policy.weights[ruleDraft.category] || 10} value={ruleDraft.deduction} onChange={(event) => setRuleDraft((current) => ({ ...current, deduction: event.target.value }))} /></label><label>Trigger Record Type<select value={ruleDraft.recordType} onChange={(event) => setRuleDraft((current) => ({ ...current, recordType: event.target.value }))}>{recordTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Status Contains<input value={ruleDraft.statusIncludes} onChange={(event) => setRuleDraft((current) => ({ ...current, statusIncludes: event.target.value }))} placeholder="Optional, e.g. Awaiting" /></label><label>Assign To<select value={ruleDraft.targetRole} onChange={(event) => setRuleDraft((current) => ({ ...current, targetRole: event.target.value }))}><option>Project Manager</option><option>Superintendent</option></select></label><label className="check"><input type="checkbox" checked={ruleDraft.overdueOnly} onChange={(event) => setRuleDraft((current) => ({ ...current, overdueOnly: event.target.checked }))} /><span>Trigger only when matching work is overdue</span></label><label className="wide">Required Action<input value={ruleDraft.recommendedAction} onChange={(event) => setRuleDraft((current) => ({ ...current, recommendedAction: event.target.value }))} /></label></div><footer><button onClick={() => setRuleOpen(false)}>Cancel</button><button className="primary" disabled={saving} onClick={() => void createRule()}>{saving ? "Creating…" : "Create Audited Custom Rule"}</button></footer></section></div> : null}
      {exceptionOpen && selected ? <div className="health-modal-layer"><section className="health-modal"><header><div><h2>Request Temporary Rule Exception</h2></div><button onClick={() => setExceptionOpen(false)}>×</button></header><div className="health-exception-warning"><b>Critical guardrails stay active.</b><span>Approval may pause only a noncritical deduction for up to 30 days. Renewal requires a new request, reason, mitigation, and Owner/Admin approval.</span></div><div className="health-form-grid"><label className="wide">Company Rule<select value={exceptionDraft.ruleId} onChange={(event) => setExceptionDraft((current) => ({ ...current, ruleId: event.target.value }))}><option value="">Select A Noncritical Rule</option>{exceptionRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.category}</option>)}</select></label><label className="wide">Specific Reason<textarea rows={4} value={exceptionDraft.reason} onChange={(event) => setExceptionDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain the project-specific condition; a general ‘not applicable’ is not sufficient." /></label><label className="wide">Mitigation While Exception Is Active<textarea rows={4} value={exceptionDraft.mitigation} onChange={(event) => setExceptionDraft((current) => ({ ...current, mitigation: event.target.value }))} /></label><label>Requested Expiration<input type="date" value={exceptionDraft.expiresAt} onChange={(event) => setExceptionDraft((current) => ({ ...current, expiresAt: event.target.value }))} /></label></div><footer><button onClick={() => setExceptionOpen(false)}>Cancel</button><button className="primary" disabled={saving} onClick={() => void requestException()}>{saving ? "Routing…" : "Route To Owner/Admin"}</button></footer></section></div> : null}
      {decisionId ? <div className="health-modal-layer"><section className="health-modal decision"><header><div><h2>Decide Rule Exception</h2></div><button onClick={() => setDecisionId("")}>×</button></header><div className="health-form-grid"><label>Decision<select value={decisionDraft.decision} onChange={(event) => setDecisionDraft((current) => ({ ...current, decision: event.target.value }))}><option>Approved</option><option>Rejected</option></select></label><label className="wide">Decision Note<textarea rows={5} value={decisionDraft.decisionNote} onChange={(event) => setDecisionDraft((current) => ({ ...current, decisionNote: event.target.value }))} placeholder="State the basis, conditions, and required follow-up." /></label></div><footer><button onClick={() => setDecisionId("")}>Cancel</button><button className="primary" disabled={saving} onClick={() => void decideException()}>{saving ? "Recording…" : `Record ${decisionDraft.decision}`}</button></footer></section></div> : null}
    </div>
  );
}

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
function dateLabel(value: string) { if (!value) return "Not Set"; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
