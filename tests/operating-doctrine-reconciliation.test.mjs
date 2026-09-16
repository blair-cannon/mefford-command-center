import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROFITABILITY_FLOOR_BASIS_POINTS,
  ROLE_DOCTRINE,
  alignOperatingWork,
  operatingRoleForSection,
  primaryOperatingRole,
} from "../lib/operating-doctrine.ts";
import {
  PROJECT_PROFITABILITY_FLOOR_BASIS_POINTS,
  PROTECTED_HEALTH_RULES,
  calculateProjectHealth,
} from "../lib/project-health-core.js";

const healthyProject = {
  number: "ROLE-001",
  name: "Role Doctrine Test",
  status: "Active",
  startDate: "2026-01-01",
  substantialDate: "2026-11-01",
  finalDate: "2026-12-01",
  contractAmount: "1500000",
  currentContractAmount: "1500000",
  projectManager: "Pat Manager",
  superintendent: "Sam Superintendent",
};

function projectHealth(forecast) {
  return calculateProjectHealth({
    today: "2026-08-25",
    project: healthyProject,
    records: [
      { id: "BUDGET-CONTROL", type: "Budget Control", status: "Locked", data: { locked: true } },
      { id: "0300", type: "Budget", status: "Active", data: { selectedForProject: true, originalBudget: 1_000_000, committedCost: 800_000, actualCost: 600_000, forecastCost: 1_000_000 } },
      { id: "SCH-1", type: "Schedule", status: "Scheduled", due: "2026-11-01", data: { start: "2026-01-01", finish: "2026-11-01", progress: 80, qualityCategoryId: "concrete" } },
      { id: "LOG-1", type: "Daily Logs", status: "Final", recordDate: "2026-08-24", data: {} },
    ],
    financialForecast: forecast,
    exceptions: [],
    customRules: [],
    vendorCompliance: [],
  });
}

test("the five operating roles have explicit missions promises measures and owner triggers", () => {
  for (const role of ["Superintendent", "Project Manager", "Estimator", "Sales", "Accounting"]) {
    const doctrine = ROLE_DOCTRINE[role];
    assert.ok(doctrine.mission.length > 30, `${role} mission`);
    assert.ok(doctrine.promise.length > 25, `${role} promise`);
    assert.ok(doctrine.measures.length >= 4, `${role} measures`);
    assert.ok(doctrine.ownerEscalation.length >= 3, `${role} owner escalation`);
  }
  assert.match(ROLE_DOCTRINE.Superintendent.mission, /safely.*schedule/i);
  assert.match(ROLE_DOCTRINE["Project Manager"].mission, /schedule.*profit/i);
  assert.match(ROLE_DOCTRINE.Estimator.mission, /proposals.*deadline/i);
  assert.match(ROLE_DOCTRINE.Sales.mission, /pipeline.*profitable work/i);
  assert.match(ROLE_DOCTRINE.Accounting.mission, /PMs.*cost and cash truth/i);
});

test("navigation and work decoration preserve accountable role outcome consequence and ownership reason", () => {
  assert.equal(operatingRoleForSection("Daily Logs"), "Superintendent");
  assert.equal(operatingRoleForSection("WIP And Close"), "Accounting");
  assert.equal(operatingRoleForSection("Estimating"), "Estimator");
  assert.equal(operatingRoleForSection("Sales Funnel"), "Sales");
  assert.equal(operatingRoleForSection("Change Orders"), "Project Manager");
  assert.equal(primaryOperatingRole("Employee", ["Project Manager"]), "Project Manager");
  const aligned = alignOperatingWork({ actionTarget: "Budget", title: "Forecast loss", priority: "Critical" });
  assert.equal(aligned.accountableRole, "Project Manager");
  assert.equal(aligned.operatingOutcome, "Profit Protection");
  assert.match(aligned.businessImpact, /gross profit/i);
  assert.match(aligned.ownerEscalationReason, /Ownership visibility/i);
});

test("forecast project loss is a protected Red override with PM recovery and Accounting reconciliation", () => {
  assert.equal(PROFITABILITY_FLOOR_BASIS_POINTS, 1500);
  assert.equal(PROJECT_PROFITABILITY_FLOOR_BASIS_POINTS, PROFITABILITY_FLOOR_BASIS_POINTS);
  assert.ok(PROTECTED_HEALTH_RULES.some((rule) => rule.id === "financial-project-loss" && rule.critical));
  const result = projectHealth({ periodId: "2026-08", status: "Accounting Reviewed", forecastProfitCents: -25_000_00, projectedMarginBasisPoints: -200 });
  assert.equal(result.color, "Red");
  assert.ok(result.criticalTriggers.some((item) => item.ruleId === "financial-project-loss"));
  const work = result.recommendations.find((item) => item.id === "financial-project-loss");
  assert.equal(work?.priority, "Critical");
  assert.match(work?.action || "", /PM recovery plan.*Accounting reconciles/i);
});

test("margin below 15 percent creates recovery pressure without pretending it is a project loss", () => {
  const result = projectHealth({ periodId: "2026-08", status: "Accounting Reviewed", forecastProfitCents: 120_000_00, projectedMarginBasisPoints: 1200 });
  const signal = result.factors.find((item) => item.ruleId === "financial-project-loss");
  assert.equal(signal?.critical, false);
  assert.equal(signal?.deduction, 8);
  assert.match(signal?.explanation || "", /12\.0%.*15%/);
});

test("Main dashboards alerts accounting My Work guide and ownership flags share the doctrine", async () => {
  const paths = [
    "../app/api/operating-doctrine/route.ts",
    "../app/role-operating-system.tsx",
    "../app/sales-estimating.tsx",
    "../app/accounting-control.tsx",
    "../app/api/accounting/route.ts",
    "../app/api/project-health/route.ts",
    "../lib/my-work.ts",
    "../app/my-work.tsx",
    "../app/api/dashboard-display/route.ts",
    "../content/user-guide.json",
  ];
  const [api, dashboard, sales, accountingUi, accountingApi, healthApi, myWork, myWorkUi, displayFeed, guide] = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(api, /Every alert names the accountable role, operating outcome, business consequence/);
  assert.doesNotMatch(dashboard, /Role Status/);
  assert.match(dashboard, /scorecard\.doctrine\.role === "Sales" \? 3 : 2/);
  assert.match(api, /Contracts To Sign/);
  assert.match(api, /projectRows\.filter\(isContractedActiveProject\)/);
  assert.match(api, /projectRows\.filter\(needsOwnerContractSignature\)/);
  assert.doesNotMatch(dashboard, /THE OUTCOME THIS SCREEN MUST DRIVE/);
  assert.doesNotMatch(dashboard, /Five Roles\. One Profitable Outcome/);
  assert.doesNotMatch(dashboard, /What Must Move Now/);
  assert.doesNotMatch(dashboard, /Intervene Only Where It Matters/);
  assert.match(sales, /WEIGHTED GOAL COVERAGE/);
  assert.match(sales, /OVERDUE PROPOSALS/);
  assert.match(accountingUi, /PM FORECASTS CURRENT/);
  assert.match(accountingUi, /Accounting Exceptions That Require A Decision/);
  assert.match(accountingApi, /Project Manager.*Accounting verifies/);
  assert.match(healthApi, /Ownership Red Flag/);
  assert.match(healthApi, /project\.name.*item\.title/);
  assert.match(myWork, /72-Hour.*Manager Escalation/);
  assert.match(myWork, /96-Hour Ownership Red Flag/);
  assert.match(myWork, /WHY IT MATTERS|OPERATING OUTCOME/);
  assert.match(myWorkUi, /Details &amp; History/);
  assert.match(myWorkUi, /item\.ownerEscalationReason/);
  assert.match(myWorkUi, /item\.businessImpact/);
  assert.match(displayFeed, /id: "operating-truths"/);
  assert.match(displayFeed, /accounting_wip_forecasts/);
  assert.match(displayFeed, /Projects At Loss/);
  assert.match(displayFeed, /Site Superintendents/);
  assert.match(displayFeed, /Weighted Goal Coverage/);
  assert.match(guide, /Role outcomes and operating promises are maintained in this User Guide/);
  for (const role of ["Site Superintendent outcome", "Project Manager outcome", "Estimator outcome", "Sales outcome", "Accounting outcome", "Company leadership outcome"]) {
    assert.match(guide, new RegExp(role));
  }
  assert.match(guide, /company profitability floor is 15%/);
});
