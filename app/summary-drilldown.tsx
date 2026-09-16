"use client";

import { useEffect, useState, type HTMLAttributes, type KeyboardEvent } from "react";

export type SummaryDrilldownRow = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  value?: string;
  meta?: string;
  onOpen?: () => void;
  openLabel?: string;
};

export type SummaryDrilldownReport = {
  title: string;
  description?: string;
  rows: SummaryDrilldownRow[];
  emptyText?: string;
};

const SUMMARY_DRILLDOWN_EVENT = "mefford:summary-drilldown";

export function openSummaryDrilldown(report: SummaryDrilldownReport) {
  window.dispatchEvent(new CustomEvent<SummaryDrilldownReport>(SUMMARY_DRILLDOWN_EVENT, { detail: report }));
}

export function summaryDrilldownProps(report: SummaryDrilldownReport, className = ""): HTMLAttributes<HTMLElement> & { role: "button"; tabIndex: number; "data-summary-drilldown": string } {
  const open = () => openSummaryDrilldown(report);
  return {
    role: "button",
    tabIndex: 0,
    className: `summary-drilldown-trigger ${className}`.trim(),
    "data-summary-drilldown": report.title,
    "aria-label": `Open ${report.title} report`,
    onClick: open,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
  };
}

export function SummaryDrilldownHost() {
  const [report, setReport] = useState<SummaryDrilldownReport | null>(null);

  useEffect(() => {
    const open = (event: Event) => setReport((event as CustomEvent<SummaryDrilldownReport>).detail);
    window.addEventListener(SUMMARY_DRILLDOWN_EVENT, open);
    return () => window.removeEventListener(SUMMARY_DRILLDOWN_EVENT, open);
  }, []);

  useEffect(() => {
    if (!report) return;
    const close = (event: globalThis.KeyboardEvent) => event.key === "Escape" && setReport(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [report]);

  if (!report) return null;
  return <div className="summary-drilldown-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReport(null)}>
    <section className="summary-drilldown-report" role="dialog" aria-modal="true" aria-labelledby="summary-drilldown-title">
      <header><div><h2 id="summary-drilldown-title">{report.title}</h2>{report.description ? <span>{report.description}</span> : null}</div><div><b>{report.rows.length}</b><button aria-label="Close Report" onClick={() => setReport(null)}>×</button></div></header>
      <div className="summary-drilldown-table">
        {report.rows.map((row) => <article key={row.id}>
          <div><strong>{row.title}</strong>{row.subtitle ? <span>{row.subtitle}</span> : null}{row.meta ? <small>{row.meta}</small> : null}</div>
          {row.status ? <em>{row.status}</em> : null}
          {row.value ? <b>{row.value}</b> : null}
          {row.onOpen ? <button onClick={() => { setReport(null); row.onOpen?.(); }}>{row.openLabel || "Open →"}</button> : null}
        </article>)}
        {!report.rows.length ? <div className="summary-drilldown-empty">{report.emptyText || "No records currently match this summary."}</div> : null}
      </div>
    </section>
  </div>;
}
