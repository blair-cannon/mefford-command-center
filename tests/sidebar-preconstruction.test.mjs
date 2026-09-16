import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const navigation = fs.readFileSync(new URL("../app/workspace-navigation.tsx", import.meta.url), "utf8");
const marketing = fs.readFileSync(new URL("../app/marketing-workspace.tsx", import.meta.url), "utf8");
const recordsApi = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const marketingApi = fs.readFileSync(new URL("../app/api/marketing/route.ts", import.meta.url), "utf8");
const integrations = fs.readFileSync(new URL("../lib/integration-health.ts", import.meta.url), "utf8");
const teamAccess = fs.readFileSync(new URL("../lib/team-access.ts", import.meta.url), "utf8");

test("every role receives authorized shortcuts and the complete filtered tool catalog", () => {
  const projectFolders = page.slice(page.indexOf("const navFolders"), page.indexOf("const preconstructionNavGroups"));
  const companyFolders = page.slice(page.indexOf("const companyNavFolders"), page.indexOf("const accountingNavigationTargets"));
  const sidebar = page.match(/<WorkspaceNavigation[\s\S]*?\/>/)?.[0] || "";
  for (const prop of ["actor={sessionActor}", "active={active}", "tools={navigationTools}"]) assert.ok(sidebar.includes(prop), prop);
  assert.match(navigation, /authorizedShortcuts\(actor, tools, saved\)/);
  assert.match(navigation, /Pinned Tools/);
  assert.match(navigation, /role="dialog" aria-modal="true"/);
  assert.match(navigation, /All Tools/);
  assert.match(navigation, /aria-label="Find A Tool"/);
  assert.ok(projectFolders.indexOf('label: "Meetings"') < projectFolders.indexOf('label: "Project Management"'));
  assert.ok(projectFolders.indexOf('label: "Project Management"') < projectFolders.indexOf('label: "Site Management"'));
  assert.ok(companyFolders.indexOf('label: "Accounting"') < companyFolders.indexOf('label: "Admin"'));
  const catalog = page.slice(page.indexOf("const navigationTools"), page.indexOf("const everydayTools"));
  for (const target of ["My Work", "Dashboard", "Project Health", "Project Overview"]) assert.ok(catalog.includes(`"${target}"`));
  assert.match(catalog, /canActorAccessNavigation/);
  assert.doesNotMatch(projectFolders, /target: "(?:My Work|Dashboard|Project Health|Project Overview|Documents|Project Settings)"/);
  const bottom = page.slice(page.indexOf('<div className="sidebar-bottom">'), page.indexOf('<div className="user-card">', page.indexOf('<div className="sidebar-bottom">')));
  assert.doesNotMatch(bottom, /Project Files/);
  assert.match(bottom, /<span>User Guide<\/span>/);
  assert.doesNotMatch(bottom, /Project Settings/);
  assert.match(page, /onSettings=\{canActorAccessNavigation\(sessionActor, "Project Settings"\)/);
  assert.match(page, /visiblePreconstructionNavGroups.*canActorAccessNavigation/s);
  assert.match(page, /visibleCompanyNavFolders.*canActorAccessNavigation/s);
  assert.match(page, /visibleProjectNavFolders.*canActorAccessNavigation/s);
});

test("All Tools preserves Sales Estimating and Marketing groups and destinations", () => {
  const source = page.slice(page.indexOf("const preconstructionNavGroups"), page.indexOf("const companyNavFolders"));
  for (const group of ["Sales", "Estimating", "Marketing"]) assert.match(source, new RegExp(`label: "${group}"`));
  for (const target of ["Sales Dashboard", "Sales Contacts", "Sales Funnel", "Sales Design", "Estimating", "Estimating Calendar", "Bid Management", "Marketing Social", "Marketing Email", "Marketing Surveys", "Marketing Calendar"]) {
    assert.match(source, new RegExp(`target: "${target}"`));
  }
  assert.match(page, /visiblePreconstructionNavGroups\.flatMap/);
  assert.match(navigation, /filtered\.filter\(\(tool\) => tool\.group === group\)/);
});

test("Marketing is a live permanent workspace rather than a placeholder", () => {
  assert.match(page, /<MarketingWorkspace[\s\S]*actor=\{sessionActor\}/);
  assert.match(marketing, /CAMPAIGN_TYPE = "Marketing Campaigns"/);
  assert.match(marketing, /Social Campaigns/);
  assert.match(marketing, /Email Campaigns/);
  assert.match(marketing, /Customer Surveys/);
  assert.match(marketing, /MarketingCalendar/);
  assert.match(marketing, /Newsletter Studio/);
  assert.match(marketing, /Upload Picture/);
  assert.match(marketing, /Save Permanent Campaign/);
  assert.match(marketing, /Direct publishing is connection-gated/);
  assert.match(marketing, /Lead Progress/);
  assert.match(marketing, /Social Publishing Queue/);
  assert.match(marketing, /External Newsletter Audience/);
  assert.match(marketing, /Email Release Queue/);
  assert.match(marketingApi, /dispatchSocialPost/);
  assert.match(marketingApi, /dispatchNewsletter/);
  assert.match(marketingApi, /syncMarketingAnalytics/);
  assert.match(marketingApi, /Marketing Content Asset/);
  assert.match(marketingApi, /Consent, unsubscribe, and suppression checks remain mandatory/);
  for (const connection of ["linkedin-company", "facebook-company", "google-analytics", "marketing-email"]) assert.match(integrations, new RegExp(connection));
  assert.match(recordsApi, /designations\.includes\("Marketing"\)/);
  assert.match(teamAccess, /"Marketing"/);
});
