"use client";

import { useEffect, useMemo, useState } from "react";
import type { OwnerApprovalItem, OwnerApprovalLevel } from "../lib/owner-approval-center";

type ApprovalHistory = { id: string; approvalItemId: string; sourceRecordType: string; decision: string; decisionNote: string; riskLevel: string; amountCents: number; actorName: string; status: string; createdAt: string };
type ApprovalData = { queue: OwnerApprovalItem[]; history: ApprovalHistory[]; controls: Record<string, string> };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OwnerApprovalCenter({ onNavigate }: { onNavigate: (target: string, projectId?: string, recordId?: string) => void }) {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"Pending" | OwnerApprovalLevel | "History">("Pending");
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/owner-approvals", { cache: "no-store" });
    const result = await response.json() as ApprovalData & { error?: string };
    if (!response.ok) throw new Error(result.error || "Owner Approval Center Is Unavailable");
    setData(result);
    setSelectedId((current) => result.queue.some((item) => item.id === current) ? current : result.queue[0]?.id || "");
    setBatchIds((current) => current.filter((id) => result.queue.some((item) => item.id === id && item.level === "Routine" && item.canApproveHere)));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setNotice(error instanceof Error ? error.message : "Owner Approval Center Is Unavailable")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const visible = useMemo(() => (data?.queue || []).filter((item) => filter === "Pending" || filter === "History" || item.level === filter), [data, filter]);
  const selected = visible.find((item) => item.id === selectedId) || visible[0] || null;
  const totalExposure = (data?.queue || []).reduce((total, item) => total + Math.abs(item.amount), 0);

  async function decide(item: OwnerApprovalItem, decision: "Approved" | "Returned", decisionNote = note) {
    const response = await fetch("/api/owner-approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "decide", approvalItemId: item.id, decision, note: decisionNote }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "The Owner Decision Could Not Be Recorded");
  }

  async function decideSelected(decision: "Approved" | "Returned") {
    if (!selected) return;
    setSaving(true); setNotice("");
    try {
      await decide(selected, decision);
      setNotice(selected.adapter === "owner-proposal" && decision === "Approved"
        ? `${selected.title} · Approved To Send To The Project Owner`
        : `${selected.title} · ${decision}`);
      setNote("");
      await load();
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "The Owner Decision Could Not Be Recorded"); }
    finally { setSaving(false); }
  }

  async function approveBatch() {
    const items = (data?.queue || []).filter((item) => batchIds.includes(item.id));
    if (!items.length) return;
    setSaving(true); setNotice("");
    let completed = 0;
    try {
      for (const item of items) { await decide(item, "Approved", "Routine batch approval after reviewing each decision summary."); completed += 1; }
      setNotice(`${completed} Routine Approval${completed === 1 ? "" : "s"} Completed With Independent Evidence Records.`); setBatchIds([]); await load();
    } catch (error) { setNotice(`${completed} completed. ${error instanceof Error ? error.message : "The remaining batch stopped."}`); await load(); }
    finally { setSaving(false); }
  }

  return <div className="owner-approval-center">
    <header className="owner-approval-hero"><div><h1>Approval Center</h1></div><div><strong>{data?.queue.length || 0}</strong><span>Pending Decisions</span></div></header>
    {notice ? <button className="owner-approval-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}
    <section className="owner-approval-metrics">
      {(["Critical", "Exception", "Material", "Routine"] as OwnerApprovalLevel[]).map((level) => <button key={level} onClick={() => setFilter(level)}><span>{level.toUpperCase()}</span><strong>{data?.queue.filter((item) => item.level === level).length || 0}</strong><small>{level === "Routine" ? "Fast review eligible" : level === "Material" ? "Meaningful commitment" : level === "Exception" ? "Departure from standard" : "Individual attention required"}</small></button>)}
      <button onClick={() => setFilter("Pending")}><span>TOTAL EXPOSURE</span><strong>{currency.format(totalExposure)}</strong><small>Absolute dollars currently awaiting decisions</small></button>
    </section>
    <nav className="owner-approval-tabs"><button className={filter !== "History" ? "active" : ""} onClick={() => setFilter("Pending")}>Pending</button><button className={filter === "History" ? "active" : ""} onClick={() => setFilter("History")}>Decision History</button></nav>
    {filter === "History" ? <section className="owner-approval-history">{data?.history.map((item) => <article key={item.id}><span className={`approval-level level-${item.riskLevel.toLowerCase()}`}>{item.riskLevel}</span><div><strong>{item.sourceRecordType}</strong><small>{item.actorName} · {new Date(item.createdAt).toLocaleString("en-US")}</small><p>{item.decisionNote || "No additional note."}</p></div><b>{item.decision}</b><em>{currency.format(item.amountCents / 100)}</em></article>)}</section> : <>
      {batchIds.length ? <section className="owner-batch-bar"><div><strong>{batchIds.length} Routine Items Selected</strong><span>{currency.format((data?.queue || []).filter((item) => batchIds.includes(item.id)).reduce((total, item) => total + Math.abs(item.amount), 0))} combined exposure · each decision remains independent</span></div><button disabled={saving} onClick={() => void approveBatch()}>Approve Reviewed Batch</button></section> : null}
      <div className="owner-approval-layout"><aside className="owner-approval-queue">
        {visible.map((item) => <article className={selected?.id === item.id ? "active" : ""} key={item.id}>
          {item.level === "Routine" && item.canApproveHere ? <input aria-label={`Select ${item.title}`} type="checkbox" checked={batchIds.includes(item.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setBatchIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> : <span className={`approval-level level-${item.level.toLowerCase()}`}>{item.level.slice(0, 1)}</span>}
          <button className="approval-select" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span><strong>{item.title}</strong><small>{item.projectName} · {item.preparedBy}</small><span>{item.recommendation}</span></span><b>{item.amount ? currency.format(item.amount) : item.category}</b></button>
        </article>)}
        {!visible.length ? <div className="owner-approval-empty"><strong>No Pending Decisions</strong><span>Completed approvals remain available in Decision History.</span></div> : null}
      </aside>
      <main className="owner-decision-packet">{selected ? <>
        <header><div><span className={`approval-level level-${selected.level.toLowerCase()}`}>{selected.level}</span><p>{selected.category} · {selected.recordId}</p><h2>{selected.title}</h2><small>{selected.projectName} · Prepared by {selected.preparedBy}</small></div><strong>{selected.amount ? currency.format(selected.amount) : "Authority"}</strong></header>
        <section className="owner-packet-recommendation"><span>RECOMMENDATION</span><p>{selected.recommendation}</p></section>
        <div className="owner-packet-columns"><section><h3>Business Impact</h3>{selected.businessImpact.map((impact) => <p key={impact}>{impact}</p>)}</section><section><h3>Process Confirmation</h3>{selected.processChecks.map((check) => <p className={check.passed ? "passed" : "failed"} key={check.label}>{check.passed ? "✓" : "!"} {check.label}</p>)}</section></div>
        <section className="owner-packet-exceptions"><h3>Changes & Exceptions</h3>{selected.exceptions.length ? selected.exceptions.map((exception) => <p key={exception}>{exception}</p>) : <p className="clear">No recorded exception to the standard process.</p>}</section>
        <section className="owner-packet-evidence"><h3>Evidence</h3>{selected.evidence.map((evidence) => <button key={evidence.label} onClick={() => onNavigate(evidence.target, selected.projectId, evidence.recordId || selected.recordId)}>{evidence.label} →</button>)}</section>
        {selected.canApproveHere ? <section className="owner-decision-actions"><label><span>Owner Note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional for approval; specific reason required when returning." /></label><div>{selected.canReturnHere ? <button disabled={saving || note.trim().length < 8} onClick={() => void decideSelected("Returned")}>Return With Reason</button> : null}<button className="primary-action" disabled={saving || selected.processChecks.some((check) => !check.passed)} aria-describedby={selected.processChecks.some((check) => !check.passed) ? "approval-blockers" : undefined} onClick={() => void decideSelected("Approved")}>{saving ? "Saving Decision…" : "Approve"}</button></div>{selected.processChecks.some((check) => !check.passed) ? <p className="form-error" id="approval-blockers" role="status">Before Approval: {selected.processChecks.filter((check) => !check.passed).map((check) => check.label).join("; ")}</p> : null}<small>Your decision is saved with this version and its supporting records.</small></section> : <section className="owner-source-only"><strong>Additional Review Required</strong><span>Complete the required review in the linked record.</span><button onClick={() => onNavigate(selected.actionTarget, selected.projectId, selected.recordId)}>Open {selected.actionTarget}</button></section>}
      </> : null}</main></div>
    </>}
  </div>;
}
