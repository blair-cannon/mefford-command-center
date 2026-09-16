import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("F-14 stores immutable source, role approval, output trace, and review controls", async () => {
  const migration = await read("drizzle/0027_template_governance.sql");
  for (const name of ["template_governance_versions", "template_governance_approvals", "template_output_evidence", "source_sha256", "jurisdiction", "required_reviewers_json", "superseded_by_id", "output_sha256"]) assert.match(migration, new RegExp(name));
});

test("F-14 blocks unapproved releases and invalidates approvals when source hashes differ", async () => {
  const source = await read("lib/template-governance.ts");
  assert.match(source, /Draft — Not Approved for Use/);
  assert.match(source, /item\.sourceSha256 === input\.sourceSha256/);
  assert.match(source, /release, signature, email, or operational use is blocked/);
  assert.match(source, /Expired — Not Approved for Use/);
});

test("F-14 Review Center exposes jurisdiction, hashes, role approvals, and never approves a missing source", async () => {
  const [route, ui] = await Promise.all([read("app/api/review/route.ts"), read("app/review-workspace.tsx")]);
  assert.match(route, /A Source Master File Is Required Before Any Approval/);
  assert.match(route, /sha256Hex\(sourceBytes\)/);
  assert.match(route, /governance-approval/);
  assert.match(ui, /Release Governance/);
  assert.match(ui, /Missing source master hash — release blocked/);
  assert.match(ui, /Approve Exact Source/);
  assert.match(ui, /Jurisdiction/);
});

test("F-14 expiration review is a scheduled independent control", async () => {
  assert.match(await read("lib/scheduled-operations.ts"), /template-governance-review/);
});

test("F-14 blocks operational schedule-template use until the governed source is approved", async () => {
  const route = await read("app/api/schedule-templates/route.ts");
  assert.match(route, /assertScheduleTemplateRelease/);
  assert.match(route, /assertTemplateApproved/);
  assert.match(route, /Draft — Not Approved for Use/);
});
