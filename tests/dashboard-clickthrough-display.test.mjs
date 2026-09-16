import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("systemwide summaries use one accessible drilldown host", () => {
  const page = read("app/page.tsx");
  const drilldown = read("app/summary-drilldown.tsx");
  const files = [
    "app/page.tsx",
    "app/sales-estimating.tsx",
    "app/project-health.tsx",
    "app/accounting-control.tsx",
    "app/accounting-advanced.tsx",
    "app/financial-reports.tsx",
    "app/microsoft-access-center.tsx",
    "app/employee-onboarding.tsx",
    "app/marketing-workspace.tsx",
    "app/asset-tracking-workspace.tsx",
  ];
  const triggerCount = files.reduce((total, file) => total + (read(file).match(/summaryDrilldownProps\(/g)?.length || 0), 0);
  assert.ok(triggerCount >= 80, `expected broad click-through coverage, found ${triggerCount} triggers`);
  assert.match(page, /<SummaryDrilldownHost\s*\/>/);
  assert.match(drilldown, /role:\s*"button"/);
  assert.match(drilldown, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(drilldown, /role="dialog"/);
  assert.match(drilldown, /report\.rows\.length/);
});

test("repetitive workspace narrative is removed from the application shell", () => {
  const page = read("app/page.tsx");
  assert.doesNotMatch(page, /sectionExperience/);
  assert.doesNotMatch(page, /experience-guide/);
  assert.doesNotMatch(page, />COMPANY WORKSPACE</);
  assert.doesNotMatch(page, />PROJECT WORKSPACE</);
});

test("display account is fixed, owner-controlled, read-only, and Workers-safe", () => {
  const auth = read("lib/dashboard-display-auth.ts");
  const authRoute = read("app/api/dashboard-display-auth/route.ts");
  const dataRoute = read("app/api/dashboard-display/route.ts");
  const ownerControl = read("app/dashboard-display-access-control.tsx");

  assert.match(auth, /const DISPLAY_EMAIL = "dashboards@meffcon\.com"/);
  assert.match(auth, /const PBKDF2_ITERATIONS = 100_000/);
  assert.doesNotMatch(auth, /310_?000/);
  assert.match(auth, /dashboard_display_credentials/);
  assert.match(auth, /dashboard_display_sessions/);
  assert.match(auth, /HttpOnly; SameSite=Lax/);
  assert.match(auth, /constantTimeEqual/);
  assert.match(auth, /MAX_LOGIN_FAILURES = 10/);
  assert.match(auth, /dashboard_display_login_failures/);
  assert.match(authRoute, /status: 429/);
  assert.match(auth, /DELETE FROM dashboard_display_sessions WHERE email = \?/);
  assert.match(authRoute, /actor\.accessLevel !== "Company Owner"/);
  assert.match(authRoute, /input\.action === "set-password"/);
  assert.match(ownerControl, /prior display sessions were logged out/i);
  assert.match(dataRoute, /validateDashboardSession/);
  assert.doesNotMatch(dataRoute, /export async function POST/);
  assert.match(dataRoute, /readOnly:\s*true/);
});

test("display feed contains Operating Truths plus the existing selectable dashboards", () => {
  const dataRoute = read("app/api/dashboard-display/route.ts");
  const display = read("app/dashboard-display/dashboard-display.tsx");
  assert.match(dataRoute, /id: "operating-truths"/);
  for (const id of ["sales", "project-health", "marketing", "estimating", "company-health"]) {
    assert.match(dataRoute, new RegExp(`id: "${id}"`));
    assert.match(display, new RegExp(`"${id}"`));
  }
  assert.match(dataRoute, /id: "customer-reviews"/);
  assert.match(display, /"customer-reviews"/);
  assert.match(display, /displaySeconds/);
  assert.match(dataRoute, /displaySeconds: rating >= 4 \? 30 : 5/);
  assert.match(display, /setInterval\(\(\) => void load\(\), 60_000\)/);
  assert.match(display, /Log Out/);
  assert.match(display, /metric\.rows/);
});
