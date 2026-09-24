import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const adminSource = await readFile(
  new URL("../app/admin-command-workspace.tsx", import.meta.url),
  "utf8",
);
const salesSource = await readFile(
  new URL("../app/sales-estimating.tsx", import.meta.url),
  "utf8",
);
const recordsApiSource = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const estimateWorkspaceSource = await readFile(
  new URL("../app/estimate-project-workspace.tsx", import.meta.url),
  "utf8",
);
const estimateEditorSource = await readFile(
  new URL("../app/estimate-editor.tsx", import.meta.url),
  "utf8",
);
const awardApiSource = await readFile(
  new URL("../app/api/estimates/award/route.ts", import.meta.url),
  "utf8",
);
const filesApiSource = await readFile(
  new URL("../app/api/files/route.ts", import.meta.url),
  "utf8",
);
const directorySource = await readFile(
  new URL("../app/company-directory.ts", import.meta.url),
  "utf8",
);
const accountingSource = await readFile(
  new URL("../app/accounting-erp.tsx", import.meta.url),
  "utf8",
);
const vendorManagementSource = await readFile(
  new URL("../app/vendor-management.tsx", import.meta.url),
  "utf8",
);
const mobileSource = await readFile(
  new URL("../app/mobile-command.tsx", import.meta.url),
  "utf8",
);
const vendorPortalSource = await readFile(
  new URL("../app/vendor-portal.tsx", import.meta.url),
  "utf8",
);
const vendorsApiSource = await readFile(
  new URL("../app/api/vendors/route.ts", import.meta.url),
  "utf8",
);
const vendorPortalApiSource = await readFile(
  new URL("../app/api/vendor-portal/route.ts", import.meta.url),
  "utf8",
);
const vendorPortalFilesSource = await readFile(
  new URL("../app/api/vendor-portal/files/route.ts", import.meta.url),
  "utf8",
);
const correspondenceSource = await readFile(
  new URL("../app/project-correspondence.tsx", import.meta.url),
  "utf8",
);
const correspondenceApiSource = await readFile(
  new URL("../app/api/project-correspondence/route.ts", import.meta.url),
  "utf8",
);
const correspondenceLogicSource = await readFile(
  new URL("../lib/project-correspondence.ts", import.meta.url),
  "utf8",
);
const designLifecycleSource = await readFile(
  new URL("../app/design-lifecycle.tsx", import.meta.url),
  "utf8",
);
const designLifecycleApiSource = await readFile(
  new URL("../app/api/design-lifecycle/route.ts", import.meta.url),
  "utf8",
);
const designLifecycleLogicSource = await readFile(
  new URL("../lib/design-lifecycle.ts", import.meta.url),
  "utf8",
);
const procurementSource = await readFile(
  new URL("../app/procurement-workspace.tsx", import.meta.url),
  "utf8",
);
const procurementApiSource = await readFile(
  new URL("../app/api/procurement/route.ts", import.meta.url),
  "utf8",
);
const procurementLogicSource = await readFile(
  new URL("../lib/procurement.ts", import.meta.url),
  "utf8",
);
const myWorkLogicSource = await readFile(
  new URL("../lib/my-work.ts", import.meta.url),
  "utf8",
);
const operationalEmailSource = await readFile(
  new URL("../lib/operational-email.ts", import.meta.url),
  "utf8",
);
const qualitySource = await readFile(
  new URL("../app/quality-control.tsx", import.meta.url),
  "utf8",
);
const qualityApiSource = await readFile(
  new URL("../app/api/quality-control/route.ts", import.meta.url),
  "utf8",
);
const qualityLogicSource = await readFile(
  new URL("../lib/quality-control.ts", import.meta.url),
  "utf8",
);
const reviewSource = await readFile(
  new URL("../app/review-workspace.tsx", import.meta.url),
  "utf8",
);
const reviewApiSource = await readFile(
  new URL("../app/api/review/route.ts", import.meta.url),
  "utf8",
);
const reviewLogicSource = await readFile(
  new URL("../lib/template-review.ts", import.meta.url),
  "utf8",
);
const bidderPortalApiSource = await readFile(
  new URL("../app/api/vendor-portal/bids/route.ts", import.meta.url),
  "utf8",
);
const vendorPortalLogicSource = await readFile(
  new URL("../lib/vendor-portal.ts", import.meta.url),
  "utf8",
);
const accountsPayableSource = await readFile(
  new URL("../app/accounts-payable.tsx", import.meta.url),
  "utf8",
);
const ownerBillingSource = await readFile(
  new URL("../app/owner-billing.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const ownerInvoicePrintStyles = await readFile(
  new URL("../app/owner-billing-print.css", import.meta.url),
  "utf8",
);
const onboardingSource = await readFile(
  new URL("../app/employee-onboarding.tsx", import.meta.url),
  "utf8",
);
const onboardingApiSource = await readFile(
  new URL("../app/api/onboarding/route.ts", import.meta.url),
  "utf8",
);
const onboardingLogicSource = await readFile(
  new URL("../lib/onboarding.ts", import.meta.url),
  "utf8",
);
const myWorkSource = await readFile(
  new URL("../app/my-work.tsx", import.meta.url),
  "utf8",
);
const myWorkApiSource = await readFile(
  new URL("../app/api/my-work/route.ts", import.meta.url),
  "utf8",
);
const schemaSource = await readFile(
  new URL("../db/schema.ts", import.meta.url),
  "utf8",
);
const sessionApiSource = await readFile(
  new URL("../app/api/session/route.ts", import.meta.url),
  "utf8",
);
const accountingDataSource = await readFile(
  new URL("../app/accounting-data.ts", import.meta.url),
  "utf8",
);
const contactTemplateStats = await stat(
  new URL("../public/templates/Mefford_Contacts_Import_Template.xlsx", import.meta.url),
);
const scheduleTemplateStats = await stat(
  new URL("../public/templates/Mefford_Project_Schedule_Import_Template.xlsx", import.meta.url),
);

test("subcontract records are wired to their detail view", () => {
  const start = source.indexOf(') : active === "Subcontracts" ? (');
  const end = source.indexOf(') : active === "Review" ? (', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const subcontractBranch = source.slice(start, end);

  assert.match(subcontractBranch, /<SubcontractWorkspace/);
  assert.match(subcontractBranch, /onOpenRecord=\{\(record\) =>/);
  assert.match(
    subcontractBranch,
    /openRecordDetails\(record, "Subcontracts"\)/,
  );
});

test("workflow folders include the requested project sections", () => {
  for (const label of [
    "Project Owner Contract",
    "Subcontracts",
    "Change Orders",
    "Purchase Orders",
    "Owner Meetings",
    "Design Meetings",
    "Subcontractor Meetings",
    "Daily Logs",
    "Safety",
    "RFIs",
    "Submittals",
    "Schedule",
    "Selections",
  ]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
});

test("project overview surfaces stored Daily Log photos", () => {
  assert.match(source, /Recent Jobsite Photos/);
  assert.match(source, /dailyLogIdForPhoto\(file\)/);
  assert.match(source, /View All \{projectPhotos\.length\}/);
  assert.match(source, /Open Source Daily Log/);
});

test("Company Dashboard leads navigation and surfaces real executive decisions", () => {
  assert.match(source, /useState\("Dashboard"\)/);
  const navStart = source.indexOf('<nav className="main-nav"');
  const sidebarNav = source.slice(navStart, source.indexOf("</nav>", navStart));
  assert.ok(sidebarNav.indexOf('canActorAccessNavigation(sessionActor, "My Work")') < sidebarNav.indexOf('canActorAccessNavigation(sessionActor, "Dashboard")'));
  assert.match(sidebarNav, /<span>My Home<\/span>/);
  const catalog = source.slice(source.indexOf("const navigationTools:"), source.indexOf("const everydayTools ="));
  assert.ok(catalog.indexOf('target: "My Work"') < catalog.indexOf('target: "Dashboard"'));
  assert.ok(catalog.indexOf('target: "Dashboard"') < catalog.indexOf('target: "Project Health"'));
  assert.match(catalog, /canActorAccessNavigation\(sessionActor, tool.target\)/);
  assert.match(source, /Company Dashboard/);
  assert.match(source, /Action Queue/);
  assert.match(source, /Today Across Every Job/);
  assert.match(source, /Yesterday&apos;s Daily Logs/);
  assert.match(source, /dashboard-field-photo-grid/);
  assert.match(source, /record\.type === "Schedule"/);
  assert.match(source, /record\.recordDate === yesterday/);
  assert.doesNotMatch(source, /APPROVAL EXPOSURE/);
  assert.doesNotMatch(source, /Upcoming Milestones/);
  assert.doesNotMatch(source, /TODAY’S DECISION BRIEF/);
  assert.doesNotMatch(source, /Decision Accountability/);
  assert.match(source, /Lock The Original Project Budget/);
  assert.match(source, /Confirm Owner Contract Execution/);
  assert.match(source, /Establish The Baseline Schedule/);
  assert.match(source, /record\.type === "AP Invoice" && record\.status === "Owner Approval"/);
  assert.match(source, /item\.type === "Sales Opportunities"/);
  assert.match(source, /onOpenDecision\(decision\.project, decision\.target, decision\.recordId\)/);
  assert.match(source, /"MEFFORD-SALES"/);
  assert.match(source, /"MEFFORD-ACCOUNTING"/);
});

test("company navigation includes restricted Sales and Estimating workspaces", () => {
  assert.match(source, /label: "Sales"/);
  assert.match(source, /target: "Sales Contacts"/);
  assert.match(source, /target: "Sales Funnel"/);
  assert.match(source, /active === "Estimating"/);
  assert.match(source, /target === "Bid Management".*actor\.designations\.includes\("Estimator"\)/s);
  assert.match(source, /actor\.designations\.includes\("Estimator"\)/);
  assert.match(
    source,
    /actor\.designations\.includes\("Sales Representative"\)/,
  );
});

test("construction CRM provides a controlled estimating handoff", () => {
  for (const stage of [
    "New Lead",
    "Qualified Opportunity",
    "Estimating",
    "Proposal Submitted",
    "Negotiation",
    "Awarded",
  ]) {
    assert.match(salesSource, new RegExp(`"${stage.replace("/", "\\/")}"`));
  }
  assert.match(salesSource, /Send To Estimating/);
  assert.match(salesSource, /estimatingRequestedAt/);
  assert.doesNotMatch(salesSource, /Your Excel Will Become The Governing Estimate Input Layout/);
});

test("Sales records are protected by server-side role checks", () => {
  assert.match(recordsApiSource, /const SALES_PROJECT_ID = "MEFFORD-SALES"/);
  assert.match(recordsApiSource, /!authorization\.canAccessSales/);
  assert.match(recordsApiSource, /designations\.includes\("Estimator"\)/);
  assert.match(
    recordsApiSource,
    /designations\.includes\("Sales Representative"\)/,
  );
});

test("Contacts and direct estimates are wired to the estimating file workspace", () => {
  assert.ok(contactTemplateStats.size > 1000);
  assert.match(salesSource, /Download Contact Template/);
  assert.match(salesSource, /Import Contacts From Excel/);
  assert.match(salesSource, /parseSpreadsheetFile\(file, "contacts"\)/);
  assert.match(salesSource, /directEstimate: true/);
  assert.match(salesSource, /Create Estimate/);

  for (const folder of [
    "01-Due Diligence",
    "02-Design & Drawings",
    "04-Estimating - Cap Sheet",
    "06-Builders Risk & Bond Request",
    "07-Contract",
    "08-Permits",
    "09-Legal",
    "10-Post-Construction",
  ]) {
    assert.match(estimateWorkspaceSource, new RegExp(folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(estimateWorkspaceSource, /Live Mefford Estimate/);
  assert.match(estimateWorkspaceSource, /Individual Files Up To 1 GB/);
});

test("project award uses designated employee dropdowns", () => {
  assert.match(estimateEditorSource, /eligibleCompanyMembers\("Project Manager"\)/);
  assert.match(estimateEditorSource, /eligibleCompanyMembers\("Superintendent"\)/);
  assert.match(estimateEditorSource, /aria-label="Project Manager"/);
  assert.match(estimateEditorSource, /aria-label="Site Superintendent"/);
  assert.doesNotMatch(
    estimateEditorSource,
    /\["Project Manager", "projectManager", "text"\]/,
  );
});

test("sidebar sections are hidden and blocked by signed-in role designations", () => {
  assert.match(source, /function canActorAccessNavigation/);
  assert.match(source, /const visibleProjectNavFolders = navFolders/);
  assert.doesNotMatch(source, /const visibleProjectUtilityItems/);
  assert.match(source, /actor\.designations\.includes\("Superintendent"\)/);
  assert.match(source, /actor\.designations\.includes\("Office Staff"\)/);
  assert.match(source, /actor\.designations\.includes\("Attorney"\)/);
  assert.match(source, /This Section Is Not Available For Your Current Company Access And Project Designations/);
});

test("lost and awarded estimates leave the live queue and transfer their files", () => {
  assert.match(salesSource, /!\["Awarded", "Lost"\]\.includes\(data\.stage\)/);
  assert.match(recordsApiSource, /MEFFORD-BID-ARCHIVE/);
  assert.match(recordsApiSource, /Archived Lost Bid/);
  assert.match(awardApiSource, /Awarded Estimates/);
  assert.match(awardApiSource, /Awarded Estimate \/ /);
  assert.match(source, /Lost Estimates By Year/);
  assert.match(source, /archiveYears\.map/);
  assert.match(filesApiSource, /canAccessBidArchive/);
});

test("Sales Dashboard tracks goals awards and workbook-derived sales metrics", () => {
  assert.match(source, /target: "Sales Dashboard"/);
  assert.match(source, /target: "Sales Goals"/);
  assert.match(salesSource, /function defaultSalesGoal[\s\S]*return null/);
  assert.doesNotMatch(salesSource, /DEFAULT_2026_COMPANY_GOAL|DEFAULT_2026_HEATHER_GOAL/);
  assert.match(salesSource, /SALES_QUARTER_WEIGHTS = \[0\.1, 0\.35, 0\.4, 0\.15\]/);
  assert.match(salesSource, /Monthly Sales/);
  assert.match(salesSource, /Top Salespeople/);
  assert.match(salesSource, /Top Client Companies/);
  assert.match(salesSource, /GROSS PROFIT SOLD/);
  assert.match(awardApiSource, /managementHours/);
  assert.match(awardApiSource, /insuranceRevenue/);
  assert.match(awardApiSource, /technologyFee/);
  assert.match(awardApiSource, /awardedAt: now/);
});

test("Sales contacts and opportunities enforce the company-first CRM workflow", () => {
  assert.match(directorySource, /name: "Jordan Mefford"/);
  assert.match(directorySource, /name: "Blain Faulkner"/);
  assert.doesNotMatch(directorySource, /name: "Heather Frye"/);
  assert.match(directorySource, /eligibleCompanyMembers\(designation: string\)/);
  assert.match(salesSource, /Company Required/);
  assert.match(salesSource, /Primary Company/);
  assert.match(salesSource, /Company Contact/);
  assert.match(salesSource, /Save And Select Contact/);
  assert.match(salesSource, /Select A Lost Opportunity Reason Before Saving/);
  assert.match(salesSource, /Forecast Probability/);
  assert.match(recordsApiSource, /Only A Company Owner Can Set Company And Salesperson Goals/);
});

test("Accounting navigation is role restricted and separated from Administrator access", () => {
  assert.match(source, /label: "Accounting"/);
  for (const target of [
    "Accounting Command",
    "Chart Of Accounts",
    "Accounts Payable",
    "Owner Billing",
    "Cash Management",
    "Payroll Reports",
    "WIP And Close",
    "Financial Reports",
    "Vendor Management",
  ]) {
    assert.match(source, new RegExp(`target: "${target}"`));
  }
  assert.match(source, /actor\.designations\.includes\("Accountant"\)/);
  assert.match(source, /actor\.designations\.includes\("Financial Administrator"\)/);
  assert.match(recordsApiSource, /const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING"/);
  assert.match(recordsApiSource, /!authorization\.canAccessAccounting/);
});

test("Command Center Chart Of Accounts includes every verified opening account and the three inactive controls", () => {
  const accountRows = accountingDataSource.match(/^\d{3}\|/gm) ?? [];
  assert.equal(accountRows.length, 285);
  assert.match(accountingDataSource, /"103", "435", "655"/);
  assert.match(accountingSource, /Individual Account Review/);
  assert.match(accountingSource, /Approve Each Account Independently/);
  assert.match(accountingSource, /Approve Account/);
  assert.doesNotMatch(accountingSource, /Approve Imported Chart/);
  assert.match(accountingSource, /Account 1500 Suspense/);
  assert.match(accountingSource, /Account Number .* Already Exists/);
});

test("Command Center permanently replaces Sage and QuickBooks in active product language", () => {
  const productLanguage = `${accountingSource}\n${accountingDataSource}\n${onboardingLogicSource}`;
  assert.doesNotMatch(productLanguage, /\b(?:Sage|QuickBooks|Quickbook|QBO)\b/i);
  assert.match(accountingSource, /<GeneralLedgerWorkspace/);
  assert.match(accountingSource, /<AccountingControlWorkspace/);
  assert.match(onboardingLogicSource, /Command Center Accounting Access And Responsibilities/);
});

test("Accounting foundation carries the approved construction controls", () => {
  for (const phrase of [
    "Purchase Orders Above $10,000.00 Require Owner Approval",
    "Each Approved Change Order Appears Individually Below The Base Contract",
    "The Accountant Exclusively Manages Company And Project Cash Forecasts",
    "Project And Cost-Code Hours Remain Reporting Detail Only",
    "Owner-Only Reopen With Written Reason",
    "Blacklisted",
  ]) {
    assert.match(accountingSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Accounts Payable supports manual invoices balanced multi-project allocations and duplicate blocking", () => {
  for (const phrase of [
    "New Invoice",
    "Split Across Projects And Cost Codes",
    "Allocation Lines Must Equal The Complete Invoice Total",
    "Company Overhead",
    "Purchase Order",
    "Approved Change Order",
    "Direct Expense",
  ]) {
    assert.match(accountsPayableSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(accountsPayableSource, /Invoice Number .* Already Exists/);
  assert.match(recordsApiSource, /This Vendor Invoice Number Already Exists And Was Blocked As A Duplicate/);
  assert.match(recordsApiSource, /The Invoice And All Allocation Lines Must Be Complete And Balanced/);
});

test("Accounts Payable records recurring forecasts credit cards wires and expected payment batches", () => {
  for (const phrase of [
    "Recurring Payments",
    "No End Date",
    "Check Run Lead Days",
    "Ramp",
    "Chase",
    "Cardholder",
    "Wire Request Records",
    "Bank Confirmation Number",
    "Create Expected Batch",
    "No Payment Was Released",
    "Prepare Current AP",
    "prepareRecurringPayable",
    "cashFlowForecast: true",
    "accountsPayableProcessing: true",
    "recurringSourceId",
    "recurringOccurrenceDate",
    "preferredPaymentMethod",
  ]) {
    assert.match(accountsPayableSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(recordsApiSource, /Only A Company Owner Can Release A Payment Batch/);
  assert.match(recordsApiSource, /A Company Owner Must Approve Every Wire Request/);
  assert.doesNotMatch(accountsPayableSource, /Nothing (?:Posts|Is Posted) Or Pays Automatically/i);
  assert.match(accountsPayableSource, /\["Approved Unpaid", "Paid", "Voided", "Archived"\]\.includes\(row\.processingStatus\)/);
});

test("Invoice intake defers payment selection and learns vendors from project commitments", () => {
  for (const phrase of [
    "Choose Payment Method",
    "Matched Commitment",
    "Finding Existing Commitments",
    "Were Filled From The Project Commitment",
    "costAllocations",
    "suggestedVendor",
  ]) {
    assert.match(accountsPayableSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(accountsPayableSource, /paymentStatus: previousData\.paymentStatus \|\| "Unscheduled"/);
  assert.match(accountsPayableSource, /Only An Approved Unpaid Invoice Can Be Prepared For Payment/);

  const invoiceEntryStart = accountsPayableSource.indexOf('id="new-invoice-title"');
  const paymentPreparationStart = accountsPayableSource.indexOf("{paymentOpen ?", invoiceEntryStart);
  assert.ok(invoiceEntryStart > -1 && paymentPreparationStart > invoiceEntryStart);
  const invoiceEntrySource = accountsPayableSource.slice(invoiceEntryStart, paymentPreparationStart);
  assert.doesNotMatch(invoiceEntrySource, /<label className="field-label">Payment Method/);
  assert.doesNotMatch(invoiceEntrySource, /invoiceDraft\.paymentMethod/);
});

test("Owner Billing automates the approved monthly workflow without automatic distribution", () => {
  for (const phrase of [
    "Monthly Billing Engine",
    "Lock First Invoice Structure",
    "Project Management",
    "General Conditions",
    "Overhead & Profit",
    "Explicit Base Profit Only",
    "PM Preparation → Accountant Review → Owner Approval → Ready To Send",
    "Is Supporting Cost Documentation Required?",
    "External Distribution Required",
  ]) {
    assert.match(ownerBillingSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(ownerBillingSource, /calculateEstimateSummary/);
  assert.match(ownerBillingSource, /estimateSummary\?\.baseProfit/);
  assert.match(ownerBillingSource, /startsWith\("0131"\)/);
  assert.match(ownerBillingSource, /Math\.min\(5_000, supportedCost \* 0\.05\)/);
  assert.match(ownerBillingSource, /retainageInitialPercent/);
  assert.match(ownerBillingSource, /retainageAfterHalfPercent/);
  assert.match(ownerBillingSource, /completion > 0\.5 \? retainageAfterHalfRate : retainageInitialRate/);
  assert.match(ownerBillingSource, /alertRecipients: \[project\.projectManager, "Company Administrators", "Company Owners"\]/);
  assert.match(awardApiSource, /'Owner Billing Setup'/);
  assert.match(awardApiSource, /'Owner Action Required'/);
  assert.match(recordsApiSource, /A Company Owner Must Lock The First Owner Invoice Structure/);
  assert.match(recordsApiSource, /A Company Owner Must Finalize The Owner Invoice/);
  assert.match(recordsApiSource, /Resolve The Documentation Discrepancy Or Add An Owner Override Reason/);
});

test("Owner Billing keeps a complete live draft visible through every approval stage", () => {
  for (const phrase of [
    "Preview Owner Invoice",
    "Preview G702 / G703 Layout",
    "G702 / G703-Style Billing Draft",
    "Application And Certificate For Payment",
    "G702-Style Owner Billing Summary",
    "G703-Style Schedule Of Values",
    "Description Of Work",
    "From Previous Applications",
    "Live Unsaved Draft",
    "Original Contract Sum",
    "Net Change By Approved Change Orders",
    "Current Payment Due",
    "Balance To Finish Including Retainage",
    "The Same Billing Draft Remains Visible As It Moves Forward",
    "Page 1 · G702-Style",
    "Continuation · G703-Style",
    "DRAFT PREVIEW ONLY · NOT APPROVED OR DISTRIBUTED",
    "Print Landscape Draft",
    "Mefford Contracting Authorized Signature",
    "Notary Acknowledgment",
    "Notary Public Signature",
    "My Commission Expires",
    "D + E · Work Completed",
    "Mefford Contracting · Base Contract Schedule Of Values",
    "Approved Change Orders",
    "Base Contract Totals",
    "Change Order Totals",
  ]) {
    assert.match(ownerBillingSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(ownerBillingSource, /currentDraft\?\.status \|\| "PM Preparation"/);
  assert.match(ownerBillingSource, /Materials<br \/>Presently Stored/);
  assert.match(ownerBillingSource, /currentDraft\?\.status === "Ready To Send" \? "READY TO SEND"/);
  assert.match(ownerBillingSource, /approvalSteps = \["PM Preparation", "Accountant Review", "Owner Approval"\]/);
  assert.match(ownerBillingSource, /window\.print\(\)/);
  assert.match(stylesSource, /@page owner-invoice/);
  assert.match(stylesSource, /size: 11in 8\.5in/);
  assert.match(ownerInvoicePrintStyles, /page: owner-invoice/);
  assert.match(ownerInvoicePrintStyles, /body:has\(\.owner-invoice-preview\)[\s\S]*?display: none !important/);
  assert.match(ownerInvoicePrintStyles, /height: auto !important/);
  assert.match(ownerInvoicePrintStyles, /min-height: 0 !important/);
  assert.match(ownerInvoicePrintStyles, /break-inside: avoid-page/);
  assert.match(ownerInvoicePrintStyles, /page-break-inside: avoid/);
  assert.match(ownerInvoicePrintStyles, /display: table-header-group/);
  assert.doesNotMatch(ownerInvoicePrintStyles, /(?:min-|max-)?height: 8\.5in|position: absolute/);
  assert.match(stylesSource, /\.owner-invoice-g702/);
  assert.match(stylesSource, /"application certification"/);
  assert.match(stylesSource, /"change certificate"/);
  assert.match(ownerInvoicePrintStyles, /\.owner-invoice-g703 \{[\s\S]*?break-before: page/);
  assert.match(stylesSource, /\.owner-invoice-group-row/);
  assert.doesNotMatch(ownerBillingSource, /The PDF And Licensed AIA Export Will Be Added/);
});

test("web application raises the two smallest font tiers without changing invoice type", () => {
  assert.match(stylesSource, /:root \{[\s\S]*?--font-xxs: 0\.375rem;[\s\S]*?--font-xs: 0\.4375rem;/);
  assert.match(stylesSource, /font-size: var\(--font-xxs\)/);
  assert.match(stylesSource, /font-size: var\(--font-xs\)/);
  assert.match(stylesSource, /\.owner-invoice-page \{[\s\S]*?--font-xxs: 0\.3125rem;[\s\S]*?--font-xs: 0\.375rem;/);
});

test("Employee onboarding gates dormant and annually expired permissions until Administrator verification and Owner approval", () => {
  assert.match(source, /label: "Admin"/);
  assert.match(source, /target: "Admin People"/);
  assert.match(adminSource, /"Employee Onboarding"/);
  assert.match(source, /if \(actor\.permissionLocked\) return target === "Employee Portal"/);
  assert.match(source, /if \(target === "Employee Onboarding"\) return \["Company Owner", "Administrator"\]\.includes\(actor\.accessLevel\)/);
  assert.match(sessionApiSource, /if \(onboarding\.permissionLocked\) designations = \[\]/);
  assert.match(onboardingLogicSource, /status = "Locked For Annual Renewal"/);
  assert.match(onboardingLogicSource, /allComplete \? "Ready For Activation" : "Onboarding Required"/);
  assert.match(onboardingLogicSource, /status = "Ready For Reactivation"/);
  assert.match(onboardingLogicSource, /\{ status: 423 \}/);
  assert.match(onboardingApiSource, /Administrator Verified Onboarding/);
  assert.match(onboardingApiSource, /Company Owner Access Approval Remains Required/);
  assert.match(onboardingApiSource, /Seven-Day Annual Renewal Extension Granted/);
  assert.match(onboardingApiSource, /Access Terminated Immediately/);
  assert.match(onboardingSource, /DORMANT ACCESS UNTIL APPROVED/);
  assert.match(onboardingSource, /Future Roles · Dormant Until Owner Activation/);
  assert.match(onboardingSource, /Verify Onboarding Complete/);
  assert.match(onboardingSource, /Approve Command Center Access/);
});

test("Employee onboarding carries the approved anniversary reminders and role-based annual requirements", () => {
  for (const phrase of [
    "Mefford Employee Handbook",
    "Annual Workplace Safety Training",
    "Annual Safety Knowledge Check",
    "Field Safety Orientation",
    "Financial Security And Privacy",
    "Document And Signature",
    "In-Person Acknowledgement",
    "Safety Reviewer",
    "Attorney",
  ]) {
    assert.match(onboardingLogicSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(onboardingApiSource, /In-App At 30 14 And 7 Days Then Daily Through The Deadline/);
  assert.match(onboardingSource, /Thirty Days Before Anniversary/);
  assert.match(onboardingSource, /Daily Countdown Begins/);
  assert.match(onboardingApiSource, /Administrator May Grant One Documented Extension Up To Seven Days/);
});

test("Item 1 provides a durable personal queue with approved delivery and escalation controls", () => {
  assert.match(source, /active === "My Work"[\s\S]*?<EmployeePortalWorkspace/);
  assert.match(source, /target: "My Work", label: "My Work"/);
  assert.match(onboardingSource, /<MyWorkWorkspace/);
  assert.match(myWorkSource, /My Tasks/);
  assert.match(myWorkSource, /workActionLabel\(item\)/);
  assert.match(myWorkSource, /nextWorkStep\(item\)/);
  assert.match(myWorkSource, /Details &amp; History/);
  assert.match(myWorkSource, /6:00 AM local summary/);
  assert.match(myWorkSource, /Acknowledge/);
  assert.match(myWorkSource, /Snooze/);
  assert.match(myWorkSource, /item.auditHistory.map/);
  assert.match(myWorkApiSource, /Operational Notices Only/);
  assert.match(myWorkApiSource, /No Invoice Is Automatically Sent Or Posted/);
  assert.match(myWorkLogicSource, /dedupeKey/);
  assert.match(myWorkLogicSource, /48-Hour Direct Escalation/);
  assert.match(myWorkLogicSource, /72-Hour Manager Escalation/);
  assert.match(myWorkLogicSource, /96-Hour Owner\/Admin Escalation/);
  assert.match(myWorkLogicSource, /sendMorningWorkDigests/);
  assert.match(myWorkLogicSource, /quietHoursEnabled/);
  assert.match(operationalEmailSource, /attachments: input\.attachments \|\| \[\]/);
  assert.match(operationalEmailSource, /Provider Accepted/);
  assert.match(myWorkLogicSource, /sendInvoice: false/);
  assert.match(schemaSource, /command_work_items/);
  assert.match(schemaSource, /notification_delivery_events/);
  assert.match(schemaSource, /work_item_audits/);
});

test("Employee onboarding is controlled by the uploaded Mefford checklist stages and signoffs", () => {
  for (const phrase of [
    "Before The Employee Starts",
    "First Day · Company And Role Orientation",
    "Safety Orientation",
    "Systems Documentation And Communication",
    "Role-Specific Training And Expectations",
    "Office Employee Addendum",
    "Field Employee Addendum",
    "End Of First Week",
    "30/60/90-Day Follow-Up",
    "Supervisor Review Notes",
    "Acknowledgment And Signoff",
  ]) {
    assert.match(onboardingLogicSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(onboardingLogicSource, /blocksActivation/);
  assert.match(onboardingLogicSource, /dueOffsetDays/);
  assert.match(onboardingApiSource, /Supervisor Verification/);
  assert.match(onboardingApiSource, /Must Verify This Checklist Item/);
  assert.match(onboardingSource, /Work Location Or Project/);
  assert.match(onboardingSource, /Checklist Owner/);
  assert.match(onboardingSource, /30-DAY REVIEW/);
  assert.match(source, /active === "Employee Portal"/);
  assert.match(source, />My Work<\/button>/);
  assert.doesNotMatch(source, /label: "My Employee Home", target: "Employee Portal"/);
  assert.match(source, /Search projects, records, and tools/);
  assert.doesNotMatch(source, /Global project search is coming next/);
  assert.doesNotMatch(onboardingSource, /LEGAL REVIEW MASTER TEMPLATE/);
  assert.match(onboardingSource, /Upload New Version/);
  assert.match(onboardingSource, /Permanent Version History/);
  assert.match(onboardingApiSource, /attach_requirement_content/);
  assert.match(onboardingApiSource, /publish_requirement_content/);
  assert.match(onboardingApiSource, /status: "Pending Review" as const/);
  assert.match(onboardingApiSource, /reviewNote/);
  assert.match(onboardingSource, /Record \{requirement\.reviewer\} Approval/);
  assert.match(filesApiSource, /projectId !== "MEFFORD-PEOPLE"/);
});

test("Project schedule supports controlled Excel round trips and a Mefford print sheet", () => {
  assert.ok(scheduleTemplateStats.size > 1000);
  assert.match(source, /Download Excel/);
  assert.match(source, /Re-Upload Excel/);
  assert.match(source, /Print Schedule/);
  assert.match(source, /Schedule Import/);
  assert.match(source, /Project Information/);
  assert.match(source, /Subcontractors/);
  assert.match(source, /record\.data\?\.subcontractor \|\| record\.title/);
  assert.match(source, /Is Not An Approved Subcontractor On/);
  assert.match(source, /Duplicate Activity IDs Were Blocked/);
  assert.match(source, /Scope Of Work/);
  assert.match(source, /Start Date/);
  assert.match(source, /Finish Date/);
  assert.match(source, /className="schedule-print-sheet"/);
  assert.match(source, /src="\/mefford-logo\.png"/);
  assert.match(source, /Date Updated/);
  assert.match(source, /Project #\{project\.number\}/);
});

test("Item 2 provides email invite and one-time-code vendor access", () => {
  assert.match(accountingSource, /<VendorManagementWorkspace actor=\{actor\}/);
  assert.match(source, /search\.get\("vendorPortal"\)/);
  assert.match(source, /<VendorPortal inviteId=\{externalVendorInviteId\}/);
  assert.match(vendorManagementSource, /Email Invite \+ One-Time Code/);
  assert.match(vendorsApiSource, /Site's Existing Custom Access Policy/);
  assert.doesNotMatch(vendorPortalApiSource, /oai-authenticated-user-email|getCommandActor/);
  assert.match(vendorPortalApiSource, /row\.attempts >= 5/);
  assert.match(vendorPortalApiSource, /8 \* 3_600_000/);
  assert.match(vendorPortalLogicSource, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(schemaSource, /code_hash/);
  assert.match(schemaSource, /session_hash/);
});

test("Item 2 keeps project work moving and applies missing compliance as a payment-only hold", () => {
  for (const requirement of ["W-9", "General Liability", "Workers Compensation", "Auto Liability"]) {
    assert.match(vendorPortalLogicSource, new RegExp(requirement));
  }
  assert.match(vendorPortalLogicSource, /paymentBlocked = incomplete && !activeOverride/);
  assert.match(vendorPortalLogicSource, /projectBlocked: false/);
  assert.match(vendorsApiSource, /Only A Company Owner Can Override Missing Or Expired Compliance/);
  assert.match(vendorsApiSource, /A Specific Reason And Future Expiration Are Required/);
  assert.match(vendorsApiSource, /Owner Compliance Override/);
  assert.match(vendorManagementSource, /Vendor Payment Hold Active/);
  assert.match(recordsApiSource, /Vendor Payment Hold/);
  assert.doesNotMatch(recordsApiSource, /Subcontract Release Hard Block/);
  assert.match(recordsApiSource, /Create And Onboard This Subcontractor In Vendor Management Before Contract Release/);
  assert.match(vendorManagementSource, /Permanent Vendor Audit/);
  assert.match(schemaSource, /vendor_compliance_overrides/);
  assert.match(schemaSource, /vendor_audits/);
});

test("temporary vendor approval is the sole owner override exempt from Face ID", () => {
  assert.match(vendorManagementSource, /data-biometric-exempt="vendor-temporary-approval"/);
  assert.match(vendorManagementSource, /Temporarily Approve Vendor/);
  assert.match(vendorManagementSource, /endTemporaryApproval/);
  assert.match(vendorsApiSource, /Owner Compliance Override · No Face ID/);
  assert.match(vendorsApiSource, /Authenticated Company Owner session/);
  assert.match(vendorsApiSource, /Temporary Vendor Approval Ended/);
  assert.match(vendorsApiSource, /biometricRequired: false/);
  assert.match(mobileSource, /button\.dataset\.biometricExempt === "vendor-temporary-approval"/);
});

test("Item 2 accepts standard invoices and AIA-style pay applications into controlled AP review", () => {
  assert.match(vendorPortalSource, /"Invoice" \| "AIA Pay Application"/);
  assert.match(vendorPortalSource, /CALCULATED CURRENT PAYMENT DUE/);
  assert.match(vendorPortalApiSource, /aiaCurrentPayment/);
  assert.match(vendorPortalApiSource, /That Invoice Or Application Number Already Exists/);
  assert.match(vendorsApiSource, /status: "Project Review"/);
  assert.match(vendorsApiSource, /Duplicate AP Hard Block/);
  assert.match(vendorsApiSource, /Nothing was approved, posted, or paid automatically/);
  assert.match(vendorManagementSource, /Route To AP Project Review/);
  assert.match(schemaSource, /vendor_submissions/);
  assert.match(myWorkLogicSource, /vendor-submission:/);
  assert.match(myWorkLogicSource, /actionTarget: "Vendor Management"/);
});

test("Item 2 stores vendor files privately and blocks final AP handoff until closeout is approved", () => {
  assert.match(vendorPortalFilesSource, /vendors\/\$\{session\.vendorId\}/);
  assert.match(vendorPortalFilesSource, /Pending Review/);
  assert.match(vendorPortalFilesSource, /storedFileResponseHeaders/);
  assert.match(vendorPortalFilesSource, /25 \* 1024 \* 1024/);
  for (const closeout of ["Final Lien Waiver", "Warranty", "O&M Manuals", "As-Built Drawings"]) {
    assert.match(vendorPortalLogicSource, new RegExp(closeout.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(vendorsApiSource, /Final Payment Hard Block/);
  assert.match(vendorPortalSource, /Least-Privilege Portal/);
  assert.match(vendorPortalSource, /No internal markup, project budgets, other vendor data/);
});

test("Item 3 gives RFIs and Submittals a dedicated controlled workspace", () => {
  assert.match(source, /<ProjectCorrespondenceWorkspace/);
  assert.match(source, /active === "RFIs" \|\| active === "Submittals"/);
  assert.match(correspondenceSource, /CONTROLLED PROJECT CORRESPONDENCE/);
  assert.match(correspondenceSource, /setup\?\.permissions\.canInitiate/);
  assert.match(correspondenceApiSource, /Only A Project Manager May Issue Or Send Formal Correspondence/);
  assert.doesNotMatch(correspondenceSource, /correspondence-control-strip/);
});

test("Item 3 enforces superintendent and PM initiation with PM-only issuance", () => {
  assert.match(correspondenceApiSource, /Only A Project Manager Or Site Superintendent May Initiate This Record/);
  assert.match(correspondenceApiSource, /Only A Project Manager May Issue Or Send Formal Correspondence/);
  assert.match(correspondenceApiSource, /isAssignedSuper/);
  assert.match(correspondenceApiSource, /projectDesignationsFor\(db, actor, project, designations\)/);
  assert.match(correspondenceApiSource, /projectRoles\.includes\("Superintendent"\)/);
  assert.match(correspondenceApiSource, /projectRoles\.includes\("Project Manager"\)/);
  assert.match(correspondenceApiSource, /Recorded Manual Transmission/);
  assert.match(correspondenceApiSource, /Operational Email Was Not Accepted By A Provider/);
});

test("Item 3 requires cost and schedule impact and creates linked controls", () => {
  assert.match(correspondenceSource, /Cost Impact/);
  assert.match(correspondenceSource, /Schedule Impact/);
  assert.match(correspondenceApiSource, /Response Cost Impact And Schedule Impact Are Required/);
  assert.match(correspondenceLogicSource, /autoCreatedFromImpact: true/);
  assert.match(correspondenceLogicSource, /approvalStatus: "Unapproved Exposure"/);
  assert.match(correspondenceLogicSource, /schedule-risk:/);
  assert.match(correspondenceLogicSource, /actionTarget: "Schedule"/);
  assert.match(correspondenceLogicSource, /No cost was approved or posted/);
});

test("An RFI can directly initiate a linked unapproved change order", () => {
  assert.match(correspondenceSource, /Initiate Linked Change Order/);
  assert.match(correspondenceApiSource, /input\.action === "initiate-change-order"/);
  assert.match(correspondenceApiSource, /Only A Project Manager Or Site Superintendent May Initiate A Change Request From An RFI/);
  assert.match(correspondenceApiSource, /Linked unapproved change exposure/);
  assert.match(correspondenceLogicSource, /changeExposureId = `PCO-\$\{recordId\}`/);
});

test("Item 3 vendor collaboration is least-privilege response-only intake", () => {
  assert.match(vendorPortalSource, /Assigned RFIs And Submittals/);
  assert.match(vendorPortalSource, /You cannot issue new formal records from this portal/);
  assert.match(vendorPortalApiSource, /submit-correspondence-response/);
  assert.match(vendorPortalApiSource, /This Record Was Not Shared With Your Company/);
  assert.match(vendorPortalApiSource, /String\(data\.vendorId \|\| ""\) !== vendor\[0\]\.id/);
  assert.match(vendorPortalFilesSource, /uploadType === "Collaboration"/);
  assert.match(vendorPortalApiSource, /Formal distribution remains with the Mefford Project Manager/);
});

test("Item 4 spans sales concepts through project Current Set and record drawings", () => {
  assert.match(source, /label: "Sales Design"/);
  assert.match(source, /label: "Design & Drawings"/);
  assert.match(source, /<DesignLifecycleWorkspace scope="Sales"/);
  assert.match(source, /scope="Project"/);
  for (const phrase of ["Floor Plan / Rendering", "Pricing Basis", "Estimate Folder", "Multidiscipline Design", "PM Current Set", "Record / As-Built"]) {
    assert.match(designLifecycleSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Item 4 award locks the Basis of Sale and copies packages and team forward", () => {
  assert.match(awardApiSource, /Basis Of Sale Locked/);
  assert.match(awardApiSource, /immutableSnapshot/);
  assert.match(awardApiSource, /Project Working Copy Created/);
  assert.match(awardApiSource, /Design Team Snapshot Locked/);
  assert.match(awardApiSource, /Project Design Team Working Copy Created/);
  assert.match(awardApiSource, /sourceSalesDesignTeamId/);
  assert.match(designLifecycleApiSource, /The Awarded Basis Of Sale Is Immutable/);
  assert.match(designLifecycleApiSource, /workingCopyNeverOverwritesSnapshot: true/);
});

test("Item 4 establishes the contracted design team from vendors with checklist and subcontract linkage", () => {
  for (const discipline of ["Architecture", "MEP", "Structural", "Civil", "Miscellaneous"]) {
    assert.match(designLifecycleLogicSource, new RegExp(`"${discipline}"`));
  }
  assert.match(designLifecycleSource, /Select From Vendor Directory/);
  assert.match(designLifecycleSource, /Under Contract/);
  assert.match(designLifecycleSource, /Standard Design Expectations/);
  assert.match(designLifecycleApiSource, /initiate-designer-subcontract/);
  assert.match(designLifecycleApiSource, /linkedDesignTeamAssignmentId/);
  assert.match(operationalEmailSource, /operational-notification-only/);
  assert.match(designLifecycleApiSource, /executeContract: false/);
  assert.match(source, /linkedDesignerVendorId/);
});

test("Item 4 gives assigned designers secure upload and review without Current Set authority", () => {
  assert.match(vendorPortalSource, /Upload New Design Revision/);
  assert.match(vendorPortalSource, /Submit Permanent Revision To Mefford/);
  assert.match(vendorPortalApiSource, /submit-design-revision/);
  assert.match(vendorPortalApiSource, /Controlled Design Upload Access Is Required/);
  assert.match(vendorPortalApiSource, /Consultant Upload Received/);
  assert.match(vendorPortalFilesSource, /Design Revision/);
  assert.match(vendorPortalFilesSource, /Controlled Design Team/);
  assert.match(vendorPortalSource, /Designer approval still requires a separate PM release/);
});

test("Item 4 permits only PM release after designer approval and links impact exposure", () => {
  assert.match(designLifecycleApiSource, /Only A Project Manager May Release The Official Current Set/);
  assert.match(designLifecycleApiSource, /Designer Approval Is Required Before PM Release/);
  assert.match(designLifecycleApiSource, /Approved As Noted/);
  assert.match(designLifecycleApiSource, /automaticContractChange: false/);
  assert.match(vendorPortalApiSource, /createCorrespondenceImpactActions/);
  assert.match(vendorPortalApiSource, /recordType: "Design Packages"/);
  assert.match(designLifecycleApiSource, /pm-current-set/);
  assert.match(designLifecycleSource, /No contract amount or schedule date changes automatically/);
});

test("Item 5 provides Sales and project procurement with PM and Estimator controls", () => {
  assert.match(source, /active === "Bid Management"/);
  assert.match(source, /active === "Procurement"/);
  assert.match(source, /<ProcurementWorkspace scope="Sales"/);
  assert.match(procurementApiSource, /designations\.includes\("Estimator"\)/);
  assert.match(procurementApiSource, /projectDesignationsFor\(db, actor, project, designations\)\)\.includes\("Project Manager"\)/);
  assert.doesNotMatch(procurementSource, /procurement-controls/);
  assert.match(procurementSource, /approve-coverage-exception/);
  assert.match(procurementSource, /New Bid Package/);
});

test("Item 5 preserves confidential bidder revisions questions addenda and acknowledgments forever", () => {
  assert.match(vendorPortalSource, /Confidential Bid Workspace/);
  assert.match(vendorPortalSource, /no bidder can see a competitor/i);
  assert.match(bidderPortalApiSource, /supersededByRevisionId/);
  assert.match(bidderPortalApiSource, /prior versions remain permanent/);
  assert.match(procurementApiSource, /Anonymized Bidder Answer Published/);
  assert.match(procurementApiSource, /acknowledgment required from every bidder/);
  assert.match(vendorPortalFilesSource, /Permanent Bid File Uploaded/);
  assert.match(vendorPortalFilesSource, /Confidential Procurement · Mefford And Submitting Bidder Only/);
});

test("Item 5 enforces deadline coverage leveling and Company Owner award gates without a compliance work stoppage", () => {
  assert.match(bidderPortalApiSource, /The Bid Deadline Is Locked/);
  assert.match(procurementApiSource, /Only A PM May Reopen Locked Bidding/);
  assert.match(procurementApiSource, /Three Responsive Bids Or An Owner-Approved Coverage Exception Is Required/);
  assert.match(procurementApiSource, /Scope Exclusions Alternates Clarifications And Budget Comparison Must Be Leveled/);
  assert.doesNotMatch(procurementApiSource, /Award Compliance Hard Block/);
  assert.doesNotMatch(procurementApiSource, /award remains blocked/);
  assert.match(procurementApiSource, /awardCompliance: "Allowed; Payment Hold Only"/);
  assert.match(procurementApiSource, /Vendor payment hold remains/);
  assert.match(procurementApiSource, /Every Bid Award Requires The Company Owner/);
  assert.match(procurementLogicSource, /coverageException\?\.approvedAt/);
});

test("Item 5 creates only a PM-confirmed linked draft subcontract or PO", () => {
  assert.match(procurementLogicSource, /Material Or Equipment Only/);
  assert.match(procurementApiSource, /The PM Must Confirm The Resulting Commitment Type/);
  assert.match(procurementApiSource, /recordType = commitmentType === "Subcontract" \? "Subcontracts" : "Purchase Orders"/);
  assert.match(procurementApiSource, /status: "Draft"/);
  assert.match(procurementApiSource, /automaticDistribution: false/);
  assert.match(procurementApiSource, /Nothing sent or executed/);
});

test("Item 5 carries the complete procurement record and existing estimating files into award", () => {
  assert.match(awardApiSource, /salesBidPackages/);
  assert.match(awardApiSource, /immutableSalesSnapshot/);
  assert.match(awardApiSource, /Project Procurement Record Created/);
  assert.match(awardApiSource, /complete permanent procurement record/);
  assert.match(awardApiSource, /transferEstimateFiles/);
  assert.match(awardApiSource, /Awarded Estimate \/ /);
  assert.match(procurementLogicSource, /03-Estimating - Quotes/);
});

test("owner project award prepares exact selected-bid commitment drafts for PM buyout", () => {
  assert.match(procurementLogicSource, /selectedProposalBid/);
  assert.match(awardApiSource, /selectedProposalBid\(packageData\)/);
  assert.match(awardApiSource, /packageData\.commitmentType \|\| packageData\.commitmentRecommendation/);
  assert.match(awardApiSource, /basis\.estimateLineKey \|\| packageData\.costCode/);
  assert.match(awardApiSource, /sourceBidRevisionId: bid\.id/);
  assert.match(awardApiSource, /sourceQuoteFileId: bid\.fileId/);
  assert.match(awardApiSource, /exclusions: bid\.exclusions/);
  assert.match(awardApiSource, /alternates: bid\.alternates/);
  assert.match(awardApiSource, /allowances: bid\.allowances/);
  assert.match(awardApiSource, /clarifications: bid\.clarifications/);
  assert.match(awardApiSource, /preparedFromOwnerProjectAward: true/);
  assert.match(awardApiSource, /awardDecision: "PM Decision Required"/);
  assert.match(awardApiSource, /automaticDistribution: false/);
  assert.match(awardApiSource, /no subcontractor award, release, distribution, or execution occurred/i);
});

test("the assigned PM can permanently record Do Not Award without sending the prepared draft", () => {
  assert.match(procurementApiSource, /decline-prepared-commitment/);
  assert.match(procurementApiSource, /The Assigned PM Must Make This Buyout Decision/);
  assert.match(procurementApiSource, /Only An Unreleased Draft Can Be Marked Do Not Award/);
  assert.match(procurementApiSource, /status: "Do Not Award"/);
  assert.match(procurementApiSource, /automaticDistribution: false/);
  assert.match(procurementSource, /Do Not Award This Contractor/);
  assert.match(source, /markPreparedDraftDoNotAward/);
  assert.match(source, /preparedFromOwnerProjectAward/);
  assert.match(myWorkLogicSource, /"PM Award Decision"/);
  assert.match(myWorkLogicSource, /"Buyout - Do Not Award"/);
});

test("Item 6 digitizes every uploaded pre-work checklist into one standard form structure", () => {
  for (const checklist of [
    "Pre-Above Ceiling Meeting",
    "Pre-Concrete Meeting",
    "Pre-Crane Meeting",
    "Pre-Demo Meeting",
    "Pre-Drywall Meeting",
    "Pre-Fire Sprinkler Meeting",
    "Pre-Floor Meeting",
    "Pre-Framing Meeting",
    "Pre-Grading / Utilities / Paving / Landscaping Meeting",
    "Pre-Masonry Meeting",
    "Pre-Painting Meeting",
    "Pre-Roof Meeting",
    "Pre-Trenching / Excavation Checklist",
    "Pre-Window / Door Installation",
    "Pre-Fireproofing Checklist",
    "Pre-Metal Building Checklist",
  ]) {
    assert.match(qualityLogicSource, new RegExp(checklist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(reviewLogicSource, /STANDARD_QUALITY_FORM_STRUCTURE/);
  assert.match(reviewLogicSource, /Grouped Required Responses With Yes, No, Or Justified N\/A/);
  assert.match(reviewLogicSource, /Before Evidence, After Evidence, Notes, And Linked Deficiencies/);
  assert.match(qualitySource, /"Template Library"/);
});

test("Item 6 requires a quality category on every schedule activity and creates the Superintendent prompt", () => {
  assert.match(source, /Required Quality Category/);
  assert.match(recordsApiSource, /Every Schedule Activity Requires A Valid Quality Category/);
  assert.match(recordsApiSource, /syncScheduleQualityRequest/);
  assert.match(recordsApiSource, /Superintendent Action Required/);
  assert.match(recordsApiSource, /Schedule Quality Automation/);
  assert.match(qualitySource, /Complete or qualified override/);
  assert.match(qualityApiSource, /Override Requires The Alternate Full-Scope Checklist Or Meeting Trade Past Completion Date Specific Reason And Superintendent Attestation/);
  assert.match(qualityApiSource, /overrideAttestation/);
  assert.match(qualityApiSource, /recordAudits/);
});

test("Item 6 controls deficiencies through trade correction Superintendent verification and PM or designer acceptance", () => {
  assert.match(qualityApiSource, /PM or Superintendent formal initiation/);
  assert.match(qualityApiSource, /submit-quality-correction|Verification Requested/);
  assert.match(qualityApiSource, /superintendent-verify/);
  assert.match(qualityApiSource, /pm-accept/);
  assert.match(qualityApiSource, /requiresDesignerAcceptance/);
  assert.match(vendorPortalSource, /Submit Trade Correction/);
  assert.match(vendorPortalSource, /Designer Acceptance/);
  assert.match(vendorPortalApiSource, /submit-quality-proposal/);
  assert.match(vendorPortalApiSource, /submit-quality-correction/);
  assert.match(vendorPortalApiSource, /submit-quality-designer-acceptance/);
  assert.match(vendorPortalFilesSource, /Quality Evidence/);
});

test("Item 6 warns progress billing blocks final payment and moves open items into closeout", () => {
  assert.match(vendorPortalLogicSource, /openQualityItems/);
  assert.match(vendorPortalSource, /OPEN QUALITY WARNING/);
  assert.match(vendorPortalSource, /FINAL PAYMENT QUALITY BLOCK/);
  assert.match(vendorPortalApiSource, /input\.finalApplication \? qualityAndCloseout/);
  assert.match(vendorPortalApiSource, /closeout\.blocked/);
  assert.match(qualityApiSource, /closeoutTracking/);
  assert.match(qualitySource, /Punch & Closeout/);
  assert.match(qualitySource, /final punch tracking/);
});

test("Review Center is company-level and controls all department master versions plus annual Owner signoff", () => {
  assert.match(source, /label: "Template Review", target: "Admin Templates"/);
  assert.match(source, /<AdminCommandWorkspace/);
  assert.match(source, /"Review",\n\s+"Sales Dashboard"/);
  assert.match(reviewSource, /Company Review Center/);
  assert.match(reviewSource, /Template Inventory/);
  assert.match(reviewSource, /Benefits Carrier & Employee Access/);
  assert.match(reviewSource, /Open Current Master/);
  assert.match(reviewSource, /Upload New Version/);
  assert.match(reviewSource, /Permanent File Version History/);
  assert.match(reviewSource, /\/api\/files\?id=/);
  assert.match(reviewLogicSource, /PREWORK_QUALITY_TEMPLATES\.map/);
  for (const category of ["Human Resources", "Benefits", "Safety", "Quality Control", "Sales & Estimating", "Accounting", "Legal & Contracts", "Closeout"]) {
    assert.match(reviewLogicSource, new RegExp(`"${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(reviewApiSource, /designations\.includes\("Human Resources"\)/);
  assert.match(reviewApiSource, /designations\.includes\("Benefits Administrator"\)/);
  assert.match(reviewApiSource, /uploadAreas/);
  assert.match(reviewApiSource, /upload-version/);
  assert.match(reviewApiSource, /BUCKET\.put/);
  assert.match(reviewApiSource, /projectFiles/);
  assert.match(reviewApiSource, /Owner signoff remains a separate required action/);
  assert.match(reviewApiSource, /Already Has A Locked/);
  assert.match(reviewApiSource, /priorVersionsRetained: true/);
  assert.match(reviewApiSource, /nextReviewDate: addReviewYear/);
  assert.match(reviewApiSource, /Annual Owner Signoff/);
  assert.match(filesApiSource, /REVIEW_PROJECT_ID/);
  assert.match(filesApiSource, /canAccessReviewCenter/);
  assert.match(myWorkLogicSource, /Complete \$\{reviewYear\} Owner Template Review/);
});
