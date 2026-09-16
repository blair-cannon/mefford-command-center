"use client";

import { useEffect, useState } from "react";

type EmployeeResource = {
  id: string;
  category: "Work" | "Payroll" | "Benefits";
  title: string;
  provider: string;
  description: string;
  url: string;
  action: string;
  icon: string;
  fixedProvider?: boolean;
};

type ResourceResponse = {
  canManage: boolean;
  manageCategories: EmployeeResource["category"][];
  resources: EmployeeResource[];
  benefitDocuments?: Array<{ id: number; title: string; name: string; revision: string; date: string }>;
  updatedAt?: string;
  updatedBy?: string;
  boundaries?: { payroll?: string; benefits?: string };
  error?: string;
};

export function EmployeeResourceHub({ management = false }: { management?: boolean }) {
  const [data, setData] = useState<ResourceResponse | null>(null);
  const [draft, setDraft] = useState<EmployeeResource[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/employee-resources");
    const result = await response.json() as ResourceResponse;
    if (!response.ok) throw new Error(result.error || "Employee Resources Are Unavailable.");
    setData(result);
    setDraft(result.resources);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employee-resources")
      .then(async (response) => { const result = await response.json() as ResourceResponse; if (!response.ok) throw new Error(result.error || "Employee Resources Are Unavailable."); return result; })
      .then((result) => { if (!cancelled) { setData(result); setDraft(result.resources); } })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Employee Resources Are Unavailable."));
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/employee-resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resources: draft }) });
      const result = await response.json() as ResourceResponse & { saved?: boolean };
      if (!response.ok) throw new Error(result.error || "Employee Resources Could Not Be Saved.");
      await load();
      setEditing(false);
      setNotice("Employee resource links updated. Employees will see the new information immediately.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Employee Resources Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <section className="employee-resource-home loading"><span>{notice || "Preparing Your Employee Resources..."}</span></section>;
  const ready = data.resources.filter((resource) => Boolean(resource.url)).length;
  const setupNeeded = data.resources.length - ready;

  return <section className={`employee-resource-home ${management ? "management" : ""}`} aria-label="Employee resources">
    <header>
      <div><p className="eyebrow orange-text">{management ? "EMPLOYEE EXPERIENCE SETTINGS" : "EVERYDAY EMPLOYEE LINKS"}</p><h2>{management ? "Keep Every Employee Link Current" : "Everything You Need, In One Place"}</h2><span>{management ? "These links appear for every employee. Changes are saved permanently and take effect immediately." : "Email, calendar, payroll, and benefits open directly from here. You do not need to search for them."}</span></div>
      {management && data.canManage ? <button className="secondary-action" onClick={() => { setDraft(data.resources); setEditing((current) => !current); }}>{editing ? "Close Settings" : "Edit Employee Links"}</button> : <b>{ready} LINKS READY</b>}
    </header>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    {management && setupNeeded ? <div className="employee-resource-setup"><strong>{setupNeeded} link{setupNeeded === 1 ? "" : "s"} still need company setup.</strong><span>Employees see a clear “being added” message instead of a broken or guessed link.</span></div> : null}
    {editing && data.canManage ? <div className="employee-resource-editor">
      {draft.map((resource) => {
        const canEdit = data.manageCategories.includes(resource.category);
        return <article key={resource.id} className={canEdit ? "" : "view-only"}><div><i>{resource.icon}</i><span><strong>{resource.title}</strong><small>{resource.category} · {canEdit ? "EDITABLE" : "VIEW ONLY"}</small></span></div><label>Provider<input disabled={!canEdit} value={resource.provider} onChange={(event) => setDraft((current) => current.map((item) => item.id === resource.id ? { ...item, provider: event.target.value } : item))} /></label><label>Secure Employee Link<input disabled={!canEdit} type="url" placeholder="https://" value={resource.url} onChange={(event) => setDraft((current) => current.map((item) => item.id === resource.id ? { ...item, url: event.target.value } : item))} /></label></article>;
      })}
      <div className="employee-resource-editor-actions"><span>Only secure HTTPS links are accepted. Payroll remains employee self-service only.</span><button className="primary-action large" disabled={saving} onClick={() => void save()}>{saving ? "Saving Links..." : "Save Employee Experience"}</button></div>
    </div> : <div className="employee-resource-grid">
      {data.resources.map((resource) => resource.url ? <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><i>{resource.icon}</i><span><small>{resource.category}</small><strong>{resource.title}</strong><em>{resource.provider}</em><p>{resource.description}</p></span><b>{resource.action} ↗</b></a> : <article className="not-ready" key={resource.id}><i>{resource.icon}</i><span><small>{resource.category}</small><strong>{resource.title}</strong><em>{resource.provider}</em><p>Company Administration is adding this plan link. There is nothing you need to do yet.</p></span><b>BEING ADDED</b></article>)}
    </div>}
    {!management && data.benefitDocuments?.length ? <div className="employee-benefit-documents"><header><div><small>CURRENT OWNER-APPROVED DOCUMENTS</small><strong>Your Benefit Plan Information</strong></div><b>{data.benefitDocuments.length} FILE{data.benefitDocuments.length === 1 ? "" : "S"}</b></header>{data.benefitDocuments.map((document) => <button key={document.id} onClick={() => window.open(`/api/files?id=${document.id}`, "_blank", "noopener,noreferrer")}><i>PDF</i><span><strong>{document.title}</strong><small>{document.name} · {document.revision} · Approved {document.date}</small></span><b>OPEN ↗</b></button>)}</div> : null}
    {!management ? <footer><span><b>PAYROLL</b> Paylocity opens for your account only. Command Center never runs payroll.</span><span><b>BENEFITS</b> Your carrier account and official plan documents control coverage.</span></footer> : null}
  </section>;
}
