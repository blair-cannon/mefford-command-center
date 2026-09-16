import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Company status boxes lead the Company Dashboard without a duplicate page banner", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dashboardStart = source.indexOf("function CompanyDashboard(");
  const dashboardEnd = source.indexOf("function ", dashboardStart + 1);
  const dashboard = source.slice(dashboardStart, dashboardEnd);

  const statusBoxes = dashboard.indexOf("<RoleOperatingSystem");
  const today = dashboard.indexOf('className="dashboard-command-section dashboard-today-command"');
  const dailyLogs = dashboard.indexOf('className="dashboard-command-section dashboard-field-command"');
  const actions = dashboard.indexOf('className="executive-decision-panel dashboard-action-queue"');

  assert.ok(statusBoxes >= 0, "Company status boxes should lead the Company Dashboard");
  assert.ok(today > statusBoxes, "Today's cross-project schedule should follow the company status boxes");
  assert.ok(actions > today, "The Action Queue should follow today's schedule");
  assert.ok(dailyLogs > actions, "Yesterday's Daily Logs should follow the Action Queue");
  assert.doesNotMatch(dashboard, /executive-metrics|Upcoming Milestones|executive-projects/);
  assert.doesNotMatch(dashboard, /executive-dashboard-header|<h1>Company Dashboard<\/h1>/);
  assert.equal((source.match(/<RoleOperatingSystem/g) || []).length, 1, "Company status boxes should render only inside Company Dashboard");
  assert.match(dashboard, /projects\.filter\(isContractedActiveProject\)/);
  assert.match(dashboard, /portfolioMetrics=\{\[/);
  assert.match(dashboard, /className="dashboard-stack-board"/);
  assert.doesNotMatch(dashboard, /decision\.explanation/);
  assert.doesNotMatch(dashboard, /Schedule activities whose planned dates include today/);
  assert.doesNotMatch(dashboard, /Critical and high-priority items requiring a decision/);
  assert.doesNotMatch(dashboard, /Every active job, its filed report, and selected field photos/);
  assert.doesNotMatch(dashboard, /<small>/, "Dashboard blocks should not render descriptive sublines");
  assert.doesNotMatch(dashboard, /Field Snapshot Unavailable|Open Daily Logs To Review/);
  assert.doesNotMatch(dashboard, /immediateDecisions\.slice/);
});

test("Company Dashboard uses live schedules exact Daily Log links and stored field photos", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /item\.start <= today &&\s*item\.finish >= today/);
  assert.match(source, /record\.type === "Daily Logs" && record\.recordDate === yesterday/);
  assert.match(source, /onOpenRecord\(report\.project, "Daily Logs", log\.id\)/);
  assert.match(source, /dailyLogIdForPhoto\(file\)/);
  assert.match(source, /src=\{`\/api\/files\?id=\$\{file\.id\}`\}/);
  assert.match(source, /window\.setInterval\(\(\) => void loadDashboardRecords\(\), 30_000\)/);
  assert.match(source, /setPortfolioFiles\(Object\.fromEntries\(entries\)\)/);
});

test("Company Dashboard places unlabeled status boxes in a readable top row above three scrolling columns", async () => {
  const [pageSource, roleSource, fluidStyles, globalStyles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/role-operating-system.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/desktop-fluid.css", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /className="dashboard-stack-board"/);
  assert.match(roleSource, /dashboard-portfolio-card/);
  assert.match(roleSource, /<article className="dashboard-role-card dashboard-portfolio-card" aria-label="Active Portfolio">[\s\S]*?portfolioMetrics\.map/);
  assert.equal((roleSource.match(/dashboard-role-card dashboard-portfolio-card/g) || []).length, 1, "Portfolio totals should share one card");
  assert.doesNotMatch(roleSource, /Role Status/);
  assert.doesNotMatch(roleSource, /<header><h2>/);
  assert.match(roleSource, /scorecard\.doctrine\.role === "Sales" \? 3 : 2/);
  assert.doesNotMatch(roleSource, /Company Snapshot|Company-Wide|Live ·|metric\.detail|<small>/);
  assert.doesNotMatch(roleSource, /<b>\{scorecard\.status\}<\/b>/, "Role status should be shown by the card's top edge, not a warning pill");
  assert.match(roleSource, /aria-label=\{`\$\{scorecard\.doctrine\.role\}: \$\{scorecard\.status\}`\}/);
  assert.match(fluidStyles, /\.operations-app-mode \.company-dashboard \{[\s\S]*?height:\s*calc\(100dvh[\s\S]*?overflow:\s*hidden/);
  assert.match(fluidStyles, /\.dashboard-stack-board \{[\s\S]*?grid-template-columns:\s*repeat\(3,[\s\S]*?grid-template-rows:[\s\S]*?overflow:\s*hidden/);
  assert.match(fluidStyles, /\.dashboard-role-status \{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*1/);
  assert.match(fluidStyles, /\.dashboard-role-status \{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(fluidStyles, /\.dashboard-role-grid \{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(250px,\s*1\.05fr\)[\s\S]*?minmax\(300px,\s*1\.25fr\)[\s\S]*?overflow-x:\s*auto/);
  assert.match(fluidStyles, /\.dashboard-stack-board \{[\s\S]*?grid-template-rows:\s*clamp\(220px,\s*18dvh,\s*235px\)/);
  assert.match(fluidStyles, /\.dashboard-today-command \{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2/);
  assert.match(fluidStyles, /\.dashboard-action-queue \{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2/);
  assert.match(fluidStyles, /\.dashboard-field-command \{[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*2/);
  assert.match(fluidStyles, /\.dashboard-today-list,[\s\S]*?\.executive-decision-list,[\s\S]*?\.dashboard-log-list,[\s\S]*?\.dashboard-field-photo-grid \{[\s\S]*?overflow:\s*auto/);
  assert.match(globalStyles, /\.company-dashboard \.dashboard-today-row,[\s\S]*?\.company-dashboard \.dashboard-log-row \{[\s\S]*?grid-template-columns:\s*1fr/);
  const doctrineStyles = await readFile(new URL("../app/operating-doctrine.css", import.meta.url), "utf8");
  assert.match(doctrineStyles, /\.dashboard-role-card > header strong \{[\s\S]*?font-size:\s*\.875rem[\s\S]*?white-space:\s*nowrap/);
  assert.match(doctrineStyles, /\.dashboard-role-card > div b \{[\s\S]*?white-space:\s*nowrap/);
  assert.match(doctrineStyles, /\.dashboard-role-card > div > span \{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between/);
  assert.match(doctrineStyles, /\.dashboard-portfolio-card \.dashboard-portfolio-metrics > span \{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(doctrineStyles, /\.dashboard-role-card\.critical \{ border-top-color:/);
  assert.match(globalStyles, /\.company-dashboard \.dashboard-today-row span > strong,[\s\S]*?white-space:\s*normal/);
});
