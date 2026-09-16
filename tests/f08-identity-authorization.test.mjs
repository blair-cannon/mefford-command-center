import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actor, migration, routes] = await Promise.all([
  readFile(new URL("../lib/server-actor.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0022_narrow_centennial.sql", import.meta.url), "utf8"),
  Promise.all([
    "records", "projects", "contracts", "accounting", "microsoft-access", "owner-delete",
  ].map((route) => readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8"))),
]);
const [microsoftAccess, microsoftAccessUi] = await Promise.all([
  readFile(new URL("../app/api/microsoft-access/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/microsoft-access-center.tsx", import.meta.url), "utf8"),
]);

test("roles are never granted by a hard-coded email", () => {
  assert.doesNotMatch(actor, /OWNER_EMAILS|COMMAND_IDENTITY_EMAILS/);
  assert.match(actor, /FROM company_members/);
  assert.match(actor, /is_active/);
  assert.match(actor, /microsoftAccessGateForActor/);
  assert.match(actor, /authenticated: false, authorizationStatus: "Inactive"/);
  assert.match(actor, /authenticated: false, authorizationStatus: "Unregistered"/);
});

test("Jordan's Gmail address is a temporary verified authentication bridge only", () => {
  assert.match(migration, /Temporary ChatGPT And Sites Authentication Bridge Only/);
  assert.match(migration, /'djmeff22@gmail\.com', 'jmefford@meffcon\.com'/);
  assert.match(migration, /disable_after_microsoft_cutover/);
  assert.doesNotMatch(actor, /djmeff22@gmail\.com/);
});

test("representative protected routes use the central authorization resolver", () => {
  for (const route of routes) {
    assert.match(route, /await resolveCommandActor\(request\)/);
  }
});

test("the migration consolidates Jordan's historical work and audit attribution", () => {
  for (const table of [
    "command_work_items", "command_notifications", "record_audits", "work_item_audits",
    "assistant_audits", "microsoft_access_audits", "microsoft_activity_audits",
    "owner_contract_revisions", "owner_portal_audits",
  ]) assert.match(migration, new RegExp("UPDATE `" + table + "`"));
});

test("the temporary bridge can be retired only after canonical Microsoft sign-in is independently proven", () => {
  assert.match(microsoftAccess, /actor\.authenticationEmail\?\.toLowerCase\(\) === "jmefford@meffcon\.com"/);
  assert.match(microsoftAccess, /snapshot\.connection\.enforced/);
  assert.match(microsoftAccess, /microsoftUser\.accessStatus === "Active"/);
  assert.match(microsoftAccess, /DISABLE DJMEFF22 GMAIL BRIDGE/);
  assert.match(microsoftAccess, /UPDATE command_identity_aliases SET disabled_at/);
  assert.match(microsoftAccessUi, /Temporary ChatGPT Login Bridge Remains Active/);
  assert.match(microsoftAccessUi, /Disable Temporary Gmail Bridge/);
});
