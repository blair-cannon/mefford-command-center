import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [performanceCore, performanceApi, performanceUi, customerVoice, marketingApi, marketingUi, recordsApi, filesApi, page, admin, worker, integrations, directory] = await Promise.all([
  readFile(new URL("../lib/performance-reviews.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/performance-reviews/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/performance-reviews-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/customer-voice.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/marketing/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/marketing-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/files/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin-command-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/integration-health.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/company-directory.ts", import.meta.url), "utf8"),
]);

test("performance reviews are owner-only at the navigation, API, and generic-record boundaries", () => {
  assert.match(page, /target === "Performance Reviews"[\s\S]*actor\.accessLevel === "Company Owner"/);
  assert.match(performanceApi, /access !== "Company Owner"/);
  assert.match(recordsApi, /MEFFORD-PERFORMANCE/);
  assert.match(recordsApi, /Use The Owner-Only Performance Review/);
  assert.doesNotMatch(performanceUi, /OWNER ONLY/);
});

test("role-specific evidence covers field, project management, accounting, estimating, sales, and IT", () => {
  for (const key of ["daily-logs", "field-safety", "pm-budget", "pm-buyout", "accounting-ar", "accounting-collections", "estimating-win", "estimating-timeliness", "sales-goal", "sales-conversion", "it-uptime", "it-incidents", "it-automation", "it-maintenance"]) assert.match(performanceCore, new RegExp(`key: "${key}"`));
  assert.match(performanceCore, /Provider-caused downtime/);
  assert.match(performanceCore, /average recorded resolution/);
  assert.match(performanceCore, /missing evidence is not a failing score/i);
});

test("owner calibration is narrow, reasoned, and cannot overwrite the system score", () => {
  assert.match(performanceApi, /Math\.max\(-10, Math\.min\(10/);
  assert.match(performanceApi, /Explain Every Owner Calibration/);
  assert.match(performanceApi, /systemScoreLocked: true/);
  assert.match(performanceUi, /System score .* remains locked/);
  assert.match(performanceApi, /A Finalized Review Is Immutable/);
});

test("ChatGPT produces strict structured evidence narrative without employment authority", () => {
  assert.match(performanceApi, /type: "json_schema"/);
  assert.match(performanceApi, /strict: true/);
  assert.match(performanceApi, /Never infer protected traits/);
  assert.match(performanceApi, /Do not change a score/);
  assert.match(performanceApi, /recommend termination, compensation, promotion, discipline/);
  assert.match(performanceUi, /It cannot change a score/);
});

test("customer surveys use automatic contract-type, schedule, turnover, and invoice triggers", () => {
  for (const milestone of ["startup", "design", "midpoint", "completion", "monthly"]) assert.match(customerVoice, new RegExp(`${milestone}: \{`));
  assert.match(customerVoice, /contractFamily\(project\)/);
  assert.match(customerVoice, /scheduleMidpoint/);
  assert.match(customerVoice, /CLS-KEYS-STOCK/);
  assert.match(customerVoice, /Owner Billing/);
  assert.match(customerVoice, /billingPeriod/);
  assert.match(customerVoice, /recipientEmail/);
  assert.match(customerVoice, /reminderAcceptedAt/);
  assert.match(customerVoice, /onConflictDoUpdate/);
  assert.match(worker, /case "customer-survey-milestones"/);
});

test("survey delivery stays connection-gated while verified response capture and video are live", () => {
  assert.match(customerVoice, /MARKETING_EMAIL_WEBHOOK_URL/);
  assert.match(customerVoice, /CUSTOMER_SURVEY_PUBLIC_ORIGIN/);
  assert.match(customerVoice, /surveyConnection === "Connected"/);
  assert.match(marketingApi, /upload-survey-video/);
  assert.match(marketingApi, /MAX_SURVEY_VIDEO_BYTES/);
  assert.match(marketingApi, /Marketing Customer Survey Response/);
  assert.match(marketingUi, /Customer Voice/);
  assert.match(marketingUi, /marketingConsent/);
  assert.match(marketingUi, /Upload Video/);
  assert.match(marketingUi, /Historical One-Off/);
  assert.doesNotMatch(marketingUi, /CUSTOMER REVIEW DASHBOARD/);
  assert.match(filesApi, /Marketing Or Assigned Project Team Access Is Required/);
});

test("every external service and automation has one IT management home", () => {
  for (const key of ["openai-command-ai", "project-weather-geocoding", "paylocity-payroll", "united-healthcare-benefits", "northwestern-mutual-life", "linkedin-company", "facebook-company", "google-analytics", "marketing-email", "customer-survey-delivery"]) assert.match(integrations, new RegExp(`key: "${key}"`));
  assert.match(page, /target: "Admin Operations"/);
  assert.match(admin, /"IT & Integrations"/);
  assert.match(marketingUi, /Open IT &amp; Integrations/);
  assert.match(performanceCore, /IT Administrator/);
});

test("Blain Faulkner is the live IT Administrator and receives IT performance evidence", () => {
  assert.match(directory, /Blain Faulkner[\s\S]*it@meffcon\.com[\s\S]*defaultDesignations: \["IT Administrator"\]/);
  assert.match(performanceCore, /roles\.has\("IT Administrator"\)[\s\S]*addItMetrics/);
  assert.match(directory, /IT & Integrations Administration And IT Performance Review Evidence/);
});
