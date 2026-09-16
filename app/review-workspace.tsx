"use client";

import { useEffect, useMemo, useState } from "react";
import { EmployeeResourceHub } from "./employee-resource-hub";
import { summaryDrilldownProps } from "./summary-drilldown";

type ReviewFile = {
  id: number;
  name: string;
  revision: string;
  uploadedBy: string;
  contentType: string;
  createdAt: string;
  date: string;
  size: string;
};

type ReviewTemplate = {
  id: string;
  name: string;
  area: string;
  category: string;
  version: string;
  source: string;
  owner: string;
  standardStructure: string[];
  status: string;
  currentVersion: string;
  currentFile: ReviewFile | null;
  files: ReviewFile[];
  lastReviewDate: string;
  nextReviewDate: string;
  lastDecision: string;
  signedBy: string;
  history: Array<Record<string, unknown>>;
  publishedToEmployees: boolean;
  annualReviewStatus: string;
  governance: { jurisdiction: string; businessOwner: string; sourceSha256: string; effectiveDate: string; nextReviewDate: string; requiredReviewers: string[]; approvals: Array<{ reviewerRole: string; reviewerName: string; decidedAt: string }> };
};

type ReviewData = {
  year: string;
  permissions: {
    canReview: boolean;
    canUpload: boolean;
    canView: boolean;
    uploadAreas: string[];
    accessLevel: string;
    reviewerRoles: string[];
  };
  templates: ReviewTemplate[];
  controls: Record<string, string>;
};

const today = () => new Date().toISOString().slice(0, 10);

export function ReviewWorkspace({ actor }: { actor: { name: string; accessLevel: string } }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [area, setArea] = useState("All Areas");
  const [category, setCategory] = useState("All Templates");
  const [selectedId, setSelectedId] = useState("");
  const [reviewing, setReviewing] = useState<ReviewTemplate | null>(null);
  const [uploading, setUploading] = useState<ReviewTemplate | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [draft, setDraft] = useState({
    version: "",
    reviewDate: today(),
    decision: "Current — No Change" as "Current — No Change" | "Updated Master",
    changeSummary: "",
    attestation: false,
  });
  const [uploadDraft, setUploadDraft] = useState({ version: "", effectiveDate: today(), jurisdiction: "Companywide", changeSummary: "" });
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/review");
      const result = (await response.json()) as ReviewData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Review Center Is Unavailable");
      setData(result);
      setSelectedId((current) =>
        current && result.templates.some((item) => item.id === current)
          ? current
          : result.templates[0]?.id || "",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review Center Is Unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function signoff() {
    if (!reviewing) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "owner-signoff", templateId: reviewing.id, ...draft }),
      });
      const result = (await response.json()) as { error?: string; nextReviewDate?: string };
      if (!response.ok) throw new Error(result.error || "The Owner Review Could Not Be Recorded");
      setNotice(`${reviewing.name} Signed Off · Next Review ${formatDate(result.nextReviewDate || "")}`);
      setReviewing(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Review Could Not Be Recorded");
    } finally {
      setSaving(false);
    }
  }

  async function uploadVersion() {
    if (!uploading || !uploadFile) return;
    setSaving(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("action", "upload-version");
      form.set("templateId", uploading.id);
      form.set("version", uploadDraft.version);
      form.set("effectiveDate", uploadDraft.effectiveDate);
      form.set("jurisdiction", uploadDraft.jurisdiction);
      form.set("changeSummary", uploadDraft.changeSummary);
      form.set("file", uploadFile);
      const response = await fetch("/api/review", { method: "POST", body: form });
      const result = (await response.json()) as { error?: string; file?: ReviewFile };
      if (!response.ok) throw new Error(result.error || "The New Master Version Could Not Be Uploaded");
      setNotice(`${uploading.name} · ${result.file?.revision || uploadDraft.version} Uploaded. Owner Signoff Is Required Before Publication.`);
      setUploading(null);
      setUploadFile(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The New Master Version Could Not Be Uploaded");
    } finally {
      setSaving(false);
    }
  }

  const areas = useMemo(
    () => ["All Areas", ...Array.from(new Set(data?.templates.map((item) => item.area) || []))],
    [data],
  );
  const categories = useMemo(() => [
    "All Templates",
    ...Array.from(new Set((data?.templates || []).filter((item) => area === "All Areas" || item.area === area).map((item) => item.category))),
  ], [area, data]);
  const visible = data?.templates.filter((item) =>
    (area === "All Areas" || item.area === area) && (category === "All Templates" || item.category === category),
  ) || [];
  const selected = data?.templates.find((item) => item.id === selectedId) || null;
  const signed = data?.templates.filter((item) => item.status === "Approved for Use").length || 0;
  const overdue = data?.templates.filter((item) =>
    ["Overdue", "Initial Owner Review Required", "Updated Master — Owner Signoff Required"].includes(item.status),
  ).length || 0;
  const uploaded = data?.templates.filter((item) => Boolean(item.currentFile)).length || 0;

  function openReview(template: ReviewTemplate) {
    const updatedMaster = template.status === "Updated Master — Owner Signoff Required";
    setReviewing(template);
    setDraft({
      version: template.currentVersion,
      reviewDate: today(),
      decision: updatedMaster ? "Updated Master" : "Current — No Change",
      changeSummary: "",
      attestation: false,
    });
  }

  function openUpload(template: ReviewTemplate) {
    setUploading(template);
    setUploadFile(null);
    setUploadDraft({ version: nextVersionLabel(template.currentVersion), effectiveDate: today(), jurisdiction: template.governance.jurisdiction || "Companywide", changeSummary: "" });
  }

  async function approve(role: string) {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "governance-approval", templateId: selected.id, reviewerRole: role, attestation: true, changeSummary: "Approved exact controlled source and jurisdiction for company use." }) });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "Approval Could Not Be Recorded");
      setNotice(`${role} approval recorded · ${result.status}`);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Approval Could Not Be Recorded"); }
    finally { setSaving(false); }
  }

  function chooseArea(nextArea: string) {
    setArea(nextArea);
    setCategory("All Templates");
    const first = data?.templates.find((item) => nextArea === "All Areas" || item.area === nextArea);
    if (first) setSelectedId(first.id);
  }

  function chooseCategory(nextCategory: string) {
    setCategory(nextCategory);
    const first = data?.templates.find((item) =>
      (area === "All Areas" || item.area === area) && (nextCategory === "All Templates" || item.category === nextCategory),
    );
    if (first) setSelectedId(first.id);
  }

  if (loading && !data) return <div className="review-loading">Loading Review Center…</div>;

  return (
    <div className="review-workspace">
      <header className="review-hero">
        <div>
          <p>LEGAL · HUMAN RESOURCES · BENEFITS · {actor.name.toUpperCase()}</p>
          <h1>Company Review Center</h1>

        </div>
        <div><strong>{data?.year || new Date().getFullYear()}</strong><span>ANNUAL REVIEW CYCLE</span></div>
      </header>

      {notice ? <div className={/could not|required|only|unavailable|must/i.test(notice) ? "review-notice error" : "review-notice"}>{notice}<button onClick={() => setNotice("")}>×</button></div> : null}

      <section className="review-metrics">
        <article {...summaryDrilldownProps({ title: "Controlled Company Masters", rows: (data?.templates || []).map((template) => reviewSummaryRow(template, setSelectedId)) })}><strong>{data?.templates.length || 0}</strong><span>CONTROLLED MASTERS</span><small>Every template in one inventory</small></article>
        <article {...summaryDrilldownProps({ title: "Templates With Current Files", rows: (data?.templates || []).filter((template) => Boolean(template.currentFile)).map((template) => reviewSummaryRow(template, setSelectedId)) })}><strong>{uploaded}</strong><span>CURRENT FILES</span><small>Openable master documents</small></article>
        <article {...summaryDrilldownProps({ title: "Templates Approved For Use", rows: (data?.templates || []).filter((template) => template.status === "Approved for Use").map((template) => reviewSummaryRow(template, setSelectedId)) })}><strong>{signed}</strong><span>APPROVED FOR USE</span><small>Exact source and all required approvals</small></article>
        <article {...summaryDrilldownProps({ title: "Template Actions Required", rows: (data?.templates || []).filter((template) => ["Overdue", "Initial Owner Review Required", "Updated Master — Owner Signoff Required"].includes(template.status)).map((template) => reviewSummaryRow(template, setSelectedId)) })}><strong>{overdue}</strong><span>ACTION REQUIRED</span><small>Missing, changed, or overdue reviews</small></article>
      </section>

      <section className="review-standard">
        <span>STD</span>
        <div><h2>Company Templates</h2></div>
        <strong>OWNER-CONTROLLED</strong>
      </section>

      <nav className="review-area-tabs" aria-label="Review Center areas">
        {areas.map((item) => <button key={item} className={area === item ? "active" : ""} onClick={() => chooseArea(item)}><span>{item}</span><b>{item === "All Areas" ? data?.templates.length || 0 : data?.templates.filter((template) => template.area === item).length || 0}</b></button>)}
      </nav>

      {area === "Benefits" ? <section className="review-benefits-control"><header><div><h2>Benefits Carrier & Employee Access</h2></div><strong>ONE SOURCE OF TRUTH</strong></header><EmployeeResourceHub management /></section> : null}

      <div className="review-layout">
        <aside className="review-inventory">
          <header><div><h2>Template Inventory</h2><p>{visible.length} shown</p></div><select value={category} onChange={(event) => chooseCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></header>
          {visible.map((template) => <button key={template.id} className={selectedId === template.id ? "active" : ""} onClick={() => setSelectedId(template.id)}><span><b>{template.name}</b><small>{template.category} · {template.currentVersion}</small></span><i className={statusClass(template.status)}>{template.status}</i></button>)}
        </aside>

        <main className="review-detail">
          {selected ? <>
            <header><div><p>{selected.area.toUpperCase()} · {selected.category.toUpperCase()} · {selected.id}</p><h2>{selected.name}</h2><span>{selected.source}</span></div><i className={statusClass(selected.status)}>{selected.status}</i></header>

            <section className="review-facts">
              <div><span>Current Version</span><b>{selected.currentVersion}</b></div><div><span>Jurisdiction</span><b>{selected.governance.jurisdiction}</b></div><div><span>Business Owner</span><b>{selected.governance.businessOwner}</b></div><div><span>Next Governance Review</span><b>{formatDate(selected.governance.nextReviewDate)}</b></div>
            </section>

            <section className="review-structure"><h3>Release Governance</h3><div><span>SHA</span><p>{selected.governance.sourceSha256 || "Missing source master hash — release blocked"}</p></div>{selected.governance.requiredReviewers.map((role) => { const approval = selected.governance.approvals.find((item) => item.reviewerRole === role); const canApprove = data?.permissions.reviewerRoles.includes(role); return <div key={role}><span>{approval ? "✓" : "!"}</span><p><b>{role}</b> · {approval ? `Approved by ${approval.reviewerName} on ${formatDate(approval.decidedAt.slice(0, 10))}` : "Approval required"} {!approval && canApprove ? <button className="review-primary" disabled={saving || !selected.currentFile} onClick={() => void approve(role)}>Approve Exact Source</button> : null}</p></div>; })}</section>

            <section className="review-master-file">
              <header>
                <div><h3>{selected.currentFile?.name || "Master File Upload Required"}</h3><span>{selected.currentFile ? `${selected.currentFile.revision} · ${selected.currentFile.size} · Uploaded ${selected.currentFile.date} By ${selected.currentFile.uploadedBy}` : "The catalog entry exists, but no source file has been published yet."}</span></div>
                <div className="review-file-actions">
                  {selected.currentFile ? <button onClick={() => window.open(`/api/files?id=${selected.currentFile?.id}`, "_blank", "noopener,noreferrer")}>Open Current Master ↗</button> : null}
                  <button className="review-primary" disabled={!data?.permissions.uploadAreas.includes(selected.area)} onClick={() => openUpload(selected)}>{data?.permissions.uploadAreas.includes(selected.area) ? "Upload New Version" : `${selected.area} Template Manager Required`}</button>
                </div>
              </header>
              {selected.area === "Benefits" ? <div className={`review-publish-state ${selected.publishedToEmployees ? "published" : "pending"}`}><b>{selected.publishedToEmployees ? "PUBLISHED TO MY EMPLOYEE HOME" : "NOT YET PUBLISHED TO EMPLOYEES"}</b><span>{selected.publishedToEmployees ? "Employees can open this current, Owner-approved plan document from their Employee Home." : "Upload the carrier document, then complete Owner signoff before employees see it."}</span></div> : null}
            </section>

            <section className="review-file-history">
              <header><h3>Permanent File Version History</h3><span>{selected.files.length} VERSION{selected.files.length === 1 ? "" : "S"}</span></header>
              {selected.files.length ? selected.files.map((file, index) => <button key={file.id} onClick={() => window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer")}><i>{index === 0 ? "CURRENT" : "PRIOR"}</i><span><b>{file.revision} · {file.name}</b><small>{file.date} · {file.uploadedBy} · {file.size}</small></span><strong>OPEN ↗</strong></button>) : <div className="review-empty"><b>No Master File Uploaded Yet</b><p>The first owner upload will establish version one without removing this controlled template record.</p></div>}
            </section>

            <section className="review-structure"><h3>Required Standard Structure</h3>{selected.standardStructure.map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</section>

            <section className="review-history">
              <header><h3>Permanent Annual Review History</h3><span>{selected.history.length} SIGNOFF{selected.history.length === 1 ? "" : "S"}</span></header>
              {selected.history.length ? selected.history.map((entry) => <article key={String(entry.id)}><span>{String(entry.reviewYear || "")}</span><div><b>{String(entry.decision || "Owner Review")}</b><p>{String(entry.changeSummary || "")}</p><small>{String(entry.ownerName || "Owner")} · {formatDate(String(entry.reviewDate || ""))} · {String(entry.version || "")}</small></div></article>) : <div className="review-empty"><b>Initial Owner Review Required</b><p>No annual signoff has been recorded yet.</p></div>}
            </section>

            <div className="review-actions"><p>Prior files, versions, and signoffs cannot be deleted or overwritten.</p><button disabled={!data?.permissions.canReview || selected.status === "Owner Signed Off"} onClick={() => openReview(selected)}>{selected.status === "Owner Signed Off" ? `${data?.year} Review Complete` : data?.permissions.canReview ? "Open Owner Annual Review" : "Company Owner Signoff Required"}</button></div>
          </> : <div className="review-empty"><b>Select A Template</b></div>}
        </main>
      </div>

      {reviewing ? <div className="review-modal-layer"><section className="review-modal">
        <header><div><p>{data?.year} ANNUAL OWNER REVIEW</p><h2>{reviewing.name}</h2></div><button onClick={() => setReviewing(null)}>×</button></header>
        <div className="review-rule"><b>This action locks the annual decision.</b><span>The authorized version must match the current uploaded master. Prior files and signoffs remain permanent.</span></div>
        <label>Authorized Version<input value={draft.version} readOnly /></label>
        <label>Review Date<input type="date" max={today()} value={draft.reviewDate} onChange={(event) => setDraft((current) => ({ ...current, reviewDate: event.target.value }))} /></label>
        <fieldset><legend>Owner Decision</legend>{(["Current — No Change", "Updated Master"] as const).map((decision) => <label key={decision} className={draft.decision === decision ? "active" : ""}><input type="radio" checked={draft.decision === decision} onChange={() => setDraft((current) => ({ ...current, decision }))} />{decision}</label>)}</fieldset>
        <label>Review Notes / Change Summary<textarea rows={5} value={draft.changeSummary} onChange={(event) => setDraft((current) => ({ ...current, changeSummary: event.target.value }))} placeholder={draft.decision === "Updated Master" ? "Required: describe additions, deletions, or changes." : "Optional: record why the current form remains sufficient."} /></label>
        <label className="review-attest"><input type="checkbox" checked={draft.attestation} onChange={(event) => setDraft((current) => ({ ...current, attestation: event.target.checked }))} /><span>I reviewed this controlled company template and authorize the stated version for continued company use. My identity, decision, date, and next annual review become permanent.</span></label>
        <footer><button onClick={() => setReviewing(null)}>Cancel</button><button className="review-primary" disabled={saving || !draft.attestation} onClick={() => void signoff()}>{saving ? "Recording…" : "Sign, Lock & Schedule Next Review"}</button></footer>
      </section></div> : null}

      {uploading ? <div className="review-modal-layer"><section className="review-modal">
        <header><div><h2>{uploading.name}</h2></div><button onClick={() => setUploading(null)}>×</button></header>
        <div className="review-rule"><b>Uploads create a new permanent version.</b><span>The current approved file remains available in history. Uploading never publishes, approves, or signs off the new master.</span></div>
        <label className="review-file-picker"><input type="file" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} /><b>{uploadFile?.name || "Choose The New Master File"}</b><span>{uploadFile ? `${Math.max(0.1, uploadFile.size / 1_000_000).toFixed(1)} MB` : "Any File Type · 25 MB Maximum"}</span></label>
        <label>New Version<input value={uploadDraft.version} onChange={(event) => setUploadDraft((current) => ({ ...current, version: event.target.value }))} placeholder="Example: Master v2" /></label>
        <label>Effective Date<input type="date" max={today()} value={uploadDraft.effectiveDate} onChange={(event) => setUploadDraft((current) => ({ ...current, effectiveDate: event.target.value }))} /></label>
        <label>Jurisdiction<input value={uploadDraft.jurisdiction} onChange={(event) => setUploadDraft((current) => ({ ...current, jurisdiction: event.target.value }))} placeholder="Companywide, Kentucky, Indiana…" /></label>
        <label>Change Summary<textarea rows={5} value={uploadDraft.changeSummary} onChange={(event) => setUploadDraft((current) => ({ ...current, changeSummary: event.target.value }))} placeholder="Required: explain what changed and why this file becomes the current master." /></label>
        <footer><button onClick={() => setUploading(null)}>Cancel</button><button className="review-primary" disabled={saving || !uploadFile || !uploadDraft.version.trim() || uploadDraft.changeSummary.trim().length < 15} onClick={() => void uploadVersion()}>{saving ? "Uploading…" : "Upload And Preserve Prior Version"}</button></footer>
      </section></div> : null}
    </div>
  );
}

function reviewSummaryRow(template: ReviewTemplate, select: (id: string) => void) {
  return { id: template.id, title: template.name, subtitle: `${template.area} · ${template.category} · ${template.currentVersion}`, status: template.status, meta: `Next review ${formatDate(template.nextReviewDate)}`, onOpen: () => select(template.id), openLabel: "Open Template →" };
}

function formatDate(value: string) {
  if (!value) return "Not Yet Reviewed";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function nextVersionLabel(value: string) {
  const match = value.match(/^(.*?)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${value} · Revision 2`;
}

function statusClass(value: string) {
  return value.toLowerCase().replaceAll(" ", "-").replaceAll("—", "-");
}
