import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  accessStatusAllowsSignIn,
  fullCompanyAccessAllowed,
  isEmployeeAccountCandidate,
  normalizeDirectoryPerson,
  statusAfterOwnerGrant,
  statusAfterOwnerRestore,
  validOwnerDecisionReason,
} from "../lib/microsoft-access.ts";

const [schema, server, route, ui, graph, session, employeeMicrosoft, scheduler, actor, webhook, subscriptions, webhookSecurity] = await Promise.all([
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-access-server.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/microsoft-access/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/microsoft-access-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-graph.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-microsoft/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/server-actor.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/meetings/microsoft-webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-subscriptions.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-webhook-security.ts", import.meta.url), "utf8"),
]);

test("directory normalization keeps the immutable Microsoft object ID and rejects unusable accounts", () => {
  assert.deepEqual(normalizeDirectoryPerson({
    id: "2bb9b5ee-0552-46f1-a2ce-c40a7f72f750",
    displayName: "New Employee",
    userPrincipalName: "New.Employee@meffcon.com",
    mail: "new.employee@meffcon.com",
    userType: "Member",
    accountEnabled: true,
  }), {
    providerSubject: "2bb9b5ee-0552-46f1-a2ce-c40a7f72f750",
    displayName: "New Employee",
    userPrincipalName: "new.employee@meffcon.com",
    mail: "new.employee@meffcon.com",
    jobTitle: "",
    department: "",
    userType: "Member",
    accountEnabled: true,
  });
  assert.equal(normalizeDirectoryPerson({ id: "", mail: "new.employee@meffcon.com" }), null);
  assert.equal(isEmployeeAccountCandidate({ userType: "Member", email: "new.employee@meffcon.com", accountEnabled: true, directoryPresent: true }), true);
  assert.equal(isEmployeeAccountCandidate({ userType: "Guest", email: "guest@meffcon.com", accountEnabled: true, directoryPresent: true }), false);
  assert.equal(isEmployeeAccountCandidate({ userType: "Member", email: "outside@example.com", accountEnabled: true, directoryPresent: true }), false);
});

test("Microsoft discovery, onboarding, and full access remain separate gates", () => {
  assert.equal(statusAfterOwnerGrant({ onboardingComplete: false }), "Onboarding Access");
  assert.equal(statusAfterOwnerGrant({ onboardingComplete: true }), "Active");
  assert.equal(statusAfterOwnerRestore({ onboardingComplete: false }), "Onboarding Access");
  assert.equal(accessStatusAllowsSignIn("No Access"), false);
  assert.equal(accessStatusAllowsSignIn("Onboarding Access"), true);
  assert.equal(fullCompanyAccessAllowed("Onboarding Access"), false);
  assert.equal(fullCompanyAccessAllowed("Active"), true);
  assert.equal(validOwnerDecisionReason("short"), false);
  assert.equal(validOwnerDecisionReason("Approved new project manager access"), true);
});

test("only an owner may change access and every decision is permanent evidence", () => {
  assert.match(server, /Only A Company Owner Can Change Command Center Access/);
  for (const action of ["grant-access", "update-access", "activate-access", "suspend-access", "revoke-access", "restore-access"]) {
    assert.match(route, new RegExp(action));
  }
  assert.match(server, /microsoft_access_audits/);
  assert.match(server, /Owner reapproval required after Microsoft re-enables the account/);
  assert.match(server, /Microsoft Directory Automatically Blocked Access/);
  assert.match(server, /company_members SET is_active = 0/);
  assert.match(route, /canSync/);
  assert.match(route, /canManage/);
  assert.match(server, /Only An Approved Onboarding Access Record Can Be Activated/);
  assert.match(server, /Only Suspended, Revoked, Or Microsoft-Disabled Access Can Be Restored/);
});

test("directory sync never grants access and reconciles automatically", () => {
  assert.match(graph, /listMicrosoftDirectoryUsers/);
  assert.match(graph, /User\.Read\.All/);
  assert.match(server, /UPDATE microsoft_directory_users SET directory_present = 0/);
  const syncImplementation = server.slice(server.indexOf("export async function syncMicrosoftDirectory"), server.indexOf("export async function loadMicrosoftAccessSnapshot"));
  assert.doesNotMatch(syncImplementation, /INSERT INTO company_members/);
  assert.match(scheduler, /microsoft-directory-sync/);
  assert.doesNotMatch(ui, /Microsoft Accounts Do Not Automatically Receive Access/);
  assert.doesNotMatch(ui, /IT cannot approve access/);
  assert.match(ui, /Sync Microsoft Directory/);
});

test("individual Microsoft work uses the authorized mailbox and is audited", () => {
  assert.match(employeeMicrosoft, /authorizedMicrosoftIdentityForActor/);
  assert.match(employeeMicrosoft, /identity\.microsoftEmail/);
  assert.match(employeeMicrosoft, /recordMicrosoftActivity/);
  assert.match(schema, /microsoft_activity_audits/);
  assert.match(actor, /FROM command_identity_aliases/);
  assert.doesNotMatch(actor, /djmeff22@gmail\.com/);
  assert.match(route, /Temporary ChatGPT Login Bridge Disabled/);
  assert.match(server, /Link And Owner-Approve This Microsoft Account Before Outlook, Calendar, Or Teams Can Be Used/);
});

test("session enforcement is fail-closed only after the controlled activation switch", () => {
  assert.match(server, /MICROSOFT_ACCESS_CONTROL_ENFORCED/);
  assert.match(session, /microsoftAccessGateForActor/);
  assert.match(session, /if \(!microsoftAccess\.allowed\)/);
  assert.match(server, /actor\.accessLevel === "Company Owner" && !connection\.enforced/);
  assert.match(ui, /Enforcement Held For Verification/);
  assert.doesNotMatch(ui, /The current Jordan-and-Blain private access remains unchanged/);
});

test("Microsoft webhooks fail closed and subscriptions renew before expiration", () => {
  assert.match(webhook, /handleMicrosoftWebhookRequest/);
  assert.match(webhookSecurity, /if \(!expected\).*503/);
  assert.match(webhookSecurity, /secretsMatch/);
  assert.match(webhookSecurity, /Subscription Validation Failed/);
  assert.match(webhookSecurity, /consumeRateLimit/);
  assert.match(webhookSecurity, /consumeValidationWindow/);
  assert.match(webhookSecurity, /recordSecurityEvent/);
  assert.match(subscriptions, /renewBefore/);
  assert.match(subscriptions, /\/subscriptions/);
  assert.match(subscriptions, /client_state_hash/);
  assert.match(subscriptions, /openWebhookValidationWindow/);
  assert.doesNotMatch(subscriptions, /client_state[^\n]*VALUES[^\n]*clientState/);
  assert.match(scheduler, /microsoft-subscription-renewal/);
});
