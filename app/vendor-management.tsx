"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountingActor } from "./accounting-erp";
import { CurrencyInput } from "./currency-input";
import { summaryDrilldownProps } from "./summary-drilldown";

type VendorDocument = {
  id: string;
  kind: string;
  fileName: string;
  status: string;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  reviewedBy: string;
  reviewedAt?: string | null;
};

type VendorAccess = {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  trade: string;
  contractReference: string;
  costCode: string;
  committedAmount: string;
  permissions: string[];
};

type VendorSubmission = {
  id: string;
  projectId: string;
  submissionType: string;
  title: string;
  amount: string;
  periodEnd?: string | null;
  status: string;
  attachmentName: string;
  apRecordId: string;
  submittedAt: string;
  payload: Record<string, unknown>;
};

type Vendor = {
  id: string;
  legalName: string;
  dbaName: string;
  vendorType: string;
  status: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  trades: string[];
  serviceAreas: string[];
  compliance: {
    blocked: boolean;
    missing: string[];
    expired: string[];
    activeOverride?: { id: string; reason: string; expiresAt: string } | null;
  };
  invites: Array<{ id: string; email: string; expiresAt: string; verifiedAt?: string | null; revokedAt?: string | null }>;
  documents: VendorDocument[];
  projectAccess: VendorAccess[];
  submissions: VendorSubmission[];
  overrides: Array<{ id: string; reason: string; projectId: string; expiresAt: string; ownerName: string; createdAt: string }>;
  audits: Array<{ id: number; action: string; detail: string; actorName: string; createdAt: string }>;
};

type ProjectOption = { number: string; name: string; manager: string; status: string };
type View = "Compliance" | "Projects" | "Billing" | "Audit";

const initialVendor = {
  legalName: "",
  dbaName: "",
  vendorType: "Subcontractor",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  trades: "",
  serviceAreas: "",
};

export function VendorManagementWorkspace({ actor }: { actor: AccountingActor }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<View>("Compliance");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [emailDelivery, setEmailDelivery] = useState("Connection Required");
  const [siteAccessNotice, setSiteAccessNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(initialVendor);
  const [inviteResult, setInviteResult] = useState<{ link: string; code: string; email: string; expiresAt: string } | null>(null);
  const [projectDraft, setProjectDraft] = useState({ projectId: "", trade: "", contractReference: "", costCode: "", committedAmount: "", designAccess: false });
  const [overrideDraft, setOverrideDraft] = useState({ projectId: "ALL", reason: "", expiresAt: "" });
  const [returnReason, setReturnReason] = useState<Record<string, string>>({});

  async function load(preferredId?: string) {
    setLoading(true);
    try {
      const response = await fetch("/api/vendors");
      const data = await response.json() as {
        vendors?: Vendor[];
        projects?: ProjectOption[];
        emailDelivery?: string;
        siteAccessNotice?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Vendor Records Are Unavailable.");
      const next = data.vendors || [];
      setVendors(next);
      setProjects((data.projects || []).filter((project) => project.status === "Active"));
      setEmailDelivery(data.emailDelivery || "Connection Required");
      setSiteAccessNotice(data.siteAccessNotice || "");
      setSelectedId((current) => preferredId || current || next[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Vendor Records Are Unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selected = vendors.find((vendor) => vendor.id === selectedId) || vendors[0];
  const summary = useMemo(() => ({
    approved: vendors.filter((vendor) => vendor.status === "Approved").length,
    blocked: vendors.filter((vendor) => vendor.compliance.blocked).length,
    expiring: vendors.filter((vendor) => vendor.compliance.expired.length).length,
    submissions: vendors.reduce((count, vendor) => count + vendor.submissions.filter((item) => !item.apRecordId && item.status !== "Returned To Vendor").length, 0),
  }), [vendors]);

  async function act(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string; vendorId?: string; oneTimeCode?: string; invite?: { id: string; email: string; expiresAt: string }; emailDelivery?: string };
      if (!response.ok) throw new Error(data.error || "The Vendor Action Could Not Be Saved.");
      if (data.invite && data.oneTimeCode) {
        setInviteResult({
          link: `${window.location.origin}/?vendorPortal=${data.invite.id}`,
          code: data.oneTimeCode,
          email: data.invite.email,
          expiresAt: data.invite.expiresAt,
        });
        setEmailDelivery(data.emailDelivery || emailDelivery);
      }
      setNotice(success);
      await load(data.vendorId || selected?.id);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Vendor Action Could Not Be Saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createVendor() {
    const ok = await act({
      action: "create-vendor",
      ...draft,
      trades: splitList(draft.trades),
      serviceAreas: splitList(draft.serviceAreas),
    }, `${draft.legalName || "Vendor"} Was Added As Prospective.`);
    if (ok) {
      setDraft(initialVendor);
      setCreateOpen(false);
    }
  }

  async function grantProject() {
    if (!selected) return;
    const ok = await act({
      action: "grant-project",
      vendorId: selected.id,
      ...projectDraft,
      committedAmount: Number(projectDraft.committedAmount || 0),
    }, selected.vendorType === "Project Owner" ? "Permanent Read-Only Owner Closeout And Warranty Access Saved." : "Project Scope Saved. Compliance May Hold Payment But Never Project Access Or Work.");
    if (ok) setProjectDraft({ projectId: "", trade: "", contractReference: "", costCode: "", committedAmount: "", designAccess: false });
  }

  async function createOverride() {
    if (!selected) return;
    const ok = await act(
      { action: "create-override", vendorId: selected.id, ...overrideDraft },
      "Vendor Temporarily Approved Without Face ID. The Approval Will Expire Automatically And Remain Permanently Audited.",
    );
    if (ok) setOverrideDraft({ projectId: "ALL", reason: "", expiresAt: "" });
  }

  async function endTemporaryApproval() {
    if (!selected?.compliance.activeOverride) return;
    await act(
      {
        action: "revoke-override",
        vendorId: selected.id,
        overrideId: selected.compliance.activeOverride.id,
      },
      "Temporary Vendor Approval Ended. Normal Compliance Blocks Were Reapplied.",
    );
  }

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="vendor-management">
      <section className="vendor-admin-hero">
        <div><h1>Vendor And Subcontractor Portal</h1></div>
        <button className="primary-action" onClick={() => setCreateOpen(true)}>＋ Add Vendor</button>
      </section>

      {notice ? <div className={/could not|requires|block|not found|expired/i.test(notice) ? "accounting-notice" : "inline-success"} role="status">{notice}</div> : null}

      <section className="vendor-admin-summary">
        <article {...summaryDrilldownProps({ title: "Approved Vendors", rows: vendors.filter((vendor) => vendor.status === "Approved").map((vendor) => vendorSummaryRow(vendor, setSelectedId)) })}><span>APPROVED</span><strong>{summary.approved}</strong><small>Selectable For Controlled Work</small></article>
        <article {...summaryDrilldownProps({ title: "Vendor Payment Holds", rows: vendors.filter((vendor) => vendor.compliance.blocked).map((vendor) => vendorSummaryRow(vendor, setSelectedId)) })}><span>PAYMENT HOLDS</span><strong>{summary.blocked}</strong><small>Project Work Continues; Payment Waits</small></article>
        <article {...summaryDrilldownProps({ title: "Expired Vendor Compliance", rows: vendors.filter((vendor) => vendor.compliance.expired.length).map((vendor) => vendorSummaryRow(vendor, setSelectedId)) })}><span>EXPIRED</span><strong>{summary.expiring}</strong><small>Current Insurance Or License Issue</small></article>
        <article {...summaryDrilldownProps({ title: "Vendor Billing Intake Waiting For Review", rows: vendors.flatMap((vendor) => vendor.submissions.filter((item) => !item.apRecordId && item.status !== "Returned To Vendor").map((item) => ({ id: item.id, title: item.title, subtitle: `${vendor.legalName} · ${item.projectId}`, status: item.status, value: currency.format(Number(item.amount || 0)), onOpen: () => setSelectedId(vendor.id), openLabel: "Open Vendor →" }))) })}><span>BILLING INTAKE</span><strong>{summary.submissions}</strong><small>Waiting For Mefford Review</small></article>
      </section>

      <section className="vendor-admin-shell">
        <aside className="vendor-roster">
          <div><strong>Company Master</strong><span>{loading ? "Loading…" : `${vendors.length} Records`}</span></div>
          {!loading && !vendors.length ? <div className="vendor-empty"><b>No Vendors Yet</b><span>Add the first prospective vendor to begin onboarding.</span></div> : null}
          {vendors.map((vendor) => (
            <button key={vendor.id} className={selected?.id === vendor.id ? "active" : ""} onClick={() => { setSelectedId(vendor.id); setInviteResult(null); }}>
              <span><b>{vendor.legalName}</b><small>{vendor.contactName} · {vendor.vendorType}</small></span>
              <i className={vendor.compliance.blocked ? "blocked" : "clear"}>{vendor.compliance.blocked ? "PAYMENT HOLD" : vendor.status.toUpperCase()}</i>
            </button>
          ))}
        </aside>

        <div className="vendor-detail">
          {!selected ? <div className="vendor-empty large"><b>Select Or Add A Vendor</b><span>Vendor controls and history will appear here.</span></div> : (
            <>
              <header className="vendor-detail-heading">
                <div><p>{selected.id.slice(0, 12).toUpperCase()}</p><h2>{selected.legalName}</h2><span>{selected.contactName} · {selected.contactEmail} · {selected.contactPhone || "Phone Needed"}</span></div>
                <div className="vendor-heading-actions">
                  <i className={selected.compliance.blocked ? "vendor-blocked" : "vendor-approved"}>{selected.compliance.blocked ? "PAYMENT HOLD" : "COMPLIANCE CLEAR"}</i>
                  <button className="secondary-action" disabled={saving} onClick={() => void act({ action: "create-invite", vendorId: selected.id }, "Controlled Portal Invite Prepared.")}>{saving ? "Preparing…" : "Create Portal Invite"}</button>
                </div>
              </header>

              {inviteResult ? (
                <section className="vendor-invite-result">
                  <div><p className="eyebrow orange-text">INVITE PREPARED FOR {inviteResult.email}</p><h3>Email Invite + One-Time Code</h3><span>Expires {formatDateTime(inviteResult.expiresAt)}. The code is shown once; the server stores only its hash.</span></div>
                  <label>Portal Link<input readOnly value={inviteResult.link} /></label>
                  <label>One-Time Code<input readOnly value={inviteResult.code} /></label>
                  <button className="secondary-action" onClick={() => void navigator.clipboard.writeText(`${inviteResult.link}\nOne-time code: ${inviteResult.code}`)}>Copy Invite</button>
                  <div className="permission-note"><strong>{emailDelivery === "Sent" ? "Operational Email Sent" : emailDelivery === "Connected" ? "Operational Email Connected" : emailDelivery === "Delivery Failed" ? "Email Delivery Failed" : "Email Connection Required"}</strong><span>{siteAccessNotice} {emailDelivery === "Sent" ? "The invite and one-time code were delivered through the approved operational email channel." : "Copy this invite through an approved channel when operational delivery is unavailable."}</span></div>
                </section>
              ) : null}

              <nav className="vendor-detail-tabs" aria-label="Vendor Detail">
                {(["Compliance", "Projects", "Billing", "Audit"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}{item === "Billing" && selected.submissions.length ? <b>{selected.submissions.length}</b> : null}</button>)}
              </nav>

              {view === "Compliance" ? (
                <div className="vendor-tab-content">
                  <section className={selected.compliance.blocked ? "vendor-gate-card blocked" : "vendor-gate-card clear"}>
                    <div><span>{selected.compliance.blocked ? "!" : "✓"}</span><div><strong>{selected.compliance.blocked ? "Vendor Payment Hold Active" : "Required Compliance Is Current"}</strong><p>{selected.compliance.blocked ? `Project selection, contracts, access, scheduling, field work, invoice intake, and AP review remain active. Payment cannot be approved until resolved. Missing: ${selected.compliance.missing.join(", ") || "None"}. Expired: ${selected.compliance.expired.join(", ") || "None"}.` : "Project workflows and payment may proceed through normal approval controls."}</p></div></div>
                    {selected.compliance.activeOverride ? <small>TEMPORARY APPROVAL · {selected.compliance.activeOverride.reason} · Expires {formatDateTime(selected.compliance.activeOverride.expiresAt)}</small> : null}
                  </section>
                  <section className="vendor-document-panel">
                    <div className="vendor-section-heading"><div><h3>Compliance And Closeout Documents</h3></div><span>{selected.documents.length} FILES</span></div>
                    {!selected.documents.length ? <div className="vendor-empty"><b>No Documents Uploaded</b></div> : null}
                    {selected.documents.map((document) => <div className="vendor-document-row" key={document.id}>
                      <span><b>{document.kind}</b><small><button className="vendor-file-link" onClick={() => window.open(`/api/vendor-portal/files?documentId=${encodeURIComponent(document.id)}`, "_blank", "noopener,noreferrer")}>{document.fileName}</button> · {document.expirationDate ? `Expires ${formatDate(document.expirationDate)}` : "No Expiration"}</small></span>
                      <i className={document.status.toLowerCase().replaceAll(" ", "-")}>{document.status}</i>
                      <span className="vendor-row-actions">{document.status === "Pending Review" ? <><button disabled={saving} onClick={() => void act({ action: "review-document", vendorId: selected.id, documentId: document.id, status: "Approved", reviewNote: "Reviewed in Vendor Management" }, `${document.kind} Approved.`)}>Approve</button><button disabled={saving} onClick={() => void act({ action: "review-document", vendorId: selected.id, documentId: document.id, status: "Rejected", reviewNote: "Replacement required" }, `${document.kind} Returned For Replacement.`)}>Reject</button></> : <small>{document.reviewedBy || "Review Complete"}</small>}</span>
                    </div>)}
                  </section>
                  <section className="vendor-override-panel">
                    <div><h3>Temporary Vendor Approval</h3></div>
                    {selected.compliance.activeOverride ? (
                      <div className="permission-note wide">
                        <strong>Temporary Approval Is Active</strong>
                        <span>{selected.compliance.activeOverride.reason} · Expires {formatDateTime(selected.compliance.activeOverride.expiresAt)}. The payment hold returns automatically at expiration; project work is never stopped.</span>
                        {actor.accessLevel === "Company Owner" ? <button className="secondary-action" disabled={saving} onClick={() => void endTemporaryApproval()}>End Temporary Approval Now</button> : null}
                      </div>
                    ) : (
                      <>
                        <label>Scope<select value={overrideDraft.projectId} onChange={(event) => setOverrideDraft((current) => ({ ...current, projectId: event.target.value }))}><option value="ALL">All Assigned Projects</option>{selected.projectAccess.map((item) => <option value={item.projectId} key={item.projectId}>{item.projectName}</option>)}</select></label>
                        <label>Approval Expires<input type="datetime-local" value={overrideDraft.expiresAt} onChange={(event) => setOverrideDraft((current) => ({ ...current, expiresAt: event.target.value }))} /></label>
                        <label className="wide">Specific Business Reason<textarea rows={3} value={overrideDraft.reason} onChange={(event) => setOverrideDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Explain why this vendor may proceed temporarily before compliance is complete" /></label>

                        <button
                          className="primary-action"
                          data-biometric-exempt="vendor-temporary-approval"
                          disabled={saving || actor.accessLevel !== "Company Owner" || overrideDraft.reason.trim().length < 12 || !overrideDraft.expiresAt}
                          onClick={() => void createOverride()}
                        >
                          {actor.accessLevel === "Company Owner" ? "Temporarily Approve Vendor" : "Company Owner Required"}
                        </button>
                      </>
                    )}
                  </section>
                </div>
              ) : null}

              {view === "Projects" ? (
                <div className="vendor-tab-content">
                  <section className="vendor-project-form">
                    <div className="vendor-section-heading"><div><h3>Explicit Project Access</h3></div></div>
                    <label>Project<select value={projectDraft.projectId} onChange={(event) => setProjectDraft((current) => ({ ...current, projectId: event.target.value }))}><option value="">Select Project</option>{projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}</select></label>

                    <label>Trade / Scope<input value={projectDraft.trade} onChange={(event) => setProjectDraft((current) => ({ ...current, trade: event.target.value }))} placeholder={selected.vendorType === "Project Owner" ? "Project Owner / Client" : "Trade or scope"} /></label>
                    <label>Subcontract / PO<input value={projectDraft.contractReference} onChange={(event) => setProjectDraft((current) => ({ ...current, contractReference: event.target.value }))} placeholder="SC-001 Or PO-001" /></label>
                    <label>Cost Code<input value={projectDraft.costCode} onChange={(event) => setProjectDraft((current) => ({ ...current, costCode: event.target.value }))} placeholder="2600.00" /></label>
                    <label>Committed Amount<CurrencyInput min="0" value={projectDraft.committedAmount} onValueChange={(value) => setProjectDraft((current) => ({ ...current, committedAmount: value }))} /></label>
                    <label className="vendor-design-access"><input type="checkbox" checked={projectDraft.designAccess} onChange={(event) => setProjectDraft((current) => ({ ...current, designAccess: event.target.checked }))} /><span><b>Design Review + Upload Access</b><small>Share only assigned design packages for controlled architect / engineer uploads and review.</small></span></label>
                    <button className="primary-action" disabled={saving || !projectDraft.projectId} onClick={() => void grantProject()}>Save Controlled Project Access</button>
                  </section>
                  <section className="vendor-project-grid">
                    {!selected.projectAccess.length ? <div className="vendor-empty"><b>No Project Access</b><span>This vendor cannot see or submit against any project yet.</span></div> : null}
                    {selected.projectAccess.map((access) => <article key={access.id}>
                      <header><span><b>{access.projectName}</b><small>{access.projectId}</small></span><i className={access.status.toLowerCase().replaceAll(" ", "-")}>{access.status}</i></header>
                      <dl><div><dt>Trade</dt><dd>{access.trade || "Not Assigned"}</dd></div><div><dt>Contract</dt><dd>{access.contractReference || "Not Assigned"}</dd></div><div><dt>Cost Code</dt><dd>{access.costCode || "Not Assigned"}</dd></div><div><dt>Commitment</dt><dd>{currency.format(Number(access.committedAmount || 0))}</dd></div></dl>
                      <footer>{access.permissions.map((permission) => <span key={permission}>{permission}</span>)}</footer>
                    </article>)}
                  </section>
                </div>
              ) : null}

              {view === "Billing" ? (
                <div className="vendor-tab-content">

                  <section className="vendor-submission-list">
                    {!selected.submissions.length ? <div className="vendor-empty"><b>No Billing Submitted</b><span>The vendor may submit only against explicitly shared projects.</span></div> : null}
                    {selected.submissions.map((submission) => <article key={submission.id}>
                      <header><div><p>{submission.submissionType.toUpperCase()} · {submission.projectId}</p><h3>{submission.title}</h3><span>Period {formatDate(submission.periodEnd || "")} · <button className="vendor-file-link" onClick={() => window.open(`/api/vendor-portal/files?submissionId=${encodeURIComponent(submission.id)}`, "_blank", "noopener,noreferrer")}>{submission.attachmentName}</button></span></div><strong>{currency.format(Number(submission.amount))}</strong></header>
                      <div className="vendor-submission-status"><i className={submission.status.toLowerCase().replaceAll(" ", "-")}>{submission.status}</i>{submission.apRecordId ? <span>AP Record {submission.apRecordId}</span> : null}</div>
                      {!submission.apRecordId && submission.status !== "Returned To Vendor" ? <footer><button className="primary-action" disabled={saving} onClick={() => void act({ action: "route-to-ap", vendorId: selected.id, submissionId: submission.id }, `${submission.title} Routed To AP Project Review${selected.compliance.blocked ? " With A Payment Hold" : ""}.`)}>Route To AP Project Review{selected.compliance.blocked ? " · Payment Hold" : ""}</button><input value={returnReason[submission.id] || ""} onChange={(event) => setReturnReason((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Return reason" /><button className="secondary-action" disabled={saving || (returnReason[submission.id] || "").trim().length < 5} onClick={() => void act({ action: "reject-submission", vendorId: selected.id, submissionId: submission.id, reason: returnReason[submission.id] }, `${submission.title} Returned To Vendor.`)}>Return</button></footer> : null}
                    </article>)}
                  </section>
                </div>
              ) : null}

              {view === "Audit" ? (
                <div className="vendor-tab-content"><section className="vendor-audit-list"><div className="vendor-section-heading"><div><h3>Permanent Vendor Audit</h3></div></div>{!selected.audits.length ? <div className="vendor-empty"><b>No Audit Events Yet</b></div> : selected.audits.map((event) => <article key={event.id}><span>{event.action.slice(0, 2).toUpperCase()}</span><div><b>{event.action}</b><p>{event.detail}</p><small>{event.actorName} · {formatDateTime(event.createdAt)}</small></div></article>)}</section></div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {createOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}><section className="record-modal vendor-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-vendor-title">
        <div className="modal-heading"><div><h2 id="create-vendor-title">Add Prospective Vendor</h2></div><button aria-label="Close" onClick={() => setCreateOpen(false)}>×</button></div>
        <div className="field-grid"><label className="field-label">Legal Company Name<input value={draft.legalName} onChange={(event) => setDraft((current) => ({ ...current, legalName: event.target.value }))} /></label><label className="field-label">DBA Name<input value={draft.dbaName} onChange={(event) => setDraft((current) => ({ ...current, dbaName: event.target.value }))} /></label></div>
        <div className="field-grid"><label className="field-label">Company Type<select value={draft.vendorType} onChange={(event) => setDraft((current) => ({ ...current, vendorType: event.target.value }))}><option>Subcontractor</option><option>Vendor</option><option>Both</option><option>Architect</option><option>Engineer</option><option>Design Consultant</option><option>Project Owner</option></select></label><label className="field-label">Primary Contact<input value={draft.contactName} onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))} /></label></div>
        <div className="field-grid"><label className="field-label">Portal Email<input type="email" value={draft.contactEmail} onChange={(event) => setDraft((current) => ({ ...current, contactEmail: event.target.value }))} /></label><label className="field-label">Phone<input value={draft.contactPhone} onChange={(event) => setDraft((current) => ({ ...current, contactPhone: event.target.value }))} /></label></div>
        <label className="field-label">Trades / Services<input value={draft.trades} onChange={(event) => setDraft((current) => ({ ...current, trades: event.target.value }))} placeholder="Electrical, Low Voltage" /><small>Separate with commas.</small></label>
        <label className="field-label">Service Areas<input value={draft.serviceAreas} onChange={(event) => setDraft((current) => ({ ...current, serviceAreas: event.target.value }))} placeholder="Kentucky, Southern Indiana" /></label>
        <div className="permission-note"><strong>No Banking Information</strong><span>This release does not collect bank credentials. Vendor banking changes remain outside the portal pending independent verification controls.</span></div>
        <div className="modal-actions"><button className="secondary-action" onClick={() => setCreateOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !draft.legalName || !draft.contactName || !draft.contactEmail} onClick={() => void createVendor()}>{saving ? "Saving…" : "Add Prospective Vendor"}</button></div>
      </section></div> : null}
    </div>
  );
}

function vendorSummaryRow(vendor: Vendor, select: (id: string) => void) {
  return { id: vendor.id, title: vendor.legalName, subtitle: `${vendor.vendorType} · ${vendor.trades.join(", ") || "Trade Not Set"}`, status: vendor.compliance.blocked ? "Payment Hold" : vendor.status, meta: [...vendor.compliance.missing, ...vendor.compliance.expired].join(" · ") || "Compliance current", onOpen: () => select(vendor.id), openLabel: "Open Vendor →" };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
