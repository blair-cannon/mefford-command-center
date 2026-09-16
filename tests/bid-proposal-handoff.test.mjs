import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const procurement = fs.readFileSync(new URL("../lib/procurement.ts", import.meta.url), "utf8");
const procurementApi = fs.readFileSync(new URL("../app/api/procurement/route.ts", import.meta.url), "utf8");
const procurementUi = fs.readFileSync(new URL("../app/procurement-workspace.tsx", import.meta.url), "utf8");
const proposals = fs.readFileSync(new URL("../lib/proposals.ts", import.meta.url), "utf8");
const proposalStudio = fs.readFileSync(new URL("../app/owner-proposal-studio.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("received trade quotes are compared side by side from their permanent originals", () => {
  assert.match(procurementUi, /Compare Quotes Side By Side/);
  assert.match(procurementUi, /Reviewed scope/);
  assert.match(procurementUi, /Exclusions/);
  assert.match(procurementUi, /Alternates/);
  assert.match(procurementUi, /Clarifications/);
  assert.match(procurementUi, /Original Quote/);
  assert.match(styles, /quote-comparison-grid/);
  assert.match(styles, /grid-auto-flow:column/);
});

test("an estimator can select one reviewed leveled bid as the estimate and proposal basis", () => {
  assert.match(procurementApi, /select-proposal-basis/);
  assert.match(procurementApi, /bid\.ocr\?\.status !== "Human Reviewed"/);
  assert.match(procurementApi, /bidderIsLeveled\(bidder\)/);
  assert.match(procurementApi, /resolveEstimateLineKey/);
  assert.match(procurementApi, /previousPrice - Number\(previousSelection\?\.selectedPrice \|\| 0\) \+ selectedPrice/);
  assert.match(procurementApi, /estimateSourceSelections/);
  assert.match(procurementApi, /Internal pricing selection only; no award, commitment, or message was created/);
  assert.match(procurementApi, /The Award Recommendation Must Match The Estimate And Proposal Basis/);
  assert.match(procurementUi, /Use For Estimate & Proposal/);
  assert.match(procurementUi, /was selected after reviewing scope, price, exclusions, clarifications, schedule, and budget alignment/);
});

test("the selected quote drafts only its owner scope into the matching CSI proposal section", () => {
  assert.match(procurement, /export type ProposalBasis/);
  assert.match(procurement, /buildOwnerScopeDraft/);
  assert.match(proposals, /basis\?\.ownerScopeDraft \|\| item\.normalized\.scopeDescription/);
  assert.match(proposals, /sourceRevisionId/);
  assert.doesNotMatch(proposals, /const reviewedScopes = item\.normalized\.bidders/);
  assert.match(proposals, /Select proposal basis for every quoted bid package/);
});

test("review-locked owner packets stay exact while drafts can explicitly refresh connected sources", () => {
  assert.match(proposalStudio, /if \(construction\) selectRecord\(construction\)/);
  assert.match(proposalStudio, /if \(existing\) selectRecord\(existing\)/);
  assert.match(proposalStudio, /Pull Latest Project Data/);
  assert.match(proposalStudio, /proposalStatus === "Draft"/);
  assert.doesNotMatch(proposalStudio, /construction \? "refresh" : "generate"/);
  assert.match(proposalStudio, /data\.scopeSections/);
});
