import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [automation, surveyApi, surveyUi, recipientApi, recipientUi, marketingApi, marketingUi, displayApi, displayUi, displayPhoto, schedule] = await Promise.all([
  readFile(new URL("../lib/customer-voice.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer-survey/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/customer-survey/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer-survey-recipients/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/customer-survey-recipient-control.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/marketing/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/marketing-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dashboard-display/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard-display/dashboard-display.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dashboard-display-photo/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/schedule-workspace.tsx", import.meta.url), "utf8"),
]);

test("contract types own their exact automatic survey cadence", () => {
  assert.match(automation, /family === "T&M"[\s\S]*invoiceTriggers/);
  assert.match(automation, /family === "Design-Build"/);
  assert.match(automation, /addDays\(contractDate, 3\)/);
  assert.match(automation, /addDays\(started\.date, 7\)/);
  assert.match(automation, /progress < 50/);
  assert.match(automation, /addDays\(turnover\.date, 7\)/);
  assert.match(automation, /addDays\(sentAt, 1\)/);
  assert.match(automation, /seen\.has\(dedupe\)/);
  assert.match(schedule, /actualStartedAt/);
});

test("every survey uses five clear star questions, comments, and optional HEIC photos", () => {
  for (const program of ["startup", "design", "midpoint", "completion", "monthly"]) assert.match(automation, new RegExp(`${program}: \\{[\\s\\S]*?questions: \\[[\\s\\S]*?\\]`));
  assert.equal((automation.match(/^\s+\["[A-Za-z]+", ".*\?"\],$/gm) || []).length, 25);
  assert.match(surveyUi, /"★"\.repeat\(rating\)/);
  assert.match(surveyUi, /Comments/);
  assert.match(surveyUi, /\.heic,\.heif/);
  assert.match(surveyApi, /MAX_PHOTOS = 8/);
  assert.match(surveyApi, /MAX_PHOTO_BYTES = 15 \* 1024 \* 1024/);
  assert.match(surveyApi, /isPhotoUpload/);
});

test("the primary recipient cannot be removed and PM-added recipients receive independent links", () => {
  assert.match(recipientApi, /primaryPolicy: "Required and cannot be removed/);
  assert.match(recipientApi, /isPm/);
  assert.match(recipientApi, /additional/);
  assert.match(recipientUi, /PRIMARY · ALWAYS INCLUDED/);
  assert.match(automation, /for \(const recipient of recipients\)/);
  assert.match(automation, /emailHash\(email\)/);
});

test("delivery and reminders are automatic but remain provider-receipt truthful", () => {
  assert.match(automation, /MARKETING_EMAIL_WEBHOOK_URL/);
  assert.match(automation, /Provider Accepted; inbox delivery is not yet proven/);
  assert.match(automation, /elapsedDays\(text\(prior\.acceptedAt\), now\) >= 4/);
  assert.match(automation, /:reminder-1/);
  assert.match(automation, /Delivery Failed/);
});

test("review display includes all ratings while consent gates identifying detail and photos", () => {
  assert.match(surveyApi, /displayConsent/);
  assert.match(displayApi, /displayConsent \? review\.respondent : "Anonymous Customer"/);
  assert.match(displayApi, /displaySeconds: rating >= 4 \? 30 : 5/);
  assert.match(displayApi, /Star Review Average/);
  assert.match(displayApi, /Total Reviews/);
  assert.match(displayApi, /5-Star Reviews/);
  assert.match(displayApi, /Response Rate/);
  assert.match(displayUi, /mefford-review-cycle-index/);
  assert.match(displayPhoto, /Customer Display Consent Is Required/);
});

test("marketing can create a one-off survey for historical completed work", () => {
  assert.match(marketingApi, /create-legacy-survey/);
  assert.match(marketingApi, /legacyProject: true/);
  assert.match(marketingApi, /Historical Customer Survey/);
  assert.match(marketingUi, /Historical One-Off/);
  assert.match(marketingUi, /Create & Send Historical Survey/);
});
