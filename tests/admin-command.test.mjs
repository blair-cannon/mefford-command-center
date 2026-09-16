import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, admin, css, requests] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-command-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-lifecycle/route.ts", import.meta.url), "utf8"),
]);

test("Admin navigation follows one deliberate responsibility sequence", () => {
  const start = page.indexOf('label: "Admin"', page.indexOf("const companyNavFolders"));
  const end = page.indexOf("];", start);
  const source = page.slice(start, end);
  const targets = ["Admin Command", "Admin Goals", "Admin People", "Admin Requests", "Admin Templates", "Admin Access", "Admin Operations"];
  const positions = targets.map((target) => source.indexOf(`target: "${target}"`));
  positions.forEach((position) => assert.ok(position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(page, /adminNavigationTargets\.includes\(active\)[\s\S]*<AdminCommandWorkspace/);
});

test("Admin defines responsibilities without turning Administrator into universal authority", () => {
  for (const responsibility of ["Set Direction", "Manage The Employee Lifecycle", "Serve Employees", "Govern Company Information", "Control Access & Company Systems"]) {
    assert.match(admin, new RegExp(responsibility));
  }
  assert.match(admin, /actor.accessLevel === "Company Owner"/);
  assert.match(admin, /disabled=\{!owner\}/);
  assert.match(admin, /owner \? <DashboardDisplayAccessControl/);
  assert.doesNotMatch(admin, /admin-authority-grid|admin-access-boundary/);
});

test("HR, employee service, templates and operations route into live existing systems", () => {
  assert.match(admin, /<EmployeeResourceHub management/);
  assert.match(admin, /<EmployeeManagerQueue/);
  assert.match(admin, /<ReviewWorkspace actor=\{actor\}/);
  for (const target of ["Employee Onboarding", "Company Calendar", "Assets & Fleet", "IT & Integrations", "Quarterly Rock/Review", "Sales Goals", "Performance Reviews"]) {
    assert.match(admin, new RegExp(`"${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(admin, /project\.number \? `Open \$\{project\.name\} Team` : "Select A Project For Team Roles"/);
});

test("employee requests follow live role routing and access keeps dual approval", () => {
  for (const route of ["Human Resources", "Accountant", "IT Administrator", "Marketing / Administrator"]) {
    assert.match(requests, new RegExp(route));
  }
  assert.match(requests, /primary: "Company Owner", secondary: "Administrator"/);
  assert.match(requests, /item.primaryApprovedByEmail === actor.email/);
  assert.match(requests, /Require Two Different Approvers/);
  assert.match(page, /target === "Admin People"[\s\S]*"Human Resources", "Benefits Administrator"/);
  assert.match(page, /target === "Admin Templates"[\s\S]*"Attorney", "Safety Director", "Safety"/);
});

test("Admin workspace is responsive and visually distinct", () => {
  assert.match(css, /\.admin-command-hero/);
  assert.match(css, /\.admin-responsibility-flow/);
  assert.match(css, /\.admin-route-matrix/);
  assert.match(css, /@media\(max-width:820px\).*\.admin-command-hero/s);
  assert.match(css, /@media\(max-width:560px\).*\.admin-operations-grid/s);
});
