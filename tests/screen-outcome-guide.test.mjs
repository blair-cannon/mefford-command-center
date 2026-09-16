import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("role outcomes live in the User Guide instead of workspace banners", async () => {
  const [page, roleStatus, projectHealth, guide] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/role-operating-system.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/project-health.tsx", import.meta.url), "utf8"),
    readFile(new URL("../content/user-guide.json", import.meta.url), "utf8"),
  ]);

  assert.equal((page.match(/<RoleOperatingSystem/g) || []).length, 1);
  assert.doesNotMatch(roleStatus, /THE OUTCOME THIS SCREEN MUST DRIVE|Show Role Standard|operating-mission-rail/);
  assert.doesNotMatch(projectHealth, /THIS VIEW MUST DRIVE|health-role-chain/);
  assert.doesNotMatch(roleStatus, /Role Status/);
  assert.match(guide, /Role outcomes and operating promises are maintained in this User Guide/);
});
