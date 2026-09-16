import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Company Dashboard is leadership-only and project managers start in Project Workspace", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const projectManagerNavigation = source.slice(
    source.indexOf("const projectManagerNavigation"),
    source.indexOf("const superintendentNavigation"),
  );
  const officeStaffNavigation = source.slice(
    source.indexOf("const officeStaffNavigation"),
    source.indexOf("function canActorAccessNavigation"),
  );
  const landingRule = source.slice(
    source.indexOf("setActive((current) =>"),
    source.indexOf("});", source.indexOf("setActive((current) =>")) + 3,
  );

  assert.match(
    source,
    /if \(target === "Dashboard"\) \{\s*return \["Company Owner", "Administrator"\]\.includes\(actor\.accessLevel\);\s*\}/,
  );
  assert.doesNotMatch(projectManagerNavigation, /"Dashboard"/);
  assert.doesNotMatch(officeStaffNavigation, /"Dashboard"/);
  assert.match(source, /if \(target === "My Work"\) return true;/);
  assert.match(landingRule, /permissionLocked\) return "Employee Portal"/);
  assert.match(landingRule, /const preferred = preferredWorkspace\(data\.actor!\)/);
  assert.match(landingRule, /canActorAccessNavigation\(data\.actor!, preferred\) \? preferred : "Employee Portal"/);
  assert.doesNotMatch(landingRule, /Sales Dashboard|Documents/);
});
