"use client";

import { useEffect, useMemo, useState } from "react";
import type { QualityQuestion, QualityResponse, QualityTemplate } from "../lib/quality-control";
import { summaryDrilldownProps } from "./summary-drilldown";

type Actor = { name: string; email: string; accessLevel: "Company Owner" | "Administrator" | "Employee"; designations: string[] };
type Vendor = { id: string; name: string; type: string; contactName: string; contactEmail: string; trade: string; projectStatus: string; permissions: string[]; qualityRole: string[]; complianceBlocked: boolean };
type QualityRecord = { id: string; title: string; owner: string; due: string; status: string; meta: string; recordDate: string; updatedAt: string; closeoutTracking?: boolean; data: Record<string, unknown>; auditHistory: Array<{ id: number; action: string; actor: string; at: string; summary: string }> };
type QualityData = {
  project: { number: string; name: string; projectManager: string; superintendent: string; substantialDate: string };
  permissions: { canView: boolean; canInitiate: boolean; canCompleteInspection: boolean; isPm: boolean; isSuperintendent: boolean; leadership: boolean };
  controls: Record<string, string>;
  templates: QualityTemplate[];
  inspections: QualityRecord[];
  items: QualityRecord[];
  vendors: Vendor[];
  closeout: { reachedSubstantialCompletion: boolean; openItemCount: number };
};

type View = "Pre-Work" | "Quality Items" | "Punch & Closeout" | "Portal Access" | "Template Library";

const initialItem = { title: "", description: "", exactLocation: "", inspectionStage: "Preparatory" as "Preparatory" | "Work-In-Place" | "Final", dueDate: "", responsibleTrade: "", responsibleVendorId: "", reference: "", requiresDesignerAcceptance: false, designerVendorId: "" };

export function QualityControlWorkspace({ project, actor }: { project: { number: string; name: string; projectManager: string; superintendent: string; substantialDate: string }; actor: Actor }) {
  const [data, setData] = useState<QualityData | null>(null);
  const [view, setView] = useState<View>("Pre-Work");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedInspectionId, setSelectedInspectionId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [itemDraft, setItemDraft] = useState(initialItem);
  const [itemBeforeFiles, setItemBeforeFiles] = useState<File[]>([]);
  const [responses, setResponses] = useState<QualityResponse[]>([]);
  const [inspectionDraft, setInspectionDraft] = useState({ exactLocation: "", responsibleTrade: "", responsibleVendorId: "", generalNotes: "", requiresDesignerAcceptance: false, designerVendorId: "" });
  const [inspectionPhotos, setInspectionPhotos] = useState<File[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState({ alternateChecklist: "", overrideTrade: "", overrideCompletionDate: "", overrideReason: "", overrideAttestation: false });
  const [portalDraft, setPortalDraft] = useState({ vendorId: "", portalRole: "Proposal" as "Proposal" | "Correction" | "Designer Acceptance" });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/quality-control?projectId=${encodeURIComponent(project.number)}`);
      const result = await response.json() as QualityData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Quality Control Is Unavailable");
      setData(result);
      setSelectedInspectionId((current) => current && result.inspections.some((item) => item.id === current) ? current : result.inspections[0]?.id || "");
      setSelectedItemId((current) => current && result.items.some((item) => item.id === current) ? current : result.items[0]?.id || "");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Quality Control Is Unavailable"); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [project.number]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(action: string, payload: Record<string, unknown>, success: string) {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/quality-control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, projectId: project.number, ...payload }) });
      const result = await response.json() as { error?: string; recordId?: string; status?: string; emailDelivery?: string };
      if (!response.ok) throw new Error(result.error || "The Quality Action Could Not Be Completed");
      setNotice(`${success}${result.emailDelivery ? ` · Email ${result.emailDelivery}` : ""}`);
      if (result.recordId) {
        if (action === "create-item") setSelectedItemId(result.recordId);
        else setSelectedInspectionId(result.recordId);
      }
      await load();
      return result;
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Quality Action Could Not Be Completed"); return null; }
    finally { setSaving(false); }
  }

  async function uploadPhotos(files: File[], category: string, revision: string) {
    const ids: number[] = [];
    for (const file of files) {
      const form = new FormData(); form.set("file", file); form.set("projectId", project.number); form.set("category", category); form.set("revision", revision); form.set("access", "Project Quality Team");
      const response = await fetch("/api/files", { method: "POST", body: form });
      const result = await response.json() as { file?: { id?: number }; error?: string };
      if (!response.ok || !result.file?.id) throw new Error(result.error || `${file.name} Could Not Be Stored`);
      ids.push(result.file.id);
    }
    return ids;
  }

  async function createItem() {
    setSaving(true); setNotice("");
    try {
      const beforePhotoFileIds = await uploadPhotos(itemBeforeFiles, "Quality Control / Before Evidence", `${itemDraft.title || "Quality Item"} · Before Evidence`);
      const result = await post("create-item", { ...itemDraft, beforePhotoFileIds }, data?.permissions.canInitiate ? "Formal Quality Item Created" : "Quality Proposal Sent To The PM");
      if (result) { setItemDraft(initialItem); setItemBeforeFiles([]); setNewItemOpen(false); setView("Quality Items"); }
    } finally { setSaving(false); }
  }

  const selectedInspection = data?.inspections.find((item) => item.id === selectedInspectionId) || null;
  const selectedTemplate = selectedInspection ? data?.templates.find((template) => template.id === String(selectedInspection.data.templateId || "")) || null : null;
  const selectedItem = data?.items.find((item) => item.id === selectedItemId) || null;
  const groupedQuestions = useMemo(() => selectedTemplate ? Array.from(new Set(selectedTemplate.questions.map((question) => question.group))).map((group) => ({ group, questions: selectedTemplate.questions.filter((question) => question.group === group) })) : [], [selectedTemplate]);
  const openInspections = data?.inspections.filter((item) => ["Superintendent Action Required", "Follow-Up Required"].includes(item.status)).length || 0;
  const openItems = data?.items.filter((item) => item.status !== "Closed").length || 0;
  const verificationCount = data?.items.filter((item) => item.status === "Verification Requested").length || 0;
  const failedCount = data?.inspections.filter((item) => item.status === "Failed — Follow-Up Required").length || 0;

  function selectInspection(item: QualityRecord) {
    setSelectedInspectionId(item.id);
    setResponses([]);
    setInspectionDraft({ exactLocation: String(item.data.scheduleActivityTitle || ""), responsibleTrade: String(item.data.responsibleTrade || ""), responsibleVendorId: "", generalNotes: "", requiresDesignerAcceptance: false, designerVendorId: "" });
    setInspectionPhotos([]);
    setOverrideOpen(false);
  }

  function setAnswer(question: QualityQuestion, answer: string) {
    setResponses((current) => [...current.filter((item) => item.questionId !== question.id), { questionId: question.id, answer, note: current.find((item) => item.questionId === question.id)?.note || "" }]);
  }

  function setResponseNote(question: QualityQuestion, note: string) {
    setResponses((current) => [...current.filter((item) => item.questionId !== question.id), { questionId: question.id, answer: current.find((item) => item.questionId === question.id)?.answer || "", note }]);
  }

  async function completeInspection() {
    if (!selectedInspection) return;
    setSaving(true); setNotice("");
    try {
      const beforePhotoFileIds = inspectionPhotos.length ? await uploadPhotos(inspectionPhotos, "Quality Control / Before Evidence", `${selectedInspection.id} · Inspection Evidence`) : [];
      const result = await post("complete-inspection", { recordId: selectedInspection.id, responses, ...inspectionDraft, beforePhotoFileIds }, "Inspection Attempt Permanently Recorded");
      if (result) { setResponses([]); setInspectionPhotos([]); }
    } finally { setSaving(false); }
  }

  if (loading && !data) return <div className="quality-loading">Loading Quality Control…</div>;

  return <div className="quality-workspace">
    <header className="quality-hero"><div><p>ITEM 6 · QUALITY CONTROL · {actor.name.toUpperCase()}</p><h1>Quality, Inspections & Punch</h1><span>{project.number} · {project.name} · Schedule-driven pre-work through final acceptance.</span></div><div><button onClick={() => setView("Template Library")}>16 Mefford Templates</button><button className="quality-primary" onClick={() => setNewItemOpen(true)}>＋ New Quality Item</button></div></header>
    {notice ? <div className={/could not|required|only|locked|unavailable/i.test(notice) ? "quality-notice error" : "quality-notice"}>{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
    <section className="quality-metrics">
      <article {...summaryDrilldownProps({ title: "Pre-Work To-Dos", rows: (data?.inspections || []).filter((item) => ["Superintendent Action Required", "Follow-Up Required"].includes(item.status)).map((item) => ({ id: item.id, title: item.title, subtitle: `${String(item.data.scheduleActivityTitle || "Manual Request")} · Due ${formatDate(item.due)}`, status: item.status, onOpen: () => { selectInspection(item); setView("Pre-Work"); }, openLabel: "Open Inspection →" })) })}><strong>{openInspections}</strong><span>PRE-WORK TO-DOS</span><small>Complete or qualified override</small></article>
      <article {...summaryDrilldownProps({ title: "Failed Quality Attempts", rows: (data?.inspections || []).filter((item) => item.status === "Failed — Follow-Up Required").map((item) => ({ id: item.id, title: item.title, subtitle: `${String(item.data.scheduleActivityTitle || "Inspection")} · ${formatDate(item.due)}`, status: item.status, onOpen: () => { selectInspection(item); setView("Pre-Work"); }, openLabel: "Open Attempt →" })) })}><strong>{failedCount}</strong><span>FAILED ATTEMPTS</span><small>Permanent follow-up required</small></article>
      <article {...summaryDrilldownProps({ title: "Field Verifications", rows: (data?.items || []).filter((item) => item.status === "Verification Requested").map((item) => ({ id: item.id, title: item.title, subtitle: `${String(item.data.exactLocation || "Location Required")} · Due ${formatDate(item.due)}`, status: item.status, onOpen: () => { setSelectedItemId(item.id); setView("Quality Items"); }, openLabel: "Open Quality Item →" })) })}><strong>{verificationCount}</strong><span>FIELD VERIFICATIONS</span><small>Waiting on Superintendent</small></article>
      <article {...summaryDrilldownProps({ title: "Open Quality Items", rows: (data?.items || []).filter((item) => item.status !== "Closed").map((item) => ({ id: item.id, title: item.title, subtitle: `${String(item.data.exactLocation || "Location Required")} · ${String(item.data.responsibleTrade || "Unassigned")}`, status: item.status, onOpen: () => { setSelectedItemId(item.id); setView("Quality Items"); }, openLabel: "Open Quality Item →" })) })}><strong>{openItems}</strong><span>OPEN QUALITY ITEMS</span><small>{data?.closeout.reachedSubstantialCompletion ? "In final punch tracking" : "Warn billing · block final"}</small></article>
    </section>
    <nav className="quality-tabs">{(["Pre-Work", "Quality Items", "Punch & Closeout", "Portal Access", "Template Library"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}{item === "Pre-Work" && openInspections ? <b>{openInspections}</b> : item === "Quality Items" && openItems ? <b>{openItems}</b> : null}</button>)}</nav>

    {view === "Pre-Work" ? <div className="quality-register-layout">
      <aside className="quality-register"><header><h2>Schedule-Triggered Requests</h2><span>{data?.inspections.length || 0} ATTEMPTS</span></header>{!data?.inspections.length ? <div className="quality-empty"><b>No Pre-Work Requests Yet</b><p>Assign a mandatory Quality Category to a schedule activity. Applicable categories create the Superintendent to-do automatically.</p></div> : data.inspections.map((item) => <button key={item.id} className={selectedInspectionId === item.id ? "active" : ""} onClick={() => selectInspection(item)}><span><b>{item.id}</b><strong>{item.title}</strong><small>{String(item.data.qualityCategoryLabel || item.data.templateTitle || "Pre-Work")} · Due {formatDate(item.due)}</small></span><i className={statusClass(item.status)}>{item.status}</i></button>)}</aside>
      <main className="quality-detail">{!selectedInspection ? <div className="quality-empty large"><b>Select A Pre-Work Request</b></div> : <>
        <header className="quality-detail-heading"><div><p>{selectedInspection.id} · {String(selectedInspection.data.scheduleActivityId || "MANUAL QUALITY REQUEST")}</p><h2>{selectedInspection.title}</h2><span>{selectedTemplate?.timing || "Controlled pre-work inspection"}</span></div><i className={statusClass(selectedInspection.status)}>{selectedInspection.status}</i></header>
        <section className="quality-link-strip"><div><span>Schedule Activity</span><b>{String(selectedInspection.data.scheduleActivityTitle || "Manual")}</b></div><div><span>Responsible Trade</span><b>{String(selectedInspection.data.responsibleTrade || "Assign During Inspection")}</b></div><div><span>Due Before Work</span><b>{formatDate(selectedInspection.due)}</b></div><div><span>Attempt</span><b>{String(selectedInspection.data.attemptNumber || 1)}</b></div></section>
        {selectedInspection.status === "Failed — Follow-Up Required" && data?.permissions.canCompleteInspection ? <section className="quality-failure-banner"><div><b>Unsatisfactory Attempt Preserved</b><span>Start a new inspection attempt.</span></div><button disabled={saving} onClick={() => void post("repeat-inspection", { recordId: selectedInspection.id }, "New Follow-Up Attempt Created")}>Start Required New Attempt</button></section> : null}
        {["Superintendent Action Required", "Follow-Up Required"].includes(selectedInspection.status) && data?.permissions.canCompleteInspection && selectedTemplate ? <>
          <section className="inspection-context"><label>Exact Work Location<input value={inspectionDraft.exactLocation} onChange={(event) => setInspectionDraft((current) => ({ ...current, exactLocation: event.target.value }))} placeholder="Example: West wall · Grid A/4–A/8" /></label><label>Responsible Trade<input value={inspectionDraft.responsibleTrade} onChange={(event) => setInspectionDraft((current) => ({ ...current, responsibleTrade: event.target.value }))} /></label><label>Responsible Company<select value={inspectionDraft.responsibleVendorId} onChange={(event) => setInspectionDraft((current) => ({ ...current, responsibleVendorId: event.target.value }))}><option value="">Mefford / Not Yet Assigned</option>{data.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label></section>
          <section className="inspection-form"><header><div><h3>{selectedTemplate.title}</h3><p>{selectedTemplate.questions.length} controlled requirements from {selectedTemplate.sourceDocument}</p></div><span>{responses.filter((item) => item.answer).length}/{selectedTemplate.questions.length}</span></header>{groupedQuestions.map(({ group, questions }) => <div className="inspection-group" key={group}><h4>{group}</h4>{questions.map((question, index) => { const response = responses.find((item) => item.questionId === question.id); return <article key={question.id}><span className="question-number">{index + 1}</span><div><b>{question.label}</b>{question.input === "check" ? <div className="inspection-answers">{["Yes", "No", "N/A"].map((answer) => <button type="button" key={answer} className={response?.answer === answer ? answer === "No" ? "active no" : "active" : ""} onClick={() => setAnswer(question, answer)}>{answer}</button>)}</div> : question.input === "choice" ? <select value={response?.answer || ""} onChange={(event) => setAnswer(question, event.target.value)}><option value="">Select Required Answer</option>{question.choices?.map((answer) => <option key={answer}>{answer}</option>)}</select> : <input value={response?.answer || ""} onChange={(event) => setAnswer(question, event.target.value)} />}{question.input === "check" && ["No", "N/A"].includes(response?.answer || "") ? <textarea rows={2} value={response?.note || ""} onChange={(event) => setResponseNote(question, event.target.value)} placeholder={response?.answer === "No" ? "Describe the deficiency or condition" : "Required N/A justification"} /> : null}</div></article>})}</div>)}</section>
          <section className="inspection-evidence"><label>General Inspection Notes<textarea rows={4} value={inspectionDraft.generalNotes} onChange={(event) => setInspectionDraft((current) => ({ ...current, generalNotes: event.target.value }))} /></label><label className="quality-file-picker"><input type="file" accept="image/*" multiple onChange={(event) => setInspectionPhotos(Array.from(event.target.files || []))} /><b>＋ Inspection / Before Photos</b><span>{inspectionPhotos.length ? `${inspectionPhotos.length} selected` : "Required when any answer is No"}</span></label></section>
          <div className="quality-actions"><button onClick={() => setOverrideOpen(true)}>Document Qualified Override</button><button className="quality-primary" disabled={saving} onClick={() => void completeInspection()}>{saving ? "Recording…" : "Complete And Lock This Attempt"}</button></div>
        </> : <section className="quality-readonly"><h3>Permanent Disposition</h3><p>{selectedInspection.status === "Override Documented" ? `${String((selectedInspection.data.override as Record<string, unknown> | undefined)?.alternateChecklist || "Alternate full-scope checklist")} · ${String((selectedInspection.data.override as Record<string, unknown> | undefined)?.trade || "Trade")} · ${formatDate(String((selectedInspection.data.override as Record<string, unknown> | undefined)?.completionDate || ""))}` : `${String(selectedInspection.data.result || selectedInspection.status)} · Completed by ${String(selectedInspection.data.completedBy || selectedInspection.owner)}`}</p><AuditTrail record={selectedInspection} /></section>}
      </>}</main>
    </div> : null}

    {view === "Quality Items" ? <div className="quality-register-layout"><aside className="quality-register"><header><h2>Deficiency Register</h2><span>{data?.items.length || 0} ITEMS</span></header>{!data?.items.length ? <div className="quality-empty"><b>No Quality Items Yet</b><p>PMs and Superintendents create formal items. Others submit for PM validation.</p></div> : data.items.map((item) => <button key={item.id} className={selectedItemId === item.id ? "active" : ""} onClick={() => setSelectedItemId(item.id)}><span><b>{item.id}</b><strong>{item.title}</strong><small>{String(item.data.exactLocation || "Location Required")} · {String(item.data.responsibleTrade || "Unassigned")}</small></span><i className={statusClass(item.status)}>{item.status}</i></button>)}</aside><main className="quality-detail">{selectedItem ? <QualityItemDetail key={selectedItem.id} item={selectedItem} data={data!} saving={saving} onPost={post} /> : <div className="quality-empty large"><b>Select A Quality Item</b></div>}</main></div> : null}

    {view === "Punch & Closeout" ? <section className="punch-closeout"><header><div><p>SUBSTANTIAL COMPLETION · {formatDate(project.substantialDate)}</p><h2>Final Punch & Closeout Tracking</h2></div><i className={data?.closeout.reachedSubstantialCompletion ? "active" : "upcoming"}>{data?.closeout.reachedSubstantialCompletion ? "ACTIVE CLOSEOUT TRACKING" : "UPCOMING"}</i></header><div className="punch-columns">{["Open", "Awaiting Verification", "Acceptance", "Closed"].map((column) => <section key={column}><h3>{column}</h3>{data?.items.filter((item) => punchColumn(item.status) === column).map((item) => <button key={item.id} onClick={() => { setSelectedItemId(item.id); setView("Quality Items"); }}><b>{item.id}</b><span>{item.title}</span><small>{String(item.data.exactLocation || "")} · {String(item.data.responsibleTrade || "")}</small><i>{item.status}</i></button>)}{!data?.items.some((item) => punchColumn(item.status) === column) ? <div className="quality-empty mini">No Items</div> : null}</section>)}</div></section> : null}

    {view === "Portal Access" ? <section className="quality-portal-access"><header><div><h2>Owner, Designer & Trade Participation</h2></div></header><div className="quality-portal-grant"><label>Vendor / Consultant Directory<select value={portalDraft.vendorId} onChange={(event) => setPortalDraft((current) => ({ ...current, vendorId: event.target.value }))}><option value="">Select Company</option>{data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.type}</option>)}</select></label><label>Quality Role<select value={portalDraft.portalRole} onChange={(event) => setPortalDraft((current) => ({ ...current, portalRole: event.target.value as typeof portalDraft.portalRole }))}><option>Proposal</option><option>Correction</option><option>Designer Acceptance</option></select></label><button className="quality-primary" disabled={saving || !portalDraft.vendorId || !data?.permissions.isPm} onClick={() => void post("grant-quality-access", portalDraft, "Controlled Quality Portal Access Granted")}>Grant & Send Secure Access</button></div><div className="quality-access-list">{data?.vendors.filter((vendor) => vendor.qualityRole.length).map((vendor) => <article key={vendor.id}><div><b>{vendor.name}</b><span>{vendor.contactName} · {vendor.contactEmail}</span></div><div>{vendor.qualityRole.map((role) => <i key={role}>{role}</i>)}</div><strong>{vendor.projectStatus}</strong></article>)}{!data?.vendors.some((vendor) => vendor.qualityRole.length) ? <div className="quality-empty"><b>No Quality Portal Roles Granted</b></div> : null}</div></section> : null}

    {view === "Template Library" ? <section className="quality-template-library"><header><div><h2>Mefford Pre-Work Template Library</h2></div><span>{data?.templates.length || 0} STANDARD TEMPLATES</span></header><div>{data?.templates.map((template) => <article key={template.id}><span>{template.shortTitle.slice(0, 2).toUpperCase()}</span><div><b>{template.title}</b><small>{template.questions.length} requirements · {template.sourceDocument}</small><p>{template.timing}</p></div><i>SCHEDULE CATEGORY</i></article>)}</div></section> : null}

    {newItemOpen ? <div className="quality-modal-layer"><section className="quality-modal" role="dialog" aria-modal="true" aria-labelledby="quality-item-title"><header><div><p>{data?.permissions.canInitiate ? "PM / SUPERINTENDENT FORMAL INITIATION" : "SUBMIT FOR PM VALIDATION"}</p><h2 id="quality-item-title">New Quality Item</h2></div><button aria-label="Close Quality Item" onClick={() => setNewItemOpen(false)}>×</button></header><div className="quality-form-grid"><label>Title<input autoFocus value={itemDraft.title} onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Inspection Stage<select value={itemDraft.inspectionStage} onChange={(event) => setItemDraft((current) => ({ ...current, inspectionStage: event.target.value as typeof itemDraft.inspectionStage }))}><option>Preparatory</option><option>Work-In-Place</option><option>Final</option></select></label><label className="wide">Description<textarea rows={4} value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} /></label><label>Exact Location<input value={itemDraft.exactLocation} onChange={(event) => setItemDraft((current) => ({ ...current, exactLocation: event.target.value }))} placeholder="Building / level / room / grid" /></label><label>Due Date<input type="date" value={itemDraft.dueDate} onChange={(event) => setItemDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label><label>Responsible Trade<input value={itemDraft.responsibleTrade} onChange={(event) => setItemDraft((current) => ({ ...current, responsibleTrade: event.target.value }))} /></label><label>Responsible Company<select value={itemDraft.responsibleVendorId} onChange={(event) => setItemDraft((current) => ({ ...current, responsibleVendorId: event.target.value }))}><option value="">Mefford / Assign During Validation</option>{data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label>Drawing / Spec / Commissioning Reference<input value={itemDraft.reference} onChange={(event) => setItemDraft((current) => ({ ...current, reference: event.target.value }))} /></label><label className="quality-check"><input type="checkbox" checked={itemDraft.requiresDesignerAcceptance} onChange={(event) => setItemDraft((current) => ({ ...current, requiresDesignerAcceptance: event.target.checked }))} /><span>Designer acceptance is required because this item affects design, specifications, or commissioning.</span></label>{itemDraft.requiresDesignerAcceptance ? <label>Accepting Designer<select value={itemDraft.designerVendorId} onChange={(event) => setItemDraft((current) => ({ ...current, designerVendorId: event.target.value }))}><option value="">Select Designer</option>{data?.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label> : null}<label className="quality-file-picker wide"><input type="file" accept="image/*" multiple onChange={(event) => setItemBeforeFiles(Array.from(event.target.files || []))} /><b>＋ Required Before Photos</b><span>{itemBeforeFiles.length ? `${itemBeforeFiles.length} selected` : "Exact-condition evidence required"}</span></label></div><footer><button onClick={() => setNewItemOpen(false)}>Cancel</button><button className="quality-primary" disabled={saving || !itemBeforeFiles.length} onClick={() => void createItem()}>{saving ? "Saving…" : data?.permissions.canInitiate ? "Create Formal Quality Item" : "Submit For PM Validation"}</button></footer></section></div> : null}

    {overrideOpen && selectedInspection ? <div className="quality-modal-layer"><section className="quality-modal override" role="dialog" aria-modal="true" aria-labelledby="quality-override-title"><header><div><h2 id="quality-override-title">Document Qualified Checklist Override</h2></div><button aria-label="Close Checklist Override" onClick={() => setOverrideOpen(false)}>×</button></header><div className="quality-override-rule"><b>A vague “not needed” will not be accepted.</b><span>Identify the alternate full-scope checklist or meeting, the affected trade, its completion date, and why it fully satisfies this schedule prompt.</span></div><div className="quality-form-grid"><label className="wide">Alternate Full-Scope Checklist / Meeting<input value={overrideDraft.alternateChecklist} onChange={(event) => setOverrideDraft((current) => ({ ...current, alternateChecklist: event.target.value }))} placeholder="Example: Full-scope concrete pre-pour meeting and checklist" /></label><label>Affected Trade<input value={overrideDraft.overrideTrade} onChange={(event) => setOverrideDraft((current) => ({ ...current, overrideTrade: event.target.value }))} placeholder="Example: CK Concrete" /></label><label>Completion Date<input type="date" max={new Date().toISOString().slice(0, 10)} value={overrideDraft.overrideCompletionDate} onChange={(event) => setOverrideDraft((current) => ({ ...current, overrideCompletionDate: event.target.value }))} /></label><label className="wide">Specific Reason<textarea rows={5} value={overrideDraft.overrideReason} onChange={(event) => setOverrideDraft((current) => ({ ...current, overrideReason: event.target.value }))} placeholder="Example: Completed the full-scope concrete checklist with CK Concrete on 10/14; it covers this west wall pour and no scope changed." /></label><label className="quality-check wide"><input type="checkbox" checked={overrideDraft.overrideAttestation} onChange={(event) => setOverrideDraft((current) => ({ ...current, overrideAttestation: event.target.checked }))} /><span>I attest that the identified full-scope review covers this exact schedule activity. I understand my name, timestamp, reason, and this disposition become a permanent project audit.</span></label></div><footer><button onClick={() => setOverrideOpen(false)}>Cancel</button><button className="quality-primary" disabled={saving || !overrideDraft.overrideAttestation} onClick={() => void post("record-inspection-override", { recordId: selectedInspection.id, ...overrideDraft }, "Qualified Superintendent Override Permanently Recorded").then((result) => result && setOverrideOpen(false))}>{saving ? "Recording…" : "Attest, Record & Lock Override"}</button></footer></section></div> : null}
  </div>;
}

function QualityItemDetail({ item, data, saving, onPost }: { item: QualityRecord; data: QualityData; saving: boolean; onPost: (action: string, payload: Record<string, unknown>, success: string) => Promise<unknown> }) {
  const [decision, setDecision] = useState<"Accept" | "Reject">("Accept");
  const [comments, setComments] = useState("");
  const [assignment, setAssignment] = useState({ responsibleTrade: String(item.data.responsibleTrade || ""), responsibleVendorId: String(item.data.responsibleVendorId || ""), requiresDesignerAcceptance: item.data.requiresDesignerAcceptance === true, designerVendorId: String(item.data.designerVendorId || "") });
  const before = Array.isArray(item.data.beforePhotoFileIds) ? item.data.beforePhotoFileIds.map(Number) : [];
  const after = Array.isArray(item.data.afterPhotoFileIds) ? item.data.afterPhotoFileIds.map(Number) : [];
  return <><header className="quality-detail-heading"><div><p>{item.id} · {String(item.data.inspectionStage || "QUALITY")}</p><h2>{item.title}</h2><span>{String(item.data.description || "")}</span></div><i className={statusClass(item.status)}>{item.status}</i></header><section className="quality-link-strip"><div><span>Exact Location</span><b>{String(item.data.exactLocation || "—")}</b></div><div><span>Responsible Trade</span><b>{String(item.data.responsibleTrade || "Unassigned")}</b></div><div><span>Due</span><b>{formatDate(item.due)}</b></div><div><span>Final Payment</span><b>{item.status === "Closed" ? "Released From Quality Gate" : "HARD BLOCK"}</b></div></section><section className="quality-evidence-pair"><div><header><b>Before Evidence</b><span>{before.length} PHOTO{before.length === 1 ? "" : "S"}</span></header>{before.map((id) => <button key={id} onClick={() => window.open(`/api/files?id=${id}`, "_blank", "noopener,noreferrer")}><span>BEFORE</span><b>Open Photo {id} ↗</b></button>)}</div><div><header><b>After Evidence</b><span>{after.length} PHOTO{after.length === 1 ? "" : "S"}</span></header>{after.map((id) => <button key={id} onClick={() => window.open(`/api/files?id=${id}`, "_blank", "noopener,noreferrer")}><span>AFTER</span><b>Open Photo {id} ↗</b></button>)}{!after.length ? <div className="quality-empty mini">Trade Correction Package Required</div> : null}</div></section>{item.status === "Proposed — PM Validation" && data.permissions.isPm ? <section className="quality-assignment"><h3>PM Validation & Assignment</h3><div><label>Responsible Trade<input value={assignment.responsibleTrade} onChange={(event) => setAssignment((current) => ({ ...current, responsibleTrade: event.target.value }))} /></label><label>Responsible Company<select value={assignment.responsibleVendorId} onChange={(event) => setAssignment((current) => ({ ...current, responsibleVendorId: event.target.value }))}><option value="">Mefford / Unassigned Company</option>{data.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="quality-check"><input type="checkbox" checked={assignment.requiresDesignerAcceptance} onChange={(event) => setAssignment((current) => ({ ...current, requiresDesignerAcceptance: event.target.checked }))} /><span>Designer acceptance required</span></label>{assignment.requiresDesignerAcceptance ? <label>Designer<select value={assignment.designerVendorId} onChange={(event) => setAssignment((current) => ({ ...current, designerVendorId: event.target.value }))}><option value="">Select Designer</option>{data.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label> : null}</div><button className="quality-primary" disabled={saving || !assignment.responsibleTrade} onClick={() => void onPost("validate-proposal", { recordId: item.id, ...assignment }, "PM Validated And Assigned The Quality Item")}>Validate & Assign</button></section> : null}{item.status === "Verification Requested" && data.permissions.canCompleteInspection ? <QualityDecision title="Superintendent Field Verification" explanation="Compare the corrected work and after photos to the original condition." decision={decision} comments={comments} onDecision={setDecision} onComments={setComments} button="Record Superintendent Verification" saving={saving} onSubmit={() => void onPost("superintendent-verify", { recordId: item.id, decision, comments }, "Superintendent Verification Recorded")} /> : null}{item.status === "PM / Designer Acceptance" && data.permissions.isPm ? <QualityDecision title="Project Manager Acceptance" explanation={item.data.requiresDesignerAcceptance === true ? "PM acceptance records Mefford's decision. Designer portal acceptance remains a separate closure gate." : "PM acceptance closes the item after Superintendent verification."} decision={decision} comments={comments} onDecision={setDecision} onComments={setComments} button="Record PM Acceptance" saving={saving} onSubmit={() => void onPost("pm-accept", { recordId: item.id, decision, comments }, "Project Manager Acceptance Recorded")} /> : null}<AuditTrail record={item} /></>;
}

function QualityDecision({ title, explanation, decision, comments, onDecision, onComments, button, saving, onSubmit }: { title: string; explanation: string; decision: "Accept" | "Reject"; comments: string; onDecision: (value: "Accept" | "Reject") => void; onComments: (value: string) => void; button: string; saving: boolean; onSubmit: () => void }) { return <section className="quality-decision"><div><h3>{title}</h3><p>{explanation}</p></div><div className="quality-decision-toggle"><button className={decision === "Accept" ? "active" : ""} onClick={() => onDecision("Accept")}>Accept</button><button className={decision === "Reject" ? "active reject" : ""} onClick={() => onDecision("Reject")}>Return For Correction</button></div><textarea rows={3} value={comments} onChange={(event) => onComments(event.target.value)} placeholder="Verification or return comments" /><button className="quality-primary" disabled={saving} onClick={onSubmit}>{saving ? "Recording…" : button}</button></section>; }

function AuditTrail({ record }: { record: QualityRecord }) { return <section className="quality-audit"><header><h3>Permanent Audit Trail</h3><span>{record.auditHistory.length} EVENTS</span></header>{record.auditHistory.length ? record.auditHistory.map((audit) => <article key={audit.id}><span /><div><b>{audit.action}</b><p>{audit.summary}</p><small>{audit.actor} · {formatDateTime(audit.at)}</small></div></article>) : <div className="quality-empty mini">The first controlled action will appear here.</div>}</section>; }

function statusClass(status: string) { return status.toLowerCase().replaceAll(" ", "-").replaceAll("—", "-").replaceAll("/", "-"); }
function punchColumn(status: string) { if (status === "Closed") return "Closed"; if (status === "Verification Requested") return "Awaiting Verification"; if (["PM / Designer Acceptance", "Designer Acceptance Required"].includes(status)) return "Acceptance"; return "Open"; }
function formatDate(value: string) { if (!value) return "—"; const date = new Date(value.includes("T") ? value : `${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatDateTime(value: string) { const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
