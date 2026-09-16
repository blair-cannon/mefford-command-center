import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PROJECT_HEALTH_WEIGHTS,
  PROTECTED_HEALTH_RULES,
  calculateProjectHealth,
} from "../lib/project-health-core.js";

const project = {
  number: "TEST-001",
  name: "Health Test",
  status: "Preconstruction",
  startDate: "2026-03-01",
  substantialDate: "2026-11-01",
  finalDate: "2026-12-01",
  contractAmount: "1500000",
  currentContractAmount: "1500000",
  projectManager: "Pat Manager",
  superintendent: "Sam Superintendent",
};

function healthy(overrides = {}) {
  return {
    today: "2026-01-15",
    calculatedAt: "2026-01-15T12:00:00.000Z",
    project: { ...project },
    records: [
      { id: "BUDGET-CONTROL", type: "Budget Control", status: "Locked", data: { locked: true } },
      { id: "0300", type: "Budget", status: "Active", data: { selectedForProject: true, originalBudget: 1_000_000, approvedChanges: 0, committedCost: 0, actualCost: 0, forecastCost: 1_000_000 } },
      { id: "SCH-1", type: "Schedule", status: "Scheduled", due: "2026-05-01", data: { start: "2026-04-01", finish: "2026-05-01", progress: 0, qualityCategoryId: "concrete" } },
    ],
    vendorCompliance: [],
    exceptions: [],
    customRules: [],
    ...overrides,
  };
}

test("approved category weights total exactly 100", () => {
  assert.equal(Object.values(PROJECT_HEALTH_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
  assert.deepEqual(PROJECT_HEALTH_WEIGHTS, { Financial: 25, Schedule: 25, Safety: 15, Quality: 10, "Project Controls": 10, "Vendor / Procurement": 10, Closeout: 5 });
});

test("healthy project earns Green 100 with an explanation-ready breakdown", () => {
  const result = calculateProjectHealth(healthy());
  assert.equal(result.score, 100);
  assert.equal(result.color, "Green");
  assert.equal(result.categories.length, 7);
  assert.equal(result.criticalTriggers.length, 0);
});

test("score bands are Green 90-100, Yellow 75-89, and Red below 75", () => {
  const records = healthy().records;
  const green = calculateProjectHealth(healthy({ customRules: [{ id: "custom-green", name: "Green Cut", description: "test rule description", category: "Project Controls", deduction: 10, recordType: "Schedule", enabled: true }] }));
  const yellow = calculateProjectHealth(healthy({ customRules: [{ id: "custom-yellow", name: "Yellow Cut", description: "test rule description", category: "Schedule", deduction: 11, recordType: "Schedule", enabled: true }] }));
  const red = calculateProjectHealth(healthy({ records: records.filter((record) => record.type !== "Schedule"), customRules: [{ id: "custom-red", name: "Red Cut", description: "test rule description", category: "Financial", deduction: 14, recordType: "Budget", enabled: true }] }));
  assert.equal(green.score, 90); assert.equal(green.color, "Green");
  assert.equal(yellow.score, 89); assert.equal(yellow.color, "Yellow");
  assert.ok(red.score < 75); assert.equal(red.color, "Red");
});

test("projected overrun forces Red only after the first approved threshold is exceeded", () => {
  const atThreshold = healthy();
  atThreshold.records[1].data.forecastCost = 1_010_000;
  const thresholdResult = calculateProjectHealth(atThreshold);
  assert.equal(thresholdResult.financial.overrunThreshold, 10_000);
  assert.equal(thresholdResult.criticalTriggers.some((item) => item.ruleId === "financial-projected-overrun"), false);
  const overThreshold = healthy();
  overThreshold.records[1].data.forecastCost = 1_010_001;
  const criticalResult = calculateProjectHealth(overThreshold);
  assert.equal(criticalResult.color, "Red");
  assert.equal(criticalResult.criticalTriggers.some((item) => item.ruleId === "financial-projected-overrun"), true);
});

test("the $25,000 cap becomes the first overrun threshold on larger budgets", () => {
  const input = healthy();
  input.records[1].data.originalBudget = 5_000_000;
  input.records[1].data.forecastCost = 5_025_001;
  const result = calculateProjectHealth(input);
  assert.equal(result.financial.overrunThreshold, 25_000);
  assert.equal(result.color, "Red");
});

test("safety stays critical while vendor compliance is a payment-readiness warning", () => {
  const safetyInput = healthy();
  safetyInput.records.push({ id: "INC-1", type: "Safety Incidents", title: "Reported Incident", status: "Open", data: { incidentReported: true } });
  const safety = calculateProjectHealth(safetyInput);
  assert.equal(safety.color, "Red");
  assert.ok(safety.score >= 75);
  const compliance = calculateProjectHealth(healthy({ vendorCompliance: [{ vendorId: "V-1", name: "Blocked Trade", blocked: true }] }));
  assert.equal(compliance.color, "Green");
  assert.ok(compliance.factors.some((item) => item.ruleId === "vendor-compliance" && item.critical === false));
  assert.ok(!compliance.criticalTriggers.some((item) => item.ruleId === "vendor-compliance"));
});

test("approved exceptions suppress noncritical deductions but never protected critical guardrails", () => {
  const noSchedule = healthy({ records: healthy().records.filter((record) => record.type !== "Schedule") });
  const excepted = calculateProjectHealth({ ...noSchedule, exceptions: [{ id: "EX-1", ruleId: "schedule-current-baseline", status: "Approved", startsAt: "2026-01-01", expiresAt: "2026-01-31" }] });
  assert.ok(excepted.factors.some((item) => item.ruleId === "schedule-current-baseline" && item.exceptionActive && item.deduction === 0));
  const overrun = healthy();
  overrun.records[1].data.forecastCost = 1_050_000;
  overrun.exceptions = [{ id: "EX-2", ruleId: "financial-projected-overrun", status: "Approved", startsAt: "2026-01-01", expiresAt: "2026-01-31" }];
  const protectedResult = calculateProjectHealth(overrun);
  assert.equal(protectedResult.color, "Red");
  assert.ok(protectedResult.criticalTriggers.some((item) => item.ruleId === "financial-projected-overrun"));
});

test("standard rules are protected and Item 7 API contains role and approval safeguards", async () => {
  assert.ok(PROTECTED_HEALTH_RULES.every((rule) => rule.protected));
  const source = await readFile(new URL("../app/api/project-health/route.ts", import.meta.url), "utf8");
  assert.match(source, /This Project Is Not Assigned To The Current User/);
  assert.match(source, /Only A Company Owner Or Administrator Can Create Company Health Rules/);
  assert.match(source, /Critical Safety Compliance Budget-Overrun And Final-Completion Guardrails Cannot Be Suspended/);
  assert.match(source, /Automatically Resolved/);
  assert.match(source, /Daily Health Snapshot/);
  assert.match(source, /reconcileAllProjectHealthNightly/);
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const commandScheduler = await readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8");
  const vite = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(worker, /async scheduled/);
  assert.match(vite, /crons: \["\*\/5 \* \* \* \*"\]/);
  assert.match(commandScheduler, /case "project-health-nightly"/);
  assert.match(commandScheduler, /reconcileAllProjectHealthNightly/);
  const records = await readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
  const correspondence = await readFile(new URL("../lib/project-correspondence.ts", import.meta.url), "utf8");
  const quality = await readFile(new URL("../app/api/quality-control/route.ts", import.meta.url), "utf8");
  const procurement = await readFile(new URL("../app/api/procurement/route.ts", import.meta.url), "utf8");
  for (const relevantUpdatePath of [records, correspondence, quality, procurement]) assert.match(relevantUpdatePath, /reconcileProjectHealthAfterUpdate/);
});
