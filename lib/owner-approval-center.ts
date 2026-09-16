import { calculateEstimateSummary, estimateOverrideReport, normalizeEstimateData } from "../app/estimate-template";
import { OWNER_PROPOSAL_RECORD_TYPE, normalizeProposalData, proposalIssueErrors } from "./proposals";

export type ApprovalSourceRecord = {
  projectId: string;
  id: string;
  recordType: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  data: Record<string, unknown>;
  updatedAt: string;
};

export type OwnerApprovalLevel = "Routine" | "Material" | "Exception" | "Critical";
export type OwnerApprovalAdapter = "estimate" | "owner-proposal" | "purchase-order" | "procurement" | "accounting" | "team-access" | "open-only";

export type OwnerApprovalItem = {
  id: string;
  projectId: string;
  projectName: string;
  recordId: string;
  recordType: string;
  title: string;
  category: string;
  level: OwnerApprovalLevel;
  amount: number;
  due: string;
  preparedBy: string;
  recommendation: string;
  businessImpact: string[];
  processChecks: Array<{ label: string; passed: boolean }>;
  exceptions: string[];
  evidence: Array<{ label: string; target: string; recordId?: string }>;
  actionTarget: string;
  adapter: OwnerApprovalAdapter;
  adapterAction: string;
  canApproveHere: boolean;
  canReturnHere: boolean;
  sourceUpdatedAt: string;
};

function money(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function levelFor(amount: number, exceptions: string[], critical = false): OwnerApprovalLevel {
  if (critical) return "Critical";
  if (exceptions.length) return "Exception";
  if (Math.abs(amount) >= 100_000) return "Material";
  return "Routine";
}

function base(record: ApprovalSourceRecord, projects: Map<string, string>) {
  return {
    projectId: record.projectId,
    projectName: projects.get(record.projectId) || (record.projectId === "MEFFORD-SALES" ? "Sales & Estimating" : record.projectId === "MEFFORD-ACCOUNTING" ? "Company Accounting" : "Company"),
    recordId: record.id,
    recordType: record.recordType,
    due: record.due,
    preparedBy: record.owner,
    sourceUpdatedAt: record.updatedAt,
  };
}

export function buildOwnerApprovalQueue(records: ApprovalSourceRecord[], projects: Map<string, string>) {
  const queue: OwnerApprovalItem[] = [];
  for (const record of records) {
    const data = record.data;
    const common = base(record, projects);

    if (record.recordType === "Sales Opportunities" && data.estimate && typeof data.estimate === "object") {
      const estimate = normalizeEstimateData(data.estimate);
      if (estimate.status === "Ready For Review") {
        const summary = calculateEstimateSummary(estimate);
        const overrides = estimateOverrideReport(estimate);
        const exceptions = overrides.map((item) => `${item.code} changed ${item.difference >= 0 ? "+" : ""}$${item.difference.toFixed(2)}`);
        queue.push({ ...common, id: `estimate:${record.projectId}:${record.id}`, title: `Approve Estimate · ${record.title}`, category: "Estimate", level: levelFor(summary.contractValue, exceptions), amount: summary.contractValue, recommendation: `Estimator submitted ${record.title} for approval at $${summary.contractValue.toFixed(2)}.`, businessImpact: [`Contract price $${summary.contractValue.toFixed(2)}`, `Gross margin ${(summary.grossMargin * 100).toFixed(1)}%`, `${overrides.length} precalculated override(s)`], processChecks: [{ label: "Estimate reconciles", passed: Math.abs(summary.reconciliationDifference) <= 0.01 }, { label: "Positive direct job cost", passed: summary.directJobCost > 0 }, { label: "Precalculated override report attached", passed: true }], exceptions, evidence: [{ label: "Open Estimate", target: "Estimating" }], actionTarget: "Estimating", adapter: "estimate", adapterAction: "approve-estimate", canApproveHere: true, canReturnHere: true });
      }
    }

    if (record.recordType === OWNER_PROPOSAL_RECORD_TYPE && record.status === "Ready For Review") {
      const proposal = normalizeProposalData(data);
      const exceptions = proposalIssueErrors(proposal);
      const estimateReady = ["Ready For Review", "Approved", "Awarded", "Proposal Submitted"].includes(proposal.sourceSnapshot.estimateStatus);
      queue.push({
        ...common,
        id: `owner-proposal:${record.projectId}:${record.id}`,
        title: `Approve Owner Proposal · ${proposal.projectName || record.title}`,
        category: proposal.packetType,
        level: levelFor(proposal.contractPrice, exceptions),
        amount: proposal.contractPrice,
        recommendation: `${proposal.preparedBy || record.owner} submitted Revision ${proposal.revision} for Company Owner approval before release to ${proposal.ownerName || "the project owner"}.`,
        businessImpact: [
          `Project budget $${proposal.contractPrice.toFixed(2)}`,
          `${proposal.durationMonths} month proposed schedule`,
          `${proposal.scopeSections.filter((item) => item.included).length} included scope section(s)`,
        ],
        processChecks: [
          { label: "Owner proposal is complete", passed: exceptions.length === 0 },
          { label: "Estimate is ready for owner issue", passed: estimateReady },
          { label: "Owner contact is linked", passed: Boolean(proposal.ownerContactName.trim()) },
        ],
        exceptions,
        evidence: [{ label: "Open Estimate", target: "Estimating", recordId: proposal.opportunityId }],
        actionTarget: "Estimating",
        adapter: "owner-proposal",
        adapterAction: "approve-owner-proposal",
        canApproveHere: true,
        canReturnHere: true,
      });
    }

    if (record.recordType === "Purchase Orders" && record.status === "Owner Approval Required") {
      const amount = money(data.amount);
      const exceptions = strings(data.approvalReasons);
      queue.push({ ...common, id: `purchase-order:${record.projectId}:${record.id}`, title: `Approve Purchase Order · ${record.title}`, category: "Purchase Order", level: levelFor(amount, exceptions), amount, recommendation: `${record.owner} submitted this purchase order for owner approval.`, businessImpact: [`Commitment $${amount.toFixed(2)}`, `Cost code ${String(data.costCode || "Not recorded")}`, `Budget available at submission $${money(data.budgetAvailableAtSubmit).toFixed(2)}`], processChecks: [{ label: "Controlled draft submitted", passed: true }, { label: "Locked budget checked", passed: true }, { label: "Vendor record confirmed", passed: Boolean(data.vendorId) }], exceptions, evidence: [{ label: "Open Purchase Order", target: "Purchase Orders" }], actionTarget: "Purchase Orders", adapter: "purchase-order", adapterAction: "owner-decision", canApproveHere: true, canReturnHere: true });
    }

    if (record.recordType === "Bid Packages" && record.status === "Owner Approval") {
      const recommendation = data.recommendation && typeof data.recommendation === "object" ? data.recommendation as Record<string, unknown> : {};
      const coverage = data.coverageException && typeof data.coverageException === "object" ? data.coverageException as Record<string, unknown> : {};
      const bidders = Array.isArray(data.bidders) ? data.bidders as Array<Record<string, unknown>> : [];
      const recommended = bidders.find((bidder) => String(bidder.vendorId || "") === String(recommendation.vendorId || ""));
      const revisions = Array.isArray(recommended?.revisions) ? recommended.revisions as Array<Record<string, unknown>> : [];
      const amount = money(revisions.at(-1)?.total || data.budgetAmount);
      const coveragePending = Boolean(coverage.reason) && !coverage.approvedAt && !recommendation.vendorId;
      const exceptions = coveragePending ? [String(coverage.reason)] : [];
      queue.push({ ...common, id: `procurement:${record.projectId}:${record.id}`, title: coveragePending ? `Approve Bid-Coverage Exception · ${record.title}` : `Approve Bid Award · ${record.title}`, category: "Procurement", level: levelFor(amount, exceptions), amount, recommendation: coveragePending ? `${coverage.requestedBy || record.owner} requests a competitive-bid exception.` : `${recommendation.submittedBy || record.owner} recommends ${recommendation.vendorName || "the selected bidder"}.`, businessImpact: [`Recommended commitment $${amount.toFixed(2)}`, `Trade ${String(data.trade || "Not recorded")}`, `Budget comparison $${money(data.budgetAmount).toFixed(2)}`], processChecks: [{ label: "Recommendation recorded", passed: coveragePending || Boolean(recommendation.vendorId) }, { label: "Scope leveling completed", passed: coveragePending || Boolean(recommended) }, { label: "Bid coverage satisfied or exception documented", passed: Boolean(coverage.reason) || bidders.length >= 3 }], exceptions, evidence: [{ label: "Open Bid Package", target: "Procurement" }], actionTarget: "Procurement", adapter: "procurement", adapterAction: coveragePending ? "approve-coverage-exception" : "owner-decision", canApproveHere: true, canReturnHere: !coveragePending });
    }

    if (record.projectId === "MEFFORD-ACCOUNTING" && record.recordType === "Journal Entry" && record.status === "Submitted") {
      const totals = data.totals && typeof data.totals === "object" ? data.totals as Record<string, unknown> : {};
      const amount = money(totals.debit);
      queue.push({ ...common, id: `accounting:${record.projectId}:${record.id}`, title: `Approve Journal Entry · ${record.title}`, category: "Accounting", level: levelFor(amount, []), amount, recommendation: "Accounting submitted a balanced journal for independent approval.", businessImpact: [`Debits $${amount.toFixed(2)}`, `Credits $${money(totals.credit).toFixed(2)}`, String(data.description || record.meta)], processChecks: [{ label: "Debits and credits balance", passed: Math.abs(money(totals.debit) - money(totals.credit)) <= 0.01 }, { label: "Support reference attached", passed: Boolean(data.supportReference) }, { label: "Independent approver required", passed: true }], exceptions: [], evidence: [{ label: "Open General Ledger", target: "General Ledger" }], actionTarget: "General Ledger", adapter: "accounting", adapterAction: "approve-journal-entry", canApproveHere: true, canReturnHere: false });
    }

    if (record.projectId === "MEFFORD-ACCOUNTING" && record.recordType === "Paylocity Payroll Return" && record.status === "Owner Approval Required") {
      const amount = money(data.totalLaborCost);
      queue.push({ ...common, id: `accounting:${record.projectId}:${record.id}`, title: `Approve Payroll Return · ${record.title}`, category: "Payroll", level: levelFor(amount, [], amount >= 200_000), amount, recommendation: "Accounting reconciled the returned payroll and requests owner approval before posting.", businessImpact: [`Payroll $${amount.toFixed(2)}`, `${Array.isArray(data.lines) ? data.lines.length : 0} allocation line(s)`, `Pay date ${String(data.payDate || record.due)}`], processChecks: [{ label: "Paylocity return recorded", passed: true }, { label: "Project allocations present", passed: Array.isArray(data.lines) }, { label: "Owner approval required before posting", passed: true }], exceptions: [], evidence: [{ label: "Open Payroll Reports", target: "Payroll Reports" }], actionTarget: "Payroll Reports", adapter: "accounting", adapterAction: "approve-paylocity-return", canApproveHere: true, canReturnHere: false });
    }

    if (record.recordType === "Designation Change Request" && record.status === "Pending") {
      queue.push({ ...common, id: `team-access:${record.projectId}:${record.id}`, title: `Approve Role Change · ${record.title}`, category: "Access", level: "Exception", amount: 0, recommendation: `${data.requestedBy || record.owner} requests a role change for ${data.employeeName || record.title}.`, businessImpact: [`Current: ${strings(data.currentDesignations).join(", ") || "None"}`, `Requested: ${strings(data.requestedDesignations).join(", ") || "None"}`, String(data.reason || "No reason recorded")], processChecks: [{ label: "Named employee", passed: Boolean(data.employeeEmail) }, { label: "Current and requested roles compared", passed: true }, { label: "Owner or administrator decision required", passed: true }], exceptions: ["Changes project authority or access"], evidence: [{ label: "Open Team & Access", target: "Team" }], actionTarget: "Team", adapter: "team-access", adapterAction: "decide-request", canApproveHere: true, canReturnHere: true });
    }

    if (["Owner Approval", "Owner Approval Required", "Pending Owner Approval"].includes(record.status) && !queue.some((item) => item.projectId === record.projectId && item.recordId === record.id)) {
      const amount = money(data.amount || data.total || data.contractValue || data.paymentAmount);
      queue.push({ ...common, id: `open-only:${record.projectId}:${record.id}`, title: `Review ${record.recordType} · ${record.title}`, category: record.recordType, level: levelFor(amount, ["Workflow-specific review required"]), amount, recommendation: `${record.owner} routed this item for owner review.`, businessImpact: [record.meta || record.status], processChecks: [{ label: "Underlying controlled workflow remains authoritative", passed: true }], exceptions: ["Complete the decision inside the source workflow"], evidence: [{ label: `Open ${record.recordType}`, target: record.recordType }], actionTarget: record.recordType, adapter: "open-only", adapterAction: "", canApproveHere: false, canReturnHere: false });
    }
  }
  const order: Record<OwnerApprovalLevel, number> = { Critical: 0, Exception: 1, Material: 2, Routine: 3 };
  return queue.sort((a, b) => order[a.level] - order[b.level] || a.due.localeCompare(b.due));
}
