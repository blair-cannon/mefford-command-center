"use client";

import { useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";

type RecordItem = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  auditHistory?: string[];
  data?: Record<string, unknown>;
};

type CorrespondenceMode = "RFIs" | "Submittals";
type ImpactAnswer = "No" | "Yes" | "Unknown";

type Setup = {
  permissions: { canInitiate: boolean; canIssue: boolean };
  projectManager: string;
  superintendent: string;
  emailConnection: "Connected" | "Connection Required";
  vendors: Array<{ id: string; name: string; contactName: string; contactEmail: string; trade: string; status: string }>;
};

const blankDraft = {
  title: "",
  details: "",
  specificationReference: "",
  drawingReference: "",
  scheduleReference: "",
  vendorId: "",
  requiredBy: "",
};

export function ProjectCorrespondenceWorkspace({
  mode,
  project,
  actor,
  records,
  onRecordsChange,
}: {
  mode: CorrespondenceMode;
  project: { number: string; name: string; architect: string; projectManager: string; superintendent: string };
  actor: { name: string; email: string; accessLevel: string; designations: string[] };
  records: RecordItem[];
  onRecordsChange: (next: RecordItem[]) => void;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"" | "create" | "issue" | "response">("");
  const [draft, setDraft] = useState(blankDraft);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [issue, setIssue] = useState({ recipientName: "", recipientEmail: "", deliveryMethod: "Recorded Manual Transmission" as "Operational Email" | "Recorded Manual Transmission", transmissionNote: "" });
  const [response, setResponse] = useState({ responseText: "", responseStatus: mode === "Submittals" ? "Approved" : "Answered", costImpact: "No" as ImpactAnswer, scheduleImpact: "No" as ImpactAnswer });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.scrollTo({ top: 0, behavior: "auto" });
    fetch(`/api/project-correspondence?projectId=${encodeURIComponent(project.number)}`)
      .then(async (result) => {
        const data = await result.json() as Setup & { error?: string };
        if (!result.ok) throw new Error(data.error || "Correspondence Controls Are Unavailable");
        if (!cancelled) setSetup(data);
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Correspondence Controls Are Unavailable"));
    return () => { cancelled = true; };
  }, [project.number]);

  const selected = records.find((record) => record.id === selectedId) || records[0] || null;
  const effectiveSelectedId = selected?.id || "";
  const visible = useMemo(() => records.filter((record) => `${record.id} ${record.title} ${record.status} ${record.owner}`.toLowerCase().includes(query.toLowerCase())), [query, records]);
  const attention = records.filter((record) => !["Closed", "Distributed"].includes(record.status)).length;
  const impacts = records.filter((record) => ["Yes", "Unknown"].includes(String(record.data?.costImpact)) || ["Yes", "Unknown"].includes(String(record.data?.scheduleImpact))).length;

  async function call(action: string, body: Record<string, unknown>) {
    setSaving(true);
    setNotice("");
    try {
      const result = await fetch("/api/project-correspondence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, projectId: project.number, recordType: mode, ...body }),
      });
      const payload = await result.json() as { error?: string; record?: RecordItem; status?: string; data?: Record<string, unknown>; impact?: { changeExposureId?: string; scheduleRiskWorkItemId?: string } };
      if (!result.ok) throw new Error(payload.error || "The Workflow Action Could Not Be Completed");
      if (payload.record) {
        let nextRecord = payload.record;
        if (attachment) {
          const form = new FormData();
          form.set("file", attachment);
          form.set("projectId", project.number);
          form.set("category", mode);
          form.set("revision", `${nextRecord.id} Supporting File`);
          form.set("access", "Project Team + Controlled Recipients");
          const upload = await fetch("/api/files", { method: "POST", body: form });
          if (!upload.ok) setNotice(`${nextRecord.id} Was Saved, But The Supporting File Needs To Be Uploaded Again.`);
          nextRecord = { ...nextRecord, meta: `${nextRecord.meta} · ${attachment.name}` };
        }
        onRecordsChange([nextRecord, ...records.filter((record) => record.id !== nextRecord.id)]);
        setSelectedId(nextRecord.id);
        setDraft(blankDraft);
        setAttachment(null);
        setNotice((current) => current || `${nextRecord.id} Initiated. ${nextRecord.status === "PM Review" ? "The Project Manager Must Review And Issue It." : "It Remains A Draft Until The Project Manager Issues It."}`);
      } else if (selected && payload.status && payload.data) {
        const next = { ...selected, status: payload.status, data: payload.data };
        onRecordsChange(records.map((record) => record.id === next.id ? next : record));
        const exposure = payload.impact?.changeExposureId ? ` Linked Exposure ${payload.impact.changeExposureId} Was Created.` : "";
        const scheduleRisk = payload.impact?.scheduleRiskWorkItemId ? " A Linked Schedule-Risk Action Was Added To My Work." : "";
        setNotice(`${selected.id} Advanced To ${payload.status}.${exposure}${scheduleRisk}`);
      }
      setPanel("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Workflow Action Could Not Be Completed");
    } finally {
      setSaving(false);
    }
  }

  function openIssue() {
    if (!selected) return;
    const vendor = setup?.vendors.find((item) => item.id === selected.data?.vendorId);
    setIssue({
      recipientName: String(selected.data?.recipientName || vendor?.contactName || project.architect || ""),
      recipientEmail: String(selected.data?.recipientEmail || vendor?.contactEmail || ""),
      deliveryMethod: setup?.emailConnection === "Connected" ? "Operational Email" : "Recorded Manual Transmission",
      transmissionNote: "",
    });
    setPanel("issue");
  }

  const isResponseReady = selected && (mode === "RFIs" ? selected.status === "Issued" : selected.status === "Design Review");
  const canDistribute = selected && ["Response Received", "Returned To PM"].includes(selected.status);
  const timeline = Array.isArray(selected?.data?.timeline) ? selected?.data?.timeline as Array<{ action?: string; actor?: string; at?: string; detail?: string }> : [];

  return <div className="module-workspace correspondence-workspace">
    <section className="workspace-heading correspondence-heading">
      <div><p className="eyebrow orange-text">{project.name} · CONTROLLED PROJECT CORRESPONDENCE</p><h1>{mode === "RFIs" ? "Requests For Information" : "Submittals"}</h1></div>
      <button className="primary-action large" disabled={!setup?.permissions.canInitiate} onClick={() => setPanel("create")}>＋ Initiate {mode === "RFIs" ? "RFI" : "Submittal"}</button>
    </section>


    {notice ? <div className={/could not|required|only|unavailable|again/i.test(notice) ? "form-error" : "inline-success"}>{notice}</div> : null}

    <section className="correspondence-summary">
      <article {...summaryDrilldownProps({ title: `All ${mode}`, rows: records.map((record) => correspondenceSummaryRow(record, setSelectedId)) })}><strong>{records.length}</strong><span>Total Records</span></article>
      <article {...summaryDrilldownProps({ title: `${mode} Needing Attention`, rows: records.filter((record) => !["Closed", "Distributed"].includes(record.status)).map((record) => correspondenceSummaryRow(record, setSelectedId)) })}><strong>{attention}</strong><span>Need Attention</span></article>
      <article {...summaryDrilldownProps({ title: `${mode} In PM Review`, rows: records.filter((record) => record.status === "PM Review").map((record) => correspondenceSummaryRow(record, setSelectedId)) })}><strong>{records.filter((record) => record.status === "PM Review").length}</strong><span>PM Review</span></article>
      <article {...summaryDrilldownProps({ title: `${mode} With Cost Or Schedule Exposure`, rows: records.filter((record) => ["Yes", "Unknown"].includes(String(record.data?.costImpact)) || ["Yes", "Unknown"].includes(String(record.data?.scheduleImpact))).map((record) => correspondenceSummaryRow(record, setSelectedId)) })}><strong>{impacts}</strong><span>Impact Exposure</span></article>
    </section>

    <section className="correspondence-register">
      <div className="correspondence-list">
        <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${mode.toLowerCase()}…`} /></label>
        {!visible.length ? <div className="correspondence-empty"><b>No {mode} Yet</b></div> : visible.map((record) => <button key={record.id} className={effectiveSelectedId === record.id ? "active" : ""} onClick={() => { setSelectedId(record.id); setPanel(""); }}><span><b>{record.id}</b><i className={`correspondence-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i></span><strong>{record.title}</strong><small>{record.owner} · Required {formatDate(record.due)}</small></button>)}
      </div>
      <div className="correspondence-detail">
        {!selected ? <div className="correspondence-empty detail"><b>Select A Record</b></div> : <>
          <header><div><p className="eyebrow orange-text">{selected.id} · {selected.status.toUpperCase()}</p><h2>{selected.title}</h2><span>Owned By {selected.owner} · Required {formatDate(selected.due)}</span></div><i className={`correspondence-status large ${selected.status.toLowerCase().replaceAll(" ", "-")}`}>{selected.status}</i></header>
          <div className="correspondence-detail-grid"><article><span>{mode === "RFIs" ? "QUESTION / CLARIFICATION" : "PACKAGE DESCRIPTION"}</span><p>{String(selected.data?.details || "No Details Recorded")}</p></article><article><span>REFERENCES</span><p>Specification: {String(selected.data?.specificationReference || "—")}<br />Drawing: {String(selected.data?.drawingReference || "—")}<br />Schedule: {String(selected.data?.scheduleReference || "—")}</p></article></div>
          {selected.data?.responseText ? <section className="correspondence-response-card"><div><span>CONTROLLED RESPONSE</span><strong>{String(selected.data.responseStatus || "Answered")}</strong></div><p>{String(selected.data.responseText)}</p><footer><span>Cost Impact <b className={impactClass(String(selected.data.costImpact))}>{String(selected.data.costImpact)}</b></span><span>Schedule Impact <b className={impactClass(String(selected.data.scheduleImpact))}>{String(selected.data.scheduleImpact)}</b></span></footer></section> : null}
          <section className="correspondence-actions">
            {mode === "RFIs" && setup?.permissions.canInitiate && !selected.data?.changeExposureId ? <button className="secondary-action" disabled={saving} onClick={() => void call("initiate-change-order", { recordId: selected.id })}>Initiate Linked Change Order</button> : null}
            {mode === "RFIs" && selected.data?.changeExposureId ? <button className="secondary-action" disabled>{String(selected.data.changeExposureId)} · Linked Exposure</button> : null}
            {setup?.permissions.canIssue && ["Draft", "PM Review", "Revise And Resubmit"].includes(selected.status) ? <button className="primary-action" onClick={openIssue}>Issue / Send As PM</button> : null}
            {setup?.permissions.canIssue && isResponseReady ? <button className="primary-action" onClick={() => setPanel("response")}>Record Response + Impacts</button> : null}
            {setup?.permissions.canIssue && canDistribute ? <button className="primary-action" disabled={saving} onClick={() => void call("distribute", { recordId: selected.id })}>Distribute Controlled Response</button> : null}
            {setup?.permissions.canIssue && selected.status === "Distributed" ? <button className="primary-action" disabled={saving} onClick={() => void call("close", { recordId: selected.id })}>Close Record</button> : null}
            {!setup?.permissions.canIssue && ["Draft", "PM Review"].includes(selected.status) ? <div className="permission-note"><strong>PM Issuance Required</strong><span>You may initiate; only a Project Manager can formally issue or send.</span></div> : null}
          </section>
          <section className="correspondence-timeline"><h3>Permanent Workflow Timeline</h3>{[...timeline].reverse().map((item, index) => <article key={`${item.at}-${index}`}><i>{index === 0 ? "●" : "○"}</i><div><strong>{item.action}</strong><span>{item.actor} · {formatDateTime(String(item.at || ""))}</span><p>{item.detail}</p></div></article>)}</section>
        </>}
      </div>
    </section>

    {panel ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPanel("")}><section className="record-modal wide correspondence-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow orange-text">{project.name.toUpperCase()}</p><h2>{panel === "create" ? `Initiate ${mode === "RFIs" ? "RFI" : "Submittal"}` : panel === "issue" ? `PM Issue · ${selected?.id}` : `Record Response · ${selected?.id}`}</h2><span>{panel === "create" ? "This creates a controlled draft; it does not send anything." : panel === "issue" ? "Formal issuance is restricted to the Project Manager." : "Cost Impact and Schedule Impact are required before the response can be accepted."}</span></div><button aria-label="Close" onClick={() => setPanel("")}>×</button></div>
      {panel === "create" ? <><div className="field-grid"><label className="field-label wide">{mode === "RFIs" ? "Question Title" : "Submittal Title"}<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="field-label">Required Response Date<input type="date" value={draft.requiredBy} onChange={(event) => setDraft({ ...draft, requiredBy: event.target.value })} /></label><label className="field-label">Assigned Vendor (Optional)<select value={draft.vendorId} onChange={(event) => setDraft({ ...draft, vendorId: event.target.value })}><option value="">Design Team / No Vendor</option>{setup?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.trade || "Shared Vendor"}</option>)}</select></label></div><label className="field-label">{mode === "RFIs" ? "Question / Clarification Needed" : "Material Package / Completeness Notes"}<textarea rows={5} value={draft.details} onChange={(event) => setDraft({ ...draft, details: event.target.value })} /></label><div className="field-grid"><label className="field-label">Specification Reference<input value={draft.specificationReference} onChange={(event) => setDraft({ ...draft, specificationReference: event.target.value })} /></label><label className="field-label">Drawing Reference<input value={draft.drawingReference} onChange={(event) => setDraft({ ...draft, drawingReference: event.target.value })} /></label><label className="field-label">Schedule Activity Reference<input value={draft.scheduleReference} onChange={(event) => setDraft({ ...draft, scheduleReference: event.target.value })} /></label></div><label className="signed-pdf-upload"><input type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><span>＋</span><strong>{attachment?.name || "Attach Supporting File (Optional)"}</strong><small>Stored In The Project {mode} Folder</small></label><div className="form-rule"><strong>Initiated By {actor.name}:</strong> {setup?.permissions.canIssue ? "Saved as a PM draft until you explicitly issue it." : "Routed to PM Review; your role cannot issue or send it."}</div></> : null}
      {panel === "issue" ? <><div className="field-grid"><label className="field-label">Recipient Name<input value={issue.recipientName} onChange={(event) => setIssue({ ...issue, recipientName: event.target.value })} /></label><label className="field-label">Recipient Email<input type="email" value={issue.recipientEmail} onChange={(event) => setIssue({ ...issue, recipientEmail: event.target.value })} /></label><label className="field-label">Delivery Method<select value={issue.deliveryMethod} onChange={(event) => setIssue({ ...issue, deliveryMethod: event.target.value as typeof issue.deliveryMethod })}><option disabled={setup?.emailConnection !== "Connected"}>Operational Email{setup?.emailConnection !== "Connected" ? " · Connection Required" : ""}</option><option>Recorded Manual Transmission</option></select></label></div>{issue.deliveryMethod === "Recorded Manual Transmission" ? <label className="field-label">Transmission Record<textarea rows={4} value={issue.transmissionNote} onChange={(event) => setIssue({ ...issue, transmissionNote: event.target.value })} placeholder="Example: Sent from Outlook by the Project Manager at 2:14 PM; delivery confirmed." /></label> : <div className="form-rule"><strong>Operational Email:</strong> Command Center sends only this project correspondence. It cannot approve cost, send an invoice, or post accounting.</div>}</> : null}
      {panel === "response" ? <><label className="field-label">Design-Team / Reviewer Response<textarea rows={6} autoFocus value={response.responseText} onChange={(event) => setResponse({ ...response, responseText: event.target.value })} /></label>{mode === "Submittals" ? <label className="field-label">Review Status<select value={response.responseStatus} onChange={(event) => setResponse({ ...response, responseStatus: event.target.value })}><option>Approved</option><option>Approved As Noted</option><option>Revise And Resubmit</option><option>Rejected</option></select></label> : null}<div className="impact-question-grid"><ImpactQuestion label="Cost Impact" value={response.costImpact} onChange={(value) => setResponse({ ...response, costImpact: value })} /><ImpactQuestion label="Schedule Impact" value={response.scheduleImpact} onChange={(value) => setResponse({ ...response, scheduleImpact: value })} /></div><div className="form-rule warning"><strong>Automatic Exposure Control:</strong> “Yes” or “Unknown” creates a linked unapproved change-order exposure and/or schedule-risk action. It never approves cost or changes the schedule automatically.</div></> : null}
      <div className="modal-actions"><button className="secondary-action" onClick={() => setPanel("")}>Cancel</button><button className="primary-action large" disabled={saving || (panel === "create" && (!draft.title || !draft.details || !draft.requiredBy)) || (panel === "issue" && (!issue.recipientName || !issue.recipientEmail || (issue.deliveryMethod === "Recorded Manual Transmission" && !issue.transmissionNote))) || (panel === "response" && !response.responseText)} onClick={() => void (panel === "create" ? call("create", draft) : panel === "issue" ? call("issue", { recordId: selected?.id, ...issue }) : call("record-response", { recordId: selected?.id, ...response }))}>{saving ? "Saving Permanently…" : panel === "create" ? "Save Controlled Draft" : panel === "issue" ? "Issue Formal Record" : "Accept Response + Create Impacts"}</button></div>
    </section></div> : null}
  </div>;
}

function correspondenceSummaryRow(record: RecordItem, select: (id: string) => void) {
  return { id: record.id, title: record.title, subtitle: `${record.owner} · Due ${record.due}`, status: record.status, meta: record.meta, onOpen: () => select(record.id), openLabel: "Open Record →" };
}

function ImpactQuestion({ label, value, onChange }: { label: string; value: ImpactAnswer; onChange: (next: ImpactAnswer) => void }) {
  return <fieldset><legend>{label} <b>Required</b></legend><div>{(["No", "Yes", "Unknown"] as ImpactAnswer[]).map((answer) => <label key={answer} className={value === answer ? "active" : ""}><input type="radio" checked={value === answer} onChange={() => onChange(answer)} />{answer}</label>)}</div></fieldset>;
}

function impactClass(value: string) { return value === "No" ? "clear" : value === "Yes" ? "critical" : "warning"; }
function formatDate(value: string) { if (!value) return "Not Set"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
