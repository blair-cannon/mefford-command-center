"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CurrencyInput } from "./currency-input";
import { summaryDrilldownProps } from "./summary-drilldown";

type Actor = { name: string; email: string; accessLevel: string; designations: string[] };
type PurchaseOrderData = {
  vendorId: string; vendor: string; contactName: string; contactEmail: string; contactPhone: string; vendorAddress: string; amount: number; costCode: string; trade: string;
  scope: string; exclusions: string; deliveryLocation: string; requiredBy: string; paymentTerms: string;
  freightTerms: string; taxIncluded: string; warranty: string; specialInstructions: string; sourceSelectionId: string;
  approvalRequired: boolean; approvalReasons: string[]; budgetAvailableAtSubmit: number;
  ownerApproval: Record<string, unknown> | null; releasedAt: string; releasedBy: string; distributionReference: string;
  acknowledgedAt: string; acknowledgedBy: string; acknowledgmentReference: string;
  revisionOf: string; revisionNumber: number; supersededBy: string;
  timeline: Array<{ action: string; actor: string; at: string; detail: string }>;
};
type Audit = { id: number; fieldName: string; oldValue: string; newValue: string; reason: string; actorName: string; actorEmail: string; createdAt: string };
type Order = { id: string; title: string; owner: string; due: string; status: string; meta: string; updatedAt: string; data: PurchaseOrderData; invoicedAmount: number; paidAmount: number; audits: Audit[] };
type Workspace = {
  project: { number: string; name: string; projectManager: string; site: string };
  orders: Order[];
  vendors: Array<{ id: string; name: string; contactName: string; contactEmail: string; contactPhone: string; address: string; paymentTerms: string; status: string; shared: boolean; paymentHold?: boolean; temporaryApproval?: boolean }>;
  budget: { locked: boolean; lockedBy: string; codes: Array<{ code: string; description: string; budget: number; committed: number; available: number }> };
  permissions: { canView: boolean; canManage: boolean; canOwnerApprove: boolean; canRelease: boolean };
  controls: { threshold: number; ownerApproval: string; release: string; distribution: string; amendments: string; accounting: string };
};
type OrderDraft = { vendorId: string; amount: string; costCode: string; trade: string; scope: string; exclusions: string; deliveryLocation: string; requiredBy: string; paymentTerms: string; freightTerms: string; taxIncluded: string; warranty: string; specialInstructions: string };

const emptyDraft: OrderDraft = { vendorId: "", amount: "", costCode: "", trade: "", scope: "", exclusions: "", deliveryLocation: "", requiredBy: "", paymentTerms: "Net 30", freightTerms: "FOB Destination", taxIncluded: "Included", warranty: "Manufacturer standard warranty", specialInstructions: "" };

export function PurchaseOrderWorkspace({ project, actor }: { project: { number: string; name: string }; actor: Actor }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [editingId, setEditingId] = useState("");
  const [note, setNote] = useState("");
  const [distributionReference, setDistributionReference] = useState("");
  const [acknowledgment, setAcknowledgment] = useState({ acknowledgedBy: "", acknowledgmentReference: "" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/purchase-orders?projectId=${encodeURIComponent(project.number)}`, { cache: "no-store" });
      const result = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(result.error || "Purchase Orders Could Not Be Loaded");
      setWorkspace(result);
      setSelectedId((current) => current && result.orders.some((order) => order.id === current) ? current : result.orders[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Purchase Orders Could Not Be Loaded"); }
    finally { setLoading(false); }
  }, [project.number]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4200); return () => window.clearTimeout(timer); }, [notice]);

  const selected = useMemo(() => workspace?.orders.find((order) => order.id === selectedId) || null, [workspace, selectedId]);
  const totals = useMemo(() => ({
    draft: workspace?.orders.filter((order) => ["Draft", "Returned"].includes(order.status)).length || 0,
    approval: workspace?.orders.filter((order) => order.status === "Owner Approval Required").length || 0,
    released: workspace?.orders.filter((order) => ["Released", "Acknowledged"].includes(order.status)).length || 0,
    committed: workspace?.orders.filter((order) => ["Owner Approval Required", "Ready For Release", "Released", "Acknowledged"].includes(order.status)).reduce((sum, order) => sum + order.data.amount, 0) || 0,
  }), [workspace]);
  const selectedVendor = workspace?.vendors.find((vendor) => vendor.id === draft.vendorId) || null;

  async function post(action: string, payload: Record<string, unknown>, success: string) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, projectId: project.number, ...payload }) });
      const result = await response.json() as { error?: string; recordId?: string; revisionId?: string; documentUrl?: string };
      if (!response.ok) throw new Error(result.error || "The Purchase Order Action Could Not Be Saved");
      if (result.recordId || result.revisionId) setSelectedId(result.recordId || result.revisionId || "");
      setNotice(success); setNote(""); setDistributionReference(""); setAcknowledgment({ acknowledgedBy: "", acknowledgmentReference: "" });
      await load();
      if (result.documentUrl) window.open(result.documentUrl, "_blank", "noopener,noreferrer");
      return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The Purchase Order Action Could Not Be Saved"); return null; }
    finally { setSaving(false); }
  }

  function openCreate() { setEditingId(""); setDraft({ ...emptyDraft, deliveryLocation: workspace?.project.site || "" }); setFormOpen(true); }
  function openEdit(order: Order) { setEditingId(order.id); setDraft({ vendorId: order.data.vendorId, amount: String(order.data.amount), costCode: order.data.costCode, trade: order.data.trade, scope: order.data.scope, exclusions: order.data.exclusions, deliveryLocation: order.data.deliveryLocation, requiredBy: order.data.requiredBy, paymentTerms: order.data.paymentTerms, freightTerms: order.data.freightTerms, taxIncluded: order.data.taxIncluded, warranty: order.data.warranty, specialInstructions: order.data.specialInstructions }); setFormOpen(true); }
  function saveDraft() {
    const payload = { ...draft, amount: Number(draft.amount), recordId: editingId, reason: editingId ? "Draft commercial terms updated before submission" : "" };
    void post(editingId ? "update-draft" : "create", payload, editingId ? "Controlled Draft Updated" : "Controlled Purchase Order Draft Created").then((result) => result && setFormOpen(false));
  }

  if (loading && !workspace) return <div className="po-loading"><span /><strong>Loading The Controlled Purchase Order Register…</strong></div>;
  if (!workspace) return <div className="po-loading error"><strong>Purchase Orders Are Unavailable</strong><p>{error}</p><button onClick={() => void load()}>Try Again</button></div>;

  return <div className="po-workspace">
    {notice ? <div className="po-notice">✓ {notice}</div> : null}
    {error ? <div className="po-error">{error}<button onClick={() => setError("")}>×</button></div> : null}
    <section className="po-hero"><div><p>{project.name.toUpperCase()} · MATERIAL COMMITMENTS</p><h1>Purchase Orders</h1></div><div className={`po-budget-lock ${workspace.budget.locked ? "locked" : "open"}`}><b>{workspace.budget.locked ? "BUDGET LOCKED" : "DRAFTING OPEN"}</b><small>{workspace.budget.locked ? `Original budget locked${workspace.budget.lockedBy ? ` by ${workspace.budget.lockedBy}` : ""}` : "Create and edit drafts now; budget lock is required only when the PO is submitted."}</small></div></section>
    <section className="po-summary">
      <article {...summaryDrilldownProps({ title: "Draft And Returned Purchase Orders", rows: workspace.orders.filter((order) => ["Draft", "Returned"].includes(order.status)).map((order) => ({ id: order.id, title: order.data.vendor || order.title, subtitle: `${order.data.costCode || "No Cost Code"} · Due ${dateLabel(order.due)}`, status: order.status, value: money(order.data.amount), onOpen: () => setSelectedId(order.id), openLabel: "Open PO →" })) })}><span>DRAFT / RETURNED</span><strong>{totals.draft}</strong><small>Editable; no commitment released</small></article>
      <article {...summaryDrilldownProps({ title: "Purchase Orders Awaiting Owner Decision", rows: workspace.orders.filter((order) => order.status === "Owner Approval Required").map((order) => ({ id: order.id, title: order.data.vendor || order.title, subtitle: order.data.approvalReasons.join(" · ") || order.data.costCode, status: order.status, value: money(order.data.amount), onOpen: () => setSelectedId(order.id), openLabel: "Open PO →" })) })}><span>OWNER DECISIONS</span><strong className={totals.approval ? "risk" : ""}>{totals.approval}</strong><small>{money(workspace.controls.threshold)} threshold + budget exceptions</small></article>
      <article {...summaryDrilldownProps({ title: "Released Purchase Orders", rows: workspace.orders.filter((order) => ["Released", "Acknowledged"].includes(order.status)).map((order) => ({ id: order.id, title: order.data.vendor || order.title, subtitle: `${order.data.costCode} · ${order.data.acknowledgedBy || "Acknowledgment Pending"}`, status: order.status, value: money(order.data.amount), onOpen: () => setSelectedId(order.id), openLabel: "Open PO →" })) })}><span>RELEASED</span><strong>{totals.released}</strong><small>Available for AP matching</small></article>
      <article {...summaryDrilldownProps({ title: "Active Purchase Order Commitments", rows: workspace.orders.filter((order) => ["Owner Approval Required", "Ready For Release", "Released", "Acknowledged"].includes(order.status)).map((order) => ({ id: order.id, title: order.data.vendor || order.title, subtitle: `${order.data.costCode} · ${order.data.scope}`, status: order.status, value: money(order.data.amount), onOpen: () => setSelectedId(order.id), openLabel: "Open PO →" })) })}><span>ACTIVE COMMITMENTS</span><strong>{money(totals.committed)}</strong><small>Approval through acknowledgment</small></article>
    </section>
    <div className="po-layout"><aside className="po-register"><header><div><h2>All Orders</h2></div>{workspace.permissions.canManage ? <button onClick={openCreate}>＋ New PO</button> : null}</header>{workspace.orders.map((order) => <button key={order.id} className={selectedId === order.id ? "active" : ""} onClick={() => setSelectedId(order.id)}><div><b>{order.id}</b><strong>{order.data.vendor || order.title}</strong><small>{order.data.costCode || "No cost code"} · {money(order.data.amount)}</small></div><em className={statusClass(order.status)}>{order.status}</em></button>)}{!workspace.orders.length ? <div className="po-empty"><b>No Purchase Orders Yet</b></div> : null}</aside><main className="po-detail">{selected ? <OrderDetail order={selected} workspace={workspace} actor={actor} saving={saving} note={note} distributionReference={distributionReference} acknowledgment={acknowledgment} onNote={setNote} onDistribution={setDistributionReference} onAcknowledgment={setAcknowledgment} onEdit={() => openEdit(selected)} onPost={post} /> : <div className="po-empty detail"><b>Select A Purchase Order</b></div>}</main></div>
    {formOpen ? <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
      <section className="record-modal wide po-modal po-branded-form" role="dialog" aria-modal="true">
        <div className="po-form-brand"><div><b>MEFFORD CONTRACTING</b><h2>PURCHASE ORDER</h2><span>{project.name} · {project.number}</span></div><strong>{editingId || "NEW DRAFT"}</strong></div>
        <div className="modal-heading"><div><h2>{editingId ? "Update Purchase Order Draft" : "Create A Purchase Order"}</h2></div><button onClick={() => setFormOpen(false)}>×</button></div>
        <section className="po-form-section"><header><b>1</b><div><strong>Vendor Information</strong><span>All vendor records remain selectable, including temporary approvals. Missing compliance blocks payment, not project progress.</span></div></header><div className="field-grid"><label className="field-label wide">Vendor<select value={draft.vendorId} onChange={(event) => { const vendor = workspace.vendors.find((item) => item.id === event.target.value); setDraft((current) => ({ ...current, vendorId: event.target.value, paymentTerms: vendor?.paymentTerms || current.paymentTerms })); }}><option value="">Select vendor…</option>{workspace.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.temporaryApproval ? "Temporary Approval" : vendor.paymentHold ? "Payment Hold" : vendor.status}</option>)}</select></label>{selectedVendor ? <div className="po-vendor-preview wide"><article><span>CONTACT</span><b>{selectedVendor.contactName || "Not recorded"}</b><small>{selectedVendor.contactEmail || "No email"} · {selectedVendor.contactPhone || "No phone"}</small></article><article><span>VENDOR ADDRESS</span><b>{selectedVendor.address || "Not recorded"}</b><small>{selectedVendor.paymentHold ? "Payment hold until compliance is complete" : "Available for this order"}</small></article></div> : null}</div></section>
        <section className="po-form-section"><header><b>2</b><div><strong>Order & Delivery</strong><span>Required delivery date is the vendor commitment date, not a suggested target.</span></div></header><div className="field-grid"><label className="field-label">Purchase Price<CurrencyInput min="0.01" value={draft.amount} onValueChange={(value) => setDraft((current) => ({ ...current, amount: value }))} /></label><label className="field-label">Budget Cost Code<select value={draft.costCode} onChange={(event) => setDraft((current) => ({ ...current, costCode: event.target.value }))}><option value="">Select active cost code…</option>{workspace.budget.codes.map((code) => <option key={code.code} value={code.code}>{code.code} · {code.description} · {money(code.available)} available</option>)}</select></label><label className="field-label">Trade / Category<input value={draft.trade} onChange={(event) => setDraft((current) => ({ ...current, trade: event.target.value }))} placeholder="Materials, appliances, fixtures…" /></label><label className="field-label">Required Delivery Date<input type="date" value={draft.requiredBy} onChange={(event) => setDraft((current) => ({ ...current, requiredBy: event.target.value }))} /></label><label className="field-label wide">Delivery Location<input value={draft.deliveryLocation} onChange={(event) => setDraft((current) => ({ ...current, deliveryLocation: event.target.value }))} /></label></div></section>
        <section className="po-form-section"><header><b>3</b><div><strong>Material & Commercial Terms</strong><span>Keep the scope simple and exact enough for the vendor to acknowledge.</span></div></header><div className="field-grid"><label className="field-label wide">Material Scope / Description<textarea rows={4} value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))} placeholder="Describe the material, quantities, specifications, and included delivery…" /></label><label className="field-label">Payment Terms<input value={draft.paymentTerms} onChange={(event) => setDraft((current) => ({ ...current, paymentTerms: event.target.value }))} /></label><label className="field-label">Freight Terms<select value={draft.freightTerms} onChange={(event) => setDraft((current) => ({ ...current, freightTerms: event.target.value }))}>{["FOB Destination", "FOB Shipping Point", "Prepaid", "Collect", "Included In Price"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Sales Tax<select value={draft.taxIncluded} onChange={(event) => setDraft((current) => ({ ...current, taxIncluded: event.target.value }))}><option>Included</option><option>Excluded</option><option>Tax Exempt</option></select></label><label className="field-label">Warranty<input value={draft.warranty} onChange={(event) => setDraft((current) => ({ ...current, warranty: event.target.value }))} /></label><label className="field-label wide">Exclusions / Clarifications<textarea rows={2} value={draft.exclusions} onChange={(event) => setDraft((current) => ({ ...current, exclusions: event.target.value }))} /></label><label className="field-label wide">Special Delivery Instructions<textarea rows={2} value={draft.specialInstructions} onChange={(event) => setDraft((current) => ({ ...current, specialInstructions: event.target.value }))} /></label></div></section>
        <div className="form-rule"><strong>No automatic release:</strong> this saves a draft only. The live budget is revalidated at submission, then approval and vendor delivery are recorded separately.</div><div className="po-modal-actions"><button className="secondary-action" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !draft.vendorId || !draft.amount || !draft.costCode || draft.trade.trim().length < 2 || draft.scope.trim().length < 10 || !draft.requiredBy || draft.deliveryLocation.trim().length < 3} onClick={saveDraft}>{saving ? "Saving…" : editingId ? "Save Purchase Order Draft" : "Create Purchase Order Draft"}</button></div>
      </section>
    </div> : null}
  </div>;
}

function OrderDetail({ order, workspace, actor, saving, note, distributionReference, acknowledgment, onNote, onDistribution, onAcknowledgment, onEdit, onPost }: { order: Order; workspace: Workspace; actor: Actor; saving: boolean; note: string; distributionReference: string; acknowledgment: { acknowledgedBy: string; acknowledgmentReference: string }; onNote: (value: string) => void; onDistribution: (value: string) => void; onAcknowledgment: (value: { acknowledgedBy: string; acknowledgmentReference: string }) => void; onEdit: () => void; onPost: (action: string, payload: Record<string, unknown>, success: string) => Promise<unknown> }) {
  const data = order.data;
  const inactive = ["Cancelled", "Superseded"].includes(order.status);
  const canCancel = ["Company Owner", "Administrator"].includes(actor.accessLevel) && !inactive;
  return <>
    <section className="po-detail-head"><div><p>{order.id} · {data.trade || "PURCHASE ORDER"}</p><h2>{data.vendor || order.title}</h2><span>{data.scope || "Legacy procurement draft — complete the controlled commercial fields before submission."}</span></div><em className={statusClass(order.status)}>{order.status}</em></section>
    <section className="po-financials"><article><span>ORDER VALUE</span><strong>{money(data.amount)}</strong></article><article><span>INVOICED</span><strong>{money(order.invoicedAmount)}</strong></article><article><span>PAID / POSTED</span><strong>{money(order.paidAmount)}</strong></article><article><span>REMAINING</span><strong>{money(Math.max(0, data.amount - order.invoicedAmount))}</strong></article></section>
    <section className="po-fields"><article><span>COST CODE</span><b>{data.costCode || "Not Set"}</b><small>{budgetLabel(workspace, data.costCode)}</small></article><article><span>REQUIRED DELIVERY</span><b>{dateLabel(data.requiredBy)}</b><small>{data.deliveryLocation || "Delivery location not set"}</small></article><article><span>VENDOR CONTACT</span><b>{data.contactName || "Not recorded"}</b><small>{[data.contactEmail, data.contactPhone].filter(Boolean).join(" · ") || "Vendor contact not stored"}</small></article><article><span>COMMERCIAL TERMS</span><b>{data.paymentTerms || "Net 30"} · {data.freightTerms}</b><small>Tax: {data.taxIncluded} · {data.warranty}</small></article><article><span>SOURCE</span><b>{data.sourceSelectionId ? `Selection ${data.sourceSelectionId}` : "Direct Purchase Order"}</b><small>{data.vendorAddress || "Vendor address not recorded"}</small></article><article><span>REVISION CONTROL</span><b>{data.revisionNumber ? `Revision ${data.revisionNumber}` : "Original"}</b><small>{data.revisionOf ? `Revises ${data.revisionOf}` : data.supersededBy ? `Superseded by ${data.supersededBy}` : "Permanent original retained"}</small></article></section>
    <section className="po-scope"><div><p>MATERIAL SCOPE / DESCRIPTION</p><span>{data.scope || "Not completed"}</span></div><div><p>EXCLUSIONS / CLARIFICATIONS</p><span>{data.exclusions || "None recorded"}</span></div>{data.specialInstructions ? <div><p>SPECIAL DELIVERY INSTRUCTIONS</p><span>{data.specialInstructions}</span></div> : null}</section>
    {data.approvalReasons.length ? <section className="po-alert"><b>Owner Approval Gate</b><span>{data.approvalReasons.join(" · ")}. Available at submission: {money(data.budgetAvailableAtSubmit)}.</span></section> : null}
    <section className="po-actions"><header><div><h3>Next Authorized Step</h3></div><a href={`/api/purchase-orders/document?projectId=${encodeURIComponent(workspace.project.number)}&recordId=${encodeURIComponent(order.id)}`} target="_blank" rel="noreferrer">Open Controlled PDF ↗</a></header>
      {["Draft", "Returned"].includes(order.status) && workspace.permissions.canManage ? <div className="po-action-row"><div><b>Complete And Submit</b><span>Revalidates the live cost code, available budget, and $10,000.00 Owner threshold.</span></div><button className="secondary-action" onClick={onEdit}>Edit Draft</button><button className="primary-action" disabled={saving} onClick={() => void onPost("submit", { recordId: order.id }, "Purchase Order Routed To The Correct Approval Gate")}>Submit</button></div> : null}
      {order.status === "Owner Approval Required" && workspace.permissions.canOwnerApprove ? <div className="po-decision"><label>Owner Decision Note<textarea rows={3} value={note} onChange={(event) => onNote(event.target.value)} placeholder="Required for a return; recommended for approval" /></label><div><button className="secondary-action" disabled={saving || note.trim().length < 8} onClick={() => void onPost("owner-decision", { recordId: order.id, decision: "Returned", note }, "Purchase Order Returned With Owner Direction")}>Return To PM</button><button className="primary-action" disabled={saving} onClick={() => void onPost("owner-decision", { recordId: order.id, decision: "Approved", note }, "Owner Approval Permanently Recorded")}>Approve</button></div></div> : null}
      {order.status === "Owner Approval Required" && !workspace.permissions.canOwnerApprove ? <div className="po-awaiting"><b>Awaiting Company Owner Decision</b><span>No release or delivery can occur until the permanent decision is recorded.</span></div> : null}
      {order.status === "Ready For Release" && workspace.permissions.canRelease ? <div className="po-decision"><label>Manual Delivery / Distribution Reference<input value={distributionReference} onChange={(event) => onDistribution(event.target.value)} placeholder="e.g. Hand delivered; signed transmittal TR-204" /></label><div><button className="primary-action" disabled={saving || distributionReference.trim().length < 5} onClick={() => void onPost("release", { recordId: order.id, distributionReference }, "Purchase Order Released And Vendor Access Granted")}>Release + Open PDF</button></div></div> : null}
      {order.status === "Released" && workspace.permissions.canManage ? <div className="po-decision"><div className="po-two-fields"><label>Vendor Acknowledged By<input value={acknowledgment.acknowledgedBy} onChange={(event) => onAcknowledgment({ ...acknowledgment, acknowledgedBy: event.target.value })} /></label><label>Evidence Reference<input value={acknowledgment.acknowledgmentReference} onChange={(event) => onAcknowledgment({ ...acknowledgment, acknowledgmentReference: event.target.value })} placeholder="Email, signature, or call record" /></label></div><div><button className="primary-action" disabled={saving || acknowledgment.acknowledgedBy.trim().length < 2 || acknowledgment.acknowledgmentReference.trim().length < 5} onClick={() => void onPost("acknowledge", { recordId: order.id, ...acknowledgment }, "Vendor Acknowledgment Permanently Recorded")}>Record Acknowledgment</button></div></div> : null}
      {["Released", "Acknowledged"].includes(order.status) && workspace.permissions.canManage ? <div className="po-decision"><label>Revision Reason<textarea rows={2} value={note} onChange={(event) => onNote(event.target.value)} placeholder="Explain the commercial or scope change requiring a new controlled revision" /></label><div><button className="secondary-action" disabled={saving || note.trim().length < 10} onClick={() => void onPost("create-revision", { recordId: order.id, reason: note }, "New Revision Draft Created; Original Preserved")}>Create Linked Revision</button></div></div> : null}
      {canCancel ? <div className="po-decision danger"><label>Cancellation Reason<textarea rows={2} value={note} onChange={(event) => onNote(event.target.value)} placeholder="Permanent reason required" /></label><div><button className="danger-action" disabled={saving || note.trim().length < 10} onClick={() => void onPost("cancel", { recordId: order.id, reason: note }, "Purchase Order Cancelled With Permanent Reason")}>Cancel Purchase Order</button></div></div> : null}
    </section>
    <section className="po-audit"><header><div><h3>Audit Timeline</h3></div><span>{order.audits.length} database audit{order.audits.length === 1 ? "" : "s"}</span></header>{[...data.timeline].reverse().map((event, index) => <article key={`${event.at}-${event.action}-${index}`}><i /><div><b>{event.action}</b><span>{event.detail}</span><small>{event.actor} · {dateTimeLabel(event.at)}</small></div></article>)}{!data.timeline.length && !order.audits.length ? <div className="po-empty"><span>No audit events stored.</span></div> : null}<details><summary>Database Audit Detail</summary>{order.audits.map((audit) => <div key={audit.id}><b>{audit.fieldName}</b><span>{audit.oldValue} → {audit.newValue}</span><small>{audit.reason} · {audit.actorName} · {dateTimeLabel(audit.createdAt)}</small></div>)}</details></section>
  </>;
}

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)); }
function statusClass(status: string) { return status.toLowerCase().replaceAll(" ", "-"); }
function dateLabel(value: string) { if (!value) return "Not Set"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function dateTimeLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function budgetLabel(workspace: Workspace, code: string) { const row = workspace.budget.codes.find((item) => item.code === code); return row ? `${row.description} · ${money(row.available)} currently available` : "Cost code is not in the active budget"; }
