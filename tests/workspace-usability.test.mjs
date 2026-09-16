import assert from "node:assert/strict";
import test from "node:test";
import { authorizedShortcuts, everydayTargets, draftStorageKey, workActionLabel, nextWorkStep } from "../lib/workspace-usability.ts";

const tools = ["My Work", "Daily Logs", "Design & Drawings", "Safety", "Employee Portal"].map(target => ({ target, label: target, group: "Work" }));

test("personal pins cannot reveal tools outside the supplied permissions", () => {
  const actor = { accessLevel: "Employee", designations: ["Superintendent"] };
  const visible = authorizedShortcuts(actor, tools, ["Owner Approvals", "Accounts Payable", "Daily Logs", "Daily Logs"]);
  assert.deepEqual(visible.map(tool => tool.target), ["My Work", "Daily Logs"]);
});

test("role defaults prioritize each employee's actual work", () => {
  for (const [designation, expected] of [["Superintendent", "Daily Logs"], ["Project Manager", "Schedule"], ["Estimator", "Bid Management"], ["Accountant", "Accounts Payable"], ["Sales Representative", "Sales Funnel"]]) {
    const targets = everydayTargets({ accessLevel: "Employee", designations: [designation] });
    assert.ok(targets.includes(expected), designation);
    assert.ok(!targets.includes("Owner Approvals"), designation);
  }
  assert.ok(everydayTargets({ accessLevel: "Company Owner", designations: ["Superintendent"] }).includes("Owner Approvals"));
});

test("onboarding defaults are isolated and saved stale pins are filtered", () => {
  assert.deepEqual(everydayTargets({ permissionLocked: true }), ["Employee Portal"]);
  assert.deepEqual(authorizedShortcuts({ permissionLocked: true }, tools.filter(tool => tool.target === "Employee Portal"), ["Daily Logs"]).map(tool => tool.target), []);
});

test("empty personalized shortcuts retain the authorized personal work entry", () => {
  assert.deepEqual(authorizedShortcuts({}, tools, []).map(tool => tool.target), ["My Work"]);
});

test("unfinished drafts are isolated by canonical employee project and form", () => {
  assert.equal(draftStorageKey("A@EXAMPLE.COM", "26-001", "Daily Logs"), draftStorageKey("a@example.com", "26-001", "Daily Logs"));
  const keys = [draftStorageKey("a@example.com", "26-001", "Daily Logs"), draftStorageKey("b@example.com", "26-001", "Daily Logs"), draftStorageKey("a@example.com", "26-002", "Daily Logs"), draftStorageKey("a@example.com", "26-001", "RFIs")];
  assert.equal(new Set(keys).size, 4);
});

test("task labels name the action and notices do not imply workflow completion", () => {
  assert.equal(workActionLabel({ actionTarget: "Accounts Payable", kind: "Approval" }), "Review Invoice");
  assert.equal(workActionLabel({ actionTarget: "Daily Logs" }), "Open Daily Log");
  assert.equal(workActionLabel({ actionTarget: "Estimating To Operations Turnover" }), "Open Turnover");
  assert.equal(nextWorkStep({ sourceType: "Notification", status: "Open", actionTarget: "Accounts Payable" }), "Review The Notice");
  assert.equal(nextWorkStep({ sourceType: "Approval", status: "Open", accountableRole: "Project Manager", actionTarget: "Change Orders" }), "Waiting On Project Manager");
});
