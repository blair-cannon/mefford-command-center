"use client";

import { useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";

type Actor = { name: string; accessLevel: string };
type Metric = { key: string; label: string; category: string; weight: number; score: number | null; confidence: string; evidenceCount: number; detail: string; sourceIds: string[]; policy: string };
type Scorecard = { employee: { email: string; name: string; accessLevel: string; designations: string[] }; quarter: string; periodStart: string; periodEnd: string; systemScore: number | null; grade: string; evidenceCoverage: number; metrics: Metric[]; assignedProjects: Array<{ number: string; name: string; role: string }>; evidenceGaps: string[]; generatedAt: string; policy: string };
type AiAnalysis = { balancedSummary?: string; verifiedStrengths?: string[]; improvementAreas?: string[]; evidenceGaps?: string[]; coachingQuestions?: string[]; suggestedQuarterGoals?: string[]; ownerCautions?: string[]; model?: string; generatedAt?: string };
type OwnerReview = { ownerSummary?: string; accomplishments?: string; coaching?: string; goals?: string; adjustment?: number; adjustmentReason?: string; finalScore?: number | null; finalGrade?: string; reviewedBy?: string; reviewedAt?: string; finalizedAt?: string };
type StoredReview = { id: string; title: string; owner: string; due: string; status: string; meta: string; updatedAt: string; data: Scorecard & { aiAnalysis?: AiAnalysis | null; ownerReview?: OwnerReview | null } };
type PerformanceResponse = { quarter: string; period: { start: string; end: string }; permissions: { ownerOnly: boolean }; governance: { visibility: string; finalAuthority: string; aiBoundary: string; fairness: string; missingData: string }; scorecards: Scorecard[]; reviews: StoredReview[]; automation: Record<string, string>; openai: { configured: boolean; provider: string; model: string; role: string }; error?: string };

const emptyReview = { ownerSummary: "", accomplishments: "", coaching: "", goals: "", adjustment: "0", adjustmentReason: "" };

export function PerformanceReviewsWorkspace({ actor }: { actor: Actor }) {
  const [quarter, setQuarter] = useState(currentQuarter());
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(emptyReview);

  async function load(nextQuarter = quarter, preferredEmail = selectedEmail) {
    const response = await fetch(`/api/performance-reviews?quarter=${encodeURIComponent(nextQuarter)}`);
    const result = await response.json() as PerformanceResponse;
    if (!response.ok) throw new Error(result.error || "The Owner Performance Center Is Unavailable");
    setData(result);
    const nextEmail = preferredEmail && result.scorecards.some((item) => item.employee.email === preferredEmail) ? preferredEmail : result.scorecards[0]?.employee.email || "";
    setSelectedEmail(nextEmail);
    setDraft(reviewDraft(result.reviews.find((item) => item.data.employee.email === nextEmail)?.data.ownerReview));
  }

  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { void fetch(`/api/performance-reviews?quarter=${encodeURIComponent(quarter)}`).then(async (response) => { const result = await response.json() as PerformanceResponse; if (!response.ok) throw new Error(result.error || "The Owner Performance Center Is Unavailable"); if (cancelled) return; const email = result.scorecards[0]?.employee.email || ""; setData(result); setSelectedEmail(email); setDraft(reviewDraft(result.reviews.find((item) => item.data.employee.email === email)?.data.ownerReview)); }).catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "The Owner Performance Center Is Unavailable")); }, 0); return () => { cancelled = true; window.clearTimeout(timer); }; }, [quarter]);

  const selected = data?.scorecards.find((item) => item.employee.email === selectedEmail);
  const stored = data?.reviews.find((item) => item.data.employee.email === selectedEmail);
  const roster = useMemo(() => (data?.scorecards || []).filter((item) => `${item.employee.name} ${item.employee.email} ${item.employee.designations.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [data?.scorecards, query]);
  const scored = (data?.scorecards || []).filter((item) => item.systemScore !== null);
  const averageScore = scored.length ? Math.round(scored.reduce((sum, item) => sum + (item.systemScore || 0), 0) / scored.length) : null;
  const averageCoverage = data?.scorecards.length ? Math.round(data.scorecards.reduce((sum, item) => sum + item.evidenceCoverage, 0) / data.scorecards.length) : 0;

  async function act(action: "generate-cycle" | "generate-ai-analysis" | "save-owner-review", extra: Record<string, unknown> = {}) {
    setSaving(action); setNotice("");
    try {
      const response = await fetch("/api/performance-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, quarter, reviewId: stored?.id, ...extra }) });
      const result = await response.json() as { error?: string; generated?: number; retainedFinal?: number; status?: string };
      if (!response.ok) throw new Error(result.error || "The Performance Review Action Could Not Be Completed");
      await load();
      setNotice(action === "generate-cycle" ? `${result.generated || 0} quarterly review(s) generated or refreshed · ${result.retainedFinal || 0} finalized review(s) preserved.` : action === "generate-ai-analysis" ? "ChatGPT created a structured evidence draft without changing any score or making an employment decision." : result.status === "Finalized" ? "Owner review finalized and permanently locked." : "Owner review draft saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Performance Review Action Could Not Be Completed"); }
    finally { setSaving(""); }
  }

  function save(finalize: boolean) {
    if (!stored) { setNotice("Generate the quarter review records before saving owner notes."); return; }
    if (finalize && !window.confirm("Finalize and permanently lock this quarterly review? The evidence and owner decision will become immutable.")) return;
    void act("save-owner-review", { ...draft, adjustment: Number(draft.adjustment || 0), finalize });
  }

  if (!data) return <div className="performance-loading"><span />{notice || "Preparing the owner-only quarterly review center…"}</div>;

  return <div className="performance-workspace">
    {notice ? <div className={/could not|required|unavailable|generate the/i.test(notice) ? "form-error" : "inline-success"}>{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
    <section className="performance-hero">
      <div><h1>Company Performance Center</h1><span>Prepared for {actor.name}. Role-specific results, project health, customer voice, safety, financial execution, and IT service evidence—reviewed by a human owner.</span></div>
      <div className="performance-cycle"><label>Review Quarter<select value={quarter} onChange={(event) => setQuarter(event.target.value)}>{quarterOptions().map((item) => <option key={item}>{item}</option>)}</select></label><button disabled={Boolean(saving)} onClick={() => void act("generate-cycle")}>{saving === "generate-cycle" ? "Building Evidence…" : "Generate / Refresh Cycle"}</button></div>
    </section>

    <section className="performance-stats">
      <article {...summaryDrilldownProps({ title: "Active Employees", description: "Every live company member included in this quarter's roster.", rows: data.scorecards.map((item) => ({ id: item.employee.email, title: item.employee.name, subtitle: item.employee.designations.join(" · ") || item.employee.accessLevel, status: data.reviews.find((review) => review.data.employee.email === item.employee.email)?.status || "Live Preview", value: item.systemScore === null ? "—" : `${item.systemScore}`, meta: `${item.evidenceCoverage}% evidence coverage`, onOpen: () => { const review = data.reviews.find((candidate) => candidate.data.employee.email === item.employee.email); setSelectedEmail(item.employee.email); setDraft(reviewDraft(review?.data.ownerReview)); }, openLabel: "Open Review →" })) })}><span>ACTIVE EMPLOYEES</span><strong>{data.scorecards.length}</strong><small>All live company members</small></article>
      <article {...summaryDrilldownProps({ title: "System Scores", description: "Every employee with a system score contributing to the average.", rows: scored.map((item) => ({ id: item.employee.email, title: item.employee.name, subtitle: item.employee.designations.join(" · ") || item.employee.accessLevel, status: item.grade, value: `${item.systemScore}`, meta: `${item.evidenceCoverage}% evidence coverage`, onOpen: () => { const review = data.reviews.find((candidate) => candidate.data.employee.email === item.employee.email); setSelectedEmail(item.employee.email); setDraft(reviewDraft(review?.data.ownerReview)); }, openLabel: "Open Scorecard →" })) })}><span>AVERAGE SYSTEM SCORE</span><strong>{averageScore ?? "—"}</strong><small>Available evidence only</small></article>
      <article {...summaryDrilldownProps({ title: "Evidence Coverage", description: "Coverage by employee; missing evidence is shown without treating it as failure.", rows: data.scorecards.map((item) => ({ id: item.employee.email, title: item.employee.name, subtitle: item.employee.designations.join(" · ") || item.employee.accessLevel, status: item.evidenceCoverage >= 80 ? "Strong Coverage" : item.evidenceCoverage >= 50 ? "Partial Coverage" : "Evidence Needed", value: `${item.evidenceCoverage}%`, onOpen: () => { const review = data.reviews.find((candidate) => candidate.data.employee.email === item.employee.email); setSelectedEmail(item.employee.email); setDraft(reviewDraft(review?.data.ownerReview)); }, openLabel: "Open Evidence →" })) })}><span>EVIDENCE COVERAGE</span><strong>{averageCoverage}%</strong><small>Missing data is not failure</small></article>
      <article {...summaryDrilldownProps({ title: "Finalized Performance Reviews", description: "Every permanently finalized review in the selected quarter.", rows: data.reviews.filter((item) => item.status === "Finalized").map((item) => ({ id: item.id, title: item.data.employee.name, subtitle: item.data.employee.email, status: item.status, value: String(item.data.ownerReview?.finalScore ?? "—"), meta: dateTime(item.data.ownerReview?.finalizedAt || ""), onOpen: () => { setSelectedEmail(item.data.employee.email); setDraft(reviewDraft(item.data.ownerReview)); }, openLabel: "Open Final Review →" })) })}><span>FINALIZED</span><strong>{data.reviews.filter((item) => item.status === "Finalized").length}</strong><small>{data.reviews.length} generated reviews</small></article>
    </section>

    <section className="performance-governance"><div><b>Human decision required</b><span>{data.governance.finalAuthority}</span></div><div><b>Fairness boundary</b><span>{data.governance.fairness}</span></div><div><b>ChatGPT boundary</b><span>{data.governance.aiBoundary}</span></div></section>

    <div className="performance-layout">
      <aside className="performance-roster"><header><div><h2>Every Employee</h2></div><input aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person or role" /></header><div>{roster.map((item) => { const review = data.reviews.find((candidate) => candidate.data.employee.email === item.employee.email); return <button key={item.employee.email} className={selectedEmail === item.employee.email ? "active" : ""} onClick={() => { setSelectedEmail(item.employee.email); setDraft(reviewDraft(review?.data.ownerReview)); }}><span className={`performance-grade grade-${gradeSlug(item.grade)}`}>{item.systemScore ?? "—"}</span><span><strong>{item.employee.name}</strong><small>{item.employee.designations.join(" · ") || item.employee.accessLevel}</small><em>{item.evidenceCoverage}% evidence · {review?.status || "Live Preview"}</em></span></button>; })}</div></aside>

      {selected ? <main className="performance-review">
        <header className="performance-person"><div><p>{selected.quarter} · {selected.periodStart} TO {selected.periodEnd}</p><h2>{selected.employee.name}</h2><span>{selected.employee.designations.join(" · ") || selected.employee.accessLevel}{selected.assignedProjects.length ? ` · ${selected.assignedProjects.length} assigned project(s)` : ""}</span></div><div className={`performance-score grade-${gradeSlug(selected.grade)}`}><strong>{selected.systemScore ?? "—"}</strong><span>{selected.grade}</span><small>{selected.evidenceCoverage}% Evidence</small></div></header>

        <section className="performance-role-map"><p>ROLE-SPECIFIC REVIEW PLAN</p><div>{selected.metrics.map((metric) => <span key={metric.key}>{metric.label}<b>{metric.weight}%</b></span>)}</div></section>

        <section className="performance-metrics"><header><div><h3>Metric Scorecards</h3></div><small>Scores are deterministic and source-linked. Owner calibration never overwrites them.</small></header><div>{selected.metrics.map((metric) => <article key={metric.key}><div className="metric-heading"><span><b>{metric.label}</b><small>{metric.category} · {metric.weight}% weight · {metric.confidence} confidence</small></span><strong>{metric.score ?? "—"}</strong></div><div className="metric-bar"><i style={{ width: `${metric.score || 0}%` }} /></div><p>{metric.detail}</p><footer><span>{metric.evidenceCount} evidence item(s)</span><span>{metric.score === null ? "INSUFFICIENT — NOT FAILED" : metric.key.toUpperCase()}</span></footer></article>)}</div></section>

        <section className="performance-ai"><header><div><h3>Balanced Narrative Draft</h3><span>{data.openai.configured ? `${data.openai.provider} · ${data.openai.model}` : "Connection is managed in IT & Integrations."}</span></div><button disabled={!stored || Boolean(saving) || stored.status === "Finalized"} onClick={() => void act("generate-ai-analysis")}>{saving === "generate-ai-analysis" ? "Analyzing…" : stored?.data.aiAnalysis ? "Refresh Evidence Draft" : "Generate Evidence Draft"}</button></header>{stored?.data.aiAnalysis ? <AiDraft analysis={stored.data.aiAnalysis} /> : <div className="performance-ai-empty">Generate the quarter record first, then ChatGPT can summarize only the verified metrics and evidence gaps. It cannot change a score.</div>}</section>

        <section className="performance-owner"><header><div><h3>{stored?.status === "Finalized" ? "Final Review" : "Owner Review & Coaching Plan"}</h3><span>System score {selected.systemScore ?? "N/A"} remains locked and visible beside any documented calibration.</span></div><b>{stored?.status || "Generate Review First"}</b></header><div className="performance-owner-form"><label className="wide">Owner Summary<textarea rows={5} disabled={stored?.status === "Finalized"} value={draft.ownerSummary} onChange={(event) => setDraft({ ...draft, ownerSummary: event.target.value })} /></label><label>Verified Accomplishments<textarea rows={4} disabled={stored?.status === "Finalized"} value={draft.accomplishments} onChange={(event) => setDraft({ ...draft, accomplishments: event.target.value })} /></label><label>Coaching & Support<textarea rows={4} disabled={stored?.status === "Finalized"} value={draft.coaching} onChange={(event) => setDraft({ ...draft, coaching: event.target.value })} /></label><label className="wide">Next-Quarter Goals<textarea rows={4} disabled={stored?.status === "Finalized"} value={draft.goals} onChange={(event) => setDraft({ ...draft, goals: event.target.value })} /></label><label>Owner Calibration<select disabled={stored?.status === "Finalized"} value={draft.adjustment} onChange={(event) => setDraft({ ...draft, adjustment: event.target.value })}>{Array.from({ length: 21 }, (_, index) => index - 10).map((value) => <option key={value} value={value}>{value > 0 ? "+" : ""}{value} points</option>)}</select><small>Maximum ±10; system score is never changed.</small></label><label>Calibration Reason<textarea rows={3} disabled={stored?.status === "Finalized"} value={draft.adjustmentReason} onChange={(event) => setDraft({ ...draft, adjustmentReason: event.target.value })} placeholder="Required when calibration is not zero" /></label></div>{stored?.status !== "Finalized" ? <footer><button disabled={!stored || Boolean(saving)} onClick={() => save(false)}>{saving === "save-owner-review" ? "Saving…" : "Save Owner Draft"}</button><button className="primary" disabled={!stored || Boolean(saving)} onClick={() => save(true)}>Finalize & Lock Review</button></footer> : <div className="performance-final"><b>Finalized by {stored.data.ownerReview?.reviewedBy}</b><span>{stored.data.ownerReview?.finalScore ?? "No numeric score"} · {stored.data.ownerReview?.finalGrade} · {dateTime(stored.data.ownerReview?.finalizedAt || "")}</span></div>}</section>
      </main> : <div className="performance-empty">No active employees are available for this quarter.</div>}
    </div>
  </div>;
}

function AiDraft({ analysis }: { analysis: AiAnalysis }) {
  return <div className="performance-ai-draft"><p>{analysis.balancedSummary}</p><div>{[["Verified Strengths", analysis.verifiedStrengths], ["Improvement Areas", analysis.improvementAreas], ["Evidence Gaps", analysis.evidenceGaps], ["Coaching Questions", analysis.coachingQuestions], ["Suggested Goals", analysis.suggestedQuarterGoals], ["Owner Cautions", analysis.ownerCautions]].map(([label, items]) => <section key={String(label)}><b>{label}</b><ul>{(items as string[] || []).map((item) => <li key={item}>{item}</li>)}</ul></section>)}</div><small>AI draft · {analysis.model} · {dateTime(analysis.generatedAt || "")} · Owner judgment required</small></div>;
}

function currentQuarter(date = new Date()) { return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`; }
function quarterOptions() { const result: string[] = []; const now = new Date(); for (let index = 0; index < 9; index += 1) { const month = now.getMonth() - index * 3; const date = new Date(now.getFullYear(), month, 1); result.push(currentQuarter(date)); } return result; }
function gradeSlug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function dateTime(value: string) { if (!value) return "Not recorded"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function reviewDraft(review?: OwnerReview | null) { return { ownerSummary: review?.ownerSummary || "", accomplishments: review?.accomplishments || "", coaching: review?.coaching || "", goals: review?.goals || "", adjustment: String(review?.adjustment || 0), adjustmentReason: review?.adjustmentReason || "" }; }
