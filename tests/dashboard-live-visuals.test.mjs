import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, liveRoute, liveModel, migration, photoRoute] = await Promise.all([
  readFile(new URL("../app/api/dashboard-display/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dashboard-display-live/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/dashboard-live.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0029_elite_vivisector.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dashboard-display-photo/route.ts", import.meta.url), "utf8"),
]);

test("all seven read-only boards publish visual stories and decision prompts", () => {
  for (const id of ["operating-truths", "customer-reviews", "company-health", "project-health", "sales", "estimating", "marketing"]) {
    assert.match(dashboard, new RegExp(`id: "${id}"`));
  }
  for (const kind of ["donut", "bars", "funnel", "heatmap", "line", "timeline"]) {
    assert.match(dashboard, new RegExp(`"${kind}"`));
  }
  assert.match(dashboard, /visuals:/);
  assert.match(dashboard, /story:/);
  assert.match(dashboard, /question:/);
  assert.match(dashboard, /sceneSeconds: 18/);
  assert.match(dashboard, /photos\.slice/);
});

test("dashboard data exposes revisioned event-stream updates with a short fallback", () => {
  assert.match(dashboard, /dashboardRevision\(\)/);
  assert.match(dashboard, /refreshSeconds: 15/);
  assert.match(dashboard, /transport: "event-stream"/);
  assert.match(dashboard, /targetLatencySeconds: 1/);
  assert.match(dashboard, /fallbackSeconds: 15/);
  assert.match(dashboard, /X-Dashboard-Revision/);
  assert.match(liveRoute, /validateDashboardSession/);
  assert.match(liveRoute, /text\/event-stream/);
  assert.match(liveRoute, /event\(next\.changed \? "dashboard" : "heartbeat"/);
  assert.match(liveModel, /intervalMs \|\| 1_000/);
});

test("project, record, and file mutations advance the dashboard revision", () => {
  assert.match(migration, /CREATE TABLE `dashboard_change_revisions`/);
  for (const table of ["projects", "command_records", "project_files"]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      assert.match(migration, new RegExp(`AFTER ${operation} ON \`${table}\``));
    }
  }
  assert.equal((migration.match(/SET `revision` = `revision` \+ 1/g) || []).length, 9);
});

test("field imagery is available while customer photos remain consent-gated", () => {
  assert.match(photoRoute, /file\.category === "Customer Survey Photo"/);
  assert.match(photoRoute, /displayConsent === true \|\| data\.marketingConsent === true/);
  assert.match(photoRoute, /file\.category === "Photos"/);
  assert.match(photoRoute, /Deletion Quarantine/);
  assert.match(photoRoute, /This Image Is Not Approved For Dashboard Display/);
});
