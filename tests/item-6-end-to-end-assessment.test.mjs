import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { WORKFLOW_AUDIT } from "../lib/system-audit.ts";
import { WORKFLOW_RELEASE_CONTROLS } from "../lib/workflow-release-controls.ts";

test("Item 6 gives every end-to-end workflow explicit release and authority evidence", async () => {
  assert.equal(WORKFLOW_RELEASE_CONTROLS.length, WORKFLOW_AUDIT.length);
  assert.deepEqual(new Set(WORKFLOW_RELEASE_CONTROLS.map((item) => item.workflowId)), new Set(WORKFLOW_AUDIT.map((item) => item.id)));
  for (const control of WORKFLOW_RELEASE_CONTROLS) {
    assert.ok(control.authorityEvidence.length >= 2, `${control.workflowId} needs at least two authority controls`);
    assert.ok(control.releaseTests.length >= 1, `${control.workflowId} needs release tests`);
    for (const path of control.releaseTests) await access(new URL(`../${path}`, import.meta.url));
  }
});

test("Item 6 never substitutes source activity for a reconciled handoff", async () => {
  const runtime = await readFile(new URL("../lib/system-health-runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /sum\(CASE WHEN c\.mandatory = 1 AND c\.status = 'Succeeded'/);
  assert.match(runtime, /e\.status = 'Completed'/);
  assert.match(runtime, /No reconciled domain event is registered/);
  assert.match(runtime, /source activity cannot substitute for a completed handoff/);
});

test("Item 6 release evidence is enforced by the fail-closed production build", async () => {
  const build = await readFile(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");
  assert.match(build, /tests\/\*\.test\.mjs/);
  assert.match(build, /set -euo pipefail/);
});
