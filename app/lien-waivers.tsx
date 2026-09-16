"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SignaturePad } from "./signature-pad";
import { CurrencyInput } from "./currency-input";
import { summaryDrilldownProps } from "./summary-drilldown";

type Actor = { name: string; email: string; accessLevel: string; designations: string[] };
type Project = { number: string; name: string; site: string; status: string; projectManager: string };
type Rule = { state: string; name: string; authority: string; authorityUrl: string; control: string; companionRequirement: string; counselNote: string };
type Vendor = { id: string; name: string; email: string; trade: string; commitmentReference: string; status: string };
type Waiver = { id: string; title: string; due: string; status: string; meta: string; updatedAt: string; data: Record<string, unknown>; auditHistory: Array<{ id: number; fieldName: string; summary: string; actorName: string; createdAt: string }> };
type WorkspaceData = {
  project: { number: string; name: string; site: string; ownerName: string; projectManager: string; finalDate: string };
  permissions: { canView: boolean; canManage: boolean; canConfigure: boolean; canAccountingReview: boolean; isCompanyOwner: boolean };
  control: null | Record<string, unknown>;
  rule: Rule | null;
  jurisdictions: Rule[];
  projectClasses: string[];
  vendors: Vendor[];
  submissions: Array<{ id: string; vendorId: string; title: string; amount: number; periodEnd: string; status: string; finalApplication: boolean }>;
  waivers: Waiver[];
  policy: Record<string, string>;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formLabels: Record<string, string> = {
  "conditional-progress": "Conditional Progress",
  "unconditional-progress": "Unconditional Progress",
  "conditional-final": "Conditional Final",
  "unconditional-final": "Unconditional Final",
};

export function LienWaiverWorkspace({ initialProjectId = "" }: { actor: Actor; initialProjectId?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [config, setConfig] = useState({ jurisdiction: "KY", projectClass: "Private", projectLegalName: "", projectAddress: "", legalDescription: "", titleCompanyRequirements: "" });
  const [requestDraft, setRequestDraft] = useState({ vendorId: "", vendorName: "", vendorEmail: "", formType: "conditional-progress", commitmentReference: "", payApplicationReference: "", linkedSubmissionId: "", amount: "", retainage: "", throughDate: new Date().toISOString().slice(0, 10), exceptions: "None", lowerTierStatement: "No unpaid lower-tier claims are known except those listed in Exceptions." });
  const [signature, setSignature] = useState({ signerName: "", signerTitle: "", signatureImage: "", signatureConsent: false });
  const [payment, setPayment] = useState({ paymentReference: "", paymentClearedDate: new Date().toISOString().slice(0, 10) });
  const [reviewNote, setReviewNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/lien-waivers", { cache: "no-store" });
    const result = await response.json() as { projects?: Project[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Lien Waiver Projects Could Not Be Loaded");
    const rows = result.projects || [];
    setProjects(rows);
    if (!rows.length) {
      setProjectId("");
      setData(null);
      setLoading(false);
      return;
    }
    if (initialProjectId && !rows.some((item) => item.number === initialProjectId)) {
      setProjectId("");
      setData(null);
      setError("The Selected Project Is Not Available For Lien Waivers.");
      setLoading(false);
      return;
    }
    setProjectId((current) => current && rows.some((item) => item.number === current) ? current : rows[0].number);
  }, [initialProjectId]);

  const loadProject = useCallback(async (target: string) => {
    if (!target) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/lien-waivers?projectId=${encodeURIComponent(target)}`, { cache: "no-store" });
      const result = await response.json() as WorkspaceData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Lien Waiver Register Could Not Be Loaded");
      setData(result);
      setSelectedId((current) => current && result.waivers.some((item) => item.id === current) ? current : result.waivers[0]?.id || "");
      setConfig({
        jurisdiction: String(result.control?.jurisdiction || "KY"),
        projectClass: String(result.control?.projectClass || "Private"),
        projectLegalName: String(result.control?.projectLegalName || result.project.name),
        projectAddress: String(result.control?.projectAddress || result.project.site),
        legalDescription: String(result.control?.legalDescription || ""),
        titleCompanyRequirements: String(result.control?.titleCompanyRequirements || ""),
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lien Waiver Register Could Not Be Loaded"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => void loadProjects().catch((caught) => { setError(caught instanceof Error ? caught.message : "Lien Waiver Projects Could Not Be Loaded"); setLoading(false); })); }, [loadProjects]);
  useEffect(() => { if (projectId) queueMicrotask(() => void loadProject(projectId)); }, [loadProject, projectId]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4800); return () => window.clearTimeout(timer); }, [notice]);

  const selected = useMemo(() => data?.waivers.find((item) => item.id === selectedId) || null, [data, selectedId]);
  const counts = {
    requested: data?.waivers.filter((item) => ["Requested", "Project Setup Required"].includes(item.status)).length || 0,
    review: data?.waivers.filter((item) => item.status.includes("Review") || item.status.includes("Payment May Proceed")).length || 0,
    blocked: data?.waivers.filter((item) => !["Approved — Unconditional", "Effective — Payment Cleared"].includes(item.status) && !item.data.ownerOverride).length || 0,
    complete: data?.waivers.filter((item) => ["Approved — Unconditional", "Effective — Payment Cleared"].includes(item.status)).length || 0,
  };

  async function post(action: string, payload: Record<string, unknown>, success: string) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/lien-waivers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, projectId, ...payload }) });
      const result = await response.json() as { error?: string; recordId?: string; unconditionalId?: string };
      if (!response.ok) throw new Error(result.error || "The Lien Waiver Action Could Not Be Saved");
      if (result.recordId) setSelectedId(result.recordId);
      if (result.unconditionalId) setSelectedId(result.unconditionalId);
      setNotice(success); await loadProject(projectId); return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The Lien Waiver Action Could Not Be Saved"); return null; }
    finally { setSaving(false); }
  }

  async function saveConfiguration() {
    const result = await post("configure-project", config, `${config.jurisdiction} ${config.projectClass} Routing Saved With Permanent Audit`);
    if (result) setRequestOpen(false);
  }

  function chooseVendor(vendorId: string) {
    const vendor = data?.vendors.find((item) => item.id === vendorId);
    setRequestDraft((current) => ({ ...current, vendorId, vendorName: vendor?.name || "", vendorEmail: vendor?.email || "", commitmentReference: vendor?.commitmentReference || "" }));
  }

  function chooseSubmission(submissionId: string) {
    const submission = data?.submissions.find((item) => item.id === submissionId);
    if (!submission) return;
    const vendor = data?.vendors.find((item) => item.id === submission.vendorId);
    setRequestDraft((current) => ({ ...current, linkedSubmissionId: submission.id, vendorId: submission.vendorId, vendorName: vendor?.name || current.vendorName, vendorEmail: vendor?.email || current.vendorEmail, commitmentReference: vendor?.commitmentReference || current.commitmentReference, payApplicationReference: submission.title, amount: String(submission.amount), throughDate: submission.periodEnd || current.throughDate, formType: submission.finalApplication ? "conditional-final" : "conditional-progress" }));
  }

  async function createRequest() {
    const result = await post("create-request", { ...requestDraft, amount: Number(requestDraft.amount), retainage: Number(requestDraft.retainage || 0) }, "Conditional Waiver Request Created And Permanently Linked");
    if (result) { setRequestOpen(false); setRequestDraft((current) => ({ ...current, payApplicationReference: "", linkedSubmissionId: "", amount: "", retainage: "", exceptions: "None" })); }
  }

  if (loading && !data) return <div className="waiver-loading"><span /><strong>Reconciling Pay Applications, Payments And Lien Releases…</strong></div>;

  if (!projects.length && !data) return <div className="lien-waiver-command">
    {error ? <div className="waiver-error"><span>{error}</span><button onClick={() => { setError(""); setLoading(true); void loadProjects().catch((caught) => { setError(caught instanceof Error ? caught.message : "Lien Waiver Projects Could Not Be Loaded"); setLoading(false); }); }}>Retry</button></div> : null}
    <section className="waiver-hero"><div><h1>Lien Waiver Command</h1></div><label>ACTIVE PROJECT<select value="" disabled><option>No Eligible Projects</option></select></label></section>
    <section className="waiver-no-projects">
      <span aria-hidden="true">LW</span>
      <div><h2>{error ? "Lien Waivers Could Not Load" : "No Eligible Projects Yet"}</h2><strong>{error ? "Use Retry To Reconnect To The Permanent Lien Waiver Register." : "Create Or Activate A Project First. Its Billing, Vendor Commitments, Payments, And Closeout Record Will Then Feed This Workspace Automatically."}</strong></div>
      {!error ? <b>Nothing Is Missing Or In Progress</b> : null}
    </section>
  </div>;

  return <div className="lien-waiver-command">
    {notice ? <div className="waiver-notice">✓ {notice}</div> : null}
    {error ? <div className="waiver-error">{error}<button onClick={() => setError("")}>×</button></div> : null}
    <section className="waiver-hero"><div><h1>Lien Waiver Command</h1></div>{!initialProjectId ? <label>ACTIVE PROJECT<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}</select></label> : null}</section>

    <section className="waiver-metrics">
      <article {...summaryDrilldownProps({ title: "Requested Lien Waivers", rows: (data?.waivers || []).filter((item) => ["Requested", "Project Setup Required"].includes(item.status)).map((item) => waiverSummaryRow(item, setSelectedId)) })}><strong>{counts.requested}</strong><span>REQUESTED</span><small>Awaiting vendor action or setup</small></article>
      <article {...summaryDrilldownProps({ title: "Lien Waiver Accounting Gates", rows: (data?.waivers || []).filter((item) => item.status.includes("Review") || item.status.includes("Payment May Proceed")).map((item) => waiverSummaryRow(item, setSelectedId)) })}><strong>{counts.review}</strong><span>ACCOUNTING GATES</span><small>Review or payment-ready</small></article>
      <article {...summaryDrilldownProps({ title: "Open Lien Waiver Controls", rows: (data?.waivers || []).filter((item) => !["Approved — Unconditional", "Effective — Payment Cleared"].includes(item.status) && !item.data.ownerOverride).map((item) => waiverSummaryRow(item, setSelectedId)) })}><strong>{counts.blocked}</strong><span>OPEN CONTROLS</span><small>Cannot silently clear</small></article>
      <article {...summaryDrilldownProps({ title: "Effective And Complete Lien Waivers", rows: (data?.waivers || []).filter((item) => ["Approved — Unconditional", "Effective — Payment Cleared"].includes(item.status)).map((item) => waiverSummaryRow(item, setSelectedId)) })}><strong>{counts.complete}</strong><span>EFFECTIVE / COMPLETE</span><small>Payment evidence preserved</small></article>
    </section>

    {!data?.control ? <section className="waiver-setup"><header><div><h2>Configure State And Project Claim Type</h2></div><b>SETUP GATE</b></header><ConfigurationForm config={config} onChange={setConfig} rules={data?.jurisdictions || []} disabled={saving} onSave={() => void saveConfiguration()} /></section> : <section className="waiver-rule"><div><span>{String(data.control.jurisdiction)}</span><div><p>{String(data.control.projectClass).toUpperCase()} PROJECT ROUTING</p><h2>{data.rule?.name} · {data.rule?.authority}</h2><small>{data.rule?.control}</small></div></div><div><b>COMPANION CONTROL</b><p>{data.rule?.companionRequirement}</p><a href={data.rule?.authorityUrl} target="_blank" rel="noreferrer">Open authority ↗</a></div><button onClick={() => setData((current) => current ? { ...current, control: null } : current)}>Review / Update Setup</button></section>}

    <section className="waiver-actions"><div><b>BRANDED FOUR-FORM STANDARD</b><span>Conditional Progress · Unconditional Progress · Conditional Final · Unconditional Final</span></div><button disabled={!data?.control || !data.permissions.canManage} onClick={() => setRequestOpen(true)}>＋ New Conditional Request</button></section>

    <div className="waiver-layout"><aside className="waiver-register"><header><div><h2>Billing-To-Closeout History</h2></div><b>{data?.waivers.length || 0}</b></header>{data?.waivers.map((waiver) => <button key={waiver.id} className={selectedId === waiver.id ? "active" : ""} onClick={() => { setSelectedId(waiver.id); setSignature({ signerName: "", signerTitle: "", signatureImage: "", signatureConsent: false }); setReviewNote(""); setOverrideReason(""); }}><i className={statusClass(waiver.status)}>{formLabels[String(waiver.data.formType)]?.split(" ")[0] || "FORM"}</i><span><b>{waiver.id}</b><strong>{String(waiver.data.vendorName || waiver.title)}</strong><small>{formLabels[String(waiver.data.formType)]} · {money.format(Number(waiver.data.amount || 0))}</small></span><em className={statusClass(waiver.status)}>{waiver.status}</em></button>)}{!data?.waivers.length ? <div className="waiver-empty"><b>No Waivers Yet</b><p>Project invoice and AIA pay-application intake will create conditional requests automatically.</p></div> : null}</aside><main className="waiver-detail">{selected ? <WaiverDetail waiver={selected} data={data!} saving={saving} signature={signature} payment={payment} reviewNote={reviewNote} overrideReason={overrideReason} onSignature={setSignature} onPayment={setPayment} onReviewNote={setReviewNote} onOverrideReason={setOverrideReason} onPost={post} /> : <div className="waiver-empty large"><b>Select A Waiver Record</b><p>The complete document, payment link, status gates, and permanent audit appear here.</p></div>}</main></div>

    {requestOpen ? <div className="waiver-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setRequestOpen(false)}><section className="waiver-modal" role="dialog" aria-modal="true" aria-labelledby="new-waiver-title"><header><div><h2 id="new-waiver-title">New Conditional Waiver Request</h2></div><button onClick={() => setRequestOpen(false)}>×</button></header><div className="waiver-form-grid"><label>Link Existing Portal Billing<select value={requestDraft.linkedSubmissionId} onChange={(event) => chooseSubmission(event.target.value)}><option value="">Create Manually</option>{data?.submissions.map((item) => <option key={item.id} value={item.id}>{item.title} · {money.format(item.amount)} · {item.status}</option>)}</select></label><label>Vendor / Subcontractor<select value={requestDraft.vendorId} onChange={(event) => chooseVendor(event.target.value)}><option value="">Select Vendor</option>{data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.trade || vendor.status}</option>)}</select></label><label>Conditional Form<select value={requestDraft.formType} onChange={(event) => setRequestDraft((current) => ({ ...current, formType: event.target.value }))}><option value="conditional-progress">Conditional Progress</option><option value="conditional-final">Conditional Final</option></select></label><label>Commitment Reference<input value={requestDraft.commitmentReference} onChange={(event) => setRequestDraft((current) => ({ ...current, commitmentReference: event.target.value }))} /></label><label>Invoice / Pay Application<input value={requestDraft.payApplicationReference} onChange={(event) => setRequestDraft((current) => ({ ...current, payApplicationReference: event.target.value }))} /></label><label>Through Date<input type="date" value={requestDraft.throughDate} onChange={(event) => setRequestDraft((current) => ({ ...current, throughDate: event.target.value }))} /></label><label>Payment Amount<CurrencyInput min="0" value={requestDraft.amount} onValueChange={(value) => setRequestDraft((current) => ({ ...current, amount: value }))} /></label><label>Retainage Excluded<CurrencyInput min="0" value={requestDraft.retainage} onValueChange={(value) => setRequestDraft((current) => ({ ...current, retainage: value }))} /></label><label className="wide">Express Exceptions / Disputed Claims<textarea rows={3} value={requestDraft.exceptions} onChange={(event) => setRequestDraft((current) => ({ ...current, exceptions: event.target.value }))} /></label><label className="wide">Lower-Tier Statement<textarea rows={3} value={requestDraft.lowerTierStatement} onChange={(event) => setRequestDraft((current) => ({ ...current, lowerTierStatement: event.target.value }))} /></label></div><div className="waiver-hard-block"><b>NO AUTOMATIC SEND OR APPROVAL</b><span>This creates the linked request and audit only. Vendor signature, Accounting review, payment, and any unconditional release remain separate actions.</span></div><footer><button onClick={() => setRequestOpen(false)}>Cancel</button><button className="primary" disabled={saving || !requestDraft.vendorId || !requestDraft.commitmentReference || !requestDraft.payApplicationReference || Number(requestDraft.amount) <= 0} onClick={() => void createRequest()}>{saving ? "Creating…" : "Create Controlled Request"}</button></footer></section></div> : null}
  </div>;
}

function waiverSummaryRow(item: Waiver, select: (id: string) => void) {
  return { id: item.id, title: String(item.data.vendorName || item.title), subtitle: `${formLabels[String(item.data.formType)] || "Lien Waiver"} · ${String(item.data.payApplicationReference || item.meta)}`, status: item.status, value: money.format(Number(item.data.amount || 0)), meta: `Due ${item.due}`, onOpen: () => select(item.id), openLabel: "Open Waiver →" };
}

function ConfigurationForm({ config, onChange, rules, disabled, onSave }: { config: { jurisdiction: string; projectClass: string; projectLegalName: string; projectAddress: string; legalDescription: string; titleCompanyRequirements: string }; onChange: (next: typeof config) => void; rules: Rule[]; disabled: boolean; onSave: () => void }) {
  return <div className="waiver-config-grid"><label>Project State<select value={config.jurisdiction} onChange={(event) => onChange({ ...config, jurisdiction: event.target.value })}>{rules.map((rule) => <option key={rule.state} value={rule.state}>{rule.state} · {rule.name}</option>)}</select></label><label>Claim Type<select value={config.projectClass} onChange={(event) => onChange({ ...config, projectClass: event.target.value })}><option>Private</option><option>Public / Bonded</option></select></label><label>Legal Project Name<input value={config.projectLegalName} onChange={(event) => onChange({ ...config, projectLegalName: event.target.value })} /></label><label>Project Address<input value={config.projectAddress} onChange={(event) => onChange({ ...config, projectAddress: event.target.value })} /></label><label className="wide">{config.projectClass === "Private" ? "Legal Description / Parcel Reference" : "Public Agency / Bond Reference"}<textarea rows={3} value={config.legalDescription} onChange={(event) => onChange({ ...config, legalDescription: event.target.value })} /></label><label className="wide">Title Company / Lender Companion Requirements<textarea rows={3} value={config.titleCompanyRequirements} onChange={(event) => onChange({ ...config, titleCompanyRequirements: event.target.value })} /></label><button disabled={disabled || !config.projectLegalName || !config.projectAddress || !config.legalDescription} onClick={onSave}>{disabled ? "Saving…" : "Save State Routing With Audit"}</button></div>;
}

function WaiverDetail({ waiver, data, saving, signature, payment, reviewNote, overrideReason, onSignature, onPayment, onReviewNote, onOverrideReason, onPost }: { waiver: Waiver; data: WorkspaceData; saving: boolean; signature: { signerName: string; signerTitle: string; signatureImage: string; signatureConsent: boolean }; payment: { paymentReference: string; paymentClearedDate: string }; reviewNote: string; overrideReason: string; onSignature: (next: typeof signature) => void; onPayment: (next: typeof payment) => void; onReviewNote: (value: string) => void; onOverrideReason: (value: string) => void; onPost: (action: string, payload: Record<string, unknown>, success: string) => Promise<unknown> }) {
  const formType = String(waiver.data.formType || "");
  const conditional = formType.startsWith("conditional-");
  const sig = waiver.data.signature && typeof waiver.data.signature === "object" ? waiver.data.signature as Record<string, unknown> : null;
  return <><header className="waiver-detail-head"><div><p>{waiver.id} · {String(waiver.data.jurisdiction || "STATE SETUP REQUIRED")}</p><h2>{formLabels[formType] || waiver.title}</h2><span>{String(waiver.data.vendorName || "Vendor Pending")} · {String(waiver.data.commitmentReference || "Commitment Pending")}</span></div><i className={statusClass(waiver.status)}>{waiver.status}</i></header><section className="waiver-facts"><div><span>Payment</span><b>{money.format(Number(waiver.data.amount || 0))}</b></div><div><span>Through Date</span><b>{dateLabel(String(waiver.data.throughDate || ""))}</b></div><div><span>Billing Link</span><b>{String(waiver.data.payApplicationReference || "—")}</b></div><div><span>Retainage Excluded</span><b>{money.format(Number(waiver.data.retainage || 0))}</b></div></section><section className="waiver-link-chain"><div><b>Project</b><span>{data.project.number}</span></div><i>→</i><div><b>Vendor</b><span>{String(waiver.data.vendorName)}</span></div><i>→</i><div><b>Commitment</b><span>{String(waiver.data.commitmentReference)}</span></div><i>→</i><div><b>Billing</b><span>{String(waiver.data.payApplicationReference)}</span></div><i>→</i><div><b>Payment / Closeout</b><span>{String(waiver.data.clearedPaymentReference || (formType.endsWith("final") ? "Final Gate" : "Pending"))}</span></div></section><section className="waiver-reservations"><article><b>Express Exceptions</b><p>{String(waiver.data.exceptions || "None")}</p></article><article><b>Lower-Tier Statement</b><p>{String(waiver.data.lowerTierStatement || "Not Recorded")}</p></article></section><section className="waiver-document-card"><div><span>ONE-PAGE BRANDED FORM</span><h3>{String(waiver.data.formVersion || "Project Setup Required")}</h3></div><button disabled={!waiver.data.jurisdiction} onClick={() => window.open(`/api/lien-waivers/document?projectId=${encodeURIComponent(data.project.number)}&recordId=${encodeURIComponent(waiver.id)}`, "_blank", "noopener,noreferrer")}>Open Form / Print PDF ↗</button></section>
    {!sig && ["Requested", "Project Setup Required"].includes(waiver.status) && waiver.status !== "Project Setup Required" ? <section className="waiver-step"><header><span>1</span><div><h3>Vendor Signature</h3></div></header><div><label>Signer Name<input value={signature.signerName} onChange={(event) => onSignature({ ...signature, signerName: event.target.value })} /></label><label>Signer Title<input value={signature.signerTitle} onChange={(event) => onSignature({ ...signature, signerTitle: event.target.value })} /></label><SignaturePad value={signature.signatureImage} onChange={(signatureImage) => onSignature({ ...signature, signatureImage })} label="Authorized Claimant Signature" /><label className="check"><input type="checkbox" checked={signature.signatureConsent} onChange={(event) => onSignature({ ...signature, signatureConsent: event.target.checked })} /><span>I am authorized to sign for the claimant and consent to this electronic signature.</span></label><button disabled={saving || !signature.signerName || !signature.signerTitle || !signature.signatureImage || !signature.signatureConsent} onClick={() => void onPost("record-signature", { recordId: waiver.id, ...signature }, "Vendor Signature Recorded For Accounting Review")}>Record Electronic Signature</button></div></section> : null}
    {waiver.status === "Signed — Accounting Review" && data.permissions.canAccountingReview ? <section className="waiver-step"><header><span>2</span><div><h3>Accounting Review</h3></div></header><textarea rows={3} value={reviewNote} onChange={(event) => onReviewNote(event.target.value)} placeholder="Review note" /><button className="financial" disabled={saving} onClick={() => void onPost("accounting-review", { recordId: waiver.id, reviewNote }, `${conditional ? "Conditional Payment Gate" : "Unconditional Release"} Approved`)}>Complete Financial Approval</button></section> : null}
    {conditional && ["Approved — Payment May Proceed", "Owner Override — Payment Authorized"].includes(waiver.status) && data.permissions.canAccountingReview ? <section className="waiver-step"><header><span>3</span><div><h3>Match Cleared Payment</h3></div></header><div><label>Cleared Date<input type="date" value={payment.paymentClearedDate} onChange={(event) => onPayment({ ...payment, paymentClearedDate: event.target.value })} /></label><label>Check / ACH / Card / Wire Reference<input value={payment.paymentReference} onChange={(event) => onPayment({ ...payment, paymentReference: event.target.value })} /></label><button className="financial" disabled={saving || !payment.paymentReference || !payment.paymentClearedDate} onClick={() => void onPost("record-payment-cleared", { recordId: waiver.id, ...payment }, "Cleared Payment Matched; Unconditional Request Created Without Automatic Signature")}>Record Final Payment Cleared</button></div></section> : null}
    {!waiver.data.ownerOverride && !["Approved — Unconditional", "Effective — Payment Cleared"].includes(waiver.status) && data.permissions.isCompanyOwner ? <details className="waiver-override"><summary>Company Owner Override</summary><p>A one-time override may authorize this payment exception, but it never creates, signs, or approves a missing waiver. The reason and Owner identity remain permanent.</p><textarea rows={3} value={overrideReason} onChange={(event) => onOverrideReason(event.target.value)} /><button disabled={saving || overrideReason.trim().length < 20} onClick={() => void onPost("owner-override", { recordId: waiver.id, reason: overrideReason }, "Audited Company Owner Override Recorded")}>Authorize Owner Override</button></details> : waiver.data.ownerOverride ? <section className="waiver-override-record"><b>ONE-TIME OWNER OVERRIDE</b><span>{String((waiver.data.ownerOverride as Record<string, unknown>).reason || "")}</span><small>This does not create or sign a waiver.</small></section> : null}
    <section className="waiver-audit"><header><h3>Permanent Audit Trail</h3><b>{waiver.auditHistory.length}</b></header>{waiver.auditHistory.map((audit) => <article key={audit.id}><span /><div><b>{audit.fieldName}</b><p>{audit.summary}</p><small>{audit.actorName} · {dateTime(audit.createdAt)}</small></div></article>)}{!waiver.auditHistory.length ? <div className="waiver-empty">No audit entries yet.</div> : null}</section></>;
}

function statusClass(value: string) { return value.toLowerCase().replaceAll(" ", "-").replaceAll("—", "-").replaceAll("/", "-"); }
function dateLabel(value: string) { if (!value) return "—"; const date = new Date(value.includes("T") ? value : `${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function dateTime(value: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
