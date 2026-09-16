export type WorkflowReconciliationContract = {
  workflowId: string;
  eventTypes: string[];
  producerRoute: string;
  authoritativeTrigger: string;
  mandatoryConsumers: string[];
};

const contract = (
  workflowId: string,
  eventTypes: string[],
  producerRoute: string,
  authoritativeTrigger: string,
  mandatoryConsumers: string[],
): WorkflowReconciliationContract => ({ workflowId, eventTypes, producerRoute, authoritativeTrigger, mandatoryConsumers });

// F-17 contract register. These are production handoff contracts, not activity
// signals: an event may be emitted only by the named authoritative transition,
// and completion requires every mandatory consumer in the durable ledger.
export const WORKFLOW_RECONCILIATION_CONTRACTS: WorkflowReconciliationContract[] = [
  contract("sales-to-estimating-turnover", ["sales.estimating-requested"], "app/api/records/route.ts", "A qualified opportunity enters estimating and its source save commits", ["source-estimating-request", "sales-turnover-meeting"]),
  contract("crm-to-award", ["estimate.awarded"], "app/api/estimates/award/route.ts", "Company Owner awards a validated estimate", ["source-project-activation", "sharepoint-estimate-workspace"]),
  contract("owner-contract-portal", ["owner-contract.executed"], "app/api/contracts/route.ts", "The second authorized signature executes the frozen contract revision", ["project-contract-status", "owner-portal-contract-status", "contract-audit-history"]),
  contract("quotes-to-proposal", ["proposal.issued"], "app/api/proposals/route.ts", "Company Owner issues an approved proposal revision", ["opportunity-stage", "issued-proposal-document", "proposal-audit-history"]),
  contract("award-to-commitment", ["estimate.awarded"], "app/api/estimates/award/route.ts", "Company Owner awards a validated estimate", ["source-project-activation", "sharepoint-project-workspace", "operations-turnover-meeting"]),
  contract("change-order-control", ["change-order.executed"], "app/api/records/route.ts", "An authorized owner execution completes the change order", ["contract-value", "project-budget", "project-schedule", "owner-billing-eligibility"]),
  contract("selection-to-purchase", ["selection.released"], "app/api/selections/route.ts", "Project Manager releases an owner-decided selection", ["procurement-register", "purchase-order-draft", "selection-audit-history"]),
  contract("schedule-to-quality", ["schedule.readiness-verified"], "app/api/quality-control/route.ts", "Superintendent verifies readiness and the Project Manager closes the scheduled quality gate", ["quality-register", "responsible-party-work-item", "schedule-audit-history"]),
  contract("field-to-performance", ["field-performance.evidence-recorded"], "app/api/performance-reviews/route.ts", "Authorized owner records the review decision using governed field evidence", ["performance-review-record", "employee-notice", "review-audit-history"]),
  contract("drawing-intelligence", ["drawing-intelligence.indexed"], "app/api/drawing-intelligence/route.ts", "A stored drawing is indexed with review-safe confidence handling", ["schedule-draft", "drawing-review-evidence", "intelligence-audit-history"]),
  contract("ap-to-job-cost", ["ap-invoice.posted"], "app/api/records/route.ts", "Accounting approves an AP invoice and posts its accrual to job cost", ["general-ledger", "project-job-cost", "vendor-balance"]),
  contract("owner-billing", ["owner-billing.approved"], "app/api/accounting/route.ts", "Company Owner approves an accounting-reviewed billing application", ["accounts-receivable", "owner-billing-register", "project-cash-forecast"]),
  contract("payroll-exchange", ["payroll-return.reconciled"], "app/api/accounting/route.ts", "Accounting reconciles the controlled Paylocity return", ["labor-job-cost", "payroll-clearing", "payroll-exchange-audit"]),
  contract("employee-lifecycle", ["employee-access.activated"], "app/api/onboarding/route.ts", "Administrator activates access after completed requirements and an issued company login", ["team-access", "employee-profile", "onboarding-work-items"]),
  contract("customer-voice", ["customer-survey.responded"], "app/api/customer-survey/route.ts", "A customer submits a valid single-use survey response", ["survey-response-register", "project-feedback-summary", "testimonial-consent-gate"]),
  contract("asset-accounting", ["asset-journal.posted"], "app/api/accounting/route.ts", "Accounting posts the independently approved asset journal", ["asset-register", "general-ledger", "depreciation-schedule"]),
  contract("closeout-payment", ["closeout.final-payment-released"], "app/api/closeout/route.ts", "Company Owner releases final payment after every closeout gate", ["closeout-control", "accounts-payable-release", "project-status"]),
  contract("meeting-accountability", ["meeting.finalized"], "app/api/meetings/route.ts", "Meeting leader finalizes confirmed minutes and decisions", ["minutes-record", "action-work-items", "decision-register"]),
  contract("integration-accountability", ["integration-replay.reconciled"], "app/api/integration-health/route.ts", "Authorized reviewer records the provider replay reconciliation result", ["connection-health", "replay-ledger", "integration-incident"]),
];

export function workflowReconciliationContract(workflowId: string) {
  return WORKFLOW_RECONCILIATION_CONTRACTS.find((item) => item.workflowId === workflowId);
}
