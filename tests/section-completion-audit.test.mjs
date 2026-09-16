import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, scheduleWorkspace, readiness, integrationApi, integrationUi] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/schedule-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/section-readiness.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/integration-health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/integration-health.tsx", import.meta.url), "utf8"),
]);

test("every primary navigation target resolves to a dedicated or permanent generic workspace", () => {
  const meetingTargets = ["Quarterly Rock/Review", "Weekly L10", "Sales/Estimating Department", "Operations Department", "Accounting Department", "Sales To Estimating Turnover", "Estimating To Operations Turnover"];
  const meetingDispatch = page.match(/\) : \[([^\]]+)\]\.includes\(active\) \? \(\s*<MeetingsCenter[\s\S]*?meetingType=\{MEETING_TYPE_BY_TARGET\[active\]\}/);
  assert.ok(meetingDispatch, "Company meeting navigation must render the mapped MeetingsCenter workspace");
  assert.deepEqual(JSON.parse(`[${meetingDispatch[1]}]`), meetingTargets);
  for (const target of ["Dashboard", "My Work", "Project Health", "User Guide", "IT & Integrations", "Assets & Fleet", "Performance Reviews", "Employee Onboarding", "Employee Portal", "Quarterly Rock/Review", "Weekly L10", "Sales Dashboard", "Sales Goals", "Sales Contacts", "Sales Funnel", "Sales Design", "Estimating", "Bid Management", "Project Overview", "Contracts", "Schedule", "Documents", "Design & Drawings", "Procurement", "Budget", "Closeout", "Safety", "Change Orders", "Subcontracts", "Purchase Orders", "Selections", "RFIs", "Submittals", "Quality", "Review", "Team"]) {
    if (meetingTargets.includes(target)) continue;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(page, new RegExp(`active === "${escaped}"`));
  }
  assert.match(page, /accountingNavigationTargets\.includes/);
  assert.match(page, /<ModuleWorkspace/);
  assert.match(page, /persistCommandRecord/);
});

test("a clean project opens without prototype project records", () => {
  const clean = page.slice(page.indexOf("function createCleanProjectRecords"), page.indexOf("function ModuleWorkspace"));
  for (const recordType of ["Daily Logs", "Toolbox Talks", "RFIs", "Submittals", "Change Orders", "Contracts", "Subcontracts", "Purchase Orders", "Selections", "Documents", "Schedule", "Team"]) {
    assert.match(clean, new RegExp(`(?:"${recordType}"|${recordType}): \\[\\]`));
  }
  assert.doesNotMatch(clean, /Dog Pound|Bluegrass|Commonwealth|RFI-007|PCO-003/);
  assert.doesNotMatch(page, /signature-demo-action|Reset Project Test Data|Fresh Test/);
});

test("the schedule timeline derives its twelve-week window from real activity dates", () => {
  assert.match(scheduleWorkspace, /firstActivityDate/);
  assert.match(scheduleWorkspace, /tasks\s*\.flatMap/);
  assert.match(scheduleWorkspace, /week\.setUTCDate\(week\.getUTCDate\(\) \+ index \* 7\)/);
  assert.doesNotMatch(scheduleWorkspace, /const scheduleStart = new Date\("2026-/);
});

test("the readiness catalog covers every core section without self-certifying runtime status", () => {
  const entries = [...readiness.matchAll(/(?:company|project)\("[^"]+",/g)];
  assert.ok(entries.length >= 40, `expected at least 40 section entries, found ${entries.length}`);
  assert.doesNotMatch(readiness, /status:\s*"Live"/);
  assert.doesNotMatch(readiness, /placeholders:\s*0/);
  assert.match(readiness, /evidenceBySection/);
  assert.match(readiness, /Missing proof remains Unknown/);
  for (const proof of ["Persistent Data Probe", "Runtime Workflow Evidence", "Authorization Boundary Test", "Current Release Test"]) assert.match(readiness, new RegExp(proof));
  for (const field of ["persistence", "automation", "authority", "connectionBoundary"]) assert.match(readiness, new RegExp(field));
});

test("the evidence-based readiness register is exposed inside IT and Integrations", () => {
  assert.match(integrationApi, /applicationReadinessSnapshot/);
  assert.match(integrationApi, /application,/);
  assert.match(integrationUi, /Verified Sections/);
  assert.match(integrationUi, /Application Section Status/);
  assert.match(integrationUi, /VERIFIED SECTIONS/);
  assert.doesNotMatch(integrationUi, /No section receives credit because it exists in the menu/);
  assert.doesNotMatch(integrationUi, /LIVE SECTIONS|Placeholder Pages/);
  assert.match(integrationUi, /Human Authority/);
});
