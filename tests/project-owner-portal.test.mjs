import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [award, internalApi, externalApi, externalFiles, workspace, portal, schema, deletion, migration] = await Promise.all([
  read("../app/api/estimates/award/route.ts"),
  read("../app/api/contracts/route.ts"),
  read("../app/api/project-owner/route.ts"),
  read("../app/api/project-owner/files/route.ts"),
  read("../app/owner-contracts.tsx"),
  read("../app/project-owner-portal.tsx"),
  read("../lib/owner-portal.ts"),
  read("../app/api/owner-delete/route.ts"),
  read("../drizzle/0015_hot_phalanx.sql"),
]);

test("project award prepares dormant owner access without creating a login or invite", () => {
  assert.match(award, /dormantOwnerAccessStatement/);
  assert.match(award, /VALUES \(\?, \?, 'Dormant'/);
  assert.match(award, /No Project Owner access or invitation was activated/);
  assert.doesNotMatch(award, /INSERT INTO owner_portal_invites/);
});

test("Company Owner controls owner-review release and final freeze", () => {
  assert.match(internalApi, /Company Owner Approval Is Required Before Customer Review/);
  assert.match(internalApi, /approve-owner-review/);
  assert.match(internalApi, /approved_revision_id/);
  assert.match(internalApi, /approve-final/);
  assert.match(internalApi, /Final Contract Approved And Frozen/);
  assert.match(internalApi, /frozenRevisionHash/);
  assert.match(workspace, /Approve For Project Owner Review/);
  assert.match(workspace, /Approve Final Contract/);
});

test("secure owner invitations are hashed expiring revocable and code verified", () => {
  assert.match(schema, /code_hash/);
  assert.match(schema, /session_hash/);
  assert.match(schema, /session_expires_at/);
  assert.match(internalApi, /hashOwnerSecret\(code\)/);
  assert.match(internalApi, /revoke-owner-access/);
  assert.doesNotMatch(externalApi, /oai-authenticated-user-email|getCommandActor/);
  assert.match(externalApi, /Invite Locked After Five Attempts/);
  assert.match(externalApi, /Project Owner Session Is Missing Or Expired/);
});

test("owner edits are requests against immutable revisions and never direct source edits", () => {
  assert.match(externalApi, /owner_contract_change_requests/);
  assert.match(externalApi, /request-change/);
  assert.match(externalApi, /Changes Requested/);
  assert.doesNotMatch(externalApi, /UPDATE owner_contract_revisions SET fields_json/);
  assert.match(internalApi, /respond-change-request/);
  assert.match(internalApi, /INSERT INTO owner_contract_revisions/);
  assert.match(workspace, /Project Owner Change Requests/);
  assert.match(portal, /Request only—Mefford’s source contract is never overwritten/);
});

test("signatures require the Project Owner first and Mefford second", () => {
  assert.match(externalApi, /Project Owner Signature Recorded/);
  assert.match(externalApi, /Frozen Contract Revision Could Not Be Verified/);
  assert.match(internalApi, /The Project Owner Must Sign The Frozen Revision Before Mefford Countersigns/);
  assert.match(internalApi, /The Project Owner Must Sign Through Their Dedicated Owner Portal/);
  assert.match(internalApi, /Contract Executed/);
  assert.doesNotMatch(workspace, /Sign As Owner/);
  assert.match(workspace, /Available In The Project Owner Portal/);
});

test("external payload is project-scoped and explicitly strips internal business records", () => {
  assert.match(externalApi, /privacyBoundary/);
  for (const hidden of ["Internal Estimates", "Margin And Fee Detail", "Bid Comparisons", "Internal Budgets", "Accounting Journals", "Employee Information", "Internal Notes", "Restricted Safety Records"]) assert.match(externalApi, new RegExp(hidden));
  assert.match(externalApi, /OWNER_VISIBLE_RECORD_TYPES|record_type IN \('Change Orders'/);
  assert.match(externalFiles, /project_id = \?/);
  assert.match(externalFiles, /\(owner\|client\)/i);
  assert.match(externalFiles, /Safety\|SDS\|Visitor\|Incident/);
});

test("owner portal presents independent contract billing schedule selection document and closeout workspaces", () => {
  for (const view of ["Contract", "Change Orders", "Billing", "Schedule", "Selections", "Documents", "Closeout", "Messages"]) assert.match(portal, new RegExp(`\\"${view}\\"|>${view}<`));
  assert.match(portal, /Compare Against/);
  assert.match(portal, /Change Requests/);
  assert.match(portal, /SignaturePad/);
  assert.match(portal, /only the project documents Mefford has explicitly released/);
});

test("owner portal persistence is migrated and owner deletion removes every related row", () => {
  for (const table of ["owner_portal_access", "owner_portal_invites", "owner_contract_revisions", "owner_contract_change_requests", "owner_portal_audits"]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
    assert.match(deletion, new RegExp(`"${table}"`));
  }
});
