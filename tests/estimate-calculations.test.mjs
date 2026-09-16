import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEstimateEntry,
  calculateEstimateSummary,
  newEstimateData,
} from "../app/estimate-template.ts";

function workbookScenario() {
  const estimate = newEstimateData();
  estimate.projectInputs = {
    projectDurationMonths: 12,
    distanceToFromJobMiles: 10,
    buildingSquareFeet: 50_000,
    cleanupSquareFeet: 1_000,
    architecturalFeeOverride: null,
  };
  return estimate;
}

test("project months and adjustable management rates match the workbook rules", () => {
  const estimate = workbookScenario();
  const manager = calculateEstimateEntry(
    estimate,
    "0131.00",
    "100",
    { quantity: 0, unit: "HR" },
  ).entry;
  const superintendent = calculateEstimateEntry(
    estimate,
    "0131.00",
    "200",
    { quantity: 0, unit: "HR" },
  ).entry;

  assert.equal(manager.quantity, 960);
  assert.equal(manager.labor, 62_400);
  assert.equal(manager.other, 52_800);
  assert.equal(superintendent.quantity, 2_080);
  assert.equal(superintendent.labor, 93_600);
  assert.equal(superintendent.other, 83_200);

  estimate.settings.projectManagerBillableRate = 135;
  estimate.settings.projectManagerCostRate = 70;
  const adjusted = calculateEstimateEntry(
    estimate,
    "0131.00",
    "100",
    { quantity: 0, unit: "HR" },
  ).entry;
  assert.equal(adjusted.labor, 67_200);
  assert.equal(adjusted.other, 62_400);
  assert.equal(adjusted.labor + adjusted.other, 129_600);
});

test("distance, monthly costs and square-foot cleanup recalculate together", () => {
  const estimate = workbookScenario();
  const travel = calculateEstimateEntry(
    estimate,
    "3400.00",
    "100",
    { quantity: 1, unit: "LS" },
  ).entry;
  const trailer = calculateEstimateEntry(
    estimate,
    "0152.00",
    "100",
    { quantity: 0, unit: "MO" },
  ).entry;
  const storage = calculateEstimateEntry(
    estimate,
    "0152.00",
    "200",
    { quantity: 0, unit: "MO" },
  ).entry;
  const cleanup = calculateEstimateEntry(
    estimate,
    "0174.23",
    undefined,
    { quantity: 1, unit: "LS" },
  ).entry;

  assert.equal(travel.other, 2_440);
  assert.equal(trailer.other, 21_600);
  assert.equal(storage.quantity, 6);
  assert.equal(storage.other, 3_000);
  assert.equal(cleanup.labor, 1_500);
  assert.equal(cleanup.subcontract, 500);
  assert.equal(calculateEstimateSummary(estimate).directJobCost, 348_963.16);
});

test("estimate summary shows contract price fees and cost per entered building square foot", () => {
  const estimate = workbookScenario();
  const summary = calculateEstimateSummary(estimate);
  assert.equal(summary.costPerSquareFoot, 7.68);
  assert.equal(
    summary.totalContractorFeeRate,
    summary.totalContractorFees / summary.contractValue,
  );
});

test("architectural fee is four percent of construction cost and remains overridable", () => {
  const estimate = workbookScenario();
  const calculated = calculateEstimateEntry(
    estimate,
    "0172.00",
    undefined,
    { quantity: 0, unit: "LS" },
  );
  const summary = calculateEstimateSummary(estimate);
  assert.equal(calculated.entry.quantity, 1);
  assert.equal(calculated.entry.unit, "LS");
  assert.equal(calculated.entry.other, Math.round((summary.directJobCost - calculated.entry.other) * 0.04 * 100) / 100);

  estimate.projectInputs.architecturalFeeOverride = 25_000;
  const overridden = calculateEstimateEntry(
    estimate,
    "0172.00",
    undefined,
    { quantity: 0, unit: "LS" },
  );
  assert.equal(overridden.entry.other, 25_000);
});
