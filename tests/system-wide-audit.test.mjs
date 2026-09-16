import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractInvoiceFields } from "../lib/invoice-ocr.js";
import { extractAssetDocumentFields } from "../lib/asset-document-ocr.js";

const [audit, integrationApi, integrationUi, runtime, ap, heartbeat, commandScheduler, page, assistant, schedule, assetUi, assetApi] = await Promise.all([
  readFile(new URL("../lib/system-audit.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/integration-health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/integration-health.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/integration-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/accounts-payable.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/automation-heartbeat/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedule-intelligence/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/asset-tracking-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
]);

test("permanent system audit covers every major cross-department workflow with no single-system rows", () => {
  const rows = [...audit.matchAll(/workflow\("([^"]+)",\s*"([^"]+)",\s*\[([^\]]+)\]/g)];
  assert.ok(rows.length >= 17, `expected at least 17 end-to-end workflows, found ${rows.length}`);
  const ids = rows.map((row) => row[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of rows) {
    const systems = [...row[3].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    assert.ok(systems.length >= 2, `${row[2]} must connect at least two systems`);
  }
  for (const phrase of ["Contact To Contracted Project", "Quote To Proposal Scope", "Executed Change Order Control", "Schedule To Pre-Work Quality", "Invoice To Job Cost And Cash", "Project Milestone To Customer Voice", "Integration Incident To IT Accountability"]) assert.match(audit, new RegExp(phrase));
});

test("IT Center exposes workflow, OCR, native-data, OpenAI, and runtime-credential truth", () => {
  assert.match(integrationApi, /systemAuditSnapshot/);
  assert.match(integrationApi, /integrationRuntimeSnapshot/);
  assert.match(integrationApi, /Cannot Be Marked Connected/);
  assert.match(integrationUi, /Workflow Proof Is Incomplete/);
  assert.doesNotMatch(integrationUi, /Missing proof is never treated as success/);
  assert.match(integrationUi, /OCR Where It Helps · Native Data Where It Is Safer/);
  assert.match(integrationUi, /RUNTIME CONFIGURATION/);
  for (const key of ["OPENAI_API_KEY", "MICROSOFT_GRAPH_TENANT_ID", "OPERATIONAL_EMAIL_WEBHOOK_URL", "MARKETING_SOCIAL_WEBHOOK_URL", "MARKETING_EMAIL_WEBHOOK_URL", "CUSTOMER_SURVEY_PUBLIC_ORIGIN"]) assert.match(runtime, new RegExp(key));
  assert.doesNotMatch(runtime, /value:\s*values\[/);
});

test("invoice OCR extracts conservative AP suggestions from a representative invoice", () => {
  const result = extractInvoiceFields(`
Bluegrass Electrical LLC
Invoice Number: BE-26018
Invoice Date: 08/18/2026
Due Date: 09/17/2026
PO Number: PO-26-001-004
Electrical labor and material provided for service rough-in
Subtotal $24,500.00
Tax $0.00
AMOUNT DUE $24,500.00
  `);
  assert.equal(result.vendor, "Bluegrass Electrical LLC");
  assert.equal(result.invoiceNumber, "BE-26018");
  assert.equal(result.invoiceDate, "2026-08-18");
  assert.equal(result.dueDate, "2026-09-17");
  assert.equal(result.poReference, "PO-26-001-004");
  assert.equal(result.total, 24_500);
  assert.match(result.description, /Electrical labor and material/i);
});

test("Accounts Payable OCR preserves the original and blocks unreviewed suggestions", () => {
  for (const phrase of ["recognizeMobileDocument", "extractInvoiceFields", "Review The OCR Suggestions Against The Original Invoice", "Human Reviewed", "originalPreserved: true"]) assert.match(ap, new RegExp(phrase));
  assert.doesNotMatch(ap, /No OCR Is Used/);
});

test("asset document OCR extracts identity and expiration suggestions without overwriting reviewed fields", () => {
  const result = extractAssetDocumentFields(`VIN: 1FTFW1E50NFA12345\nLicense Plate: 345 ABC\nPolicy Number: MC-88420\nCoverage Ends: 10/31/2027\nInvoice Total $1,245.00`);
  assert.equal(result.vin, "1FTFW1E50NFA12345");
  assert.equal(result.licensePlate, "345 ABC");
  assert.equal(result.policyNumber, "MC-88420");
  assert.equal(result.expirationDate, "2027-10-31");
  assert.equal(result.amount, 1_245);
  for (const phrase of ["recognizeMobileDocument", "extractAssetDocumentFields", "Review The Document Suggestions Against The Original", "only empty asset identity or expiration fields may be filled"]) assert.match(assetUi, new RegExp(phrase, "i"));
  assert.match(assetApi, /!text\(data\.vin\)/);
  assert.match(assetApi, /Asset Document OCR Reviewed/);
});

test("authenticated sessions provide an idempotent scheduler fallback with a permanent run ledger", () => {
  assert.match(page, /<AutomationHeartbeat \/>/);
  assert.match(heartbeat, /automation_heartbeat_claims/);
  assert.match(heartbeat, /INSERT OR IGNORE/);
  for (const job of ["domain-outbox-reconciliation", "integration-health", "microsoft-directory-sync", "microsoft-subscription-renewal", "operational-notice-delivery", "closeout-reconciliation", "morning-work-digests", "meeting-rules", "customer-survey-milestones", "asset-readiness", "project-health-nightly", "quarterly-performance-reviews"]) assert.match(commandScheduler, new RegExp(job));
  assert.match(heartbeat, /runCommandSchedulerCycle/);
  assert.match(commandScheduler, /runScheduledOperation/);
});

test("assistant and schedule intelligence share the production OpenAI model setting", () => {
  assert.match(assistant, /OPENAI_MODEL \|\| binding\.OPENAI_ASSISTANT_MODEL/);
  assert.match(schedule, /OPENAI_MODEL \|\| binding\.OPENAI_ASSISTANT_MODEL/);
});
