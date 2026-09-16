import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../app/admin-command-workspace.tsx", import.meta.url), "utf8");
const estimating = fs.readFileSync(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8");
const integrations = fs.readFileSync(new URL("../app/integration-health.tsx", import.meta.url), "utf8");
const media = fs.readFileSync(new URL("../app/mobile-media-editor.tsx", import.meta.url), "utf8");
const employee = fs.readFileSync(new URL("../app/employee-resource-hub.tsx", import.meta.url), "utf8");
const myWork = fs.readFileSync(new URL("../app/my-work.tsx", import.meta.url), "utf8");
const guideUi = fs.readFileSync(new URL("../app/user-guide.tsx", import.meta.url), "utf8");
const guide = JSON.parse(fs.readFileSync(new URL("../content/user-guide.json", import.meta.url), "utf8"));

test("operational workspaces use direct business language", () => {
  const operational = [page, admin, estimating, integrations, media].join("\n");
  for (const removed of [
    "Make The Company Easier To Work In",
    "Hire Well. Support Clearly. Never Make Them Chase Us.",
    "Keep The Business Ready",
    "Decisions That Need A Move",
    "Project Health At A Glance",
    "Project Data In. Clean Signature Packet Out!",
    "Subcontractor First. Mefford Countersigns Second.",
    "Every Opportunity Sent From Sales Is Organized Here For Estimating And Proposal Review!",
  ]) assert.doesNotMatch(operational, new RegExp(removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const expected of [
    "Current Company Actions",
    "Employee Lifecycle Administration",
    "Action Queue",
    "Today Across Every Job",
    "Yesterday&apos;s Daily Logs",
    "Create Subcontract",
    "Application Section Status",
    "Markup Working Copy",
  ]) assert.match(operational, new RegExp(expected));

  for (const dashboardFiller of [
    "Your Company Snapshot Is Built Around The Decisions That Cannot Wait",
    "TODAY’S DECISION BRIEF",
    "MANAGEMENT STANDARD",
    "Decision Accountability",
    "Subcontract Document Workflow",
  ]) assert.doesNotMatch(page, new RegExp(dashboardFiller));

  for (const filler of ["ESTIMATOR OUTCOME", "SALESPERSON OUTCOME", "121 Primary Cost Codes", "Mefford Estimate Template", "Your Excel Will Become"]) {
    assert.equal(estimating.includes(filler), false, `${filler} must stay out of work screens`);
  }
});

test("employee and onboarding experiences retain a warmer voice", () => {
  assert.match(employee, /Everything You Need, In One Place/);
  assert.match(myWork, /My Tasks/);
});

test("a searchable maintained user manual is available from bottom navigation", () => {
  assert.equal(guide.chapters.length, 16);
  assert.ok(guide.chapters.every((chapter) => chapter.steps.length > 0 && chapter.notes.length > 0));
  assert.match(guideUi, /Search the manual/);
  assert.match(guideUi, /Print \/ Save PDF/);
  assert.match(page, /<span>User Guide<\/span>/);
  assert.match(page, /active === "User Guide"/);
  assert.match(page, /label: "User Guide", target: "User Guide"/);
});
