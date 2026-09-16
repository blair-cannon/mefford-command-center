import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, portal, hub, api, styles] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-onboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-resource-hub.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-resources/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("a locked employee lands in one clear employee home", () => {
  assert.match(page, /if \(data\.actor!\.permissionLocked\) return "Employee Portal"/);
  assert.match(page, />My Work<\/button>/);
  assert.match(page, /<EmployeePortalWorkspace actor=\{sessionActor\} \/>/);
  assert.match(portal, /Welcome To Mefford/);
  assert.match(portal, /Finish Your Forms/);
  assert.match(portal, /No chasing people or paperwork/);
  assert.match(portal, /<OnboardingDocumentCenter/);
});

test("employee home contains verified work payroll and benefit destinations", () => {
  for (const value of [
    "https://outlook.office.com/mail/",
    "https://outlook.office.com/calendar/",
    "https://access.paylocity.com/",
    "https://member.uhc.com/",
    "https://www.northwesternmutual.com/log-in/",
  ]) assert.match(api, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(api, /Dental Carrier To Be Assigned/);
  assert.match(api, /Vision Carrier To Be Assigned/);
  assert.match(hub, /There is nothing you need to do yet/);
});

test("authorized Review Center roles can update employee links without creating integrations", () => {
  assert.match(api, /Employee Experience Settings/);
  assert.match(api, /Owner Administrator Human Resources Or Benefits Administrator Access Is Required/);
  assert.match(api, /manageCategories/);
  assert.match(api, /template\.area === "Benefits"/);
  assert.match(api, /enforceOnboardingAccess\(request\)/);
  assert.match(api, /Must Use A Secure HTTPS Link/);
  assert.match(api, /recordAudits/);
  assert.match(api, /Command Center does not run or transmit payroll/);
  assert.match(hub, /Save Employee Experience/);
  assert.match(hub, /Changes are saved permanently and take effect immediately/);
  assert.match(hub, /CURRENT OWNER-APPROVED DOCUMENTS/);
});

test("employee resource cards remain touch friendly and responsive", () => {
  assert.match(styles, /\.employee-resource-grid\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(styles, /@media\(max-width:900px\)\{\.employee-resource-grid\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.employee-first-day-map/);
  assert.match(styles, /\.employee-profile-details/);
});
