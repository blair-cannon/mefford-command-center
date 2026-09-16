import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const studio = fs.readFileSync(new URL("../app/owner-proposal-studio.tsx", import.meta.url), "utf8");
const pdf = fs.readFileSync(new URL("../lib/proposal-pdf.ts", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../lib/proposals.ts", import.meta.url), "utf8");
const intelligence = fs.readFileSync(new URL("../app/api/proposals/intelligence/route.ts", import.meta.url), "utf8");
const team = fs.readFileSync(new URL("../lib/proposal-team.ts", import.meta.url), "utf8");
const lifecycle = fs.readFileSync(new URL("../app/api/employee-lifecycle/route.ts", import.meta.url), "utf8");
const proposalRoute = fs.readFileSync(new URL("../app/api/proposals/route.ts", import.meta.url), "utf8");
const recordsRoute = fs.readFileSync(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const salesEstimating = fs.readFileSync(new URL("../app/sales-estimating.tsx", import.meta.url), "utf8");
const commandScheduler = fs.readFileSync(new URL("../lib/command-scheduler.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");

test("construction proposal cover uses customer branding without revealing price", () => {
  assert.match(studio, /accept=\{PHOTO_UPLOAD_ACCEPT\}/);
  assert.match(studio, /prepareDocumentImage/);
  assert.match(studio, /Original Preserved/);
  assert.match(pdf, /customerLogoBytes/);
  assert.match(pdf, /PREPARED FOR/);
  const construction = pdf.slice(pdf.indexOf("function renderConstructionProposal"), pdf.indexOf("function renderEngagementLetter"));
  const cover = construction.slice(0, construction.indexOf("const writer"));
  assert.ok(cover.indexOf("data.ownerContactName") < cover.indexOf("cover.drawImage(customerLogo"));
  assert.match(cover, /data\.ownerName/);
  assert.match(cover, /data\.ownerContactTitle/);
  assert.match(cover, /data\.ownerContactEmail/);
  assert.match(cover, /data\.ownerContactPhone/);
  assert.doesNotMatch(cover, /contractPrice|PROPOSED INVESTMENT|TOTAL PROPOSED/);
});

test("proposal order puts scope before its pricing basis and avoids dark or empty presentation pages", () => {
  const render = pdf.slice(pdf.indexOf("function renderConstructionProposal"), pdf.indexOf("function renderEngagementLetter"));
  assert.ok(render.indexOf(" / SCOPE") < render.indexOf("PROPOSAL BASIS"));
  assert.match(render, /openPage\("01 \/ PROJECT READ \+ CORE VALUES", ""\)/);
  assert.doesNotMatch(render, /Our Read On The Project/);
  assert.doesNotMatch(render, /\/ HOW WE LEAD/);
  assert.match(render, /openPage\(`\$\{pad2\(schedulePage \+ 1\)\} \/ SCOPE`, "What Is Included"\)/);
  assert.match(render, /openPage\(`\$\{pad2\(schedulePage \+ 2\)\} \/ PROPOSAL BASIS`, "What The Price Is Based On"\)/);
  assert.match(render, /PROJECT BUDGET \+ NEXT STEPS/);
  assert.match(render, /The Proposed Project Budget/);
  assert.match(pdf, /What Comes Next\.\.\./);
  assert.doesNotMatch(render, /The Proposed Commercial Commitment|The Next Move We Recommend/);
  assert.doesNotMatch(render, /openPage\([^\n]+OUR RECOMMENDATION/);
  assert.match(pdf, /PICTURE HERE IF UPLOADED/);
  assert.match(pdf, /leadProjectPhoto/);
  assert.match(pdf, /drawContainedImage/);
  assert.doesNotMatch(pdf, /THE JOB AS WE SEE IT/);
  assert.match(pdf, /drawFittedText\(this\.page, input\.executiveSummary/);
  assert.match(pdf, /mailingAddressLines\(value \|\| "To Be Confirmed"\)/);
  assert.doesNotMatch(pdf, /rgb\(0,\s*0,\s*0\)|DARK/);
  assert.match(pdf, /minimumContentHeight/);
});

test("team resumes and completion experience require owner-controlled approval", () => {
  assert.match(team, /profileStatus !== "Approved"/);
  assert.match(team, /customerPermission/);
  assert.match(lifecycle, /Company Owner Approval Is Required/);
  assert.match(lifecycle, /save_proposal_profile/);
  assert.match(lifecycle, /approve_proposal_experience/);
  assert.match(pdf, /teamMember/);
});

test("AI creates cited review drafts without writes or fake connected behavior", () => {
  assert.match(intelligence, /connectionRequired: true/);
  assert.match(intelligence, /allowedSourceIds/);
  assert.match(intelligence, /requiresHumanReview: true/);
  assert.match(intelligence, /writesApplied: false/);
  assert.match(intelligence, /Never invent/);
  assert.match(studio, /Approve Reviewed Draft/);
});

test("proposal includes exactly four value commitments, a schedule, and contract handoff", () => {
  assert.equal((core.match(/id: "APPROACH-0[1-4]"/g) || []).length, 4);
  assert.match(studio, /onClick=\{onPrepareContract\}/);
  assert.match(pdf, /PROPOSED SCHEDULE/);
  assert.match(pdf, /scheduleGraphic/);
  assert.match(pdf, /barWidth/);
  assert.match(core, /recommendationSteps/);
  assert.match(pdf, /Mefford Contracting/);
});

test("proposal close puts the three next-step boxes above the controlled contract path", () => {
  const close = pdf.slice(pdf.indexOf("commercialClose(input:"), pdf.indexOf("factGrid(items:"));
  assert.ok(close.indexOf("steps.forEach") < close.indexOf("RECOMMENDED CONTRACT PATH"));
  assert.doesNotMatch(close, /input\.nextSteps/);
  assert.doesNotMatch(studio, /Personal Recommendation/);
  assert.match(studio, /Project Owner Contract Type/);
  assert.match(studio, /update\("recommendedContractType", event\.target\.value as OwnerContractType\)/);
  assert.match(studio, /OWNER_CONTRACT_TYPES\.map/);
});

test("design-build pricing page includes the adjustable startup GMP and specific may-include services", () => {
  assert.match(core, /DESIGN_STARTUP_STANDARD_PERCENT = 5/);
  assert.match(core, /Geotechnical Services/);
  assert.match(core, /Architectural Services/);
  assert.match(core, /Structural Engineering/);
  assert.match(core, /Civil And Site Engineering/);
  assert.match(core, /MEP, Fire And Energy Engineering/);
  assert.match(core, /Permitting And Municipality Coordination/);
  assert.match(studio, /Upfront Design And Permitting Startup GMP/);
  assert.match(studio, /Use Standard \{DESIGN_STARTUP_STANDARD_PERCENT\}%/);
  assert.match(studio, /designStartupGmpManual: true/);
  assert.match(pdf, /INCLUDED UPFRONT DESIGN STARTUP GMP/);
  assert.match(pdf, /Included within the total project price - not added/);
  assert.match(pdf, /any unused portion remains unspent/);
  assert.match(pdf, /designStartup: isDesignBuildProposal\(data\)/);
  const close = pdf.slice(pdf.indexOf("commercialClose(input:"), pdf.indexOf("factGrid(items:"));
  assert.doesNotMatch(close, /DESIGN-STARTUP-ARCHITECTURAL/);
  assert.match(close, /displayTitle\(service\.title\)[^\n]+color: INK/);
});

test("owner contract type stays synchronized between Project Info and Proposal Studio", () => {
  assert.match(salesEstimating, /Field label="Project Owner Contract Type"/);
  assert.match(salesEstimating, /OWNER_CONTRACT_TYPES\.map/);
  assert.match(proposalRoute, /\["save", "submit-review", "issue"\]\.includes\(action\)/);
  assert.match(proposalRoute, /ownerContractType: data\.recommendedContractType/);
  assert.match(recordsRoute, /synchronizeOpportunityProposalContractType/);
  assert.match(recordsRoute, /row\.status === "Issued"/);
  assert.match(recordsRoute, /Project Info And Proposal Contract Type Synchronization/);
});

test("existing editable estimate proposals upgrade together without rewriting issued copies", () => {
  assert.match(proposalRoute, /upgradeEditableProposals/);
  assert.match(proposalRoute, /reconcileAllEditableProposalUpgrades/);
  assert.match(commandScheduler, /reconcileAllEditableProposalUpgrades/);
  assert.match(worker, /reconcileReleasedProposalTemplates/);
  assert.match(proposalRoute, /context\.proposals\.map/);
  assert.match(proposalRoute, /\["Ready For Review", "Approved To Send", "Issued"\]\.includes\(row\.status\)/);
  assert.match(proposalRoute, /proposalNeedsVoiceMigration/);
  assert.match(proposalRoute, /proposalNeedsPricingMigration/);
  assert.match(proposalRoute, /Existing editable proposal upgraded/);
  assert.match(proposalRoute, /records: proposals\.map/);
});

test("proposal scope edits keep the owner total reconciled and support estimate credits", () => {
  assert.match(studio, /function updateScopeSections/);
  assert.match(studio, /const contractPrice = proposalScopeTotal\(scopeSections\)/);
  assert.match(studio, /designStartupGmpForPrice\(contractPrice\)/);
  assert.match(studio, /allowNegative/);
  assert.match(studio, /Use Included Scope Total/);
  assert.match(core, /allocateProposalScopePricing/);
  assert.match(core, /PROPOSAL_PRICING_VERSION/);
  assert.match(core, /title: "General Conditions"/);
  assert.match(core, /generalConditionsAdjustmentCents/);
});

test("proposal issuance remains a controlled PDF with a separate editable Word round trip", () => {
  assert.doesNotMatch(studio, /One Controlled Proposal Format/);
  assert.match(studio, /Save And Open Full Branded PDF Preview/);
  assert.match(studio, /Company Owner Review/);
  assert.match(studio, /requestAction\("send-owner"\)/);
  assert.match(studio, /Download Editable Word/);
  assert.match(studio, /Upload Edited Word/);
  assert.match(studio, /import-word/);
});

test("proposal visuals have dedicated project-photo and design-drawing placements", () => {
  assert.match(studio, /Upload Project Photos/);
  assert.match(studio, /Upload Design Drawing/);
  assert.match(studio, /PDF_AND_PHOTO_UPLOAD_ACCEPT/);
  assert.match(core, /"Project Photo"/);
  assert.match(core, /"Design Drawing"/);
  assert.match(pdf, /drawProposalDrawingPdfPage/);
  assert.match(pdf, /drawProposalDrawingImagePage/);
});

test("the first proposal screen owns the project-specific schedule duration", () => {
  const projectBrief = studio.slice(studio.indexOf('activeStep === "details"'), studio.indexOf('activeStep === "story"'));
  assert.match(projectBrief, /Target Start Date/);
  assert.match(projectBrief, /Project Duration In Months/);
  assert.doesNotMatch(projectBrief, /Schedule Linked To Project Setup/);
  assert.match(projectBrief, /alignScheduleMilestonesToDuration/);
  assert.doesNotMatch(`${studio}\n${core}\n${pdf}`, /15[- ]month/i);
});
