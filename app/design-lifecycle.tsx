"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";
import { indexDrawingUpload } from "../lib/drawing-client";

type Scope = "Sales" | "Project";
type DesignPackage = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  data: Record<string, unknown>;
  updatedAt: string;
};
type Opportunity = { id: string; title: string; stage: string; company: string; assignedRep: string; awardedProjectNumber: string; deliveryMethod: string; salesDesignTrackId: string; salesDesignTrackStatus: string };
type Consultant = { id: string; name: string; contactName: string; contactEmail: string; discipline: string; status: string };
type VendorOption = { id: string; name: string; type: string; contactName: string; contactEmail: string; trades: string[]; status: string; portalStatus: string; paymentHold?: boolean; temporaryApproval?: boolean };
type DesignTeamAssignment = { id: string; discipline: string; vendorId: string; vendorName: string; contactName: string; contactEmail: string; engagementStatus: string; contractReference: string; linkedSubcontractId: string; notificationsEnabled: boolean; portalStatus: string; assignedBy: string; assignedAt: string; updatedAt: string };
type DesignChecklistItem = { id: string; group: string; label: string; required: boolean; completed: boolean; completedBy: string; completedAt: string; note: string };
type DesignTeam = { id: string; opportunityId: string; status: string; locked: boolean; assignments: DesignTeamAssignment[]; checklist: DesignChecklistItem[]; timeline: Array<Record<string, unknown>> };
type DesignSetup = {
  scope: Scope;
  safeguards: { awardLocksBasisOfSale: boolean; workingCopyNeverOverwritesSnapshot: boolean; currentSetRelease: string; automaticContractChange: boolean };
  permissions: { canManageSales: boolean; canViewProject: boolean; canManageProject: boolean; canReleaseCurrentSet: boolean };
  opportunities: Opportunity[];
  consultants: Consultant[];
  vendorOptions: VendorOption[];
  designTeams: DesignTeam[];
  packages: DesignPackage[];
};
type Version = {
  id: string;
  label: string;
  description?: string;
  fileId: number;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  designerDecision?: string;
  designerName?: string;
  designerReviewedAt?: string;
  isCurrent?: boolean;
  isBasisOfSale?: boolean;
  releasedBy?: string;
  releasedAt?: string;
  issuedPurpose?: string;
};
type DrawingIndexRecord = { id: string; title: string; status: string; updatedAt: string; data: { sheets?: Array<{ page?: number; sheetNumber?: string; sheetTitle?: string; revision?: string; revisionDate?: string; discipline?: string; confidence?: number; needsReview?: boolean }> } };

const disciplines = ["Architecture", "Structural", "Mechanical", "Electrical", "Plumbing", "Civil", "Fire Protection", "Interior Design", "Landscape", "Delegated Design"];
const salesDesignTypes = ["Floor Plan", "Rendering"];
const projectPhases = ["Schematic Design", "Design Development", "50% Coordination", "90% Coordination", "Permit", "Issued For Construction", "Bulletin / Revision", "Record / As-Built"];
const deliverableTypes = ["Drawing Package", "Rendering", "Floor Plan", "Calculation", "Model", "Narrative", "Specification", "Permit Response"];
const issuePurposes = ["Permit", "Issued For Construction", "Construction Revision", "Bid / Procurement", "Record / As-Built"];
const designTeamDisciplines = ["Architecture", "MEP", "Structural", "Civil", "Miscellaneous"];
const engagementStatuses = ["Prospective", "Proposal Requested", "Selected", "Under Contract", "Complete"];
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const DIRECT_UPLOAD_BYTES = 25 * 1024 * 1024;

const blankPackage = { opportunityId: "", title: "", discipline: "Architecture", phase: "Floor Plan", deliverableType: "Floor Plan", description: "", due: "", designLead: "", consultantVendorId: "" };

export function DesignLifecycleWorkspace({
  scope,
  project,
  actor,
  onNavigate,
}: {
  scope: Scope;
  project?: { number: string; name: string; projectManager: string; superintendent: string; architect: string };
  actor: { name: string; email: string; accessLevel: string; designations: string[] };
  onNavigate?: (target: string) => void;
}) {
  const [setup, setSetup] = useState<DesignSetup | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState("All Disciplines");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"" | "create" | "revision" | "review" | "release">("");
  const [packageDraft, setPackageDraft] = useState(blankPackage);
  const [revisionDraft, setRevisionDraft] = useState({ label: "", description: "", phase: scope === "Sales" ? "Floor Plan" : "Design Development" });
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [reviewDraft, setReviewDraft] = useState({ consultantVendorId: "", reviewDue: "", reviewInstructions: "" });
  const [releaseDraft, setReleaseDraft] = useState({ issuedPurpose: "Issued For Construction", distributionList: "Project Team", releaseNote: "" });
  const [assignmentDraft, setAssignmentDraft] = useState({ assignmentId: "", discipline: "Architecture", vendorId: "", engagementStatus: "Selected", contractReference: "" });
  const [packageDesignerDraft, setPackageDesignerDraft] = useState({ recordId: "", vendorId: "" });
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [drawingIndex, setDrawingIndex] = useState<DrawingIndexRecord[]>([]);

  const projectId = project?.number || "";

  async function load() {
    const search = new URLSearchParams({ scope, ...(scope === "Project" ? { projectId } : {}) });
    const response = await fetch(`/api/design-lifecycle?${search}`);
    const data = await response.json() as DesignSetup & { error?: string };
    if (!response.ok) throw new Error(data.error || "Design Lifecycle Is Unavailable");
    setSetup(data);
    setSelectedOpportunityId((current) => current || data.opportunities.find((item) => !["Lost"].includes(item.stage))?.id || data.opportunities[0]?.id || "");
    setSelectedPackageId((current) => current && data.packages.some((item) => item.id === current) ? current : data.packages[0]?.id || "");
  }

  useEffect(() => {
    let cancelled = false;
    window.scrollTo({ top: 0, behavior: "auto" });
    fetch(`/api/design-lifecycle?${new URLSearchParams({ scope, ...(scope === "Project" ? { projectId } : {}) })}`)
      .then(async (response) => {
        const data = await response.json() as DesignSetup & { error?: string };
        if (!response.ok) throw new Error(data.error || "Design Lifecycle Is Unavailable");
        if (!cancelled) {
          setSetup(data);
          setSelectedOpportunityId(data.opportunities.find((item) => item.stage !== "Lost")?.id || data.opportunities[0]?.id || "");
          setSelectedPackageId(data.packages[0]?.id || "");
        }
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Design Lifecycle Is Unavailable"));
    return () => { cancelled = true; };
  }, [projectId, scope]);

  useEffect(() => {
    const storageProjectId = scope === "Project" ? projectId : selectedOpportunityId ? `ESTIMATE-${selectedOpportunityId}` : "";
    if (!storageProjectId) return;
    let cancelled = false;
    fetch(`/api/drawing-intelligence?projectId=${encodeURIComponent(storageProjectId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { drawings?: DrawingIndexRecord[] };
        if (!cancelled && response.ok) setDrawingIndex(result.drawings || []);
      })
      .catch(() => { if (!cancelled) setDrawingIndex([]); });
    return () => { cancelled = true; };
  }, [projectId, scope, selectedOpportunityId, notice]);

  const opportunityPackages = useMemo(() => (setup?.packages || []).filter((item) => scope === "Project" || String(item.data.opportunityId || "") === selectedOpportunityId), [scope, selectedOpportunityId, setup?.packages]);
  const visiblePackages = opportunityPackages.filter((item) => (disciplineFilter === "All Disciplines" || item.data.discipline === disciplineFilter) && `${item.id} ${item.title} ${item.status} ${item.data.discipline} ${item.data.phase}`.toLowerCase().includes(query.toLowerCase()));
  const selected = setup?.packages.find((item) => item.id === selectedPackageId) || visiblePackages[0] || null;
  const packageDesignerId = packageDesignerDraft.recordId === selected?.id
    ? packageDesignerDraft.vendorId
    : String(selected?.data.consultantVendorId || "");
  const versions = selected && Array.isArray(selected.data.versions) ? selected.data.versions as Version[] : [];
  const timeline = selected && Array.isArray(selected.data.timeline) ? selected.data.timeline as Array<{ action?: string; actor?: string; at?: string; detail?: string }> : [];
  const currentVersion = versions.find((item) => item.isCurrent);
  const basisVersion = versions.find((item) => item.isBasisOfSale) || versions.find((item) => item.id === selected?.data.pricingBasisVersionId);
  const selectedOpportunity = setup?.opportunities.find((item) => item.id === selectedOpportunityId);
  const selectedTeam = setup?.designTeams.find((item) => scope === "Project" || item.opportunityId === selectedOpportunityId) || null;
  const packageDesignerOptions = scope === "Project"
    ? (setup?.consultants || []).map((item) => ({ id: item.id, name: item.name, discipline: item.discipline }))
    : (setup?.vendorOptions || []).map((item) => ({ id: item.id, name: item.name, discipline: item.type }));
  const activeTeamDisciplines = scope === "Sales" ? ["Architecture"] : designTeamDisciplines;
  const checklistGroups = Array.from(new Set((selectedTeam?.checklist || []).map((item) => item.group)));
  const canCreate = scope === "Sales" ? setup?.permissions.canManageSales : setup?.permissions.canManageProject;
  const currentSetCount = opportunityPackages.filter((item) => ["Current Set", "Record Set"].includes(item.status)).length;
  const reviewCount = opportunityPackages.filter((item) => ["Consultant Review", "Designer Approved", "Revision Required"].includes(item.status)).length;
  const lockedCount = opportunityPackages.filter((item) => item.data.basisOfSaleLocked === true).length;
  const salesDesignTracks = scope === "Sales" ? (setup?.opportunities || []).filter((item) => Boolean(item.salesDesignTrackId)) : [];

  const openCreatePanel = useCallback(() => {
    if (!canCreate) {
      setNotice("A Project Manager Or Authorized Design Lead Must Create The Design Package.");
      return;
    }
    if (scope === "Sales" && !selectedOpportunityId) {
      setNotice("Select A Sales Opportunity Before Creating A Design Package.");
      return;
    }
    setPackageDraft({
      ...blankPackage,
      opportunityId: selectedOpportunityId,
      phase: scope === "Sales" ? "Floor Plan" : "Design Development",
      deliverableType: scope === "Sales" ? "Floor Plan" : "Drawing Package",
      designLead: actor.name,
    });
    setPanel("create");
  }, [actor.name, canCreate, scope, selectedOpportunityId]);

  useEffect(() => {
    const openFromCommandBar = () => openCreatePanel();
    window.addEventListener("command:new-design-package", openFromCommandBar);
    return () => window.removeEventListener("command:new-design-package", openFromCommandBar);
  }, [openCreatePanel]);

  async function act(action: string, body: Record<string, unknown>, success: string) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/design-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, scope, ...(scope === "Project" ? { projectId } : {}), ...body }),
      });
      const result = await response.json() as { error?: string; package?: DesignPackage };
      if (!response.ok || !result.package) throw new Error(result.error || "The Design Action Could Not Be Saved");
      setSelectedPackageId(result.package.id);
      setNotice(success);
      setPanel("");
      await load();
      return result.package;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Design Action Could Not Be Saved");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function createPackage() {
    const next = await act("create-package", { ...packageDraft, opportunityId: scope === "Sales" ? packageDraft.opportunityId || selectedOpportunityId : "" }, "Design Package Created. Upload The First Controlled Revision When Ready.");
    if (next) setPackageDraft(blankPackage);
  }

  async function teamAction(action: string, body: Record<string, unknown>, success: string) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/design-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, scope, ...(scope === "Project" ? { projectId } : { opportunityId: selectedOpportunityId }), ...body }),
      });
      const result = await response.json() as { error?: string; subcontractId?: string; emailDelivery?: string };
      if (!response.ok) throw new Error(result.error || "The Design Team Action Could Not Be Saved");
      setNotice(result.subcontractId ? `${success} ${result.subcontractId} Is Ready In Subcontracts.` : result.emailDelivery ? `${success} Email: ${result.emailDelivery}.` : success);
      await load();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Design Team Action Could Not Be Saved");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function assignDesigner() {
    if (!assignmentDraft.vendorId) return;
    const saved = await teamAction("assign-designer", assignmentDraft, `${assignmentDraft.discipline} Design Team Assignment Saved.`);
    if (saved) setAssignmentDraft({ assignmentId: "", discipline: "Architecture", vendorId: "", engagementStatus: "Selected", contractReference: "" });
  }

  async function assignPackageDesigner() {
    if (!selected) return;
    await act(
      "assign-package-designer",
      { recordId: selected.id, consultantVendorId: packageDesignerId },
      `${scope === "Sales" ? "Architect" : "Designer"} Assignment Saved For ${selected.id}.`,
    );
  }

  async function addRevision() {
    if (!selected || !revisionFile) return;
    if (revisionFile.size > MAX_FILE_BYTES) {
      setNotice(`${revisionFile.name} Exceeds The 1 GB Individual File Limit.`);
      return;
    }
    setSaving(true);
    setUploadProgress(1);
    setNotice("");
    try {
      const storageProjectId = scope === "Sales" ? `ESTIMATE-${String(selected.data.opportunityId || selectedOpportunityId)}` : projectId;
      const storageCategory = scope === "Sales" ? "02-Design & Drawings" : "Design & Drawings";
      const file = revisionFile.size <= DIRECT_UPLOAD_BYTES
        ? await uploadDirect(revisionFile, storageProjectId, storageCategory, selected.id, revisionDraft.label)
        : await uploadLarge(revisionFile, storageProjectId, storageCategory, selected.id, revisionDraft.label, setUploadProgress);
      await indexDrawingUpload(revisionFile, file, storageProjectId, storageCategory, `${selected.id} · ${revisionDraft.label}`, (percent) => setUploadProgress(percent));
      const saved = await act("add-revision", {
        recordId: selected.id,
        phase: revisionDraft.phase,
        revision: { label: revisionDraft.label, description: revisionDraft.description, fileId: file.id, fileName: file.name, uploadedBy: actor.name, uploadedAt: new Date().toISOString() },
      }, `${revisionDraft.label} Uploaded And Added To The Permanent Revision History.`);
      if (saved) {
        setRevisionDraft({ label: "", description: "", phase: scope === "Sales" ? "Floor Plan" : "Design Development" });
        setRevisionFile(null);
        setUploadProgress(0);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Revision Could Not Be Uploaded");
      setSaving(false);
      setUploadProgress(0);
    }
  }

  function openReview() {
    const assigned = String(selected?.data.consultantVendorId || "");
    setReviewDraft({ consultantVendorId: assigned || setup?.consultants[0]?.id || "", reviewDue: "", reviewInstructions: "Review the latest revision and answer cost and schedule impact." });
    setPanel("review");
  }

  const lifecycleSteps = scope === "Sales"
    ? ["Opportunity", "Floor Plan / Rendering", "Pricing Basis", "Estimate Folder", "Award Handoff"]
    : ["Basis Of Sale", "Multidiscipline Design", "Designer Approval", "PM Current Set", "Record / As-Built"];

  return <div className="module-workspace design-lifecycle-workspace">
    <section className="workspace-heading design-heading">
      <div><p className="eyebrow orange-text">{scope === "Sales" ? "SALES · LIMITED PRE-CONTRACT DESIGN" : "PROJECT MANAGEMENT · DESIGN-BUILD CONTROL"}</p><h1>{scope === "Sales" ? "Sales Design" : "Design & Drawings"}</h1><p>{scope === "Sales" ? "Create only the floor plans and renderings needed to sell the work. Every file automatically appears in the estimate folder and follows the job at award." : `${project?.name} · Run the full design/build contract from the locked Basis of Sale through permit, construction, and record drawings.`}</p></div>
      <button className="primary-action large" disabled={!canCreate || (scope === "Sales" && !selectedOpportunityId)} onClick={openCreatePanel}>＋ New {scope === "Sales" ? "Sales Design" : "Design Package"}</button>
    </section>

    <section className="design-safeguard-strip">
      <article><span>PRE-CONTRACT LIMIT</span><strong>{scope === "Sales" ? "FLOOR PLANS + RENDERINGS" : "FULL DESIGN-BUILD"}</strong><small>{scope === "Sales" ? "No permit or construction design" : "All contracted disciplines"}</small></article>
      <article><span>ARCHITECT CONTROL</span><strong>PACKAGE ASSIGNMENT</strong><small>Each design has one accountable designer</small></article>
      <article><span>{scope === "Sales" ? "ESTIMATE FILES" : "OFFICIAL CURRENT SET"}</span><strong>{scope === "Sales" ? "AUTOMATIC FOLDER FEED" : "PM RELEASE ONLY"}</strong><small>{scope === "Sales" ? "02-Design & Drawings" : "After designer approval"}</small></article>
      <article><span>AWARD HANDOFF</span><strong>LOCK + COPY FORWARD</strong><small>Sales snapshot never changes</small></article>
    </section>
    <section className="design-ocr-index"><header><div><h2>OCR Sheet &amp; Revision Index</h2></div><b>{drawingIndex.reduce((total, item) => total + (item.data.sheets?.length || 0), 0)} SHEETS</b></header><div>{drawingIndex.flatMap((record) => (record.data.sheets || []).map((sheet) => ({ ...sheet, record }))).slice(0, 12).map((item, index) => <article key={`${item.record.id}-${item.page || index}`}><i>{item.sheetNumber || `P${item.page || index + 1}`}</i><span><strong>{item.sheetTitle || item.record.title}</strong><small>{item.discipline || "Unclassified"} · Rev {item.revision || "Review"} · {item.revisionDate || "Date Review Required"}</small></span><b className={item.needsReview ? "review" : "indexed"}>{item.needsReview ? "VERIFY" : `${item.confidence || 0}%`}</b></article>)}{!drawingIndex.length ? <div className="design-empty"><b>No Drawings Indexed Yet</b><span>Upload a PDF or image revision. OCR starts automatically and the result appears here.</span></div> : null}</div></section>

    <section className="design-lifecycle-lane" aria-label="Design lifecycle">{lifecycleSteps.map((step, index) => <article key={step}><i>{index + 1}</i><span>{step}</span>{index < lifecycleSteps.length - 1 ? <b>→</b> : null}</article>)}</section>
    {notice ? <div className={/could not|required|only|unavailable|exceed|immutable|first/i.test(notice) ? "form-error" : "inline-success"}>{notice}</div> : null}

    {scope === "Sales" ? <><section className="sales-design-context"><label><span>SALES OPPORTUNITY</span><select value={selectedOpportunityId} onChange={(event) => { setSelectedOpportunityId(event.target.value); setSelectedPackageId(""); }}><option value="">Select Opportunity</option>{setup?.opportunities.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.company || item.stage}</option>)}</select></label>{selectedOpportunity ? <div><span><b>{selectedOpportunity.stage}</b><small>{selectedOpportunity.assignedRep}</small></span><span><b>{selectedOpportunity.awardedProjectNumber || "Not Awarded"}</b><small>{selectedOpportunity.awardedProjectNumber ? "Basis Snapshot Locked" : selectedOpportunity.salesDesignTrackStatus || "Working Sales Design"}</small></span></div> : null}</section><section className="design-track-register"><header><div><h2>Active Sales Design Tracks</h2></div><b>{salesDesignTracks.length} ACTIVE</b></header><div>{salesDesignTracks.length ? salesDesignTracks.map((item) => <button key={item.id} className={selectedOpportunityId === item.id ? "active" : ""} onClick={() => { setSelectedOpportunityId(item.id); setSelectedPackageId(""); }}><span><small>{item.deliveryMethod}</small><strong>{item.title}</strong><p>{item.company} · {item.assignedRep}</p></span><i>{item.salesDesignTrackStatus || "DESIGN BRIEF REQUIRED"}</i></button>) : <div className="design-empty"><b>No Automatic Design Tracks Yet</b><span>The first qualifying Design-Build opportunity will appear here when it enters Estimating.</span></div>}</div></section></> : null}

    <section className="design-team-board">
      <div className="design-team-heading"><div><p className="eyebrow orange-text">{scope === "Sales" ? "DEFAULT SALES ARCHITECT" : "DESIGN TEAM · CONTRACT · PORTAL"}</p><h2>{scope === "Sales" ? "Opportunity Architect" : "Design Team Roster"}</h2><p>{scope === "Sales" ? "Set the default architect for this opportunity. You can still assign a different authorized vendor to an individual floor plan or rendering." : "Select the contracted designer by discipline once. The assignment follows controlled packages, portal access, notifications, checklist expectations, and any linked designer subcontract."}</p></div><span>{selectedTeam?.assignments.length || 0} OF {activeTeamDisciplines.length} {scope === "Sales" ? "ARCHITECT" : "DISCIPLINES"} ASSIGNED</span></div>
      {canCreate && !selectedTeam?.locked ? <div className="design-team-assignment-form">{scope === "Project" ? <label>Discipline<select value={assignmentDraft.discipline} onChange={(event) => setAssignmentDraft((current) => ({ ...current, discipline: event.target.value, assignmentId: selectedTeam?.assignments.find((item) => item.discipline === event.target.value)?.id || "" }))}>{designTeamDisciplines.map((item) => <option key={item}>{item}</option>)}</select></label> : null}<label>{scope === "Sales" ? "Default Architect" : "Vendor / Designer"}<select value={assignmentDraft.vendorId} onChange={(event) => setAssignmentDraft((current) => ({ ...current, vendorId: event.target.value }))}><option value="">Select From Vendor Directory</option>{setup?.vendorOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.type} · {item.temporaryApproval ? "Temporary Approval" : item.paymentHold ? "Payment Hold" : "Current"}</option>)}</select><small>All vendor types remain selectable; compliance affects payment only and never holds project progress. Temporary approvals remain available.</small></label>{scope === "Project" ? <><label>Engagement<select value={assignmentDraft.engagementStatus} onChange={(event) => setAssignmentDraft((current) => ({ ...current, engagementStatus: event.target.value }))}>{engagementStatuses.map((item) => <option key={item}>{item}</option>)}</select></label><label>Contract / Proposal Reference<input value={assignmentDraft.contractReference} onChange={(event) => setAssignmentDraft((current) => ({ ...current, contractReference: event.target.value }))} placeholder="Optional until signed" /></label></> : null}<button className="primary-action" disabled={saving || !assignmentDraft.vendorId || (scope === "Sales" && !selectedOpportunityId)} onClick={() => void assignDesigner()}>{assignmentDraft.assignmentId ? `Update ${scope === "Sales" ? "Architect" : "Designer"}` : `Assign ${scope === "Sales" ? "Architect" : "Designer"}`}</button></div> : null}
      <div className="design-team-roster">{activeTeamDisciplines.map((discipline) => {
        const assignment = selectedTeam?.assignments.find((item) => item.discipline === discipline);
        return <article key={discipline} className={assignment ? "assigned" : "open"}><header><span>{discipline.slice(0, 2).toUpperCase()}</span><div><strong>{discipline}</strong><small>{assignment?.engagementStatus || "Designer Not Assigned"}</small></div></header>{assignment ? <><h3>{assignment.vendorName}</h3><p>{assignment.contactName} · {assignment.contactEmail}</p><div className="design-team-badges"><i className={assignment.portalStatus.toLowerCase().replaceAll(" ", "-")}>{assignment.portalStatus}</i><i className="email-on">EMAIL UPDATES ON</i></div><dl><div><dt>Contract / Proposal</dt><dd>{assignment.contractReference || "Not Linked"}</dd></div><div><dt>Designer Subcontract</dt><dd>{assignment.linkedSubcontractId || (scope === "Project" ? "Not Initiated" : "Available After Award")}</dd></div></dl>{canCreate && !selectedTeam?.locked ? <footer><button onClick={() => setAssignmentDraft({ assignmentId: assignment.id, discipline: assignment.discipline, vendorId: assignment.vendorId, engagementStatus: assignment.engagementStatus, contractReference: assignment.contractReference })}>Edit Assignment</button>{scope === "Project" && !assignment.linkedSubcontractId ? <button onClick={() => void teamAction("initiate-designer-subcontract", { assignmentId: assignment.id }, "Draft Designer Subcontract Initiated.")}>Initiate Draft Subcontract</button> : assignment.linkedSubcontractId ? <button onClick={() => onNavigate?.("Subcontracts")}>Open {assignment.linkedSubcontractId}</button> : null}</footer> : null}</> : <p>Choose a company from the Vendor Directory to establish controlled responsibility.</p>}</article>;
      })}</div>
      {scope === "Project" ? <section className="design-expectations"><div className="design-section-heading"><div><h3>Standard Design Expectations</h3></div><span>{selectedTeam?.checklist.filter((item) => item.completed).length || 0} / {selectedTeam?.checklist.length || 13} COMPLETE</span></div>{!selectedTeam ? <div className="design-empty"><b>Assign The First Designer To Start The Standard Checklist</b></div> : checklistGroups.map((group) => <details key={group} open><summary><b>{group}</b><span>{selectedTeam.checklist.filter((item) => item.group === group && item.completed).length} / {selectedTeam.checklist.filter((item) => item.group === group).length}</span></summary>{selectedTeam.checklist.filter((item) => item.group === group).map((item) => <label key={item.id} className={item.completed ? "complete" : ""}><input type="checkbox" checked={item.completed} disabled={!canCreate || selectedTeam.locked || saving} onChange={(event) => void teamAction("update-checklist", { checklistItemId: item.id, completed: event.target.checked }, `${item.label} ${event.target.checked ? "Completed" : "Reopened"}.`)} /><span><strong>{item.label}</strong><small>{item.completed ? `${item.completedBy} · ${formatDateTime(item.completedAt)}` : item.required ? "Required Standard Expectation" : "Optional"}</small></span><i>{item.completed ? "COMPLETE" : "OPEN"}</i></label>)}</details>)}</section> : null}
    </section>

    <section className="design-summary">
      <article {...summaryDrilldownProps({ title: "Design Packages", rows: opportunityPackages.map((item) => designSummaryRow(item, setSelectedPackageId)) })}><strong>{opportunityPackages.length}</strong><span>Design Packages</span></article>
      <article {...summaryDrilldownProps({ title: scope === "Sales" ? "Locked Basis Packages" : "Current Design Sets", rows: opportunityPackages.filter((item) => scope === "Sales" ? item.data.basisOfSaleLocked === true : item.status === "Current Set").map((item) => designSummaryRow(item, setSelectedPackageId)) })}><strong>{scope === "Sales" ? lockedCount : currentSetCount}</strong><span>{scope === "Sales" ? "Locked Basis" : "Current Sets"}</span></article>
      <article {...summaryDrilldownProps({ title: "Design Review And Decisions", rows: opportunityPackages.filter((item) => /review|decision/i.test(item.status)).map((item) => designSummaryRow(item, setSelectedPackageId)) })}><strong>{reviewCount}</strong><span>Review / Decision</span></article>
      <article {...summaryDrilldownProps({ title: "Stored Design Revisions", rows: opportunityPackages.flatMap((item) => (Array.isArray(item.data.versions) ? item.data.versions : []).map((version, index) => ({ id: `${item.id}-${index}`, title: String((version as Record<string, unknown>).label || `Revision ${index + 1}`), subtitle: `${item.title} · ${String((version as Record<string, unknown>).fileName || "Stored revision")}`, status: String((version as Record<string, unknown>).issuedPurpose || "Stored"), meta: String((version as Record<string, unknown>).releasedAt || (version as Record<string, unknown>).uploadedAt || ""), onOpen: () => setSelectedPackageId(item.id), openLabel: "Open Package →" }))) })}><strong>{opportunityPackages.reduce((total, item) => total + (Array.isArray(item.data.versions) ? item.data.versions.length : 0), 0)}</strong><span>Stored Revisions</span></article>
    </section>

    <section className="design-register">
      <aside className="design-package-list">
        <div className="design-register-filters"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search design packages…" /></label>{scope === "Project" ? <select value={disciplineFilter} onChange={(event) => setDisciplineFilter(event.target.value)}><option>All Disciplines</option>{disciplines.map((item) => <option key={item}>{item}</option>)}</select> : null}</div>
        {!visiblePackages.length ? <div className="design-empty"><b>No Design Packages Yet</b></div> : visiblePackages.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => { setSelectedPackageId(item.id); setPanel(""); }}><header><b>{item.id}</b><i className={`design-status ${item.status.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}>{item.status}</i></header><strong>{item.title}</strong><span>{scope === "Sales" ? String(item.data.deliverableType || "Sales Design") : `${String(item.data.discipline || "Design")} · ${String(item.data.phase || "Phase Pending")}`}</span><small>{Array.isArray(item.data.versions) ? item.data.versions.length : 0} Revisions · Due {formatDate(item.due)}</small></button>)}
      </aside>
      <div className="design-package-detail">
        {!selected ? <div className="design-empty large"><b>Select A Design Package</b></div> : <>
          <header className="design-detail-heading"><div><p className="eyebrow orange-text">{selected.id} · {String(selected.data.discipline || "DESIGN").toUpperCase()}</p><h2>{selected.title}</h2><span>{String(selected.data.phase || "Phase Pending")} · Owned By {selected.owner} · Due {formatDate(selected.due)}</span></div><i className={`design-status large ${selected.status.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`}>{selected.status}</i></header>
          {selected.data.basisOfSaleSnapshot || selected.data.basisOfSaleLocked ? <section className="basis-of-sale-card"><span>🔒</span><div><strong>{selected.data.basisOfSaleLocked ? "Immutable Basis Of Sale" : "Working Copy From Locked Basis Of Sale"}</strong><p>{selected.data.basisOfSaleLocked ? "Award locked this sales package. New design work must continue in the awarded project copy." : `Source ${String(selected.data.sourceSalesPackageId || selected.id)} remains preserved exactly as sold.`}</p></div><b>LOCKED AT AWARD</b></section> : null}
          <section className="design-detail-grid"><article><span>DELIVERABLE</span><strong>{String(selected.data.deliverableType || "Drawing Package")}</strong><p>{String(selected.data.description || "No Description Recorded")}</p></article><article><span>{scope === "Sales" ? "ASSIGNED ARCHITECT" : "DESIGN LEAD"}</span><strong>{String(selected.data.designLead || selected.owner)}</strong><p>{setup?.vendorOptions.find((item) => item.id === selected.data.consultantVendorId)?.name || setup?.consultants.find((item) => item.id === selected.data.consultantVendorId)?.name || (scope === "Project" ? "Consultant Not Assigned" : "Architect Not Assigned")}</p></article><article><span>CURRENT CONTROL</span><strong>{currentVersion?.label || basisVersion?.label || "No Released Revision"}</strong><p>{currentVersion ? `${currentVersion.issuedPurpose} · Released ${formatDateTime(currentVersion.releasedAt || "")}` : basisVersion ? "Pricing basis selected; award will lock it." : scope === "Sales" ? "Every revision feeds the estimate folder automatically." : "Upload a revision to begin control."}</p></article></section>
          <section className="design-actions">
            {canCreate && selected.data.basisOfSaleLocked !== true ? <><label className="field-label">{scope === "Sales" ? "Assigned Architect For This Design" : "Assigned Designer For This Package"}<select value={packageDesignerId} onChange={(event) => setPackageDesignerDraft({ recordId: selected.id, vendorId: event.target.value })}><option value="">Not Assigned</option>{packageDesignerOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.discipline || "Design Consultant"}</option>)}</select></label><button className="secondary-action" disabled={saving || packageDesignerId === String(selected.data.consultantVendorId || "")} onClick={() => void assignPackageDesigner()}>Save Assignment</button><button className="secondary-action" onClick={() => { setRevisionDraft({ label: `Rev ${versions.length + 1}`, description: "", phase: String(selected.data.phase || (scope === "Sales" ? "Floor Plan" : "Design Development")) }); setRevisionFile(null); setPanel("revision"); }}>Upload Revision</button></> : null}
            {scope === "Sales" && setup?.permissions.canManageSales && versions.length > 0 && selected.status !== "Pricing Basis" && selected.data.basisOfSaleLocked !== true ? <button className="primary-action" disabled={saving} onClick={() => void act("mark-pricing-basis", { recordId: selected.id }, "Latest Revision Marked As The Pricing And Proposal Basis. Award Will Lock It Permanently.")}>Mark Pricing Basis</button> : null}
            {scope === "Project" && setup?.permissions.canReleaseCurrentSet && versions.length > 0 && !["Consultant Review", "Designer Approved"].includes(selected.status) ? <button className="primary-action" onClick={openReview}>Send Designer Review</button> : null}
            {scope === "Project" && setup?.permissions.canReleaseCurrentSet && selected.status === "Designer Approved" ? <button className="primary-action" onClick={() => setPanel("release")}>Release Official Current Set</button> : null}
            {scope === "Project" && !setup?.permissions.canReleaseCurrentSet && selected.status === "Designer Approved" ? <div className="permission-note"><strong>PM Release Required</strong><span>The designer approved this revision, but only a Project Manager can make it the official Current Set.</span></div> : null}
          </section>
          <section className="design-revision-register"><div className="design-section-heading"><div><h3>Revision Register</h3></div><span>{versions.length} VERSIONS</span></div>{!versions.length ? <div className="design-empty"><b>No Revisions Uploaded</b></div> : [...versions].reverse().map((version) => <article key={version.id}><span className={version.isCurrent ? "revision-badge current" : version.isBasisOfSale ? "revision-badge basis" : "revision-badge"}>{version.isCurrent ? "CURRENT" : version.isBasisOfSale ? "BASIS" : version.label.slice(0, 3).toUpperCase()}</span><div><strong>{version.label} · {version.fileName}</strong><small>{version.uploadedBy} · {formatDateTime(version.uploadedAt)}</small><p>{version.description || "No Revision Narrative"}</p></div><div><i className={`designer-decision ${(version.designerDecision || "pending").toLowerCase().replaceAll(" ", "-")}`}>{version.designerDecision || "Pending"}</i>{version.designerName ? <small>{version.designerName} · {formatDateTime(version.designerReviewedAt || "")}</small> : null}<button onClick={() => window.open(`/api/files?id=${version.fileId}`, "_blank", "noopener,noreferrer")}>Open File ↗</button></div></article>)}</section>
          <section className="design-audit-timeline"><div className="design-section-heading"><div><h3>Lifecycle Timeline</h3></div></div>{[...timeline].reverse().map((event, index) => <article key={`${event.at}-${index}`}><i>{index === 0 ? "●" : "○"}</i><div><strong>{event.action}</strong><span>{event.actor} · {formatDateTime(String(event.at || ""))}</span><p>{event.detail}</p></div></article>)}</section>
        </>}
      </div>
    </section>

    {panel ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPanel("")}><section className="record-modal wide design-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow orange-text">{scope === "Sales" ? "LIMITED PRE-CONTRACT DESIGN" : "DESIGN LIFECYCLE CONTROL"}</p><h2>{panel === "create" ? `New ${scope === "Sales" ? "Sales Design" : "Design Package"}` : panel === "revision" ? `Upload Revision · ${selected?.id}` : panel === "review" ? `Send Designer Review · ${selected?.id}` : `Release Official Current Set · ${selected?.id}`}</h2><span>{panel === "create" ? scope === "Sales" ? "Create only a floor plan or rendering needed to sell this opportunity." : "Create one controlled package per discipline and deliverable." : panel === "revision" ? "The prior revision remains permanent; this upload never overwrites it." : panel === "review" ? "The consultant receives only this assigned package through controlled portal access." : "PM release is the final gate after recorded designer approval."}</span></div><button aria-label="Close" onClick={() => setPanel("")}>×</button></div>
      {panel === "create" ? <><div className="field-grid">{scope === "Sales" ? <><label className="field-label wide">Sales Opportunity<select value={packageDraft.opportunityId || selectedOpportunityId} onChange={(event) => setPackageDraft({ ...packageDraft, opportunityId: event.target.value })}><option value="">Select Opportunity</option>{setup?.opportunities.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.company}</option>)}</select></label><label className="field-label">Design Type<select value={packageDraft.deliverableType} onChange={(event) => setPackageDraft({ ...packageDraft, deliverableType: event.target.value, phase: event.target.value, discipline: "Architecture" })}>{salesDesignTypes.map((item) => <option key={item}>{item}</option>)}</select></label></> : <><label className="field-label">Discipline<select value={packageDraft.discipline} onChange={(event) => { const discipline = event.target.value; const teamDiscipline = designTeamDisciplineForPackage(discipline); const assigned = packageDesignerOptions.find((item) => item.discipline === teamDiscipline || item.discipline === discipline); setPackageDraft({ ...packageDraft, discipline, consultantVendorId: assigned?.id || "" }); }}>{disciplines.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Phase<select value={packageDraft.phase} onChange={(event) => setPackageDraft({ ...packageDraft, phase: event.target.value })}>{projectPhases.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Deliverable Type<select value={packageDraft.deliverableType} onChange={(event) => setPackageDraft({ ...packageDraft, deliverableType: event.target.value })}>{deliverableTypes.map((item) => <option key={item}>{item}</option>)}</select></label></>}<label className="field-label wide">Package / Deliverable Title<input autoFocus value={packageDraft.title} onChange={(event) => setPackageDraft({ ...packageDraft, title: event.target.value })} placeholder={scope === "Sales" ? "Example: First Floor Sales Plan" : "Example: Main Building Architectural Set"} /></label><label className="field-label">Due Date<input type="date" value={packageDraft.due} onChange={(event) => setPackageDraft({ ...packageDraft, due: event.target.value })} /></label><label className="field-label">Design Lead<input value={packageDraft.designLead} onChange={(event) => setPackageDraft({ ...packageDraft, designLead: event.target.value })} /></label><label className="field-label">{scope === "Sales" ? "Assigned Architect" : "Assigned Designer"}<select value={packageDraft.consultantVendorId} onChange={(event) => setPackageDraft({ ...packageDraft, consultantVendorId: event.target.value })}><option value="">Assign Later</option>{packageDesignerOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.discipline || "Design Consultant"}</option>)}</select></label></div><label className="field-label">Scope / Design Intent<textarea rows={5} value={packageDraft.description} onChange={(event) => setPackageDraft({ ...packageDraft, description: event.target.value })} /></label><div className="form-rule"><strong>{scope === "Sales" ? "Sales Guardrail:" : "Project Design:"}</strong> {scope === "Sales" ? "Only floor plans and renderings are allowed before award. Files feed 02-Design & Drawings in the estimate automatically, then follow the job into Project Management." : "Uploaded revisions are working documents until designer approval and PM release."}</div></> : null}
      {panel === "revision" ? <><div className="field-grid"><label className="field-label">Revision Label<input autoFocus value={revisionDraft.label} onChange={(event) => setRevisionDraft({ ...revisionDraft, label: event.target.value })} /></label>{scope === "Project" ? <label className="field-label">Design Phase<select value={revisionDraft.phase} onChange={(event) => setRevisionDraft({ ...revisionDraft, phase: event.target.value })}>{projectPhases.map((item) => <option key={item}>{item}</option>)}</select></label> : <label className="field-label">Sales Design Type<input value={String(selected?.data.deliverableType || "Floor Plan")} readOnly /></label>}</div><label className="field-label">Revision Narrative<textarea rows={4} value={revisionDraft.description} onChange={(event) => setRevisionDraft({ ...revisionDraft, description: event.target.value })} placeholder="Describe what changed and why" /></label><label className="signed-pdf-upload"><input type="file" onChange={(event) => setRevisionFile(event.target.files?.[0] || null)} /><span>＋</span><strong>{revisionFile?.name || (scope === "Sales" ? "Choose Floor Plan Or Rendering File" : "Choose Drawing, Model, Rendering, Or Design File")}</strong><small>Individual File Up To 1 GB · Large Files Upload In Secure Parts</small></label>{uploadProgress ? <div className="design-upload-progress"><span style={{ width: `${uploadProgress}%` }} /><b>{uploadProgress}%</b></div> : null}</> : null}
      {panel === "review" ? <><div className="field-grid"><label className="field-label">Architect / Engineer<select value={reviewDraft.consultantVendorId} onChange={(event) => setReviewDraft({ ...reviewDraft, consultantVendorId: event.target.value })}><option value="">Select Controlled Consultant</option>{setup?.consultants.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.contactName}</option>)}</select></label><label className="field-label">Review Due<input type="date" value={reviewDraft.reviewDue} onChange={(event) => setReviewDraft({ ...reviewDraft, reviewDue: event.target.value })} /></label></div><label className="field-label">Review Instructions<textarea rows={5} value={reviewDraft.reviewInstructions} onChange={(event) => setReviewDraft({ ...reviewDraft, reviewInstructions: event.target.value })} /></label><div className="form-rule"><strong>Controlled Portal Review:</strong> The consultant must disposition the latest revision and answer Cost Impact and Schedule Impact. Yes or Unknown creates linked exposure without changing the contract.</div>{!setup?.consultants.length ? <div className="form-error">Add the architect or engineer as a Design Consultant in Vendor Management, grant this project Design Review access, and prepare their portal invite.</div> : null}</> : null}
      {panel === "release" ? <><div className="field-grid"><label className="field-label">Official Issue Purpose<select value={releaseDraft.issuedPurpose} onChange={(event) => setReleaseDraft({ ...releaseDraft, issuedPurpose: event.target.value })}>{issuePurposes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">Distribution List<input value={releaseDraft.distributionList} onChange={(event) => setReleaseDraft({ ...releaseDraft, distributionList: event.target.value })} placeholder="Project Team, Owner, AHJ" /></label></div><label className="field-label">Release Note<textarea rows={4} value={releaseDraft.releaseNote} onChange={(event) => setReleaseDraft({ ...releaseDraft, releaseNote: event.target.value })} /></label><div className="design-release-certification"><strong>PM RELEASE CERTIFICATION</strong><span>The latest revision has a recorded designer approval. Releasing it makes that revision the official Current Set and supersedes only the prior revision inside this package.</span><small>No contract amount or schedule date changes automatically.</small></div></> : null}
      <div className="modal-actions"><button className="secondary-action" onClick={() => setPanel("")}>Cancel</button><button className="primary-action large" disabled={saving || (panel === "create" && (!packageDraft.title || !packageDraft.due || (scope === "Sales" && !(packageDraft.opportunityId || selectedOpportunityId)))) || (panel === "revision" && (!revisionDraft.label || !revisionFile)) || (panel === "review" && (!reviewDraft.consultantVendorId || !reviewDraft.reviewDue)) || (panel === "release" && !releaseDraft.issuedPurpose)} onClick={() => void (panel === "create" ? createPackage() : panel === "revision" ? addRevision() : panel === "review" ? act("send-consultant-review", { recordId: selected?.id, ...reviewDraft }, "Latest Revision Sent For Controlled Architect / Engineer Review.") : act("release-current-set", { recordId: selected?.id, issuedPurpose: releaseDraft.issuedPurpose, distributionList: splitList(releaseDraft.distributionList), releaseNote: releaseDraft.releaseNote }, "Official Current Set Released By The Project Manager."))}>{saving ? (uploadProgress ? `Uploading ${uploadProgress}%…` : "Saving Permanently…") : panel === "create" ? "Create Design Package" : panel === "revision" ? "Upload Permanent Revision" : panel === "review" ? "Send Controlled Review" : "Release Official Current Set"}</button></div>
    </section></div> : null}
  </div>;
}

function designSummaryRow(item: DesignPackage, select: (id: string) => void) {
  return { id: item.id, title: item.title, subtitle: `${String(item.data.discipline || item.data.deliverableType || "Design")} · Due ${formatDate(item.due)}`, status: item.status, meta: `${Array.isArray(item.data.versions) ? item.data.versions.length : 0} stored revisions`, onOpen: () => select(item.id), openLabel: "Open Package →" };
}

type StoredFile = { id: number; name: string };

async function uploadDirect(file: File, projectId: string, category: string, recordId: string, revision: string): Promise<StoredFile> {
  const form = new FormData();
  form.set("file", file);
  form.set("projectId", projectId);
  form.set("category", category);
  form.set("revision", `${recordId} · ${revision}`);
  form.set("access", "Controlled Design Team");
  const response = await fetch("/api/files", { method: "POST", body: form });
  const result = await response.json() as { file?: StoredFile; error?: string };
  if (!response.ok || !result.file) throw new Error(result.error || `${file.name} Could Not Be Stored`);
  return result.file;
}

async function uploadLarge(file: File, projectId: string, category: string, recordId: string, revision: string, progress: (value: number) => void): Promise<StoredFile> {
  let storageKey = "";
  let uploadId = "";
  try {
    const createResponse = await fetch("/api/files/multipart?action=create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, name: file.name, category, revision: `${recordId} · ${revision}`, access: "Controlled Design Team", contentType: file.type || "application/octet-stream", sizeBytes: file.size }) });
    const created = await createResponse.json() as { storageKey?: string; uploadId?: string; partSize?: number; error?: string };
    if (!createResponse.ok || !created.storageKey || !created.uploadId) throw new Error(created.error || `${file.name} Could Not Begin Uploading`);
    storageKey = created.storageKey;
    uploadId = created.uploadId;
    const partSize = Math.min(DIRECT_UPLOAD_BYTES, Math.max(5 * 1024 * 1024, Number(created.partSize) || DIRECT_UPLOAD_BYTES));
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / partSize);
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const body = file.slice(index * partSize, Math.min((index + 1) * partSize, file.size));
      const search = new URLSearchParams({ projectId, storageKey, uploadId, partNumber: String(partNumber) });
      const response = await fetch(`/api/files/multipart?${search}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body });
      const part = await response.json() as { partNumber?: number; etag?: string; error?: string };
      if (!response.ok || !part.partNumber || !part.etag) throw new Error(part.error || `${file.name} Stopped At Part ${partNumber}`);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      progress(Math.round(partNumber / totalParts * 95));
    }
    const completeResponse = await fetch("/api/files/multipart?action=complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, name: file.name, category, revision: `${recordId} · ${revision}`, access: "Controlled Design Team", contentType: file.type || "application/octet-stream", sizeBytes: file.size, storageKey, uploadId, parts }) });
    const complete = await completeResponse.json() as { file?: StoredFile; error?: string };
    if (!completeResponse.ok || !complete.file) throw new Error(complete.error || `${file.name} Could Not Be Completed`);
    progress(100);
    return complete.file;
  } catch (error) {
    if (storageKey && uploadId) await fetch("/api/files/multipart", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, storageKey, uploadId }) }).catch(() => undefined);
    throw error;
  }
}

function splitList(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function designTeamDisciplineForPackage(discipline: string) { if (["Mechanical", "Electrical", "Plumbing"].includes(discipline)) return "MEP"; if (["Architecture", "Structural", "Civil"].includes(discipline)) return discipline; return "Miscellaneous"; }
function formatDate(value: string) { if (!value) return "Not Set"; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value || "Not Recorded" : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
