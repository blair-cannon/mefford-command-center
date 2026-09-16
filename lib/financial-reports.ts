export const FINANCIAL_REPORT_TYPES = [
  "project-financials",
  "management-profitability",
  "wip",
  "ap-aging",
  "ar-aging",
  "commitment-audit",
  "cash-movement",
  "backlog",
] as const;

export type FinancialReportType = (typeof FINANCIAL_REPORT_TYPES)[number];

export const FINANCIAL_REPORT_LABELS: Record<FinancialReportType, string> = {
  "project-financials": "Project Financials",
  "management-profitability": "Management Job Profitability",
  wip: "WIP And Billing Position",
  "ap-aging": "Accounts Payable Aging",
  "ar-aging": "Accounts Receivable Aging",
  "commitment-audit": "Subcontract And PO Audit",
  "cash-movement": "Cash Movement Register",
  backlog: "Backlog",
};

export const FINANCIAL_COMPARISONS = [
  "Current Month",
  "Year-To-Date",
  "Annual Budget",
  "Prior Year",
] as const;

export type FinancialComparison = (typeof FINANCIAL_COMPARISONS)[number];

export const FINANCIAL_REPORT_RUN_TYPE = "Financial Report Run";
