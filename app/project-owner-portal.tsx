"use client";

import { useEffect, useMemo, useState } from "react";
import { contractFieldLabel } from "../lib/owner-contracts";
import { SignaturePad } from "./signature-pad";
import { summaryDrilldownProps } from "./summary-drilldown";

type OwnerRecord = { id: string; recordType: string; title: string; due: string; status: string; meta: string; recordDate: string; data: Record<string, unknown> };
type OwnerBasisAttachment = { kind: "scope" | "drawings"; label: string; fileId: number; name: string; revision: string; category: string; contentType: string; sizeBytes: number };
type OwnerRevision = { id: string; revision_number: number; phase: string; contract_type: string; snapshot_hash: string; frozen_at?: string | null; created_at: string; fields: Record<string, unknown>; basisAttachments?: OwnerBasisAttachment[] };
type OwnerData = {
  verified: boolean;
  invite: { id: string; contactName?: string; email?: string; emailHint?: string; expiresAt?: string; sessionExpiresAt?: string; expired?: boolean; locked?: boolean };
  project?: { number: string; name: string; status: string; site: string; ownerName: string; contractDate: string; contractType: string; contractStatus: string; contractAmount: string; currentContractAmount: string; startDate: string; substantialDate: string; finalDate: string; projectManager: string };
  access?: { status: string; approvedRevisionId: string; lastReviewAt?: string | null };
  contract?: { id: string; title: string; status: string; meta: string; contractType: string; signatures: Record<string, Record<string, unknown>>; frozenRevisionId?: string; activeInstrument?: string; agreementSource?: string; basisAttachments?: OwnerBasisAttachment[] };
  revisions?: OwnerRevision[];
  changeRequests?: Array<{ id: string; revision_id: string; clause_key: string; request_type: string; original_text: string; proposed_text: string; comment: string; status: string; mefford_response: string; created_at: string }>;
  changeOrders?: OwnerRecord[];
  billing?: OwnerRecord[];
  schedule?: OwnerRecord[];
  selections?: OwnerRecord[];
  closeout?: OwnerRecord[];
  messages?: OwnerRecord[];
  documents?: Array<{ id: number; name: string; category: string; revision: string; content_type: string; size_bytes: number; created_at: string }>;
};

type OwnerView = "Contract" | "Change Orders" | "Billing" | "Schedule" | "Selections" | "Documents" | "Closeout" | "Messages";
const views: OwnerView[] = ["Contract", "Change Orders", "Billing", "Schedule", "Selections", "Documents", "Closeout", "Messages"];

export function ProjectOwnerPortal({ inviteId }: { inviteId: string }) {
  const [sessionToken, setSessionToken] = useState("");
  const [data, setData] = useState<OwnerData | null>(null);
  const [code, setCode] = useState("");
  const [view, setView] = useState<OwnerView>("Contract");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [compareRevisionId, setCompareRevisionId] = useState("");
  const [changeClause, setChangeClause] = useState("");
  const [changeDraft, setChangeDraft] = useState({ requestType: "Replacement", proposedText: "", comment: "" });
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState({ signerName: "", signerTitle: "", signatureImage: "", signatureConsent: false });

  function authHeaders(token = sessionToken) {
    return { "x-owner-invite": inviteId, ...(token ? { "x-owner-session": token } : {}) };
  }

  async function load(token = sessionToken) {
    setLoading(true);
    try {
      const response = await fetch(`/api/project-owner?inviteId=${encodeURIComponent(inviteId)}`, { headers: authHeaders(token) });
      const result = await response.json() as OwnerData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Project Owner Access Could Not Be Loaded");
      setData(result);
      const newest = result.revisions?.[0]?.id || "";
      setSelectedRevisionId((current) => current || newest);
      setCompareRevisionId((current) => current || result.revisions?.[1]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project Owner Access Could Not Be Loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/project-owner?inviteId=${encodeURIComponent(inviteId)}`, { headers: { "x-owner-invite": inviteId } })
      .then((response) => response.json().then((result) => ({ response, result })))
      .then(({ response, result }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(String((result as { error?: string }).error || "Project Owner Access Could Not Be Loaded"));
        setData(result as OwnerData);
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Project Owner Access Could Not Be Loaded"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [inviteId]);

  async function verify() {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/project-owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify-code", inviteId, code }) });
      const result = await response.json() as { verified?: boolean; sessionToken?: string; error?: string };
      if (!response.ok || !result.sessionToken) throw new Error(result.error || "The Verification Code Was Not Accepted");
      setSessionToken(result.sessionToken);
      await load(result.sessionToken);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Verification Code Was Not Accepted"); }
    finally { setSaving(false); }
  }

  async function action(payload: Record<string, unknown>, success: string) {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/project-owner", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(payload) });
      const result = await response.json() as OwnerData & { error?: string };
      if (!response.ok) throw new Error(result.error || "The Project Owner Action Could Not Be Completed");
      setData(result); setNotice(success); setChangeClause(""); setSigning(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Project Owner Action Could Not Be Completed"); }
    finally { setSaving(false); }
  }

  async function openDocument(id: number, name: string) {
    try {
      const response = await fetch(`/api/project-owner/files?id=${id}`, { headers: authHeaders() });
      if (!response.ok) throw new Error("This Document Is Not Available");
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { setNotice(error instanceof Error ? `${name}: ${error.message}` : "This Document Is Not Available"); }
  }

  async function openContractPacket() {
    if (!data?.project?.number || !data.contract?.id) return;
    const contractWindow = window.open("about:blank", "_blank");
    try {
      const response = await fetch(`/api/contracts/document?projectId=${encodeURIComponent(data.project.number)}&recordId=${encodeURIComponent(data.contract.id)}`, { headers: authHeaders() });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "The Exact Contract Packet Is Not Available"); }
      const url = URL.createObjectURL(await response.blob());
      if (contractWindow) contractWindow.location.href = url;
      else { const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      contractWindow?.close();
      setNotice(error instanceof Error ? error.message : "The Exact Contract Packet Is Not Available");
    }
  }

  async function downloadEditableContract() {
    if (!data?.project?.number || !data.contract?.id) return;
    setNotice("");
    try {
      const revision = selectedRevisionId ? `&revisionId=${encodeURIComponent(selectedRevisionId)}` : "";
      const response = await fetch(`/api/contracts/document?projectId=${encodeURIComponent(data.project.number)}&recordId=${encodeURIComponent(data.contract.id)}&format=docx${revision}`, { headers: authHeaders() });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "The Editable Word Copy Is Not Available"); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      const contractName = String(data.contract.contractType || "Owner Contract").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
      link.href = url;
      link.download = `${data.project.number}-${contractName}-${selectedRevision ? `R${selectedRevision.revision_number}` : "Current"}-Editable-Review.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice("Editable Word Copy Downloaded. Proposed edits do not change the controlled contract until Mefford reviews and approves them.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Editable Word Copy Is Not Available");
    }
  }

  const selectedRevision = data?.revisions?.find((item) => item.id === selectedRevisionId) || data?.revisions?.[0];
  const compareRevision = data?.revisions?.find((item) => item.id === compareRevisionId);
  const basisAttachments = selectedRevision?.basisAttachments || data?.contract?.basisAttachments || [];
  const clauseKeys = useMemo(() => Object.keys(selectedRevision?.fields || {}).sort((a, b) => contractFieldLabel(a).localeCompare(contractFieldLabel(b))), [selectedRevision]);
  const signatures = data?.contract?.signatures || {};
  const ownerSigned = Boolean(signatures.owner?.signedAt);
  const meffordSigned = Boolean(signatures.mefford?.signedAt);

  if (loading && !data) return <main className="owner-portal-page"><section className="owner-access-card"><OwnerMark /><p>Opening Your Project Workspace…</p></section></main>;
  if (!data?.verified) return <main className="owner-portal-page"><section className="owner-access-card"><OwnerMark /><p className="eyebrow orange-text">PROJECT OWNER ACCESS</p><h1>{data?.invite?.contactName ? `Welcome, ${data.invite.contactName}` : "Open Your Project"}</h1><p>This is a private, project-only workspace. Sign in with the invited email, then enter the six-digit code Mefford sent you.</p><div className="owner-access-detail"><span>INVITED EMAIL</span><strong>{data?.invite?.emailHint || "Verifying invite"}</strong><small>{data?.invite?.expiresAt ? `Invite expires ${dateTime(data.invite.expiresAt)}` : ""}</small></div><label>Six-Digit Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></label>{notice ? <div className="form-error">{notice}</div> : null}<button disabled={saving || code.length !== 6 || data?.invite?.expired || data?.invite?.locked} onClick={() => void verify()}>{saving ? "Verifying…" : data?.invite?.expired ? "Invite Expired" : data?.invite?.locked ? "Invite Locked" : "Open My Project"}</button><small>Only the project and documents specifically released by Mefford appear here.</small></section></main>;

  return <main className="owner-portal-page active">
    <header className="owner-portal-header"><div><OwnerMark /><span><b>MEFFORD</b><small>PROJECT OWNER PORTAL</small></span></div><div><strong>{data.project?.name}</strong><small>{data.project?.number} · Secure Project-Only Session</small></div></header>
    <div className="owner-portal-shell">
      <aside className="owner-portal-nav"><div className="owner-project-card"><span>{initials(data.project?.name || "Project")}</span><div><strong>{data.project?.name}</strong><small>{data.project?.site}</small></div></div><p>YOUR PROJECT</p>{views.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}><span>{viewIcon(item)}</span>{item}{item === "Contract" && (data.changeRequests?.filter((request) => request.status === "Open").length || 0) ? <b>{data.changeRequests?.filter((request) => request.status === "Open").length}</b> : null}</button>)}<div className="owner-help"><strong>Need Help?</strong><span>Contact {data.project?.projectManager || "your Mefford Project Manager"}. Internal estimates, margins, budgets and company records are never available here.</span></div></aside>
      <section className="owner-portal-content">
        <header className="owner-portal-title"><div><p className="eyebrow orange-text">{view.toUpperCase()}</p><h1>{view === "Contract" ? "Contract Review" : view}</h1><span>{view === "Contract" ? "Review the exact released language, request specific edits, accept the final revision, and sign only after Mefford freezes it." : ownerViewDescription(view)}</span></div><i className={statusClass(data.access?.status || "")}>{data.access?.status}</i></header>
        {notice ? <div className={/could not|not |required|must |expired|locked/i.test(notice) ? "form-error" : "inline-success"}>{notice}</div> : null}

        {view === "Contract" ? <div className="owner-contract-review">
          <section className="owner-contract-progress"><Phase label="Mefford Draft" complete /><Phase label="Owner Review" complete={["Owner Review", "Changes Requested", "Owner Review Complete", "Ready for Signature", "Owner Signed", "Executed"].includes(data.access?.status || "")} /><Phase label="Final Approval" complete={["Ready for Signature", "Owner Signed", "Executed"].includes(data.access?.status || "")} /><Phase label="Your Signature" complete={ownerSigned} /><Phase label="Mefford Signature" complete={meffordSigned} /></section>
          <section className="owner-contract-summary"><article {...summaryDrilldownProps({ title: "Owner Contract Type", rows: data.contract ? [{ id: data.contract.id, title: data.contract.title, subtitle: data.contract.activeInstrument || data.contract.contractType, status: data.contract.status, meta: data.contract.meta }] : [] })}><span>CONTRACT TYPE</span><strong>{data.contract?.contractType}</strong><small>{data.contract?.activeInstrument || data.contract?.id}</small></article><article {...summaryDrilldownProps({ title: "Current Owner Contract", rows: data.contract ? [{ id: data.contract.id, title: data.project?.name || data.contract.title, subtitle: data.contract.agreementSource === "External" ? "Mapped From Controlling Agreement" : "Command Center Contract Record", value: money(data.project?.currentContractAmount || data.project?.contractAmount), status: data.contract.status }] : [] })}><span>CURRENT CONTRACT</span><strong>{money(data.project?.currentContractAmount || data.project?.contractAmount)}</strong><small>{data.contract?.agreementSource === "External" ? "Amount mapped from controlling agreement" : "Contract record"}</small></article><article {...summaryDrilldownProps({ title: "Current Substantial Completion Milestone", rows: data.project ? [{ id: data.project.number, title: data.project.name, subtitle: data.project.site, value: date(data.project.substantialDate), status: data.project.status, meta: `Project Manager · ${data.project.projectManager}` }] : [] })}><span>SUBSTANTIAL COMPLETION</span><strong>{date(data.project?.substantialDate)}</strong><small>Current milestone</small></article><article {...summaryDrilldownProps({ title: "Released Owner Contract Revisions", rows: (data.revisions || []).map((revision) => ({ id: revision.id, title: `Revision ${revision.revision_number}`, subtitle: revision.phase, status: revision.frozen_at ? "Frozen" : "Released", meta: dateTime(revision.created_at), onOpen: () => setSelectedRevisionId(revision.id), openLabel: "Open Revision →" })) })}><span>RELEASED REVISION</span><strong>{selectedRevision ? `R${selectedRevision.revision_number}` : "Pending"}</strong><small>{selectedRevision?.phase}</small></article></section>
          <section className="owner-revision-controls"><div><label>View Revision<select value={selectedRevisionId} onChange={(event) => setSelectedRevisionId(event.target.value)}>{data.revisions?.map((revision) => <option key={revision.id} value={revision.id}>R{revision.revision_number} · {dateTime(revision.created_at)}</option>)}</select></label><label>Compare Against<select value={compareRevisionId} onChange={(event) => setCompareRevisionId(event.target.value)}><option value="">No Comparison</option>{data.revisions?.filter((revision) => revision.id !== selectedRevision?.id).map((revision) => <option key={revision.id} value={revision.id}>R{revision.revision_number} · {dateTime(revision.created_at)}</option>)}</select></label><button className="secondary-action" onClick={() => void downloadEditableContract()}>Download Editable Word Copy</button><button className="primary-action" onClick={() => void openContractPacket()}>Open Exact Contract Packet ↗</button></div><small>Every released version remains permanent. The Word copy is for proposed edits; it never overwrites Mefford’s controlled record.</small></section>
          {basisAttachments.length ? <section className="owner-contract-basis"><header><div><h2>Contract Basis PDFs</h2><p>These exact files and revisions are part of the selected contract revision.</p></div><b>{basisAttachments.length} ATTACHED</b></header><div>{basisAttachments.map((attachment) => <article key={`${attachment.kind}-${attachment.fileId}`}><span>{attachment.kind === "scope" ? "SC" : "DW"}</span><div><strong>{attachment.label}</strong><b>{attachment.name}</b><small>{attachment.revision} · File {attachment.fileId}{attachment.sizeBytes ? ` · ${fileSize(attachment.sizeBytes)}` : ""}</small></div><button onClick={() => void openDocument(attachment.fileId, attachment.name)}>Open PDF ↗</button></article>)}</div><footer>These PDFs are incorporated subject to the Contract’s existing order-of-precedence terms.</footer></section> : null}
          <section className="owner-clause-list"><header><div><h2>Released Contract Language</h2><p>Select any clause to request replacement language, an addition, a deletion, or a comment.</p></div><b>{clauseKeys.length} CLAUSES</b></header>{clauseKeys.map((key) => { const current = String(selectedRevision?.fields[key] || ""); const prior = compareRevision ? String(compareRevision.fields[key] || "") : ""; const changed = Boolean(compareRevision && current !== prior); return <article key={key} className={changed ? "changed" : ""}><header><div><strong>{contractFieldLabel(key)}</strong><small>{key}</small></div>{changed ? <i>CHANGED FROM R{compareRevision?.revision_number}</i> : null}</header>{changed ? <div className="owner-clause-compare"><span><b>EARLIER</b>{prior || "Not included"}</span><span><b>CURRENT</b>{current || "Not included"}</span></div> : <p>{current || "Not included"}</p>}<button disabled={!(["Owner Review", "Changes Requested"].includes(data.access?.status || ""))} onClick={() => { setChangeClause(key); setChangeDraft({ requestType: "Replacement", proposedText: current, comment: "" }); }}>Request A Change</button></article>; })}</section>
          <section className="owner-change-history"><header><div><h2>Change Requests</h2><p>Each request and Mefford response remains attached to the revision.</p></div><b>{data.changeRequests?.length || 0}</b></header>{!data.changeRequests?.length ? <div className="owner-empty"><strong>No Change Requests</strong><span>If the released draft works for you, accept it below.</span></div> : data.changeRequests.map((request) => <article key={request.id}><div><strong>{contractFieldLabel(request.clause_key)}</strong><small>{request.request_type} · {dateTime(request.created_at)}</small><p>{request.comment}</p>{request.proposed_text ? <blockquote>{request.proposed_text}</blockquote> : null}{request.mefford_response ? <em>Mefford response: {request.mefford_response}</em> : null}</div><i className={statusClass(request.status)}>{request.status}</i></article>)}</section>
          {data.access?.status === "Owner Review" ? <section className="owner-review-decision"><div><h2>Finish This Review</h2><p>Accept this exact released revision, or submit the change requests above for Mefford’s response.</p></div><button className="secondary-action" disabled={saving} onClick={() => void action({ action: "submit-review", decision: "Changes Requested" }, "Your Review Was Sent To Mefford.")}>Submit Requested Changes</button><button className="primary-action" disabled={saving || Boolean(data.changeRequests?.some((request) => request.status === "Open"))} onClick={() => void action({ action: "submit-review", decision: "Accepted" }, "Revision Accepted. Mefford Final Approval Is Next.")}>Accept This Revision</button></section> : null}
          {["Ready for Signature", "Owner Signed", "Executed"].includes(data.access?.status || "") ? <section className="owner-signature-card"><div><p className="eyebrow orange-text">FINAL FROZEN REVISION</p><h2>{ownerSigned ? "Your Signature Is Recorded" : "Your Signature Is Ready"}</h2><p>{ownerSigned ? `Signed by ${String(signatures.owner?.signerName || "Project Owner")} on ${dateTime(String(signatures.owner?.signedAt || ""))}. ${meffordSigned ? "Mefford has countersigned and the contract is executed." : "Mefford countersignature is next."}` : `Mefford has frozen the approved revision. Signing applies only to this exact revision${basisAttachments.length ? ` and its ${basisAttachments.length} listed contract-basis PDF${basisAttachments.length === 1 ? "" : "s"}` : ""}; it cannot be edited afterward.`}</p></div>{!ownerSigned ? <button className="primary-action large" onClick={() => { setSignature((current) => ({ ...current, signerName: data.invite.contactName || "" })); setSigning(true); }}>Review And Sign</button> : <i className={meffordSigned ? "executed" : "waiting"}>{meffordSigned ? "EXECUTED" : "MEFFORD SIGNATURE PENDING"}</i>}</section> : null}
        </div> : null}

        {view === "Change Orders" ? <OwnerRecordList records={data.changeOrders || []} empty="No owner-facing change orders have been released." /> : null}
        {view === "Billing" ? <OwnerRecordList records={data.billing || []} empty="No owner invoices have been released." /> : null}
        {view === "Schedule" ? <OwnerRecordList records={data.schedule || []} empty="No schedule milestones have been released." /> : null}
        {view === "Selections" ? <OwnerRecordList records={data.selections || []} empty="No owner selections are currently open." /> : null}
        {view === "Closeout" ? <OwnerRecordList records={data.closeout || []} empty="No closeout items have been released." /> : null}
        {view === "Messages" ? <OwnerRecordList records={data.messages || []} empty="No project messages are waiting." /> : null}
        {view === "Documents" ? <section className="owner-document-list">{!data.documents?.length ? <div className="owner-empty"><strong>No Owner Documents Released</strong><span>Only files explicitly marked for owner access appear here.</span></div> : data.documents.map((document) => <article key={document.id}><span>{document.category.slice(0, 2).toUpperCase()}</span><div><strong>{document.name}</strong><small>{document.category} · {document.revision} · {fileSize(document.size_bytes)}</small></div><button onClick={() => void openDocument(document.id, document.name)}>Open ↗</button></article>)}</section> : null}
      </section>
    </div>

    {changeClause ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setChangeClause("")}><section className="record-modal wide owner-change-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow orange-text">CONTRACT CHANGE REQUEST</p><h2>{contractFieldLabel(changeClause)}</h2><span>Request only—Mefford’s source contract is never overwritten.</span></div><button onClick={() => setChangeClause("")}>×</button></div><label>Request Type<select value={changeDraft.requestType} onChange={(event) => setChangeDraft((current) => ({ ...current, requestType: event.target.value }))}><option>Replacement</option><option>Addition</option><option>Deletion</option><option>Comment</option></select></label>{["Replacement", "Addition"].includes(changeDraft.requestType) ? <label>Proposed Language<textarea rows={7} value={changeDraft.proposedText} onChange={(event) => setChangeDraft((current) => ({ ...current, proposedText: event.target.value }))} /></label> : null}<label>Why This Change Is Requested<textarea rows={5} value={changeDraft.comment} onChange={(event) => setChangeDraft((current) => ({ ...current, comment: event.target.value }))} /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setChangeClause("")}>Cancel</button><button className="primary-action large" disabled={saving || !changeDraft.comment.trim() || (["Replacement", "Addition"].includes(changeDraft.requestType) && !changeDraft.proposedText.trim())} onClick={() => void action({ action: "request-change", clauseKey: changeClause, ...changeDraft }, "Change Request Sent To Mefford.")}>{saving ? "Submitting…" : "Submit Change Request"}</button></div></section></div> : null}
    {signing ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSigning(false)}><section className="record-modal wide owner-sign-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow orange-text">FROZEN CONTRACT REVISION</p><h2>Project Owner Signature</h2><span>{data.contract?.id} · {data.contract?.frozenRevisionId}</span></div><button onClick={() => setSigning(false)}>×</button></div><div className="field-grid"><label className="field-label">Printed Name<input value={signature.signerName} onChange={(event) => setSignature((current) => ({ ...current, signerName: event.target.value }))} /></label><label className="field-label">Title / Authority<input value={signature.signerTitle} onChange={(event) => setSignature((current) => ({ ...current, signerTitle: event.target.value }))} /></label></div><SignaturePad value={signature.signatureImage} onChange={(signatureImage) => setSignature((current) => ({ ...current, signatureImage }))} label="Draw Project Owner Signature" /><label className="award-confirmation"><input type="checkbox" checked={signature.signatureConsent} onChange={(event) => setSignature((current) => ({ ...current, signatureConsent: event.target.checked }))} /><span><strong>Electronic Signature Consent</strong>I reviewed this exact frozen revision{basisAttachments.length ? ` and its ${basisAttachments.length} listed contract-basis PDF${basisAttachments.length === 1 ? "" : "s"}` : ""} and intend my electronic signature to be binding. I understand Mefford will countersign the same revision and attachments.</span></label><div className="modal-actions"><button className="secondary-action" onClick={() => setSigning(false)}>Cancel</button><button className="primary-action large" disabled={saving || !signature.signerName.trim() || !signature.signerTitle.trim() || !signature.signatureImage || !signature.signatureConsent} onClick={() => void action({ action: "sign", ...signature }, "Your Signature Was Recorded. Mefford Countersignature Is Next.")}>{saving ? "Recording…" : "Sign Exact Frozen Revision"}</button></div></section></div> : null}
  </main>;
}

function OwnerRecordList({ records, empty }: { records: OwnerRecord[]; empty: string }) {
  if (!records.length) return <div className="owner-empty"><strong>Nothing Waiting</strong><span>{empty}</span></div>;
  return <section className="owner-record-list">{records.map((record) => <article key={`${record.recordType}-${record.id}`}><header><div><p>{record.id}</p><h3>{record.title}</h3><span>{record.meta}</span></div><i className={statusClass(record.status)}>{record.status}</i></header><div>{Object.entries(record.data || {}).map(([key, value]) => <span key={key}><b>{label(key)}</b>{display(value)}</span>)}</div><small>{record.due ? `Due ${date(record.due)}` : "Current project record"}</small></article>)}</section>;
}

function Phase({ label, complete }: { label: string; complete?: boolean }) { return <span className={complete ? "complete" : "pending"}><i>{complete ? "✓" : "·"}</i><b>{label}</b></span>; }
function OwnerMark() { return <svg className="owner-portal-mark" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 2 40 12v20L22 42 4 32V12Z" fill="#8f2f27"/><path d="M12 30V14h5l5 8 5-8h5v16h-5V22l-5 8-5-8v8Z" fill="white"/></svg>; }
function statusClass(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function date(value: unknown) { const parsed = new Date(`${String(value || "").slice(0, 10)}T12:00:00`); return Number.isNaN(parsed.getTime()) ? "To Be Determined" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(parsed); }
function dateTime(value: unknown) { const parsed = new Date(String(value || "")); return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(parsed); }
function money(value: unknown) { const number = Number(String(value || "").replace(/[$,]/g, "")); return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : "$0.00"; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MC"; }
function label(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function display(value: unknown) { if (typeof value === "number" && /amount|total|due|balance/i.test(String(value))) return money(value); if (Array.isArray(value)) return value.map(String).join(", "); if (value && typeof value === "object") return Object.values(value).map(String).join(" · "); return String(value ?? "—"); }
function fileSize(value: number) { return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function viewIcon(view: OwnerView) { return ({ Contract: "CT", "Change Orders": "CO", Billing: "$", Schedule: "SC", Selections: "SE", Documents: "DO", Closeout: "CL", Messages: "MS" } as Record<OwnerView, string>)[view]; }
function ownerViewDescription(view: OwnerView) { return ({ "Change Orders": "Review only changes Mefford has released for owner action or record.", Billing: "See owner invoices, applications and payment status without internal accounting records.", Schedule: "Follow current owner-facing milestones and progress.", Selections: "See owner decisions, due dates and ordering status.", Documents: "Open only the project documents Mefford has explicitly released to you.", Closeout: "Track approved and owner-facing closeout requirements.", Messages: "Keep project-owner decisions and questions connected to the project.", Contract: "" } as Record<OwnerView, string>)[view]; }
