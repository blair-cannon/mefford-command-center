import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layoutSource, fluidStyles, ...applicationStyles] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/desktop-fluid.css", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-workspace.css", import.meta.url), "utf8"),
  readFile(new URL("../app/operating-doctrine.css", import.meta.url), "utf8"),
  readFile(new URL("../app/customer-surveys.css", import.meta.url), "utf8"),
]);

test("Main loads the desktop fluid layer after all application styles", () => {
  const globalIndex = layoutSource.indexOf('import "./globals.css"');
  const surveyIndex = layoutSource.indexOf('import "./customer-surveys.css"');
  const fluidIndex = layoutSource.indexOf('import "./desktop-fluid.css"');

  assert.ok(globalIndex >= 0);
  assert.ok(surveyIndex > globalIndex);
  assert.ok(fluidIndex > surveyIndex);
});

test("desktop information grows continuously within safe bounds", () => {
  assert.match(
    fluidStyles,
    /font-size:\s*clamp\(1rem,\s*calc\(0\.625rem \+ 0\.4167vw\),\s*1\.25rem\)/,
  );
  assert.match(fluidStyles, /@media \(min-width: 1181px\) and \(pointer: fine\)/);
  assert.match(fluidStyles, /--desktop-operations-sidebar:\s*clamp\(232px, 12\.5vw, 300px\)/);
  assert.match(fluidStyles, /--desktop-accounting-sidebar:\s*clamp\(220px, 11\.5vw, 280px\)/);
  assert.match(fluidStyles, /\.operations-app-mode \.content[\s\S]*?clamp\(1520px, 88vw, 2400px\)/);
  assert.match(fluidStyles, /\.accounting-app-mode \.content[\s\S]*?clamp\(1640px, 90vw, 2400px\)/);
});

test("fixed inner workspaces cannot cancel the fluid desktop shell", () => {
  const workspaceRule = fluidStyles.match(
    /\.operations-app-mode \.company-dashboard,[\s\S]*?\.accounting-app-mode \.accounting-control-workspace\s*\{[\s\S]*?\}/,
  )?.[0] || "";

  assert.match(workspaceRule, /\.operations-app-mode \.company-dashboard/);
  assert.match(workspaceRule, /\.operations-app-mode \.company-calendar-workspace/);
  assert.match(workspaceRule, /\.accounting-app-mode \.accounting-control-workspace/);
  assert.match(workspaceRule, /width:\s*100%/);
  assert.match(workspaceRule, /max-width:\s*none/);
  assert.match(fluidStyles, /\.company-calendar-workspace \.calendar-days article[\s\S]*?min-height:\s*clamp\(118px, 7vw, 172px\)/);
});

test("compact, touch, and print layouts preserve the baseline", () => {
  assert.match(fluidStyles, /@media \(max-width: 1180px\), \(pointer: coarse\)[\s\S]*?font-size:\s*1rem/);
  assert.match(fluidStyles, /@media print[\s\S]*?font-size:\s*1rem/);
});

test("application typography is relative instead of fixed to a monitor", () => {
  for (const source of applicationStyles) {
    assert.doesNotMatch(source, /font-size:\s*[0-9]+(?:\.[0-9]+)?px/);
  }
});
