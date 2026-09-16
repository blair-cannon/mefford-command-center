import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, policy, ui, page, schema, platform] = await Promise.all([
  readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/assistant-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/command-assistant.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../docs/openai-command-center-platform.md", import.meta.url), "utf8"),
]);

test("assistant is authenticated, server-side, always visible, and honest until a real OpenAI secret exists", () => {
  assert.match(route, /if \(!actor\.authenticated\)/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(route, /configured: Boolean\(await openAiApiKey\(\)\)/);
  assert.match(ui, /if \(permissionLocked\) return null/);
  assert.match(ui, /OPENAI CONNECTION REQUIRED/);
  assert.match(ui, /Connect AI/);
  assert.match(ui, /No fake responses and no hidden fallback are used/);
  assert.match(route, /enforceOnboardingAccess/);
  assert.match(page, /<CommandAssistant/);
  assert.doesNotMatch(ui, /OPENAI_API_KEY/);
});

test("assistant has no business-record write tools or approval path", () => {
  assert.match(policy, /permanently help-only/i);
  assert.match(policy, /never create or change a business record/i);
  assert.match(policy, /confirmation in chat is never an approval/i);
  assert.match(policy, /Payroll is report-only/i);
  assert.doesNotMatch(route, /tools\s*:/);
  assert.doesNotMatch(route, /function_call|tool_choice|POST\(.*records/i);
  assert.match(ui, /No approvals or actions/);
  assert.match(platform, /Human confirmation inside chat never substitutes/);
});

test("assistant context is permission-filtered, source-linked, and audited", () => {
  assert.match(route, /buildPermissionFilteredContext/);
  assert.match(route, /canAssistantReadSection/);
  assert.match(route, /\[S\$\{index \+ 1\}\]/);
  assert.match(route, /store: false/);
  assert.match(route, /INSERT INTO assistant_audits/);
  assert.match(route, /MAX_REQUESTS_PER_MINUTE/);
  assert.match(schema, /assistant_audits_actor_created_idx/);
  assert.match(ui, /Open cited records before relying on an answer/);
});
