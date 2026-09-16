import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [marketing, marketingApi, page, customerVoice, publicApi, publicPage] = await Promise.all([
  readFile(new URL("../app/marketing-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/marketing/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/customer-voice.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/customer-survey/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/customer-survey/page.tsx", import.meta.url), "utf8"),
]);

test("Marketing Command is organized into the four requested operating areas", () => {
  for (const section of ["Social Campaigns", "Email Campaigns", "Customer Surveys", "Marketing Calendar"]) assert.match(marketing, new RegExp(section));
  for (const target of ["Marketing Social", "Marketing Email", "Marketing Surveys", "Marketing Calendar"]) assert.match(page, new RegExp(`target: "${target}"`));
  assert.match(marketing, /const tab: Exclude<Tab, "Connections"> = initialTab/);
  assert.doesNotMatch(marketing, /marketing-domain-tabs/);
  assert.match(marketing, /Social Publishing Connections/);
  assert.match(marketing, /Email Delivery Connection/);
  assert.match(marketing, /Survey Delivery Connections/);
  assert.match(marketing, /MarketingCalendar[\s\S]*newsletters/);
});

test("each marketing module has its own controls layout requirements and templates", () => {
  for (const component of ["SocialTemplateLibrary", "EmailTemplateLibrary", "SurveyProgramTemplateLibrary", "CampaignFormV2", "PostFormV2", "NewsletterFormV2"]) assert.match(marketing, new RegExp(`function ${component}`));
  for (const template of ["Project Spotlight", "Project Milestone", "Expert Tip", "Team & Culture", "External Monthly Update", "Project Announcement", "Employee Company Update", "Event Invitation"]) assert.match(marketing, new RegExp(template.replace(/[&]/g, "\\&")));
  for (const requirement of ["Alt text when pictures are used", "Inbox preview text", "Suppression, consent status, unsubscribe", "Design-Build", "Plan & Spec", "Time & Materials"]) assert.match(marketing, new RegExp(requirement.replace(/[&]/g, "\\&")));
  assert.match(marketingApi, /Image Alt Text Is Required When A Social Post Includes Pictures/);
  assert.match(marketingApi, /Email Audience Subject Preview Message Call To Action And Planned Delivery Are Required/);
});

test("social and email workflows have real connection-aware release controls", () => {
  assert.match(marketing, /Social Publishing Queue/);
  assert.match(marketing, /Approve &amp; Publish/);
  assert.match(marketing, /Email Release Queue/);
  assert.match(marketing, /Send Test/);
  assert.match(marketing, /Approve &amp; Schedule/);
  assert.match(marketingApi, /MARKETING_SOCIAL_WEBHOOK_URL/);
  assert.match(marketingApi, /MARKETING_EMAIL_WEBHOOK_URL/);
  assert.match(marketingApi, /Owner Or Administrator Final Approval Is Required/);
  assert.match(marketingApi, /providerReceipt/);
});

test("email campaigns manage the live CRM audience and suppression at release", () => {
  assert.match(marketing, /External Newsletter Audience/);
  assert.match(marketing, /Consent Review/);
  assert.match(marketing, /Do Not Email/);
  assert.match(marketing, /Suppressed/);
  assert.match(marketingApi, /setAudienceStatus/);
  assert.match(marketingApi, /eligibleExternalRecipients/);
  assert.match(marketingApi, /recalculateAudienceAtRelease: true/);
  assert.match(marketingApi, /suppressionApplied: true/);
});

test("survey milestones produce a real single-use customer form instead of the application home page", () => {
  assert.match(customerVoice, /\/customer-survey\?token=/);
  assert.doesNotMatch(customerVoice, /\/\?customerSurvey=/);
  assert.match(marketing, /Secure Link Control/);
  assert.match(marketing, /Copy Link/);
  assert.match(marketing, /Open &amp; Test/);
  assert.match(publicPage, /How are we doing\?/);
  assert.match(publicPage, /Submit My Feedback/);
});

test("customer responses are token-derived, single-use, audited, and preserve explicit display consent", () => {
  assert.match(publicApi, /safe\(parse\(item\.dataJson\)\.token/);
  assert.match(publicApi, /This Survey Was Already Completed/);
  assert.match(publicApi, /Customer Survey Response/);
  assert.match(publicApi, /const displayConsent = input\.displayConsent === true/);
  assert.match(publicApi, /marketingConsent: displayConsent/);
  assert.match(publicApi, /projectManager: safe\(data\.projectManager/);
  assert.match(publicApi, /superintendent: safe\(data\.superintendent/);
  assert.doesNotMatch(publicApi, /getCommandActor/);
});

test("automatic survey email remains connection-gated while manual links remain usable", () => {
  assert.match(customerVoice, /ready \? "Queued For Automatic Delivery" : "Manual Link Ready · Delivery Deferred"/);
  assert.match(customerVoice, /scheduledOutcome: "Deferred"/);
  assert.match(customerVoice, /providerReceipt/);
  assert.match(customerVoice, /settings\.webhookUrl/);
  assert.match(customerVoice, /settings\.surveyOrigin/);
  assert.match(customerVoice, /settings\.marketingConnection === "Connected"/);
  assert.match(customerVoice, /settings\.surveyConnection === "Connected"/);
});
