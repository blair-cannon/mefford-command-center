import { workflowReconciliationContract } from "./workflow-reconciliation-contracts";

export type WorkflowReleaseControl = {
  workflowId: string;
  authorityEvidence: string[];
  releaseTests: string[];
  reconciledEventTypes: string[];
};

const control = (
  workflowId: string,
  authorityEvidence: string[],
  releaseTests: string[],
  reconciledEventTypes: string[] = workflowReconciliationContract(workflowId)?.eventTypes || [],
): WorkflowReleaseControl => ({ workflowId, authorityEvidence, releaseTests, reconciledEventTypes });

// This register is deliberately explicit. A workflow cannot receive release or
// authority credit merely because a route, screen, or database table exists.
export const WORKFLOW_RELEASE_CONTROLS: WorkflowReleaseControl[] = [
  control("sales-to-estimating-turnover", ["Assigned receiving estimator accepts", "Exact source revision review", "Public-bid contact exception"], ["tests/turnovers.integration.test.mjs"]),
  control("crm-to-award", ["Estimator handoff denial path", "Company Owner award boundary", "Atomic rollback on activation failure"], ["tests/f06-runtime-integration.test.mjs", "tests/workflow-wiring.test.mjs"], ["estimate.awarded"]),
  control("owner-contract-portal", ["Owner-scoped payload", "Company Owner release/freeze", "Ordered two-party signatures"], ["tests/owner-contracts.test.mjs", "tests/project-owner-portal.test.mjs"]),
  control("quotes-to-proposal", ["Human OCR confirmation", "Estimator quote selection", "Owner proposal release"], ["tests/bid-proposal-handoff.test.mjs", "tests/owner-proposals.test.mjs"]),
  control("award-to-commitment", ["Company Owner award", "PM confirmation", "Individual PM and superintendent bonus signatures", "No automatic commitment release"], ["tests/f06-runtime-integration.test.mjs", "tests/workflow-wiring.test.mjs", "tests/project-bonuses.integration.test.mjs"], ["estimate.awarded"]),
  control("change-order-control", ["Internal approval", "Owner execution", "Separate billing decision"], ["tests/workflow-wiring.test.mjs", "tests/system-wide-audit.test.mjs"]),
  control("selection-to-purchase", ["Owner selection", "PM release", "PO approval and payment separation"], ["tests/selections.test.mjs", "tests/purchase-orders.test.mjs"]),
  control("schedule-to-quality", ["Superintendent readiness verification", "PM/designer acceptance"], ["tests/workflow-wiring.test.mjs", "tests/schedule-dashboard-preferences.test.mjs"]),
  control("field-to-performance", ["Safety classification authority", "Owner-only review decision"], ["tests/performance-customer-voice.test.mjs", "tests/safety-command.test.mjs"]),
  control("drawing-intelligence", ["Low-confidence review", "Human approval of AI schedule drafts"], ["tests/construction-intelligence.test.mjs", "tests/system-wide-audit.test.mjs"]),
  control("ap-to-job-cost", ["Human OCR review", "Independent invoice/payment/posting gates"], ["tests/accounting-advanced-controls.test.mjs", "tests/system-wide-audit.test.mjs"]),
  control("owner-billing", ["PM preparation", "Accounting review", "Company Owner approval"], ["tests/accounting-coordination.test.mjs", "tests/workflow-wiring.test.mjs"]),
  control("payroll-exchange", ["Accounting-controlled Paylocity exchange", "No Command Center payroll execution"], ["tests/accounting-advanced-controls.test.mjs", "tests/workflow-wiring.test.mjs"]),
  control("employee-lifecycle", ["Administrator verification", "Company Owner access approval"], ["tests/workflow-wiring.test.mjs", "tests/team-access.test.mjs"]),
  control("customer-voice", ["Consent separated from response", "Human testimonial publication"], ["tests/performance-customer-voice.test.mjs", "tests/marketing-survey-workspaces.test.mjs"]),
  control("asset-accounting", ["Accountant review", "Independent journal approval and posting"], ["tests/assets-fleet.test.mjs", "tests/accounting-ledger-core.test.mjs"]),
  control("closeout-payment", ["PM/Superintendent/Accounting/Owner gates", "Final payment hold", "Bonus obligation flagged for human payment review"], ["tests/closeout.test.mjs", "tests/workflow-wiring.test.mjs", "tests/project-lifecycle.integration.test.mjs"]),
  control("meeting-accountability", ["Leader-confirmed attendance/decisions/minutes", "No invented attendance"], ["tests/meetings-center.test.mjs", "tests/system-wide-audit.test.mjs"]),
  control("integration-accountability", ["Accounting and Owner replay gates", "Conflict versions remain preserved"], ["tests/integration-health.test.mjs", "tests/f13-domain-outbox.test.mjs"]),
];

export function workflowReleaseControl(workflowId: string) {
  return WORKFLOW_RELEASE_CONTROLS.find((item) => item.workflowId === workflowId);
}
