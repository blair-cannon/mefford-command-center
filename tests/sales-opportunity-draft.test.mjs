import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { missingSalesOpportunityHandoffFields, salesOpportunityQualification } from "../lib/sales-opportunity.js";

const completeOpportunity = {
  projectName: "Medical Office Renovation",
  company: "Example Owner LLC",
  contactId: "CNT-001",
  assignedRep: "Jordan Mefford",
  leadSource: "Referral",
  expectedAwardDate: "2026-11-15",
  assignedEstimator: "Blain Faulkner",
};

test("incomplete Sales opportunities remain valid drafts but are not ready for Estimating", () => {
  const qualification = salesOpportunityQualification({ projectName: "Early Lead" });
  assert.equal(qualification.status, "Incomplete");
  assert.deepEqual(qualification.missingFields, [
    "Primary Company",
    "Company Contact",
    "Salesperson",
    "Lead Source",
    "Expected Award Date",
    "Assigned Estimator",
  ]);
});

test("a fully qualified Sales opportunity is ready for Estimating", () => {
  assert.deepEqual(missingSalesOpportunityHandoffFields(completeOpportunity), []);
  assert.equal(salesOpportunityQualification(completeOpportunity).status, "Ready For Estimating");
});

test("the UI and server separate Sales draft saving from the Estimating handoff", async () => {
  const [sales, recordsApi, guide] = await Promise.all([
    readFile(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/user-guide.json", import.meta.url), "utf8"),
  ]);

  const saveOpportunity = sales.slice(sales.indexOf("async function saveOpportunity"), sales.indexOf("async function moveOpportunity"));
  assert.match(saveOpportunity, /Add The Project Or Opportunity Name Before Saving The Sales Draft/);
  assert.match(saveOpportunity, /sendToEstimating \|\| opportunityDraft\.stage === "Estimating"/);
  assert.match(saveOpportunity, /Saved As A Sales Draft/);
  assert.doesNotMatch(saveOpportunity, /Company Contact Salesperson Source And Expected Award Date Before Saving/);
  assert.match(sales, /Sales Draft Can Be Saved Now/);
  assert.match(sales, /disabled=\{saving \|\| !opportunityReadyForEstimating\}/);
  assert.match(recordsApi, /nextStage === "Estimating" && qualification\.missingFields\.length/);
  assert.match(recordsApi, /qualificationStatus: qualification\.status/);
  assert.match(guide, /Save Sales Draft/);
});
