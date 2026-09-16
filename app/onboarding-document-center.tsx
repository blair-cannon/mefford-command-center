"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Actor = { name: string; email: string; accessLevel: string };
type Field = { id: string; label: string; type: string; required?: boolean; sensitive?: boolean; role?: "Employee" | "Employer"; options?: string[]; placeholder?: string; help?: string; systemValue?: string; systemManaged?: boolean };
type Signature = { name: string; email: string; role: string; method: string; signedAt: string };
type Submission = { answers?: Record<string, string | boolean>; status?: string; employeeSignature?: Signature; employerSignature?: Signature; contentHash?: string; revisions?: unknown[] };
type DocumentDefinition = {
  id: string;
  title: string;
  category: string;
  kind: string;
  version: string;
  phase: string;
  applicability: string;
  sourceAuthority: string;
  sourceUrl?: string;
  releaseStatus: string;
  reviewer: string;
  internalReviewerDesignation: string;
  requiredSigners: Array<"Employee" | "Employer">;
  restricted: boolean;
  retention: string;
  notice: string;
  sections: Array<{ title: string; text: string }>;
  fields: Field[];
  submission?: Submission | null;
  releaseReview?: { reviewedBy?: string; reviewedAt?: string; reviewNote?: string } | null;
  assignedReviewer?: { designation: string; name: string; email: string } | null;
  canEmployerSign?: boolean;
};
type ResponseData = {
  canAdminister: boolean;
  canReviewAssignedDocuments?: boolean;
  employee: { email: string; name: string };
  documents: DocumentDefinition[];
  roleAssignments?: Record<string, { designation: string; name: string; email: string }>;
  outsideCounsel?: { firmName?: string; contact?: string; engagementReference?: string; annualReviewDue?: string };
  providers?: {
    payroll: { name: string; boundary: string; employeeUrl?: string };
    lifeInsurance: { name: string; scope: string };
    healthInsurance: { name: string; scope: string };
  };
  error?: string;
};

function statusClass(value: string) { return value.toLowerCase().replaceAll(" ", "-"); }
function dateTime(value?: string) { return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not Recorded"; }

export function OnboardingDocumentCenter({ actor, employee, canAdminister }: { actor: Actor; employee: { email: string; name: string }; canAdminister: boolean }) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [activeId, setActiveId] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showAllForms, setShowAllForms] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [signatureName, setSignatureName] = useState("");
  const [signatureIntent, setSignatureIntent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch(`/api/onboarding/documents?employeeEmail=${encodeURIComponent(employee.email)}`);
    const result = await response.json() as ResponseData;
    if (!response.ok) throw new Error(result.error || "Digital New-Hire Packet Is Unavailable");
    setData(result);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/onboarding/documents?employeeEmail=${encodeURIComponent(employee.email)}`)
      .then(async (response) => { const result = await response.json() as ResponseData; if (!response.ok) throw new Error(result.error || "Digital New-Hire Packet Is Unavailable"); return result; })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Digital New-Hire Packet Is Unavailable"); });
    return () => { cancelled = true; };
  }, [employee.email]);

  const active = data?.documents.find((document) => document.id === activeId) || null;
  const counts = useMemo(() => ({
    complete: data?.documents.filter((document) => document.submission?.status === "Complete").length || 0,
    progress: data?.documents.filter((document) => document.submission && document.submission.status !== "Complete").length || 0,
    held: data?.documents.filter((document) => document.releaseStatus !== "Ready").length || 0,
  }), [data]);

  function openDocument(document: DocumentDefinition) {
    setActiveId(document.id);
    setQuestionIndex(0);
    setAnswers({ ...Object.fromEntries(document.fields.filter((field) => field.systemValue).map((field) => [field.id, field.systemValue!])), ...(document.submission?.answers || {}) });
    setSignatureName(""); setSignatureIntent(false); setNotice("");
  }

  async function submit(action: string, extra: Record<string, unknown> = {}) {
    if (!active) return false;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/onboarding/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, employeeEmail: employee.email, documentId: active.id, answers, signatureName, signatureIntent, ...extra }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Onboarding Document Could Not Be Saved");
      await load();
      setNotice(action === "save_draft" ? "Draft Saved" : action === "start_revision" ? "New Revision Started. The Prior Signed Record Was Retained." : "Authenticated Signature Recorded");
      if (action !== "save_draft" && action !== "start_revision") setActiveId("");
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Onboarding Document Could Not Be Saved"); }
    finally { setSaving(false); }
    return false;
  }

  async function approve(document: DocumentDefinition) {
    const reviewNote = window.prompt(`Enter the specific ${document.reviewer} approval reference for ${document.title}:`, "");
    if (!reviewNote) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/onboarding/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_template", employeeEmail: employee.email, documentId: document.id, reviewNote }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Template Approval Could Not Be Recorded");
      await load(); setNotice(`${document.title} Released With Reviewer Evidence`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Template Approval Could Not Be Recorded"); }
    finally { setSaving(false); }
  }

  async function configureOutsideCounsel() {
    const counselFirm = window.prompt("Outside employment counsel or law firm:", data?.outsideCounsel?.firmName || "");
    if (!counselFirm) return;
    const counselContact = window.prompt("Primary attorney or contact (optional):", data?.outsideCounsel?.contact || "") || "";
    const counselReference = window.prompt("Engagement or annual-review reference:", data?.outsideCounsel?.engagementReference || "");
    if (!counselReference) return;
    const annualReviewDue = window.prompt("Next annual review due date (YYYY-MM-DD):", data?.outsideCounsel?.annualReviewDue || "");
    if (!annualReviewDue) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/onboarding/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_outside_counsel", counselFirm, counselContact, counselReference, annualReviewDue }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Outside Counsel Could Not Be Saved");
      await load(); setNotice("Outside Employment Counsel And Annual Review Control Updated");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Outside Counsel Could Not Be Saved"); }
    finally { setSaving(false); }
  }

  if (!data) return <section className="onboarding-document-center"><div className="onboarding-document-loading">{notice || "Preparing Secure Digital New-Hire Packet..."}</div></section>;
  const isEmployee = actor.email.toLowerCase() === employee.email.toLowerCase();
  const employerStage = Boolean(active?.submission?.employeeSignature && active.requiredSigners.includes("Employer") && !active.submission.employerSignature);
  const formRole: "Employee" | "Employer" = employerStage && (canAdminister || active?.canEmployerSign) ? "Employer" : "Employee";
  const editable = active?.releaseStatus === "Ready" && (formRole === "Employer" ? active?.canEmployerSign === true : isEmployee && !active?.submission?.employeeSignature);
  const availableDocuments = data.documents.filter((document) => document.releaseStatus === "Ready");
  const employeeFinished = availableDocuments.filter((document) => Boolean(document.submission?.employeeSignature) || document.submission?.status === "Complete").length;
  const nextEmployeeDocument = availableDocuments.find((document) => document.submission?.status === "Draft" && !document.submission?.employeeSignature)
    || availableDocuments.find((document) => !document.submission?.employeeSignature && document.submission?.status !== "Complete")
    || null;
  const nextReviewDocument = availableDocuments.find((document) => document.submission?.employeeSignature && document.requiredSigners.includes("Employer") && !document.submission?.employerSignature && document.canEmployerSign)
    || null;
  const nextDocument = isEmployee ? nextEmployeeDocument : nextReviewDocument || nextEmployeeDocument;
  const nextAction = isEmployee ? (nextEmployeeDocument ? (nextEmployeeDocument.submission?.status === "Draft" ? "Continue Onboarding" : "Start Onboarding") : null) : nextReviewDocument ? "Review Next Form" : nextEmployeeDocument ? "Preview Employee's Next Form" : null;
  const activeFields = active?.fields.filter((field) => (field.role || "Employee") === formRole && !(isEmployee && field.systemManaged)) || [];
  const onSignatureStep = Boolean(active && editable && questionIndex >= activeFields.length);
  const activeField = editable && !onSignatureStep ? activeFields[questionIndex] : null;
  const activeValue = activeField ? answers[activeField.id] ?? activeField.systemValue : undefined;
  const currentAnswerComplete = !activeField?.required || (activeField.type === "checkbox" ? activeValue === true : String(activeValue ?? "").trim().length > 0);
  const requiredAnswersComplete = activeFields.every((field) => !field.required || (field.type === "checkbox" ? answers[field.id] === true : String(answers[field.id] ?? field.systemValue ?? "").trim().length > 0));
  const minutes = nextDocument ? Math.max(2, Math.min(10, Math.ceil(nextDocument.fields.filter((field) => (field.role || "Employee") === "Employee" && !field.systemManaged).length * .6))) : 0;

  function nextQuestion() {
    if (!currentAnswerComplete) { setNotice(`Please complete ${activeField?.label || "this question"} before continuing.`); return; }
    setNotice("");
    setQuestionIndex((current) => Math.min(current + 1, activeFields.length));
  }

  async function saveAndExit() {
    if (await submit("save_draft")) setActiveId("");
  }

  const friendlyStatus = (document: DocumentDefinition) => document.releaseStatus !== "Ready" ? "Company Is Preparing" : document.submission?.status === "Complete" ? "Complete" : document.submission?.status === "Employer Review Required" ? "Waiting On Company" : document.submission?.status === "Draft" ? "In Progress" : "Not Started";

  return <section className="onboarding-document-center">
    <header><div><p className="eyebrow orange-text">NEW-HIRE FORMS</p><h2>{isEmployee ? "Your Onboarding, One Step At A Time" : `${employee.name}'s Guided Onboarding`}</h2><span>{isEmployee ? "Answer only the question shown. Command Center handles routing, reviewer assignments, and company signatures automatically." : "The employee sees one clear question at a time. Company review is routed to the correct live role automatically."}</span></div><b>{employeeFinished} OF {availableDocuments.length} DONE</b></header>
    <div className="onboarding-guided-path" aria-label="Onboarding progress">
      <div className="onboarding-guided-steps"><span className="current"><b>1</b><strong>Complete Forms</strong><small>One question at a time</small></span><i>→</i><span><b>2</b><strong>Company Review</strong><small>Routed automatically</small></span><i>→</i><span><b>3</b><strong>Access Ready</strong><small>Administration activates</small></span></div>
      <div className={`onboarding-next-action ${nextDocument ? "" : "complete"}`}>
        <div><small>{nextDocument ? nextReviewDocument && !isEmployee ? "YOUR NEXT REVIEW" : "YOUR NEXT FORM" : counts.held ? "YOU ARE DONE FOR NOW" : "ONBOARDING FORMS COMPLETE"}</small><strong>{nextDocument?.title || (counts.held ? "The company is preparing the remaining forms" : "No more forms need your attention")}</strong><span>{nextDocument ? `${minutes} minute estimate · Your progress is saved if you leave.` : counts.held ? "You do not need to do anything until a form is released." : "Command Center will handle the remaining company steps."}</span></div>
        {nextDocument && nextAction ? <button className="primary-action large" onClick={() => openDocument(nextDocument)}>{nextAction} →</button> : <b>✓</b>}
      </div>
      <div className="onboarding-simple-progress"><span style={{ width: `${availableDocuments.length ? Math.round(employeeFinished / availableDocuments.length * 100) : 100}%` }} /><small>{employeeFinished} of {availableDocuments.length} available forms finished{counts.held ? ` · ${counts.held} being prepared by the company` : ""}</small></div>
    </div>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <div className="onboarding-document-list-toggle"><div><strong>All Onboarding Forms</strong><span>Use the main button above unless you need to return to a specific form.</span></div><button className="secondary-action" aria-expanded={showAllForms} onClick={() => setShowAllForms((current) => !current)}>{showAllForms ? "Hide Form List" : `View All ${data.documents.length} Forms`}</button></div>
    {showAllForms ? <div className="onboarding-document-grid">{data.documents.map((document) => {
      const status = friendlyStatus(document);
      return <article className={`onboarding-document-card ${document.releaseStatus !== "Ready" ? "held" : ""}`} key={document.id}>
        <div className="onboarding-document-card-top"><span>{document.category}</span><b className={`document-state ${statusClass(status)}`}>{status}</b></div>
        <h3>{document.title}</h3>
        <p>{document.releaseStatus !== "Ready" ? "The company is preparing this form. Nothing is required from the employee yet." : document.notice}</p>
        <dl><div><dt>WHEN</dt><dd>{document.phase}</dd></div><div><dt>FORM TYPE</dt><dd>{document.sourceAuthority}</dd></div>{!isEmployee ? <div><dt>COMPANY REVIEWER</dt><dd>{document.assignedReviewer?.name || `${document.internalReviewerDesignation || "Required Role"} Not Assigned`}</dd></div> : null}</dl>
        {document.releaseReview ? <small className="document-review-evidence">Released By {document.releaseReview.reviewedBy} · {dateTime(document.releaseReview.reviewedAt)}</small> : null}
        <div className="onboarding-document-actions">
          {document.sourceUrl ? <a href={document.sourceUrl} target="_blank" rel="noreferrer">Official Instructions ↗</a> : <span>Secure Web Form</span>}
          {document.releaseStatus === "Ready" ? <button onClick={() => openDocument(document)}>{document.submission?.status === "Complete" ? "View Completed Form" : document.submission?.status === "Employer Review Required" ? (document.canEmployerSign ? "Review And Sign" : "Waiting On Company") : document.submission?.status === "Draft" ? "Continue Form" : "Start Form"}</button> : (document.reviewer === "Safety Director" ? document.canEmployerSign : canAdminister) ? <button className="held-action" disabled={saving} onClick={() => void approve(document)}>Release For Employee</button> : <button disabled>Company Is Preparing</button>}
        </div>
      </article>;
    })}</div> : null}

    {!isEmployee ? <details className="onboarding-admin-controls"><summary>Company Controls, Assigned Reviewers, And Providers</summary><div className="onboarding-document-policy"><span><b>SCANNED DOCUMENTS</b>Blocked</span><span><b>SOURCE STANDARD</b>Official Agency Or Native Form Only</span><span><b>SIGNATURE STANDARD</b>Authenticated Intent + Typed Legal Name</span><span><b>REVISION STANDARD</b>Signed Records Never Overwritten</span></div>{data.providers ? <div className="onboarding-provider-boundary"><article><b>PAYROLL · PAYLOCITY</b><span>{data.providers.payroll.boundary}</span></article><article><b>LIFE INSURANCE</b><strong>{data.providers.lifeInsurance.name}</strong><span>{data.providers.lifeInsurance.scope}</span></article><article><b>HEALTH INSURANCE</b><strong>{data.providers.healthInsurance.name}</strong><span>{data.providers.healthInsurance.scope}</span></article></div> : null}<div className="onboarding-live-roles"><div><p className="eyebrow orange-text">LIVE FORM ROLES</p><strong>Names Follow Current Company Assignments</strong><span>Reassigning a role updates every unsigned form and future review automatically.</span></div>{["Administrator", "Accountant", "Safety Director"].map((designation) => <article key={designation}><small>{designation.toUpperCase()}</small><b>{data.roleAssignments?.[designation]?.name || "Role Not Assigned"}</b></article>)}<article className="outside-counsel-role"><small>OUTSIDE EMPLOYMENT COUNSEL</small><b>{data.outsideCounsel?.firmName || "Not Configured"}</b>{data.outsideCounsel?.annualReviewDue ? <span>Review Due {data.outsideCounsel.annualReviewDue}</span> : null}{data.canAdminister ? <button disabled={saving} onClick={() => void configureOutsideCounsel()}>{data.outsideCounsel?.firmName ? "Update" : "Configure"}</button> : null}</article></div></details> : null}

    {active ? <div className="modal-layer onboarding-document-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setActiveId("")}><section className="record-modal onboarding-document-modal" role="dialog" aria-modal="true" aria-label={active.title}>
      <div className="modal-heading"><div><p className="eyebrow orange-text">{editable ? onSignatureStep ? "FINAL STEP" : `QUESTION ${Math.min(questionIndex + 1, activeFields.length)} OF ${activeFields.length}` : `${active.kind.toUpperCase()} · ${active.version}`}</p><h2>{active.title}</h2><span>{editable ? "Your work is saved only when you choose Save And Exit or sign the form." : `${active.sourceAuthority} · ${active.applicability}`}</span></div><button aria-label={`Close ${active.title}`} onClick={() => setActiveId("")}>×</button></div>
      {editable ? <div className="onboarding-question-progress"><span style={{ width: `${activeFields.length ? Math.min(100, Math.round(questionIndex / activeFields.length * 100)) : 100}%` }} /></div> : null}
      {editable && activeField ? <div className="onboarding-single-question"><div><small>PLEASE ANSWER</small><h3>{activeField.label}{activeField.required ? " *" : ""}</h3>{activeField.help ? <p>{activeField.help}</p> : null}</div><DocumentField field={{ ...activeField, label: "Your Answer", help: undefined }} value={activeValue} disabled={Boolean(activeField.systemManaged)} onChange={(value) => setAnswers((current) => ({ ...current, [activeField.id]: value }))} /></div> : editable && onSignatureStep ? <div className="onboarding-review-sign"><div><small>REVIEW</small><h3>Everything Is Ready To Sign</h3><p>Confirm the entries below, type your legal name, and sign. Command Center will route the form to the correct company reviewer automatically.</p></div><div className="onboarding-answer-review">{activeFields.map((field) => <button key={field.id} onClick={() => setQuestionIndex(activeFields.indexOf(field))}><span>{field.label}</span><strong>{field.sensitive ? (answers[field.id] ? "Provided" : "Not Provided") : field.type === "checkbox" ? answers[field.id] ? "Yes" : "No" : String(answers[field.id] ?? field.systemValue ?? "Not Answered")}</strong><small>Edit</small></button>)}</div></div> : <><div className="onboarding-document-notice"><strong>{active.releaseStatus === "Ready" ? "COMPLETED RECORD" : active.releaseStatus.toUpperCase()}</strong><p>{active.notice}</p>{active.sourceUrl ? <a href={active.sourceUrl} target="_blank" rel="noreferrer">Open Official Instructions ↗</a> : null}</div><div className="onboarding-document-fields">{active.fields.filter((field) => (field.role || "Employee") === formRole).map((field) => <DocumentField key={field.id} field={field} value={answers[field.id] ?? field.systemValue} disabled onChange={() => undefined} />)}</div></>}
      {active.submission?.employeeSignature ? <SignatureRecord label="Employee Signature" signature={active.submission.employeeSignature} /> : null}
      {active.submission?.employerSignature ? <SignatureRecord label="Employer Signature" signature={active.submission.employerSignature} /> : null}
      {active.submission?.status && active.submission.status !== "Draft" ? <div className="onboarding-document-immutable"><strong>Signed Snapshot Locked</strong><span>SHA-256 {active.submission.contentHash || "Finalized After Employer Review"} · {active.submission.revisions?.length || 0} prior signed revision(s) retained.</span></div> : null}
      {editable && onSignatureStep ? <div className="onboarding-signature-panel"><label>Type Your Legal Name<input value={signatureName} onChange={(event) => setSignatureName(event.target.value)} placeholder={actor.name} /></label><label className="signature-intent"><input type="checkbox" checked={signatureIntent} onChange={(event) => setSignatureIntent(event.target.checked)} /><span>I intend my typed name to be my electronic signature and certify the entries are accurate.</span></label></div> : null}
      <div className="modal-actions">{editable ? <><button className="secondary-action" disabled={saving} onClick={() => void saveAndExit()}>{saving ? "Saving..." : "Save And Exit"}</button>{questionIndex > 0 ? <button className="secondary-action" onClick={() => { setNotice(""); setQuestionIndex((current) => Math.max(0, current - 1)); }}>Back</button> : null}{!onSignatureStep ? <button className="primary-action large" disabled={saving || !currentAnswerComplete} onClick={nextQuestion}>{questionIndex + 1 === activeFields.length ? "Review And Sign" : "Next Question"} →</button> : <button className="primary-action large" disabled={saving || !requiredAnswersComplete || !signatureIntent || signatureName.trim().toLowerCase() !== actor.name.trim().toLowerCase()} onClick={() => void submit(formRole === "Employer" ? "employer_sign" : "employee_sign")}>{saving ? "Recording..." : formRole === "Employer" ? "Sign And Finish Review" : "Sign And Finish Form"}</button>}</> : <><button className="secondary-action" onClick={() => setActiveId("")}>Close</button>{active.submission?.status && active.submission.status !== "Draft" ? <><a className="secondary-action document-download" href={`/api/onboarding/documents/pdf?employeeEmail=${encodeURIComponent(employee.email)}&documentId=${encodeURIComponent(active.id)}`}>Download Electronic Record</a>{(isEmployee || canAdminister) && active.submission.status === "Complete" ? <button className="secondary-action" disabled={saving} onClick={() => void submit("start_revision")}>Start New Revision</button> : null}</> : null}</>}</div>
    </section></div> : null}
  </section>;
}

export function OnboardingDocumentReviewerQueue({ actor }: { actor: Actor }) {
  const [items, setItems] = useState<Array<{ employeeEmail: string; employeeName: string; documentId: string; documentTitle: string; status: string; assignedReviewer?: { name: string; designation: string } }>>([]);
  const [selected, setSelected] = useState<{ email: string; name: string } | null>(null);
  const [notice, setNotice] = useState("");

  const loadQueue = useCallback(async () => {
    try {
      const response = await fetch("/api/onboarding/documents?assignedQueue=1");
      const result = await response.json() as { reviewQueue?: typeof items; error?: string };
      if (!response.ok) throw new Error(result.error || "Assigned Document Reviews Are Unavailable");
      setItems(result.reviewQueue || []);
      setSelected((current) => current && (result.reviewQueue || []).some((item) => item.employeeEmail === current.email) ? current : null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Assigned Document Reviews Are Unavailable"); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadQueue(), 0); return () => window.clearTimeout(timer); }, [loadQueue]);
  if (!items.length && !notice) return null;
  return <section className="onboarding-reviewer-queue">
    <header><div><p className="eyebrow orange-text">ROLE-ASSIGNED REVIEW</p><h2>Employee Documents Awaiting Your Role</h2><span>Only documents assigned to your current live designation appear here.</span></div><button className="secondary-action" onClick={() => void loadQueue()}>Refresh Queue</button></header>
    {notice ? <div className="accounting-notice">{notice}</div> : null}
    <div>{items.map((item) => <button key={`${item.employeeEmail}-${item.documentId}`} onClick={() => setSelected({ email: item.employeeEmail, name: item.employeeName })}><span><strong>{item.documentTitle}</strong><small>{item.employeeName} · {item.assignedReviewer?.designation || "Assigned Role"}</small></span><b>{item.status}</b></button>)}</div>
    {selected ? <OnboardingDocumentCenter key={selected.email} actor={actor} employee={selected} canAdminister={false} /> : null}
  </section>;
}

function DocumentField({ field, value, disabled, onChange }: { field: Field; value: string | boolean | undefined; disabled: boolean; onChange: (value: string | boolean) => void }) {
  if (field.type === "checkbox") return <label className="onboarding-document-checkbox"><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span><b>{field.label}{field.required ? " *" : ""}</b>{field.help ? <small>{field.help}</small> : null}</span></label>;
  return <label className={`field-label ${field.sensitive ? "sensitive-field" : ""}`}>{field.label}{field.required ? " *" : ""}{field.type === "select" ? <select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Select One</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.type === "textarea" ? <textarea value={String(value ?? "")} disabled={disabled} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} /> : <input type={field.type === "number" ? "number" : field.type} value={String(value ?? "")} disabled={disabled} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />}{field.help ? <small>{field.help}</small> : null}{field.sensitive ? <em>Restricted Employee Data</em> : null}</label>;
}

function SignatureRecord({ label, signature }: { label: string; signature: Signature }) {
  return <div className="onboarding-signature-record"><span>✓</span><div><strong>{label} · {signature.name}</strong><small>{signature.method} · {dateTime(signature.signedAt)} · {signature.email}</small></div></div>;
}
