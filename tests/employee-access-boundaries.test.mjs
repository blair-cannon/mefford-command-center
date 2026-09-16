import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  page,
  session,
  onboardingLogic,
  onboardingApi,
  assistant,
  assistantUi,
  mobile,
  purchaseOrders,
  safety,
  selections,
  teamAccess,
] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/onboarding.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/command-assistant.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/mobile-command.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/purchase-orders/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/safety/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/selections/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/team-access/route.ts", import.meta.url), "utf8"),
]);

test("company workspace waits for verified employee access and fails closed", () => {
  assert.match(page, /accessLevel: "Employee",[\s\S]*?permissionLocked: true/);
  assert.match(page, /sessionStatus !== "ready"/);
  assert.match(page, /Verifying Employee Access/);
  assert.match(session, /Employee Access Status Could Not Be Verified/);
  assert.match(session, /\{ status: 503 \}/);
  assert.match(onboardingLogic, /Company Permissions Remain Locked/);
  assert.match(onboardingLogic, /onboardingStatus: "Verification Unavailable"/);
  assert.match(onboardingLogic, /onboardingState\(employee, await getOnboardingRequirements\(\)\)/);
  assert.match(onboardingApi, /mergeOnboardingRequirements/);
});

test("locked employees receive an employee-only shell and lose cached company work", () => {
  assert.match(page, /className="locked-employee-shell"/);
  assert.match(page, />My Work<\/button>/);
  assert.match(page, /Command Center routes company review automatically/);
  assert.doesNotMatch(page, /Onboarding & Renewal/);
  assert.match(page, /void clearOfflineMobileData\(\)/);
  assert.match(page, /setRecords\(createCleanProjectRecords\(\)\)/);
  assert.match(mobile, /if \(actor\.permissionLocked\) return null/);
});

test("a locked administrator can complete only their own requirements", () => {
  assert.match(onboardingApi, /effectiveAdmin = admin && currentEmployee\?\.permissionLocked !== true/);
  assert.match(onboardingApi, /actorLocked && \(targetEmail !== actor\.email \|\| action !== "complete_requirement"\)/);
  assert.match(onboardingApi, /status: 423/);
});

test("controlled sections and assistant enforce onboarding at the server boundary", () => {
  for (const source of [assistant, purchaseOrders, safety, selections, teamAccess]) {
    assert.match(source, /enforceOnboardingAccess\(request\)/);
    assert.match(source, /if \(onboardingLock\) return onboardingLock/);
  }
  assert.match(assistantUi, /if \(permissionLocked\) return null/);
  assert.match(assistantUi, /configured \? "Ask AI" : "Connect AI"/);
});
