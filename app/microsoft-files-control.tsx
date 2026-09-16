"use client";

import { useEffect, useMemo, useState } from "react";

type WorkspaceType = "Estimate" | "Project" | "Employee" | "Company Templates";

type Snapshot = {
  actor: { canConfigure: boolean };
  connection: {
    configured: boolean;
    provisioningEnabled: boolean;
    mode: string;
    mappedTypes: WorkspaceType[];
    missing: string[];
    noDeleteGuard: boolean;
    deleteCapability: string;
    permissionPolicyVerified: boolean;
    permissionBoundary: string;
    sourceOfTruth: string;
  };
  policy: { automaticRoots: string[]; migrationSequence: string[]; hardRules: string[] };
  blueprints: Record<WorkspaceType, { libraryKey: string; rootLabel: string; folders: Array<{ key: string; label: string; permissionClass: string; description: string }> }>;
  counts: Record<string, number>;
  workspaces: Array<{ id: string; entity_type: WorkspaceType; entity_id: string; display_name: string; logical_root_path: string; status: string; web_url: string; error_message: string; updated_at: string; noDeleteGuard: boolean }>;
  files: Array<{ id: string; workspace_id: string; source_name: string; folder_key: string; state: string; no_source_delete: number }>;
  events: Array<{ id: string; action: string; status: string; detail: string; actor_name: string; created_at: string }>;
};

export function MicrosoftFilesControl() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedType, setSelectedType] = useState<WorkspaceType>("Project");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/sharepoint-storage", { cache: "no-store" });
      const result = await response.json() as Snapshot & { error?: string };
      if (!response.ok) throw new Error(result.error || "Microsoft File Control Is Unavailable");
      setData(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Microsoft File Control Is Unavailable");
    } finally { setLoading(false); }
  }

  async function act(action: "register-existing" | "provision-pending" | "copy-pending" | "controlled-folder-test", workspaceId = "") {
    setWorking(workspaceId || action);
    setNotice("");
    try {
      const response = await fetch("/api/sharepoint-storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, workspaceId }) });
      const result = await response.json() as { error?: string; notice?: string; snapshot?: Snapshot };
      if (!response.ok) throw new Error(result.error || "Microsoft File Control Could Not Complete The Action");
      if (result.snapshot) setData((current) => current ? { ...result.snapshot!, actor: current.actor } : null);
      else await load();
      setNotice(result.notice || "Microsoft file control action completed under the no-delete guard.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Microsoft File Control Could Not Complete The Action");
    } finally { setWorking(""); }
  }

  const mapped = useMemo(() => data?.workspaces.filter((item) => item.entity_type === selectedType) || [], [data, selectedType]);
  if (loading && !data) return <div className="integration-loading"><span /><b>Loading Microsoft file controls…</b></div>;
  if (!data) return <section className="integration-empty"><h2>Microsoft File Control Is Unavailable</h2><p>{notice}</p><button onClick={() => void load()}>Try Again</button></section>;

  const blueprint = data.blueprints[selectedType];
  return <div className="microsoft-files-control">
    {notice ? <div className="microsoft-files-notice" role="status">{notice}</div> : null}
    <section className={`microsoft-files-banner ${data.connection.provisioningEnabled ? "ready" : "pending"}`}>
      <div><h2>{data.connection.provisioningEnabled ? "Folder Provisioning Enabled" : "Blueprint Ready · Tenant Mapping Pending"}</h2></div>
      <aside><b>{data.connection.mode}</b><strong>{data.connection.noDeleteGuard ? "NO-DELETE GUARD ON" : "GUARD ERROR"}</strong></aside>
    </section>

    <section className="microsoft-files-actions">
      <article><small>CURRENT SOURCE OF TRUTH</small><strong>{data.connection.sourceOfTruth}</strong><span>No existing Command Center file is removed, replaced, or silently overwritten.</span></article>
      <article><small>AUTOMATIC ROOTS</small><strong>{data.policy.automaticRoots.join(" · ")}</strong></article>
      <article><small>PHYSICAL MAPPINGS</small><strong>{data.connection.mappedTypes.length}/4</strong><span>{data.connection.missing.join(" · ") || "All required settings are present."}</span></article>
      <article><small>PERMISSION POLICY</small><strong>{data.connection.permissionPolicyVerified ? "Verified" : "Verification Required"}</strong><span>{data.connection.permissionBoundary}</span></article>
      <div>
        <button disabled={Boolean(working)} onClick={() => void act("register-existing")}>{working === "register-existing" ? "Registering…" : "Register Existing Records"}</button>
        <button disabled={Boolean(working) || !data.connection.provisioningEnabled} onClick={() => void act("controlled-folder-test")}>{working === "controlled-folder-test" ? "Testing…" : "Run Controlled Folder Test"}</button>
        <button className="primary" disabled={Boolean(working) || !data.connection.provisioningEnabled} onClick={() => void act("provision-pending")}>{working === "provision-pending" ? "Provisioning…" : "Provision Pending Folders"}</button>
        <button className="primary" disabled={Boolean(working) || !data.connection.provisioningEnabled} onClick={() => void act("copy-pending")}>{working === "copy-pending" ? "Copying…" : "Copy Pending Files · Retain Sources"}</button>
      </div>
    </section>

    <section className="microsoft-files-sequence" aria-label="SharePoint activation sequence">
      {data.policy.migrationSequence.map((step, index) => <span key={step}><i>{index + 1}</i><b>{step}</b></span>)}
    </section>

    <section className="microsoft-files-layout">
      <div className="integration-panel microsoft-blueprint">
        <header><div><h2>{selectedType} Files</h2><span>{blueprint.libraryKey} library · {blueprint.folders.length} controlled folders</span></div><b>{mapped.length} Registered</b></header>
        <nav>{(Object.keys(data.blueprints) as WorkspaceType[]).map((type) => <button key={type} className={selectedType === type ? "active" : ""} onClick={() => setSelectedType(type)}>{type}</button>)}</nav>
        <div>{blueprint.folders.map((folder) => <article key={folder.key}><span>{folder.label.slice(0, 2)}</span><div><h3>{folder.label.replaceAll("_", " ")}</h3><p>{folder.description}</p><small>{folder.permissionClass}</small></div></article>)}</div>
      </div>
      <aside className="microsoft-files-side">
        <section className="integration-panel microsoft-workspaces"><header><div><h2>{selectedType}</h2></div><b>{mapped.length}</b></header><div>{mapped.length ? mapped.slice(0, 30).map((item) => <article key={item.id}><div><h3>{item.entity_id} · {item.display_name}</h3><p>{item.logical_root_path}</p><small>{item.error_message || `Updated ${formatDate(item.updated_at)}`}</small></div><b className={`status-dot-label status-${statusSlug(item.status)}`}>{item.status}</b>{item.web_url ? <a href={item.web_url} target="_blank" rel="noreferrer">Open SharePoint</a> : null}</article>) : <div className="integration-zero">No {selectedType.toLowerCase()} mappings are registered yet.</div>}</div></section>
        <section className="microsoft-file-guard"><h3>{data.connection.deleteCapability}</h3><ul>{data.policy.hardRules.map((rule) => <li key={rule}>{rule}</li>)}</ul></section>
      </aside>
    </section>
  </div>;
}

function statusSlug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function formatDate(value: string) { const date = new Date(value.endsWith("Z") ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
