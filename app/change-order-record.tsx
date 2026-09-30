"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ChangeOrderDocument } from "../lib/change-order-document";

export function ChangeOrderPdfPreview({ document }: { document: ChangeOrderDocument }) {
  const snapshot = JSON.stringify(document);
  const [result, setResult] = useState<{ snapshot: string; url: string; error: string }>({ snapshot: "", url: "", error: "" });
  useEffect(() => {
    let disposed = false, url = "";
    const timer = window.setTimeout(async () => {
      try {
        const savedDocument: ChangeOrderDocument = JSON.parse(snapshot);
        let bytes: Uint8Array;
        if (savedDocument.record.status === "Executed" && savedDocument.data.executedFileId) {
          const response = await fetch(`/api/files?id=${savedDocument.data.executedFileId}`);
          if (!response.ok) throw new Error("The Filed Executed PDF Could Not Be Loaded. Reopen The Record To Retry.");
          bytes = new Uint8Array(await response.arrayBuffer());
        } else {
          const { generateChangeOrderPdf } = await import("../lib/change-order-document");
          bytes = await generateChangeOrderPdf(savedDocument);
        }
        if (disposed) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
        setResult({ snapshot, url, error: "" });
      } catch (error) {
        if (!disposed) setResult({ snapshot, url: "", error: error instanceof Error ? error.message : "The PDF Could Not Be Prepared." });
      }
    }, 350);
    return () => { disposed = true; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [snapshot]);
  const ready = result.snapshot === snapshot && result.url;
  return <section className="co-pdf-preview" aria-label="Change Order PDF Preview">
    <header><strong>Print Preview</strong><div>{ready ? <><a className="secondary-action" href={result.url} target="_blank" rel="noreferrer">Open / Print PDF</a><a className="secondary-action" href={result.url} download={`${document.record.id}.pdf`}>Download PDF</a></> : <span role="status">{result.error || "Preparing PDF…"}</span>}</div></header>
    {ready ? <iframe src={`${result.url}#toolbar=0&navpanes=0&view=FitH`} title={`${document.record.id} Printable Change Order`} /> : <div className="co-pdf-loading" role="status">{result.snapshot === snapshot ? result.error || "Updating Print Preview…" : "Updating Print Preview…"}</div>}
  </section>;
}

export function ChangeOrderPanel({ title, context, tabs = [], tab = 0, onTab, onClose, busy, notice, document, children, actions }: {
  title: string; context: string; tabs?: string[]; tab?: number; onTab?: (tab: number) => void;
  onClose: () => void; busy: boolean; notice?: string; document: ChangeOrderDocument;
  children: ReactNode; actions?: ReactNode;
}) {
  const [previewVisible, setPreviewVisible] = useState(false);
  return <section className="change-order-record" aria-label="Change Order Record">
    <header className="change-order-record-heading"><div><span>{context}</span><h2>{title}</h2></div><div><button className="secondary-action" onClick={() => setPreviewVisible(value => !value)}>{previewVisible ? "Close Print Preview" : "Print Change Order"}</button><button className="secondary-action" disabled={busy} onClick={onClose}>Back To Change Orders</button></div></header>
    {tabs.length ? <nav aria-label="Change Order Sections">{tabs.map((label, index) => <button key={label} aria-pressed={index === tab} disabled={busy} onClick={() => { onTab?.(index); setPreviewVisible(false); }}>{label}</button>)}</nav> : null}
    {notice ? <div className="change-record-notice" role="status">{notice}</div> : null}
    {previewVisible ? <ChangeOrderPdfPreview document={document} /> : null}
    <div className="change-record-content" aria-label={tabs[tab] || "PCO Details"}>{children}{actions ? <footer className="change-record-actions">{actions}</footer> : null}</div>
  </section>;
}

export function ChangeOrderScheduleFields({ days, onDaysChange, currentSubstantial, currentFinal, revisedSubstantial, revisedFinal, readOnly = false }: {
  days: number; onDaysChange?: (value: number) => void; currentSubstantial: string; currentFinal: string;
  revisedSubstantial: string; revisedFinal: string; readOnly?: boolean;
}) {
  const date = (value: string) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Not Set";
  return <section className="co-time-fields"><label className="field-label">Days To Add (Calendar Days)<input type="number" inputMode="numeric" min="0" max="36500" step="1" value={days} readOnly={readOnly} onChange={event => onDaysChange?.(Number(event.target.value))} /></label>
    <div className="co-date-comparison"><span>Completion</span><span>Current</span><span>After Approval</span><strong>Substantial</strong><span>{date(currentSubstantial)}</span><strong>{date(revisedSubstantial)}</strong><strong>Final</strong><span>{date(currentFinal)}</span><strong>{date(revisedFinal)}</strong></div>
    {!readOnly ? <small>Both Dates Update After The Project Owner Signs And The Change Order Is Executed.</small> : null}
  </section>;
}
