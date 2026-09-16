import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const teamLogic = fs.readFileSync(new URL("../lib/team-access.ts", import.meta.url), "utf8");
const directory = fs.readFileSync(new URL("../app/company-directory.ts", import.meta.url), "utf8");
const teamWorkspace = fs.readFileSync(new URL("../app/team-access-workspace.tsx", import.meta.url), "utf8");
const teamRoute = fs.readFileSync(new URL("../app/api/team-access/route.ts", import.meta.url), "utf8");
const estimateSetup = fs.readFileSync(new URL("../app/api/estimates/setup/route.ts", import.meta.url), "utf8");
const microsoftAccess = fs.readFileSync(new URL("../app/microsoft-access-center.tsx", import.meta.url), "utf8");
const microsoftServer = fs.readFileSync(new URL("../lib/microsoft-access-server.ts", import.meta.url), "utf8");
const onboarding = fs.readFileSync(new URL("../app/employee-onboarding.tsx", import.meta.url), "utf8");
const userGuide = fs.readFileSync(new URL("../content/user-guide.json", import.meta.url), "utf8");

const expectedDesignations = [
  "Project Manager",
  "Superintendent",
  "Estimator",
  "Sales Representative",
  "Marketing",
  "Office Staff",
  "Accountant",
  "Financial Administrator",
  "Safety Director",
  "Safety",
  "Human Resources",
  "Benefits Administrator",
  "Attorney",
  "IT Administrator",
  "Fleet Manager",
  "Asset Manager",
  "Sales Manager",
  "Estimating Manager",
  "Accounting Manager",
];

test("one shared catalog contains every assignable company and project designation", () => {
  assert.match(teamLogic, /ALL_COMPANY_DESIGNATIONS/);
  for (const designation of expectedDesignations) assert.ok(teamLogic.includes(`"${designation}"`), designation);
  assert.match(teamWorkspace, /designationScope === "project"\s*\? PROJECT_DESIGNATIONS\s*: ALL_COMPANY_DESIGNATIONS/);
  assert.match(microsoftAccess, /ACCESS_DESIGNATIONS = ALL_COMPANY_DESIGNATIONS/);
  assert.match(onboarding, /designations = ALL_COMPANY_DESIGNATIONS/);
});

test("the Company Owner remains eligible for every role-filtered employee dropdown", () => {
  assert.match(teamLogic, /accessLevel === "Company Owner" \|\| designations\.includes\(designation\)/);
  assert.match(directory, /isAssignableToDesignation\([\s\S]*member\.accessLevel/);
  assert.match(estimateSetup, /isAssignableToDesignation\(member\.accessLevel/);
  assert.doesNotMatch(teamWorkspace, /person\.name === "Jordan Mefford"/);
  assert.match(teamWorkspace, /person\.accessLevel === "Company Owner"/);
});

test("Company Owner role assignment is server-authorized and audited", () => {
  assert.match(teamRoute, /const isLeadership = \["Company Owner", "Administrator"\]\.includes\(level\)/);
  assert.match(teamRoute, /canManageDesignations: isLeadership/);
  assert.match(teamRoute, /if \(!context\.canManageDesignations\)/);
  assert.match(teamRoute, /teamAudit\(/);
  assert.match(microsoftServer, /Only A Company Owner Can Change Command Center Access/);
  assert.match(userGuide, /A Company Owner can assign every company-default and project role/);
});

test("role assignment dialogs initialize safely with the current two-person directory", () => {
  assert.match(teamWorkspace, /useState\(0\)/);
  assert.match(teamWorkspace, /employeeAccess\[0\]\?\.projectDesignations \|\| \[\]/);
  assert.doesNotMatch(teamWorkspace, /employeeAccess\[2\]/);
});
