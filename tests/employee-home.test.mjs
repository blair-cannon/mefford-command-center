import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, portal, outlook, microsoftApi, tools, timeApi, goalsApi, meetingsApi, resourcesApi, styles, employeeStyles] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-onboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-outlook-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-microsoft/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-home-tools.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-time/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-goals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-meetings/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-resources/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-workspace.css", import.meta.url), "utf8"),
]);

test("My Home is the single employee front door", () => {
  assert.match(page, /target: "My Work", label: "My Work"/);
  assert.match(page, /active === "My Work"[\s\S]*?<EmployeePortalWorkspace/);
  assert.doesNotMatch(page, /label: "My Employee Home", target: "Employee Portal"/);
  for (const feature of ["Work & Time", "Email", "Calendar", "Requests & PTO", "Benefits", "Growth & Training", "My Profile"]) assert.match(portal, new RegExp(feature));
  assert.match(portal, /<MyWorkWorkspace/);
  assert.match(portal, /<EmployeeTimeEntry/);
  assert.match(portal, /<EmployeeHomeOverview/);
  assert.match(portal, /<EmployeeOutlookCenter key="employee-mail" initialView="mail"/);
  assert.match(portal, /<EmployeeOutlookCenter key="employee-calendar" initialView="calendar"/);
  assert.match(portal, /<EmployeeGoals/);
  for (const feature of ["Enter Time", "Teams Invite", "Paylocity", "LIVE MAIL", "LIVE CALENDAR", "PRIORITY QUEUE"]) assert.match(outlook, new RegExp(feature));
});

test("My Home shows live work mail and calendar before opening the full apps", () => {
  assert.match(outlook, /Promise\.allSettled/);
  assert.match(outlook, /\/api\/employee-microsoft\?view=mail/);
  assert.match(outlook, /\/api\/employee-microsoft\?view=calendar/);
  assert.match(outlook, /\/api\/my-work/);
  assert.match(outlook, /setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(outlook, /window\.addEventListener\("focus", resume\)/);
  assert.match(outlook, /window\.setInterval\(sync, 30_000\)/);
  for (const surface of ["UNREAD INBOX", "TODAY(?:'|&apos;)S SCHEDULE", "Needs Your Attention", "Compose Email", "New Event", "Open Teams"]) assert.match(outlook, new RegExp(surface));
});

test("mail and calendar operate as full native-style Microsoft workspaces", () => {
  for (const feature of ["New Message", "Search this folder", "MessageReadingPane", "Reply All", "Forward", "Attachments", "Open Original In Outlook", "Month", "Agenda", "CalendarInspector", "Join Teams", "New Event", "Edit Event"]) assert.match(outlook, new RegExp(feature));
  for (const action of ["reply_message", "forward_message", "delete_message", "set_flag", "update_event", "validAttachments"]) assert.match(microsoftApi, new RegExp(action));
  assert.match(microsoftApi, /view === "message"/);
  assert.match(microsoftApi, /eight megabytes/i);
});

test("employee time is durable self-service that feeds accounting without running payroll", () => {
  for (const value of ["Employee Draft", "Employee Submitted", "Payroll Report", "MEFFORD-ACCOUNTING", "Paylocity", "recordAudits"]) assert.match(timeApi, new RegExp(value));
  assert.match(timeApi, /employeeTimeId\(access\.actor\.email/);
  assert.match(timeApi, /payrollProcessingDisabled: true/);
  assert.match(timeApi, /paymentExecutionDisabled: true/);
  assert.match(timeApi, /taxFilingDisabled: true/);
  assert.match(timeApi, /Total Time Cannot Exceed 24 Hours/);
  assert.match(tools, /Submit To Accounting/);
  assert.match(tools, /Save Draft/);
});

test("employees see only their own limited performance summary", () => {
  assert.match(goalsApi, /\.email \|\| ""\)\.toLowerCase\(\) === actor\.email\.toLowerCase\(\)/);
  assert.match(goalsApi, /Only your own operational summary/);
  assert.doesNotMatch(goalsApi, /aiAnalysis:/);
  assert.doesNotMatch(goalsApi, /adjustmentReason:/);
  assert.match(tools, /Owner review notes remain private/);
});

test("Teams invite creation is honest and connection gated", () => {
  assert.match(meetingsApi, /microsoftMeetingConnection/);
  assert.match(meetingsApi, /if \(!connection\.configured\)/);
  assert.match(meetingsApi, /createMicrosoftMeeting/);
  assert.match(meetingsApi, /status: "Sent"/);
  assert.match(meetingsApi, /recordAudits/);
  assert.match(tools, /disabled=\{saving \|\| !connection\?\.configured/);
  assert.match(resourcesApi, /https:\/\/teams\.microsoft\.com\//);
});

test("the consolidated employee home is responsive", () => {
  assert.match(styles, /@import "\.\/employee-workspace\.css"/);
  assert.match(employeeStyles, /\.employee-live-grid/);
  assert.match(employeeStyles, /\.native-mail-shell/);
  assert.match(employeeStyles, /\.native-month-grid/);
  assert.match(employeeStyles, /\.my-work-workspace \.my-work-hero/);
  assert.match(styles, /\.employee-time-sheet\{overflow-x:auto/);
  assert.match(employeeStyles, /@media \(max-width: 720px\)[\s\S]*\.native-mail-shell/);
});
