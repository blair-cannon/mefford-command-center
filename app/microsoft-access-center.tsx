"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_COMPANY_DESIGNATIONS } from "../lib/team-access";
import { summaryDrilldownProps } from "./summary-drilldown";

type DirectoryUser = {
  providerSubject: string;
  displayName: string;
  email: string;
  userPrincipalName: string;
  jobTitle: string;
  department: string;
  userType: string;
  accountEnabled: boolean;
  directoryPresent: boolean;
  lastSeenAt: string;
  accessStatus: string;
  accessLevel: string;
  designations: string[];
  projectScopes: string[];
  onboardingComplete: boolean;
  onboardingStatus: string;
  existingCommandCenterMember: boolean;
  commandCenterMemberActive: boolean;
  candidate: boolean;
  ownerApprovedBy: string;
  ownerApprovedAt: string;
  decisionReason: string;
};

type AccessAudit = {
  id: string;
  email: string;
  action: string;
  priorStatus: string;
  nextStatus: string;
  actorName: string;
  actorEmail: string;
  actorType: string;
  reason: string;
  createdAt: string;
};

type AccessSnapshot = {
  connection: {
    configured: boolean;
    enforced: boolean;
    entra: { configured: boolean; required: boolean; redirectUri: string; authorizationFlow: string; delegatedScopes: string[]; missing: string[] };
    requiredPermissions: string[];
    requiredSettings: string[];
    directoryCadence: string;
    authorizationRule: string;
  };
  actor: { canManage: boolean; canSync: boolean; role: string };
  summary: {
    directoryAccounts: number;
    employeeCandidates: number;
    noAccess: number;
    onboarding: number;
    active: number;
    suspended: number;
    disabled: number;
  };
  users: DirectoryUser[];
  pendingDirectoryLinks: Array<{
    displayName: string;
    email: string;
    accessLevel: string;
    designations: string[];
    active: boolean;
    identityProvider: string;
    status: string;
  }>;
  latestSync: {
    status: string;
    source_count: number;
    imported_count: number;
    disabled_count: number;
    missing_count: number;
    completed_at: string;
    error_message: string;
  } | null;
  audits: AccessAudit[];
  identityTransition: {
    canonicalIdentity: string;
    temporaryAuthenticationAlias: string;
    bridgeEnabled: boolean;
    authenticationEmail: string;
    canonicalAuthenticationProven: boolean;
    microsoftReady: boolean;
    jordanReady: boolean;
    canDisable: boolean;
    blockedReason: string;
  };
};

const EMPTY: AccessSnapshot = {
  connection: { configured: false, enforced: false, entra: { configured: false, required: false, redirectUri: "https://mefford-project-command.jordan-mefor-1272.chatgpt.site/api/microsoft-auth/callback", authorizationFlow: "Single-Tenant Authorization Code + PKCE", delegatedScopes: ["openid", "profile", "email", "User.Read"], missing: [] }, requiredPermissions: ["User.Read.All"], requiredSettings: [], directoryCadence: "Hourly And On Demand", authorizationRule: "Microsoft Account Discovery Never Grants Command Center Access" },
  actor: { canManage: false, canSync: false, role: "Read Only" },
  summary: { directoryAccounts: 0, employeeCandidates: 0, noAccess: 0, onboarding: 0, active: 0, suspended: 0, disabled: 0 },
  users: [],
  pendingDirectoryLinks: [],
  latestSync: null,
  audits: [],
  identityTransition: { canonicalIdentity: "jmefford@meffcon.com", temporaryAuthenticationAlias: "djmeff22@gmail.com", bridgeEnabled: true, authenticationEmail: "", canonicalAuthenticationProven: false, microsoftReady: false, jordanReady: false, canDisable: false, blockedReason: "Canonical Microsoft authentication has not been verified." },
};

const ACCESS_DESIGNATIONS = ALL_COMPANY_DESIGNATIONS;

export function MicrosoftAccessControlCenter() {
  const [data, setData] = useState<AccessSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Employee Accounts");
  const [tab, setTab] = useState<"Directory" | "Audit">("Directory");
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const [accessLevel, setAccessLevel] = useState("Employee");
  const [designations, setDesignations] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [bridgeConfirmation, setBridgeConfirmation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/microsoft-access", { cache: "no-store" });
      const result = await response.json() as AccessSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error || "Microsoft Access Control Is Unavailable.");
      setData(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Microsoft Access Control Is Unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.users.filter((user) => {
      const matchesSearch = !term || [user.displayName, user.email, user.jobTitle, user.department].some((value) => value.toLowerCase().includes(term));
      const matchesFilter = filter === "All Directory Accounts"
        || filter === "Employee Accounts" && user.candidate
        || filter === "No Command Center Access" && user.accessStatus === "No Access"
        || filter === "Onboarding" && user.accessStatus === "Onboarding Access"
        || filter === "Active" && user.accessStatus === "Active"
        || filter === "Suspended / Revoked" && ["Suspended", "Revoked"].includes(user.accessStatus)
        || filter === "Disabled Microsoft Accounts" && user.accessStatus === "Microsoft Account Disabled";
      return matchesSearch && matchesFilter;
    });
  }, [data.users, filter, search]);

  async function submit(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/microsoft-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string; detail?: string; notice?: string };
      if (!response.ok) throw new Error(result.detail || result.error || "The Microsoft Access Action Could Not Be Completed.");
      setNotice(result.notice || "The Microsoft access record was updated.");
      setSelected(null);
      setReason("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Microsoft Access Action Could Not Be Completed.");
    } finally {
      setSaving(false);
    }
  }

  function openUser(user: DirectoryUser) {
    setSelected(user);
    setAccessLevel(user.accessLevel === "Administrator" ? "Administrator" : "Employee");
    setDesignations(user.designations || []);
    setReason("");
    setError("");
    setNotice("");
  }

  function toggleDesignation(item: string) {
    setDesignations((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  }

  const connectionReady = data.connection.configured && data.connection.entra.configured;
  const connectionLabel = !connectionReady
    ? "Prepared — Waiting For Microsoft Connection"
    : data.connection.enforced
      ? "Connected — Access Enforcement Active"
      : "Connected — Enforcement Held For Verification";
  const userDrilldownRows = (users: DirectoryUser[]) => users.map((user) => ({
    id: user.providerSubject,
    title: user.displayName,
    subtitle: `${user.email} · ${[user.jobTitle, user.department].filter(Boolean).join(" · ") || user.userType}`,
    status: user.accessStatus,
    meta: user.accountEnabled && user.directoryPresent ? "Microsoft Enabled" : "Microsoft Disabled Or Missing",
    onOpen: data.actor.canManage && user.candidate ? () => openUser(user) : undefined,
    openLabel: "Manage Access →",
  }));

  return <section className="microsoft-access-center">
    <header className="microsoft-access-hero">
      <div><h2>Employee Access</h2></div>
      <aside className={data.connection.enforced ? "enforced" : connectionReady ? "connected" : "prepared"}><small>CONTROL STATUS</small><strong>{connectionLabel}</strong><span>{data.connection.directoryCadence}</span></aside>
    </header>

    <section className="microsoft-identity-cutover">
      <div><h3>{data.identityTransition.bridgeEnabled ? "Temporary ChatGPT Login Bridge Remains Active" : "Canonical Microsoft Identity Only"}</h3><span><b>{data.identityTransition.canonicalIdentity}</b> is Jordan&apos;s only company identity, sender, permission record, work queue, and audit identity. <b>{data.identityTransition.temporaryAuthenticationAlias}</b> is only a temporary Sites/ChatGPT authentication bridge.</span><small>Current authentication: {data.identityTransition.authenticationEmail || "Not verified"}</small></div>
      {data.identityTransition.bridgeEnabled ? <aside><label>Final Cutover Confirmation<input value={bridgeConfirmation} onChange={(event) => setBridgeConfirmation(event.target.value)} placeholder="DISABLE DJMEFF22 GMAIL BRIDGE" /></label><button className="danger" disabled={saving || !data.identityTransition.canDisable || bridgeConfirmation !== "DISABLE DJMEFF22 GMAIL BRIDGE"} onClick={() => void submit({ action: "disable-temporary-jordan-login", confirmation: bridgeConfirmation })}>Disable Temporary Gmail Bridge</button><small>{data.identityTransition.canDisable ? "All canonical identity and Microsoft enforcement proofs passed." : data.identityTransition.blockedReason}</small></aside> : <aside><strong>Bridge Disabled</strong><small>Jordan must sign in as jmefford@meffcon.com.</small></aside>}
    </section>

    <section className="microsoft-access-summary">
      <article {...summaryDrilldownProps({ title: "Microsoft Directory Accounts", rows: userDrilldownRows(data.users) })}><small>DIRECTORY ACCOUNTS</small><strong>{data.summary.directoryAccounts}</strong><span>{data.summary.employeeCandidates} employee candidates</span></article>
      <article {...summaryDrilldownProps({ title: "Microsoft Accounts With No Command Center Access", rows: userDrilldownRows(data.users.filter((user) => user.accessStatus === "No Access")) })}><small>NO ACCESS</small><strong>{data.summary.noAccess}</strong><span>Visible to Owner; blocked from Command Center</span></article>
      <article {...summaryDrilldownProps({ title: "Microsoft Accounts In Onboarding", rows: userDrilldownRows(data.users.filter((user) => user.accessStatus === "Onboarding Access")) })}><small>ONBOARDING</small><strong>{data.summary.onboarding}</strong><span>Limited employee-only access</span></article>
      <article {...summaryDrilldownProps({ title: "Active Microsoft-Backed Command Center Accounts", rows: userDrilldownRows(data.users.filter((user) => user.accessStatus === "Active")) })}><small>ACTIVE</small><strong>{data.summary.active}</strong><span>Owner-approved full access</span></article>
      <article {...summaryDrilldownProps({ title: "Disabled Or Held Microsoft Accounts", rows: userDrilldownRows(data.users.filter((user) => !user.accountEnabled || !user.directoryPresent || ["Suspended", "Revoked", "Microsoft Account Disabled"].includes(user.accessStatus))) })}><small>DISABLED / HELD</small><strong>{data.summary.disabled + data.summary.suspended}</strong><span>Fail-closed; no automatic restoration</span></article>
    </section>

    <div className="microsoft-access-toolbar">
      <nav><button className={tab === "Directory" ? "active" : ""} onClick={() => setTab("Directory")}>Directory &amp; Access</button><button className={tab === "Audit" ? "active" : ""} onClick={() => setTab("Audit")}>Permanent Audit Trail</button></nav>
      {data.actor.canSync ? <button disabled={saving || !data.connection.configured} onClick={() => void submit({ action: "sync-directory" })}>{saving ? "Working…" : "Sync Microsoft Directory"}</button> : null}
    </div>

    {notice ? <div className="microsoft-access-notice success">{notice}</div> : null}
    {error ? <div className="microsoft-access-notice error">{error}</div> : null}

    {tab === "Directory" ? <>
      {data.pendingDirectoryLinks.length ? <section className="microsoft-pending-links"><header><div><h3>Waiting For Microsoft Directory Matching</h3></div><b>{data.pendingDirectoryLinks.length}</b></header><div>{data.pendingDirectoryLinks.map((member) => <article key={member.email}><span className="microsoft-avatar">{initials(member.displayName)}</span><div><strong>{member.displayName}</strong><small>{member.email}</small></div><em>{member.accessLevel}</em><b>{member.status}</b></article>)}</div></section> : null}
      <section className="microsoft-directory-panel">
        <header><div><h3>Microsoft Directory</h3><span>{data.latestSync?.completed_at ? `Last reconciled ${dateTime(data.latestSync.completed_at)} · ${data.latestSync.source_count} source accounts` : "No Microsoft directory reconciliation has run yet."}</span></div><div><input aria-label="Search Microsoft directory" placeholder="Search name, email, title…" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter Microsoft directory" value={filter} onChange={(event) => setFilter(event.target.value)}>{["Employee Accounts", "No Command Center Access", "Onboarding", "Active", "Suspended / Revoked", "Disabled Microsoft Accounts", "All Directory Accounts"].map((item) => <option key={item}>{item}</option>)}</select></div></header>
        {loading ? <div className="microsoft-access-empty">Verifying Microsoft directory and access evidence…</div> : visible.length ? <div className="microsoft-directory-table" data-reflow-table=""><div className="head" data-reflow-head="medium"><span>Microsoft Account</span><span>Microsoft State</span><span>Command Center</span><span>Onboarding</span><span>Authority</span></div>{visible.map((user) => <article key={user.providerSubject} data-reflow-row="medium"><div data-label="Microsoft Account"><span className="microsoft-avatar">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small><em>{[user.jobTitle, user.department].filter(Boolean).join(" · ") || user.userType}</em></span></div><span className={`microsoft-state ${user.accountEnabled && user.directoryPresent ? "enabled" : "disabled"}`} data-label="Microsoft State">{user.accountEnabled && user.directoryPresent ? "Enabled" : "Disabled / Missing"}</span><span className={`microsoft-access-status status-${slug(user.accessStatus)}`} data-label="Command Center">{user.accessStatus}</span><span data-label="Onboarding"><b>{user.onboardingComplete ? "Complete" : user.onboardingStatus}</b><small>{user.accessLevel || "No role assigned"}</small></span><span data-label="Authority">{data.actor.canManage && user.candidate ? <button onClick={() => openUser(user)}>{user.accessStatus === "No Access" ? "Review & Grant" : "Manage Access"}</button> : <small>{user.candidate ? "Owner Action Required" : "Not Eligible"}</small>}</span></article>)}</div> : <div className="microsoft-access-empty">{data.connection.configured ? "No Microsoft accounts match this view." : "Connect Microsoft 365 to populate the employee directory. Existing Command Center users remain listed above without changing access."}</div>}
      </section>
    </> : <MicrosoftAccessAudit audits={data.audits} />}

    <section className="microsoft-access-boundaries"><article><small>CREATING A MICROSOFT ACCOUNT</small><strong>Never Grants Command Center Access</strong><p>The account appears as a candidate for Owner review.</p></article><article><small>DISABLING A MICROSOFT ACCOUNT</small><strong>Immediately Blocks Command Center</strong><p>Re-enabling Microsoft does not restore access. The Owner must reapprove it.</p></article><article><small>PROJECT ACCESS</small><strong>Assigned Separately</strong><p>Company access does not automatically place an employee on any project.</p></article><article><small>IDENTITY</small><strong>Permanent Microsoft Object ID</strong><p>Directory reconciliation tracks the account by Microsoft object ID even when its display name changes.</p></article></section>

    {selected ? <div className="modal-backdrop"><section className="microsoft-access-modal" role="dialog" aria-modal="true" aria-label={`Manage ${selected.displayName} access`}><header><div><h2>{selected.displayName}</h2><span>{selected.email}</span></div><button aria-label="Close access dialog" onClick={() => setSelected(null)}>×</button></header><div className="microsoft-person-state"><span><small>MICROSOFT</small><strong>{selected.accountEnabled && selected.directoryPresent ? "Enabled" : "Disabled"}</strong></span><span><small>COMMAND CENTER</small><strong>{selected.accessStatus}</strong></span><span><small>ONBOARDING</small><strong>{selected.onboardingComplete ? "Complete" : selected.onboardingStatus}</strong></span></div><label>Planned Company Access<select value={accessLevel} onChange={(event) => setAccessLevel(event.target.value)} disabled={selected.accessLevel === "Company Owner"}><option>Employee</option><option>Administrator</option>{selected.accessLevel === "Company Owner" ? <option>Company Owner</option> : null}</select><small>Administrator authority is still limited by protected Owner controls.</small></label><fieldset><legend>Planned Company Designations</legend><div>{ACCESS_DESIGNATIONS.map((item) => <label key={item}><input type="checkbox" checked={designations.includes(item)} onChange={() => toggleDesignation(item)} />{item}</label>)}</div><small>These are stored now but remain unusable until onboarding and access activation are complete. Project assignments are made separately.</small></fieldset><label>Owner Decision Reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this access is being granted, changed, suspended, or revoked." /><small>Required for every access decision and retained permanently.</small></label><footer>{selected.accessStatus === "No Access" ? <button className="primary" disabled={saving || reason.trim().length < 8} onClick={() => void submit({ action: "grant-access", providerSubject: selected.providerSubject, accessLevel, designations, projectScopes: [], reason })}>Grant Controlled Access</button> : <button disabled={saving || reason.trim().length < 8} onClick={() => void submit({ action: "update-access", providerSubject: selected.providerSubject, accessLevel, designations, projectScopes: selected.projectScopes, reason })}>Save Access Package</button>}{["Onboarding Access", "Approved"].includes(selected.accessStatus) ? <button className="primary" disabled={saving || !selected.onboardingComplete || reason.trim().length < 8} onClick={() => void submit({ action: "activate-access", providerSubject: selected.providerSubject, accessLevel, designations, projectScopes: selected.projectScopes, reason })}>Activate Full Access</button> : null}{selected.accessStatus === "Active" ? <button className="warning" disabled={saving || reason.trim().length < 8} onClick={() => void submit({ action: "suspend-access", providerSubject: selected.providerSubject, reason })}>Suspend Access</button> : null}{["Suspended", "Revoked", "Microsoft Account Disabled"].includes(selected.accessStatus) ? <button className="primary" disabled={saving || !selected.accountEnabled || !selected.directoryPresent || reason.trim().length < 8} onClick={() => void submit({ action: "restore-access", providerSubject: selected.providerSubject, accessLevel, designations, projectScopes: selected.projectScopes, reason })}>Owner Reapprove Access</button> : null}{!["No Access", "Revoked"].includes(selected.accessStatus) ? <button className="danger" disabled={saving || reason.trim().length < 8} onClick={() => void submit({ action: "revoke-access", providerSubject: selected.providerSubject, reason })}>Revoke Access</button> : null}<button onClick={() => setSelected(null)}>Cancel</button></footer></section></div> : null}
  </section>;
}

function MicrosoftAccessAudit({ audits }: { audits: AccessAudit[] }) {
  return <section className="microsoft-access-audit"><header><div><h3>Who Changed Access, What Changed, And Why</h3></div><b>{audits.length} Recent Events</b></header>{audits.length ? <div>{audits.map((item) => <article key={item.id}><span className={`microsoft-audit-mark ${item.actorType === "Automation" ? "automation" : "human"}`}>{item.actorType === "Automation" ? "AUTO" : "OWNER"}</span><div><strong>{item.action}</strong><p>{item.email} · {item.priorStatus || "—"} → {item.nextStatus || "—"}</p><small>{item.reason}</small></div><aside><b>{item.actorName}</b><span>{dateTime(item.createdAt)}</span></aside></article>)}</div> : <div className="microsoft-access-empty">No Microsoft access decisions have been recorded yet.</div>}</section>;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MS";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function dateTime(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
