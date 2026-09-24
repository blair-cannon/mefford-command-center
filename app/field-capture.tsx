"use client";

import { useEffect, useId, useRef, useState } from "react";
import { appendFieldPhotos } from "../lib/field-capture";
import { PHOTO_UPLOAD_ACCEPT } from "../lib/photo-uploads";

export type FieldContext = { employees: string[]; employeeDirectory?: string[]; subcontractors: string[]; previousCrew?: { employees: string[]; subcontractors: string[]; date: string } };
export function useFieldContext(projectId: string, enabled = true) {
  const [context, setContext] = useState<(FieldContext & { projectId: string }) | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !projectId) return;
    const controller = new AbortController();
    void fetch(`/api/field-context?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal }).then(async response => {
      const result = await response.json() as FieldContext & { error?: string };
      if (!response.ok) throw new Error(result.error || "Crew List Could Not Load");
      setContext({ ...result, projectId }); setError("");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [projectId, enabled]);
  return { context: context?.projectId === projectId ? context : null, error };
}

export function FieldPeoplePicker({ title, choices, suggestions = choices, selected, onChange, addLabel = "Add Name", disabled = false }: { title: string; choices: string[]; suggestions?: string[]; selected: string[]; onChange: (names: string[]) => void; addLabel?: string; disabled?: boolean }) {
  const listId = useId();
  const [name, setName] = useState("");
  const all = [...new Set([...choices, ...selected])];
  const add = () => { const value = name.trim(); if (value && !selected.some(item => item.toLowerCase() === value.toLowerCase())) onChange([...selected, value]); setName(""); };
  return <fieldset className="people-fieldset field-people" disabled={disabled}><legend>{title} · {selected.length}</legend><div className="check-grid">{all.map(person => <label key={person}><input type="checkbox" checked={selected.includes(person)} onChange={event => onChange(event.target.checked ? [...selected, person] : selected.filter(item => item !== person))} /><span>{person}</span></label>)}</div><div className="field-add-person"><input aria-label={addLabel} list={listId} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={addLabel} /><datalist id={listId}>{suggestions.map(person => <option key={person} value={person} />)}</datalist><button className="secondary-action" type="button" disabled={!name.trim()} onClick={add}>Add</button></div></fieldset>;
}

function PhotoThumbnail({ file }: { file: File }) {
  const thumbnail = useRef<HTMLImageElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { const url = URL.createObjectURL(file); if (thumbnail.current) thumbnail.current.src = url; return () => URL.revokeObjectURL(url); }, [file]);
  return unavailable ? <span className="field-photo-placeholder">Photo Attached</span> : <img ref={thumbnail} alt={file.name} loading="lazy" onError={() => setUnavailable(true)} />; // eslint-disable-line @next/next/no-img-element
}

export function FieldPhotoCapture({ files, onChange, disabled = false, onMarkup, label = "Jobsite Photos", progress }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean; onMarkup?: (file: File) => void; label?: string; progress?: { uploaded: number; processed: number; total: number } | null }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const current = useRef(files);
  useEffect(() => { current.current = files; }, [files]);
  const [visible, setVisible] = useState(12);
  const [error, setError] = useState("");
  const id = useId();
  function add(input: HTMLInputElement) {
    const selected = Array.from(input.files || []);
    const oversized = selected.filter(file => file.size > 25 * 1024 * 1024);
    setError(oversized.length ? `Each Photo Must Be 25 MB Or Smaller: ${oversized.map(file => file.name).join(", ")}` : "");
    // No count cap. Only the thumbnail window is paged; all originals are kept.
    const next = appendFieldPhotos(current.current, selected.filter(file => file.size <= 25 * 1024 * 1024));
    current.current = next; onChange(next); input.value = "";
  }
  return <section className="field-photo-capture" aria-labelledby={id}><div className="field-section-heading"><h3 id={id}>{label}</h3><span role="status">{files.length} Attached</span></div><div className="field-photo-actions"><button type="button" className="primary-action" disabled={disabled} onClick={() => camera.current?.click()}>Take Photo</button></div><input ref={camera} className="field-file-input" tabIndex={-1} data-field-camera type="file" aria-label={`Take ${label}`} accept={PHOTO_UPLOAD_ACCEPT} capture="environment" disabled={disabled} onChange={event => add(event.currentTarget)} /><label className="field-photo-dropzone"><strong>Choose Photos</strong><input ref={library} className="field-file-input" tabIndex={-1} type="file" aria-label={`Choose ${label}`} accept={PHOTO_UPLOAD_ACCEPT} multiple disabled={disabled} onChange={event => add(event.currentTarget)} /></label>{error ? <p className="field-error" role="alert">{error}</p> : null}{progress ? <div className="field-upload-progress" role="status"><progress max={progress.total} value={progress.processed} /><span>{progress.uploaded} Of {progress.total} Photos Uploaded</span></div> : null}<div className="field-photo-grid">{files.slice(0, visible).map(file => <article key={file.name}><PhotoThumbnail file={file} /><span className="field-photo-name">{file.name}</span><div>{onMarkup ? <button className="secondary-action" type="button" disabled={disabled} onClick={() => onMarkup(file)}>Markup / Pair</button> : null}<button className="secondary-action" type="button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => onChange(files.filter(item => item !== file))}>Remove</button></div></article>)}</div>{files.length > visible ? <button type="button" className="secondary-action field-show-photos" onClick={() => setVisible(count => count + 24)}>Show More Photos · {files.length - visible} Remaining</button> : null}</section>;
}

export function StoredFieldPhotos({ files: inputFiles }: { files: Array<{ id?: number; name: string; createdAt?: string; revision: string }> }) {
  const files = inputFiles.filter(file => typeof file.id === "number");
  const [visible, setVisible] = useState(12);
  if (!files.length) return null;
  return <section className="field-stored-photos"><h3>Saved Photos · {files.length}</h3><div className="field-photo-grid">{files.slice(0, visible).map(file => <article key={file.id}><a href={`/api/files?id=${file.id}`} target="_blank" rel="noopener noreferrer">{file.name} ↗</a><small>{file.revision} · {file.createdAt ? new Date(file.createdAt).toLocaleDateString() : ""}</small></article>)}</div>{files.length > visible ? <button className="secondary-action field-show-photos" type="button" onClick={() => setVisible(count => count + 24)}>Show More Photos · {files.length - visible} Remaining</button> : null}</section>;
}
