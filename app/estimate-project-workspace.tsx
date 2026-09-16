"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROCUREMENT_FILE_CATEGORY } from "../lib/procurement";
import { EstimateEditor } from "./estimate-editor";
import { OwnerProposalStudio } from "./owner-proposal-studio";
import { PreAwardOwnerContractStudio } from "./preaward-owner-contract-studio";
import { calculateEstimateSummary } from "./estimate-template";
import { summaryDrilldownProps } from "./summary-drilldown";
import { ProcurementWorkspace } from "./procurement-workspace";

type EstimateRecord = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type EstimateActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type EstimateFile = {
  id: number;
  name: string;
  category: string;
  revision: string;
  uploadedBy: string;
  contentType: string;
  date: string;
  size: string;
  access: string;
};

const DIRECT_UPLOAD_BYTES = 25 * 1024 * 1024;

const estimateFolders = [
  { id: "01-Due Diligence", label: "01-Due Diligence" },
  { id: "02-Design & Drawings", label: "02-Design & Drawings" },
  { id: PROCUREMENT_FILE_CATEGORY, label: "03-Estimating · Quotes", quotes: true },
  { id: "04-Estimating - Cap Sheet", label: "04-Estimating - Cap Sheet", estimate: true },
  { id: "05-Owner Proposal & LOE", label: "05-Owner Proposal & LOE", proposal: true },
  { id: "06-Builders Risk & Bond Request", label: "06-Builders Risk & Bond Request" },
  { id: "07-Contract", label: "07-Contract", contract: true },
  { id: "08-Permits", label: "08-Permits" },
  { id: "09-Legal", label: "09-Legal" },
  { id: "10-Post-Construction", label: "10-Post-Construction" },
] as const;

const legacyEstimateFolderAliases: Record<string, string> = {
  "03-Estimating - Cap Sheet": "04-Estimating - Cap Sheet",
  "04-Owner Proposal & LOE": "05-Owner Proposal & LOE",
  "04-Builders Risk & Bond Request": "06-Builders Risk & Bond Request",
  "05-Contract": "07-Contract",
  "06-Permits": "08-Permits",
  "07-Legal": "09-Legal",
  "08-Post-Construction": "10-Post-Construction",
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function estimateValue(record: EstimateRecord) {
  return record.data?.estimate
    ? calculateEstimateSummary(record.data.estimate).contractValue
    : Number(record.data?.estimatedValue ?? 0);
}

async function uploadEstimateFile(
  file: File,
  projectId: string,
  category: string,
  reportProgress: (percent: number) => void,
) {
  if (file.size <= DIRECT_UPLOAD_BYTES) {
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", projectId);
    form.set("category", category);
    form.set("revision", "Estimating Workspace Upload");
    form.set("access", "Internal Estimating Team");
    const response = await fetch("/api/files", { method: "POST", body: form });
    const result = (await response.json()) as { file?: EstimateFile; error?: string };
    if (!response.ok || !result.file) {
      throw new Error(result.error || `${file.name} Could Not Be Uploaded.`);
    }
    reportProgress(100);
    return result.file;
  }

  let storageKey = "";
  let uploadId = "";
  try {
    const createResponse = await fetch("/api/files/multipart?action=create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: file.name,
        category,
        revision: "Estimating Workspace Upload",
        access: "Internal Estimating Team",
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    const created = (await createResponse.json()) as {
      storageKey?: string;
      uploadId?: string;
      partSize?: number;
      error?: string;
    };
    if (!createResponse.ok || !created.storageKey || !created.uploadId) {
      throw new Error(created.error || `${file.name} Could Not Begin Uploading.`);
    }
    storageKey = created.storageKey;
    uploadId = created.uploadId;
    const partSize = Math.min(
      DIRECT_UPLOAD_BYTES,
      Math.max(5 * 1024 * 1024, Number(created.partSize) || DIRECT_UPLOAD_BYTES),
    );
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / partSize);
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const search = new URLSearchParams({
        projectId,
        storageKey,
        uploadId,
        partNumber: String(partNumber),
      });
      const response = await fetch(`/api/files/multipart?${search}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(index * partSize, Math.min((index + 1) * partSize, file.size)),
      });
      const result = (await response.json()) as {
        partNumber?: number;
        etag?: string;
        error?: string;
      };
      if (!response.ok || !result.partNumber || !result.etag) {
        throw new Error(result.error || `${file.name} Stopped While Uploading.`);
      }
      parts.push({ partNumber: result.partNumber, etag: result.etag });
      reportProgress(Math.round((partNumber / totalParts) * 95));
    }
    const completeResponse = await fetch("/api/files/multipart?action=complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: file.name,
        category,
        revision: "Estimating Workspace Upload",
        access: "Internal Estimating Team",
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storageKey,
        uploadId,
        parts,
      }),
    });
    const completed = (await completeResponse.json()) as {
      file?: EstimateFile;
      error?: string;
    };
    if (!completeResponse.ok || !completed.file) {
      throw new Error(completed.error || `${file.name} Could Not Be Completed.`);
    }
    reportProgress(100);
    return completed.file;
  } catch (error) {
    if (storageKey && uploadId) {
      await fetch("/api/files/multipart", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, storageKey, uploadId }),
      }).catch(() => undefined);
    }
    throw error;
  }
}

export function EstimateProjectWorkspace({
  record,
  actor,
  onClose,
  onRecordSaved,
  onProjectCreated,
}: {
  record: EstimateRecord;
  actor: EstimateActor;
  onClose: () => void;
  onRecordSaved: (record: EstimateRecord) => void;
  onProjectCreated?: (projectNumber: string) => void;
}) {
  const storageProjectId = `ESTIMATE-${record.id}`;
  const [files, setFiles] = useState<EstimateFile[]>([]);
  const [openFolders, setOpenFolders] = useState<string[]>([PROCUREMENT_FILE_CATEGORY, "04-Estimating - Cap Sheet", "05-Owner Proposal & LOE"]);
  const [dragFolder, setDragFolder] = useState("");
  const [uploadingFolder, setUploadingFolder] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [bidsOpen, setBidsOpen] = useState(false);
  async function closeBidReview() {
    setBidsOpen(false);
    try {
      const [recordsResponse, filesResponse] = await Promise.all([fetch("/api/records?projectId=MEFFORD-SALES"), fetch(`/api/files?projectId=${encodeURIComponent(storageProjectId)}`)]);
      const records = await recordsResponse.json() as { records?: EstimateRecord[] };
      const refreshed = records.records?.find(item => item.id === record.id);
      if (recordsResponse.ok && refreshed) onRecordSaved(refreshed);
      const stored = await filesResponse.json() as { files?: EstimateFile[] };
      if (filesResponse.ok && stored.files) setFiles(stored.files);
    } catch { setNotice("Quote review is saved. Reopen this workspace to reload its latest estimate and files."); }
  }
  const [proposalOpen, setProposalOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const proposalStatus = String(record.data?.proposalStatus || "Not Created");
  const proposalNextAction = proposalStatus === "Ready For Review"
    ? "Company Owner Review"
    : proposalStatus === "Approved To Send"
      ? "Send To Project Owner"
      : proposalStatus === "Issued"
        ? "Issued"
        : "Build Proposal";

  useEffect(() => {
    let cancelled = false;
    const legacySalesDesignProjectId = `DESIGN-${record.id}`;
    Promise.all([
      fetch(`/api/files?projectId=${encodeURIComponent(storageProjectId)}`),
      fetch(`/api/files?projectId=${encodeURIComponent(legacySalesDesignProjectId)}`),
    ])
      .then(async (responses) => {
        const results = await Promise.all(responses.map(async (response) => {
          const result = (await response.json()) as { files?: EstimateFile[]; error?: string };
          if (!response.ok) throw new Error(result.error || "Estimate Files Are Unavailable.");
          return result.files ?? [];
        }));
        const merged = [
          ...results[0],
          ...results[1].map((file) => ({ ...file, category: "02-Design & Drawings" })),
        ].filter((file, index, all) => all.findIndex((candidate) => candidate.id === file.id) === index);
        if (!cancelled) setFiles(merged);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Estimate Files Are Unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [record.id, storageProjectId]);

  const filesByFolder = useMemo(() => {
    const grouped = new Map<string, EstimateFile[]>();
    for (const folder of estimateFolders) grouped.set(folder.id, []);
    for (const file of files) {
      const sourceCategory = file.category === PROCUREMENT_FILE_CATEGORY || /(?:permanent bid|bid revision|confidential procurement|quote)/i.test(`${file.revision} ${file.access}`)
        ? PROCUREMENT_FILE_CATEGORY
        : file.category;
      const category = legacyEstimateFolderAliases[sourceCategory] ?? sourceCategory;
      grouped.set(category, [...(grouped.get(category) ?? []), file]);
    }
    return grouped;
  }, [files]);

  async function addFiles(folderId: string, selected: FileList | File[]) {
    const selectedFiles = Array.from(selected);
    if (!selectedFiles.length || uploadingFolder) return;
    setUploadingFolder(folderId);
    setUploadProgress(0);
    const uploaded: EstimateFile[] = [];
    try {
      for (const file of selectedFiles) {
        uploaded.push(
          await uploadEstimateFile(file, storageProjectId, folderId, setUploadProgress),
        );
      }
      setFiles((current) => [...uploaded.reverse(), ...current]);
      setNotice(
        `${selectedFiles.length} File${selectedFiles.length === 1 ? "" : "s"} Added To ${folderId}!`,
      );
      setOpenFolders((current) =>
        current.includes(folderId) ? current : [...current, folderId],
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The File Upload Could Not Be Completed.");
    } finally {
      setUploadingFolder("");
      setUploadProgress(0);
    }
  }

  return (
    <div className="estimate-workspace-layer" role="dialog" aria-modal="true" aria-label={`${record.title} Estimate Workspace`}>
      <section className="estimate-workspace-shell">
        <header className="estimate-workspace-header">
          <div>
            <button onClick={onClose}>Estimating</button>
            <span>›</span>
            <strong>{record.title}</strong>
            <p>{String(record.data?.company || "Direct Estimate")} · {String(record.data?.projectLocation || "Location Pending")}</p>
          </div>
          <button className="estimate-workspace-close" aria-label="Close Estimate Workspace" onClick={onClose}>×</button>
        </header>

        {notice ? <button className="sales-notice estimate-workspace-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}

        <div className="estimate-workspace-intro">
          <div>

            <h1>{record.title}</h1>

          </div>
          <div className="estimate-workspace-stats">
            <span {...summaryDrilldownProps({ title: "Estimate Status", rows: [{ id: record.id, title: record.title, subtitle: record.meta, status: String(record.data?.estimateStatus || "Not Started"), value: money(estimateValue(record)) }] })}><small>Estimate Status</small><strong>{String(record.data?.estimateStatus || "Not Started")}</strong></span>
            <span {...summaryDrilldownProps({ title: "Current Estimate", rows: record.data?.estimate ? calculateEstimateSummary(record.data.estimate).budgetRollups.map((rollup) => ({ id: rollup.code, title: rollup.description, subtitle: rollup.division, value: money(rollup.amount), status: "Estimated" })) : [{ id: record.id, title: record.title, value: money(estimateValue(record)), status: String(record.data?.estimateStatus || "Not Started") }] })}><small>Current Estimate</small><strong>{money(estimateValue(record))}</strong></span>
            <span><small>Proposal Status</small><strong>{proposalStatus}</strong></span>
            <span {...summaryDrilldownProps({ title: "Stored Estimate Files", rows: files.map((file) => ({ id: String(file.id), title: file.name, subtitle: `${file.category} · ${file.revision}`, status: file.access, meta: `${file.size} · ${file.uploadedBy} · ${file.date}`, onOpen: () => window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer"), openLabel: "Open File ↗" })) })}><small>Stored Files</small><strong>{files.length}</strong></span>
          </div>
        </div>

        <div className="estimate-folder-list">
          {estimateFolders.map((folder) => {
            const folderFiles = filesByFolder.get(folder.id) ?? [];
            const isOpen = openFolders.includes(folder.id);
            const isUploading = uploadingFolder === folder.id;
            const liveItemCount = ("estimate" in folder && folder.estimate ? 1 : 0) + ("proposal" in folder && folder.proposal ? 2 : 0) + ("contract" in folder && folder.contract ? 1 : 0);
            return (
              <section className={`estimate-folder ${isOpen ? "open" : ""}`} key={folder.id}>
                <button
                  className="estimate-folder-row"
                  onClick={() =>
                    setOpenFolders((current) =>
                      current.includes(folder.id)
                        ? current.filter((item) => item !== folder.id)
                        : [...current, folder.id],
                    )
                  }
                >
                  <span className="folder-chevron">›</span>
                  <span className="estimate-folder-icon" aria-hidden="true" />
                  <strong>{folder.label}</strong>
                  <small>{folderFiles.length + liveItemCount} Item{folderFiles.length + liveItemCount === 1 ? "" : "s"}</small>
                  <span className="folder-open-label">{isOpen ? "Close Folder" : "Open Folder"}</span>
                </button>

                {isOpen ? (
                  <div className="estimate-folder-contents">
                    {"estimate" in folder && folder.estimate ? (
                      <article className="live-estimate-file">
                        <span className="live-estimate-icon">EST</span>
                        <div><strong>Live Mefford Estimate</strong></div>
                        <span><small>Status</small><strong>{String(record.data?.estimateStatus || "Not Started")}</strong></span>
                        <span><small>Current Value</small><strong>{money(estimateValue(record))}</strong></span>
                        <button onClick={() => setEstimateOpen(true)}>Open Estimate →</button>
                      </article>
                    ) : null}

                    {"proposal" in folder && folder.proposal ? (
                      <article className="live-estimate-file live-proposal-file">
                        <span className="live-estimate-icon">OWN</span>
                        <div><strong>Project Owner Proposal Studio</strong></div>
                        <span><small>Status</small><strong>{proposalStatus}</strong></span>
                        <span><small>Next Action</small><strong>{proposalNextAction}</strong></span>
                        <button onClick={() => setProposalOpen(true)}>{proposalStatus === "Ready For Review" && actor.accessLevel === "Company Owner" ? "Review Proposal →" : proposalStatus === "Approved To Send" ? "Send To Project Owner →" : "Open Studio →"}</button>
                      </article>
                    ) : null}

                    {"contract" in folder && folder.contract ? (
                      <article className="live-estimate-file live-contract-file">
                        <span className="live-estimate-icon">CTR</span>
                        <div><strong>Pre-Award Project Owner Contract Draft</strong></div>
                        <span><small>Current Status</small><strong>{String(record.data?.preAwardOwnerContractStatus || "Not Created")}</strong></span>
                        <span><small>External Effect</small><strong>None Before Award</strong></span>
                        <button onClick={() => setContractOpen(true)}>Open Contract Draft →</button>
                      </article>
                    ) : null}

                    {folderFiles.map((file) => (
                      <button className="estimate-uploaded-file" key={file.id} onClick={() => window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer")}>
                        <span>DOC</span>
                        <div><strong>{file.name}</strong><small>{file.size} · Uploaded By {file.uploadedBy} On {file.date}</small></div>
                        <b>Open ↗</b>
                      </button>
                    ))}

                    {"quotes" in folder && folder.quotes ? (
                      <div className="estimate-quotes-rule">
                        <span>OCR</span>
                        <div>
                          <strong>Quotes Enter Through Bid Management</strong>

                        </div>
                        <button className="primary-action" onClick={() => setBidsOpen(true)}>Open Quote Review & Upload</button>
                      </div>
                    ) : <div
                      className={`estimate-folder-drop ${dragFolder === folder.id ? "dragging" : ""}`}
                      onDragEnter={(event) => { event.preventDefault(); setDragFolder(folder.id); }}
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragFolder(""); }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragFolder("");
                        void addFiles(folder.id, event.dataTransfer.files);
                      }}
                      onClick={() => inputRefs.current[folder.id]?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRefs.current[folder.id]?.click(); }}
                    >
                      <input
                        ref={(element) => { inputRefs.current[folder.id] = element; }}
                        type="file"
                        multiple
                        onChange={(event) => {
                          if (event.target.files) void addFiles(folder.id, event.target.files);
                          event.target.value = "";
                        }}
                      />
                      <span>＋</span>
                      <div>
                        <strong>{isUploading ? `Uploading ${uploadProgress}%` : "Drag And Drop Files Here"}</strong>
                        <small>{isUploading ? "Keep This Window Open Until The Upload Finishes." : "Or Click To Choose Files · Individual Files Up To 1 GB"}</small>
                      </div>
                    </div>}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>

      {estimateOpen ? (
        <EstimateEditor
          record={record}
          actor={actor}
          onClose={() => setEstimateOpen(false)}
          onRecordSaved={onRecordSaved}
          onProjectCreated={onProjectCreated}
        />
      ) : null}
      {bidsOpen ? <div className="estimate-bids-layer" role="dialog" aria-modal="true" aria-label={`${record.title} Quote Review`}><header><strong>{record.title} · Quote Review</strong><button onClick={() => void closeBidReview()}>Back To Estimate Files</button></header><ProcurementWorkspace scope="Sales" opportunityId={record.id} actor={actor} onNavigate={() => void closeBidReview()} /></div> : null}
      {proposalOpen ? (
        <OwnerProposalStudio
          opportunity={record}
          actor={actor}
          onClose={() => setProposalOpen(false)}
          onOpportunitySaved={onRecordSaved}
          onPrepareContract={() => { setProposalOpen(false); setContractOpen(true); }}
        />
      ) : null}
      {contractOpen ? (
        <PreAwardOwnerContractStudio
          opportunity={record}
          actor={actor}
          onClose={() => setContractOpen(false)}
          onOpportunitySaved={onRecordSaved}
        />
      ) : null}
    </div>
  );
}
