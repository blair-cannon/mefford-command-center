import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const teamWorkspace = fs.readFileSync(new URL("../app/team-access-workspace.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/team-access/route.ts", import.meta.url), "utf8");
const session = fs.readFileSync(new URL("../app/api/session/route.ts", import.meta.url), "utf8");

test("Team And Access is backed by permanent server workflows", () => {
  for (const action of [
    "save-designations",
    "request-designations",
    "decide-request",
    "owner-override",
    "invite-subcontractor",
    "revoke-invite",
  ]) assert.match(route, new RegExp(action));
  assert.match(route, /commandRecords/);
  assert.match(route, /recordAudits/);
  assert.match(route, /vendorProjectAccess/);
  assert.match(route, /vendorInvites/);
  assert.match(route, /upsertWorkItem/);
});

test("project designations are enforced through the signed-in session", () => {
  assert.match(session, /PROJECT_TEAM_ASSIGNMENT_TYPE/);
  assert.match(session, /projectTeamAssignmentId\(actor\.email\)/);
  assert.ok(/const loadSession = \(\) => readWorkspaceJson/.test(page), "Session reads must use validated response handling");
  assert.ok(/`\/api\/session\$\{projectProfile\.number/.test(page), "Session reads must retain the selected project's designation scope");
  assert.match(page, /TeamAccessWorkspace/);
  assert.match(teamWorkspace, /\/api\/team-access/);
});

test("one-time vendor access is revocable and never stores its plain code", () => {
  assert.match(route, /hashSecret\(code\)/);
  assert.match(route, /revokedAt: now/);
  assert.doesNotMatch(route, /codeHash:\s*code[,}]/);
});
