"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OWNER_CONTRACT_BASIS_FIELDS,
  OWNER_CONTRACT_BASIS_KINDS,
  isPdfProjectFile,
  ownerContractBasisAttachments,
  withOwnerContractBasisFile,
  withOwnerContractBasisRevision,
  type OwnerContractBasisFile,
  type OwnerContractBasisKind,
} from "../lib/owner-contract-basis";

const DIRECT_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

type FileListResponse = { files?: OwnerContractBasisFile[]; error?: string };

export function ContractBasisAttachments({
  projectId,
  fields,
  disabled = false,
  preAward = false,
  onChange,
  onNotice,
}: {
  projectId: string;
  fields: Record<string, string>;
  disabled?: boolean;
  preAward?: boolean;
  onChange: (fields: Record<string, string>) => void;
  onNotice: (notice: string) => void;
}) {
  const [files, setFiles] = useState<OwnerContractBasisFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<OwnerContractBasisKind | "">("");
  const [progress, setProgress] = useState(0);
  const attached = ownerContractBasisAttachments(fields);

  async function loadFiles() {
    setLoading(true);
    try {
      const response = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      const result = await response.json() as FileListResponse;
      if (!response.ok) throw new Error(result.error || "Project PDFs Could Not Be Loaded.");
      setFiles((result.files || []).filter(isPdfProjectFile));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Project PDFs Could Not Be Loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`)
      .then(async (response) => ({ response, result: await response.json() as FileListResponse }))
      .then(({ response, result }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error || "Project PDFs Could Not Be Loaded.");
        setFiles((result.files || []).filter(isPdfProjectFile));
      })
      .catch((error) => !cancelled && onNotice(error instanceof Error ? error.message : "Project PDFs Could Not Be Loaded."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [onNotice, projectId]);

  const rankedFiles = useMemo(() => ({
    scope: rankFiles(files, "scope"),
    drawings: rankFiles(files, "drawings"),
  }), [files]);

  async function upload(kind: OwnerContractBasisKind, file: File) {
    if (!isPdfProjectFile({ name: file.name, contentType: file.type })) {
      onNotice("Contract Basis Attachments Must Be PDF Files.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      onNotice("Contract Basis PDFs Must Be 1 GB Or Smaller.");
      return;
    }
    setUploading(kind);
    setProgress(0);
    try {
      const config = OWNER_CONTRACT_BASIS_FIELDS[kind];
      const revision = fields[config.revision]?.trim() || `${config.label} · Contract Basis`;
      const category = preAward
        ? `07-Contract · Contract Basis · ${config.label}`
        : `Contracts / Contract Basis / ${config.label}`;
      const saved = await uploadBasisPdf(file, projectId, category, revision, setProgress);
      setFiles((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      onChange(withOwnerContractBasisFile(fields, kind, saved));
      onNotice(`${saved.name} Is Attached As The ${config.label}. Save The Contract To Bind It To The Exact Revision.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The Contract Basis PDF Could Not Be Uploaded.");
    } finally {
      setUploading("");
      setProgress(0);
    }
  }

  return <section className="contract-basis-panel" aria-label="Contract Basis PDF Attachments">
    <header><div><span>CONTRACT BASIS</span><h3>Scope And Drawing PDFs</h3></div><b>{attached.length ? `${attached.length} ATTACHED` : "OPTIONAL"}</b></header>
    <div className="contract-basis-grid">
      {OWNER_CONTRACT_BASIS_KINDS.map((kind) => {
        const config = OWNER_CONTRACT_BASIS_FIELDS[kind];
        const selectedId = fields[config.fileId] || "";
        const selected = attached.find((item) => item.kind === kind);
        return <article key={kind} className={selected ? "attached" : ""}>
          <div className="contract-basis-card-heading"><span>{kind === "scope" ? "01" : "02"}</span><div><strong>{config.label}</strong><small>{kind === "scope" ? "The written scope of work used to price and perform the project." : "The drawing set used to define the work."}</small></div><i>{selected ? "ATTACHED" : "NOT ATTACHED"}</i></div>
          <label><span>Choose Existing Project PDF</span><select value={selectedId} disabled={disabled || loading || uploading !== ""} onChange={(event) => { const file = files.find((item) => String(item.id) === event.target.value) || null; onChange(withOwnerContractBasisFile(fields, kind, file)); }}><option value="">{loading ? "Loading Project PDFs…" : files.length ? "Select A PDF" : "No Project PDFs Found"}</option>{rankedFiles[kind].map((file) => <option key={file.id} value={file.id}>{file.name} · {file.revision || file.category}</option>)}</select></label>
          <div className="contract-basis-upload-row"><label className="contract-basis-upload"><input type="file" accept="application/pdf,.pdf" disabled={disabled || uploading !== ""} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(kind, file); event.currentTarget.value = ""; }} /><span>{uploading === kind ? `Uploading ${progress}%` : selected ? "Upload A Replacement PDF" : "Upload A New PDF"}</span></label><button type="button" disabled={disabled || loading || uploading !== ""} onClick={() => void loadFiles()}>Refresh List</button></div>
          {selected ? <div className="contract-basis-selected"><div><strong>{selected.name}</strong><small>File {selected.fileId} · {selected.category || config.label}</small></div><a href={`/api/files?id=${encodeURIComponent(String(selected.fileId))}`} target="_blank" rel="noreferrer">Open PDF ↗</a></div> : null}
          <label><span>Revision / Issue Date</span><input value={fields[config.revision] || ""} disabled={disabled || !selected} placeholder="Example: Rev. 2 · Issued 9/10/2026" onChange={(event) => onChange(withOwnerContractBasisRevision(fields, kind, event.target.value))} /></label>
          {selected ? <button className="contract-basis-remove" type="button" disabled={disabled || uploading !== ""} onClick={() => onChange(withOwnerContractBasisFile(fields, kind, null))}>Remove From This Contract Revision</button> : null}
        </article>;
      })}
    </div>
    <footer>The listed PDFs are incorporated as contract-basis documents, subject to the Contract’s existing order-of-precedence terms. Any conflict must be resolved through a written contract change.</footer>
  </section>;
}

function rankFiles(files: OwnerContractBasisFile[], kind: OwnerContractBasisKind) {
  const pattern = kind === "scope" ? /scope|proposal|exhibit\s*a|work description/i : /drawing|plans?|sheets?|blueprint/i;
  return [...files].sort((left, right) => Number(pattern.test(`${right.name} ${right.category}`)) - Number(pattern.test(`${left.name} ${left.category}`)) || right.id - left.id);
}

async function uploadBasisPdf(
  file: File,
  projectId: string,
  category: string,
  revision: string,
  reportProgress: (percent: number) => void,
) {
  const access = "Contract Team · Contract Basis Pending Release";
  if (file.size <= DIRECT_UPLOAD_BYTES) {
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", projectId);
    form.set("category", category);
    form.set("revision", revision);
    form.set("access", access);
    const response = await fetch("/api/files", { method: "POST", body: form });
    const result = await response.json() as { file?: OwnerContractBasisFile; error?: string };
    if (!response.ok || !result.file) throw new Error(result.error || `${file.name} Could Not Be Uploaded.`);
    reportProgress(100);
    return result.file;
  }

  let storageKey = "";
  let uploadId = "";
  try {
    const createResponse = await fetch("/api/files/multipart?action=create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: file.name, category, revision, access, contentType: "application/pdf", sizeBytes: file.size }),
    });
    const created = await createResponse.json() as { storageKey?: string; uploadId?: string; partSize?: number; error?: string };
    if (!createResponse.ok || !created.storageKey || !created.uploadId) throw new Error(created.error || `${file.name} Could Not Begin Uploading.`);
    storageKey = created.storageKey;
    uploadId = created.uploadId;
    const partSize = Math.min(DIRECT_UPLOAD_BYTES, Math.max(5 * 1024 * 1024, Number(created.partSize) || DIRECT_UPLOAD_BYTES));
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / partSize);
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const search = new URLSearchParams({ projectId, storageKey, uploadId, partNumber: String(partNumber) });
      const response = await fetch(`/api/files/multipart?${search}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(index * partSize, Math.min((index + 1) * partSize, file.size)) });
      const result = await response.json() as { partNumber?: number; etag?: string; error?: string };
      if (!response.ok || !result.partNumber || !result.etag) throw new Error(result.error || `${file.name} Stopped While Uploading.`);
      parts.push({ partNumber: result.partNumber, etag: result.etag });
      reportProgress(Math.round((partNumber / totalParts) * 95));
    }
    const completeResponse = await fetch("/api/files/multipart?action=complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: file.name, category, revision, access, contentType: "application/pdf", sizeBytes: file.size, storageKey, uploadId, parts }),
    });
    const completed = await completeResponse.json() as { file?: OwnerContractBasisFile; error?: string };
    if (!completeResponse.ok || !completed.file) throw new Error(completed.error || `${file.name} Could Not Be Completed.`);
    reportProgress(100);
    return completed.file;
  } catch (error) {
    if (storageKey && uploadId) await fetch("/api/files/multipart", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, storageKey, uploadId }) }).catch(() => undefined);
    throw error;
  }
}
