import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildOwnerApprovalQueue } from "../lib/owner-approval-center.ts";
import { newEstimateData } from "../app/estimate-template.ts";
import { normalizeProposalData } from "../lib/proposals.ts";

function record(overrides) {
  return { projectId: "25-001", id: "TEST-1", recordType: "Purchase Orders", title: "Test Decision", owner: "Project Manager", due: "2026-09-02", status: "Owner Approval Required", meta: "", data: {}, updatedAt: "2026-09-02T12:00:00.000Z", ...overrides };
}

test("owner approval queue turns existing workflow gates into decision packets", () => {
  const estimate = newEstimateData();
  estimate.status = "Ready For Review";
  estimate.entries["0300.00"] = { quantity: 1, unit: "LS", material: 100_000, labor: 0, equipment: 0, subcontract: 0, other: 0 };
  const queue = buildOwnerApprovalQueue([
    record({ projectId: "MEFFORD-SALES", id: "OPP-1", recordType: "Sales Opportunities", title: "Estimate One", status: "Estimating", data: { estimate } }),
    record({ data: { amount: 18_425, costCode: "0300.00", vendorId: "V-1", budgetAvailableAtSubmit: 21_000, approvalReasons: ["Amount exceeds $10,000.00"] } }),
    record({ projectId: "MEFFORD-ACCOUNTING", id: "JE-1", recordType: "Journal Entry", title: "Accrual", status: "Submitted", data: { totals: { debit: 5000, credit: 5000 }, supportReference: "Invoice batch", description: "Month-end accrual" } }),
  ], new Map([["25-001", "Project One"]]));
  assert.equal(queue.length, 3);
  assert.ok(queue.every((item) => item.processChecks.length > 0 && item.evidence.length > 0));
  assert.equal(queue.find((item) => item.adapter === "purchase-order")?.level, "Exception");
  assert.equal(queue.find((item) => item.adapter === "accounting")?.canReturnHere, false);
});

test("approval center is owner-only and dispatches through real source workflows", () => {
  const api = fs.readFileSync(new URL("../app/api/owner-approvals/route.ts", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(api, /actor\.accessLevel !== "Company Owner"/);
  for (const handler of ["purchaseOrderPost", "procurementPost", "accountingPost", "teamAccessPost"]) assert.match(api, new RegExp(handler));
  assert.match(api, /packetSha256/);
  assert.match(schema, /owner_approval_snapshots/);
  assert.match(page, /Owner Approvals/);
});

test("owner proposals waiting for review appear as actionable Company Owner decisions", () => {
  const proposal = normalizeProposalData({
    opportunityId: "OPP-1",
    packetType: "Construction Proposal",
    projectName: "Johnstone Indianapolis",
    ownerName: "Johnstone Supply",
    preparedBy: "Estimator",
    contractPrice: 2_500_000,
    durationMonths: 15,
    status: "Ready For Review",
  });
  const queue = buildOwnerApprovalQueue([
    record({ projectId: "MEFFORD-SALES", id: "OPP-1-PROPOSAL", recordType: "Owner Proposals", title: "Johnstone Indianapolis · Construction Proposal", status: "Ready For Review", data: proposal }),
  ], new Map());
  assert.equal(queue.length, 1);
  assert.equal(queue[0].adapter, "owner-proposal");
  assert.equal(queue[0].actionTarget, "Estimating");
  assert.equal(queue[0].evidence[0].recordId, "OPP-1");
});
