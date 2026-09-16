import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { carryPreAwardContractFields } from "../lib/preaward-owner-contract.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("estimate-originated opportunities remain one visible and editable Sales Funnel record", async () => {
  const sales = await read("../app/sales-estimating.tsx");
  assert.match(sales, /const funnelOpportunities = opportunities;/);
  assert.doesNotMatch(sales, /filter\(\(record\) => !record\.data\?\.directEstimate\)/);
  assert.match(sales, /Estimate Workspace And Connected Sales Funnel Card Created/);
  assert.match(sales, /!directEstimateOpportunity && \(sendToEstimating \|\| opportunityDraft\.stage === "Estimating"\)/);
  assert.match(sales, /sole matching company contact is linked automatically/i);
  assert.match(sales, /contactAutoLinked/);
  assert.match(sales, /Company Contact/);
});

test("matching pre-award contract fields carry while formal award identity and price win", () => {
  const result = carryPreAwardContractFields({
    preAward: {
      opportunityId: "LEAD-0042",
      contractType: "Plan & Spec Lump Sum",
      activeInstrument: "Primary Agreement",
      fields: {
        PROJECT_NUMBER: "Pending Award",
        PROJECT_NAME: "Preliminary Name",
        PROJECT_SITE_ADDRESS: "Old Address",
        OWNER_LEGAL_NAME: "Preliminary Owner",
        LUMP_SUM_CONTRACT_SUM: "900000.00",
        CONSTRUCTION_SCOPE_OF_WORK: "Preserve this negotiated scope.",
        CONSTRUCTION_EXCLUSIONS: "Preserve this exclusion.",
      },
      missingRequiredFields: [],
      paymentTerms: "Net 20",
      retainageInitialPercent: "8",
      retainageAfterHalfPercent: "4",
      revisionNumber: 3,
      revisionHash: "abc",
      savedAt: "2026-09-01T00:00:00.000Z",
      savedBy: "Estimator",
    },
    finalContractType: "Plan & Spec Lump Sum",
    finalInstrument: "Primary Agreement",
    generatedFields: {
      PROJECT_NUMBER: "26047",
      PROJECT_NAME: "Awarded Name",
      PROJECT_SITE_ADDRESS: "Final Address",
      OWNER_LEGAL_NAME: "Final Owner LLC",
      LUMP_SUM_CONTRACT_SUM: "950000.00",
    },
  });

  assert.equal(result.carried, true);
  assert.equal(result.fields.PROJECT_NUMBER, "26047");
  assert.equal(result.fields.PROJECT_NAME, "Awarded Name");
  assert.equal(result.fields.PROJECT_SITE_ADDRESS, "Final Address");
  assert.equal(result.fields.OWNER_LEGAL_NAME, "Final Owner LLC");
  assert.equal(result.fields.LUMP_SUM_CONTRACT_SUM, "950000.00");
  assert.equal(result.fields.CONSTRUCTION_SCOPE_OF_WORK, "Preserve this negotiated scope.");
  assert.equal(result.fields.CONSTRUCTION_EXCLUSIONS, "Preserve this exclusion.");
});

test("a changed award contract type preserves the pre-award record but does not merge incompatible language", () => {
  const result = carryPreAwardContractFields({
    preAward: {
      opportunityId: "LEAD-0042",
      contractType: "Time & Materials",
      activeInstrument: "Primary Agreement",
      fields: { CONSTRUCTION_SCOPE_OF_WORK: "T&M scope" },
      missingRequiredFields: [],
      paymentTerms: "Net 30",
      retainageInitialPercent: "10",
      retainageAfterHalfPercent: "5",
      revisionNumber: 1,
      revisionHash: "abc",
      savedAt: "2026-09-01T00:00:00.000Z",
      savedBy: "Estimator",
    },
    finalContractType: "Plan & Spec Lump Sum",
    finalInstrument: "Primary Agreement",
    generatedFields: { PROJECT_NUMBER: "26047", CONSTRUCTION_SCOPE_OF_WORK: "Final award scope" },
  });
  assert.equal(result.carried, false);
  assert.equal(result.fields.CONSTRUCTION_SCOPE_OF_WORK, "Final award scope");
  assert.match(result.reason, /changed at award/i);
});

test("current CRM contact details refresh at award while intentional pre-award recipient edits remain", () => {
  const refreshed = carryPreAwardContractFields({
    preAward: {
      opportunityId: "LEAD-0051",
      contractType: "Time & Materials",
      activeInstrument: "Primary Agreement",
      fields: {
        OWNER_NOTICE_EMAIL: "old-contact@example.com",
        INVOICE_DELIVERY_METHOD_RECIPIENT: "Email · Old Contact · old-contact@example.com",
      },
      manualFieldKeys: [],
      missingRequiredFields: [],
      paymentTerms: "Net 30",
      retainageInitialPercent: "10",
      retainageAfterHalfPercent: "5",
      revisionNumber: 1,
      revisionHash: "abc",
      savedAt: "2026-09-01T00:00:00.000Z",
      savedBy: "Estimator",
    },
    finalContractType: "Time & Materials",
    finalInstrument: "Primary Agreement",
    generatedFields: {
      OWNER_NOTICE_EMAIL: "current-contact@example.com",
      INVOICE_DELIVERY_METHOD_RECIPIENT: "Email · Current Contact · current-contact@example.com",
    },
  });
  assert.equal(refreshed.fields.OWNER_NOTICE_EMAIL, "current-contact@example.com");
  assert.equal(refreshed.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Current Contact · current-contact@example.com");

  const overridden = carryPreAwardContractFields({
    preAward: {
      opportunityId: "LEAD-0051",
      contractType: "Time & Materials",
      activeInstrument: "Primary Agreement",
      fields: { INVOICE_DELIVERY_METHOD_RECIPIENT: "Email · Accounts Payable · ap@example.com" },
      manualFieldKeys: ["INVOICE_DELIVERY_METHOD_RECIPIENT"],
      missingRequiredFields: [],
      paymentTerms: "Net 30",
      retainageInitialPercent: "10",
      retainageAfterHalfPercent: "5",
      revisionNumber: 2,
      revisionHash: "def",
      savedAt: "2026-09-02T00:00:00.000Z",
      savedBy: "Estimator",
    },
    finalContractType: "Time & Materials",
    finalInstrument: "Primary Agreement",
    generatedFields: { INVOICE_DELIVERY_METHOD_RECIPIENT: "Email · Current Contact · current-contact@example.com" },
  });
  assert.equal(overridden.fields.INVOICE_DELIVERY_METHOD_RECIPIENT, "Email · Accounts Payable · ap@example.com");
});

test("pre-award drafting stays internal and formal award performs the single controlled handoff", async () => {
  const [workspace, studio, api, document, award] = await Promise.all([
    read("../app/estimate-project-workspace.tsx"),
    read("../app/preaward-owner-contract-studio.tsx"),
    read("../app/api/preaward-contracts/route.ts"),
    read("../app/api/preaward-contracts/document/route.ts"),
    read("../app/api/estimates/award/route.ts"),
  ]);
  assert.match(workspace, /07-Contract[\s\S]*contract: true/);
  assert.match(workspace, /PreAwardOwnerContractStudio/);
  assert.match(studio, /Contract Setup/);
  assert.match(studio, /Required Terms/);
  assert.match(studio, /Additional Clauses/);
  assert.doesNotMatch(studio, /Nothing is sent until the project is awarded/);
  assert.match(studio, /Save And Preview/);
  assert.match(studio, /Save Draft/);
  assert.match(studio, /activeGroupFields\.map/);
  assert.doesNotMatch(studio, /contract-type-picker/);
  assert.doesNotMatch(studio, /contract-flow-summary/);
  assert.doesNotMatch(studio, /Show All Fields/);
  assert.doesNotMatch(studio, /Download Word Master/);
  assert.doesNotMatch(studio, /<small>\{field\}<\/small>/);
  assert.match(api, /PREAWARD_OWNER_CONTRACT_RECORD_TYPE/);
  assert.match(api, /bindingCommitment: false/);
  assert.match(api, /accountingSynchronization: false/);
  assert.doesNotMatch(api, /INSERT INTO owner_portal_access/);
  assert.doesNotMatch(api, /MEFFORD-ACCOUNTING/);
  assert.match(document, /PRE-AWARD DRAFT · NOT ISSUED/);
  assert.match(document, /does not award the project/);
  assert.match(award, /carryPreAwardContractFields/);
  assert.match(award, /createdFromPreAwardDraft/);
  assert.match(award, /Carried To Project/);
  assert.match(award, /without duplicate entry/);
});
