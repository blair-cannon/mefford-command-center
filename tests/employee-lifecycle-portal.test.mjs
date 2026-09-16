import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [schema, migration, onboardingApi, lifecycleApi, microsoftApi, graph, portal, outlook, lifecycleUi, resources, styles] = await Promise.all([
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0014_colossal_unicorn.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-lifecycle/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-microsoft/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-graph.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-onboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-outlook-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-lifecycle-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-resources/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/employee-workspace.css", import.meta.url), "utf8"),
]);

test("employee lifecycle portal is login-issued first and permission activation second", () => {
  assert.match(onboardingApi, /isActive: false/);
  assert.match(onboardingApi, /identityProvider: "not_issued"/);
  assert.match(onboardingApi, /action === "issue_login"/);
  assert.match(onboardingApi, /identityProvider: "microsoft_entra_issued"/);
  assert.match(onboardingApi, /Record The Company Login As Issued Before Full Command Center Access/);
  assert.match(portal, /Record Company Login Issued/);
  assert.match(portal, /Home.*Work & Time.*Email.*Calendar.*Requests & PTO.*Benefits.*Growth & Training.*My Profile/s);
});

test("employee requests leave profiles balances and feedback are normalized permanent records", () => {
  for (const table of ["employeeServiceRequests", "employeeLeaveRequests", "employeeLeaveBalances", "employeeProfiles", "employeeFeedback"]) assert.match(schema, new RegExp(`export const ${table}`));
  for (const table of ["employee_service_requests", "employee_leave_requests", "employee_leave_balances", "employee_profiles", "employee_feedback"]) assert.match(migration, new RegExp(`CREATE TABLE .${table}`));
  assert.match(lifecycleUi, /Address Line 2 <small>Optional/);
  assert.match(lifecycleUi, /Administration has not entered or connected an official balance\. Nothing is guessed/);
});

test("employee request routing follows live roles and access changes require two people", () => {
  for (const route of ["IT Administrator", "Human Resources", "Marketing / Administrator", "Company Owner / Administrator", "Accountant"]) assert.match(lifecycleApi, new RegExp(route));
  assert.match(lifecycleApi, /"Access \/ Permission": \{ primary: "Company Owner", secondary: "Administrator"/);
  assert.match(lifecycleApi, /if \(item\.primaryApprovedByEmail === actor\.email\)/);
  assert.match(lifecycleApi, /Access And Permission Requests Require Two Different Approvers/);
  assert.match(lifecycleApi, /companyMembers\.isActive, true/);
  assert.doesNotMatch(lifecycleApi, /Blain Faulkner|Jordan Mefford|Evan Mefford/);
});

test("Outlook mail calendar folders spam and Teams are live but connection honest", () => {
  for (const method of ["listEmployeeMailFolders", "listEmployeeMessages", "getEmployeeMessage", "createEmployeeMailFolder", "moveEmployeeMessage", "sendEmployeeMail", "replyEmployeeMessage", "forwardEmployeeMessage", "deleteEmployeeMessage", "listEmployeeCalendar", "createEmployeeCalendarEvent", "updateEmployeeCalendarEvent"]) assert.match(graph, new RegExp(`function ${method}`));
  for (const action of ["create_folder", "set_read", "set_flag", "move_message", "delete_message", "send_mail", "reply_message", "forward_message", "create_event", "update_event", "delete_event"]) assert.match(microsoftApi, new RegExp(action));
  assert.match(microsoftApi, /Mail\.ReadWrite, Mail\.Send, and Calendars\.ReadWrite/);
  assert.match(portal, /<EmployeeOutlookCenter/);
  assert.match(outlook, /Your Native \{view === "mail" \? "Mailbox" : "Calendar"\} Will Appear Here/);
  assert.match(styles, /\.native-mail-shell/);
  assert.match(styles, /\.native-calendar-shell/);
});

test("employee benefits keep provider self-service and add retirement plus internal requests", () => {
  for (const provider of ["Paylocity", "UnitedHealthcare", "Northwestern Mutual", "Edward Jones"]) assert.match(resources, new RegExp(provider));
  assert.match(portal, /EmployeeRequestsAndLeave initialCategory="Benefits Question"/);
  assert.match(lifecycleApi, /"Benefits Question": \{ primary: "Human Resources", confidential: true \}/);
});
