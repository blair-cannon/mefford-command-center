import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [core, api, webhook, ui, page, admin, worker, myWork, systemStatus, gate] = await Promise.all([
  readFile(new URL("../lib/integration-health.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/integration-health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/integration-health/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/integration-health.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-command-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/my-work.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/system-status/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/system-maintenance-gate.tsx", import.meta.url), "utf8"),
]);
const runtime = await readFile(new URL("../lib/integration-runtime.ts", import.meta.url), "utf8");

test("IT Center registers every platform, operating, payroll, benefits, marketing, and AI connection", () => {
  for (const name of ["Command Center Platform", "OpenAI Command Intelligence", "Microsoft Identity", "Microsoft SharePoint & Files", "Operational Email", "Project Address Weather & Geocoding", "Ubiquiti Cameras & Access", "Ramp", "Chase & Banking", "Paylocity Payroll Exchange", "UnitedHealthcare Benefits Resources", "Northwestern Mutual Life Insurance", "LinkedIn Company Page", "Secure Customer Survey Delivery"]) assert.match(core, new RegExp(name.replace(/[&]/g, "\\&")));
});

test("health center uses the six approved plain-language states", () => {
  for (const status of ["Connected", "Degraded", "Failed", "Reauthorization Required", "Maintenance", "Not Configured"]) assert.match(core, new RegExp(status));
});

test("role visibility and financial replay approvals are enforced server-side", () => {
  assert.match(api, /IT Administrator/);
  assert.match(api, /Pending Accounting Review/);
  assert.match(api, /Pending Owner Approval/);
  assert.match(api, /Company Owner Approval Is Required/);
  assert.match(api, /visibleConnection/);
});

test("sync conflicts preserve both versions in quarantine until audited resolution", () => {
  assert.match(api, /Both Versions Preserved/);
  assert.match(api, /Source Version Accepted/);
  assert.match(api, /Command Center Version Accepted/);
  assert.match(api, /Reviewed Merge/);
  assert.match(ui, /Both originals remain permanent/);
});

test("health proof retains balanced counts, duplicate prevention and masked sample ids", () => {
  for (const field of ["sourceCount", "importedCount", "skippedCount", "failedCount", "duplicatesPrevented", "sampleRecordIds"]) assert.match(api, new RegExp(field));
  assert.match(api, /maskedSamples/);
  assert.match(webhook, /duplicatePrevented/);
});

test("provider webhook uses an encrypted environment secret and prevents duplicate events", () => {
  assert.match(webhook, /INTEGRATION_WEBHOOK_SECRET/);
  assert.match(webhook, /constantTimeEqual/);
  assert.match(webhook, /lastProviderEventId/);
});

test("automatic safe retries use idempotency controls and never post or pay", () => {
  assert.match(api, /INTEGRATION_RETRY_ADAPTER_URL/);
  assert.match(api, /idempotent: true/);
  assert.match(api, /preventDuplicates: true/);
  assert.match(api, /postFinancials: false/);
  assert.match(api, /pay: false/);
});

test("Saturday maintenance runs only when scheduled and warns all users about overruns", () => {
  assert.match(api, /The Standard Maintenance Window Must Begin On Saturday/);
  assert.match(api, /expectedEndTime > "06:00"/);
  assert.match(api, /notifyAllActiveMembers/);
  assert.match(systemStatus, /command-center-platform/);
  assert.match(gate, /checks automatically every 30 seconds/);
});

test("the polled system status is read-only, fast, and never reports a failed health check as available", () => {
  assert.doesNotMatch(systemStatus, /reconcileIntegrationHealth/);
  assert.match(systemStatus, /status: "Degraded"/);
  assert.match(systemStatus, /healthCheck: "Database Unavailable"/);
  assert.match(systemStatus, /\{ status: 503 \}/);
});

test("Command Center self-health is connected only after the app and database respond", () => {
  assert.match(api, /Application And Database Responding/);
  assert.match(api, /Native Platform Health/);
  assert.match(api, /lastSuccessfulAt: now/);
});

test("scheduled operations reconcile integrations and deliver queued notices", () => {
  assert.match(worker, /reconcileIntegrationHealth/);
  assert.match(worker, /deliverQueuedOperationalNotices/);
  assert.match(myWork, /export async function deliverQueuedOperationalNotices/);
});

test("connection setup separates test and production and records all go-live gates", () => {
  assert.match(api, /productionSeparated: true/);
  for (const item of ["Field mapping validated", "Permissions reviewed", "Test synchronization passed", "Rollback test passed", "Responsible department approved"]) assert.match(core, new RegExp(item));
});

test("active secrets stay out of SharePoint while recovery records map to the restricted folder", () => {
  assert.match(core, /Active secrets remain in encrypted platform storage/);
  assert.match(core, /SharePoint stores restricted recovery and rotation records only/);
  assert.match(ui, /Restricted SharePoint Recovery Records Folder/);
});

test("IT and Integrations is wired into company navigation and responsive workspace", () => {
  assert.match(page, /IntegrationHealthWorkspace/);
  assert.match(admin, /"IT & Integrations"/);
  assert.match(page, /target: "Admin Operations"/);
  assert.match(page, /SystemMaintenanceGate/);
  assert.match(ui, /IT & Integrations Center/);
  assert.match(ui, /aria-label="IT and Integrations sections"/);
  assert.match(ui, /Acknowledge & Triage/);
});

test("inventory-only adapters cannot impersonate implemented or connected systems", () => {
  for (const key of ["ubiquiti-unifi", "fleet-gps-telematics", "ramp", "chase-banking"]) {
    assert.match(runtime, new RegExp(`key: "${key}"[\\s\\S]*?activationState: "Not Implemented"`));
  }
  assert.match(api, /activationState === "Not Implemented"/);
  assert.match(api, /Has No Implemented Adapter And Cannot Receive An Operational Health Certification/);
  assert.match(ui, /Inventory only · implement and test a server-side adapter/);
});
