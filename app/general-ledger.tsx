"use client";

import { useEffect, useMemo, useState } from "react";
import type { LedgerAccount } from "../lib/accounting-catalog";
import { currentAccountNumber } from "../lib/accounting-numbering";
import type { AccountingActor } from "./accounting-erp";
import { CurrencyInput } from "./currency-input";
import { summaryDrilldownProps } from "./summary-drilldown";
import { roundMoney } from "../lib/money";

type StoredRecord = {
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  data: Record<string, unknown>;
  updatedAt: string;
};

type TrialBalanceRow = { accountNumber: string; accountName: string; debit: number; credit: number; netDebit: number; netCredit: number; entryCount: number };
type AccountingPeriod = { id: string; periodStart: string; periodEnd: string; status: "Open" | "Soft Closed" | "Hard Closed"; softClosedBy?: string; softClosedAt?: string; hardClosedBy?: string; hardClosedAt?: string; reopenedBy?: string; reopenedAt?: string; reopenReason?: string; updatedAt?: string };
type LedgerData = { ledgerAccounts: LedgerAccount[]; journalEntries: StoredRecord[]; trialBalance: TrialBalanceRow[]; accountingPeriods: AccountingPeriod[]; projects: Array<{ number: string; name: string; status: string }> };
type JournalLine = { id: string; accountNumber: string; accountName: string; description: string; projectId: string; department: string; debit: string; credit: string };
type JournalDraft = { id: string; entryDate: string; entryType: "Standard" | "Adjusting" | "Reclassification" | "Opening Balance"; reference: string; description: string; supportReference: string; lines: JournalLine[] };

const exactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateInput() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function id() { return globalThis.crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function amount(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function emptyLine(): JournalLine { return { id: id(), accountNumber: "", accountName: "", description: "", projectId: "", department: "", debit: "", credit: "" }; }
function emptyDraft(entryType: JournalDraft["entryType"] = "Standard"): JournalDraft { return { id: "", entryDate: dateInput(), entryType, reference: entryType === "Opening Balance" ? `OPENING-${dateInput()}` : "", description: entryType === "Opening Balance" ? "Opening balances at Command Center cutover" : "", supportReference: "", lines: [emptyLine(), emptyLine()] }; }
function statusClass(value: string) { return value.toLowerCase().replaceAll(" ", "-"); }
function currentPeriod(): AccountingPeriod { const date = dateInput(); const id = date.slice(0, 7); const lastDay = new Date(Number(id.slice(0, 4)), Number(id.slice(5, 7)), 0).getDate(); return { id, periodStart: `${id}-01`, periodEnd: `${id}-${String(lastDay).padStart(2, "0")}`, status: "Open" }; }
function sourceTarget(sourceType: unknown) { const source = String(sourceType || ""); if (source === "AP Invoice") return "Accounts Payable"; if (["Owner Billing", "Owner Receipt"].includes(source)) return "Owner Billing"; if (source.includes("Paylocity")) return "Payroll Reports"; return ""; }

async function accountingAction(body: Record<string, unknown>) {
  const response = await fetch("/api/accounting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { id?: string; error?: string; notice?: string };
  if (!response.ok) throw new Error(result.error || "The General Ledger Action Could Not Be Saved.");
  return result;
}

export function GeneralLedgerWorkspace({ actor, onNavigate }: { actor: AccountingActor; onNavigate?: (target: string) => void }) {
  const [workspace, setWorkspace] = useState<LedgerData | null>(null);
  const accounts = workspace?.ledgerAccounts || [];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"Journal Entries" | "Trial Balance" | "Opening Balances" | "Period Close">("Journal Entries");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<JournalDraft>(() => emptyDraft());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [reopenId, setReopenId] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  async function load() {
    const response = await fetch("/api/accounting");
    const result = await response.json() as LedgerData & { error?: string };
    if (!response.ok) throw new Error(result.error || "The General Ledger Is Unavailable.");
    setWorkspace(result);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounting")
      .then(async (response) => { const result = await response.json() as LedgerData & { error?: string }; if (!response.ok) throw new Error(result.error || "The General Ledger Is Unavailable."); return result; })
      .then((result) => { if (!cancelled) setWorkspace(result); })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "The General Ledger Is Unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const open = () => openNew("Standard");
    window.addEventListener("command:new-journal-entry", open);
    return () => window.removeEventListener("command:new-journal-entry", open);
  });

  const journals = workspace?.journalEntries || [];
  const selected = journals.find((entry) => entry.id === selectedId) || null;
  const filtered = journals.filter((entry) => {
    const matchesStatus = statusFilter === "All Statuses" || entry.status === statusFilter;
    const text = `${entry.id} ${entry.title} ${entry.owner} ${String(entry.data.reference || "")} ${String(entry.data.description || "")}`.toLowerCase();
    return matchesStatus && (!query.trim() || text.includes(query.trim().toLowerCase()));
  });
  const openingEntries = journals.filter((entry) => entry.data.entryType === "Opening Balance");
  const accountingPeriods = workspace?.accountingPeriods?.length ? workspace.accountingPeriods : [currentPeriod()];
  const posted = journals.filter((entry) => entry.status === "Posted");
  const awaiting = journals.filter((entry) => ["Submitted", "Approved"].includes(entry.status));
  const postedDebits = posted.reduce((sum, entry) => sum + amount((entry.data.totals as Record<string, unknown> | undefined)?.debit), 0);
  const trialDifference = (workspace?.trialBalance || []).reduce((sum, row) => sum + row.netDebit - row.netCredit, 0);
  const draftTotals = useMemo(() => ({ debit: draft.lines.reduce((sum, line) => sum + amount(line.debit), 0), credit: draft.lines.reduce((sum, line) => sum + amount(line.credit), 0) }), [draft.lines]);
  const balanced = draftTotals.debit > 0 && Math.abs(draftTotals.debit - draftTotals.credit) <= .01;

  function openNew(entryType: JournalDraft["entryType"] = "Standard") {
    setDraft(emptyDraft(entryType));
    setPasteOpen(false);
    setPasteValue("");
    setEditorOpen(true);
  }

  function editEntry(entry: StoredRecord) {
    const lines = Array.isArray(entry.data.lines) ? entry.data.lines as Array<Record<string, unknown>> : [];
    setDraft({
      id: entry.id,
      entryDate: String(entry.data.entryDate || entry.recordDate || dateInput()),
      entryType: (entry.data.entryType as JournalDraft["entryType"]) || "Standard",
      reference: String(entry.data.reference || ""),
      description: String(entry.data.description || ""),
      supportReference: String(entry.data.supportReference || ""),
      lines: lines.map((line) => ({ id: String(line.id || id()), accountNumber: currentAccountNumber(line.accountNumber), accountName: String(line.accountName || ""), description: String(line.description || ""), projectId: String(line.projectId || ""), department: String(line.department || ""), debit: amount(line.debit) ? String(line.debit) : "", credit: amount(line.credit) ? String(line.credit) : "" })),
    });
    setEditorOpen(true);
  }

  function updateLine(lineId: string, values: Partial<JournalLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id === lineId ? { ...line, ...values } : line) }));
  }

  function selectAccount(lineId: string, accountNumber: string) {
    const account = accounts.find((item) => item.accountNumber === accountNumber);
    updateLine(lineId, { accountNumber, accountName: account?.legacyName || "" });
  }

  function parsePaste() {
    const rows = pasteValue.trim().split(/\r?\n/).filter(Boolean).map((row) => row.split(row.includes("\t") ? "\t" : ",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
    const imported = rows.filter((row, index) => !(index === 0 && /account/i.test(row[0] || ""))).map((row) => {
      const account = accounts.find((item) => item.accountNumber === currentAccountNumber(row[0]));
      return { id: id(), accountNumber: currentAccountNumber(row[0]), accountName: account?.legacyName || "", debit: String(row[1] || "").replace(/[$,]/g, ""), credit: String(row[2] || "").replace(/[$,]/g, ""), description: row[3] || "", projectId: row[4] || "", department: row[5] || "" };
    });
    if (!imported.length) { setNotice("Paste At Least One Spreadsheet Row."); return; }
    setDraft((current) => ({ ...current, lines: imported }));
    setPasteOpen(false);
    setPasteValue("");
    setNotice(`${imported.length} Spreadsheet Line${imported.length === 1 ? "" : "s"} Inserted. Review Account Names And Balance Before Saving.`);
  }

  async function saveDraft(submitAfter = false) {
    setSaving(true); setNotice("");
    try {
      const lines = draft.lines.filter((line) => line.accountNumber || amount(line.debit) || amount(line.credit));
      const result = await accountingAction({ action: "save-journal-entry", journal: { ...draft, lines: lines.map((line) => ({ ...line, debit: roundMoney(amount(line.debit)), credit: roundMoney(amount(line.credit)) })) } });
      if (submitAfter) await accountingAction({ action: "submit-journal-entry", recordId: result.id });
      await load();
      setEditorOpen(false);
      setNotice(submitAfter ? "Balanced Journal Entry Submitted For Independent Approval." : result.notice || "Journal Entry Draft Saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Journal Entry Could Not Be Saved."); }
    finally { setSaving(false); }
  }

  async function transition(action: string, entry: StoredRecord) {
    setSaving(true); setNotice("");
    try { const result = await accountingAction({ action, recordId: entry.id }); await load(); setSelectedId(action === "reverse-journal-entry" ? result.id || "" : entry.id); setNotice(result.notice || "General Ledger Updated."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The General Ledger Could Not Be Updated."); }
    finally { setSaving(false); }
  }

  async function periodAction(periodId: string, status: "Open" | "Soft Closed" | "Hard Closed", reason = "") {
    setSaving(true); setNotice("");
    try {
      const action = status === "Open" ? "reopen-accounting-period" : "close-accounting-period";
      const result = await accountingAction({ action, period: { id: periodId, status, reason } });
      await load();
      setReopenId(""); setReopenReason("");
      setNotice(result.notice || `Accounting Period ${periodId} Updated.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Accounting Period Could Not Be Updated."); }
    finally { setSaving(false); }
  }

  function downloadTrialBalance() {
    const rows = [["Account", "Account Name", "Total Debits", "Total Credits", "Net Debit", "Net Credit"], ...(workspace?.trialBalance || []).map((row) => [row.accountNumber, row.accountName, row.debit.toFixed(2), row.credit.toFixed(2), row.netDebit.toFixed(2), row.netCredit.toFixed(2)])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `mefford-trial-balance-${dateInput()}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  if (!workspace && loading) return <div className="accounting-notice">Loading The General Ledger...</div>;

  return <div className="accounting-workspace general-ledger-workspace">
    <section className="accounting-hero ledger-hero"><div><h1>General Ledger</h1></div><div className="ledger-hero-actions"><button className="secondary-action" onClick={() => openNew("Opening Balance")}>Enter Opening Balances</button><button className="primary-action large" onClick={() => openNew("Standard")}>＋ New Journal Entry</button></div></section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <section className="accounting-summary-grid ledger-summary">
      <article {...summaryDrilldownProps({ title: "Posted Journal Entries", rows: posted.map((entry) => journalSummaryRow(entry, setSelectedId)) })}><span>POSTED ENTRIES</span><strong>{posted.length}</strong><small>Permanent Journal Records</small></article>
      <article {...summaryDrilldownProps({ title: "Journal Entries Awaiting Action", rows: awaiting.map((entry) => journalSummaryRow(entry, setSelectedId)) })}><span>AWAITING ACTION</span><strong>{awaiting.length}</strong><small>Submitted Or Approved</small></article>
      <article {...summaryDrilldownProps({ title: "Posted Debit Contribution", rows: posted.map((entry) => journalSummaryRow(entry, setSelectedId)) })}><span>POSTED DEBITS</span><strong>{exactMoney.format(postedDebits)}</strong><small>Equal Posted Credits</small></article>
      <article {...summaryDrilldownProps({ title: "Trial Balance Difference", rows: (workspace?.trialBalance || []).filter((row) => Math.abs(row.netDebit - row.netCredit) > .01).map((row) => ({ id: row.accountNumber, title: row.accountName, subtitle: `${row.accountNumber} · ${row.entryCount} posted entries`, status: row.netDebit > row.netCredit ? "Net Debit" : "Net Credit", value: exactMoney.format(Math.abs(row.netDebit - row.netCredit)), onOpen: () => setTab("Trial Balance"), openLabel: "Open Trial Balance →" })), emptyText: "The posted trial balance is in balance." }, Math.abs(trialDifference) > .01 ? "ledger-out-of-balance" : "")}><span>TRIAL BALANCE DIFFERENCE</span><strong>{exactMoney.format(trialDifference)}</strong><small>{Math.abs(trialDifference) <= .01 ? "In Balance" : "Immediate Review Required"}</small></article>
    </section>
    <nav className="ledger-tabs" aria-label="General Ledger Views">{(["Journal Entries", "Trial Balance", "Opening Balances", "Period Close"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}{item === "Opening Balances" ? ` · ${openingEntries.length}` : item === "Period Close" ? ` · ${accountingPeriods.filter((period) => period.status !== "Open").length}` : ""}</button>)}</nav>

    {tab === "Journal Entries" ? <section className="accounting-ledger-panel"><div className="accounting-ledger-heading"><div><h2>Journal Register</h2></div><div className="accounting-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Journal Register" aria-label="Search Journal Register" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All Statuses</option><option>Draft</option><option>Submitted</option><option>Approved</option><option>Posted</option></select></div></div><div className="journal-register" data-reflow-table=""><div className="journal-register-row header" data-reflow-head="medium"><span>Date / Entry</span><span>Reference</span><span>Description / Source</span><span>Debit</span><span>Credit</span><span>Status</span></div>{filtered.map((entry) => { const totals = entry.data.totals as Record<string, unknown> | undefined; return <button className="journal-register-row" key={entry.id} onClick={() => setSelectedId(entry.id)} data-reflow-row="medium"><span data-label="Date / Entry"><b>{entry.recordDate}</b><small>{entry.id}</small></span><strong data-label="Reference">{String(entry.data.reference || "")}</strong><span data-label="Description / Source"><b>{String(entry.data.description || entry.title)}</b><small>{String(entry.data.entryType || "Standard")} · {String(entry.data.sourceType || entry.owner)}{entry.data.sourceRecordId ? ` · ${String(entry.data.sourceRecordId)}` : ""}</small></span><strong data-label="Debit">{exactMoney.format(amount(totals?.debit))}</strong><strong data-label="Credit">{exactMoney.format(amount(totals?.credit))}</strong><i className={`account-status ${statusClass(entry.status)}`} data-label="Status">{entry.status}</i></button>; })}</div>{!filtered.length ? <div className="accounting-empty"><strong>No Journal Entries Match This View</strong><span>Create a standard entry or load the controlled opening-balance batch.</span></div> : null}</section> : null}

    {tab === "Trial Balance" ? <section className="accounting-ledger-panel"><div className="accounting-ledger-heading"><div><h2>Posted Trial Balance</h2></div><button className="secondary-action" disabled={!workspace?.trialBalance.length} onClick={downloadTrialBalance}>Export CSV</button></div><div className="trial-balance-table" data-reflow-table=""><div className="trial-balance-row header" data-reflow-head="medium"><span>Account</span><span>Account Name</span><span>Total Debits</span><span>Total Credits</span><span>Net Debit</span><span>Net Credit</span></div>{workspace?.trialBalance.map((row) => <div className="trial-balance-row" key={row.accountNumber} data-reflow-row="medium"><strong data-label="Account">{row.accountNumber}</strong><span data-label="Account Name">{row.accountName}</span><span data-label="Total Debits">{exactMoney.format(row.debit)}</span><span data-label="Total Credits">{exactMoney.format(row.credit)}</span><strong data-label="Net Debit">{row.netDebit ? exactMoney.format(row.netDebit) : "—"}</strong><strong data-label="Net Credit">{row.netCredit ? exactMoney.format(row.netCredit) : "—"}</strong></div>)}</div>{!workspace?.trialBalance.length ? <div className="accounting-empty"><strong>No Posted General Ledger Activity Yet</strong><span>Enter opening balances or post the first independently approved journal entry.</span></div> : null}</section> : null}

    {tab === "Opening Balances" ? <><section className="accounting-ledger-panel"><div className="accounting-ledger-heading"><div><h2>Opening-Balance Batches</h2></div></div><div className="journal-register" data-reflow-table=""><div className="journal-register-row header" data-reflow-head="medium"><span>Cutover Date</span><span>Reference</span><span>Description</span><span>Debit</span><span>Credit</span><span>Status</span></div>{openingEntries.map((entry) => { const totals = entry.data.totals as Record<string, unknown> | undefined; return <button className="journal-register-row" key={entry.id} onClick={() => setSelectedId(entry.id)} data-reflow-row="medium"><span data-label="Cutover Date"><b>{entry.recordDate}</b><small>{entry.id}</small></span><strong data-label="Reference">{String(entry.data.reference || "")}</strong><span data-label="Description"><b>{String(entry.data.description || "")}</b><small>{String(entry.data.supportReference || "Support Pending")}</small></span><strong data-label="Debit">{exactMoney.format(amount(totals?.debit))}</strong><strong data-label="Credit">{exactMoney.format(amount(totals?.credit))}</strong><i className={`account-status ${statusClass(entry.status)}`} data-label="Status">{entry.status}</i></button>; })}</div>{!openingEntries.length ? <div className="accounting-empty"><strong>No Opening Balances Entered</strong><span>Start with the final verified trial balance from the system being replaced.</span></div> : null}</section></> : null}

    {tab === "Period Close" ? <section className="accounting-ledger-panel"><div className="accounting-ledger-heading"><div><h2>Accounting Period Control</h2></div></div><div className="period-close-table" data-reflow-table=""><div className="period-close-row header" data-reflow-head="medium"><span>Period</span><span>Date Range</span><span>Status</span><span>Close / Reopen Evidence</span><span>Actions</span></div>{accountingPeriods.map((period) => <div className="period-close-row" key={period.id} data-reflow-row="medium"><strong data-label="Period">{period.id}</strong><span data-label="Date Range">{period.periodStart} → {period.periodEnd}</span><i className={`account-status ${statusClass(period.status)}`} data-label="Status">{period.status}</i><span data-label="Close / Reopen Evidence"><b>{period.hardClosedBy || period.softClosedBy || period.reopenedBy || "Active Accounting Period"}</b><small>{period.hardClosedAt || period.softClosedAt || period.reopenedAt || "Posting Available"}{period.reopenReason ? ` · ${period.reopenReason}` : ""}</small></span><div data-label="Actions">{period.status === "Open" ? <><button className="secondary-action" disabled={saving} onClick={() => void periodAction(period.id, "Soft Closed")}>Soft Close</button>{actor.accessLevel === "Company Owner" ? <button className="primary-action" disabled={saving} onClick={() => void periodAction(period.id, "Hard Closed")}>Hard Close</button> : null}</> : actor.accessLevel === "Company Owner" ? <button className="secondary-action" disabled={saving} onClick={() => { setReopenId(period.id); setReopenReason(""); }}>Reopen With Reason</button> : <span>Owner Reopen Required</span>}</div></div>)}</div></section> : null}

    {editorOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditorOpen(false)}><section className="record-modal journal-editor-modal" role="dialog" aria-modal="true" aria-labelledby="journal-editor-title"><div className="modal-heading"><div><p className="eyebrow orange-text">{draft.entryType === "Opening Balance" ? "OPENING BALANCE BATCH" : "GENERAL JOURNAL"}</p><h2 id="journal-editor-title">{draft.id ? "Edit Draft Journal Entry" : draft.entryType === "Opening Balance" ? "Enter Starting Balances" : "New Journal Entry"}</h2></div><button onClick={() => setEditorOpen(false)}>×</button></div><div className="journal-header-grid"><label>Entry Date<input type="date" value={draft.entryDate} onChange={(event) => setDraft((current) => ({ ...current, entryDate: event.target.value }))} /></label><label>Entry Type<select value={draft.entryType} onChange={(event) => setDraft((current) => ({ ...current, entryType: event.target.value as JournalDraft["entryType"] }))}><option>Standard</option><option>Adjusting</option><option>Reclassification</option><option>Opening Balance</option></select></label><label>Reference<input value={draft.reference} onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="JE-2026-001" /></label><label className="wide">Description<input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Business purpose of this entry" /></label><label className="wide">Support Reference<input value={draft.supportReference} onChange={(event) => setDraft((current) => ({ ...current, supportReference: event.target.value }))} placeholder="File name, CPA workpaper, bank statement, or source record" /></label></div><div className="journal-editor-toolbar"><div><strong>Journal Lines</strong><span>Select a valid account and enter either a debit or a credit on each row.</span></div><div><button className="secondary-action" onClick={() => setPasteOpen((current) => !current)}>Paste From Spreadsheet</button><button className="secondary-action" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}>＋ Add Line</button></div></div>{pasteOpen ? <div className="journal-paste-panel"><p>Paste columns in this order: Account, Debit, Credit, Description, Project, Department. Tab-separated Excel rows work directly.</p><textarea autoFocus value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder={"Account\tDebit\tCredit\tDescription\tProject\tDepartment\n1000\t25000\t\tOpening cash\t\tOffice"} /><div><button className="secondary-action" onClick={() => setPasteOpen(false)}>Cancel</button><button className="primary-action" onClick={parsePaste}>Insert Rows</button></div></div> : null}<div className="journal-line-table" data-reflow-table=""><div className="journal-line-row header" data-reflow-head="wide"><span>Account</span><span>Line Description</span><span>Project</span><span>Department</span><span>Debit</span><span>Credit</span><span /></div>{draft.lines.map((line, index) => <div className="journal-line-row" key={line.id} data-reflow-row="wide"><label data-label="Account"><span>Account {index + 1}</span><select value={line.accountNumber} onChange={(event) => selectAccount(line.id, event.target.value)}><option value="">Select Account</option>{accounts.filter((account) => account.defaultStatus !== "Inactive").map((account) => <option value={account.accountNumber} key={account.accountNumber}>{account.accountNumber} · {account.legacyName}</option>)}</select></label><label data-label="Line Description"><span>Description</span><input value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></label><label data-label="Project"><span>Project</span><select value={line.projectId} onChange={(event) => updateLine(line.id, { projectId: event.target.value })}><option value="">Company</option>{workspace?.projects.map((project) => <option value={project.number} key={project.number}>{project.number} · {project.name}</option>)}</select></label><label data-label="Department"><span>Department</span><select value={line.department} onChange={(event) => updateLine(line.id, { department: event.target.value })}><option value="">Unassigned</option><option>Office</option><option>Field</option><option>Leadership</option></select></label><label data-label="Debit"><span>Debit</span><CurrencyInput min="0" value={line.debit} onValueChange={(value) => updateLine(line.id, { debit: value, credit: amount(value) ? "" : line.credit })} /></label><label data-label="Credit"><span>Credit</span><CurrencyInput min="0" value={line.credit} onValueChange={(value) => updateLine(line.id, { credit: value, debit: amount(value) ? "" : line.debit })} /></label><button aria-label={`Remove Journal Line ${index + 1}`} disabled={draft.lines.length <= 2} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }))} data-label="Actions">×</button></div>)}</div><div className={`journal-balance-bar ${balanced ? "balanced" : "unbalanced"}`}><span><small>Total Debits</small><strong>{exactMoney.format(draftTotals.debit)}</strong></span><span><small>Total Credits</small><strong>{exactMoney.format(draftTotals.credit)}</strong></span><span><small>Difference</small><strong>{exactMoney.format(draftTotals.debit - draftTotals.credit)}</strong></span><b>{balanced ? "✓ IN BALANCE" : "OUT OF BALANCE"}</b></div><div className="permission-note"><strong>Independent Approval Is Required</strong><span>A different approver must review this entry.</span></div><div className="modal-actions"><button className="secondary-action" onClick={() => setEditorOpen(false)}>Cancel</button><button className="secondary-action" disabled={saving} onClick={() => void saveDraft(false)}>{saving ? "Saving..." : "Save Draft"}</button><button className="primary-action large" disabled={saving || !balanced || !draft.supportReference.trim()} onClick={() => void saveDraft(true)}>{saving ? "Submitting..." : "Save And Submit For Approval"}</button></div></section></div> : null}

    {reopenId ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReopenId("")}><section className="record-modal period-reopen-modal" role="dialog" aria-modal="true" aria-labelledby="period-reopen-title"><div className="modal-heading"><div><h2 id="period-reopen-title">Reopen Accounting Period {reopenId}</h2></div><button onClick={() => setReopenId("")}>×</button></div><label className="field-label">Permanent Reopen Reason<textarea autoFocus rows={4} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Explain the correction or adjustment that requires this period to reopen." /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setReopenId("")}>Cancel</button><button className="primary-action large" disabled={saving || reopenReason.trim().length < 10} onClick={() => void periodAction(reopenId, "Open", reopenReason)}>Reopen Period</button></div></section></div> : null}

    {selected ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedId("")}><section className="record-modal journal-detail-modal" role="dialog" aria-modal="true" aria-labelledby="journal-detail-title"><div className="modal-heading"><div><p className="eyebrow orange-text">{String(selected.data.entryType || "GENERAL JOURNAL").toUpperCase()}</p><h2 id="journal-detail-title">{String(selected.data.reference || selected.id)}</h2><span>{selected.id} · {selected.recordDate} · Period {String(selected.data.periodId || String(selected.recordDate || "").slice(0, 7))}</span></div><button onClick={() => setSelectedId("")}>×</button></div><div className="journal-detail-status"><i className={`account-status ${statusClass(selected.status)}`}>{selected.status}</i><span><strong>{String(selected.data.description || selected.title)}</strong><small>Prepared By {String(selected.data.preparedBy || selected.owner)}{selected.data.approvedBy ? ` · Approved By ${String(selected.data.approvedBy)}` : ""}{selected.data.postedBy ? ` · Posted By ${String(selected.data.postedBy)}` : ""}</small></span></div><div className="journal-detail-lines" data-reflow-table=""><div className="journal-detail-line header" data-reflow-head="small"><span>Account</span><span>Description / Dimension</span><span>Debit</span><span>Credit</span></div>{(Array.isArray(selected.data.lines) ? selected.data.lines as Array<Record<string, unknown>> : []).map((line, index) => <div className="journal-detail-line" key={String(line.id || index)} data-reflow-row="small"><span data-label="Account"><b>{String(line.accountNumber)}</b><small>{String(line.accountName)}</small>{line.originalAccountNumber && line.originalAccountNumber !== line.accountNumber ? <small>Originally posted as {String(line.originalAccountNumber)}</small> : null}</span><span data-label="Description / Dimension"><b>{String(line.description || "—")}</b><small>{[line.projectId, line.department, line.costCode].filter(Boolean).join(" · ") || "Company · Unassigned"}</small></span><strong data-label="Debit">{amount(line.debit) ? exactMoney.format(amount(line.debit)) : "—"}</strong><strong data-label="Credit">{amount(line.credit) ? exactMoney.format(amount(line.credit)) : "—"}</strong></div>)}</div><div className="journal-source-grid"><div className="journal-support"><strong>Support Reference</strong><span>{String(selected.data.supportReference || "Not Yet Added")}</span></div><div className="journal-support"><strong>Source Record</strong><span>{String(selected.data.sourceType || "Manual Journal")} · {String(selected.data.sourceRecordId || selected.id)}</span></div></div><div className="modal-actions"><button className="secondary-action" onClick={() => setSelectedId("")}>Close</button>{sourceTarget(selected.data.sourceType) && onNavigate ? <button className="secondary-action" onClick={() => { const target = sourceTarget(selected.data.sourceType); setSelectedId(""); onNavigate(target); }}>Open Source Workspace</button> : null}{selected.status === "Draft" && String(selected.data.preparedEmail || "").toLowerCase() === actor.email.toLowerCase() ? <><button className="secondary-action" onClick={() => { setSelectedId(""); editEntry(selected); }}>Edit Draft</button><button className="primary-action" disabled={saving} onClick={() => void transition("submit-journal-entry", selected)}>Submit For Approval</button></> : null}{selected.status === "Submitted" && String(selected.data.preparedEmail || "").toLowerCase() !== actor.email.toLowerCase() ? <button className="primary-action" disabled={saving} onClick={() => void transition("approve-journal-entry", selected)}>Approve Entry</button> : null}{selected.status === "Approved" ? <button className="primary-action" disabled={saving} onClick={() => void transition("post-journal-entry", selected)}>Post To General Ledger</button> : null}{selected.status === "Posted" && !selected.data.automatic && !selected.data.reversedByEntryId ? <button className="secondary-action" disabled={saving} onClick={() => void transition("reverse-journal-entry", selected)}>Create Reversal Draft</button> : null}</div></section></div> : null}
  </div>;
}

function journalSummaryRow(entry: StoredRecord, select: (id: string) => void) {
  const totals = entry.data.totals as Record<string, unknown> | undefined;
  return { id: entry.id, title: String(entry.data.reference || entry.title), subtitle: `${String(entry.data.description || entry.title)} · ${entry.recordDate || "Date Pending"}`, status: entry.status, value: exactMoney.format(amount(totals?.debit)), meta: `${String(entry.data.entryType || "Standard")} · ${entry.owner}`, onOpen: () => select(entry.id), openLabel: "Open Journal →" };
}
