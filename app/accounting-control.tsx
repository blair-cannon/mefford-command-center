"use client";
import { BonusPaymentQueue } from "./bonus-payment-queue";

import { useEffect, useMemo, useState } from "react";
import type { AccountingActor, AccountingMode } from "./accounting-erp";
import { CurrencyInput } from "./currency-input";
import { summaryDrilldownProps } from "./summary-drilldown";
import { PROFITABILITY_FLOOR_BASIS_POINTS } from "../lib/operating-doctrine";
import { roundMoney } from "../lib/money";
import { isContractedActiveProject, needsOwnerContractSignature } from "../lib/contracted-projects";

type CoordinationMode = Extract<AccountingMode, "Accounting Command" | "Cash Management" | "Payroll Reports" | "WIP And Close" | "Financial Reports">;

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

type ProjectFinancial = {
  number: string;
  name: string;
  status: string;
  ownerName: string;
  projectManager: string;
  contractType: string;
  contractStatus: string;
  contractAuthorized: boolean;
  contractAmount: number;
  currentContract: number;
  approvedChanges: number;
  originalBudget: number;
  budgetLocked: boolean;
  billingSetupLocked: boolean;
  committedCost: number;
  approvedCost: number;
  paidCost: number;
  actualCost: number;
  estimateToComplete: number;
  riskReserve: number;
  openAp: number;
  ownerBilled: number;
  ownerReceived: number;
  accountsReceivable: number;
  earnedToDate: number;
  estimatedCost: number;
  projectedProfit: number;
  projectedMargin: number;
  costCompletion: number;
  recognizedRevenue: number;
  overUnderBilling: number;
  readyToClose: boolean;
  wipPeriodId: string;
  wipStatus: string;
  wipNotes: string;
  recognitionMethod: string;
};

type AccountingData = {
  generatedAt: string;
  summary: {
    activeProjects: number;
    currentContracts: number;
    pendingContractProjects: number;
    pendingContractValue: number;
    ownerBilled: number;
    ownerReceived: number;
    accountsReceivable: number;
    openAp: number;
    paidProjectCost: number;
    actualProjectCost: number;
    projectedProfit: number;
    approvedUnpaid: number;
    preparedBatches: number;
    reconciledCash: number;
  };
  projects: ProjectFinancial[];
  issues: Array<{ id: string; severity: "Critical" | "Review" | "Ready"; area: string; project: string; message: string; target: string; accountableRole?: string; supportRole?: string; decision?: string }>;
  paymentBatches: StoredRecord[];
  cashAccounts: StoredRecord[];
  payrollRuns: StoredRecord[];
  payrollReturns: StoredRecord[];
  employees: Array<{ name: string; email: string }>;
  receivables: Array<StoredRecord & { projectId: string }>;
};

type PayrollLine = { id: string; destination: string; code: string; description: string; hours: string };

type PayrollDraft = {
  id: string;
  payrollCompany: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  employee: string;
  employeeIdLastFour: string;
  regularHours: string;
  overtimeHours: string;
  ptoHours: string;
  holidayHours: string;
  bonus: string;
  reimbursement: string;
  deduction: string;
  notes: string;
  allocations: PayrollLine[];
};

type PaylocityReturnLine = { id: string; destination: string; code: string; description: string; amount: string };

type PaylocityReturnDraft = {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  returnReference: string;
  grossWages: string;
  employerTaxes: string;
  employerBenefits: string;
  employeeDeductions: string;
  netPay: string;
  notes: string;
  allocations: PaylocityReturnLine[];
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const exactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateInput() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function htmlCell(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function lineId() {
  return globalThis.crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyPayrollDraft(): PayrollDraft {
  const today = dateInput();
  return { id: "", payrollCompany: "Paylocity", periodStart: today, periodEnd: today, payDate: today, employee: "", employeeIdLastFour: "", regularHours: "", overtimeHours: "", ptoHours: "", holidayHours: "", bonus: "", reimbursement: "", deduction: "", notes: "", allocations: [{ id: lineId(), destination: "", code: "", description: "", hours: "" }] };
}

function emptyPaylocityReturn(period?: { periodStart: string; periodEnd: string; payDate: string }): PaylocityReturnDraft {
  const today = dateInput();
  return {
    periodStart: period?.periodStart || today,
    periodEnd: period?.periodEnd || today,
    payDate: period?.payDate || today,
    returnReference: "",
    grossWages: "",
    employerTaxes: "",
    employerBenefits: "",
    employeeDeductions: "",
    netPay: "",
    notes: "",
    allocations: [{ id: lineId(), destination: "", code: "", description: "", amount: "" }],
  };
}

async function accountingAction(body: Record<string, unknown>) {
  const response = await fetch("/api/accounting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string; notice?: string };
  if (!response.ok) throw new Error(result.error || "The Accounting Action Could Not Be Saved.");
  return result;
}

export function AccountingControlWorkspace({ mode, actor }: { mode: CoordinationMode; actor: AccountingActor }) {
  const [workspace, setWorkspace] = useState<AccountingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [projectFilter, setProjectFilter] = useState("Active Projects");
  const [cashOpen, setCashOpen] = useState(false);
  const [cashDraft, setCashDraft] = useState({ id: "", name: "", lastFour: "", bookBalance: "", bankBalance: "", statementDate: dateInput() });
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollDraft, setPayrollDraft] = useState<PayrollDraft>(() => emptyPayrollDraft());
  const [payrollPeriodKey, setPayrollPeriodKey] = useState("");
  const [paylocityReturnOpen, setPaylocityReturnOpen] = useState(false);
  const [paylocityReturnDraft, setPaylocityReturnDraft] = useState<PaylocityReturnDraft>(() => emptyPaylocityReturn());

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/accounting");
      const result = await response.json() as AccountingData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Accounting Coordination Is Unavailable.");
      setWorkspace(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Accounting Coordination Is Unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const projects = useMemo(() => (workspace?.projects ?? []).filter((project) => projectFilter === "All Projects"
    || (projectFilter === "Awaiting Signatures" ? needsOwnerContractSignature(project)
      : projectFilter === "Active Projects" ? isContractedActiveProject(project) : project.number === projectFilter)), [projectFilter, workspace?.projects]);
  const payrollTotalHours = numeric(payrollDraft.regularHours) + numeric(payrollDraft.overtimeHours) + numeric(payrollDraft.ptoHours) + numeric(payrollDraft.holidayHours);
  const payrollDistributedHours = payrollDraft.allocations.reduce((sum, line) => sum + numeric(line.hours), 0);
  const payrollPeriods = useMemo(() => {
    const grouped = new Map<string, { key: string; periodStart: string; periodEnd: string; payDate: string; runs: StoredRecord[] }>();
    (workspace?.payrollRuns ?? []).forEach((record) => {
      const periodStart = String(record.data.periodStart || "");
      const periodEnd = String(record.data.periodEnd || record.recordDate || "");
      const payDate = String(record.data.payDate || record.due || "");
      const key = `${periodStart}|${periodEnd}|${payDate}`;
      const current = grouped.get(key) || { key, periodStart, periodEnd, payDate, runs: [] };
      current.runs.push(record);
      grouped.set(key, current);
    });
    return [...grouped.values()].sort((a, b) => b.payDate.localeCompare(a.payDate));
  }, [workspace?.payrollRuns]);
  const selectedPayrollPeriod = payrollPeriods.find((period) => period.key === payrollPeriodKey) || payrollPeriods[0];
  const selectedPayrollRuns = selectedPayrollPeriod?.runs ?? [];
  const selectedPeriodReturn = workspace?.payrollReturns.find((record) => String(record.data.periodStart || "") === selectedPayrollPeriod?.periodStart && String(record.data.periodEnd || "") === selectedPayrollPeriod?.periodEnd && String(record.data.payDate || "") === selectedPayrollPeriod?.payDate);
  const paylocityReturnCost = numeric(paylocityReturnDraft.grossWages) + numeric(paylocityReturnDraft.employerTaxes) + numeric(paylocityReturnDraft.employerBenefits);
  const paylocityReturnAllocated = paylocityReturnDraft.allocations.reduce((sum, line) => sum + numeric(line.amount), 0);
  const activeProjectFinancials = (workspace?.projects ?? []).filter(isContractedActiveProject);
  const currentAccountingPeriod = dateInput().slice(0, 7);
  const currentDecisionPacks = activeProjectFinancials.filter((project) => project.wipPeriodId === currentAccountingPeriod).length;
  const lossProjects = activeProjectFinancials.filter((project) => project.projectedProfit <= 0);
  const marginRiskProjects = activeProjectFinancials.filter((project) => project.projectedProfit > 0 && project.projectedMargin * 10_000 < PROFITABILITY_FLOOR_BASIS_POINTS);

  async function saveCashAccount() {
    setSaving(true);
    try {
      const result = await accountingAction({ action: "save-cash-account", account: { ...cashDraft, bookBalance: roundMoney(numeric(cashDraft.bookBalance)), bankBalance: roundMoney(numeric(cashDraft.bankBalance)) } });
      setNotice(result.notice || "Cash Account Saved.");
      setCashOpen(false);
      setCashDraft({ id: "", name: "", lastFour: "", bookBalance: "", bankBalance: "", statementDate: dateInput() });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Cash Account Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function savePayrollReport() {
    setSaving(true);
    try {
      const result = await accountingAction({
        action: "save-payroll-report",
        payroll: {
          ...payrollDraft,
          regularHours: numeric(payrollDraft.regularHours),
          overtimeHours: numeric(payrollDraft.overtimeHours),
          ptoHours: numeric(payrollDraft.ptoHours),
          holidayHours: numeric(payrollDraft.holidayHours),
          bonus: roundMoney(numeric(payrollDraft.bonus)),
          reimbursement: roundMoney(numeric(payrollDraft.reimbursement)),
          deduction: roundMoney(numeric(payrollDraft.deduction)),
          allocations: payrollDraft.allocations.filter((line) => line.destination || line.code || numeric(line.hours) > 0).map((line) => ({ ...line, hours: numeric(line.hours) })),
        },
      });
      setNotice(result.notice || "Payroll-Company Report Saved.");
      setPayrollOpen(false);
      setPayrollDraft(emptyPayrollDraft());
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Payroll-Company Report Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function savePaylocityReturn() {
    setSaving(true);
    try {
      const result = await accountingAction({
        action: "record-paylocity-return",
        payrollReturn: {
          ...paylocityReturnDraft,
          grossWages: roundMoney(numeric(paylocityReturnDraft.grossWages)),
          employerTaxes: roundMoney(numeric(paylocityReturnDraft.employerTaxes)),
          employerBenefits: roundMoney(numeric(paylocityReturnDraft.employerBenefits)),
          employeeDeductions: roundMoney(numeric(paylocityReturnDraft.employeeDeductions)),
          netPay: roundMoney(numeric(paylocityReturnDraft.netPay)),
          allocations: paylocityReturnDraft.allocations.filter((line) => line.destination || line.code || numeric(line.amount) > 0).map((line) => ({ ...line, amount: roundMoney(numeric(line.amount)) })),
        },
      });
      setNotice(result.notice || "Paylocity Return Reconciled.");
      setPaylocityReturnOpen(false);
      setPaylocityReturnDraft(emptyPaylocityReturn());
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Paylocity Return Could Not Be Reconciled.");
    } finally {
      setSaving(false);
    }
  }

  async function approvePaylocityReturn(recordId: string) {
    setSaving(true);
    try {
      const result = await accountingAction({ action: "approve-paylocity-return", recordId });
      setNotice(result.notice || "High-Dollar Paylocity Return Approved And Posted.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Paylocity Return Could Not Be Approved.");
    } finally {
      setSaving(false);
    }
  }

  function openPaylocityReturn() {
    if (!selectedPayrollPeriod) return;
    setPaylocityReturnDraft(emptyPaylocityReturn(selectedPayrollPeriod));
    setPaylocityReturnOpen(true);
  }

  function editCash(record: StoredRecord) {
    setCashDraft({ id: record.id, name: String(record.data.name || ""), lastFour: String(record.data.lastFour || ""), bookBalance: String(record.data.bookBalance ?? ""), bankBalance: String(record.data.bankBalance ?? ""), statementDate: String(record.data.statementDate || dateInput()) });
    setCashOpen(true);
  }

  function editPayroll(record: StoredRecord) {
    const allocations = Array.isArray(record.data.allocations) ? record.data.allocations as Array<Record<string, unknown>> : [];
    setPayrollDraft({
      id: record.id,
      payrollCompany: "Paylocity",
      periodStart: String(record.data.periodStart || record.recordDate || dateInput()),
      periodEnd: String(record.data.periodEnd || record.recordDate || dateInput()),
      payDate: String(record.data.payDate || record.due || dateInput()),
      employee: String(record.data.employee || ""),
      employeeIdLastFour: String(record.data.employeeIdLastFour || ""),
      regularHours: String(record.data.regularHours ?? ""),
      overtimeHours: String(record.data.overtimeHours ?? ""),
      ptoHours: String(record.data.ptoHours ?? ""),
      holidayHours: String(record.data.holidayHours ?? ""),
      bonus: String(record.data.bonus ?? ""),
      reimbursement: String(record.data.reimbursement ?? ""),
      deduction: String(record.data.deduction ?? ""),
      notes: String(record.data.notes || ""),
      allocations: allocations.length ? allocations.map((line, index) => ({ id: String(line.id || index), destination: String(line.destination || ""), code: String(line.code || ""), description: String(line.description || ""), hours: String(line.hours ?? "") })) : [{ id: lineId(), destination: "", code: "", description: "", hours: "" }],
    });
    setPayrollOpen(true);
  }

  function downloadPayrollCsv() {
    const headers = ["Payroll Company", "Period Start", "Period End", "Pay Date", "Employee", "Employee ID Last Four", "Regular Hours", "Overtime Hours", "PTO Hours", "Holiday Hours", "Bonus", "Reimbursement", "Deduction", "Project / Overhead", "Cost Code", "Distribution Hours", "Description", "Notes", "Prepared By", "Prepared At"];
    const rows = selectedPayrollRuns.flatMap((record) => {
      const allocations = Array.isArray(record.data.allocations) && record.data.allocations.length ? record.data.allocations as Array<Record<string, unknown>> : [{}];
      return allocations.map((line) => [record.data.payrollCompany, record.data.periodStart, record.data.periodEnd, record.data.payDate, record.data.employee, record.data.employeeIdLastFour, record.data.regularHours, record.data.overtimeHours, record.data.ptoHours, record.data.holidayHours, numeric(record.data.bonus).toFixed(2), numeric(record.data.reimbursement).toFixed(2), numeric(record.data.deduction).toFixed(2), line.destination, line.code, line.hours, line.description, record.data.notes, record.data.preparedBy, record.data.preparedAt]);
    });
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mefford-paylocity-payroll-packet-${selectedPayrollPeriod?.periodEnd || dateInput()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Paylocity Period CSV Downloaded. It Was Not Sent Or Submitted.");
  }

  function printPaylocityPacket() {
    if (!selectedPayrollPeriod || !selectedPayrollRuns.length) return;
    const popup = window.open("", "_blank");
    if (!popup) { setNotice("Allow Pop-Ups To Print Or Save This Paylocity Packet As PDF."); return; }
    popup.opener = null;
    const employeeSections = selectedPayrollRuns.map((record) => {
      const allocations = Array.isArray(record.data.allocations) ? record.data.allocations as Array<Record<string, unknown>> : [];
      return `<section><h2>${htmlCell(record.data.employee)} · ****${htmlCell(record.data.employeeIdLastFour)}</h2><table><tr><th>Regular</th><th>Overtime</th><th>PTO</th><th>Holiday</th><th>Bonus</th><th>Reimbursement</th><th>Deduction</th></tr><tr><td>${htmlCell(record.data.regularHours)}</td><td>${htmlCell(record.data.overtimeHours)}</td><td>${htmlCell(record.data.ptoHours)}</td><td>${htmlCell(record.data.holidayHours)}</td><td>${htmlCell(exactMoney.format(numeric(record.data.bonus)))}</td><td>${htmlCell(exactMoney.format(numeric(record.data.reimbursement)))}</td><td>${htmlCell(exactMoney.format(numeric(record.data.deduction)))}</td></tr></table><h3>Project And Overhead Distribution</h3><table><tr><th>Destination</th><th>Cost Code</th><th>Hours</th><th>Description</th></tr>${allocations.map((line) => `<tr><td>${htmlCell(line.destination)}</td><td>${htmlCell(line.code)}</td><td>${htmlCell(line.hours)}</td><td>${htmlCell(line.description)}</td></tr>`).join("")}</table><p><b>Notes:</b> ${htmlCell(record.data.notes) || "None"}</p></section>`;
    }).join("");
    popup.document.write(`<title>Paylocity Payroll Packet</title><style>body{font:14px Arial;margin:40px;color:#17212b}h1{font-size:24px}h2{margin-top:28px}h3{margin-top:18px}section{break-inside:avoid;margin-top:28px;padding-top:8px;border-top:2px solid #d9e0e6}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd4dc;padding:8px;text-align:left}th{background:#eef2f5}.notice{padding:12px;background:#fff4e7;border-left:4px solid #f47b20}</style><h1>Mefford Contracting · Paylocity Payroll Packet</h1><p class="notice"><b>FILE HANDOFF ONLY — NOT TRANSMITTED:</b> Command Center created this packet for manual delivery to Paylocity. It did not run payroll, pay employees, debit an account, submit taxes, or connect to Paylocity.</p><table><tr><th>Provider</th><td>Paylocity</td><th>Pay Date</th><td>${htmlCell(selectedPayrollPeriod.payDate)}</td></tr><tr><th>Period</th><td>${htmlCell(selectedPayrollPeriod.periodStart)} through ${htmlCell(selectedPayrollPeriod.periodEnd)}</td><th>Employees</th><td>${selectedPayrollRuns.length}</td></tr></table>${employeeSections}`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  if (!workspace && loading) return <div className="accounting-notice">Loading Coordinated Accounting Ledger...</div>;
  const summary = workspace?.summary;

  return (
    <div className="accounting-workspace accounting-control-workspace">
      <section className="accounting-hero accounting-command-hero">
        <div>

          <h1>{mode === "Accounting Command" ? "Accounting Command" : mode}</h1>

        </div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}
      {mode === "Accounting Command" ? <BonusPaymentQueue /> : null}

      {mode === "Accounting Command" ? <section className="accounting-decision-command role-outcome-command">

        <div className={currentDecisionPacks < activeProjectFinancials.length ? "risk" : ""}><small>PM FORECASTS CURRENT</small><strong>{currentDecisionPacks} / {activeProjectFinancials.length}</strong><span>{currentAccountingPeriod} ETC, EAC, risk reserve, and projected-profit packs</span></div>
        <div className={lossProjects.length ? "critical" : ""}><small>PROJECTS AT LOSS</small><strong>{lossProjects.length}</strong><span>{lossProjects.length ? `${money.format(Math.abs(lossProjects.reduce((sum, project) => sum + Math.min(0, project.projectedProfit), 0)))} forecast loss requires immediate PM recovery` : "No current forecast is at or below zero profit"}</span></div>
        <div className={marginRiskProjects.length ? "risk" : ""}><small>MARGIN RECOVERY</small><strong>{marginRiskProjects.length}</strong><span>Forecast below the {(PROFITABILITY_FLOOR_BASIS_POINTS / 100).toFixed(0)}% company profitability floor</span></div>
      </section> : null}

      <section className="accounting-summary-grid accounting-command-summary" aria-label="Accounting Summary">
        <article {...summaryDrilldownProps({ title: "Signed Active Contracts", rows: (workspace?.projects || []).filter(isContractedActiveProject).map((project) => accountingProjectRow(project, "currentContract", setProjectFilter)) })}><span>SIGNED ACTIVE CONTRACTS</span><strong>{money.format(summary?.currentContracts || 0)}</strong><small>{summary?.activeProjects || 0} Signed Projects</small></article>
        <article {...summaryDrilldownProps({ title: "Open Owner Receivables", rows: (workspace?.projects || []).filter((project) => project.accountsReceivable !== 0).map((project) => accountingProjectRow(project, "accountsReceivable", setProjectFilter)) })}><span>OWNER RECEIVABLES</span><strong>{money.format(summary?.accountsReceivable || 0)}</strong><small>{money.format(summary?.ownerReceived || 0)} Cash Received</small></article>
        <article {...summaryDrilldownProps({ title: "Open Project Accounts Payable", rows: (workspace?.projects || []).filter((project) => project.openAp !== 0).map((project) => accountingProjectRow(project, "openAp", setProjectFilter)) })}><span>OPEN ACCOUNTS PAYABLE</span><strong>{money.format(summary?.openAp || 0)}</strong><small>{money.format(summary?.approvedUnpaid || 0)} Approved Or Released</small></article>
        <article {...summaryDrilldownProps({ title: "Projected Gross Profit By Signed Project", rows: (workspace?.projects || []).filter(isContractedActiveProject).map((project) => accountingProjectRow(project, "projectedProfit", setProjectFilter)) })}><span>PROJECTED GROSS PROFIT</span><strong>{money.format(summary?.projectedProfit || 0)}</strong><small>Current Contract Less Current EAC</small></article>
      </section>

      {mode === "Accounting Command" ? <>

        <IssuesPanel issues={workspace?.issues ?? []} />
        <ProjectLedger pendingCount={summary?.pendingContractProjects || 0} pendingValue={summary?.pendingContractValue || 0} projects={projects} projectFilter={projectFilter} setProjectFilter={setProjectFilter} mode="command" />
      </> : null}

      {mode === "Cash Management" ? <>
        <section className="accounting-toolbar"><div><strong>Cash Accounts And Reconciliations</strong><span>Only Account Name And Last Four Digits Are Stored.</span></div><button className="primary-action" onClick={() => setCashOpen(true)}>＋ Add Cash Account</button></section>
        <section className="cash-account-grid">
          {!workspace?.cashAccounts.length ? <div className="accounting-empty"><strong>No Cash Accounts Reconciled Yet</strong><span>Add each operating account using only its name and last four digits.</span></div> : null}
          {workspace?.cashAccounts.map((record) => <article key={record.id}><header><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i><button onClick={() => editCash(record)}>Update</button></header><h3>{record.title}</h3><div><span>Book</span><strong>{exactMoney.format(numeric(record.data.bookBalance))}</strong></div><div><span>Bank</span><strong>{exactMoney.format(numeric(record.data.bankBalance))}</strong></div><footer><span>Difference</span><b>{exactMoney.format(numeric(record.data.difference))}</b></footer></article>)}
        </section>
        <section className="cash-flow-grid"><article {...summaryDrilldownProps({ title: "Owner Cash Received By Project", rows: (workspace?.projects || []).filter((project) => project.ownerReceived !== 0).map((project) => accountingProjectRow(project, "ownerReceived", setProjectFilter)) })}><span>OWNER CASH RECEIVED</span><strong>{money.format(summary?.ownerReceived || 0)}</strong><small>Posted Owner Receipts</small></article><article {...summaryDrilldownProps({ title: "Open Owner Receivables", rows: (workspace?.projects || []).filter((project) => project.accountsReceivable !== 0).map((project) => accountingProjectRow(project, "accountsReceivable", setProjectFilter)) })}><span>OWNER AR OPEN</span><strong>{money.format(summary?.accountsReceivable || 0)}</strong><small>Sent Less Receipts</small></article><article {...summaryDrilldownProps({ title: "Prepared And Released Payment Batches", rows: (workspace?.paymentBatches || []).filter((record) => ["Prepared", "Released"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: `${record.status} · Due ${record.due}`, status: record.status, value: exactMoney.format(numeric(record.data.total)), meta: record.meta })) })}><span>AP PAYMENT PIPELINE</span><strong>{money.format(summary?.preparedBatches || 0)}</strong><small>Prepared Or Released Batches</small></article><article {...summaryDrilldownProps({ title: "Reconciled Cash Accounts", rows: (workspace?.cashAccounts || []).map((record) => ({ id: record.id, title: record.title, subtitle: `Last four ${String(record.data.lastFour || "Not Stored")}`, status: record.status, value: exactMoney.format(numeric(record.data.bookBalance)), meta: `Bank balance ${exactMoney.format(numeric(record.data.bankBalance))} · Difference ${exactMoney.format(numeric(record.data.difference))}` })) })}><span>RECONCILED BOOK CASH</span><strong>{money.format(summary?.reconciledCash || 0)}</strong><small>Latest Reconciled Balances</small></article></section>
        <section className="accounting-dual-panels"><Receivables records={workspace?.receivables ?? []} /><BatchRegister records={workspace?.paymentBatches ?? []} /></section>
        <IssuesPanel issues={(workspace?.issues ?? []).filter((item) => ["Cash", "Reconciliation", "Receivable", "Accounts Payable"].includes(item.area))} />
      </> : null}

      {mode === "Payroll Reports" ? <>

        <section className="accounting-toolbar paylocity-period-toolbar">
          <div><strong>Paylocity Payroll Period</strong><span>Select one period. Packet downloads never combine payroll history.</span></div>
          <label className="paylocity-period-control">Period<select value={selectedPayrollPeriod?.key || ""} onChange={(event) => setPayrollPeriodKey(event.target.value)}><option value="">{payrollPeriods.length ? "Latest Period" : "No Periods Yet"}</option>{payrollPeriods.map((period) => <option key={period.key} value={period.key}>{period.periodStart} — {period.periodEnd} · Pay {period.payDate} · {period.runs.length} Employees</option>)}</select></label>
          <div className="payroll-toolbar-actions"><button className="secondary-action" disabled={!selectedPayrollRuns.length} onClick={downloadPayrollCsv}>Download Paylocity CSV</button><button className="secondary-action" disabled={!selectedPayrollRuns.length} onClick={printPaylocityPacket}>Print / PDF Packet</button><button className="secondary-action" disabled={!selectedPayrollRuns.length || Boolean(selectedPeriodReturn)} onClick={openPaylocityReturn}>{selectedPeriodReturn ? selectedPeriodReturn.status : "Record Paylocity Return"}</button><button className="primary-action" onClick={() => setPayrollOpen(true)}>＋ New Employee Report</button></div>
        </section>
        <section className="accounting-ledger-panel payroll-register"><div className="accounting-ledger-heading"><div><h2>Selected Period Employee Reports</h2></div></div><div className="coordination-table payroll-table" data-reflow-table=""><div className="coordination-row header" data-reflow-head="medium"><span>Period / Employee</span><span>Hours</span><span>Project Detail</span><span>Status</span><span>Action</span></div>{selectedPayrollRuns.map((record) => <div className="coordination-row" key={record.id} data-reflow-row="medium"><span data-label="Period / Employee"><b>{record.title}</b><small>Paylocity · Pay {String(record.data.payDate || record.due)}</small></span><strong data-label="Hours">{numeric(record.data.regularHours) + numeric(record.data.overtimeHours) + numeric(record.data.ptoHours) + numeric(record.data.holidayHours)} Hours</strong><span data-label="Project Detail">{Array.isArray(record.data.allocations) ? record.data.allocations.length : 0} Lines</span><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`} data-label="Status">{record.status}</i><span className="payroll-row-actions" data-label="Action"><button onClick={() => editPayroll(record)}>Edit</button></span></div>)}</div>{!selectedPayrollRuns.length ? <div className="accounting-empty"><strong>No Paylocity Period Packet Yet</strong><span>Create an employee report for the next payroll period. Active employee names come from the company directory.</span></div> : null}</section>
        <section className="accounting-ledger-panel paylocity-return-register"><div className="accounting-ledger-heading"><div><h2>Returned Paylocity Reports</h2></div></div>{workspace?.payrollReturns.length ? <div className="coordination-table payroll-table" data-reflow-table=""><div className="coordination-row header" data-reflow-head="medium"><span>Period</span><span>Reference</span><span>Total Labor Cost</span><span>Status</span><span>Control</span></div>{workspace.payrollReturns.map((record) => <div className="coordination-row" key={record.id} data-reflow-row="medium"><span data-label="Period"><b>{String(record.data.periodStart)} — {String(record.data.periodEnd)}</b><small>Pay {String(record.data.payDate)}</small></span><strong data-label="Reference">{String(record.data.returnReference)}</strong><strong data-label="Total Labor Cost">{exactMoney.format(numeric(record.data.totalLaborCost))}</strong><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`} data-label="Status">{record.status}</i><span data-label="Control">{record.status === "Owner Approval Required" && actor.accessLevel === "Company Owner" ? <button className="primary-action" disabled={saving} onClick={() => void approvePaylocityReturn(record.id)}>Approve + Post</button> : String(record.data.reconciledBy || record.owner)}</span></div>)}</div> : <div className="accounting-empty"><strong>No Paylocity Returns Reconciled Yet</strong><span>After Paylocity sends its report back, Accounting records it here and assigns the labor cost to projects and overhead.</span></div>}</section>
      </> : null}

      {mode === "WIP And Close" ? <>
        <IssuesPanel issues={(workspace?.issues ?? []).filter((item) => ["Contract", "Budget", "WIP", "Owner Billing"].includes(item.area))} />
        <ProjectLedger pendingCount={summary?.pendingContractProjects || 0} pendingValue={summary?.pendingContractValue || 0} projects={projects} projectFilter={projectFilter} setProjectFilter={setProjectFilter} mode="wip" />
      </> : null}

      {mode === "Financial Reports" ? <>
        <section className="report-selection-panel"><div><strong>Live Financial Report</strong></div><div><label><input type="checkbox" defaultChecked /> Current Contract</label><label><input type="checkbox" defaultChecked /> Actual Cost</label><label><input type="checkbox" defaultChecked /> Forecast Profit</label><label><input type="checkbox" defaultChecked /> AP / AR</label></div></section>
        <ProjectLedger pendingCount={summary?.pendingContractProjects || 0} pendingValue={summary?.pendingContractValue || 0} projects={projects} projectFilter={projectFilter} setProjectFilter={setProjectFilter} mode="report" />
        <section className="accounting-dual-panels"><Receivables records={workspace?.receivables ?? []} /><BatchRegister records={workspace?.paymentBatches ?? []} /></section>
      </> : null}

      {cashOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCashOpen(false)}><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="cash-account-title"><div className="modal-heading"><div><h2 id="cash-account-title">{cashDraft.id ? "Update Cash Account" : "Add Cash Account"}</h2></div><button onClick={() => setCashOpen(false)}>×</button></div><div className="field-grid"><label className="field-label">Account Name<input value={cashDraft.name} onChange={(event) => setCashDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Operating Checking" /></label><label className="field-label">Last Four Digits<input value={cashDraft.lastFour} maxLength={4} inputMode="numeric" onChange={(event) => setCashDraft((current) => ({ ...current, lastFour: event.target.value.replace(/\D/g, "") }))} placeholder="0000" /></label><label className="field-label">Book Balance<CurrencyInput allowNegative value={cashDraft.bookBalance} onValueChange={(value) => setCashDraft((current) => ({ ...current, bookBalance: value }))} /></label><label className="field-label">Bank Balance<CurrencyInput allowNegative value={cashDraft.bankBalance} onValueChange={(value) => setCashDraft((current) => ({ ...current, bankBalance: value }))} /></label></div><label className="field-label">Statement Date<input type="date" value={cashDraft.statementDate} onChange={(event) => setCashDraft((current) => ({ ...current, statementDate: event.target.value }))} /></label><div className="permission-note"><strong>No Sensitive Banking Data</strong><span>Do not enter routing numbers full account numbers credentials or wire instructions.</span></div><div className="modal-actions"><button className="secondary-action" onClick={() => setCashOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={() => void saveCashAccount()}>{saving ? "Saving..." : "Save And Reconcile"}</button></div></section></div> : null}

      {payrollOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPayrollOpen(false)}><section className="record-modal payroll-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-report-title">
        <div className="modal-heading"><div><h2 id="payroll-report-title">Employee Payroll Period Report</h2></div><button onClick={() => setPayrollOpen(false)}>×</button></div>

        <div className="field-grid three-column">
          <label className="field-label">Payroll Company<input value="Paylocity" disabled aria-readonly="true" /></label>
          <label className="field-label">Period Start<input type="date" value={payrollDraft.periodStart} onChange={(event) => setPayrollDraft((current) => ({ ...current, periodStart: event.target.value }))} /></label>
          <label className="field-label">Period End<input type="date" value={payrollDraft.periodEnd} onChange={(event) => setPayrollDraft((current) => ({ ...current, periodEnd: event.target.value }))} /></label>
          <label className="field-label">Pay Date<input type="date" value={payrollDraft.payDate} onChange={(event) => setPayrollDraft((current) => ({ ...current, payDate: event.target.value }))} /></label>
          <label className="field-label">Employee<select value={payrollDraft.employee} onChange={(event) => setPayrollDraft((current) => ({ ...current, employee: event.target.value }))}><option value="">Select Active Employee</option>{workspace?.employees.map((employee) => <option key={employee.email} value={employee.name}>{employee.name}</option>)}</select></label>
          <label className="field-label">Employee ID Last Four Only<input inputMode="numeric" maxLength={4} value={payrollDraft.employeeIdLastFour} onChange={(event) => setPayrollDraft((current) => ({ ...current, employeeIdLastFour: event.target.value.replace(/\D/g, "") }))} placeholder="0000" /></label>
        </div>
        <section className="payroll-input-grid">
          <label className="field-label">Regular Hours<input type="number" min="0" step="0.25" value={payrollDraft.regularHours} onChange={(event) => setPayrollDraft((current) => ({ ...current, regularHours: event.target.value }))} /></label>
          <label className="field-label">Overtime Hours<input type="number" min="0" step="0.25" value={payrollDraft.overtimeHours} onChange={(event) => setPayrollDraft((current) => ({ ...current, overtimeHours: event.target.value }))} /></label>
          <label className="field-label">PTO Hours<input type="number" min="0" step="0.25" value={payrollDraft.ptoHours} onChange={(event) => setPayrollDraft((current) => ({ ...current, ptoHours: event.target.value }))} /></label>
          <label className="field-label">Holiday Hours<input type="number" min="0" step="0.25" value={payrollDraft.holidayHours} onChange={(event) => setPayrollDraft((current) => ({ ...current, holidayHours: event.target.value }))} /></label>
          <label className="field-label">Bonus<CurrencyInput min="0" value={payrollDraft.bonus} onValueChange={(value) => setPayrollDraft((current) => ({ ...current, bonus: value }))} /></label>
          <label className="field-label">Reimbursement<CurrencyInput min="0" value={payrollDraft.reimbursement} onValueChange={(value) => setPayrollDraft((current) => ({ ...current, reimbursement: value }))} /></label>
          <label className="field-label">Other Deduction Input<CurrencyInput min="0" value={payrollDraft.deduction} onValueChange={(value) => setPayrollDraft((current) => ({ ...current, deduction: value }))} /></label>
        </section>
        <section className="payroll-allocation-editor"><header><div><strong>Project And Overhead Distribution Detail</strong></div><button className="secondary-action" onClick={() => setPayrollDraft((current) => ({ ...current, allocations: [...current.allocations, { id: lineId(), destination: "", code: "", description: "", hours: "" }] }))}>＋ Add Line</button></header>{payrollDraft.allocations.map((line, index) => <article key={line.id}><label className="field-label">Project / Overhead<select value={line.destination} onChange={(event) => setPayrollDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, destination: event.target.value } : item) }))}><option value="">Select Destination</option><option>Company Overhead</option>{workspace?.projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}</select></label><label className="field-label">Cost Code<input value={line.code} onChange={(event) => setPayrollDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, code: event.target.value } : item) }))} /></label><label className="field-label">Description<input value={line.description} onChange={(event) => setPayrollDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item) }))} /></label><label className="field-label">Hours<input type="number" min="0" step="0.25" value={line.hours} onChange={(event) => setPayrollDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, hours: event.target.value } : item) }))} /></label>{payrollDraft.allocations.length > 1 ? <button aria-label={`Remove Payroll Distribution ${index + 1}`} onClick={() => setPayrollDraft((current) => ({ ...current, allocations: current.allocations.filter((item) => item.id !== line.id) }))}>Remove</button> : null}</article>)}</section>
        <div className="allocation-reconciliation"><span>Total Reported Hours <b>{payrollTotalHours}</b></span><span>Distributed Hours <b>{payrollDistributedHours}</b></span><span>Difference <b>{payrollTotalHours - payrollDistributedHours}</b></span></div>
        <label className="field-label">Paylocity Packet Notes<textarea rows={4} value={payrollDraft.notes} onChange={(event) => setPayrollDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Changes, one-time items, approvals, or questions for Paylocity" /></label>
        <div className="modal-actions"><button className="secondary-action" onClick={() => setPayrollOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !payrollDraft.employee.trim() || !payrollDraft.periodStart || !payrollDraft.periodEnd || !payrollDraft.payDate} onClick={() => void savePayrollReport()}>{saving ? "Saving Report..." : "Save To Period Packet"}</button></div>
      </section></div> : null}

      {paylocityReturnOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPaylocityReturnOpen(false)}><section className="record-modal payroll-modal" role="dialog" aria-modal="true" aria-labelledby="paylocity-return-title">
        <div className="modal-heading"><div><h2 id="paylocity-return-title">Reconcile Returned Payroll Report</h2></div><button onClick={() => setPaylocityReturnOpen(false)}>×</button></div>

        <div className="field-grid three-column">
          <label className="field-label">Provider<input value="Paylocity" disabled aria-readonly="true" /></label>
          <label className="field-label">Period Start<input type="date" value={paylocityReturnDraft.periodStart} disabled /></label>
          <label className="field-label">Period End<input type="date" value={paylocityReturnDraft.periodEnd} disabled /></label>
          <label className="field-label">Pay Date<input type="date" value={paylocityReturnDraft.payDate} disabled /></label>
          <label className="field-label">Paylocity Return Reference<input value={paylocityReturnDraft.returnReference} onChange={(event) => setPaylocityReturnDraft((current) => ({ ...current, returnReference: event.target.value }))} placeholder="Report or batch reference" /></label>
        </div>
        <section className="payroll-input-grid paylocity-return-totals">
          <label className="field-label">Gross Wages<CurrencyInput min="0" value={paylocityReturnDraft.grossWages} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, grossWages: value }))} /></label>
          <label className="field-label">Employer Taxes<CurrencyInput min="0" value={paylocityReturnDraft.employerTaxes} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, employerTaxes: value }))} /></label>
          <label className="field-label">Employer Benefits<CurrencyInput min="0" value={paylocityReturnDraft.employerBenefits} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, employerBenefits: value }))} /></label>
          <label className="field-label">Employee Deductions<CurrencyInput min="0" value={paylocityReturnDraft.employeeDeductions} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, employeeDeductions: value }))} /></label>
          <label className="field-label">Net Pay<CurrencyInput min="0" value={paylocityReturnDraft.netPay} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, netPay: value }))} /></label>
        </section>
        <section className="payroll-allocation-editor"><header><div><strong>Returned Employer Labor Cost Distribution</strong><span>Gross wages plus employer taxes and employer benefits must be fully distributed.</span></div><button className="secondary-action" onClick={() => setPaylocityReturnDraft((current) => ({ ...current, allocations: [...current.allocations, { id: lineId(), destination: "", code: "", description: "", amount: "" }] }))}>＋ Add Line</button></header>{paylocityReturnDraft.allocations.map((line, index) => <article key={line.id}><label className="field-label">Project / Overhead<select value={line.destination} onChange={(event) => setPaylocityReturnDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, destination: event.target.value } : item) }))}><option value="">Select Destination</option><option>Company Overhead</option>{workspace?.projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}</select></label><label className="field-label">Cost Code<input value={line.code} onChange={(event) => setPaylocityReturnDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, code: event.target.value } : item) }))} /></label><label className="field-label">Description<input value={line.description} onChange={(event) => setPaylocityReturnDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item) }))} /></label><label className="field-label">Amount<CurrencyInput min="0" value={line.amount} onValueChange={(value) => setPaylocityReturnDraft((current) => ({ ...current, allocations: current.allocations.map((item) => item.id === line.id ? { ...item, amount: value } : item) }))} /></label>{paylocityReturnDraft.allocations.length > 1 ? <button aria-label={`Remove Returned Payroll Distribution ${index + 1}`} onClick={() => setPaylocityReturnDraft((current) => ({ ...current, allocations: current.allocations.filter((item) => item.id !== line.id) }))}>Remove</button> : null}</article>)}</section>
        <div className="allocation-reconciliation"><span>Returned Employer Labor Cost <b>{exactMoney.format(paylocityReturnCost)}</b></span><span>Distributed <b>{exactMoney.format(paylocityReturnAllocated)}</b></span><span>Difference <b>{exactMoney.format(paylocityReturnCost - paylocityReturnAllocated)}</b></span></div>
        <label className="field-label">Reconciliation Notes<textarea rows={4} value={paylocityReturnDraft.notes} onChange={(event) => setPaylocityReturnDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Accounting notes about the returned Paylocity report" /></label>
        <div className="modal-actions"><button className="secondary-action" onClick={() => setPaylocityReturnOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !paylocityReturnDraft.returnReference.trim() || Math.abs(paylocityReturnCost - paylocityReturnAllocated) > 0.01 || !paylocityReturnDraft.allocations.some((line) => line.destination && line.code)} onClick={() => void savePaylocityReturn()}>{saving ? "Reconciling..." : "Reconcile And Post Labor Cost"}</button></div>
      </section></div> : null}
    </div>
  );
}

function accountingProjectRow(project: ProjectFinancial, field: "currentContract" | "accountsReceivable" | "openAp" | "projectedProfit" | "ownerReceived", filter: (value: string) => void) {
  const labels = { currentContract: "Current Contract", accountsReceivable: "Owner AR", openAp: "Open AP", projectedProfit: "Projected Profit", ownerReceived: "Owner Cash Received" };
  return { id: `${project.number}-${field}`, title: project.name, subtitle: `${project.number} · ${project.projectManager}`, status: project.status, value: exactMoney.format(project[field]), meta: `${labels[field]} · ${(project.projectedMargin * 100).toFixed(1)}% projected margin`, onOpen: () => filter(project.number), openLabel: "Filter Project →" };
}

function IssuesPanel({ issues }: { issues: AccountingData["issues"] }) {
  return <section className="accounting-exceptions" aria-label="Coordination Exceptions"><header><div><h2>Accounting Exceptions That Require A Decision</h2></div><span>{issues.filter((item) => item.severity !== "Ready").length} Need Attention</span></header><div>{issues.map((item) => <article key={item.id} className={item.severity.toLowerCase()}><i>{item.severity === "Critical" ? "!" : item.severity === "Review" ? "•" : "✓"}</i><span><b>{item.area} · {item.project} · {item.accountableRole || "Accounting"}</b><small>{item.message}</small>{item.decision ? <em><b>DECISION:</b> {item.decision}</em> : null}{item.supportRole ? <em><b>ASSIST:</b> {item.supportRole}</em> : null}</span><strong>{item.target}</strong></article>)}</div></section>;
}

function ProjectLedger({ projects, projectFilter, setProjectFilter, mode, pendingCount, pendingValue }: { pendingCount: number; pendingValue: number; projects: ProjectFinancial[]; projectFilter: string; setProjectFilter: (value: string) => void; mode: "command" | "wip" | "report" }) {
  return <section className="accounting-ledger-panel coordinated-project-ledger"><div className="accounting-ledger-heading"><div><h2>{mode === "wip" ? "Project WIP And Close" : mode === "report" ? "Project Financial Report" : "Coordinated Project Ledger"}</h2></div><button className="secondary-action" onClick={() => setProjectFilter("Awaiting Signatures")}>Awaiting Signatures · {pendingCount} · {money.format(pendingValue)}</button><select aria-label="Project Contract Status" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option>Active Projects</option><option>Awaiting Signatures</option><option>All Projects</option>{!["Active Projects", "All Projects", "Awaiting Signatures"].includes(projectFilter) ? <option value={projectFilter}>{projects.find(project => project.number === projectFilter)?.name || projectFilter}</option> : null}</select></div><div className="coordination-table" data-reflow-table=""><div className="coordination-row header" data-reflow-head="wide"><span>Project</span><span>Contract</span><span>{mode === "wip" ? "Recognized Revenue" : "Actual / EAC"}</span><span>Owner Billing</span><span>AP / AR</span><span>Forecast</span><span>Controls</span></div>{projects.map((project) => <div className="coordination-row" key={project.number} data-reflow-row="wide"><span data-label="Project"><b>{project.number} · {project.name}</b><small>{project.projectManager} · {project.contractType}</small></span><span data-label="Contract"><b>{money.format(project.currentContract)}</b><small>{project.contractStatus} · CO {money.format(project.approvedChanges)}</small></span><span data-label="Budget / Profit"><b>{money.format(mode === "wip" ? project.recognizedRevenue : project.actualCost)} / {money.format(project.estimatedCost)}</b><small>{(project.costCompletion * 100).toFixed(1)}% Cost Complete</small></span><span data-label="Owner Billing"><b>{money.format(project.ownerBilled)}</b><small>{money.format(project.ownerReceived)} Received</small></span><span data-label="AP / AR"><b>{money.format(project.openAp)} / {money.format(project.accountsReceivable)}</b><small>Open AP / Open AR</small></span><span data-label="Forecast"><b>{money.format(project.projectedProfit)}</b><small>{(project.projectedMargin * 100).toFixed(1)}% Projected Margin</small></span><span className="ledger-control-chips" data-label="Controls"><i className={project.contractAuthorized ? "ready" : "blocked"}>Contract</i><i className={project.budgetLocked ? "ready" : "blocked"}>Budget</i><i className={project.billingSetupLocked ? "ready" : "review"}>SOV</i>{mode === "wip" ? <i className={project.readyToClose ? "ready" : "review"}>{project.readyToClose ? "Close Ready" : project.overUnderBilling > 0 ? "Billings In Excess" : "Costs In Excess"}</i> : null}</span></div>)}</div></section>;
}

function Receivables({ records }: { records: AccountingData["receivables"] }) {
  return <section className="accounting-mini-register"><header><div><strong>Owner Receivables</strong><span>Ready sent and partially paid owner invoices.</span></div><b>{records.length}</b></header>{records.length ? records.map((record) => <article key={`${record.projectId}-${record.id}`}><span><b>{record.title}</b><small>{record.projectId} · Due {record.due}</small></span><strong>{exactMoney.format(Math.max(0, numeric(record.data.currentPaymentDue) - numeric(record.data.receivedToDate)))}</strong><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i></article>) : <div className="accounting-empty"><strong>No Open Owner Receivables</strong><span>Finalized owner invoices will appear here.</span></div>}</section>;
}

function BatchRegister({ records }: { records: StoredRecord[] }) {
  return <section className="accounting-mini-register"><header><div><strong>Payment Batches</strong><span>Prepared released and cleared cash-out records.</span></div><b>{records.length}</b></header>{records.length ? records.map((record) => <article key={record.id}><span><b>{record.title}</b><small>{record.owner} · {record.recordDate}</small></span><strong>{exactMoney.format(numeric(record.data.total))}</strong><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i></article>) : <div className="accounting-empty"><strong>No Payment Batches</strong><span>Approved unpaid invoices can be grouped in Accounts Payable.</span></div>}</section>;
}
