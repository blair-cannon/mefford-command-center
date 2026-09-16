import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const records = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");

test("Daily Log presents a simple complete weather view before finalization", () => {
  assert.match(page, /<legend>Daily Weather<\/legend>/);
  assert.match(page, /Daily Rainfall \(in\)/);
  assert.match(page, /Average Temperature \(°F\)/);
  assert.match(page, /Average Wind Speed \(mph\)/);
  assert.match(page, /Average Conditions/);
  assert.match(page, /These values save with this Daily Log/);
  const weatherForm = page.slice(page.indexOf('<fieldset className="people-fieldset weather-field">'), page.indexOf("</fieldset>", page.indexOf('<fieldset className="people-fieldset weather-field">')));
  assert.doesNotMatch(weatherForm, /\{dailyWeatherSource|data\.provider|data\.source|Captured/);
});

test("Daily Log stores an immutable structured weather snapshot", () => {
  assert.match(page, /schemaVersion: "DAILY-WEATHER-1"/);
  assert.match(page, /rainfallInches: Number\(dailyWeatherMetrics\.rainfallInches\)/);
  assert.match(page, /averageTemperatureF: Number\(dailyWeatherMetrics\.averageTemperatureF\)/);
  assert.match(page, /averageWindSpeedMph: Number\(dailyWeatherMetrics\.averageWindSpeedMph\)/);
  assert.match(page, /averageConditions: dailyWeatherMetrics\.averageConditions\.trim\(\)/);
  assert.match(page, /Weather Snapshot Locked:/);
});

test("server rejects incomplete or rewritten finalized Daily Log weather", () => {
  assert.match(records, /recordType === "Daily Logs"/);
  assert.match(records, /A Final Daily Log Requires A Locked Weather Report/);
  assert.match(records, /This Daily Log And Its Weather Report Are Finalized And Locked/);
  assert.match(records, /Use The Audited Correction Workflow/);
  assert.match(records, /JSON\.stringify\(priorSnapshot\) === JSON\.stringify\(weatherSnapshot\)/);
});
