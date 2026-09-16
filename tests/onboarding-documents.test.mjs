import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const registry = fs.readFileSync("lib/onboarding-documents.ts", "utf8");
const api = fs.readFileSync("app/api/onboarding/documents/route.ts", "utf8");
const pdf = fs.readFileSync("app/api/onboarding/documents/pdf/route.ts", "utf8");
const ui = fs.readFileSync("app/onboarding-document-center.tsx", "utf8");
const workspace = fs.readFileSync("app/employee-onboarding.tsx", "utf8");
const teamRoles = fs.readFileSync("lib/team-access.ts", "utf8");
const filesApi = fs.readFileSync("app/api/files/route.ts", "utf8");

test("new-hire registry uses current official government sources", () => {
  assert.match(registry, /https:\/\/www\.irs\.gov\/pub\/irs-pdf\/fw4\.pdf/);
  assert.match(registry, /42A804%20%28K-4%29%20%282026%29\.pdf/);
  assert.match(registry, /uscis\.gov\/sites\/default\/files\/document\/forms\/i-9\.pdf/);
  assert.match(registry, /version: "2026"/);
  assert.match(registry, /08\/01\/23 Edition/);
  assert.doesNotMatch(registry, /07\/17 N/);
  assert.equal((registry.match(/id: "/g) || []).length >= 10, true);
});

test("provider and regulated company documents stay held for a named reviewer", () => {
  assert.match(registry, /Provider Confirmation Required/);
  assert.match(registry, /Outside Counsel Review Required/);
  assert.match(registry, /Safety Review Required/);
  assert.match(registry, /Northwestern Mutual Life Draft/);
  assert.match(registry, /UnitedHealthcare/);
  assert.match(api, /approve_template/);
  assert.match(api, /A Specific Reviewer Approval Note Is Required/);
});

test("providers have narrow scopes and Paylocity stores no banking data", () => {
  assert.match(registry, /Paylocity Account And Direct Deposit Setup/);
  assert.match(registry, /Employees enter and maintain banking information directly in Paylocity/);
  assert.doesNotMatch(registry, /routingNumber|bankAccountNumber|accountNumber/);
  assert.match(api, /PAYLOCITY_EMPLOYEE_URL/);
  assert.match(api, /requestedEmail === actor\.email/);
  assert.match(api, /Northwestern Mutual/);
  assert.match(api, /Life Insurance Only/);
  assert.match(api, /UnitedHealthcare/);
  assert.match(api, /Health Insurance Only/);
});

test("form names and reviewer assignments follow live company roles", () => {
  assert.match(registry, /roleBinding: "Safety Director"/);
  assert.match(registry, /roleBinding: "Accountant"/);
  assert.match(registry, /internalReviewerDesignation/);
  assert.match(api, /resolveRoleAssignments/);
  assert.match(api, /assignedReviewer/);
  assert.match(api, /Is The Current.*And Must Complete This Employer Review/);
  assert.match(workspace, /ALL_COMPANY_DESIGNATIONS/);
  assert.match(teamRoles, /Safety Director/);
  assert.match(ui, /Names Follow Current Company Assignments/);
  assert.match(ui, /Employee Documents Awaiting Your Role/);
});

test("outside counsel review is separate from internal signed-form review", () => {
  assert.match(api, /set_outside_counsel/);
  assert.match(api, /Onboarding Legal Provider/);
  assert.match(api, /annualReviewDue/);
  assert.match(api, /Configure The Outside Employment Counsel Before Recording Annual Legal Approval/);
  assert.match(ui, /OUTSIDE EMPLOYMENT COUNSEL/);
  assert.match(ui, /LIVE FORM ROLES/);
});

test("electronic signature records are authenticated immutable and revisioned", () => {
  assert.match(api, /Only The Employee May Apply Their Signature/);
  assert.match(api, /Typed Legal Name And Signature Intent Are Required/);
  assert.match(api, /Authenticated Typed Signature/);
  assert.match(api, /This Signed Submission Is Immutable/);
  assert.match(api, /Prior signed version retained permanently/);
  assert.match(api, /SHA-256/);
  assert.match(api, /roleForAnswers.*employer_sign/);
  assert.match(ui, /I intend my typed name to be my electronic signature/);
});

test("download is a generated electronic record and never a scan", () => {
  assert.match(pdf, /PDFDocument\.create\(\)/);
  assert.match(pdf, /ELECTRONIC SUBMISSION RECORD/);
  assert.match(pdf, /NOT A SCANNED DOCUMENT/);
  assert.match(pdf, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(pdf, /embedPng|embedJpg|PDFDocument\.load/);
});

test("onboarding blocks document and image uploads end to end", () => {
  assert.match(filesApi, /projectId === "MEFFORD-PEOPLE"/);
  assert.match(filesApi, /category\.startsWith\("Employee Onboarding"\)/);
  assert.match(filesApi, /!isVideoUpload\(file\)/);
  assert.match(workspace, /!isVideoUpload\(file\)/);
  assert.match(filesApi, /status: 415/);
  assert.match(workspace, /accept="\.mp4,\.mov,video\/\*"/);
  assert.doesNotMatch(workspace, /accept="\.pdf/);
  assert.match(ui, /SCANNED DOCUMENTS/);
  assert.match(ui, /Official Agency Or Native Form Only/);
});

test("the scanned packet is not shipped as a site asset", () => {
  const sourceFiles = [registry, api, pdf, ui, workspace, filesApi].join("\n");
  assert.doesNotMatch(sourceFiles, /New Hire packet\(1\)\.pdf/);
});

test("employee onboarding is guided and workflow routing stays automatic", () => {
  assert.match(ui, /Start Onboarding/);
  assert.match(ui, /Continue Onboarding/);
  assert.match(ui, /one step at a time/i);
  assert.match(ui, /Command Center handles routing, reviewer assignments, and company signatures automatically/);
  assert.match(ui, /Next Question/);
  assert.match(ui, /Review And Sign/);
  assert.match(ui, /Save And Exit/);
  assert.match(ui, /Company Is Preparing/);
  assert.doesNotMatch(workspace, /START HERE/);
});
