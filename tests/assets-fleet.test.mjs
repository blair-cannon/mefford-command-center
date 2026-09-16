import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, admin, ui, api, domain, scheduler, worker, integrations] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-command-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/asset-tracking-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/asset-tracking.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/scheduled-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/integration-health.ts", import.meta.url), "utf8"),
]);

test("assets and fleet is a dedicated Admin workspace with role-aware navigation", () => {
  assert.match(admin, /"Assets & Fleet"/);
  assert.match(page, /target: "Admin Operations"/);
  assert.match(page, /<AssetTrackingWorkspace actor={sessionActor}/);
  for (const role of ["Fleet Manager", "Asset Manager", "Project Manager", "Superintendent", "Safety Director", "Accountant"]) assert.match(page, new RegExp(role));
});

test("the asset register owns custody inspection maintenance security documents and costs", () => {
  for (const label of ["Asset Register", "Custody & Location", "Inspections", "Maintenance", "Security", "Documents", "Accounting"]) assert.match(ui, new RegExp(label.replace(/[&]/g, "&")));
  for (const action of ["create-asset", "assign", "check-in", "update-location", "inspection", "service", "issue", "return-to-service", "retire", "upload-document", "save-accounting-treatment", "create-asset-journal-draft"]) assert.match(api, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(api, /companyMembers/);
  assert.match(api, /projects/);
  assert.match(api, /recordAudits/);
  assert.match(api, /projectFiles/);
  assert.match(api, /BUCKET\.put/);
  assert.match(api, /BUCKET\.get/);
});

test("failed inspections and theft create hard operational states without fabricating GPS", () => {
  assert.match(api, /status = "Out Of Service"/);
  assert.match(api, /status = issueType === "Lost \/ Stolen" \? "Missing \/ Stolen"/);
  assert.match(api, /Return-To-Service Evidence Is Required/);
  assert.match(ui, /No live position is being claimed/);
  assert.match(ui, /does not silently file a police report/);
  assert.match(integrations, /fleet-gps-telematics/);
});

test("asset readiness is autonomous, auditable, and routed to My Work", () => {
  for (const control of ["nextServiceDate", "registrationExpiry", "insuranceExpiry", "inspectionExpiry", "nextServiceMeter", "geofenceStatus", "telematicsStatus"]) assert.match(domain, new RegExp(control));
  assert.match(domain, /upsertWorkItem/);
  assert.match(domain, /actionTarget: "Assets & Fleet"/);
  assert.match(scheduler, /asset-readiness/);
  assert.match(worker, /case "asset-readiness"/);
});

test("financial values are hidden unless the server authorizes cost visibility", () => {
  assert.match(api, /if \(!access\.canSeeCosts\)/);
  assert.match(api, /delete data\[field\]/);
  assert.match(api, /Accountant/);
  assert.match(ui, /canSeeCosts/);
  assert.match(ui, /CurrencyInput/);
});

test("operational use stays separate from book tax and disposal treatment", () => {
  assert.match(page, /label: "Fixed Assets", target: "Fixed Assets"/);
  assert.match(ui, /Operational Truth/);
  assert.match(ui, /Book Treatment/);
  assert.match(ui, /Tax Treatment/);
  assert.match(ui, /Section 179 Election/);
  assert.doesNotMatch(ui, /asset-accounting-rule|asset-control-footer/);
  assert.match(api, /Only Accounting Or A Company Owner|Accountant Or Company Owner|access\.canAccount/);
  assert.match(api, /Accounting disposition remains separate until reviewed/);
  assert.match(api, /Operational status remains/);
  assert.match(api, /canAccount/);
});

test("fixed asset treatment calculates bases and creates controlled balanced journal drafts", () => {
  for (const field of ["placedInServiceDate", "businessUsePercent", "section179Amount", "bonusDepreciationAmount", "accumulatedBookDepreciation", "remainingTaxBasis"]) assert.match(domain + api + ui, new RegExp(field));
  assert.match(domain, /assetAccountingValues/);
  assert.match(api, /recordType: "Fixed Asset Register"/);
  assert.match(api, /recordType: "Journal Entry"/);
  assert.match(api, /status: "Draft"/);
  assert.match(api, /difference: 0/);
  assert.match(ui, /independent approval/i);
  assert.match(api, /Section 179 Bonus And Accumulated Tax Depreciation Cannot Exceed Business-Use Tax Basis/);
});
