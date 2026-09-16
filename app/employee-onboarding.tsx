"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ALL_COMPANY_DESIGNATIONS } from "../lib/team-access";
import { MEFFORD_COMPANY_DIRECTORY } from "./company-directory";
import { OnboardingDocumentCenter } from "./onboarding-document-center";
import { EmployeeResourceHub } from "./employee-resource-hub";
import { EmployeeGoals, EmployeeTimeEntry } from "./employee-home-tools";
import { EmployeeHomeOverview, EmployeeOutlookCenter, type HomeDestination } from "./employee-outlook-center";
import { EmployeeExperienceCenter, EmployeeManagerQueue, EmployeeProfileEditor, EmployeeRequestsAndLeave } from "./employee-lifecycle-center";
import { MyWorkWorkspace, type MyWorkItem } from "./my-work";
import { summaryDrilldownProps } from "./summary-drilldown";
import { EverydayWork } from "./workspace-navigation";
import type { WorkTool } from "../lib/workspace-usability";
import { isVideoUpload } from "../lib/photo-uploads";

type Actor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
  permissionLocked?: boolean;
};

type Requirement = {
  id: string;
  title: string;
  category: string;
  section: string;
  method: string;
  annual: boolean;
  designations: string[];
  departments: string[];
  reviewer: string;
  responsible: string;
  dueOffsetDays: number;
  dueAt?: string;
  blocksActivation: boolean;
  status: string;
  instructions?: string;
  contentFiles?: Array<{ id: number; name: string; contentType: string; uploadedAt: string; uploadedBy: string }>;
  contentReview?: { fileId: number; reviewedAt: string; reviewedBy: string; reviewNote: string };
  completion?: { completedAt: string; completedBy: string; score?: number } | null;
};

type Employee = {
  email: string;
  name: string;
  hireDate: string;
  birthDate?: string;
  position?: string;
  department?: "Office" | "Field" | "Leadership";
  supervisor?: string;
  workLocation?: string;
  checklistOwner?: string;
  thirtyDayReviewDate?: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
  status: string;
  permissionLocked: boolean;
  cycleYear: number;
  deadline: string;
  daysRemaining: number | null;
  progress: number;
  completedCount: number;
  requirementCount: number;
  requirements: Requirement[];
  extensionUntil?: string;
  extensionReason?: string;
  lastApprovedBy?: string;
  loginIssued?: boolean;
  identityProvider?: string;
};

type OnboardingResponse = {
  canAdminister: boolean;
  currentEmployee: Employee | null;
  employees: Employee[];
  template: {
    requirements: Requirement[];
    version: string;
    reminderPolicy: string;
    extensionPolicy: string;
  };
  microsoftEmailStatus: string;
  error?: string;
};

const designations = ALL_COMPANY_DESIGNATIONS;

function dateLabel(value?: string) {
  if (!value) return "Not Established";
  if (value.includes("T")) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function statusClass(status: string) {
  return status.toLowerCase().replaceAll(" ", "-");
}

export function EmployeeOnboardingWorkspace({ actor }: { actor: Actor }) {
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [selectedEmail, setSelectedEmail] = useState(actor.email);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [newHireOpen, setNewHireOpen] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [offboardingOpen, setOffboardingOpen] = useState(false);
  const [uploadingRequirementId, setUploadingRequirementId] = useState("");
  const [newHire, setNewHire] = useState({ name: "", email: "", hireDate: "", birthDate: "", position: "", department: "Office" as "Office" | "Field" | "Leadership", supervisor: "", workLocation: "", checklistOwner: actor.name, accessLevel: "Employee" as Employee["accessLevel"], designations: [] as string[] });
  const [hireDateDraft, setHireDateDraft] = useState("");
  const [birthDateDraft, setBirthDateDraft] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [offboardingReason, setOffboardingReason] = useState("");
  const [newRequirement, setNewRequirement] = useState({ title: "", category: "Company", method: "Document And Signature", reviewer: "Administrator", designation: "All Employees" });

  async function load() {
    const response = await fetch("/api/onboarding");
    const result = await response.json() as OnboardingResponse;
    if (!response.ok) throw new Error(result.error || "Employee Onboarding Is Unavailable.");
    setData(result);
    setSelectedEmail((current) => result.employees.some((employee) => employee.email === current) ? current : result.currentEmployee?.email || result.employees[0]?.email || "");
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding")
      .then(async (response) => {
        const result = await response.json() as OnboardingResponse;
        if (!response.ok) throw new Error(result.error || "Employee Onboarding Is Unavailable.");
        return result;
      })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setSelectedEmail(result.currentEmployee?.email || result.employees[0]?.email || actor.email);
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Employee Onboarding Is Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [actor.email]);

  const selected = data?.employees.find((employee) => employee.email === selectedEmail) || data?.currentEmployee || null;
  const summary = useMemo(() => ({
    locked: data?.employees.filter((employee) => employee.permissionLocked).length || 0,
    due: data?.employees.filter((employee) => employee.status === "Annual Renewal Due").length || 0,
    ready: data?.employees.filter((employee) => ["Ready For Activation", "Ready For Reactivation"].includes(employee.status)).length || 0,
    active: data?.employees.filter((employee) => ["Active", "Hire Date Required", "Annual Renewal Due", "Extension Active"].includes(employee.status)).length || 0,
  }), [data]);
  const employeeDrilldownRows = (employees: Employee[]) => employees.map((employee) => ({
    id: employee.email,
    title: employee.name,
    subtitle: `${employee.position || "Position Not Set"} · ${employee.department || "Department Not Set"}`,
    status: employee.status,
    value: `${employee.progress}%`,
    meta: `${employee.accessLevel} · ${employee.designations.join(" + ") || "No Designation"}`,
    onOpen: () => {
      setSelectedEmail(employee.email);
      setHireDateDraft(employee.hireDate);
      setBirthDateDraft(employee.birthDate || "");
      window.setTimeout(() => document.querySelector(".people-management-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    },
    openLabel: "Open Employee →",
  }));

  async function action(payload: Record<string, unknown>, success: string) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Employee Update Could Not Be Saved.");
      await load();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Employee Update Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function createEmployee() {
    await action({ action: "create_employee", ...newHire }, `${newHire.name}'s Employee Record Was Created Without Login Access. Record The Company Login Only After IT Issues It Through The Normal Channel.`);
    setNewHireOpen(false);
    setNewHire({ name: "", email: "", hireDate: "", birthDate: "", position: "", department: "Office", supervisor: "", workLocation: "", checklistOwner: actor.name, accessLevel: "Employee", designations: [] });
  }

  async function updateHireDate() {
    if (!selected) return;
    await action({ action: "update_employee", employeeEmail: selected.email, hireDate: hireDateDraft || selected.hireDate, birthDate: birthDateDraft || selected.birthDate || "", name: selected.name, position: selected.position, department: selected.department, supervisor: selected.supervisor, workLocation: selected.workLocation, checklistOwner: selected.checklistOwner, accessLevel: selected.accessLevel, designations: selected.designations }, `${selected.name}'s People Dates And Annual Cycle Were Updated.`);
  }

  async function completeRequirement(requirement: Requirement) {
    if (!selected) return;
    await action({ action: "complete_requirement", employeeEmail: selected.email, requirementId: requirement.id, score: requirement.method === "Quiz" ? 100 : undefined, attestation: `${actor.name} Completed And Acknowledged ${requirement.title}` }, `${requirement.title} Completed!`);
  }

  async function activate() {
    if (!selected) return;
    await action({ action: "activate", employeeEmail: selected.email }, `${selected.name}'s Onboarding Was Verified By ${actor.name}. The Company Owner Must Approve Command Center Access.`);
  }

  async function issueLogin() {
    if (!selected) return;
    await action({ action: "issue_login", employeeEmail: selected.email }, `${selected.name}'s Company Login Was Recorded As Issued. Their Onboarding-Only Portal Is Now Available.`);
  }

  async function grantExtension() {
    if (!selected) return;
    await action({ action: "grant_extension", employeeEmail: selected.email, extensionReason }, `A Documented Seven-Day Extension Was Granted To ${selected.name}.`);
    setExtensionOpen(false);
    setExtensionReason("");
  }

  async function beginOffboarding() {
    if (!selected) return;
    await action({ action: "terminate", employeeEmail: selected.email, attestation: offboardingReason }, `${selected.name}'s Command Center Access Was Disabled Immediately.`);
    setOffboardingOpen(false);
    setOffboardingReason("");
  }

  async function addRequirement() {
    await action({ action: "add_requirement", requirement: { title: newRequirement.title, category: newRequirement.category, method: newRequirement.method, reviewer: newRequirement.reviewer, annual: true, designations: newRequirement.designation === "All Employees" ? [] : [newRequirement.designation], status: "Draft Content" } }, `${newRequirement.title} Was Added To The Annual Master Template.`);
    setRequirementOpen(false);
    setNewRequirement({ title: "", category: "Company", method: "Document And Signature", reviewer: "Administrator", designation: "All Employees" });
  }

  async function uploadRequirementContent(requirement: Requirement, file?: File) {
    if (!file) return;
    if (!isVideoUpload(file)) {
      setNotice("Scanned Or Uploaded Onboarding Documents Are Blocked. Documents Must Be An Official Agency Source Or A Native Command Center Form.");
      return;
    }
    setUploadingRequirementId(requirement.id);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", "MEFFORD-PEOPLE");
      form.set("category", `Employee Onboarding · ${requirement.id}`);
      form.set("revision", `${requirement.title} · Controlled Version`);
      form.set("access", "Mefford Employees");
      const upload = await fetch("/api/files", { method: "POST", body: form });
      const uploadResult = await upload.json() as { file?: { id: number; name: string; contentType: string; createdAt: string; uploadedBy: string }; error?: string };
      if (!upload.ok || !uploadResult.file) throw new Error(uploadResult.error || "The Onboarding File Could Not Be Uploaded.");
      await action({ action: "attach_requirement_content", requirementId: requirement.id, contentFile: { id: uploadResult.file.id, name: uploadResult.file.name, contentType: uploadResult.file.contentType, uploadedAt: uploadResult.file.createdAt, uploadedBy: uploadResult.file.uploadedBy } }, `${requirement.title} Uploaded As A New Controlled Version And Is Pending ${requirement.reviewer} Approval.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Onboarding File Could Not Be Uploaded.");
    } finally {
      setUploadingRequirementId("");
    }
  }

  async function publishRequirementContent(requirement: Requirement) {
    const reviewNote = window.prompt(`Record the specific ${requirement.reviewer} approval reference for ${requirement.title}:`, "");
    if (!reviewNote) return;
    await action({ action: "publish_requirement_content", requirementId: requirement.id, reviewNote }, `${requirement.title} Reviewer Approval Was Recorded And The Current Version Is Published.`);
  }

  if (loading) return <div className="people-loading">Preparing The Mefford People Workspace...</div>;

  return (
    <div className="people-workspace">
      <section className="people-hero">
        <div><h1>Employee Onboarding</h1></div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}

      {selected?.permissionLocked && selected.email === actor.email ? <section className="employee-lock-banner"><span>🔒</span><div><h2>{selected.status}</h2></div><b>{selected.progress}% COMPLETE</b></section> : null}

      {data?.canAdminister ? <>

        <section className="people-summary-grid">
          <article {...summaryDrilldownProps({ title: "Active Employees", rows: employeeDrilldownRows(data.employees.filter((employee) => ["Active", "Hire Date Required", "Annual Renewal Due", "Extension Active"].includes(employee.status))) })}><span>ACTIVE EMPLOYEES</span><strong>{summary.active}</strong><small>Operational Or In Renewal Window</small></article>
          <article {...summaryDrilldownProps({ title: "Employees In 30-Day Renewal Window", rows: employeeDrilldownRows(data.employees.filter((employee) => employee.status === "Annual Renewal Due")) })}><span>30-DAY RENEWAL WINDOW</span><strong>{summary.due}</strong><small>Countdown And Email Reminders Active</small></article>
          <article {...summaryDrilldownProps({ title: "Employees Ready For Review", rows: employeeDrilldownRows(data.employees.filter((employee) => ["Ready For Activation", "Ready For Reactivation"].includes(employee.status))) })}><span>READY FOR REVIEW</span><strong>{summary.ready}</strong><small>Admin Verification + Owner Approval</small></article>
          <article {...summaryDrilldownProps({ title: "Employees With Locked Permissions", rows: employeeDrilldownRows(data.employees.filter((employee) => employee.permissionLocked)) }, summary.locked ? "people-alert-card" : "")}><span>PERMISSIONS LOCKED</span><strong>{summary.locked}</strong><small>Onboarding Renewal Or Offboarding</small></article>
        </section>

        <section className="people-admin-toolbar"><div><h2>Employee Lifecycle</h2></div><button className="primary-action large" onClick={() => setNewHireOpen(true)}>＋ Create Employee Record</button></section>

        <section className="people-management-grid">
          <div className="employee-roster">
            <div className="employee-roster-head"><strong>Mefford Employees</strong><span>{data.employees.length} People</span></div>
            {data.employees.map((employee) => <button key={employee.email} className={employee.email === selectedEmail ? "selected" : ""} onClick={() => { setSelectedEmail(employee.email); setHireDateDraft(employee.hireDate); setBirthDateDraft(employee.birthDate || ""); }}><i>{initials(employee.name)}</i><span><strong>{employee.name}</strong><small>{employee.accessLevel} · {employee.designations.join(" + ") || "No Designation"}</small></span><b className={`people-status ${statusClass(employee.status)}`}>{employee.status}</b><em>{employee.progress}%</em></button>)}
          </div>
          {selected ? <EmployeeDetail employee={selected} actor={actor} canAdminister={Boolean(data.canAdminister)} saving={saving} hireDateDraft={hireDateDraft} setHireDateDraft={setHireDateDraft} birthDateDraft={birthDateDraft} setBirthDateDraft={setBirthDateDraft} onUpdateHireDate={updateHireDate} onComplete={completeRequirement} onIssueLogin={issueLogin} onActivate={activate} onExtension={() => setExtensionOpen(true)} onOffboarding={() => setOffboardingOpen(true)} /> : null}
        </section>

        {selected ? <OnboardingDocumentCenter key={selected.email} actor={actor} employee={{ email: selected.email, name: selected.name }} canAdminister={Boolean(data.canAdminister)} /> : null}

        <section className="onboarding-readiness-panel">
          <div><h2>{data.template.requirements.filter((item) => item.status === "Draft Content").length} Requirements Need Content · {data.template.requirements.filter((item) => item.status === "Pending Review").length} Pending Review</h2></div>
          <div><strong>{data.template.requirements.reduce((total, item) => total + (item.contentFiles?.filter((file) => file.contentType.startsWith("video/"))?.length || 0), 0)}</strong><span>Controlled Training Videos</span><small>{data.template.requirements.filter((item) => item.status === "Ready").length} Published Requirements</small></div>
        </section>

        <section className="onboarding-template-panel">
          <header><div><h2>Annual Onboarding And Renewal Master</h2></div><button className="secondary-action" onClick={() => setRequirementOpen(true)}>＋ Add Requirement</button></header>
          <div className="onboarding-section-library">
            {Array.from(new Set(data.template.requirements.map((requirement) => requirement.section))).map((section, index) => {
              const sectionRequirements = data.template.requirements.filter((requirement) => requirement.section === section);
              return <details key={section} open={index === 0} data-reflow-table=""><summary><span><b>{section}</b><small>{sectionRequirements.length} Controlled Items</small></span><em>{sectionRequirements.some((item) => item.blocksActivation) ? "ACCESS GATE" : "FOLLOW-UP"}</em></summary><div className="template-requirement-head" data-reflow-head="medium"><span>Requirement</span><span>Responsible</span><span>Due</span><span>Audience</span><span>Method</span><span>Content / Versions</span></div>{sectionRequirements.map((requirement) => <div className="template-requirement-row" key={requirement.id} data-reflow-row="medium"><span data-label="Requirement"><b>{requirement.title}</b><small>{requirement.category} · {requirement.reviewer} Review</small></span><span data-label="Responsible">{requirement.responsible}</span><span data-label="Due">{requirement.annual ? "Annual" : requirement.dueOffsetDays < 0 ? `${Math.abs(requirement.dueOffsetDays)} Day${Math.abs(requirement.dueOffsetDays) === 1 ? "" : "s"} Before Start` : requirement.dueOffsetDays === 0 ? "By End Of First Day" : `${requirement.dueOffsetDays} Days After Start`}</span><span data-label="Audience">{requirement.designations.length || requirement.departments.length ? [...requirement.departments, ...requirement.designations].join(" + ") : "All Employees"}</span><span data-label="Method">{requirement.method}</span><div className="controlled-content-cell" data-label="Content / Versions"><b className={`content-status ${requirement.status === "Ready" ? "ready" : requirement.status === "Pending Review" ? "pending" : "draft"}`}>{requirement.status}</b>{requirement.contentFiles?.map((file, fileIndex) => <button key={file.id} className="controlled-file-link" onClick={() => window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer")}>{fileIndex === requirement.contentFiles!.length - 1 ? "Current" : `V${fileIndex + 1}`} · {file.name}</button>)}{requirement.contentReview ? <small className="content-review-note">Approved By {requirement.contentReview.reviewedBy} · {new Date(requirement.contentReview.reviewedAt).toLocaleDateString("en-US")}</small> : null}{requirement.status === "Pending Review" ? <button className="review-publish-action" disabled={saving} onClick={() => void publishRequirementContent(requirement)}>Record {requirement.reviewer} Approval</button> : null}{requirement.method === "Video" ? <label className="onboarding-upload-action"><input type="file" accept=".mp4,.mov,video/*" disabled={Boolean(uploadingRequirementId)} onChange={(event) => { void uploadRequirementContent(requirement, event.target.files?.[0]); event.currentTarget.value = ""; }} /><span>{uploadingRequirementId === requirement.id ? "Uploading…" : requirement.contentFiles?.length ? "＋ Upload New Version · Training Video" : "＋ Upload Training Video"}</span></label> : <small className="native-source-only">Native Or Official Source Only</small>}</div></div>)}</details>;
            })}
          </div>
          <footer><div><strong>Attorney And Safety Publication Gate</strong><span>Legal and safety materials retain their assigned reviewer, signature history, and publication status.</span></div><div><strong>Permanent Version History</strong><span>Official sources stay linked; native forms remain individually signed; replacement training videos never erase earlier versions. Scans stay blocked.</span></div></footer>
        </section>
      </> : selected ? <><OnboardingDocumentCenter key={selected.email} actor={actor} employee={{ email: selected.email, name: selected.name }} canAdminister={false} /><EmployeeDetail employee={selected} actor={actor} canAdminister={false} saving={saving} hireDateDraft={hireDateDraft} setHireDateDraft={setHireDateDraft} birthDateDraft={birthDateDraft} setBirthDateDraft={setBirthDateDraft} onUpdateHireDate={updateHireDate} onComplete={completeRequirement} onIssueLogin={() => undefined} onActivate={activate} onExtension={() => setExtensionOpen(true)} onOffboarding={() => setOffboardingOpen(true)} /></> : null}

      <section className="renewal-communication-panel"><div><span>30</span><strong>In-App Reminder</strong><small>Thirty Days Before Anniversary</small></div><i>→</i><div><span>14</span><strong>Second Reminder</strong><small>Fourteen Days Remaining</small></div><i>→</i><div><span>7</span><strong>Daily Countdown Begins</strong><small>Command Center Daily</small></div><i>→</i><div><span>0</span><strong>Permissions Pause</strong><small>Admin Verification + Owner Reapproval</small></div><b>{data?.microsoftEmailStatus}</b></section>

      {newHireOpen ? <Modal title="Create New Mefford Employee Record" eyebrow="DORMANT ACCESS UNTIL APPROVED" onClose={() => setNewHireOpen(false)}><div className="field-grid"><label className="field-label">Full Name<input autoFocus value={newHire.name} onChange={(event) => setNewHire({ ...newHire, name: event.target.value })} placeholder="Employee Full Name" /></label><label className="field-label">Microsoft Email<input value={newHire.email} onChange={(event) => setNewHire({ ...newHire, email: event.target.value })} placeholder="employee@meffcon.com" /></label></div><div className="field-grid"><label className="field-label">Position<input value={newHire.position} onChange={(event) => setNewHire({ ...newHire, position: event.target.value })} placeholder="Position Title" /></label><label className="field-label">Department<select value={newHire.department} onChange={(event) => setNewHire({ ...newHire, department: event.target.value as typeof newHire.department })}><option>Office</option><option>Field</option><option>Leadership</option></select></label></div><div className="field-grid"><label className="field-label">Supervisor<select value={newHire.supervisor} onChange={(event) => setNewHire({ ...newHire, supervisor: event.target.value })}><option value="">Select Supervisor</option>{MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}</select></label><label className="field-label">Work Location Or Project<input value={newHire.workLocation} onChange={(event) => setNewHire({ ...newHire, workLocation: event.target.value })} placeholder="Office Shop Or Active Project" /></label></div><div className="field-grid"><label className="field-label">Checklist Owner<select value={newHire.checklistOwner} onChange={(event) => setNewHire({ ...newHire, checklistOwner: event.target.value })}>{MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}</select></label><label className="field-label">Original Hire Date<input type="date" value={newHire.hireDate} onChange={(event) => setNewHire({ ...newHire, hireDate: event.target.value })} /></label><label className="field-label">Birthday (For Company Calendar)<input type="date" value={newHire.birthDate} onChange={(event) => setNewHire({ ...newHire, birthDate: event.target.value })} /></label></div><label className="field-label">Planned Company Access Level<select value={newHire.accessLevel === "Company Owner" ? "Employee" : newHire.accessLevel} onChange={(event) => setNewHire({ ...newHire, accessLevel: event.target.value as Employee["accessLevel"] })}><option>Employee</option><option>Administrator</option></select></label><fieldset className="people-designation-picker"><legend>Future Roles · Dormant Until Owner Activation</legend>{designations.map((designation) => <label key={designation}><input type="checkbox" checked={newHire.designations.includes(designation)} onChange={() => setNewHire({ ...newHire, designations: newHire.designations.includes(designation) ? newHire.designations.filter((item) => item !== designation) : [...newHire.designations, designation] })} /><span>{designation}</span></label>)}</fieldset><div className="modal-actions"><button className="secondary-action" onClick={() => setNewHireOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !newHire.name || !newHire.email || !newHire.hireDate || !newHire.position || !newHire.supervisor || !newHire.workLocation} onClick={() => void createEmployee()}>{saving ? "Creating Onboarding..." : "Create Record And Start Onboarding"}</button></div></Modal> : null}

      {requirementOpen ? <Modal title="Add Annual Requirement" eyebrow="MASTER ONBOARDING TEMPLATE" onClose={() => setRequirementOpen(false)}><label className="field-label">Requirement Title<input autoFocus value={newRequirement.title} onChange={(event) => setNewRequirement({ ...newRequirement, title: event.target.value })} placeholder="Example: Annual Vehicle Safety Review" /></label><div className="field-grid"><label className="field-label">Category<select value={newRequirement.category} onChange={(event) => setNewRequirement({ ...newRequirement, category: event.target.value })}>{["Company", "Safety", "Legal", "Technology", "Equipment", "Training"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Completion Method<select value={newRequirement.method} onChange={(event) => setNewRequirement({ ...newRequirement, method: event.target.value })}>{["Document And Signature", "Video", "Quiz", "Form", "In-Person Acknowledgement"].map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="field-grid"><label className="field-label">Audience<select value={newRequirement.designation} onChange={(event) => setNewRequirement({ ...newRequirement, designation: event.target.value })}><option>All Employees</option>{designations.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Annual Reviewer<select value={newRequirement.reviewer} onChange={(event) => setNewRequirement({ ...newRequirement, reviewer: event.target.value })}><option>Administrator</option><option>Safety Reviewer</option><option>Attorney</option></select></label></div><div className="modal-actions"><button className="secondary-action" onClick={() => setRequirementOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !newRequirement.title} onClick={() => void addRequirement()}>{saving ? "Adding Requirement..." : "Add To Annual Master"}</button></div></Modal> : null}

      {extensionOpen && selected ? <Modal title="Grant Seven-Day Extension" eyebrow="DOCUMENTED ADMINISTRATOR EXCEPTION" onClose={() => setExtensionOpen(false)}><p className="modal-intro">This temporarily restores access for no more than seven days. The annual requirements and countdown remain visible.</p><label className="field-label">Required Explanation<textarea autoFocus value={extensionReason} onChange={(event) => setExtensionReason(event.target.value)} placeholder={`Explain Why ${selected.name} Requires A Temporary Extension`} /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setExtensionOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !extensionReason.trim()} onClick={() => void grantExtension()}>{saving ? "Granting Extension..." : "Grant Seven-Day Extension"}</button></div></Modal> : null}

      {offboardingOpen && selected ? <Modal title="Begin Employee Offboarding" eyebrow="IMMEDIATE ACCESS LOCK" onClose={() => setOffboardingOpen(false)}><div className="offboarding-warning"><span>!</span><div><strong>{selected.name}&apos;s Command Center Access Will Be Disabled Immediately</strong><p>Company records remain preserved. The equipment return retention and final-account checklist will remain assigned to Administration.</p></div></div><label className="field-label">Required Offboarding Reason<textarea autoFocus value={offboardingReason} onChange={(event) => setOffboardingReason(event.target.value)} placeholder="Document The Reason And Effective Date" /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setOffboardingOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !offboardingReason.trim()} onClick={() => void beginOffboarding()}>{saving ? "Locking Access..." : "Confirm Immediate Access Lock"}</button></div></Modal> : null}
    </div>
  );
}

export function EmployeePortalWorkspace({ actor, onOpenWorkItem, onWorkItemsChange, everydayTools = [], onNavigateTool, projectName, projectNumber, onDailyLog, onPhoto }: { actor: Actor; onOpenWorkItem?: (item: MyWorkItem) => void; onWorkItemsChange?: (items: MyWorkItem[]) => void; everydayTools?: WorkTool[]; onNavigateTool?: (target: string) => void; projectName?: string; projectNumber?: string; onDailyLog?: () => void; onPhoto?: () => void }) {
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<"Home" | HomeDestination | "My Profile">("Home");

  async function loadPortal() {
    const response = await fetch("/api/onboarding");
    const result = await response.json() as OnboardingResponse;
    if (!response.ok) throw new Error(result.error || "The Employee Portal Is Unavailable.");
    setData(result);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding")
      .then(async (response) => {
        const result = await response.json() as OnboardingResponse;
        if (!response.ok) throw new Error(result.error || "The Employee Portal Is Unavailable.");
        return result;
      })
      .then((result) => !cancelled && setData(result))
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "The Employee Portal Is Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  async function completePortalRequirement(requirement: Requirement) {
    const employee = data?.currentEmployee;
    if (!employee) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_requirement",
          employeeEmail: employee.email,
          requirementId: requirement.id,
          score: requirement.method === "Quiz" ? 100 : undefined,
          attestation: `${actor.name} Completed And Acknowledged ${requirement.title}`,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Requirement Could Not Be Completed.");
      await loadPortal();
      setNotice(`${requirement.title} Completed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Requirement Could Not Be Completed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="people-loading">Opening Your Employee Portal...</div>;
  const employee = data?.currentEmployee;
  if (!employee) return <div className="accounting-notice">Your authenticated email is not connected to an employee record. Company Administration must create the record before this portal can open.</div>;
  const resources = employee.requirements.flatMap((requirement) => (requirement.contentFiles || []).map((file, index, files) => ({ ...file, requirement, current: index === files.length - 1 })));
  const openItems = employee.requirements.filter((requirement) => !requirement.completion);
  const activated = !employee.permissionLocked;

  return <div className="people-workspace employee-portal-workspace">
    <section className={`people-hero employee-portal-hero ${activated ? "active-home-hero" : ""}`}><div><h1>{activated ? "My Work" : `Welcome To Mefford, ${employee.name.split(" ")[0]}`}</h1>{!activated ? <p>Complete your forms below to open your employee workspace.</p> : null}</div></section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    {activated ? <nav className="employee-home-nav" aria-label="Employee home sections">{(["Home", "Work & Time", "Email", "Calendar", "Requests & PTO", "Benefits", "Growth & Training", "My Profile"] as const).map((item) => <button key={item} className={page === item ? "active" : ""} onClick={() => setPage(item)}>{item}</button>)}</nav> : null}
    {activated && page === "Home" && onNavigateTool ? <EverydayWork tools={everydayTools} onNavigate={onNavigateTool} projectName={projectName} projectNumber={projectNumber} onDailyLog={projectNumber ? onDailyLog : undefined} onPhoto={projectNumber ? onPhoto : undefined} /> : null}
    {activated && page === "Home" ? <EmployeeHomeOverview firstName={employee.name.split(" ")[0]} onNavigate={(target) => setPage(target)} onOpenWorkItem={onOpenWorkItem} /> : null}
    {!activated ? <section className="employee-first-day-map" aria-label="Your Mefford onboarding path"><div><b>1</b><span><strong>Finish Your Forms</strong><small>One question at a time</small></span></div><i>→</i><div><b>2</b><span><strong>We Route The Review</strong><small>No chasing people or paperwork</small></span></div><i>→</i><div><b>3</b><span><strong>Your Access Opens</strong><small>Then this becomes your everyday employee home</small></span></div></section> : null}
    {!activated || (page === "Home" && openItems.some((item) => item.blocksActivation)) ? <div id="my-onboarding"><OnboardingDocumentCenter key={employee.email} actor={actor} employee={{ email: employee.email, name: employee.name }} canAdminister={false} /></div> : null}
    {activated && page === "Work & Time" ? <><section id="my-work-home" className="employee-home-work"><MyWorkWorkspace actor={actor} onOpenItem={onOpenWorkItem || (() => setNotice("Open My Work From Your Full Command Center Access."))} onItemsChange={onWorkItemsChange} /></section><EmployeeTimeEntry /><EmployeeManagerQueue /></> : null}
    {activated && page === "Email" ? <EmployeeOutlookCenter key="employee-mail" initialView="mail" /> : null}
    {activated && page === "Calendar" ? <EmployeeOutlookCenter key="employee-calendar" initialView="calendar" /> : null}
    {activated && page === "Requests & PTO" ? <EmployeeRequestsAndLeave /> : null}
    {activated && page === "Growth & Training" ? <><EmployeeGoals /><EmployeeExperienceCenter /></> : null}
    {!activated ? <section className="employee-portal-summary"><article {...summaryDrilldownProps({ title: "Items Needing You", rows: openItems.map((item) => ({ id: item.id, title: item.title, subtitle: `${item.category} · ${item.method}`, status: item.status, meta: item.blocksActivation ? "Required Before Full Access" : "Non-Blocking" })) })}><span>ITEMS NEEDING YOU</span><strong>{openItems.length}</strong><small>{openItems.filter((item) => item.blocksActivation).length} Needed Before Full Access</small></article><article {...summaryDrilldownProps({ title: "Current Company Training Files", rows: resources.filter((item) => item.current).map((item) => ({ id: String(item.id), title: item.name, subtitle: item.requirement.title, status: "Current", meta: item.contentType })) })}><span>COMPANY TRAINING FILES</span><strong>{resources.filter((item) => item.current).length}</strong><small>Current Controlled Versions</small></article><article {...summaryDrilldownProps({ title: "Next People Deadline", rows: [{ id: employee.email, title: employee.name, subtitle: employee.status, status: employee.daysRemaining !== null && employee.daysRemaining < 0 ? "Overdue" : "Scheduled", value: dateLabel(employee.deadline), meta: employee.daysRemaining === null ? "Company Is Setting The Hire Date" : `${employee.daysRemaining} Days Remaining` }] })}><span>NEXT PEOPLE DEADLINE</span><strong>{dateLabel(employee.deadline)}</strong><small>{employee.daysRemaining === null ? "Company Is Setting Your Hire Date" : `${employee.daysRemaining} Days Remaining`}</small></article></section> : null}
    {activated && page === "Growth & Training" ? <section id="my-training" className="employee-resource-library"><header><div><h2>What You Need To Know</h2></div><span>{resources.filter((item) => item.current).length} FILES</span></header>{resources.filter((item) => item.current).map((item) => <button key={item.id} onClick={() => window.open(`/api/files?id=${item.id}`, "_blank", "noopener,noreferrer")}><i>{item.contentType.startsWith("video") ? "VID" : item.contentType.includes("pdf") ? "PDF" : "FILE"}</i><span><strong>{item.requirement.title}</strong><small>{item.name} · Published By {item.uploadedBy}</small></span><b>OPEN ↗</b></button>)}{!resources.length ? <div className="accounting-empty"><strong>No Published Training Files Yet</strong><span>Your required forms remain available above. Administration publishes controlled training here as it is approved.</span></div> : null}</section> : null}
    {activated && page === "Benefits" ? <><EmployeeResourceHub /><EmployeeRequestsAndLeave initialCategory="Benefits Question" /></> : null}
    {activated && page === "My Profile" ? <><EmployeeProfileEditor />{openItems.length ? <details className="employee-profile-details"><summary><span><strong>Onboarding, Renewals And Full Checklist</strong><small>Open current forms and annual requirements.</small></span><b>VIEW</b></summary><div id="my-onboarding"><OnboardingDocumentCenter key={`${employee.email}-active`} actor={actor} employee={{ email: employee.email, name: employee.name }} canAdminister={false} /></div></details> : null}<details className="employee-profile-details"><summary><span><strong>Company Employment Record</strong><small>Role, dates, company access and lifecycle history.</small></span><b>VIEW</b></summary><EmployeeDetail employee={employee} actor={actor} canAdminister={false} saving={saving} hireDateDraft={employee.hireDate} setHireDateDraft={() => undefined} birthDateDraft={employee.birthDate || ""} setBirthDateDraft={() => undefined} onUpdateHireDate={() => undefined} onComplete={completePortalRequirement} onIssueLogin={() => undefined} onActivate={() => undefined} onExtension={() => undefined} onOffboarding={() => undefined} /></details></> : null}
  </div>;
}

function EmployeeDetail({ employee, actor, canAdminister, saving, hireDateDraft, setHireDateDraft, birthDateDraft, setBirthDateDraft, onUpdateHireDate, onComplete, onIssueLogin, onActivate, onExtension, onOffboarding }: { employee: Employee; actor: Actor; canAdminister: boolean; saving: boolean; hireDateDraft: string; setHireDateDraft: (value: string) => void; birthDateDraft: string; setBirthDateDraft: (value: string) => void; onUpdateHireDate: () => void; onComplete: (requirement: Requirement) => void; onIssueLogin: () => void; onActivate: () => void; onExtension: () => void; onOffboarding: () => void }) {
  const groups = Array.from(new Set(employee.requirements.map((requirement) => requirement.section))).map((section) => ({ section, requirements: employee.requirements.filter((requirement) => requirement.section === section) }));
  const canEmployeeComplete = (requirement: Requirement) => requirement.status === "Ready" && (!requirement.annual || Boolean(employee.hireDate)) && (canAdminister || (employee.email === actor.email && !["Supervisor Verification", "Guided Review"].includes(requirement.method)));
  return <section className="employee-onboarding-detail">
    <header><div className="employee-detail-identity"><i>{initials(employee.name)}</i><span><h2>{employee.name}</h2><small>{employee.email}</small></span></div><b className={`people-status ${statusClass(employee.status)}`}>{employee.status}</b></header>
    <div className="employee-profile-strip"><span><small>POSITION</small><b>{employee.position || employee.designations[0] || "Not Assigned"}</b></span><span><small>DEPARTMENT</small><b>{employee.department || "Not Assigned"}</b></span><span><small>SUPERVISOR</small><b>{employee.supervisor || "Not Assigned"}</b></span><span><small>WORK LOCATION / PROJECT</small><b>{employee.workLocation || "Not Assigned"}</b></span><span><small>CHECKLIST OWNER</small><b>{employee.checklistOwner || "Company Administration"}</b></span><span><small>30-DAY REVIEW</small><b>{dateLabel(employee.thirtyDayReviewDate)}</b></span></div>
    <div className="employee-cycle-grid"><article><span>ORIGINAL HIRE DATE</span>{canAdminister ? <div><input type="date" value={hireDateDraft || employee.hireDate} onChange={(event) => setHireDateDraft(event.target.value)} /><button disabled={saving || !(hireDateDraft || employee.hireDate)} onClick={onUpdateHireDate}>Save</button></div> : <strong>{dateLabel(employee.hireDate)}</strong>}<small>Controls Annual Renewal And Company Anniversary</small></article><article><span>BIRTHDAY</span>{canAdminister ? <div><input type="date" value={birthDateDraft || employee.birthDate || ""} onChange={(event) => setBirthDateDraft(event.target.value)} /><button disabled={saving || !(hireDateDraft || employee.hireDate)} onClick={onUpdateHireDate}>Save</button></div> : <strong>{dateLabel(employee.birthDate)}</strong>}<small>Appears On The Master Company Calendar</small></article><article><span>NEXT DEADLINE</span><strong>{dateLabel(employee.deadline)}</strong><small>{employee.daysRemaining === null ? "Hire Date Needed" : employee.daysRemaining > 0 ? `${employee.daysRemaining} Days Remaining` : "Deadline Reached"}</small></article><article><span>COMPLETION</span><strong>{employee.progress}%</strong><div className="people-progress"><i style={{ width: `${employee.progress}%` }} /></div></article></div>
    {employee.extensionUntil ? <div className="employee-extension-note"><strong>Extension Through {dateLabel(employee.extensionUntil)}</strong><span>{employee.extensionReason}</span></div> : null}
    <div className="employee-requirement-heading"><div><strong>Controlled Onboarding Checklist</strong><span>{employee.completedCount} Of {employee.requirementCount} Current Items Complete</span></div><div className="employee-access-actions">{canAdminister && !employee.loginIssued ? <button className="secondary-action" disabled={saving} onClick={onIssueLogin}>Record Company Login Issued</button> : null}{canAdminister && employee.loginIssued && ["Ready For Activation", "Ready For Reactivation"].includes(employee.status) ? <button className="primary-action" disabled={saving} onClick={onActivate}>Verify Onboarding Complete</button> : null}</div></div>
    <div className="employee-checklist-groups">{groups.map((group, groupIndex) => <details key={group.section} open={groupIndex === 0 || group.requirements.some((requirement) => !requirement.completion && requirement.blocksActivation)}><summary><span><b>{group.section}</b><small>{group.requirements.filter((requirement) => requirement.completion).length} Of {group.requirements.length} Complete</small></span><em>{group.requirements.some((requirement) => requirement.blocksActivation) ? "REQUIRED TO UNLOCK" : "SCHEDULED FOLLOW-UP"}</em></summary><div className="employee-requirement-list">{group.requirements.map((requirement) => <article className={requirement.completion ? "complete" : ""} key={requirement.id}><span>{requirement.completion ? "✓" : requirement.method === "Video" ? "▶" : requirement.method === "Quiz" ? "?" : requirement.method === "Form" ? "✎" : requirement.method === "Signature" ? "SIG" : "DOC"}</span><div><strong>{requirement.title}</strong><small>{requirement.responsible} · Due {dateLabel(requirement.dueAt)} · {requirement.method}</small>{requirement.contentFiles?.map((file, index) => <button key={file.id} className="employee-content-link" onClick={() => window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer")}>{index === requirement.contentFiles!.length - 1 ? "Open Current File" : `Open Version ${index + 1}`} · {file.name}</button>)}{requirement.completion ? <em>Completed By {requirement.completion.completedBy} · {new Date(requirement.completion.completedAt).toLocaleDateString("en-US")}{requirement.completion.score ? ` · ${requirement.completion.score}%` : ""}</em> : <em>{requirement.status === "Draft Content" ? "Content Upload And Publication Required Before Completion" : requirement.status === "Pending Review" ? `${requirement.reviewer} Approval Required Before Publication` : requirement.blocksActivation ? "Required Before Permissions Unlock" : "Tracked Through My Work"}</em>}</div>{requirement.completion ? <b>COMPLETE</b> : <button disabled={saving || !canEmployeeComplete(requirement)} title={requirement.status !== "Ready" ? "Administration Must Publish The Controlled Content First" : !canEmployeeComplete(requirement) ? `${requirement.responsible} Must Verify This Item` : ""} onClick={() => onComplete(requirement)}>{requirement.status !== "Ready" ? "Awaiting Published Content" : requirement.method === "Quiz" ? "Complete Knowledge Check" : requirement.method === "Video" ? "Watch And Confirm" : requirement.method === "Form" ? "Complete Form" : requirement.method === "Signature" ? "Apply Signoff" : requirement.method === "Supervisor Verification" ? "Verify Completion" : "Review And Acknowledge"}</button>}</article>)}</div></details>)}</div>
    {canAdminister ? <footer><button className="secondary-action" onClick={onExtension}>Grant Seven-Day Extension</button><button className="danger-outline-action" onClick={onOffboarding}>Begin Offboarding</button></footer> : null}
  </section>;
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="record-modal people-modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><p className="eyebrow orange-text">{eyebrow}</p><h2>{title}</h2></div><button aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</section></div>;
}
