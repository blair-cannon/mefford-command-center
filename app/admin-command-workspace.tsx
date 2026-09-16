"use client";

import { EmployeeResourceHub } from "./employee-resource-hub";
import { EmployeeManagerQueue, ProposalProfileApprovalQueue } from "./employee-lifecycle-center";
import { ReviewWorkspace } from "./review-workspace";
import { MicrosoftAccessControlCenter } from "./microsoft-access-center";
import { DeletionRecoveryCenter } from "./deletion-recovery-center";
import { DashboardDisplayAccessControl } from "./dashboard-display-access-control";

export type AdminMode = "command" | "goals" | "people" | "requests" | "templates" | "access" | "operations";

type AdminActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type AdminCommandProps = {
  mode: AdminMode;
  actor: AdminActor;
  project: { number: string; name: string };
  onNavigate: (target: string) => void;
};

const adminSections: Array<{ mode: AdminMode; target: string; label: string; icon: string }> = [
  { mode: "command", target: "Admin Command", label: "Admin Command", icon: "A" },
  { mode: "goals", target: "Admin Goals", label: "Goal Setting", icon: "01" },
  { mode: "people", target: "Admin People", label: "HR & Benefits", icon: "02" },
  { mode: "requests", target: "Admin Requests", label: "Employee Requests", icon: "03" },
  { mode: "templates", target: "Admin Templates", label: "Template Review", icon: "04" },
  { mode: "access", target: "Admin Access", label: "Team & Access", icon: "05" },
  { mode: "operations", target: "Admin Operations", label: "Company Operations", icon: "06" },
];

const responsibilities = [
  {
    number: "01",
    title: "Set Direction",
    summary: "Turn company priorities into department and employee goals, then keep the quarterly review cycle moving.",
    owned: "Goal cadence, due dates, evidence readiness, review preparation",
    retained: "Owner final goals, calibration, compensation and finalized performance decisions",
    target: "Admin Goals",
    action: "Open Goal Setting",
  },
  {
    number: "02",
    title: "Manage The Employee Lifecycle",
    summary: "Take an employee from approved hire through onboarding, benefits access, annual renewals, support and offboarding.",
    owned: "Employee record, login-issued gate, onboarding readiness, benefit resources, lifecycle dates and offboarding coordination",
    retained: "Microsoft account issuance, onboarding verification and Company Owner access approval remain separate gates",
    target: "Admin People",
    action: "Open HR & Benefits",
  },
  {
    number: "03",
    title: "Serve Employees",
    summary: "Give every request one front door, route it by live role and keep the answer attached to the request.",
    owned: "Queue visibility, service timing, follow-up, escalation and closure evidence",
    retained: "The assigned role decides routine work; only a Company Owner can grant, restore, suspend or revoke employee access",
    target: "Admin Requests",
    action: "Open Employee Requests",
  },
  {
    number: "04",
    title: "Govern Company Information",
    summary: "Keep every legal, HR, benefits, safety, accounting and operating template current and reviewed.",
    owned: "Version intake, reviewer routing, renewal calendar, publication readiness and history",
    retained: "Assigned professional review and annual Owner signoff cannot be bypassed",
    target: "Admin Templates",
    action: "Open Template Review",
  },
  {
    number: "05",
    title: "Control Access & Company Systems",
    summary: "Maintain role assignments, company calendar, assets, integrations and day-to-day administrative readiness.",
    owned: "Employee roles, project access, operational calendars, asset readiness and issue follow-through",
    retained: "Ownership settings, banking, Administrator promotion and protected integrations remain Owner-controlled",
    target: "Admin Access",
    action: "Open Team & Access",
  },
];

export function AdminCommandWorkspace({ mode, actor, project, onNavigate }: AdminCommandProps) {
  const owner = actor.accessLevel === "Company Owner";
  return <div className="admin-command-workspace">
    <AdminHeader mode={mode} actor={actor} onNavigate={onNavigate} />
    {mode === "command" ? <AdminCommandHome owner={owner} onNavigate={onNavigate} /> : null}
    {mode === "goals" ? <AdminGoals owner={owner} onNavigate={onNavigate} /> : null}
    {mode === "people" ? <AdminPeople onNavigate={onNavigate} /> : null}
    {mode === "requests" ? <AdminRequests /> : null}
    {mode === "templates" ? <ReviewWorkspace actor={actor} /> : null}
    {mode === "access" ? <AdminAccess project={project} owner={owner} onNavigate={onNavigate} /> : null}
    {mode === "operations" ? <AdminOperations owner={owner} onNavigate={onNavigate} /> : null}
  </div>;
}

function AdminHeader({ mode, onNavigate }: { mode: AdminMode; actor: AdminActor; onNavigate: (target: string) => void }) {
  const active = adminSections.find((section) => section.mode === mode) || adminSections[0];
  return <>
    <section className="admin-command-hero">
      <div><h1>{active.label}</h1></div>

    </section>
    <nav className="admin-command-tabs" aria-label="Administration sections">{adminSections.map((section) => <button key={section.mode} className={mode === section.mode ? "active" : ""} onClick={() => onNavigate(section.target)}><i>{section.icon}</i><span>{section.label}</span></button>)}</nav>
  </>;
}

function AdminCommandHome({ onNavigate }: { owner: boolean; onNavigate: (target: string) => void }) {
  return <>
    <section className="admin-today-bar"><div><small>ADMINISTRATIVE WORK QUEUE</small><strong>Current Company Actions</strong></div><button onClick={() => onNavigate("Admin Requests")}>Open Employee Queue →</button></section>
    <section className="admin-responsibility-flow" aria-label="Administration responsibility flow">{responsibilities.map((item) => <article key={item.number}><div className="admin-responsibility-copy"><h2>{item.title}</h2></div><button onClick={() => onNavigate(item.target)}>{item.action} →</button></article>)}</section>

  </>;
}

function AdminGoals({ owner, onNavigate }: { owner: boolean; onNavigate: (target: string) => void }) {
  return <>
    <section className="admin-section-intro"><div><h2>Company → Department → Employee</h2></div><b>{owner ? "OWNER FINAL AUTHORITY" : "OWNER FINAL APPROVAL"}</b></section>
    <section className="admin-goal-cascade"><article><i>1</i><small>COMPANY</small><h3>Quarterly Rocks &amp; Priorities</h3><button onClick={() => onNavigate("Quarterly Rock/Review")}>Open Quarterly Rock / Review</button></article><article><i>2</i><small>DEPARTMENT</small><h3>Sales &amp; Operating Scorecards</h3><button disabled={!owner} onClick={() => onNavigate("Sales Goals")}>{owner ? "Open Sales Goals" : "Owner Access Required"}</button></article><article><i>3</i><small>EMPLOYEE</small><h3>Quarterly Goals &amp; Reviews</h3><button disabled={!owner} onClick={() => onNavigate("Performance Reviews")}>{owner ? "Open Performance Reviews" : "Owner Access Required"}</button></article></section>

  </>;
}

function AdminPeople({ onNavigate }: { onNavigate: (target: string) => void }) {
  return <>
    <section className="admin-section-intro"><div><h2>Employee Lifecycle Administration</h2></div><button onClick={() => onNavigate("Employee Onboarding")}>Open Employee Onboarding Admin →</button></section>

    <div className="admin-people-actions"><button onClick={() => onNavigate("Employee Onboarding")}><strong>Employee Records &amp; Onboarding</strong><span>Create records, record login issuance, review readiness, activate or offboard.</span></button><button onClick={() => onNavigate("Admin Requests")}><strong>HR, Benefits &amp; Leave Requests</strong><span>Open the live employee queue routed by current company roles.</span></button><button onClick={() => onNavigate("Admin Templates")}><strong>Benefits &amp; HR Documents</strong><span>Upload new versions, route review and publish only after approval.</span></button></div>
    <EmployeeResourceHub management />
  </>;
}

function AdminRequests() {
  return <>
    <section className="admin-section-intro"><div><h2>Employee Request Routing</h2></div></section>

    <EmployeeManagerQueue />
    <ProposalProfileApprovalQueue />
  </>;
}

function AdminAccess({ project, owner, onNavigate }: { project: { number: string; name: string }; owner: boolean; onNavigate: (target: string) => void }) {
  return <>
    <section className="admin-section-intro"><div><h2>Employee Access & Roles</h2></div><b>{owner ? "OWNER OVERRIDE AVAILABLE" : "OWNER PROTECTED CONTROLS"}</b></section>
    <MicrosoftAccessControlCenter />
    {owner ? <DashboardDisplayAccessControl /> : null}
    <section className="admin-access-grid"><article><i>CO</i><h3>Company Login &amp; Lifecycle</h3><button onClick={() => onNavigate("Employee Onboarding")}>Open Employee Access</button></article><article><i>RL</i><h3>Live Company Roles</h3><button disabled={!project.number} onClick={() => onNavigate("Team")}>{project.number ? `Open ${project.name} Team` : "Select A Project For Team Roles"}</button></article><article><i>IT</i><h3>Identity &amp; Integrations</h3><button onClick={() => onNavigate("IT & Integrations")}>Open IT &amp; Integrations</button></article></section>

  </>;
}

function AdminOperations({ owner, onNavigate }: { owner: boolean; onNavigate: (target: string) => void }) {
  const operations = [
    ["CAL", "Company Calendar", "People dates, estimating due dates, project milestones and company meetings.", "Company Calendar"],
    ["AF", "Assets & Fleet", "Custody, maintenance, inspections, documents, readiness and accounting treatment.", "Assets & Fleet"],
    ["IT", "IT & Integrations", "Connections, uptime, incidents, recovery, service ownership and issue performance.", "IT & Integrations"],
    ["ON", "Employee Onboarding", "Hire dates, birthdays, anniversaries, renewals, access gates and offboarding.", "Employee Onboarding"],
  ];
  return <>
    <section className="admin-section-intro"><div><h2>Company Operations</h2></div></section>
    <section className="admin-operations-grid">{operations.map(([icon, title, detail, target]) => <button key={target} onClick={() => onNavigate(target)}><i>{icon}</i><span><strong>{title}</strong><p>{detail}</p></span><b>OPEN →</b></button>)}</section>

    {owner ? <DeletionRecoveryCenter /> : null}
  </>;
}
