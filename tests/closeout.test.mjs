import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateProjectHealth } from "../lib/project-health-core.js";

function healthInput(today, closeoutRequirements) {
  return {
    today,
    calculatedAt: `${today}T12:00:00.000Z`,
    project: {
      number: "TEST-CLOSEOUT",
      name: "Closeout Test",
      status: "Preconstruction",
      startDate: "2026-01-01",
      substantialDate: "2026-03-15",
      finalDate: "2026-04-01",
      contractAmount: "1000000",
      currentContractAmount: "1000000",
      projectManager: "Pat Manager",
      superintendent: "Sam Superintendent",
    },
    records: [
      { id: "BUDGET-CONTROL", type: "Budget Control", status: "Locked", data: { locked: true } },
      { id: "0300", type: "Budget", status: "Active", data: { selectedForProject: true, originalBudget: 1_000_000, committedCost: 1_000_000, forecastCost: 1_000_000 } },
      { id: "SCH-1", type: "Schedule", status: "Scheduled", due: "2026-04-01", data: { start: "2026-01-01", finish: "2026-04-01", progress: 100, qualityCategoryId: "concrete" } },
      ...closeoutRequirements,
    ],
    vendorCompliance: [],
    exceptions: [],
    customRules: [],
  };
}

const requirement = (id, status, weight = 1, critical = false) => ({
  id,
  type: "Closeout Requirements",
  status,
  data: { weight, critical, approvalFlow: ["Project Manager"], approvals: [] },
});

test("Item 8 closeout health gives partial credit against the 90/60/30/final curve", () => {
  const beforeWindow = calculateProjectHealth(healthInput("2025-12-01", [requirement("CLS-1", "Not Started", 5, true)]));
  assert.equal(beforeWindow.categories.find((item) => item.category === "Closeout").earned, 5);

  const requestedAt90 = calculateProjectHealth(healthInput("2026-01-01", [requirement("CLS-1", "Requested", 5, true)]));
  assert.equal(requestedAt90.categories.find((item) => item.category === "Closeout").earned, 5);

  const notStartedAt90 = calculateProjectHealth(healthInput("2026-01-01", [requirement("CLS-1", "Not Started", 5, true)]));
  assert.equal(notStartedAt90.categories.find((item) => item.category === "Closeout").earned, 0);
  assert.match(notStartedAt90.factors.find((item) => item.ruleId === "closeout-readiness").explanation, /0% complete against 10% expected/);

  const partialAt30 = calculateProjectHealth(healthInput("2026-03-02", [requirement("CLS-1", "Submitted", 5, true)]));
  const closeout = partialAt30.categories.find((item) => item.category === "Closeout");
  assert.ok(closeout.earned > 4 && closeout.earned < 5);
});

test("Item 8 health weighting makes critical inspections O&Ms warranties permits liens and acceptance matter more", () => {
  const heavyCriticalOpen = calculateProjectHealth(healthInput("2026-03-02", [
    requirement("CLS-CRITICAL", "Not Started", 5, true),
    requirement("CLS-STANDARD", "Approved", 1, false),
  ]));
  const equalWeightOpen = calculateProjectHealth(healthInput("2026-03-02", [
    requirement("CLS-CRITICAL", "Not Started", 1, true),
    requirement("CLS-STANDARD", "Approved", 1, false),
  ]));
  const heavyEarned = heavyCriticalOpen.categories.find((item) => item.category === "Closeout").earned;
  const equalEarned = equalWeightOpen.categories.find((item) => item.category === "Closeout").earned;
  assert.ok(heavyEarned < equalEarned);
});

test("Item 8 provides controlled requirements approvals payment gates and permanent packages", async () => {
  const logic = await readFile(new URL("../lib/closeout.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/closeout/route.ts", import.meta.url), "utf8");
  const packages = await readFile(new URL("../app/api/closeout/package/route.ts", import.meta.url), "utf8");
  const portal = await readFile(new URL("../app/api/vendor-portal/route.ts", import.meta.url), "utf8");
  const portalFiles = await readFile(new URL("../app/api/vendor-portal/files/route.ts", import.meta.url), "utf8");
  const vendorAdmin = await readFile(new URL("../app/api/vendors/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/closeout-automation.tsx", import.meta.url), "utf8");
  const review = await readFile(new URL("../lib/template-review.ts", import.meta.url), "utf8");

  for (const phrase of ["O&M Manuals", "Owner Instruction / Training Media", "Mefford Contracting Warranty", "Permit — Closed", "Owner Punch List", "Certificate Of Occupancy", "Record Drawings / As-Builts"]) {
    assert.match(logic, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(logic, /"Not Started": 0/);
  assert.match(logic, /Requested: 10/);
  assert.match(logic, /Submitted: 60/);
  assert.match(logic, /"Under Review": 80/);
  assert.match(api, /conditional final lien release before final payment/);
  assert.match(api, /Automatically Requested After Final Payment Confirmation/);
  assert.match(api, /no document was approved automatically/);
  assert.match(api, /90, 60, and 30 days; weekly in the final 30 days/);
  assert.match(api, /syncWarrantyExpirationWork/);
  assert.match(api, /90-Day|60-Day|30-Day/);
  assert.match(api, /Project Owner Electronic Signoff/);
  assert.match(api, /Total Project Closeout/);
  assert.match(packages, /Master_Closeout_Packet/);
  assert.match(packages, /Thumb_Drive_Closeout/);
  assert.match(packages, /Media_Photos_Videos/);
  assert.match(portal, /submit-closeout-requirement/);
  assert.match(portal, /submit-owner-warranty-request/);
  assert.match(portal, /Owner Closeout Read Only/);
  assert.match(vendorAdmin, /Project Owner/);
  assert.match(vendorAdmin, /Warranty Request/);
  assert.match(portalFiles, /Closeout Submission/);
  assert.match(api, /supersedes/);
  assert.match(ui, /Approve This Gate/);
  assert.match(review, /Conditional Final Lien Release/);
  assert.match(review, /User Form Pending/);
  assert.match(api, /Annual Owner Review Required/);
});

test("Item 8 morning email and escalations are operational-only and never approve or pay", async () => {
  const myWork = await readFile(new URL("../lib/my-work.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const vite = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(myWork, /Every activated user · 6:00 AM local time · Seven days a week/);
  assert.match(myWork, /48-Hour Direct Escalation/);
  assert.match(myWork, /72-Hour Manager Escalation/);
  assert.match(myWork, /96-Hour Owner\/Admin Escalation/);
  assert.match(myWork, /sendInvoice: false, postInvoice: false, approveWork: false, payVendor: false/);
  assert.match(worker, /await runCommandSchedulerCycle/);
  const commandScheduler = await readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8");
  assert.match(commandScheduler, /reconcileAllCloseoutAutomation\(\)/);
  assert.match(commandScheduler, /sendMorningWorkDigests\(scheduledAt\)/);
  assert.match(vite, /crons: \["\*\/5 \* \* \* \*"\]/);
});
