"use client";

import { useEffect, useState } from "react";
import type { AccountingActor } from "./accounting-erp";
import { summaryDrilldownProps } from "./summary-drilldown";
import { AccountingBankConnections } from "./accounting-bank-connections";

type AdvancedMode = "Cash Management" | "WIP And Close" | "Accounting Administration";
type Row = Record<string, unknown>;
type ControlData = {
  currentPeriod: string;
  currentPeriodStatus: string;
  isOwner: boolean;
  projects: Array<{ number: string; name: string; status: string; current_contract_amount: string; contract_amount: string; project_manager: string }>;
  wipForecasts: Row[];
  bankTransactions: Row[];
  bankReconciliations: Row[];
  cashForecast: { openingCash: number; minimumCash: number; weeks: Array<{ weekStart: string; beginning: number; inflow: number; outflow: number; net: number; ending: number; items: Row[] }> };
  closeTasks: Row[];
  cutover: Row | null;
  arAging: Row[];
  apAging: Row[];
  vendorTaxReadiness: Row[];
  cashAccounts: Array<{ id: string; title: string; status: string; data: Row }>;
};
type CoreData = { projects: Row[]; journalEntries: Array<{ id: string; title: string; status: string; data: Row }>; payrollReturns: Array<{ id: string; title: string; status: string; data: Row }> };

const exactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const today = () => new Date().toISOString().slice(0, 10);
const number = (value: unknown) => {
  if (typeof value === "string") {
    const negative = /^\(.*\)$/.test(value.trim());
    const parsed = Number(value.replace(/[$,()]/g, ""));
    return (Number.isFinite(parsed) ? parsed : 0) * (negative ? -1 : 1);
  }
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const dollars = (cents: unknown) => number(cents) / 100;
const text = (value: unknown) => String(value ?? "");

function tabsFor(mode: AdvancedMode) {
  if (mode === "Cash Management") return ["13-Week Forecast", "Bank And Credit Accounts", "Bank Reconciliation", "Collections"];
  if (mode === "WIP And Close") return ["WIP Forecast", "Month Close", "Cutover"];
  return ["Control Center", "Month Close", "Cutover", "AP / AR Control", "Vendor Tax"];
}

export function AccountingAdvancedWorkspace({ mode }: { mode: AdvancedMode; actor: AccountingActor }) {
  const tabs = tabsFor(mode);
  const [tab, setTab] = useState(tabs[0]);
  const [controls, setControls] = useState<ControlData | null>(null);
  const [core, setCore] = useState<CoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function load(background = false) {
    if (!background) setLoading(true);
    try {
      const [controlResponse, coreResponse] = await Promise.all([fetch("/api/accounting-controls", { cache: "no-store" }), fetch("/api/accounting", { cache: "no-store" })]);
      const [controlResult, coreResult] = await Promise.all([controlResponse.json() as Promise<ControlData & { error?: string }>, coreResponse.json() as Promise<CoreData & { error?: string }>]);
      if (!controlResponse.ok) throw new Error(controlResult.error || "Accounting Controls Are Unavailable");
      if (!coreResponse.ok) throw new Error(coreResult.error || "Accounting Ledger Is Unavailable");
      setControls(controlResult);
      setCore(coreResult);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Accounting Controls Are Unavailable");
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function post(body: Row) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/accounting-controls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { notice?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "The Accounting Control Could Not Be Saved");
      setNotice(result.notice || "Accounting Control Saved");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Accounting Control Could Not Be Saved");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !controls) return <div className="accounting-notice">Loading Accountant Control Center...</div>;
  if (!controls || !core) return <div className="accounting-notice">{notice || "Accounting Controls Are Unavailable"}</div>;

  const title = mode === "Cash Management" ? "Cash Planning And Reconciliation" : mode === "WIP And Close" ? "WIP Forecast And Month Close" : "Accounting Administration";
  return <div className="accounting-workspace accounting-advanced-workspace">
    <section className="accounting-hero accounting-command-hero"><div><h1>{title}</h1></div></section>
    {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
    <nav className="accounting-control-tabs" aria-label={`${title} views`}>{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "WIP Forecast" ? <WipPanel controls={controls} core={core} saving={saving} post={post} /> : null}
    {tab === "Month Close" ? <ClosePanel controls={controls} saving={saving} post={post} /> : null}
    {tab === "Cutover" ? <CutoverPanel controls={controls} core={core} saving={saving} post={post} /> : null}
    {tab === "13-Week Forecast" ? <CashForecastPanel controls={controls} saving={saving} post={post} /> : null}
    {tab === "Bank And Credit Accounts" ? <AccountingBankConnections onAccountsChanged={() => load(true)} /> : null}
    {tab === "Bank Reconciliation" ? <BankPanel controls={controls} saving={saving} post={post} /> : null}
    {tab === "Collections" ? <CollectionsPanel controls={controls} saving={saving} post={post} /> : null}
    {tab === "Control Center" ? <ControlCenter controls={controls} core={core} setTab={setTab} /> : null}
    {tab === "AP / AR Control" ? <AgingPanel controls={controls} /> : null}
    {tab === "Vendor Tax" ? <VendorTaxPanel controls={controls} /> : null}

  </div>;
}

function WipPanel({ controls, core, saving, post }: { controls: ControlData; core: CoreData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, { estimateToComplete: string; riskReserve: string; notes: string }>>({});
  const [reopenReasons, setReopenReasons] = useState<Record<string, string>>({});
  const financials = new Map(core.projects.map((project) => [text(project.number), project]));
  function latest(projectId: string) { return controls.wipForecasts.find((row) => text(row.project_id) === projectId && text(row.period_id) === controls.currentPeriod); }
  function draft(projectId: string) {
    const row = latest(projectId);
    return drafts[projectId] || { estimateToComplete: row ? String(dollars(row.estimate_to_complete_cents)) : String(number(financials.get(projectId)?.estimateToComplete)), riskReserve: row ? String(dollars(row.risk_reserve_cents)) : "0", notes: text(row?.notes) };
  }
  function update(projectId: string, patch: Partial<ReturnType<typeof draft>>) { setDrafts((current) => ({ ...current, [projectId]: { ...draft(projectId), ...patch } })); }
  async function save(projectId: string, status: string) { const value = draft(projectId); await post({ action: "save-wip-forecast", wip: { projectId, periodId: controls.currentPeriod, estimateToComplete: number(value.estimateToComplete), riskReserve: number(value.riskReserve), recognitionMethod: "Cost To Cost", notes: value.notes, status } }); }
  return <section className="accounting-ledger-panel advanced-panel">
    <div className="accounting-ledger-heading"><div><h2>{controls.currentPeriod} Work In Progress</h2></div><i className="ap-status review">COST TO COST</i></div>
    <div className="advanced-table wip-control-table" data-reflow-table=""><div className="advanced-row header" data-reflow-head="wide"><span>Project</span><span>Contract</span><span>Actual</span><span>ETC</span><span>Risk</span><span>EAC / Profit</span><span>Margin</span><span>Control</span></div>
      {controls.projects.filter((project) => project.status === "Active").map((project) => { const financial = financials.get(project.number) || {}; const value = draft(project.number); const actual = number(financial.actualCost); const eac = actual + number(value.estimateToComplete) + number(value.riskReserve); const contract = number(project.current_contract_amount || project.contract_amount); const profitValue = contract - eac; const row = latest(project.number); const locked = text(row?.status) === "Locked" || controls.currentPeriodStatus === "Hard Closed"; return <div className="advanced-row" key={project.number} data-reflow-row="wide">
        <span data-label="Project"><b>{project.number}</b><small>{project.name}</small><textarea rows={2} disabled={locked} value={value.notes} onChange={(event) => update(project.number, { notes: event.target.value })} placeholder="Forecast risks and assumptions" /></span>
        <strong data-label="Contract">{exactMoney.format(contract)}</strong><strong data-label="Actual">{exactMoney.format(actual)}</strong>
        <span className="reflow-field" data-label="ETC"><CurrencyField disabled={locked} value={value.estimateToComplete} onChange={(estimateToComplete) => update(project.number, { estimateToComplete })} /></span>
        <span className="reflow-field" data-label="Risk"><CurrencyField disabled={locked} value={value.riskReserve} onChange={(riskReserve) => update(project.number, { riskReserve })} /></span>
        <span data-label="EAC / Profit"><b>{exactMoney.format(eac)}</b><small>{exactMoney.format(profitValue)} profit</small></span><strong data-label="Margin">{percent.format(contract ? profitValue / contract : 0)}</strong>
        <span className="advanced-actions" data-label="Control"><i className={`ap-status ${text(row?.status).toLowerCase().replaceAll(" ", "-")}`}>{text(row?.status || "Not Forecast")}</i><button disabled={saving || locked} onClick={() => void save(project.number, "Draft")}>Save</button><button disabled={saving || locked} onClick={() => void save(project.number, "Accounting Reviewed")}>Review</button>{controls.isOwner ? <button disabled={saving || locked || text(row?.status) !== "Accounting Reviewed"} onClick={() => void save(project.number, "Locked")}>Approve + Lock</button> : null}{controls.isOwner && text(row?.status) === "Locked" && controls.currentPeriodStatus !== "Hard Closed" ? <><input aria-label={`Reopen reason for ${project.number}`} placeholder="Reason for correction" value={reopenReasons[project.number] || ""} onChange={event => setReopenReasons(current => ({ ...current, [project.number]: event.target.value }))} /><button disabled={saving || (reopenReasons[project.number] || "").trim().length < 8} onClick={() => void post({ action: "reopen-wip-forecast", wip: { projectId: project.number, periodId: controls.currentPeriod, reason: reopenReasons[project.number] } })}>Reopen Forecast</button></> : null}</span>
      </div>; })}
    </div>
  </section>;
}

function ClosePanel({ controls, saving, post }: { controls: ControlData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const reviewed = controls.closeTasks.filter((task) => text(task.status) === "Reviewed").length;
  return <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>{controls.currentPeriod} Close Checklist</h2><span>{reviewed} of {controls.closeTasks.length} controls independently reviewed. Complete work here, then hard-close the period in General Ledger.</span></div><i className={`ap-status ${reviewed === controls.closeTasks.length ? "approved" : "review"}`}>{reviewed}/{controls.closeTasks.length} REVIEWED</i></div>
    <div className="advanced-table close-control-table" data-reflow-table=""><div className="advanced-row header" data-reflow-head="medium"><span>Control</span><span>Owner</span><span>Due</span><span>Evidence</span><span>Status</span><span>Action</span></div>{controls.closeTasks.map((task) => { const id = text(task.id); const note = evidence[id] ?? text(task.evidence); return <div className="advanced-row" key={id} data-reflow-row="medium"><span data-label="Control"><b>{text(task.code)} · {text(task.category)}</b><small>{text(task.description)}</small></span><span data-label="Owner">{text(task.assigned_role)}</span><span data-label="Due">{text(task.due_date)}</span><label className="reflow-field" data-label="Evidence"><input disabled={controls.currentPeriodStatus === "Hard Closed"} value={note} onChange={(event) => setEvidence((current) => ({ ...current, [id]: event.target.value }))} placeholder="Reconciliation, journal, or support reference" /></label><i className={`ap-status ${text(task.status).toLowerCase()}`} data-label="Status">{text(task.status)}</i><span className="advanced-actions" data-label="Action"><button disabled={saving || controls.currentPeriodStatus === "Hard Closed" || (text(task.code) === "OWNER" && !controls.isOwner)} onClick={() => void post({ action: "update-close-task", closeTask: { periodId: controls.currentPeriod, code: task.code, status: "Completed", evidence: note } })}>Complete</button><button disabled={saving || controls.currentPeriodStatus === "Hard Closed" || text(task.status) !== "Completed"} onClick={() => void post({ action: "update-close-task", closeTask: { periodId: controls.currentPeriod, code: task.code, status: "Reviewed", evidence: note } })}>Review</button></span></div>; })}</div>
  </section>;
}

function CutoverPanel({ controls, core, saving, post }: { controls: ControlData; core: CoreData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const saved = controls.cutover;
  const [form, setForm] = useState(() => ({ cutoverDate: text(saved?.cutover_date || today()), sourceSystem: text(saved?.source_system), openingBalanceEntryId: text(saved?.opening_balance_entry_id), evidence: text(saved?.evidence), apReconciled: Boolean(saved?.ap_reconciled), arReconciled: Boolean(saved?.ar_reconciled), cashReconciled: Boolean(saved?.cash_reconciled), assetsReconciled: Boolean(saved?.assets_reconciled), payrollReconciled: Boolean(saved?.payroll_reconciled), equityReconciled: Boolean(saved?.equity_reconciled) }));
  const locked = text(saved?.status) === "Locked";
  const openingEntries = core.journalEntries.filter((entry) => text(entry.data.entryType) === "Opening Balance" && entry.status === "Posted");
  const checks = [["apReconciled", "Accounts Payable"], ["arReconciled", "Accounts Receivable"], ["cashReconciled", "Cash"], ["assetsReconciled", "Fixed Assets"], ["payrollReconciled", "Payroll"], ["equityReconciled", "Equity"]] as const;
  function save(status: string) { void post({ action: "save-cutover-control", cutover: { ...form, status } }); }
  return <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Controlled Accounting Cutover</h2></div><i className={`ap-status ${text(saved?.status || "Draft").toLowerCase().replaceAll(" ", "-")}`}>{text(saved?.status || "Draft")}</i></div>
    <div className="cutover-grid"><label>Cutover Date<input type="date" disabled={locked} value={form.cutoverDate} onChange={(event) => setForm({ ...form, cutoverDate: event.target.value })} /></label><label>Prior Accounting System<input disabled={locked} value={form.sourceSystem} onChange={(event) => setForm({ ...form, sourceSystem: event.target.value })} placeholder="Source system or controlled workbook" /></label><label>Posted Opening Balance Journal<select disabled={locked} value={form.openingBalanceEntryId} onChange={(event) => setForm({ ...form, openingBalanceEntryId: event.target.value })}><option value="">Select Posted Opening Balance</option>{openingEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.title}</option>)}</select></label></div>
    <div className="cutover-checks">{checks.map(([key, label]) => <label key={key}><input type="checkbox" disabled={locked} checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} /><span><b>{label}</b><small>Opening detail agrees to source and control total</small></span></label>)}</div>
    <label className="field-label">Cutover Evidence<textarea disabled={locked} rows={4} value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} placeholder="Control totals, source report references, reviewer notes, and unresolved differences" /></label>
    <div className="modal-actions"><button disabled={saving || locked} onClick={() => save("Draft")}>Save Draft</button>{controls.isOwner ? <><button disabled={saving || locked} onClick={() => save("Owner Approved")}>Owner Approve</button><button className="primary-action" disabled={saving || locked} onClick={() => save("Locked")}>Owner Approve + Lock</button></> : null}</div>
  </section>;
}

function CashForecastPanel({ controls, saving, post }: { controls: ControlData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const firstWeek = controls.cashForecast.weeks[0]?.weekStart || today();
  const [form, setForm] = useState({ weekStart: firstWeek, direction: "Outflow", category: "Other", description: "", amount: "", projectId: "", confidence: "Expected" });
  return <><section className="accounting-summary-grid accounting-command-summary"><article {...summaryDrilldownProps({ title: "Opening Book Cash Accounts", rows: controls.cashAccounts.map((account) => ({ id: account.id, title: account.title, subtitle: text(account.data.institution || account.data.accountType || "Cash Account"), value: exactMoney.format(number(account.data.balance || account.data.currentBalance || account.data.amount)), status: account.status })) })}><span>OPENING BOOK CASH</span><strong>{exactMoney.format(controls.cashForecast.openingCash)}</strong><small>All recorded cash accounts</small></article><article {...summaryDrilldownProps({ title: "Thirteen-Week Projected Cash", rows: controls.cashForecast.weeks.map((week) => ({ id: week.weekStart, title: `Week Of ${week.weekStart}`, subtitle: `${exactMoney.format(week.beginning)} beginning · ${exactMoney.format(week.inflow)} in · ${exactMoney.format(week.outflow)} out`, value: exactMoney.format(week.ending), status: week.ending < 0 ? "Negative" : week.ending === controls.cashForecast.minimumCash ? "Lowest" : "Projected", meta: `${week.items.length} source items` })) })}><span>LOWEST PROJECTED CASH</span><strong>{exactMoney.format(controls.cashForecast.minimumCash)}</strong><small>Next thirteen weeks</small></article><article {...summaryDrilldownProps({ title: "Automatic AR And AP Forecast Sources", rows: [...controls.arAging.map((row, index) => ({ id: `ar-${text(row.id || index)}`, title: text(row.title || row.customer || row.owner || "Owner Receivable"), subtitle: "Accounts Receivable", value: exactMoney.format(number(row.openAmount || row.open_amount)), status: number(row.days) > 0 ? "Overdue" : text(row.status || "Open") })), ...controls.apAging.map((row, index) => ({ id: `ap-${text(row.id || index)}`, title: text(row.title || row.vendor || "Vendor Payable"), subtitle: "Accounts Payable", value: exactMoney.format(number(row.openAmount || row.open_amount)), status: text(row.status || "Open") }))] })}><span>AUTOMATIC SOURCES</span><strong>AR + AP</strong><small>Open owner billing and approved AP</small></article><article {...summaryDrilldownProps({ title: "Cash Forecast Horizon", rows: controls.cashForecast.weeks.map((week) => ({ id: week.weekStart, title: `Week Of ${week.weekStart}`, value: exactMoney.format(week.ending), status: "Forecast", meta: "Monday through Sunday" })) })}><span>FORECAST HORIZON</span><strong>13 Weeks</strong><small>Monday through Sunday</small></article></section>
    <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Thirteen-Week Direct Cash Forecast</h2></div></div><div className="cash-forecast-table" data-reflow-table=""><div className="cash-forecast-row" data-reflow-head="medium"><span>Week Starting</span><span>Beginning Cash</span><span>Cash In</span><span>Cash Out</span><span>Net Change</span><span>Ending Cash</span></div>{controls.cashForecast.weeks.map((week) => <div className="cash-forecast-row" data-reflow-row="medium" key={week.weekStart}><strong data-label="Week Starting">{week.weekStart}</strong><span data-label="Beginning Cash">{exactMoney.format(week.beginning)}</span><span data-label="Cash In">{exactMoney.format(week.inflow)}</span><span data-label="Cash Out">{exactMoney.format(week.outflow)}</span><span data-label="Net Change">{exactMoney.format(week.net)}</span><strong data-label="Ending Cash" className={week.ending < 0 ? "negative" : ""}>{exactMoney.format(week.ending)}</strong></div>)}</div></section>
    <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Add Known Cash Item</h2></div></div><div className="forecast-entry-grid"><label>Week<input type="date" value={form.weekStart} onChange={(event) => setForm({ ...form, weekStart: event.target.value })} /></label><label>Direction<select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}><option>Inflow</option><option>Outflow</option></select></label><label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Amount<CurrencyField value={form.amount} onChange={(amount) => setForm({ ...form, amount })} /></label><label>Confidence<select value={form.confidence} onChange={(event) => setForm({ ...form, confidence: event.target.value })}><option>Committed</option><option>Expected</option><option>Possible</option></select></label><button className="primary-action" disabled={saving} onClick={() => void post({ action: "save-cash-forecast-item", forecastItem: form })}>Add To Forecast</button></div></section>
  </>;
}

function BankPanel({ controls, saving, post }: { controls: ControlData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const firstAccount = controls.cashAccounts[0]?.id || "";
  const [accountId, setAccountId] = useState(firstAccount);
  const [paste, setPaste] = useState("");
  const [bookId, setBookId] = useState("");
  const [bankId, setBankId] = useState("");
  const [reconciliation, setReconciliation] = useState({ statementStart: today().slice(0, 8) + "01", statementEnd: today(), statementEndingBalance: "", bookEndingBalance: "", outstandingDeposits: "", outstandingPayments: "", adjustment: "" });
  const transactions = controls.bankTransactions.filter((row) => text(row.cash_account_id) === accountId && text(row.status) === "Unmatched");
  const parseImport = () => paste.split(/\r?\n/).map((line) => splitCsv(line)).filter((cells) => cells.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0])).map((cells) => ({ transactionDate: cells[0], source: /bank/i.test(cells[1]) ? "Bank" : "Book", reference: cells[2], description: cells[3], amount: parseCurrency(cells[4]) }));
  const difference = number(reconciliation.statementEndingBalance) + number(reconciliation.outstandingDeposits) - number(reconciliation.outstandingPayments) + number(reconciliation.adjustment) - number(reconciliation.bookEndingBalance);
  const latest = controls.bankReconciliations.find((row) => text(row.cash_account_id) === accountId);
  return <><section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Transaction Matching</h2></div><label>Cash Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select Account</option>{controls.cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.title}</option>)}</select></label></div>
    <textarea className="bank-import-paste" rows={6} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={'Date,Source,Reference,Description,Amount\n2026-08-01,Book,CHK-1024,Vendor payment,-1250.00\n2026-08-02,Bank,CHK-1024,Cleared check,-1250.00'} />
    <div className="modal-actions"><button disabled={saving || !accountId || !parseImport().length} onClick={() => void post({ action: "import-bank-transactions", transactionImport: { cashAccountId: accountId, transactions: parseImport() } })}>Import {parseImport().length || ""} Transactions</button></div>
    <div className="bank-match-grid"><TransactionList title="Unmatched Book" rows={transactions.filter((row) => text(row.source) === "Book")} selected={bookId} setSelected={setBookId} /><TransactionList title="Unmatched Bank" rows={transactions.filter((row) => text(row.source) === "Bank")} selected={bankId} setSelected={setBankId} /></div><div className="modal-actions"><button className="primary-action" disabled={saving || !bookId || !bankId} onClick={() => void post({ action: "match-bank-transactions", match: { bookTransactionId: bookId, bankTransactionId: bankId } })}>Match Selected Transactions</button></div></section>
    <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Statement Reconciliation</h2></div>{latest ? <i className={`ap-status ${text(latest.status).toLowerCase().replaceAll(" ", "-")}`}>{text(latest.status)}</i> : null}</div><div className="reconciliation-grid"><label>Statement Start<input type="date" value={reconciliation.statementStart} onChange={(event) => setReconciliation({ ...reconciliation, statementStart: event.target.value })} /></label><label>Statement End<input type="date" value={reconciliation.statementEnd} onChange={(event) => setReconciliation({ ...reconciliation, statementEnd: event.target.value })} /></label>{(["statementEndingBalance", "bookEndingBalance", "outstandingDeposits", "outstandingPayments", "adjustment"] as const).map((key) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<CurrencyField value={reconciliation[key]} onChange={(value) => setReconciliation({ ...reconciliation, [key]: value })} /></label>)}<article className={Math.abs(difference) < 0.005 ? "balanced" : "difference"}><span>Difference</span><strong>{exactMoney.format(difference)}</strong></article></div><div className="modal-actions"><button disabled={saving || !accountId} onClick={() => void post({ action: "save-bank-reconciliation", reconciliation: { cashAccountId: accountId, ...Object.fromEntries(Object.entries(reconciliation).map(([key, value]) => [key, key.includes("Date") || key.includes("statementStart") || key.includes("statementEnd") ? value : number(value)])) } })}>Save Reconciliation</button>{controls.isOwner && latest ? <button className="primary-action" disabled={saving || number(latest.difference_cents) !== 0 || text(latest.status) === "Approved"} onClick={() => void post({ action: "approve-bank-reconciliation", recordId: latest.id })}>Owner Approve</button> : null}</div></section>
  </>;
}

function CollectionsPanel({ controls, saving, post }: { controls: ControlData; saving: boolean; post: (body: Row) => Promise<void> }) {
  const first = controls.arAging[0];
  const [selected, setSelected] = useState(text(first?.id));
  const [form, setForm] = useState({ actionDate: today(), method: "Email", note: "", promiseDate: "", promisedAmount: "" });
  const billing = controls.arAging.find((row) => text(row.id) === selected);
  return <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Owner Collections</h2></div></div><div className="advanced-table aging-table" data-reflow-table=""><div className="advanced-row header" data-reflow-head="medium"><span>Project / Billing</span><span>Due</span><span>Age</span><span>Open</span><span>Latest Action</span><span>Select</span></div>{controls.arAging.map((row) => <div className="advanced-row" key={text(row.id)} data-reflow-row="medium"><span data-label="Project / Billing"><b>{text(row.projectId)}</b><small>{text(row.title)}</small></span><span data-label="Due">{text(row.due)}</span><i className={`aging-bucket bucket-${text(row.bucket).replaceAll("–", "-")}`} data-label="Age">{text(row.bucket)}</i><strong data-label="Open">{exactMoney.format(number(row.openAmount))}</strong><span data-label="Latest Action">{row.latestAction ? <><b>{text((row.latestAction as Row).method)}</b><small>{text((row.latestAction as Row).note)}</small></> : "No activity"}</span><button onClick={() => setSelected(text(row.id))} data-label="Select">{selected === row.id ? "Selected" : "Select"}</button></div>)}</div>
    {billing ? <div className="collection-entry"><label>Date<input type="date" value={form.actionDate} onChange={(event) => setForm({ ...form, actionDate: event.target.value })} /></label><label>Method<select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}><option>Email</option><option>Call</option><option>Meeting</option><option>Notice</option><option>Promise To Pay</option></select></label><label>Note<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label>Promise Date<input type="date" value={form.promiseDate} onChange={(event) => setForm({ ...form, promiseDate: event.target.value })} /></label><label>Promised Amount<CurrencyField value={form.promisedAmount} onChange={(promisedAmount) => setForm({ ...form, promisedAmount })} /></label><button className="primary-action" disabled={saving} onClick={() => void post({ action: "record-collection-action", collection: { projectId: billing.projectId, billingId: billing.id, ...form, promisedAmount: number(form.promisedAmount) } })}>Record Activity</button></div> : null}
  </section>;
}

function ControlCenter({ controls, core, setTab }: { controls: ControlData; core: CoreData; setTab: (tab: string) => void }) {
  const lockedWip = controls.wipForecasts.filter((row) => text(row.status) === "Locked").length;
  const reviewedClose = controls.closeTasks.filter((row) => text(row.status) === "Reviewed").length;
  const pendingPayroll = core.payrollReturns.filter((entry) => entry.status === "Owner Approval Required").length;
  return <><section className="accounting-summary-grid accounting-command-summary"><article {...summaryDrilldownProps({ title: "Active Project WIP Forecasts", rows: controls.projects.filter((project) => project.status === "Active").map((project) => { const forecast = controls.wipForecasts.find((row) => text(row.project_id) === project.number); return { id: project.number, title: project.name, subtitle: project.project_manager, status: text(forecast?.status || "Open"), value: exactMoney.format(number(project.current_contract_amount || project.contract_amount)), meta: forecast ? text(forecast.notes || controls.currentPeriod) : "No WIP forecast saved" }; }) })}><span>WIP LOCKED</span><strong>{lockedWip}/{controls.projects.filter((project) => project.status === "Active").length}</strong><small>Active project forecasts</small></article><article {...summaryDrilldownProps({ title: `${controls.currentPeriod} Month-Close Controls`, rows: controls.closeTasks.map((row, index) => ({ id: text(row.id || index), title: text(row.title || row.task || row.control || "Close Control"), subtitle: text(row.owner || row.assigned_to || controls.currentPeriod), status: text(row.status || "Open"), meta: text(row.evidence || row.notes || "") })) })}><span>CLOSE REVIEWED</span><strong>{reviewedClose}/{controls.closeTasks.length}</strong><small>{controls.currentPeriod} controls</small></article><article {...summaryDrilldownProps({ title: "Unmatched Bank Transactions", rows: controls.bankTransactions.filter((row) => text(row.status) === "Unmatched").map((row, index) => ({ id: text(row.id || index), title: text(row.description || row.payee || "Bank Transaction"), subtitle: text(row.account || row.transaction_date || row.date || ""), status: "Unmatched", value: exactMoney.format(dollars(row.amount_cents || row.amount)), meta: text(row.reference || "") })) })}><span>BANK EXCEPTIONS</span><strong>{controls.bankTransactions.filter((row) => text(row.status) === "Unmatched").length}</strong><small>Unmatched transactions</small></article><article {...summaryDrilldownProps({ title: "Overdue Accounts Receivable", rows: controls.arAging.filter((row) => number(row.days) > 0).map((row, index) => ({ id: text(row.id || index), title: text(row.title || row.customer || row.owner || "Owner Receivable"), subtitle: `${number(row.days)} days overdue`, status: text(row.status || "Overdue"), value: exactMoney.format(number(row.openAmount || row.open_amount)), meta: text(row.collection_owner || row.owner || "Collection owner required") })) })}><span>OVERDUE AR</span><strong>{exactMoney.format(controls.arAging.filter((row) => number(row.days) > 0).reduce((sum, row) => sum + number(row.openAmount), 0))}</strong><small>Requires collection ownership</small></article></section><section className="control-launch-grid"><button onClick={() => setTab("Month Close")}><b>Month Close</b><span>Evidence and independent review</span></button><button onClick={() => setTab("Cutover")}><b>Cutover</b><span>Opening balance control and owner lock</span></button><button onClick={() => setTab("AP / AR Control")}><b>AP / AR Control</b><span>Aging and exception review</span></button><button onClick={() => setTab("Vendor Tax")}><b>Vendor Tax</b><span>W-9 and 1099 readiness</span></button></section>{pendingPayroll ? <div className="accounting-notice">{pendingPayroll} High-Dollar Payroll Return{pendingPayroll === 1 ? "" : "s"} Requires Owner Approval In Payroll Reports.</div> : null}</>;
}

function AgingPanel({ controls }: { controls: ControlData }) { return <div className="accounting-dual-panels"><SimpleAging title="Accounts Receivable Aging" rows={controls.arAging} payable={false} /><SimpleAging title="Accounts Payable Aging" rows={controls.apAging} payable /></div>; }
function SimpleAging({ title, rows, payable }: { title: string; rows: Row[]; payable: boolean }) { return <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>{title}</h2><span>{rows.length} open item{rows.length === 1 ? "" : "s"}</span></div></div><div className="compact-aging-list">{rows.map((row) => <article key={text(row.id)}><span><b>{payable ? text(row.vendor) : text(row.projectId)}</b><small>{payable ? text(row.invoiceNumber) : text(row.title)}</small></span><i>{text(row.bucket)}</i><span>{text(row.due)}</span><strong>{exactMoney.format(number(payable ? row.amount : row.openAmount))}</strong></article>)}{!rows.length ? <div className="accounting-empty"><strong>No Open Items</strong><span>This aging is current.</span></div> : null}</div></section>; }
function VendorTaxPanel({ controls }: { controls: ControlData }) { return <section className="accounting-ledger-panel advanced-panel"><div className="accounting-ledger-heading"><div><h2>Vendor Tax Readiness</h2></div></div><div className="advanced-table vendor-tax-table" data-reflow-table=""><div className="advanced-row header" data-reflow-head="medium"><span>Vendor</span><span>Type</span><span>W-9</span><span>Tax ID</span><span>YTD Paid</span><span>1099 Review</span></div>{controls.vendorTaxReadiness.map((row) => <div className="advanced-row" key={text(row.vendorId)} data-reflow-row="medium"><span data-label="Vendor"><b>{text(row.legalName)}</b><small>{text(row.status)}</small></span><span data-label="Type">{text(row.vendorType)}</span><i className={`ap-status ${text(row.w9Status).toLowerCase()}`} data-label="W-9">{text(row.w9Status)}</i><span data-label="Tax ID">{row.taxIdLastFour ? `•••• ${text(row.taxIdLastFour)}` : "Missing"}</span><strong data-label="YTD Paid">{exactMoney.format(number(row.ytdPaid))}</strong><i className={`ap-status ${row.review1099 ? "review" : "ready"}`} data-label="1099 Review">{row.review1099 ? "Review" : "Not Flagged"}</i></div>)}</div></section>; }

function TransactionList({ title, rows, selected, setSelected }: { title: string; rows: Row[]; selected: string; setSelected: (id: string) => void }) { return <section><h3>{title}</h3>{rows.map((row) => <button className={selected === text(row.id) ? "selected" : ""} key={text(row.id)} onClick={() => setSelected(text(row.id))}><span><b>{text(row.transaction_date)}</b><small>{text(row.reference)} · {text(row.description)}</small></span><strong>{exactMoney.format(dollars(row.amount_cents))}</strong></button>)}{!rows.length ? <div className="accounting-empty"><span>No unmatched transactions.</span></div> : null}</section>; }
function CurrencyField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) { return <input disabled={disabled} className="currency-field" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9.-]/g, ""))} onBlur={(event) => { const valueNumber = number(event.target.value); onChange(Number.isFinite(valueNumber) ? valueNumber.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"); }} />; }
function splitCsv(line: string) { const values: string[] = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const character = line[index]; if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { values.push(current.trim()); current = ""; } else current += character; } values.push(current.trim()); return values; }
function parseCurrency(value: string) { const negative = /^\(.*\)$/.test(value.trim()); const parsed = Number(value.replace(/[$,()]/g, "")); return (Number.isFinite(parsed) ? parsed : 0) * (negative ? -1 : 1); }
