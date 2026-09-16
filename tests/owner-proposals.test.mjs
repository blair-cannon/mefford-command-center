import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const studio = fs.readFileSync(new URL("../app/owner-proposal-studio.tsx", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../app/estimate-project-workspace.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/proposals/route.ts", import.meta.url), "utf8");
const documentRoute = fs.readFileSync(new URL("../app/api/proposals/document/route.ts", import.meta.url), "utf8");
const proposalCore = fs.readFileSync(new URL("../lib/proposals.ts", import.meta.url), "utf8");
const proposalPdf = fs.readFileSync(new URL("../lib/proposal-pdf.ts", import.meta.url), "utf8");
const award = fs.readFileSync(new URL("../app/api/estimates/award/route.ts", import.meta.url), "utf8");
const sales = fs.readFileSync(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8");
const globalStyles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ownerApprovals = fs.readFileSync(new URL("../app/api/owner-approvals/route.ts", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Estimating contains a dedicated owner proposal and engagement-letter workflow", () => {
  assert.match(workspace, /05-Owner Proposal & LOE/);
  assert.match(workspace, /<OwnerProposalStudio/);
  assert.match(studio, /Construction Proposal/);
  assert.match(proposalCore, /Preconstruction Letter of Engagement/);
  assert.match(studio, /Project Brief/);
  assert.match(studio, /Core Values/);
  assert.match(studio, /Engagement Basis/);
  assert.match(studio, /Final Review/);
  assert.match(studio, /Photos & Drawings/);
  assert.match(studio, /Upload Project Photos/);
  assert.match(studio, /Upload Design Drawing/);
  assert.match(studio, /Add Drawing/);
});

test("Proposal sources are connected instead of re-entered", () => {
  assert.match(proposalCore, /calculateEstimateSummary/);
  assert.match(proposalCore, /normalizeBidPackageData/);
  assert.match(proposalCore, /contactLinked/);
  assert.match(proposalCore, /selectedProposalBid/);
  assert.match(proposalCore, /ownerScopeDraft/);
  assert.match(studio, /requestAction\("refresh"\)/);
  assert.match(studio, /Pull Latest Project Data/);
  assert.match(sales, /openOpportunityFromContact/);
  assert.match(sales, /Create Opportunity From Contact/);
  assert.match(sales, /projectLocation: current\.projectLocation \|\| contactLocation/);
});

test("Proposal lifecycle has routed review, owner approval, controlled send, immutable revision, and audit controls", () => {
  for (const action of ["generate", "refresh", "save", "submit-review", "issue", "start-revision"]) {
    assert.match(route, new RegExp(action));
  }
  assert.match(route, /Company Owner Or Administrator Must Issue/);
  assert.match(route, /The Issued Packet Is Immutable/);
  assert.match(route, /recordAudits/);
  assert.match(route, /issuedPdfHash/);
  assert.match(route, /BUCKET\.put/);
  assert.match(route, /projectFiles/);
  assert.match(route, /loadProposalVisualAssets/);
  assert.match(route, /Approved To Send/);
  assert.match(route, /proposal-review:/);
  assert.match(route, /Company Owner Approval Is Required Before Sending The Proposal/);
  assert.match(ownerApprovals, /decideOwnerProposal/);
  assert.match(ownerApprovals, /Owner Proposal Release/);
  assert.match(studio, /Approve To Send/);
  assert.match(studio, /requestAction\("send-owner"\)/);
  assert.match(workspace, /Proposal Status/);
  assert.match(workspace, /Company Owner Review/);
  assert.match(dashboard, /proposal-review-/);
  assert.match(dashboard, /proposal-send-/);
});

test("Company Owner review accepts an incomplete working draft while customer release stays gated", () => {
  assert.match(route, /const proposalReviewOpenItems = action === "submit-review" \? proposalIssueErrors\(data\) : \[\];/);
  assert.doesNotMatch(route, /Complete Before Review/);
  assert.match(route, /issue-readiness item/);
  assert.match(studio, /disabled=\{saving \|\| wordBusy\} onClick=\{\(\) => void requestAction\("submit-review"\)\}/);
  assert.match(studio, /disabled=\{saving \|\| wordBusy \|\| issueErrors\.length > 0\} onClick=\{\(\) => void decideReview\("Approved"\)\}/);
  assert.match(studio, /disabled=\{saving \|\| wordBusy \|\| issueErrors\.length > 0\} onClick=\{\(\) => void requestAction\("issue"\)\}/);
});

test("Owner document uses a disciplined editorial grid and hides raw vendor pricing by default", () => {
  assert.match(proposalPdf, /MEFFORD CONTRACTING/);
  assert.match(proposalPdf, /MEFFORD_CORE_VALUES/);
  assert.match(proposalPdf, /MEFFORD_OWNER_COMMITMENTS/);
  assert.match(proposalPdf, /PROJECT READ \+ CORE VALUES/);
  assert.match(proposalPdf, /renderConstructionProposal/);
  assert.match(proposalPdf, /renderEngagementLetter/);
  assert.match(proposalPdf, /PROJECT READ/);
  assert.match(proposalPdf, /PROPOSAL BASIS/);
  assert.match(proposalPdf, /\/ SCOPE/);
  assert.match(proposalPdf, /Dear/);
  assert.match(proposalPdf, /SERVICES/);
  assert.match(proposalPdf, /DELIVERABLES/);
  assert.match(proposalPdf, /Authorization/);
  assert.doesNotMatch(proposalPdf, /SERIOUS\. REAL\. FACE FORWARD\.|One team\. Straight answers\. Finish strong\.|Let's do this right/i);
  assert.match(proposalCore, /showSectionPricing: false/);
  assert.doesNotMatch(proposalPdf, /Connected project information|Source health|Trade detail remains part of Mefford's internal project record/i);
  assert.match(documentRoute, /Immutable-Issued-Copy/);
  assert.match(proposalPdf, /insertProposalVisuals/);
  assert.match(proposalPdf, /proposalPageIndexes/);
  assert.match(proposalPdf, /DESIGN DRAWING/);
  assert.match(proposalPdf, /leadProjectPhoto/);
});

test("Proposal Studio retains its visual surfaces while the generated owner PDF uses white backgrounds", () => {
  assert.doesNotMatch(globalStyles, /Proposal Studio white-surface system/);
  assert.doesNotMatch(globalStyles, /\.proposal-studio-layer \.proposal-studio-shell \*:not\(img\)/);
  assert.match(globalStyles, /\.proposal-studio-layer\{background:#101613f2/);
  assert.match(globalStyles, /\.proposal-studio-header\{[^}]*background:#111815/);
  assert.match(proposalPdf, /const PAPER = WHITE/);
  assert.match(proposalPdf, /const SOFT = WHITE/);
});

test("New drafts use Mefford's natural owner-first voice and legacy drafts migrate without changing issued history", () => {
  assert.match(proposalCore, /MEFFORD_PROPOSAL_VOICE_VERSION/);
  assert.match(proposalCore, /mefford-owner-system-v9/);
  assert.match(proposalCore, /RIDE OR DIE/);
  assert.match(proposalCore, /NO BULLSHIT/);
  assert.match(proposalCore, /PROBLEM SOLVERS/);
  assert.match(proposalCore, /STAY HUNGRY/);
  assert.match(proposalCore, /a relationship that is stronger when the work is finished/);
  assert.match(proposalCore, /beginning of the working relationship/);
  assert.match(proposalCore, /same version of the truth/);
  assert.match(proposalCore, /learn how .* business and building need to work/);
  assert.match(proposalCore, /bring the facts, the options, and a recommended way forward/);
  assert.match(proposalCore, /both teams can keep growing/);
  assert.match(proposalCore, /proposalNeedsVoiceMigration/);
  assert.match(proposalCore, /keepWrittenVoice = !proposalNeedsVoiceMigration/);
  assert.doesNotMatch(studio, /Write The Letter A Real Person Would Send/);
  assert.doesNotMatch(studio, /Our Read On The Project/);
  assert.doesNotMatch(studio, /VALUES IN THE PROJECT OWNER'S EXPERIENCE/);
  assert.doesNotMatch(studio, /Read It Like The Project Owner Will/);
  assert.match(studio, /owner-doc-proposal-preview/);
  assert.match(studio, /owner-doc-engagement-preview/);
  assert.match(studio, /proposal-footer-preview/);
  assert.match(studio, /Preview Proposal PDF/);
  assert.match(studio, /Preview Engagement PDF/);
  assert.match(globalStyles, /proposal-studio-shell>.proposal-studio-footer\{grid-row:5/);
  assert.match(globalStyles, /proposal-footer-preview\{display:inline-flex!important/);
  assert.doesNotMatch(studio, /Sound like us, not like a proposal factory|Talk like people|Own the answer|Bring the fix|Cool, clear, and serious/i);
  assert.match(route, /existingData && existingData\.status !== "Issued"/);
  assert.match(route, /revisionBase = refreshProposalSources/);
});

test("Issued proposal and engagement documents follow the award into project contracts", () => {
  assert.match(award, /salesOwnerProposals/);
  assert.match(award, /sourceProposalRecordIds/);
  assert.match(award, /proposalHandoffStatements/);
  assert.match(award, /immutableIssuedOwnerCopy/);
  assert.match(award, /and its immutable PDF followed/);
  assert.match(route, /proposalHandoff/);
  assert.match(route, /Proposal Submitted/);
});
