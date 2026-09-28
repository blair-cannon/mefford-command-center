"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { CHANGE_FILE_CATEGORIES, type ChangeFileCase, type ChangeFileEntry } from "../lib/change-order-file";

const date = (value: string) => {
  const parsed = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};
const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
function filingId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function Snapshot({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span>—</span>;
  if (typeof value !== "object") return <span className="change-file-text">{String(value)}</span>;
  if (Array.isArray(value)) return <ol className="change-file-snapshot-list">{value.map((item, index) => <li key={index}><Snapshot value={item} /></li>)}</ol>;
  return <dl className="change-file-snapshot">{Object.entries(value).filter(([key]) => !/token|storageKey|dataJson/i.test(key)).map(([key, item]) => <div key={key}><dt>{label(key)}</dt><dd>{typeof item === "object" && item ? <details><summary>View {label(key)}</summary><Snapshot value={item} /></details> : <Snapshot value={item} />}</dd></div>)}</dl>;
}

function Entry({ entry }: { entry: ChangeFileEntry }) {
  return <article className="change-file-entry">
    <div className="change-file-entry-heading"><strong>{entry.title}</strong><span>{entry.recordId}</span></div>
    <small>{entry.kind === "Revision" ? "Saved" : "Filed"} {date(entry.createdAt)} · {entry.actorName}{entry.actorEmail ? ` · ${entry.actorEmail}` : ""}</small>
    {entry.note ? <p className="change-file-text">{entry.note}</p> : null}
    {entry.snapshot.revision ? <small>Document Reference: {String(entry.snapshot.revision)}</small> : null}
    {entry.snapshot.files?.map(file => file.available === false ? <div key={file.id} className="change-file-document"><strong>{file.name}</strong><span>{file.revision} · {file.uploadedBy} · {date(file.createdAt)}</span><span>Original File Unavailable</span></div> : <a key={file.id} href={`/api/files?id=${file.id}`} target="_blank" rel="noreferrer" className="change-file-document"><strong>{file.name}</strong><span>{file.revision} · {file.uploadedBy} · {date(file.createdAt)}</span><span>Open File ↗</span></a>)}
    {entry.snapshot.source ? <details><summary>Saved Source Details</summary><Snapshot value={entry.snapshot.source} /></details> : null}
    {entry.kind === "Revision" || entry.kind === "Audit" ? <details><summary>Review Saved Change</summary><Snapshot value={entry.snapshot} /></details> : null}
  </article>;
}

export function ChangeOrderFile({ projectId, recordId, refreshKey, upload, onDirtyChange }: {
  projectId: string; recordId: string; refreshKey: string;
  upload: (file: File, category: string, revision: string, access: string) => Promise<{ id?: number }>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<ChangeFileCase | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("Upload Files");
  const [category, setCategory] = useState<string>("Requests");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [fileId, setFileId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All Sections");
  const [queued, setQueued] = useState<Array<{ id: string; file: File }>>([]);
  const [inputKey, setInputKey] = useState(0);
  const uploaded = useRef(new Map<string, { id: number }>());
  const requestId = useRef("");
  const dirty = Boolean(title || note || revision || sourceId || fileId || queued.length);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const load = useCallback(async () => {
    const response = await fetch(`/api/change-order-files?projectId=${encodeURIComponent(projectId)}&recordId=${encodeURIComponent(recordId)}`, { cache: "no-store" });
    const result = await response.json() as ChangeFileCase & { error?: string };
    if (!response.ok) throw new Error(result.error || "The Change File Could Not Be Loaded");
    return result;
  }, [projectId, recordId]);
  useEffect(() => { let active = true; void load().then(result => { if (active) setData(result); }).catch(error => { if (active) setNotice(error.message); }); return () => { active = false; }; }, [load, refreshKey]);

  async function fileItem(item: Record<string, unknown>) {
    const response = await fetch("/api/change-order-files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, recordId, category, title, note, revision, ...item }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "The Item Could Not Be Filed");
  }
  async function save() {
    if (!data) return;
    setBusy(true); setNotice("");
    try {
      if (mode === "Upload Files") {
        if (!queued.length) throw new Error("Choose At Least One File");
        for (const item of queued) {
          let stored = uploaded.current.get(item.id);
          if (!stored) {
            const result = await upload(item.file, `Change Orders / ${data.rootId} / ${category}`, `${data.rootId} · ${revision || "Original"}`, ["Pricing", "Approvals", "Executed Documents"].includes(category) ? "Project Manager + Office" : "Project Team");
            if (!result.id) throw new Error("The Upload Did Not Return A Saved File. Retry Filing.");
            stored = { id: result.id };
            uploaded.current.set(item.id, stored);
          }
          await fileItem({ id: item.id, kind: "File", fileId: stored.id });
          setQueued(current => current.filter(candidate => candidate.id !== item.id));
        }
      } else {
        requestId.current ||= filingId();
        await fileItem({ id: requestId.current, kind: mode === "Link Project File" ? "File" : mode === "Link RFI / Submittal" ? "Record" : "Note", fileId: Number(fileId), sourceId });
      }
      setTitle(""); setNote(""); setRevision(""); setSourceId(""); setFileId(""); setInputKey(value => value + 1); requestId.current = "";
      setData(await load()); setNotice("Saved To The Change File.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Item Could Not Be Filed"); }
    finally { setBusy(false); }
  }
  const matching = (entry: ChangeFileEntry) => `${entry.title} ${entry.note} ${entry.recordId} ${entry.actorName} ${entry.snapshot.files?.map(file => `${file.name} ${file.revision}`).join(" ") || ""}`.toLowerCase().includes(query.toLowerCase());
  const history = (data?.entries || []).filter(entry => entry.category === "History");
  const fileOptions = (data?.files || []).filter(file => `${file.name} ${file.category} ${file.revision}`.toLowerCase().includes(query.toLowerCase()));
  const visibleEntries = (data?.entries || []).filter(entry => entry.category !== "History" && matching(entry));
  return <section className="change-file" aria-label="Change File">
    <header className="change-file-heading"><div><h3>{data?.rootId || recordId} · Change File</h3><span>{data?.records.map(record => `${record.id} · ${record.status}`).join(" / ")}</span></div><button className="secondary-action" disabled={busy} onClick={() => { setNotice(""); void load().then(setData).catch(error => setNotice(error.message)); }}>Refresh File</button></header>
    {notice ? <p role="status" className="change-file-notice">{notice}</p> : null}
    {!data ? <p>Loading Change File…</p> : <>
      <details className="change-file-add" open><summary>Add To Change File</summary><fieldset disabled={busy}>
        <div className="field-grid"><label className="field-label">Add<select value={mode} onChange={event => { setMode(event.target.value); requestId.current = ""; }}>{["Upload Files", "Link Project File", "Link RFI / Submittal", "Record Request Or Note"].map(value => <option key={value}>{value}</option>)}</select></label><label className="field-label">File Section<select value={category} onChange={event => { setCategory(event.target.value); requestId.current = ""; }}>{CHANGE_FILE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label></div>
        {mode === "Upload Files" ? <label className="field-label">Supporting Files<input key={inputKey} type="file" multiple onChange={event => setQueued(Array.from(event.target.files || []).map(file => ({ file, id: filingId() })))} />{queued.map(item => <span key={item.id}>{item.file.name}</span>)}</label> : null}
        {mode === "Link Project File" ? <label className="field-label">Project File<select value={fileId} onChange={event => { setFileId(event.target.value); requestId.current = ""; }}><option value="">Select A Project File</option>{fileOptions.map(file => <option key={file.id} value={file.id}>{file.name} · {file.revision} · {file.category}</option>)}</select></label> : null}
        {mode === "Link RFI / Submittal" ? <label className="field-label">Source Record<select value={sourceId} onChange={event => { setSourceId(event.target.value); setCategory("RFIs & Submittals"); requestId.current = ""; }}><option value="">Select A Source</option>{data.sources.map(source => <option key={source.id} value={source.id}>{source.id} · {source.title} · {source.status}</option>)}</select><small>Saves The Current Response And Supporting Files. Add A New Snapshot When The Source Changes.</small></label> : null}
        <div className="field-grid"><label className="field-label">{mode === "Record Request Or Note" ? "Request / Note Title" : "Title (Optional)"}<input maxLength={300} value={title} onChange={event => { setTitle(event.target.value); requestId.current = ""; }} /></label>{mode === "Upload Files" || mode === "Link Project File" ? <label className="field-label">Drawing / Document Revision<input value={revision} onChange={event => { setRevision(event.target.value); requestId.current = ""; }} placeholder="Sheet A2.1 · Rev 2" /></label> : null}</div>
        <label className="field-label">{mode === "Record Request Or Note" ? "Request Details / Correspondence" : "Reason / Source / Notes"}<textarea rows={3} maxLength={20000} value={note} onChange={event => { setNote(event.target.value); requestId.current = ""; }} /></label>
        <button className="primary-action" disabled={busy} onClick={save}>{busy ? "Filing…" : "Save To Change File"}</button>
      </fieldset></details>
      <div className="change-file-filters"><label className="field-label">Search Change File<input value={query} onChange={event => setQuery(event.target.value)} placeholder="File, Request, Revision, Or Person" /></label><label className="field-label">Section<select value={filter} onChange={event => setFilter(event.target.value)}><option>All Sections</option>{CHANGE_FILE_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label></div>
      {CHANGE_FILE_CATEGORIES.filter(category => filter === "All Sections" || filter === category).map(category => {
        const entries = visibleEntries.filter(entry => entry.category === category);
        return <details key={category} className="change-file-section" open={entries.length > 0}><summary>{category} <span>{entries.length}</span></summary>{entries.length ? entries.map(entry => <Entry key={entry.id} entry={entry} />) : <p>No Items Filed.</p>}</details>;
      })}
      <details className="change-file-section"><summary>Audit History <span>{history.length}</span></summary>{history.length ? [...history].reverse().map(entry => <Entry key={entry.id} entry={entry} />) : <p>No Saved Revisions Yet.</p>}</details>
    </>}
  </section>;
}
