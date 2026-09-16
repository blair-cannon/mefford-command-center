import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sales = await readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8");
const estimate = await readFile(new URL("../app/estimate-editor.tsx", import.meta.url), "utf8");
const template = await readFile(new URL("../app/estimate-template.ts", import.meta.url), "utf8");
const calendar = await readFile(new URL("../app/company-calendar.tsx", import.meta.url), "utf8");
const calendarRoute = await readFile(new URL("../app/api/company-calendar/route.ts", import.meta.url), "utf8");
const directory = await readFile(new URL("../app/company-directory.ts", import.meta.url), "utf8");
const projectRoute = await readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");
const recordRoute = await readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const currency = await readFile(new URL("../app/currency-input.tsx", import.meta.url), "utf8");
const money = await readFile(new URL("../lib/money.js", import.meta.url), "utf8");

test("funnel probabilities are editable and drag-drop stage movement is live", () => {
  assert.match(sales, /data\.probability \?\? stageProbabilities/);
  assert.match(sales, /draggable/);
  assert.match(sales, /onDrop=/);
  assert.match(sales, /moveOpportunity/);
});

test("estimating keeps its explicit handoff in the editor and excludes untouched stage-only work", () => {
  assert.match(sales, /estimatingRequestedAt/);
  assert.match(sales, /Estimating · Use Handoff Button/);
  assert.match(sales, /disabled=\{saving \|\| !opportunityReadyForEstimating\}/);
  assert.match(recordRoute, /Complete These Fields Before Estimating/);
  assert.match(sales, /Boolean\(record\.data\?\.directEstimate\) \|\| Boolean\(data\.estimatingRequestedAt\)/);
});

test("estimate keeps every architect vendor selectable, with sticky headings and total contractor fees", () => {
  assert.match(estimate, /Select Architect Vendor/);
  assert.match(estimate, /architectOptions\.map/);
  assert.match(estimate, /TOTAL CONTRACTOR FEES/);
  assert.doesNotMatch(estimate, /<span>GROSS MARGIN<\/span>/);
  assert.match(template, /4% Of Construction Cost Before Architectural Fee/);
  assert.match(template, /architecturalFeeOverride/);
  assert.doesNotMatch(template, /architecturalFeeBasis/);
});

test("company calendar combines estimating people project and meeting dates with an honest Outlook boundary", () => {
  for (const category of ["Estimating", "People", "Projects", "Meetings", "Company", "Sales"]) {
    assert.match(calendar, new RegExp(`"${category}"`));
  }
  assert.match(calendarRoute, /INTEGRATION-MICROSOFT-MEETINGS/);
  assert.match(calendarRoute, /Mefford Contracting Master Calendar/);
  assert.match(calendarRoute, /birthDate/);
  assert.match(calendarRoute, /hireDate/);
});

test("the retained clean-start users keep department-wide versus assigned-project enforcement", () => {
  assert.match(directory, /Jordan Mefford[\s\S]*jmefford@meffcon\.com[\s\S]*Company Owner/);
  assert.match(directory, /Blain Faulkner[\s\S]*it@meffcon\.com[\s\S]*IT Administrator/);
  assert.doesNotMatch(directory, /janderson@meffcon\.com|aneal@meffcon\.com/);
  assert.match(projectRoute, /Department Wide/);
  assert.match(projectRoute, /Assigned Projects Only/);
  assert.match(recordRoute, /canAccessProjectScope/);
  assert.match(recordRoute, /assigned Project Manager Or Superintendent/i);
  assert.match(projectRoute, /Project Managers Can Only Create Projects Where They Are The Primary Project Manager/);
  assert.match(projectRoute, /This Project Is Restricted To Its Primary Project Manager Administrator Or Company Owner/);
});

test("currency entry formats commas while preserving raw numeric values", () => {
  assert.match(money, /replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, ","\)/);
  assert.match(currency, /inputMode="decimal"/);
  assert.match(currency, /onValueChange\(currencyRawValue/);
  assert.match(currency, /onValueChange\(settleCurrencyInput/);
});
