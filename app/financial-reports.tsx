"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  FINANCIAL_COMPARISONS,
  FINANCIAL_REPORT_LABELS,
  FINANCIAL_REPORT_TYPES,
  type FinancialComparison,
  type FinancialReportType,
} from "../lib/financial-reports";
import type { AccountingActor } from "./accounting-erp";
import { summaryDrilldownProps } from "./summary-drilldown";

type ReportFormat = "text" | "money" | "percent" | "days";
type ReportRow = { id: string; label: string; project: string; status: string; cells: Array<string | number>; sourceType: string; sourceId: string; detail: string };
type ReportSection = { type: FinancialReportType; title: string; description: string; columns: string[]; formats: ReportFormat[]; rows: ReportRow[]; totals: Array<string | number> };
type ReportSnapshot = {
  generatedAt: string;
  asOf: string;
  projectFilter: string;
  projects: Array<{ number: string; name: string; status: string }>;
  summary: { currentContracts: number; recognizedRevenue: number; paidCost: number; openAp: number; accountsReceivable: number; projectedProfit: number; backlog: number };
  comparisons: Record<FinancialComparison, Record<string, number>>;
  reports: ReportSection[];
  sourceBoundaries: Array<{ status: string; title: string; detail: string }>;
};
type ReportRun = { id: string; title: string; owner: string; status: string; meta: string; recordDate: string; updatedAt: string; data: { selectedReports: FinancialReportType[]; comparisons: FinancialComparison[]; asOf: string; projectId: string; generatedAt: string; generatedBy: string; snapshot: ReportSnapshot } };
type ReportWorkspace = ReportSnapshot & { runs: ReportRun[]; permissions: { canRun: boolean; canSchedule: boolean } };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function cell(value: string | number, format: ReportFormat) {
  if (format === "money") return money.format(Number(value) || 0);
  if (format === "percent") return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  if (format === "days") return `${Number(value) || 0}`;
  return String(value ?? "");
}

function safeFile(value: string) { return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }
function xml(value: unknown) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function html(value: unknown) { return xml(value); }
function excelCell(value: string | number, format: ReportFormat) {
  const numeric = ["money", "percent", "days"].includes(format);
  const style = format === "money" ? ' ss:StyleID="Money"' : "";
  return `<Cell${style}><Data ss:Type="${numeric ? "Number" : "String"}">${xml(value)}</Data></Cell>`;
}

export function FinancialReportsWorkspace({ actor }: { actor: AccountingActor }) {
  const [workspace, setWorkspace] = useState<ReportWorkspace | null>(null);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [projectId, setProjectId] = useState("");
  const [selected, setSelected] = useState<FinancialReportType[]>(["project-financials", "wip", "ap-aging", "ar-aging"]);
  const [comparisons, setComparisons] = useState<FinancialComparison[]>(["Current Month", "Year-To-Date"]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async (nextAsOf: string, nextProject: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ asOf: nextAsOf });
      if (nextProject) query.set("projectId", nextProject);
      const response = await fetch(`/api/financial-reports?${query}`);
      const result = await response.json() as ReportWorkspace & { error?: string };
      if (!response.ok) throw new Error(result.error || "Financial Reports Are Unavailable.");
      setWorkspace(result);
      setSnapshot(result);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Financial Reports Are Unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(today(), ""), 0); return () => window.clearTimeout(timer); }, [load]);

  const visibleReports = useMemo(() => (snapshot?.reports || []).filter((report) => selected.includes(report.type)), [selected, snapshot]);

  function toggleReport(type: FinancialReportType) {
    setSelected((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  function toggleComparison(value: FinancialComparison) {
    setComparisons((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function saveRun() {
    if (!selected.length) { setNotice("Select At Least One Report."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/financial-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-run", asOf, projectId, title, selectedReports: selected, comparisons }) });
      const result = await response.json() as { error?: string; notice?: string; run?: ReportRun };
      if (!response.ok) throw new Error(result.error || "The Report Run Could Not Be Saved.");
      setNotice(result.notice || "Permanent Financial Report Snapshot Saved.");
      setTitle("");
      await load(asOf, projectId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Report Run Could Not Be Saved."); }
    finally { setSaving(false); }
  }

  function openRun(run: ReportRun) {
    if (!run.data?.snapshot) { setNotice("This Saved Run Does Not Contain A Snapshot."); return; }
    setSnapshot(run.data.snapshot);
    setSelected(run.data.selectedReports || run.data.snapshot.reports.map((report) => report.type));
    setComparisons(run.data.comparisons || []);
    setNotice(`Viewing Permanent Snapshot ${run.title} · Run By ${run.data.generatedBy}.`);
    setHistoryOpen(false);
  }

  function exportExcel() {
    if (!snapshot || !visibleReports.length) return;
    const worksheets = visibleReports.map((report) => `<Worksheet ss:Name="${xml(report.title.slice(0, 31))}"><Table><Row>${report.columns.map((column) => excelCell(column, "text")).join("")}</Row>${report.rows.map((row) => `<Row>${row.cells.map((value, index) => excelCell(value, report.formats[index])).join("")}</Row>`).join("")}<Row>${report.totals.map((value, index) => excelCell(value, report.formats[index] === "money" ? "money" : "text")).join("")}</Row></Table></Worksheet>`).join("");
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${xml(`Mefford Financial Reports ${snapshot.asOf}`)}</Title><Author>${xml(actor.name)}</Author></DocumentProperties><Styles><Style ss:ID="Money"><NumberFormat ss:Format="$#,##0.00"/></Style></Styles>${worksheets}</Workbook>`;
    download(new Blob([workbook], { type: "application/vnd.ms-excel" }), `mefford-financial-reports-${safeFile(snapshot.asOf)}.xls`);
    setNotice("Excel Workbook Exported From The Displayed Snapshot.");
  }

  function printPdf() {
    if (!snapshot || !visibleReports.length) return;
    const popup = window.open("", "_blank");
    if (!popup) { setNotice("Allow Pop-Ups To Print Or Save The Report Pack As PDF."); return; }
    popup.opener = null;
    popup.document.write(`<title>Mefford Financial Reports · ${html(snapshot.asOf)}</title><style>body{font:12px Arial;color:#17212b;margin:32px}header{border-bottom:4px solid #ef7b2d;margin-bottom:24px}h1{margin:0 0 6px}h2{margin:28px 0 4px;page-break-after:avoid}p{color:#52606c}table{width:100%;border-collapse:collapse;margin-top:10px;page-break-inside:auto}th,td{border:1px solid #cfd6dc;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#edf1f4}.boundary{border-left:4px solid #ef7b2d;padding:10px;background:#fff6ee}</style><header><p>MEFFORD CONTRACTING · COMMAND CENTER</p><h1>Financial Report Pack</h1><p>As Of ${html(snapshot.asOf)} · ${html(snapshot.projectFilter || "All Projects")} · Generated ${html(snapshot.generatedAt)}</p></header><p class="boundary"><b>Source boundary:</b> Management reports use Command Center operational records. A statutory general-ledger P&amp;L, balance sheet, and tax-basis cash flow are not represented before the accounting connection.</p>${visibleReports.map((report) => `<h2>${html(report.title)}</h2><p>${html(report.description)}</p><table><thead><tr>${report.columns.map((column) => `<th>${html(column)}</th>`).join("")}</tr></thead><tbody>${report.rows.map((row) => `<tr>${row.cells.map((value, index) => `<td>${html(cell(value, report.formats[index]))}</td>`).join("")}</tr>`).join("")}<tr>${report.totals.map((value, index) => `<th>${html(value === "" ? "" : cell(value, report.formats[index]))}</th>`).join("")}</tr></tbody></table>`).join("")}`);
    popup.document.close(); popup.focus(); popup.print();
  }

  const current = snapshot || workspace;
  const reportRows = (types: FinancialReportType[]) => (current?.reports || [])
    .filter((report) => types.includes(report.type))
    .flatMap((report) => report.rows.map((row) => ({
      id: `${report.type}-${row.id}`,
      title: row.label,
      subtitle: `${row.project} · ${report.title}`,
      status: row.status,
      meta: `${row.sourceType} · ${row.sourceId} · ${row.detail}`,
    })));
  if (!current && loading) return <div className="accounting-notice">Loading Permanent Financial Report Builder...</div>;

  return <div className="financial-reports-workspace">
    <section className="financial-report-hero"><div><h1>Financial Reports</h1></div></section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <section className="financial-boundary-grid">{current?.sourceBoundaries.filter((boundary) => boundary.status === "Connection Required").map((boundary) => <article key={boundary.title} className={boundary.status === "Connection Required" ? "blocked" : "ready"}><em>{boundary.status}</em><strong>{boundary.title}</strong><p>{boundary.detail}</p></article>)}</section>
    <section className="financial-builder-controls">
      <div className="financial-control-heading"><div><h2>Report Options</h2></div><button className="secondary-action" onClick={() => setHistoryOpen(true)}>Run History · {workspace?.runs.length || 0}</button></div>
      <div className="financial-filter-row"><label>As-Of Date<input type="date" max={today()} value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All Projects</option>{workspace?.projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}</select></label><label>Snapshot Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Financial Report Pack · ${asOf}`} /></label><button className="secondary-action" disabled={loading || !asOf} onClick={() => void load(asOf, projectId)}>{loading ? "Recalculating..." : "Refresh Preview"}</button></div>
      <div className="financial-selection-grid"><div><strong>Reports</strong><span>Select one any combination or every report.</span><section>{FINANCIAL_REPORT_TYPES.map((type) => <label key={type}><input type="checkbox" checked={selected.includes(type)} onChange={() => toggleReport(type)} />{FINANCIAL_REPORT_LABELS[type]}</label>)}</section></div><div><strong>Comparisons</strong><span>Saved with the run and summarized below.</span><section>{FINANCIAL_COMPARISONS.map((comparison) => <label key={comparison}><input type="checkbox" checked={comparisons.includes(comparison)} onChange={() => toggleComparison(comparison)} />{comparison}</label>)}</section></div></div>
      <div className="financial-run-actions"><button className="secondary-action" disabled={!visibleReports.length} onClick={exportExcel}>Export Excel</button><button className="secondary-action" disabled={!visibleReports.length} onClick={printPdf}>Print / Save PDF</button><button className="primary-action" disabled={saving || !selected.length} onClick={() => void saveRun()}>{saving ? "Saving Permanent Snapshot..." : "Run Report + Save Snapshot"}</button></div>
    </section>
    <section className="financial-summary-grid"><article {...summaryDrilldownProps({ title: "Signed Active Contract Source Records", rows: reportRows(["project-financials"]).filter(row => row.status === "Active") })}><span>SIGNED ACTIVE CONTRACTS</span><strong>{money.format(current?.summary.currentContracts || 0)}</strong><small>Executed Owner Contracts</small></article><article {...summaryDrilldownProps({ title: "Earned Revenue Source Records", rows: reportRows(["management-profitability", "wip"]) })}><span>EARNED REVENUE</span><strong>{money.format(current?.summary.recognizedRevenue || 0)}</strong><small>Management WIP Basis</small></article><article {...summaryDrilldownProps({ title: "Open AP And AR Source Records", rows: reportRows(["ap-aging", "ar-aging"]) })}><span>OPEN AP / AR</span><strong>{money.format(current?.summary.openAp || 0)} / {money.format(current?.summary.accountsReceivable || 0)}</strong><small>Coordinated Current Exposure</small></article><article {...summaryDrilldownProps({ title: "Backlog Source Records", rows: reportRows(["backlog"]) })}><span>BACKLOG</span><strong>{money.format(current?.summary.backlog || 0)}</strong><small>Contract Less Earned Revenue</small></article></section>
    {comparisons.length ? <section className="financial-comparison-strip">{comparisons.map((comparison) => { const values = current?.comparisons[comparison] || {}; return <article key={comparison} {...summaryDrilldownProps({ title: `${comparison} Comparison`, rows: Object.entries(values).map(([key, value]) => ({ id: `${comparison}-${key}`, title: key.replace(/([A-Z])/g, " $1").trim(), value: money.format(value), status: comparison })) })}><span>{comparison}</span>{Object.entries(values).map(([key, value]) => <div key={key}><small>{key.replace(/([A-Z])/g, " $1")}</small><strong>{money.format(value)}</strong></div>)}</article>; })}</section> : null}
    <section className="financial-report-stack">{visibleReports.map((report) => <ReportTable key={report.type} report={report} />)}{!visibleReports.length ? <div className="accounting-empty"><strong>No Reports Selected</strong><span>Select at least one report to build a pack.</span></div> : null}</section>

    {historyOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setHistoryOpen(false)}><section className="record-modal financial-history-modal" role="dialog" aria-modal="true" aria-labelledby="report-history-title"><div className="modal-heading"><div><h2 id="report-history-title">Financial Report Run History</h2></div><button onClick={() => setHistoryOpen(false)}>×</button></div><div className="financial-run-history">{workspace?.runs.map((run) => <article key={run.id}><div><strong>{run.title}</strong><span>{run.recordDate} · {run.owner} · {run.meta}</span><small>{run.id}</small></div><button className="secondary-action" onClick={() => openRun(run)}>Open Snapshot</button></article>)}{!workspace?.runs.length ? <div className="accounting-empty"><strong>No Saved Runs Yet</strong><span>Run the first report pack to create permanent history.</span></div> : null}</div></section></div> : null}
  </div>;
}

function ReportTable({ report }: { report: ReportSection }) {
  return <section className="financial-report-table"><header><div><p className="eyebrow orange-text">{report.type.replaceAll("-", " ").toUpperCase()}</p><h2>{report.title}</h2><span>{report.description}</span></div><em>{report.rows.length} SOURCE ROW{report.rows.length === 1 ? "" : "S"}</em></header><div className="financial-table-scroll"><div className="financial-table" data-reflow-table="" style={{ "--financial-columns": report.columns.length } as CSSProperties}><div className="financial-table-row head" data-reflow-head={report.columns.length >= 10 ? "xl" : report.columns.length >= 7 ? "wide" : report.columns.length >= 5 ? "medium" : "small"}>{report.columns.map((column) => <span key={column}>{column}</span>)}</div>{report.rows.map((row) => <details key={`${report.type}-${row.id}`} className="financial-source-row"><summary className="financial-table-row" data-reflow-row={report.columns.length >= 10 ? "xl" : report.columns.length >= 7 ? "wide" : report.columns.length >= 5 ? "medium" : "small"}>{row.cells.map((value, index) => <span key={`${row.id}-${report.columns[index]}`} data-label={report.columns[index]}>{cell(value, report.formats[index])}</span>)}</summary><div><strong>{row.sourceType} · {row.sourceId}</strong><span>{row.project} · {row.status}</span><p>{row.detail}</p></div></details>)}{report.rows.length ? <div className="financial-table-row total" data-reflow-row={report.columns.length >= 10 ? "xl" : report.columns.length >= 7 ? "wide" : report.columns.length >= 5 ? "medium" : "small"}>{report.totals.map((value, index) => <span key={`${report.type}-total-${index}`} data-label={report.columns[index]}>{index === 0 ? "TOTAL" : value === "" ? "" : cell(value, report.formats[index])}</span>)}</div> : <div className="financial-report-empty">No source records meet this report’s as-of date and project filter.</div>}</div></div></section>;
}

function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
