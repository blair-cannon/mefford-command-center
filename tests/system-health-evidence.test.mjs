import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateEvidenceStatus,
  normalizeEvidenceCheck,
  overallEvidenceStatus,
  statusCounts,
} from "../lib/system-health-evidence.js";

const [workflowCatalog, sectionCatalog, runtimeProbe, scheduler, integrationUi] = await Promise.all([
  readFile(new URL("../lib/system-audit.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/section-readiness.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/system-health-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/scheduled-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/integration-health.tsx", import.meta.url), "utf8"),
]);

const verified = (key = "proof") => ({ key, label: key, status: "Verified", required: true, observedAt: "2026-08-23T12:00:00.000Z", expiresAt: "2026-08-23T13:00:00.000Z", source: "Executable Test", detail: "Passed" });

test("missing required evidence can never produce Verified", () => {
  assert.equal(evaluateEvidenceStatus([]), "Unknown");
  assert.equal(evaluateEvidenceStatus([{ key: "missing", label: "Missing", status: "Unknown", required: true }]), "Unknown");
});

test("only current passing required checks produce Verified", () => {
  const now = new Date("2026-08-23T12:30:00.000Z");
  assert.equal(evaluateEvidenceStatus([verified("database"), verified("workflow"), verified("authorization"), verified("release")], now), "Verified");
  const expired = normalizeEvidenceCheck({ ...verified("stale"), expiresAt: "2026-08-23T12:29:59.000Z" }, now);
  assert.equal(expired.status, "Unknown");
  assert.match(expired.detail, /expired/i);
});

test("known failures and degradation remain visible", () => {
  assert.equal(evaluateEvidenceStatus([verified(), { key: "failed", label: "Failed", status: "Failed", required: true }]), "Failed");
  assert.equal(evaluateEvidenceStatus([verified(), { key: "late", label: "Late", status: "Degraded", required: true }]), "Degraded");
  assert.equal(overallEvidenceStatus([{ status: "Verified" }, { status: "Unknown" }]), "Unknown");
});

test("optional unconfigured providers do not falsely fail verified internal work", () => {
  const now = new Date("2026-08-23T12:30:00.000Z");
  assert.equal(evaluateEvidenceStatus([verified(), { key: "email", label: "Email", status: "Not Configured", required: false }], now), "Verified");
  assert.equal(evaluateEvidenceStatus([verified(), { key: "required-provider", label: "Provider", status: "Not Configured", required: true }], now), "Not Configured");
});

test("status summaries preserve every evidence state", () => {
  assert.deepEqual(statusCounts([{ status: "Verified" }, { status: "Unknown" }, { status: "Failed" }, { status: "Unknown" }]), { Verified: 1, Degraded: 0, Failed: 1, Unknown: 2, "Not Configured": 0 });
});

test("catalogs contain design intent but no automatic Live status", () => {
  assert.doesNotMatch(workflowCatalog, /status:\s*"Live"/);
  assert.doesNotMatch(sectionCatalog, /status:\s*"Live"/);
  assert.match(workflowCatalog, /Upstream-To-Downstream Reconciliation/);
  assert.match(sectionCatalog, /Authorization Boundary Test/);
});

test("runtime probes measure evidence required by F-01", () => {
  for (const phrase of ["D1 Read And Write Probe", "Server-Executed R2 List Probe", "Current Request Authentication", "notification_delivery_events", "scheduled_operation_runs", "No linked production activity"]) assert.match(runtimeProbe, new RegExp(phrase));
  for (const phrase of ["expectedRuns24h", "observedRuns24h", "stuckRuns", "oldestStuckAgeMinutes", "maxRunMinutes"]) assert.match(scheduler, new RegExp(phrase));
  assert.doesNotMatch(integrationUi, /Missing proof is never treated as success/);
  assert.match(integrationUi, /required checks verified/);
  assert.doesNotMatch(integrationUi, /LIVE HANDOFFS|OCR \/ AI LIVE/);
});
