import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [storage, route, control, projects, records, onboarding, files, multipart, award, graph, meetings, employeeMeetings, employeeMicrosoft, scheduler, operations] = await Promise.all([
  readFile(new URL("../lib/sharepoint-storage.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/sharepoint-storage/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/microsoft-files-control.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/projects/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/files/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/files/multipart/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/estimates/award/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/microsoft-graph.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/meetings/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-meetings/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/employee-microsoft/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/scheduled-operations.ts", import.meta.url), "utf8"),
]);

test("estimate project employee and company template blueprints are explicit", () => {
  for (const pattern of [/\bEstimate:/, /\bProject:/, /\bEmployee:/, /"Company Templates":/]) assert.match(storage, pattern);
  for (const folder of [
    "01_Client_And_Opportunity",
    "07_Award_And_Project_Handoff",
    "01_Owner_Contract_And_Insurance",
    "13_Closeout_Warranties_And_OM",
    "01_Onboarding_And_Acknowledgements",
    "02_Employment_And_HR",
    "03_Benefits_And_Enrollment",
    "04_Payroll_Tax_And_Compensation",
    "01_Owner_Contracts_And_Exhibits",
  ]) assert.match(storage, new RegExp(folder));
});

test("SharePoint activation is fail-safe and never deletes or replaces Command Center sources", () => {
  assert.match(storage, /no_delete_guard/);
  assert.match(storage, /no_source_delete/);
  assert.match(storage, /No Automatic Delete/);
  assert.match(storage, /No Silent Overwrite/);
  assert.match(storage, /MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED/);
  assert.match(storage, /permissionPolicyVerified/);
  assert.match(storage, /conflictBehavior.*fail/);
  assert.match(storage, /Local Primary Preserved/);
  assert.doesNotMatch(storage, /BUCKET\.delete/);
  assert.doesNotMatch(storage, /method:\s*["']DELETE["']/);
  assert.match(control, /NO-DELETE GUARD ON/);
  assert.match(control, /Copy Pending Files · Retain Sources/);
});

test("every root creation workflow registers a durable Microsoft file workspace", () => {
  assert.match(projects, /entityType:\s*"Project"/);
  assert.match(records, /entityType:\s*"Estimate"/);
  assert.match(onboarding, /entityType:\s*"Employee"/);
  assert.match(award, /microsoftEstimateWorkspace/);
  assert.match(award, /microsoftProjectWorkspace/);
  assert.match(route, /register-existing/);
  assert.match(route, /Company Templates/);
});

test("standard and multipart uploads register copy destinations while retaining R2", () => {
  assert.match(files, /queueProjectFileForSharePoint/);
  assert.match(multipart, /queueProjectFileForSharePoint/);
  assert.match(storage, /copyR2ObjectToSharePoint/);
  assert.match(graph, /microsoftGraphUploadContent/);
  assert.match(storage, /createUploadSession/);
  assert.match(storage, /Content-Range/);
  assert.match(storage, /registerUnmappedSharePointFiles/);
  assert.match(storage, /runSharePointStorageAutomation/);
  assert.match(scheduler, /runSharePointStorageAutomation/);
  assert.match(operations, /sharepoint-file-reconciliation/);
});

test("mail calendar and Teams use owner-approved individual Microsoft identities", () => {
  assert.match(employeeMeetings, /authorizedMicrosoftIdentityForActor/);
  assert.match(employeeMeetings, /organizerEmail:\s*identity\.microsoftEmail/);
  assert.match(meetings, /microsoftIdentity\?\.microsoftEmail/);
  assert.doesNotMatch(meetings, /String\(payload\.organizerEmail/);
  assert.match(employeeMicrosoft, /attendees/);
  assert.match(employeeMicrosoft, /Sent Outlook Calendar Invitation/);
  assert.match(graph, /fallback-only/);
});
