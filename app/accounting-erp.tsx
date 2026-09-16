"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNTING_CATEGORIES,
  type AccountingBalance,
  type LedgerAccountSeed,
} from "./accounting-data";
import { buildAccountCatalog } from "../lib/accounting-catalog";
import { ACCOUNT_NUMBER_RANGES, accountNumberError } from "../lib/accounting-numbering";
import { AccountsPayableWorkspace } from "./accounts-payable";
import { AccountingControlWorkspace } from "./accounting-control";
import { AccountingAdvancedWorkspace } from "./accounting-advanced";
import { FinancialReportsWorkspace } from "./financial-reports";
import { GeneralLedgerWorkspace } from "./general-ledger";
import { LienWaiverWorkspace } from "./lien-waivers";
import { summaryDrilldownProps } from "./summary-drilldown";
import { OwnerBillingWorkspace } from "./owner-billing";
import { VendorManagementWorkspace } from "./vendor-management";
import { AssetTrackingWorkspace } from "./asset-tracking-workspace";

export type AccountingMode =
  | "Accounting Command"
  | "Chart Of Accounts"
  | "General Ledger"
  | "Fixed Assets"
  | "Accounts Payable"
  | "Lien Waivers"
  | "Owner Billing"
  | "Cash Management"
  | "Payroll Reports"
  | "WIP And Close"
  | "Financial Reports"
  | "Accounting Administration"
  | "Vendor Management";

export type AccountingActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type StoredAccountingRecord = {
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type DisplayAccount = LedgerAccountSeed & {
  status: string;
  source: string;
  persisted?: StoredAccountingRecord;
};

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";

const workflowPages: Record<
  Exclude<AccountingMode, "Accounting Command" | "Chart Of Accounts" | "General Ledger" | "Fixed Assets">,
  {
    eyebrow: string;
    heading: string;
    description: string;
    lanes: Array<{ title: string; detail: string; status: string }>;
    rules: string[];
  }
> = {
  "Accounts Payable": {
    eyebrow: "ACCOUNTING CONTROL",
    heading: "Accounts Payable And Payments",
    description:
      "Invoice Intake Three-Way Matching Approval And Controlled Payment Release.",
    lanes: [
      { title: "Invoice Intake", detail: "Upload Email Or Phone Photo", status: "Ready For Build" },
      { title: "Project Review", detail: "PM Confirms Cost Code And Work", status: "Required" },
      { title: "Accounting Review", detail: "Duplicate Compliance And Budget Check", status: "Required" },
      { title: "Payment Batch", detail: "Check Bank Bill Pay Ramp Or Wire", status: "Owner Release" },
    ],
    rules: [
      "Project Invoices Match A Subcontract Purchase Order Or Documented Direct Expense.",
      "A Project Invoice Above $5,000.00 Without A Purchase Order Alerts Owners And Administrators.",
      "Purchase Orders Above $10,000.00 Require Owner Approval.",
      "Invoices Above $200,000.00 Require Owner Approval Before Payment.",
      "Original Approved Transactions Are Corrected By Void Credit Memo Or Adjustment.",
    ],
  },
  "Lien Waivers": {
    eyebrow: "PAYMENT AND CLOSEOUT CONTROL",
    heading: "Lien Waiver Command",
    description: "Four Controlled Forms With State Routing Cleared-Payment Proof And Permanent Billing Links.",
    lanes: [
      { title: "Conditional Progress", detail: "Required With Project Billing", status: "Payment Gate" },
      { title: "Unconditional Progress", detail: "Requested After Cleared Payment", status: "Never Automatic" },
      { title: "Conditional Final", detail: "Required Before Final Payment", status: "Closeout Gate" },
      { title: "Unconditional Final", detail: "Required After Final Payment", status: "Total Closeout Gate" },
    ],
    rules: [
      "Project State And Private Or Public / Bonded Classification Control The Form Language.",
      "No Unconditional Waiver Can Be Signed Or Approved Before Cleared Payment Evidence.",
      "A Company Owner Override Is One-Time Audited And Never Creates Or Signs A Missing Waiver.",
      "Every Form Links To The Vendor Commitment Billing Record Payment And Closeout Requirement.",
      "Controlled Masters Require Initial Counsel And Owner Approval Plus Annual Owner Review.",
    ],
  },
  "Owner Billing": {
    eyebrow: "CONSTRUCTION BILLING",
    heading: "Owner Billing And Collections",
    description:
      "AIA-Style And Standard Billing With Individual Change Orders Retainage And Collections.",
    lanes: [
      { title: "PM Preparation", detail: "Schedule Of Values And Supporting Costs", status: "First Signoff" },
      { title: "Accountant Review", detail: "Contract Billing And Retainage Check", status: "Second Signoff" },
      { title: "Owner Approval", detail: "Final Review Before Submission", status: "Final Signoff" },
      { title: "Cash Receipt", detail: "Allocate Receipt And Suggest Related AP", status: "Accountant" },
    ],
    rules: [
      "Base Contract Value Appears First On Every AIA-Style Invoice.",
      "Each Approved Change Order Appears Individually Below The Base Contract.",
      "Retainage Is 10% Through 50% Completion Then Released To A 5% Cumulative Balance.",
      "Pending Change Orders Remain Separate Until Approved.",
      "Partial Payments And Shortages Remain Open Until Fully Resolved.",
    ],
  },
  "Cash Management": {
    eyebrow: "ACCOUNTANT CONTROLLED",
    heading: "Cash Management And 13-Week Forecast",
    description:
      "Connected Accounts Credit Cards Open AP Expected AP And Owner Receipts In One Forecast.",
    lanes: [
      { title: "Bank Accounts", detail: "Secure Read-Only Transaction Feeds", status: "IT Connection Required" },
      { title: "Ramp", detail: "Native Project And Cost Code Coding", status: "Planned Integration" },
      { title: "Chase Card", detail: "Receipt And Coding Inside Command Center", status: "Planned Integration" },
      { title: "Scheduled Wires", detail: "Accountant Prepares Owner Releases", status: "Bank Executes" },
    ],
    rules: [
      "The Accountant Exclusively Manages Company And Project Cash Forecasts.",
      "Open AP Remains In The Forecast Until Its Payment Clears.",
      "Owner Receipts Mark Related AP As Funded Without Removing The Liability.",
      "Every Wire Requires Owner Approval And Payments Above $200,000.00 Require Two Owners.",
      "Pending Transactions Display Immediately But Post Only After Final Bank Status.",
    ],
  },
  "Payroll Reports": {
    eyebrow: "PAYLOCITY FILE HANDOFF",
    heading: "Paylocity Payroll Packets",
    description:
      "One Download Packet Per Payroll Period Followed By Manual Accounting Reconciliation Of Paylocity's Returned Report.",
    lanes: [
      { title: "1st Through 15th", detail: "Employee Submission By The 15th", status: "Paid On 22nd" },
      { title: "16th Through EOM", detail: "Employee Submission By Month-End", status: "Paid On 7th" },
      { title: "Manager Review", detail: "Superintendent Or PM Approval", status: "Required" },
      { title: "Paylocity Packet", detail: "Period CSV And Print-Ready File", status: "Manual Handoff" },
    ],
    rules: [
      "Command Center Never Connects To Paylocity Runs Payroll Pays Employees Or Files Payroll Taxes.",
      "Reports Include Regular Overtime PTO Holiday Bonus Reimbursement And Deduction Inputs.",
      "Outgoing Project And Cost-Code Hours Remain Reporting Detail Only.",
      "Accounting Manually Sends Each Period Packet To Paylocity And Manually Records The Returned Report.",
      "Only The Reconciled Returned Paylocity Report Posts Employer Labor Cost To Project Actuals And Overhead.",
      "Only Last-Four Employee References Are Stored In Payroll Packets.",
    ],
  },
  "WIP And Close": {
    eyebrow: "MONTH-END CONTROL",
    heading: "WIP Review And Accounting Close",
    description:
      "Cost-To-Cost WIP With A Complete Reconciliation And Owner-Controlled Period Lock.",
    lanes: [
      { title: "PM Forecast", detail: "Estimated Cost To Complete By Cost Code", status: "Required" },
      { title: "Accountant Review", detail: "Cost-To-Cost WIP And Reconciliations", status: "Required" },
      { title: "Owner Approval", detail: "Final WIP And Monthly Close", status: "Required" },
      { title: "Period Lock", detail: "Owner-Only Reopen With Written Reason", status: "Permanent Audit" },
    ],
    rules: [
      "All Bank And Credit Card Accounts Must Be Reconciled.",
      "AP AR Payroll Reports And WIP Must Be Complete.",
      "Account 1500 Suspense Must Equal Zero Unless An Owner Documents An Override.",
      "Nobody Can Approve Their Own Journal Entry Or Financial Transaction.",
      "Every Journal Entry Requires Balanced Debits Credits Description And Support.",
    ],
  },
  "Financial Reports": {
    eyebrow: "REPORT BUILDER",
    heading: "Financial Reports",
    description:
      "Choose A Standalone View Any Combination Or Every Comparison Together.",
    lanes: [
      { title: "Profit And Loss", detail: "Current Month YTD Budget Prior Year", status: "Selectable" },
      { title: "Project Financials", detail: "Job P&L Budget Actual Forecast", status: "Project Access" },
      { title: "Sub Audit", detail: "Contract Changes Invoiced Paid Remaining", status: "By Project" },
      { title: "Company Reports", detail: "Balance Sheet Cash Flow WIP AP AR Backlog", status: "Restricted" },
    ],
    rules: [
      "Every Total Drills Down To The Transaction Approval Payment And Supporting Document.",
      "Sub Audits Include Retainage Approved But Unpaid And Pending Changes Separately.",
      "Every Report Supports An As-Of Date And PDF Or Excel Export.",
      "Scheduled Delivery Activates After Microsoft 365 Email Integration.",
      "The Company Financial Dashboard Remains Deferred For Further Design.",
    ],
  },
  "Accounting Administration": {
    eyebrow: "ACCOUNTING CONTROL CENTER",
    heading: "Accounting Administration",
    description: "Month-End Controls Historical Cutover Aging Tax Readiness And Independent Approval In One Accountant-First Workspace.",
    lanes: [
      { title: "Control Center", detail: "Current exceptions and close readiness", status: "Live" },
      { title: "Month Close", detail: "Ten evidenced and independently reviewed controls", status: "Controlled" },
      { title: "Cutover", detail: "Opening balances and subsidiary reconciliations", status: "Owner Lock" },
      { title: "AP AR Tax", detail: "Aging collections W-9 and 1099 readiness", status: "Live" },
    ],
    rules: [
      "Opening balances are posted once through a balanced journal entry.",
      "Completed close tasks require evidence and independent review.",
      "Owner lock makes the cutover immutable; corrections use audited journal entries.",
      "Vendor tax readiness displays W-9 status and paid-to-date before year-end review.",
    ],
  },
  "Vendor Management": {
    eyebrow: "ONE COMPANY RECORD",
    heading: "Vendors And Subcontractors",
    description:
      "Every Subcontractor Is An Accounting Vendor And A Selectable Estimating Partner.",
    lanes: [
      { title: "Prospective", detail: "Company And Contact Created", status: "Not Selectable" },
      { title: "Conditional", detail: "Missing Or Expired Requirement", status: "Owner Approval" },
      { title: "Approved", detail: "Available Across Estimating And Projects", status: "Selectable" },
      { title: "Blacklisted", detail: "Blocked From New Work Company-Wide", status: "Owner Only" },
    ],
    rules: [
      "Blacklisting Requires An Owner Reason Date And Permanent Audit History.",
      "Existing Obligations Remain Visible And Require An Owner Decision.",
      "W-9 Insurance Licenses Trades Service Areas Safety And Payment Details Are Tracked.",
      "Tax IDs Show Last Four To Everyone And Full Values To Owners Administrators And Accountants.",
      "Vendor Banking Changes Require Independent Verification And Owner Approval.",
    ],
  },
};

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function saveAccountingRecord(record: StoredAccountingRecord) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: ACCOUNTING_PROJECT_ID,
      recordType: record.type,
      record,
    }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "The Accounting Record Could Not Be Saved.");
  }
}

export function AccountingWorkspace({
  mode,
  actor,
  onNavigate,
  initialProjectId,
}: {
  mode: AccountingMode;
  actor: AccountingActor;
  onNavigate?: (target: string) => void;
  initialProjectId?: string;
}) {
  if (mode === "Financial Reports") {
    return <FinancialReportsWorkspace actor={actor} />;
  }
  if (["Cash Management", "WIP And Close", "Accounting Administration"].includes(mode)) {
    return <AccountingAdvancedWorkspace mode={mode as "Cash Management" | "WIP And Close" | "Accounting Administration"} actor={actor} />;
  }
  if (mode === "Accounting Command" || mode === "Payroll Reports") {
    return <AccountingControlWorkspace mode={mode as "Accounting Command" | "Payroll Reports"} actor={actor} />;
  }
  if (mode === "Chart Of Accounts") {
    return <ChartOfAccountsWorkspace actor={actor} />;
  }
  if (mode === "General Ledger") {
    return <GeneralLedgerWorkspace actor={actor} onNavigate={onNavigate} />;
  }
  if (mode === "Fixed Assets") {
    return <AssetTrackingWorkspace actor={actor} initialView="Accounting" accountingMode />;
  }
  if (mode === "Accounts Payable") {
    return <AccountsPayableWorkspace actor={actor} />;
  }
  if (mode === "Lien Waivers") {
    return <LienWaiverWorkspace actor={actor} initialProjectId={initialProjectId} />;
  }
  if (mode === "Owner Billing") {
    return <OwnerBillingWorkspace actor={actor} initialProjectId={initialProjectId} />;
  }
  if (mode === "Vendor Management") {
    return <VendorManagementWorkspace actor={actor} />;
  }
  return <AccountingWorkflowPage mode={mode} />;
}

function ChartOfAccountsWorkspace({ actor }: { actor: AccountingActor }) {
  const [storedRecords, setStoredRecords] = useState<StoredAccountingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [status, setStatus] = useState("All Statuses");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string>(ACCOUNTING_CATEGORIES[0]);
  const [newBalance, setNewBalance] = useState<AccountingBalance>("Debit");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/records?projectId=${ACCOUNTING_PROJECT_ID}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          records?: StoredAccountingRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Accounting Records Are Unavailable.");
        return data.records ?? [];
      })
      .then((records) => !cancelled && setStoredRecords(records))
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Accounting Records Are Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const open = () => setNewAccountOpen(true);
    window.addEventListener("command:new-account", open);
    return () => window.removeEventListener("command:new-account", open);
  }, []);

  const catalog = useMemo(() => {
    try { return { accounts: buildAccountCatalog(storedRecords), error: "" }; }
    catch (error) { return { accounts: [], error: error instanceof Error ? error.message : "The Chart Could Not Be Loaded." }; }
  }, [storedRecords]);
  const accounts = useMemo<DisplayAccount[]>(() => catalog.accounts.map(account => ({ ...account, persisted: storedRecords.find(record => record.id === account.persistedId) })), [catalog.accounts, storedRecords]);

  const filteredAccounts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return accounts.filter(
      (account) =>
        (!search ||
          account.accountNumber.includes(search) ||
          account.legacyName.toLowerCase().includes(search)) &&
        (category === "All Categories" || account.category === category) &&
        (status === "All Statuses" || account.status === status),
    );
  }, [accounts, category, query, status]);

  const statusCounts = accounts.reduce<Record<string, number>>((counts, account) => {
    counts[account.status] = (counts[account.status] ?? 0) + 1;
    return counts;
  }, {});

  async function setAccountStatus(account: DisplayAccount, nextStatus: string) {
    setSaving(true);
    const record: StoredAccountingRecord = {
      id: account.persisted?.id || account.accountNumber,
      type: "Chart Of Accounts",
      title: account.legacyName,
      owner: actor.name,
      due: today(),
      status: nextStatus,
      recordDate: today(),
      data: {
        ...account.persisted?.data,
        accountNumber: account.accountNumber,
        legacyAccountNumber: account.legacyAccountNumber,
        category: account.category,
        normalBalance: account.normalBalance,
        source: account.source,
        statusChangedBy: actor.name,
      },
    };
    try {
      await saveAccountingRecord(record);
      window.dispatchEvent(new Event("command:chart-updated"));
      setStoredRecords((current) => [
        record,
        ...current.filter((item) => item.id !== record.id),
      ]);
      setNotice(`Account ${account.accountNumber} Is Now ${nextStatus}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Account Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  async function proposeAccount() {
    const accountNumber = newNumber.trim();
    const accountName = newName.trim();
    const numberError = accountNumberError(accountNumber, newCategory);
    if (numberError) { setNotice(numberError); return; }
    if (!accountNumber || !accountName) {
      setNotice("Account Number And Account Name Are Required.");
      return;
    }
    if (accounts.some((account) => account.accountNumber === accountNumber)) {
      setNotice(`Account Number ${accountNumber} Already Exists.`);
      return;
    }
    setSaving(true);
    const record: StoredAccountingRecord = {
      id: accountNumber,
      type: "Chart Of Accounts",
      title: accountName,
      owner: actor.name,
      due: today(),
      status: "Proposed",
      recordDate: today(),
      data: {
        category: newCategory,
        normalBalance: newBalance,
        source: "Command Center",
        proposedBy: actor.name,
      },
    };
    try {
      await saveAccountingRecord(record);
      window.dispatchEvent(new Event("command:chart-updated"));
      setStoredRecords((current) => [record, ...current]);
      setNewAccountOpen(false);
      setNewNumber("");
      setNewName("");
      setNotice(`Account ${accountNumber} Was Proposed And Requires Owner Activation.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Account Could Not Be Proposed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="accounting-workspace">
      <section className="accounting-hero">
        <div>

          <h1>Chart Of Accounts</h1>

        </div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}

      <section className="accounting-summary-grid" aria-label="Chart Of Accounts Summary">
        <article {...summaryDrilldownProps({ title: "Command Center Chart Of Accounts", rows: accounts.map((account) => accountSummaryRow(account, setQuery, setStatus)) })}><span>CONTROLLED ACCOUNTS</span><strong>{accounts.length}</strong><small>{ACCOUNTING_CATEGORIES.length} Account Categories</small></article>
        <article {...summaryDrilldownProps({ title: "Active Accounts", rows: accounts.filter((account) => account.status === "Active").map((account) => accountSummaryRow(account, setQuery, setStatus)) })}><span>ACTIVE</span><strong>{statusCounts.Active ?? 0}</strong><small>Approved For Native Posting</small></article>
        <article {...summaryDrilldownProps({ title: "Accounts Pending Review", rows: accounts.filter((account) => account.status === "Pending Review").map((account) => accountSummaryRow(account, setQuery, setStatus)) })}><span>PENDING REVIEW</span><strong>{statusCounts["Pending Review"] ?? 0}</strong><small>Awaiting Owner Approval</small></article>
        <article {...summaryDrilldownProps({ title: "Inactive Accounts", rows: accounts.filter((account) => account.status === "Inactive").map((account) => accountSummaryRow(account, setQuery, setStatus)) })}><span>INACTIVE</span><strong>{statusCounts.Inactive ?? 0}</strong><small>Preserved But Not Selectable</small></article>
      </section>

      <section className="accounting-control-strip">
        <div>
          <strong>Individual Account Review</strong>
          <span>{statusCounts.Active ?? 0} Approved · {statusCounts["Pending Review"] ?? 0} Awaiting Review · Approve Each Account Independently.</span>
        </div>
        <button className="secondary-action" onClick={() => setNewAccountOpen(true)}>＋ New Account</button>
      </section>

      {catalog.error ? <p role="alert" className="permission-note">{catalog.error}</p> : null}
      <details className="permission-note"><summary>Four-Digit Account Ranges And Legacy Crosswalk</summary><p>Existing three-digit accounts gain a trailing zero. Posted entries retain their original numbers in history.</p><table><thead><tr><th>Category</th><th>Range</th></tr></thead><tbody>{ACCOUNT_NUMBER_RANGES.map(range => <tr key={range.category}><td>{range.category}</td><td>{range.start}–{range.end}</td></tr>)}</tbody></table></details>
      <section className="accounting-special-controls">
        <article><b>1500</b><span><strong>Suspense Control</strong><small>Must Equal Zero Before Month Close.</small></span></article>
        <article><b>4030 / 4100</b><span><strong>Retirement Liabilities</strong><small>Employee IRA And Employer Match Payable.</small></span></article>
        <article><b>4130 / 4150</b><span><strong>Credit Card Control</strong><small>Chase And Ramp With Subaccounts.</small></span></article>
        <article><b>$10,000.00</b><span><strong>Capitalization Threshold</strong><small>Provisional Until CPA Confirmation.</small></span></article>
      </section>

      <section className="accounting-ledger-panel">
        <div className="accounting-ledger-heading">
          <div>
            <h2>All Accounts</h2>
            <span>{filteredAccounts.length} Of {accounts.length} Accounts Shown</span>
          </div>
          <div className="accounting-filters">
            <input aria-label="Search Chart Of Accounts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Number Or Name" />
            <select aria-label="Filter Account Category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>All Categories</option>
              {ACCOUNTING_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select aria-label="Filter Account Status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>All Statuses</option>
              <option>Pending Review</option>
              <option>Proposed</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
        </div>
        <div className="accounting-ledger-table" role="table" aria-label="Command Center Chart Of Accounts" data-reflow-table="">
          <div className="accounting-ledger-row header" role="row" data-reflow-head="medium">
            <span role="columnheader">Account</span><span role="columnheader">Account Name</span><span role="columnheader">Category</span><span role="columnheader">Balance</span><span role="columnheader">Status</span><span role="columnheader">Control</span>
          </div>
          {filteredAccounts.map((account) => (
            <div className="accounting-ledger-row" role="row" key={account.accountNumber} data-reflow-row="medium">
              <strong role="cell" data-label="Account">{account.accountNumber}{account.legacyAccountNumber ? <small>Previously {account.legacyAccountNumber}</small> : null}</strong>
              <span role="cell" data-label="Account Name"><b>{account.legacyName}</b><small>{account.source}</small></span>
              <span role="cell" data-label="Category">{account.category}</span>
              <span role="cell" data-label="Balance">{account.normalBalance}</span>
              <span role="cell" data-label="Status"><i className={`account-status ${account.status.toLowerCase().replaceAll(" ", "-")}`}>{account.status}</i></span>
              <span className="account-row-actions" role="cell" data-label="Control">
                {account.isSystemControl ? <span>System Control</span> : (account.status === "Pending Review" || account.status === "Proposed") ? (
                  <button
                    aria-label={`Approve Account ${account.accountNumber}`}
                    disabled={saving || loading || actor.accessLevel !== "Company Owner"}
                    onClick={() => setAccountStatus(account, "Active")}
                  >Approve</button>
                ) : account.status === "Inactive" ? (
                  <button disabled={saving || actor.accessLevel !== "Company Owner"} onClick={() => setAccountStatus(account, "Active")}>Activate</button>
                ) : account.status === "Active" ? (
                  <button disabled={saving || actor.accessLevel !== "Company Owner"} onClick={() => setAccountStatus(account, "Inactive")}>Retire</button>
                ) : <span>Review Required</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      {newAccountOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setNewAccountOpen(false)}>
          <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="new-account-title">
            <div className="modal-heading"><div><h2 id="new-account-title">Propose New Account</h2></div><button aria-label="Close New Account" onClick={() => setNewAccountOpen(false)}>×</button></div>
            <div className="field-grid">
              <label className="field-label">Account Number<input value={newNumber} onChange={(event) => setNewNumber(event.target.value)} inputMode="numeric" maxLength={4} pattern="[1-9][0-9]{3}" placeholder={String(ACCOUNT_NUMBER_RANGES.find(range => range.category === newCategory)?.start || 1000)} /></label>
              <label className="field-label">Normal Balance<select value={newBalance} onChange={(event) => setNewBalance(event.target.value as AccountingBalance)}><option>Debit</option><option>Credit</option></select></label>
            </div>
            <p>{newCategory}: {ACCOUNT_NUMBER_RANGES.find(range => range.category === newCategory)?.start}–{ACCOUNT_NUMBER_RANGES.find(range => range.category === newCategory)?.end}</p>
            <label className="field-label">Account Name<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Enter Account Name" /></label>
            <label className="field-label">Account Category<select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>{ACCOUNTING_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <div className="permission-note"><strong>Owner Activation Required</strong><span>The Proposed Account Cannot Receive Transactions Until An Owner Approves It.</span></div>
            <div className="modal-actions"><button className="secondary-action" onClick={() => setNewAccountOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={proposeAccount}>{saving ? "Saving Proposal..." : "Save Proposed Account"}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function accountSummaryRow(account: DisplayAccount, setQuery: (value: string) => void, setStatus: (value: string) => void) {
  return { id: account.accountNumber, title: account.legacyName, subtitle: `${account.accountNumber} · ${account.category}`, status: account.status, meta: `${account.normalBalance} normal balance · ${account.source}`, onOpen: () => { setStatus("All Statuses"); setQuery(account.accountNumber); }, openLabel: "Show Account →" };
}

function AccountingWorkflowPage({ mode }: { mode: Exclude<AccountingMode, "Accounting Command" | "Chart Of Accounts" | "General Ledger" | "Fixed Assets"> }) {
  const page = workflowPages[mode];
  const [reportSelections, setReportSelections] = useState(["Current Month", "Year-To-Date"]);
  const [notice, setNotice] = useState("");
  const reportOptions = ["Current Month", "Year-To-Date", "Annual Budget", "Prior Year"];
  return (
    <div className="accounting-workspace">
      <section className="accounting-hero">
        <div><h1>{page.heading}</h1></div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}

      {mode === "Financial Reports" ? (
        <section className="report-selection-panel">
          <div><strong>Report Comparisons</strong><span>Select One Any Combination Or All.</span></div>
          <div>{reportOptions.map((option) => <label key={option}><input type="checkbox" checked={reportSelections.includes(option)} onChange={() => setReportSelections((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option])} />{option}</label>)}</div>
        </section>
      ) : null}

      <section className="accounting-workflow-grid">
        {page.lanes.map((lane, index) => (
          <article key={lane.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{lane.title}</strong><p>{lane.detail}</p><i>{lane.status}</i></div></article>
        ))}
      </section>

      <section className="accounting-rules-panel">
        <div><h2>Workflow Controls</h2></div>
        <ul>{page.rules.map((rule) => <li key={rule}><b>✓</b><span>{rule}</span></li>)}</ul>
      </section>

      <section className="accounting-empty-stage">
        <span>ERP</span>
        <div><strong>No Live Financial Transactions Yet</strong><p>This Native ERP Section Is Ready For Controlled Testing And Production Certification.</p></div>
        <button className="secondary-action" onClick={() => setNotice(`${mode} Remains In Testing Until The Accounting Cutover Is Approved.`)}>Review Testing Status</button>
      </section>
    </div>
  );
}
