import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const scheduleWorkspace = fs.readFileSync(new URL("../app/schedule-workspace.tsx", import.meta.url), "utf8");
const templateApi = fs.readFileSync(new URL("../app/api/schedule-templates/route.ts", import.meta.url), "utf8");
const templatePolicy = fs.readFileSync(new URL("../lib/schedule-templates.ts", import.meta.url), "utf8");
const preferenceApi = fs.readFileSync(new URL("../app/api/dashboard-preferences/route.ts", import.meta.url), "utf8");
const recordsApi = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");

test("schedule templates are controlled permanent company records", () => {
  assert.match(templatePolicy, /Mefford Standard New Build/);
  assert.match(templatePolicy, /Commercial Renovation/);
  assert.match(templatePolicy, /Restaurant Build-Out/);
  assert.match(templateApi, /save-template/);
  assert.match(templateApi, /recordAudits/);
  assert.match(templateApi, /Every Activity Requires A Valid Quality Category/);
  assert.match(recordsApi, /"Schedule Template"/);
});

test("template application preserves existing schedules and uses controlled record posting", () => {
  assert.match(templateApi, /Templates Apply Only To An Empty Project Schedule/);
  assert.match(templateApi, /prepare-template/);
  assert.match(scheduleWorkspace, /persistCommandRecord\(project\.number, "Schedule", record\)/);
  assert.match(scheduleWorkspace, /Apply To Empty Schedule/);
  assert.match(scheduleWorkspace, /Publish Company Template/);
});

test("Project Tools customization is permanently saved per signed-in identity", () => {
  assert.match(page, /\/api\/dashboard-preferences/);
  assert.match(page, /Customize Project Tools/);
  assert.match(page, /Save My Project Tools/);
  assert.match(page, /visibleDashboardModules/);
  assert.match(preferenceApi, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(preferenceApi, /Personal Dashboard Preferences/);
  assert.match(recordsApi, /"Dashboard Preferences"/);
});

test("personal preferences cannot erase every tool or alter shared project data", () => {
  assert.match(preferenceApi, /Keep At Least One Project Tool Visible/);
  assert.match(preferenceApi, /No shared project record was changed/);
  assert.match(page, /Keep At Least One Project Tool Visible/);
});
