import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [api, page, estimating, recovery] = await Promise.all([
  readFile(new URL("../app/api/owner-delete/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deletion-recovery-center.tsx", import.meta.url), "utf8"),
]);

test("controlled deletion is authenticated owner-only and requires the exact visible name", () => {
  assert.match(api, /actor\.accessLevel !== "Company Owner"/);
  assert.match(api, /payload\.confirmation\?\.trim\(\) !== preview\.targetName/);
  assert.match(api, /Company Owner access is required for controlled deletion/);
  assert.match(api, /enforceOnboardingAccess/);
});

test("initial deletion creates and verifies an immutable recovery manifest without deleting files", () => {
  assert.match(api, /deletion-quarantine\/\$\{requestId\}\/manifest\.json/);
  assert.match(api, /sha256\(manifestText\)/);
  assert.match(api, /MANIFEST_VERIFICATION_FAILED/);
  assert.match(api, /'Quarantined', 'Snapshot Verified'/);
  const initialDelete = api.slice(api.indexOf("export async function DELETE"), api.indexOf("export async function POST"));
  assert.doesNotMatch(initialDelete, /BUCKET\.delete/);
  assert.match(initialDelete, /status = 'Deletion Quarantine'/);
  assert.match(initialDelete, /status = 'Quarantined'/);
});

test("project manifest captures direct, dependent, linked, accounting, meeting, and file scopes", () => {
  for (const relation of ["meeting_attendees", "meeting_agenda_items", "meeting_decisions", "meeting_attachments", "meeting_audits", "meeting_sync_events", "command_work_items", "accounting_journal_lines", "accounting_journal_entries", "accounting_events", "vendor_submissions", "project_files"]) {
    assert.match(api, new RegExp(relation));
  }
  assert.match(api, /linkedGlobalRows/);
  assert.match(api, /salesLinks/);
  assert.match(api, /unlinkAwardedProject/);
  assert.match(api, /SELECT name FROM sqlite_master/);
  assert.doesNotMatch(api, /PRAGMA table_info/);
});

test("restore and purge are leased, resumable, reconciled, and destroy the recovery manifest", () => {
  assert.match(api, /claimDeletionOperation/);
  assert.match(api, /DELETION_OPERATION_CONFLICT/);
  assert.match(api, /OPERATION_LEASE_MINUTES/);
  assert.match(api, /recovery cooling period remains active until/);
  assert.match(api, /Storage Purge Pending/);
  assert.match(api, /STORAGE_RECONCILIATION_FAILED/);
  assert.match(api, /Recovery Manifest Destroyed/);
  assert.match(api, /MANIFEST_DISPOSAL_FAILED/);
  assert.match(api, /owner_deletion_receipts/);
  assert.match(api, /runBatches/);
});

test("final purge requires a second exact phrase and blocks scope drift", () => {
  assert.match(api, /FINAL_PURGE_PREFIX = "PERMANENTLY DELETE "/);
  assert.match(api, /payload\.confirmation !== required/);
  assert.match(api, /deletionScopeIdentity\(current\) !== deletionScopeIdentity\(manifest\)/);
  assert.match(api, /QUARANTINE_SCOPE_DRIFT/);
  assert.match(recovery, /purgeConfirmations/);
  assert.match(recovery, /request\.purgeConfirmation/);
});

test("project and estimate screens explain quarantine while the recovery center exposes restore and final purge", () => {
  assert.match(page, /30-Day Recovery Protection/);
  assert.match(page, /Move Project To Quarantine/);
  assert.match(estimating, /30-Day Recovery Protection/);
  assert.match(estimating, /Move Estimate To Quarantine/);
  assert.match(recovery, /Deletion Recovery Center/);
  assert.match(recovery, />Restore</);
  assert.match(recovery, /Permanently Purge/);
});

test("both destructive controls require an impact preview and an exact-name confirmation", () => {
  assert.match(api, /export async function GET/);
  assert.match(page, /resetPreview\.records\.toLocaleString\(\)/);
  assert.match(page, /disabled=\{resetSaving \|\| !resetPreview/);
  assert.match(estimating, /estimateDeletePreview\.records\.toLocaleString\(\)/);
  assert.match(estimating, /disabled=\{estimateDeleteSaving \|\| !estimateDeletePreview/);
});
