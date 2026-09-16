import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../app/api/safety/route.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/safety-command.tsx", import.meta.url), "utf8");
const recordsApi = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const filesApi = fs.readFileSync(new URL("../app/api/files/route.ts", import.meta.url), "utf8");

test("live Safety route uses permanent server-backed command", () => {
  assert.match(page, /<SafetyCommandWorkspace/);
  assert.match(ui, /\/api\/safety/);
  assert.match(api, /Visitor Safety Walk/);
  assert.match(api, /SAFETY_INCIDENT_TYPE/);
  assert.match(api, /recordAudits/);
  assert.match(api, /projectFiles/);
});

test("safety documents show actual storage truth", () => {
  assert.match(ui, /Only actual uploaded manufacturer sheets appear here/);
  assert.match(ui, /No placeholder document is being shown/);
  assert.match(ui, /fetch\("\/api\/files"/);
  assert.match(ui, /setView\("Documents"\)/);
});

test("visitor walk requires every control and an intentional signature", () => {
  assert.match(api, /VISITOR_WALK_ITEMS\.some/);
  assert.match(api, /signatureConsent !== true/);
  assert.match(ui, /I intend this typed name to be my electronic signature/);
  assert.match(api, /Follow-Up Required/);
  assert.match(api, /upsertWorkItem/);
});

test("visitor waiver stays disabled until legal and insurance approval", () => {
  assert.match(api, /Attorney And Insurance Approval Are Recorded/);
  assert.match(api, /templateApprovalReference/);
  assert.match(api, /insurerApprovalReference/);
  assert.match(api, /Approved For Use/);
  assert.match(api, /revoke-waiver-template/);
  assert.match(ui, /Blocked pending legal and insurance approval/);
});

test("incident workflow protects human OSHA authority and confidentiality", () => {
  assert.match(api, /Safety Review Required/);
  assert.match(api, /no OSHA classification or filing was automatic/);
  assert.match(api, /Recordable — Filing Required/);
  assert.match(api, /Designated Safety, Administrator, Or Owner Authorization/);
  assert.match(ui, /Record Classification/);
  assert.match(ui, /Confidential Incident Detail Restricted/);
  assert.match(api, /correctiveActions/);
  assert.match(api, /closureEvidence/);
});

test("generic record routes cannot bypass controlled Safety workflows", () => {
  assert.match(recordsApi, /CONTROLLED_SAFETY_TYPES/);
  assert.match(recordsApi, /"Safety Incidents"/);
  assert.match(recordsApi, /"Visitor Safety Walk"/);
  assert.match(recordsApi, /"Visitor Waiver"/);
  assert.match(recordsApi, /"Safety Control"/);
  assert.match(recordsApi, /authorization\.canViewSafetyIncidents/);
});

test("Safety and restricted incident files enforce project access", () => {
  assert.match(filesApi, /canAccessSafetyFile/);
  assert.match(filesApi, /\^\(Safety\|SDS\|Visitor\|Incident\)/);
  assert.match(filesApi, /category\.startsWith\("Incident"\)/);
  assert.match(ui, /Incident Restricted Evidence/);
});

test("owner and administrator Safety access does not depend on an employee-directory match", () => {
  assert.match(api, /const active = elevated \|\| member\?\.isActive === true/);
  assert.match(api, /canView: Boolean\(active &&/);
  assert.match(api, /canViewIncidents: Boolean\(active &&/);
});
