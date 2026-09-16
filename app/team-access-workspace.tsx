"use client";

import { useCallback, useEffect, useState } from "react";
import { ALL_COMPANY_DESIGNATIONS, PROJECT_DESIGNATIONS } from "../lib/team-access";
import { MEFFORD_COMPANY_DIRECTORY } from "./company-directory";

type CommandSessionActor = { name: string; email: string; accessLevel: string; authenticated?: boolean; projectDesignations?: string[] };

function Mark() { return <div className="brand-mark" aria-hidden="true"><img src="/mefford-logo.png" alt="" /></div>; }

type SubcontractorInvite = {
  id?: string;
  vendorId?: string;
  company: string;
  email: string;
  project: string;
  folder: string;
  status: string;
  expires: string;
};

type DesignationChangeRequest = {
  id: string;
  project: string;
  employeeName: string;
  employeeEmail?: string;
  requestedBy: string;
  currentDesignations: string[];
  requestedDesignations: string[];
  reason: string;
  submitted: string;
  status: "Pending" | "Approved" | "Rejected";
  decisionNote: string;
  reviewedBy: string;
  reviewedAt: string;
};

type DesignationAuditEvent = {
  id: string;
  project: string;
  employeeName: string;
  action: "Owner Override";
  previousDesignations: string[];
  nextDesignations: string[];
  requestedBy: string;
  reviewedBy: string;
  occurredAt: string;
  note: string;
};

const employeeAccess = MEFFORD_COMPANY_DIRECTORY;

const startingInvites: SubcontractorInvite[] = [];

const startingDesignationRequests: DesignationChangeRequest[] = [];

const startingOwnerOverrides: DesignationAuditEvent[] = [];

type TeamAccessPermissions = {
  canManageDesignations: boolean;
  canRequestDesignations: boolean;
  canOwnerOverride: boolean;
  canInvite: boolean;
};

export function TeamAccessWorkspace({
  projectId,
  projectName,
  actor,
}: {
  projectId: string;
  projectName: string;
  actor: CommandSessionActor;
}) {
  const [employees, setEmployees] = useState(employeeAccess);
  const [invites, setInvites] = useState(startingInvites.slice(0, 0));
  const [designationRequests, setDesignationRequests] = useState(
    startingDesignationRequests,
  );
  const [ownerOverrides, setOwnerOverrides] = useState(startingOwnerOverrides);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [signinOpen, setSigninOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
  const [requestEmployeeIndex, setRequestEmployeeIndex] = useState(0);
  const [requestedDesignations, setRequestedDesignations] = useState<string[]>(
    employeeAccess[0]?.projectDesignations || [],
  );
  const [requestReason, setRequestReason] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [ownerOverrideOpen, setOwnerOverrideOpen] = useState(false);
  const [ownerEmployeeIndex, setOwnerEmployeeIndex] = useState(0);
  const [ownerDraftDesignations, setOwnerDraftDesignations] = useState<
    string[]
  >(employeeAccess[0]?.projectDesignations || []);
  const [ownerOverrideReason, setOwnerOverrideReason] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [folder, setFolder] = useState("Subcontractor Inbox");
  const [inviteNotice, setInviteNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviteCredentials, setInviteCredentials] = useState<{ url: string; code: string } | null>(null);
  const [permissions, setPermissions] = useState<TeamAccessPermissions>({
    canManageDesignations: false,
    canRequestDesignations: false,
    canOwnerOverride: false,
    canInvite: false,
  });
  const [editingEmployeeIndex, setEditingEmployeeIndex] = useState<
    number | null
  >(null);
  const [draftDesignations, setDraftDesignations] = useState<string[]>([]);
  const [designationScope, setDesignationScope] = useState<
    "project" | "default"
  >("project");
  const editingEmployee =
    editingEmployeeIndex === null ? null : employees[editingEmployeeIndex];
  const requestEmployee = employees[requestEmployeeIndex];
  const ownerEmployee = employees[ownerEmployeeIndex];
  const reviewRequest = designationRequests.find(
    (request) => request.id === reviewRequestId,
  );
  const pendingDesignationRequestCount = designationRequests.filter(
    (request) => request.status === "Pending",
  ).length;
  const designationOptions = designationScope === "project"
    ? PROJECT_DESIGNATIONS
    : ALL_COMPANY_DESIGNATIONS;

  const loadTeamAccess = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/team-access?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const result = await response.json() as {
        employees?: typeof employeeAccess;
        invites?: SubcontractorInvite[];
        designationRequests?: DesignationChangeRequest[];
        ownerOverrides?: DesignationAuditEvent[];
        permissions?: TeamAccessPermissions;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Team Access Is Unavailable.");
      setEmployees(result.employees || []);
      setInvites(result.invites || []);
      setDesignationRequests(result.designationRequests || []);
      setOwnerOverrides(result.ownerOverrides || []);
      if (result.permissions) setPermissions(result.permissions);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "Team Access Is Unavailable.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    queueMicrotask(() => void loadTeamAccess());
  }, [loadTeamAccess]);

  async function teamAction(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch("/api/team-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      const result = await response.json() as { error?: string; url?: string; code?: string };
      if (!response.ok) throw new Error(result.error || "The Team Access Action Could Not Be Saved.");
      await loadTeamAccess();
      return result;
    } finally {
      setSaving(false);
    }
  }

  function openDesignationEditor(index: number) {
    const person = employees[index];
    if (!person) return;
    setEditingEmployeeIndex(index);
    setDesignationScope("project");
    setDraftDesignations(person.projectDesignations);
  }

  function chooseDesignationScope(scope: "project" | "default") {
    if (!editingEmployee) return;
    setDesignationScope(scope);
    setDraftDesignations(
      scope === "project"
        ? editingEmployee.projectDesignations
        : editingEmployee.defaultDesignations,
    );
  }

  function toggleDesignation(designation: string) {
    setDraftDesignations((current) =>
      current.includes(designation)
        ? current.filter((item) => item !== designation)
        : [...current, designation],
    );
  }

  async function saveDesignations() {
    if (editingEmployeeIndex === null || !editingEmployee) return;
    try {
      await teamAction({ action: "save-designations", employeeEmail: editingEmployee.email, scope: designationScope, designations: draftDesignations });
      setInviteNotice(designationScope === "project"
        ? `${editingEmployee.name}’s ${projectName} designations were saved permanently and are now enforced.`
        : `${editingEmployee.name}’s company default designations were saved permanently.`);
      setEditingEmployeeIndex(null);
      setDraftDesignations([]);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Designations Could Not Be Saved.");
    }
  }

  function openDesignationRequest() {
    if (!employees.length) {
      setInviteNotice("No active employee is available for a role assignment.");
      return;
    }
    const currentEmployeeIndex = employees.findIndex(
      (person) => person.email.toLowerCase() === actor.email.toLowerCase(),
    );
    const firstAssignedEmployeeIndex = employees.findIndex(
      (person) => person.projectDesignations.length > 0,
    );
    const employeeIndex =
      currentEmployeeIndex >= 0
        ? currentEmployeeIndex
        : Math.max(firstAssignedEmployeeIndex, 0);
    setRequestEmployeeIndex(employeeIndex);
    setRequestedDesignations(employees[employeeIndex].projectDesignations);
    setRequestReason("");
    setRequestOpen(true);
  }

  function chooseRequestEmployee(index: number) {
    if (!employees[index]) return;
    setRequestEmployeeIndex(index);
    setRequestedDesignations(employees[index].projectDesignations);
  }

  function toggleRequestedDesignation(designation: string) {
    setRequestedDesignations((current) =>
      current.includes(designation)
        ? current.filter((item) => item !== designation)
        : [...current, designation],
    );
  }

  async function submitDesignationRequest() {
    if (!requestEmployee || !requestReason.trim()) {
      setInviteNotice("Add a short reason before submitting this request.");
      return;
    }
    if (
      JSON.stringify([...requestedDesignations].sort()) ===
      JSON.stringify([...requestEmployee.projectDesignations].sort())
    ) {
      setInviteNotice(
        "Choose at least one designation change before submitting this request.",
      );
      return;
    }
    try {
      await teamAction({ action: "request-designations", employeeEmail: requestEmployee.email, designations: requestedDesignations, reason: requestReason.trim() });
      setRequestOpen(false);
      setRequestReason("");
      setInviteNotice("Designation Change Request Saved Permanently And Routed To Authorized Reviewers. No Access Changed Yet.");
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Designation Request Could Not Be Saved.");
    }
  }

  function openRequestReview(requestId: string) {
    setReviewRequestId(requestId);
    setDecisionNote("");
  }

  async function approveDesignationRequest() {
    if (!reviewRequest) return;
    try {
      await teamAction({ action: "decide-request", requestId: reviewRequest.id, decision: "Approved", decisionNote });
      setReviewRequestId(null);
      setDecisionNote("");
      setInviteNotice(`${reviewRequest.id} Approved. ${reviewRequest.employeeName}’s ${projectName} Designations Are Now Active And Enforced.`);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Approval Could Not Be Saved.");
    }
  }

  async function rejectDesignationRequest() {
    if (!reviewRequest) return;
    if (!decisionNote.trim()) {
      setInviteNotice(
        "Add a short explanation before rejecting this request.",
      );
      return;
    }
    try {
      await teamAction({ action: "decide-request", requestId: reviewRequest.id, decision: "Rejected", decisionNote });
      setReviewRequestId(null);
      setDecisionNote("");
      setInviteNotice(`${reviewRequest.id} Was Rejected With A Permanent Explanation. No Access Changed.`);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Rejection Could Not Be Saved.");
    }
  }

  function openOwnerOverride() {
    if (!employees.length) {
      setInviteNotice("No active employee is available for a role assignment.");
      return;
    }
    const currentOwnerIndex = employees.findIndex(
      (person) =>
        person.accessLevel === "Company Owner" &&
        person.email.toLowerCase() === actor.email.toLowerCase(),
    );
    const firstOwnerIndex = employees.findIndex(
      (person) => person.accessLevel === "Company Owner",
    );
    const employeeIndex = currentOwnerIndex >= 0
      ? currentOwnerIndex
      : Math.max(firstOwnerIndex, 0);
    setOwnerEmployeeIndex(employeeIndex);
    setOwnerDraftDesignations(employees[employeeIndex].projectDesignations);
    setOwnerOverrideReason("");
    setOwnerOverrideOpen(true);
  }

  function chooseOwnerEmployee(index: number) {
    if (!employees[index]) return;
    setOwnerEmployeeIndex(index);
    setOwnerDraftDesignations(employees[index].projectDesignations);
  }

  function toggleOwnerOverrideDesignation(designation: string) {
    setOwnerDraftDesignations((current) =>
      current.includes(designation)
        ? current.filter((item) => item !== designation)
        : [...current, designation],
    );
  }

  async function applyOwnerOverride() {
    if (!ownerEmployee || !ownerOverrideReason.trim()) {
      setInviteNotice(
        "Add a reason before applying the Company Owner override.",
      );
      return;
    }
    if (
      JSON.stringify([...ownerDraftDesignations].sort()) ===
      JSON.stringify([...ownerEmployee.projectDesignations].sort())
    ) {
      setInviteNotice(
        "Choose at least one designation change before applying the override.",
      );
      return;
    }
    try {
      await teamAction({ action: "owner-override", employeeEmail: ownerEmployee.email, designations: ownerDraftDesignations, reason: ownerOverrideReason.trim() });
      setOwnerOverrideOpen(false);
      setOwnerOverrideReason("");
      setInviteNotice(`Company Owner Override Applied To ${ownerEmployee.name}. The Change Is Active, Server-Enforced, And Permanently Audited.`);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Owner Override Could Not Be Saved.");
    }
  }

  async function sendInvite() {
    if (!company.trim() || !email.includes("@")) {
      setInviteNotice(
        "Add the subcontractor company and a valid email address.",
      );
      return;
    }
    try {
      const result = await teamAction({ action: "invite-subcontractor", company: company.trim(), contactEmail: email.trim(), folder });
      setInviteOpen(false);
      setCompany("");
      setEmail("");
      setFolder("Subcontractor Inbox");
      setInviteCredentials(result.url && result.code ? { url: result.url, code: result.code } : null);
      setInviteNotice(`Secure Invitation Created For ${email.trim()}. The One-Time Code Is Shown Once Below.`);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Invitation Could Not Be Created.");
    }
  }

  async function revokeInvite(index: number) {
    const invite = invites[index];
    if (!invite?.id) return;
    try {
      await teamAction({ action: "revoke-invite", inviteId: invite.id });
      setInviteNotice("Guest Access Ended Immediately. The Permanent Access History Was Preserved.");
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : "The Invitation Could Not Be Revoked.");
    }
  }

  return (
    <div className="module-workspace access-workspace">
      <section className="workspace-heading">
        <div>

          <h1>Team &amp; Access</h1>

        </div>
        <button
          className="primary-action large"
          disabled={!permissions.canInvite || saving || loading}
          onClick={() => setInviteOpen(true)}
        >
          ＋ Invite Subcontractor
        </button>
      </section>
      {inviteNotice ? (
        <div className="inline-success">{inviteNotice}</div>
      ) : null}
      {inviteCredentials ? (
        <section className="permission-note" aria-label="One-time subcontractor invitation">
          <strong>One-Time Secure Invitation</strong>
          <span>Path: {inviteCredentials.url} · Code: {inviteCredentials.code}</span>
          <button className="secondary-action" onClick={() => setInviteCredentials(null)}>I Saved This Securely</button>
        </section>
      ) : null}

      <section className="identity-grid">
        <article className="identity-card microsoft-card">
          <div className="identity-icon microsoft-icon">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div>
            <span>EMPLOYEE SIGN-IN</span>
            <h2>Microsoft Work Accounts</h2>

          </div>
          <button
            className="secondary-action"
            onClick={() => setSigninOpen(true)}
          >
            View Connection Requirements
          </button>
        </article>
        <article className="identity-card guest-card">
          <div className="identity-icon">↗</div>
          <div>
            <span>SUBCONTRACTOR ACCESS</span>
            <h2>Invitation only</h2>

          </div>
          <strong className="security-state">
            <i /> PM · Admin · Company Owner Only
          </strong>
        </article>
      </section>
      <section className="authority-definition-grid">
        <article className="authority-card owner-card">
          <div className="authority-card-heading">
            <span>CO</span>
            <div>

              <h2>Company Owner</h2>
            </div>
            <b>Complete Access</b>
          </div>
          <p>
            Complete authority over company financials, legal documents,
            integrations, company settings and signing authority.
          </p>
          <div className="authority-rights">
            <span>✓ Promote Or Remove Administrators</span>
            <span>✓ Permanently Delete Company Records</span>
            <span>✓ Assign Signing Authority</span>
            <span>✓ Control Ownership-Level Settings</span>
            <span>✓ Apply Immediate Role Overrides</span>
          </div>
        </article>
        <article className="authority-card admin-card">
          <div className="authority-card-heading">
            <span>AD</span>
            <div>

              <h2>Administrator</h2>
            </div>
            <b>Day-To-Day Management</b>
          </div>
          <p>
            Manages employees, projects, templates, attorney access,
            subcontract approvals and all project financial information for
            daily company operations.
          </p>
          <div className="authority-rights restricted-rights">
            <span>✓ View All Project Financials</span>
            <span>✓ Assign Employee Project Designations</span>
            <span>✓ Approve Any Pending Designation Request</span>
            <span className="blocked">
              × Cannot Manage Banking Or Ownership Records
            </span>
            <span className="blocked">
              × Cannot Administer Banking Or Native ERP Ownership Controls
            </span>
            <span className="blocked">× Cannot Remove Company Owners</span>
            <span className="blocked">
              × Cannot Change Ownership-Level Settings
            </span>
            <span className="blocked">
              × Cannot Permanently Delete Company Records
            </span>
            <span className="blocked">
              × Cannot Promote Employees To Administrator
            </span>
            <span>✓ Can Approve Subcontract Release</span>
          </div>
        </article>
      </section>
      <section className="role-layer-rule">
        <span>2</span>
        <div>
          <strong>Two Separate Permission Layers</strong>
          <small>
            Each employee has one Company Access Level and may hold multiple
            Project Designations. Company defaults automatically carry into new
            jobs then an Administrator may create a project-specific override.
            A Company Owner may also hold Project Manager Superintendent or
            other job-specific designations without changing owner authority.
            Company Owners alone control promotions to Administrator.
          </small>
        </div>
      </section>
      <section className="access-panel" data-reflow-table="">
        <div className="access-panel-heading">
          <div>
            <h2>Mefford Employees</h2>
            <span>
              {employees.length} Planned Microsoft Accounts · @meffcon.com Only
            </span>
          </div>
          <span className="domain-pill pending">Connection Required</span>
        </div>
        <div className="access-head employee-grid" data-reflow-head="medium">
          <span>Employee</span>
          <span>Company Access Level</span>
          <span>{projectName} Designations</span>
          <span>Access</span>
          <span>Sign-in</span>
          <span>Manage</span>
        </div>
        {employees.map((person, index) => (
          <div className="access-row employee-grid" key={person.name} data-reflow-row="medium">
            <span className="access-person" data-label="Employee">
              <i>
                {person.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </i>
              <span>
                <strong>{person.name}</strong>
                <small>{person.email}</small>
              </span>
            </span>
            <span
              className={`access-level ${person.accessLevel.toLowerCase().replace(" ", "-")}`}
             data-label="Company Access Level">
              {person.accessLevel}
            </span>
            <span className="designation-list" data-label="Designations">
              {person.projectDesignations.length ? (
                person.projectDesignations.map((designation) => (
                  <b key={designation}>{designation}</b>
                ))
              ) : (
                <small>No Project Designation</small>
              )}
              <small>
                {JSON.stringify(person.projectDesignations) ===
                JSON.stringify(person.defaultDesignations)
                  ? "Using Company Default"
                  : `Default: ${person.defaultDesignations.join(" + ") || "None"}`}
              </small>
            </span>
            <span data-label="Access">{person.scope}</span>
            <span className="connected-state" data-label="Sign-in">
              <i /> {person.status}
            </span>
            <span data-label="Manage">
              <button
                className="access-manage"
                disabled={!permissions.canManageDesignations || saving}
                onClick={() => openDesignationEditor(index)}
              >
                Edit Designations
              </button>
            </span>
          </div>
        ))}
      </section>
      <section className="access-panel designation-request-panel" data-reflow-table="">
        <div className="access-panel-heading">
          <div>
            <h2>Designation Change Requests</h2>
            <span>
              {pendingDesignationRequestCount} Awaiting Authorized Review ·
              Changes Stay Inactive Until Approved
            </span>
          </div>
          <button className="primary-action" disabled={!permissions.canRequestDesignations || saving} onClick={openDesignationRequest}>
            ＋ Request A Change
          </button>
        </div>
        <div className="access-head request-grid" data-reflow-head="wide">
          <span>Request</span>
          <span>Employee</span>
          <span>Current Roles</span>
          <span>Requested Roles</span>
          <span>Requested By</span>
          <span>Status</span>
          <span>Review</span>
        </div>
        {designationRequests.map((request) => (
          <div className="access-row request-grid" key={request.id} data-reflow-row="wide">
            <span className="request-summary" data-label="Request">
              <strong>{request.id}</strong>
              <small>{request.submitted}</small>
            </span>
            <span className="request-summary" data-label="Employee">
              <strong>{request.employeeName}</strong>
              <small>{request.project}</small>
            </span>
            <span className="designation-list compact-designations" data-label="Current Roles">
              {request.currentDesignations.map((designation) => (
                <b key={designation}>{designation}</b>
              ))}
            </span>
            <span className="designation-list compact-designations requested-designations" data-label="Requested Roles">
              {request.requestedDesignations.map((designation) => (
                <b key={designation}>{designation}</b>
              ))}
            </span>
            <span className="request-summary" data-label="Requested By">
              <strong>{request.requestedBy}</strong>
              <small>Project Manager</small>
            </span>
            <span data-label="Status">
              <b
                className={`invite-status ${request.status.toLowerCase()}`}
              >
                {request.status}
              </b>
            </span>
            <span data-label="Review">
              <button
                className="access-manage"
                disabled={request.status === "Pending" && !permissions.canManageDesignations}
                onClick={() => openRequestReview(request.id)}
              >
                {request.status === "Pending"
                  ? "Review Request"
                  : "View Decision"}
              </button>
            </span>
          </div>
        ))}

      </section>
      <section className="notification-owner-grid">
        <article className="access-control-card notification-control-card">
          <div className="access-control-heading">
            <span>AL</span>
            <div>

              <h2>Immediate Request Notifications</h2>
            </div>
            <b>In-App Active</b>
          </div>
          <p>
            Every Pending Designation Request Alerts All Administrators And
            Company Owners As Soon As It Is Submitted.
          </p>
          <div className="notification-channel-list">
            <span>
              <i>●</i>
              <strong>Command Center</strong>
              <small>Immediate In-App Alert</small>
            </span>
            <span>
              <i>✉</i>
              <strong>Microsoft Email</strong>
              <small>Begins After Entra Connection</small>
            </span>
          </div>
        </article>
        <article className="access-control-card owner-override-control-card">
          <div className="access-control-heading">
            <span>CO</span>
            <div>

              <h2>Immediate Designation Override</h2>
            </div>
            <b>Owner Only</b>
          </div>
          <p>
            A Company Owner may make an immediate project designation change
            without a separate approval. The reason and before-and-after roles
            remain in the permanent audit history.
          </p>
          <button className="primary-action" disabled={!permissions.canOwnerOverride || saving} onClick={openOwnerOverride}>
            ＋ Owner Immediate Override
          </button>
        </article>
      </section>
      <section className="access-panel designation-audit-panel" data-reflow-table="">
        <div className="access-panel-heading">
          <div>
            <h2>Permanent Designation Audit History</h2>

          </div>
          <span className="audit-lock-pill">Locked History</span>
        </div>
        <div className="access-head audit-grid" data-reflow-head="wide">
          <span>Record</span>
          <span>Employee</span>
          <span>Role Change</span>
          <span>Requested By</span>
          <span>Reviewed By</span>
          <span>Status / Time</span>
          <span>Explanation</span>
        </div>
        {ownerOverrides.map((override) => (
          <div className="access-row audit-grid" key={override.id} data-reflow-row="wide">
            <span className="request-summary" data-label="Record">
              <strong>{override.id}</strong>
              <small>{override.action}</small>
            </span>
            <span className="request-summary" data-label="Employee">
              <strong>{override.employeeName}</strong>
              <small>{override.project}</small>
            </span>
            <span className="audit-role-change" data-label="Role Change">
              <small>{override.previousDesignations.join(" + ") || "None"}</small>
              <i>→</i>
              <strong>{override.nextDesignations.join(" + ") || "None"}</strong>
            </span>
            <span data-label="Requested By">{override.requestedBy}</span>
            <span data-label="Reviewed By">{override.reviewedBy}</span>
            <span className="request-summary" data-label="Status / Time">
              <b className="invite-status approved">Active</b>
              <small>{override.occurredAt}</small>
            </span>
            <span className="audit-note" data-label="Explanation">{override.note}</span>
          </div>
        ))}
        {designationRequests.map((request) => (
          <div className="access-row audit-grid" key={`audit-${request.id}`} data-reflow-row="wide">
            <span className="request-summary" data-label="Record">
              <strong>{request.id}</strong>
              <small>PM Request</small>
            </span>
            <span className="request-summary" data-label="Employee">
              <strong>{request.employeeName}</strong>
              <small>{request.project}</small>
            </span>
            <span className="audit-role-change" data-label="Role Change">
              <small>{request.currentDesignations.join(" + ") || "None"}</small>
              <i>→</i>
              <strong>{request.requestedDesignations.join(" + ") || "None"}</strong>
            </span>
            <span data-label="Requested By">{request.requestedBy}</span>
            <span data-label="Reviewed By">{request.reviewedBy || "Awaiting Authorized Reviewer"}</span>
            <span className="request-summary" data-label="Status / Time">
              <b
                className={`invite-status ${request.status.toLowerCase()}`}
              >
                {request.status}
              </b>
              <small>{request.reviewedAt || request.submitted}</small>
            </span>
            <span className="audit-note" data-label="Explanation">
              {request.decisionNote || request.reason}
            </span>
          </div>
        ))}

      </section>
      <section className="access-panel" data-reflow-table="">
        <div className="access-panel-heading">
          <div>
            <h2>Subcontractor Invitations</h2>

          </div>
          <button
            className="secondary-action"
            disabled={!permissions.canInvite || saving}
            onClick={() => setInviteOpen(true)}
          >
            New invitation
          </button>
        </div>
        <div className="access-head guest-grid" data-reflow-head="medium">
          <span>Company / guest</span>
          <span>Project</span>
          <span>Assigned area</span>
          <span>Expires</span>
          <span>Status</span>
          <span>Manage</span>
        </div>
        {invites.map((invite, index) => (
          <div
            className="access-row guest-grid"
            key={`${invite.email}-${index}`}
           data-reflow-row="medium">
            <span className="access-person" data-label="Company / guest">
              <i className="guest-avatar">
                {invite.company.slice(0, 2).toUpperCase()}
              </i>
              <span>
                <strong>{invite.company}</strong>
                <small>{invite.email}</small>
              </span>
            </span>
            <span data-label="Project">{invite.project}</span>
            <span data-label="Assigned area">{invite.folder}</span>
            <span data-label="Expires">{invite.expires}</span>
            <span data-label="Status">
              <b className={`invite-status ${invite.status.toLowerCase()}`}>
                {invite.status}
              </b>
            </span>
            <span data-label="Manage">
              {["Accepted", "Active", "Pending", "Invitation Pending", "Compliance Blocked"].includes(invite.status) ? (
                <button
                  className="access-manage"
                  disabled={saving || !permissions.canInvite}
                  onClick={() => void revokeInvite(index)}
                >
                  {invite.status.includes("Pending") ? "Cancel" : "Revoke"}
                </button>
              ) : (
                "—"
              )}
            </span>
          </div>
        ))}
      </section>

      {editingEmployee ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            setEditingEmployeeIndex(null)
          }
        >
          <section
            className="record-modal designation-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="designation-editor-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="designation-editor-title">
                  Manage Project Designations
                </h2>
              </div>
              <button
                aria-label="Close designation editor"
                onClick={() => setEditingEmployeeIndex(null)}
              >
                ×
              </button>
            </div>
            <section className="employee-edit-summary">
              <span className="access-person">
                <i>
                  {editingEmployee.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </i>
                <span>
                  <strong>{editingEmployee.name}</strong>
                  <small>{editingEmployee.email}</small>
                </span>
              </span>
              <span className="company-access-lock">
                <small>Company Access Level</small>
                <strong>{editingEmployee.accessLevel}</strong>
                <b>Locked For Administrators</b>
              </span>
            </section>
            <section
              className="designation-scope-tabs"
              aria-label="Designation Assignment Scope"
            >
              <button
                className={designationScope === "project" ? "active" : ""}
                onClick={() => chooseDesignationScope("project")}
              >
                <strong>{projectName} Override</strong>
                <small>Applies Only To This Project</small>
              </button>
              <button
                className={designationScope === "default" ? "active" : ""}
                onClick={() => chooseDesignationScope("default")}
              >
                <strong>Company Default</strong>
                <small>Auto-Fills New Project Assignments</small>
              </button>
            </section>
            <div className="designation-scope-message">
              <span>{designationScope === "project" ? "DP" : "DF"}</span>
              <div>
                <strong>
                  {designationScope === "project"
                    ? `Editing ${projectName} Only`
                    : "Editing The Company Default"}
                </strong>
                <small>
                  {designationScope === "project"
                    ? `These Selections Override The Employee’s Default Designations On ${projectName} Without Changing Any Other Project.`
                    : "These designations will be suggested automatically when this employee is added to a new project."}
                </small>
              </div>
              {designationScope === "project" ? (
                <button
                  className="secondary-action"
                  onClick={() =>
                    setDraftDesignations(editingEmployee.defaultDesignations)
                  }
                >
                  Use Company Default
                </button>
              ) : null}
            </div>
            <div className="designation-choice-heading">
              <strong>
                {designationScope === "project"
                  ? `${projectName} Designations`
                  : "Default Designations"}
              </strong>
              <span>Select All That Apply</span>
            </div>
            <div className="designation-choice-grid">
              {designationOptions.map((designation) => (
                <label key={designation}>
                  <input
                    type="checkbox"
                    checked={draftDesignations.includes(designation)}
                    onChange={() => toggleDesignation(designation)}
                  />
                  <span>{designation}</span>
                </label>
              ))}
            </div>

            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setEditingEmployeeIndex(null)}
              >
                Cancel
              </button>
              <button
                className="primary-action large"
                disabled={saving}
                onClick={() => void saveDesignations()}
              >
                {designationScope === "project"
                  ? "Save Project Override"
                  : "Save Company Default"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {requestOpen && requestEmployee ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setRequestOpen(false)
          }
        >
          <section
            className="record-modal designation-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="designation-request-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">{projectName} ACCESS</p>
                <h2 id="designation-request-title">
                  Request A Designation Change
                </h2>
              </div>
              <button
                aria-label="Close designation request"
                onClick={() => setRequestOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="requester-rule-card">
              <span>PM</span>
              <div>
                <strong>Project Manager Request</strong>
                <small>
                  A Project Manager May Request A Change For Employees Already
                  Assigned To {projectName}. Current Access Remains Active Until An
                  Administrator Or Company Owner Approves The Request.
                </small>
              </div>
            </div>
            <label className="field-label">
              Employee Already Assigned To {projectName}
              <select
                value={requestEmployeeIndex}
                onChange={(event) =>
                  chooseRequestEmployee(Number(event.target.value))
                }
              >
                {employees.map((person, index) =>
                  index > 0 ? (
                    <option value={index} key={person.name}>
                      {person.name}
                    </option>
                  ) : null,
                )}
              </select>
            </label>
            <div className="current-role-strip">
              <span>Current {projectName} Roles</span>
              <div className="designation-list compact-designations">
                {requestEmployee.projectDesignations.map((designation) => (
                  <b key={designation}>{designation}</b>
                ))}
              </div>
            </div>
            <div className="designation-choice-heading">
              <strong>Requested {projectName} Designations</strong>
              <span>Select All That Apply</span>
            </div>
            <div className="designation-choice-grid">
              {PROJECT_DESIGNATIONS.map((designation) => (
                <label key={designation}>
                  <input
                    type="checkbox"
                    checked={requestedDesignations.includes(designation)}
                    onChange={() =>
                      toggleRequestedDesignation(designation)
                    }
                  />
                  <span>{designation}</span>
                </label>
              ))}
            </div>
            <label className="field-label request-reason-field">
              Reason For The Change
              <textarea
                value={requestReason}
                onChange={(event) => setRequestReason(event.target.value)}
                placeholder={`Explain Why This Employee Needs The Requested Role On ${projectName}.`}
                rows={3}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setRequestOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-action large"
                disabled={saving}
                onClick={() => void submitDesignationRequest()}
              >
                Submit For Approval
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {reviewRequest ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setReviewRequestId(null)
          }
        >
          <section
            className="record-modal designation-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="designation-review-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">
                  {reviewRequest.id} · {reviewRequest.project}
                </p>
                <h2 id="designation-review-title">
                  Review Designation Change Request
                </h2>
              </div>
              <button
                aria-label="Close designation review"
                onClick={() => setReviewRequestId(null)}
              >
                ×
              </button>
            </div>
            <section className="request-review-summary">
              <div>
                <small>Employee</small>
                <strong>{reviewRequest.employeeName}</strong>
              </div>
              <div>
                <small>Requested By</small>
                <strong>{reviewRequest.requestedBy} · Project Manager</strong>
              </div>
              <div>
                <small>Status</small>
                <b
                  className={`invite-status ${reviewRequest.status.toLowerCase()}`}
                >
                  {reviewRequest.status}
                </b>
              </div>
            </section>
            <section className="designation-comparison">
              <article>
                <span>Current {projectName} Roles</span>
                <div className="designation-list compact-designations">
                  {reviewRequest.currentDesignations.map((designation) => (
                    <b key={designation}>{designation}</b>
                  ))}
                </div>
              </article>
              <span className="comparison-arrow">→</span>
              <article className="requested-role-card">
                <span>Requested {projectName} Roles</span>
                <div className="designation-list compact-designations requested-designations">
                  {reviewRequest.requestedDesignations.map((designation) => (
                    <b key={designation}>{designation}</b>
                  ))}
                </div>
              </article>
            </section>
            <div className="request-reason-card">
              <span>Request Reason</span>
              <p>{reviewRequest.reason}</p>
            </div>
            {reviewRequest.status === "Pending" ? (
              <label className="field-label request-reason-field">
                Authorized Reviewer Decision Note
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  placeholder="Required when rejecting. Optional when approving."
                  rows={3}
                />
              </label>
            ) : (
              <div className="decision-result-card">
                <span>Authorized Reviewer Decision</span>
                <p>{reviewRequest.decisionNote}</p>
                <small>
                  {reviewRequest.reviewedBy} · {reviewRequest.reviewedAt}
                </small>
              </div>
            )}
            <div className="modal-actions">
              {reviewRequest.status === "Pending" ? (
                <>
                  <button
                    className="danger-action"
                    disabled={saving}
                    onClick={() => void rejectDesignationRequest()}
                  >
                    Reject With Explanation
                  </button>
                  <button
                    className="primary-action large"
                    disabled={saving}
                    onClick={() => void approveDesignationRequest()}
                  >
                    Approve And Activate Roles
                  </button>
                </>
              ) : (
                <button
                  className="primary-action large"
                  onClick={() => setReviewRequestId(null)}
                >
                  Close Decision
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {ownerOverrideOpen && ownerEmployee ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setOwnerOverrideOpen(false)
          }
        >
          <section
            className="record-modal designation-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-override-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="owner-override-title">
                  Apply An Immediate Designation Override
                </h2>
              </div>
              <button
                aria-label="Close owner override"
                onClick={() => setOwnerOverrideOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="requester-rule-card owner-rule-card">
              <span>CO</span>
              <div>
                <strong>{actor.name} · Company Owner</strong>
                <small>
                  This change becomes active immediately without a second
                  approval. The reason and complete before-and-after record are
                  permanently saved.
                </small>
              </div>
            </div>
            <label className="field-label">
              Employee Assigned To {projectName}
              <select
                value={ownerEmployeeIndex}
                onChange={(event) =>
                  chooseOwnerEmployee(Number(event.target.value))
                }
              >
                {employees.map((person, index) =>
                  person.accessLevel !== "Company Owner" &&
                  person.projectDesignations.length > 0 ? (
                    <option value={index} key={person.name}>
                      {person.name}
                    </option>
                  ) : null,
                )}
              </select>
            </label>
            <div className="current-role-strip">
              <span>Current {projectName} Roles</span>
              <div className="designation-list compact-designations">
                {ownerEmployee.projectDesignations.map((designation) => (
                  <b key={designation}>{designation}</b>
                ))}
              </div>
            </div>
            <div className="designation-choice-heading">
              <strong>Override {projectName} Designations</strong>
              <span>Select All That Apply</span>
            </div>
            <div className="designation-choice-grid">
              {PROJECT_DESIGNATIONS.map((designation) => (
                <label key={designation}>
                  <input
                    type="checkbox"
                    checked={ownerDraftDesignations.includes(designation)}
                    onChange={() =>
                      toggleOwnerOverrideDesignation(designation)
                    }
                  />
                  <span>{designation}</span>
                </label>
              ))}
            </div>
            <label className="field-label request-reason-field">
              Required Override Reason
              <textarea
                value={ownerOverrideReason}
                onChange={(event) => setOwnerOverrideReason(event.target.value)}
                placeholder="Explain why this immediate role change is required."
                rows={3}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setOwnerOverrideOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-action large"
                disabled={saving}
                onClick={() => void applyOwnerOverride()}
              >
                Apply Immediate Override
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {inviteOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setInviteOpen(false)
          }
        >
          <section
            className="record-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">{projectName} ACCESS</p>
                <h2 id="invite-title">Invite A Subcontractor</h2>
              </div>
              <button
                aria-label="Close invitation"
                onClick={() => setInviteOpen(false)}
              >
                ×
              </button>
            </div>
            <label className="field-label">
              Company
              <input
                autoFocus
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Example: Bluegrass Electric"
              />
            </label>
            <label className="field-label">
              Guest email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@subcontractor.com"
              />
            </label>
            <div className="field-grid">
              <label className="field-label">
                Project
                <select>
                  <option>{projectName}</option>
                </select>
              </label>
              <label className="field-label">
                Assigned area
                <select
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                >
                  <option>Subcontractor Inbox</option>
                  <option>Electrical uploads</option>
                  <option>Plumbing uploads</option>
                  <option>Concrete uploads</option>
                  <option>RFI responses only</option>
                  <option>Submittals only</option>
                </select>
              </label>
            </div>
            <div className="guest-folder-rights">
              <span>✓ View assigned files</span>
              <span>✓ Download shared files</span>
              <span>✓ Upload new files and revisions</span>
              <span className="blocked">× Delete files</span>
            </div>

            {inviteNotice ? (
              <div className="form-error">{inviteNotice}</div>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-action"
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </button>
              <button className="primary-action large" disabled={saving} onClick={() => void sendInvite()}>
                {saving ? "Creating Secure Invitation…" : "Create Secure Invitation"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {signinOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSigninOpen(false)
          }
        >
          <section
            className="signin-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
          >
            <Mark />

            <h2 id="signin-title">Microsoft Connection Required</h2>

            <button disabled>
              <span className="mini-microsoft">
                <i />
                <i />
                <i />
                <i />
              </span>
              Microsoft Entra Connection Required
            </button>

            <button
              className="signin-close"
              onClick={() => setSigninOpen(false)}
            >
              Back to Command Center
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
