import { currentAccountNumber, normalizeAccountReferences } from "../../../lib/accounting-numbering";
import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, projects, recordAudits } from "../../../db/schema";
import { ASSET_ACCOUNTING_STATUSES, ASSET_BOOK_METHODS, ASSET_BOOK_TREATMENTS, ASSET_CATEGORIES, ASSET_PROJECT_ID, ASSET_RECORD_TYPE, ASSET_STATUSES, ASSET_TAX_TREATMENTS, assetAccountingValues, assetAlerts, parseAssetData, reconcileAssetReadiness } from "../../../lib/asset-tracking";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { photoUploadContentType, storedFileResponseHeaders } from "../../../lib/photo-uploads";
import { roundMoney } from "../../../lib/money";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PROFILE_FIELDS = ["assetTag", "category", "description", "make", "model", "year", "vin", "serialNumber", "licensePlate", "ownership", "department", "homeLocation", "currentLocation", "meterType", "currentMeter", "acquisitionDate", "acquisitionCost", "internalRate", "costCode", "nextServiceDate", "nextServiceMeter", "registrationExpiry", "insuranceExpiry", "inspectionExpiry", "warrantyExpiry", "trackerId"] as const;
const ACCOUNTING_FIELDS = ["accountingStatus", "bookTreatment", "bookMethod", "placedInServiceDate", "usefulLifeYears", "salvageValue", "accumulatedBookDepreciation", "impairmentAmount", "taxTreatment", "taxYear", "businessUsePercent", "section179Amount", "bonusDepreciationAmount", "accumulatedTaxDepreciation", "assetAccountNumber", "assetAccountName", "accumulatedDepreciationAccountNumber", "accumulatedDepreciationAccountName", "depreciationExpenseAccountNumber", "depreciationExpenseAccountName", "offsetAccountNumber", "offsetAccountName", "accountingNotes"] as const;
const FINANCIAL_FIELDS = new Set(["acquisitionCost", "currentBookValue", "internalRate", ...ACCOUNTING_FIELDS, "accountingHistory", "accountingJournalDrafts", "taxBasis", "remainingTaxBasis", "annualBookDepreciation"]);
const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";

type AssetInput = Record<string, unknown> & { action?: string; assetId?: string };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const { getDb } = await import("../../../db");
  const db = getDb();
  await ensureProjectFileSchema();
  const access = await resolveAccess(db, actor);
  if (!access.canView) return Response.json({ error: "Assets And Fleet Access Is Required" }, { status: 403 });

  const fileId = Number(new URL(request.url).searchParams.get("fileId"));
  if (Number.isInteger(fileId) && fileId > 0) {
    const fileRows = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, ASSET_PROJECT_ID), eq(projectFiles.id, fileId))).limit(1);
    if (!fileRows[0]) return Response.json({ error: "Asset Document Not Found" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(fileRows[0].storageKey);
    if (!object) return Response.json({ error: "Asset Document Content Is Unavailable" }, { status: 404 });
    return new Response(object.body, { headers: storedFileResponseHeaders({ name: fileRows[0].name, contentType: fileRows[0].contentType, sizeBytes: fileRows[0].sizeBytes }) });
  }

  const [rows, audits, files, members, projectRows, telematicsConnection] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.recordType, ASSET_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, ASSET_PROJECT_ID)).orderBy(desc(recordAudits.id)),
    db.select().from(projectFiles).where(eq(projectFiles.projectId, ASSET_PROJECT_ID)).orderBy(desc(projectFiles.id)),
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(projects).orderBy(projects.number),
    db.select({ status: commandRecords.status }).from(commandRecords).where(and(eq(commandRecords.projectId, "MEFFORD-COMPANY"), eq(commandRecords.id, "INTEGRATION-FLEET-GPS-TELEMATICS"))).limit(1),
  ]);
  const assets = rows.map((row) => {
    const data = parseAssetData(row.dataJson);
    data.telematicsStatus = telematicsConnection[0]?.status === "Connected" ? "Connected" : "Not Connected";
    if (data.telematicsStatus !== "Connected") { data.geofenceStatus = "Not Configured"; data.lastSeenAt = ""; }
    if (!access.canSeeCosts) for (const field of FINANCIAL_FIELDS) delete data[field];
    return {
      id: row.id, title: row.title, status: row.status, owner: row.owner, due: row.due, meta: row.meta, createdAt: row.createdAt, updatedAt: row.updatedAt,
      data,
      alerts: assetAlerts({ ...row, data }),
      files: files.filter((file) => file.revision === row.id).map(clientFile),
      audits: audits.filter((audit) => audit.recordId === row.id).slice(0, 100).map((audit) => ({ id: audit.id, action: audit.fieldName, actor: audit.actorName, summary: audit.summary, at: audit.createdAt })),
    };
  });
  return Response.json({
    assets,
    members: members.map((member) => ({ name: member.displayName, email: member.email, roles: stringArray(member.designationsJson) })).sort((a, b) => a.name.localeCompare(b.name)),
    projects: projectRows.filter((project) => !["Closed", "Cancelled"].includes(project.status)).map((project) => ({ id: project.number, name: project.name, status: project.status })),
    permissions: access,
    controls: {
      custody: "Every checkout, transfer, return, location, and condition change is permanent and attributable.",
      safety: "A failed safety inspection immediately places the asset Out Of Service. Only an authorized manager can return it to service with repair evidence.",
      security: "Manual location works now. GPS, geofence, and tracker timestamps are shown only when a provider-confirmed connection exists.",
      automation: "Maintenance, registration, insurance, inspection, stale tracker, geofence, and theft exceptions create accountable My Work items automatically.",
      accounting: "Operational status never determines book or tax treatment. Accounting review, Section 179 elections, journal drafts, and disposal remain separate controlled records.",
    },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const { getDb } = await import("../../../db");
  const db = getDb();
  await ensureProjectFileSchema();
  const access = await resolveAccess(db, actor);
  if (!access.canView) return Response.json({ error: "Assets And Fleet Access Is Required" }, { status: 403 });
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) return uploadAssetDocument(request, db, actor, access);

  const input = await request.json() as AssetInput;
  const action = text(input.action);
  const now = new Date().toISOString();
  if (action === "create-asset") {
    if (!access.canManage) return forbidden("Fleet Or Asset Manager Access Is Required To Create Assets");
    const assetTag = text(input.assetTag).toUpperCase();
    const category = text(input.category);
    const description = text(input.description);
    if (!assetTag || !ASSET_CATEGORIES.includes(category as typeof ASSET_CATEGORIES[number]) || !description) return bad("Asset Tag Category And Description Are Required");
    const current = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.recordType, ASSET_RECORD_TYPE)));
    if (current.some((row) => text(parseAssetData(row.dataJson).assetTag).toUpperCase() === assetTag)) return Response.json({ error: "Asset Tag Must Be Unique" }, { status: 409 });
    const id = `AST-${crypto.randomUUID().toUpperCase()}`;
    const data = profileData(input, access.canSeeCosts);
    Object.assign(data, { assetTag, category, description, createdBy: actor.name, createdByEmail: actor.email, createdAt: now, custodyHistory: [], inspectionHistory: [], serviceHistory: [], issueHistory: [], timeline: [{ action: "Asset Created", actor: actor.name, at: now, detail: `${assetTag} · ${category}` }] });
    await db.insert(commandRecords).values({ projectId: ASSET_PROJECT_ID, id, recordType: ASSET_RECORD_TYPE, title: `${assetTag} · ${description}`, owner: actor.name, due: text(data.nextServiceDate), status: "Available", meta: `${category} · Available`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
    await audit(db, id, actor, "Asset Created", "Not Registered", "Available", `${assetTag} entered in the permanent company asset register.`);
    await reconcileAssetReadiness(new Date());
    return Response.json({ saved: true, assetId: id }, { status: 201 });
  }

  const assetId = text(input.assetId);
  const rows = assetId ? await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.id, assetId), eq(commandRecords.recordType, ASSET_RECORD_TYPE))).limit(1) : [];
  if (!rows[0]) return Response.json({ error: "Select A Valid Asset" }, { status: 404 });
  const row = rows[0];
  const data = parseAssetData(row.dataJson);
  const timeline = array(data.timeline);
  const pushTimeline = (label: string, detail: string) => timeline.unshift({ action: label, actor: actor.name, actorEmail: actor.email, at: now, detail });
  let status = row.status;
  let auditAction = "";
  let auditSummary = "";

  if (action === "update-profile") {
    if (!access.canManage) return forbidden("Fleet Or Asset Manager Access Is Required To Edit The Asset Register");
    Object.assign(data, profileData(input, access.canSeeCosts));
    if (!["Out Of Service", "Missing / Stolen", "Retired"].includes(status) && ASSET_STATUSES.includes(text(input.status) as typeof ASSET_STATUSES[number]) && !["Out Of Service", "Missing / Stolen", "Retired"].includes(text(input.status))) status = text(input.status);
    auditAction = "Asset Profile Updated"; auditSummary = `${text(data.assetTag)} profile, readiness dates, meter, and location were updated.`;
  } else if (action === "assign") {
    if (!access.canManage) return forbidden("Fleet Or Asset Manager Access Is Required To Assign Assets");
    if (["Out Of Service", "Missing / Stolen", "Retired"].includes(status)) return bad(`${status} Assets Cannot Be Assigned`);
    const assigneeEmail = text(input.assigneeEmail).toLowerCase();
    const projectId = text(input.projectId);
    const member = assigneeEmail ? await db.select().from(companyMembers).where(and(eq(companyMembers.email, assigneeEmail), eq(companyMembers.isActive, true))).limit(1) : [];
    const project = projectId ? await db.select().from(projects).where(eq(projects.number, projectId)).limit(1) : [];
    if ((assigneeEmail && !member[0]) || (projectId && (!project[0] || /completed|closed|archived|cancelled|quarantine|deleted/i.test(project[0].status))) || (!member[0] && !project[0])) return bad("Select An Active Employee Or Active Project For Custody");
    const entry = { action: "Assigned", assigneeName: member[0]?.displayName || "", assigneeEmail: member[0]?.email || "", projectId: project[0]?.number || "", projectName: project[0]?.name || "", location: text(input.currentLocation), meter: number(input.currentMeter), condition: text(input.condition) || "Serviceable", notes: text(input.notes), actor: actor.name, at: now };
    data.assignedToName = entry.assigneeName; data.assignedToEmail = entry.assigneeEmail; data.projectId = entry.projectId; data.projectName = entry.projectName; if (entry.location) data.currentLocation = entry.location; if (entry.meter >= 0) data.currentMeter = entry.meter;
    data.custodyHistory = [entry, ...array(data.custodyHistory)]; status = "Assigned"; auditAction = "Asset Assigned"; auditSummary = `${text(data.assetTag)} assigned to ${entry.assigneeName || entry.projectName}${entry.projectName && entry.assigneeName ? ` on ${entry.projectName}` : ""}.`;
  } else if (action === "check-in") {
    if (!access.canOperate) return forbidden("Field Operations Access Is Required To Check In Assets");
    const entry = { action: "Checked In", priorAssignee: text(data.assignedToName), priorProject: text(data.projectName), location: text(input.currentLocation) || text(data.homeLocation), meter: number(input.currentMeter), condition: text(input.condition) || "Serviceable", notes: text(input.notes), actor: actor.name, at: now };
    data.assignedToName = ""; data.assignedToEmail = ""; data.projectId = ""; data.projectName = ""; data.currentLocation = entry.location; if (entry.meter >= 0) data.currentMeter = entry.meter; data.custodyHistory = [entry, ...array(data.custodyHistory)];
    if (!["Out Of Service", "Missing / Stolen", "Retired"].includes(status)) status = assetAlerts({ ...row, status: "Available", data }).some((alert) => /Service/.test(alert.title)) ? "Maintenance Due" : "Available";
    auditAction = "Asset Checked In"; auditSummary = `${text(data.assetTag)} returned to ${entry.location || "company custody"} in ${entry.condition} condition.`;
  } else if (action === "update-location") {
    if (!access.canOperate) return forbidden("Field Operations Access Is Required To Update Asset Location");
    const location = text(input.currentLocation); if (!location) return bad("Current Location Is Required");
    data.currentLocation = location; if (input.currentMeter !== undefined) data.currentMeter = number(input.currentMeter); pushTimeline("Location Confirmed", `${location}${input.currentMeter !== undefined ? ` · ${number(input.currentMeter)} ${text(data.meterType)}` : ""}`); auditAction = "Asset Location Updated"; auditSummary = `${text(data.assetTag)} location confirmed at ${location}.`;
  } else if (action === "inspection") {
    if (!access.canOperate) return forbidden("Field Operations Access Is Required To Inspect Assets");
    const checks = object(input.checks); const answers = Object.values(checks).map(String); if (!answers.length || answers.some((answer) => !["Pass", "Fail", "N/A"].includes(answer))) return bad("Complete Every Inspection Check");
    const failed = Object.entries(checks).filter(([, value]) => value === "Fail").map(([key]) => key); const notes = text(input.notes); if (failed.length && notes.length < 8) return bad("Describe Every Failed Inspection Condition");
    const entry = { id: crypto.randomUUID(), date: text(input.date) || now.slice(0, 10), meter: number(input.currentMeter), checks, failed, notes, result: failed.length ? "Failed — Out Of Service" : "Passed", inspectedBy: actor.name, inspectedByEmail: actor.email, at: now };
    data.inspectionHistory = [entry, ...array(data.inspectionHistory)]; if (entry.meter >= 0) data.currentMeter = entry.meter; data.lastInspectionDate = entry.date; if (failed.length) { status = "Out Of Service"; data.activeIssueType = "Safety Defect"; data.activeIssueDetail = notes; data.activeIssueAt = now; } auditAction = failed.length ? "Inspection Failed — Asset Locked Out" : "Inspection Passed"; auditSummary = failed.length ? `${text(data.assetTag)} failed ${failed.join(", ")} and is Out Of Service.` : `${text(data.assetTag)} passed the recorded inspection.`;
  } else if (action === "service") {
    if (!access.canManage) return forbidden("Fleet Or Asset Manager Access Is Required To Record Service");
    const workPerformed = text(input.workPerformed); if (workPerformed.length < 8) return bad("Describe The Maintenance Or Repair Work Performed");
    const entry = { id: crypto.randomUUID(), date: text(input.date) || now.slice(0, 10), vendor: text(input.vendor), meter: number(input.currentMeter), amount: access.canSeeCosts ? roundMoney(number(input.amount)) : 0, workPerformed, invoiceReference: text(input.invoiceReference), nextServiceDate: text(input.nextServiceDate), nextServiceMeter: number(input.nextServiceMeter), recordedBy: actor.name, at: now };
    data.serviceHistory = [entry, ...array(data.serviceHistory)]; if (entry.meter >= 0) data.currentMeter = entry.meter; data.nextServiceDate = entry.nextServiceDate; data.nextServiceMeter = entry.nextServiceMeter; data.lastServiceDate = entry.date; auditAction = "Maintenance Recorded"; auditSummary = `${text(data.assetTag)} · ${workPerformed}${status === "Out Of Service" ? " · Return-to-service approval is still required." : ""}`;
  } else if (action === "issue") {
    if (!access.canOperate) return forbidden("Field Operations Access Is Required To Report Asset Issues");
    const issueType = text(input.issueType); const detail = text(input.detail); if (!["Breakdown", "Safety Defect", "Damage", "Lost / Stolen", "Other"].includes(issueType) || detail.length < 8) return bad("Issue Type And A Specific Description Are Required");
    const severity = text(input.severity) || (issueType === "Lost / Stolen" ? "Critical" : "High"); const entry = { id: crypto.randomUUID(), issueType, detail, severity, location: text(input.currentLocation) || text(data.currentLocation), reportedBy: actor.name, reportedByEmail: actor.email, at: now };
    data.issueHistory = [entry, ...array(data.issueHistory)]; data.activeIssueType = issueType; data.activeIssueDetail = detail; data.activeIssueAt = now; if (entry.location) data.currentLocation = entry.location;
    status = issueType === "Lost / Stolen" ? "Missing / Stolen" : ["Breakdown", "Safety Defect"].includes(issueType) || severity === "Critical" ? "Out Of Service" : status; auditAction = issueType === "Lost / Stolen" ? "Theft / Loss Alert Created" : "Asset Issue Reported"; auditSummary = `${text(data.assetTag)} · ${issueType} · ${detail}`;
  } else if (action === "return-to-service") {
    if (!access.canManage) return forbidden("Fleet Or Asset Manager Access Is Required To Return An Asset To Service");
    if (!access.canReturnToService) return forbidden("Return-To-Service Authority Is Required");
    if (status === "Retired") return Response.json({ error: "A Retired Asset Cannot Be Returned To Service Through Repair Verification" }, { status: 409 });
    const evidence = text(input.evidenceNote); if (evidence.length < 12) return bad("Repair Verification Or Return-To-Service Evidence Is Required");
    const entry = { id: crypto.randomUUID(), action: "Returned To Service", evidence, serviceReference: text(input.serviceReference), actor: actor.name, actorEmail: actor.email, at: now };
    data.issueHistory = [entry, ...array(data.issueHistory)]; data.activeIssueType = ""; data.activeIssueDetail = ""; data.activeIssueAt = ""; data.geofenceStatus = text(data.geofenceStatus) === "Breach" ? "Inside" : data.geofenceStatus; status = text(data.assignedToEmail) || text(data.projectId) ? "Assigned" : "Available"; auditAction = "Returned To Service"; auditSummary = `${text(data.assetTag)} released by ${actor.name}. ${evidence}`;
  } else if (action === "retire") {
    if (!access.isLeadership) return forbidden("Company Owner Or Administrator Access Is Required To Retire Assets");
    const reason = text(input.reason); if (reason.length < 8) return bad("An Operational Retirement Reason Is Required"); status = "Retired"; data.retiredAt = now; data.retiredBy = actor.name; data.retirementReason = reason; data.assignedToName = ""; data.assignedToEmail = ""; data.projectId = ""; data.projectName = ""; auditAction = "Asset Retired From Operations"; auditSummary = `${text(data.assetTag)} retired from operational use. Accounting disposition remains separate until reviewed. ${reason}`;
  } else if (action === "save-accounting-treatment") {
    if (!access.canAccount) return forbidden("Accountant Or Company Owner Access Is Required To Set Book Or Tax Treatment");
    const accountingStatus = text(input.accountingStatus); const bookTreatment = text(input.bookTreatment); const bookMethod = text(input.bookMethod); const taxTreatment = text(input.taxTreatment);
    if (!ASSET_ACCOUNTING_STATUSES.includes(accountingStatus as typeof ASSET_ACCOUNTING_STATUSES[number])) return bad("Select A Valid Accounting Review Status");
    if (!ASSET_BOOK_TREATMENTS.includes(bookTreatment as typeof ASSET_BOOK_TREATMENTS[number])) return bad("Select A Valid Book Treatment");
    if (!ASSET_BOOK_METHODS.includes(bookMethod as typeof ASSET_BOOK_METHODS[number])) return bad("Select A Valid Book Depreciation Method");
    if (!ASSET_TAX_TREATMENTS.includes(taxTreatment as typeof ASSET_TAX_TREATMENTS[number])) return bad("Select A Valid Tax Treatment");
    if (bookTreatment === "Capitalize & Depreciate" && !/^\d{4}-\d{2}-\d{2}$/.test(text(input.placedInServiceDate))) return bad("Placed-In-Service Date Is Required For A Depreciated Asset");
    if (bookTreatment === "Capitalize & Depreciate" && number(input.usefulLifeYears) <= 0) return bad("A Positive Book Useful Life Is Required For A Depreciated Asset");
    const accountingInput = normalizeAccountReferences(accountingData(input)); if (!taxTreatment.includes("Section 179")) accountingInput.section179Amount = 0; if (!taxTreatment.includes("Bonus")) accountingInput.bonusDepreciationAmount = 0; if (bookTreatment !== "Capitalize & Depreciate") accountingInput.bookMethod = "None"; const values = assetAccountingValues({ ...data, ...accountingInput });
    if (values.accumulatedBookDepreciation > Math.max(0, values.acquisitionCost - values.salvageValue) + .01) return bad("Accumulated Book Depreciation Cannot Exceed Depreciable Book Basis");
    if (values.section179Amount + values.bonusDepreciationAmount + values.accumulatedTaxDepreciation > values.taxBasis + .01) return bad("Section 179 Bonus And Accumulated Tax Depreciation Cannot Exceed Business-Use Tax Basis");
    if (taxTreatment.includes("Section 179") && (values.section179Amount <= 0 || !/^\d{4}$/.test(text(input.taxYear)))) return bad("Section 179 Amount And Election Tax Year Are Required");
    const priorAccounting = text(data.accountingStatus) || "Needs Review";
    Object.assign(data, accountingInput, values, { accountingReviewedBy: actor.name, accountingReviewedEmail: actor.email, accountingReviewedAt: now });
    const accountingHistory = array(data.accountingHistory); accountingHistory.unshift({ id: crypto.randomUUID(), action: "Accounting Treatment Saved", bookTreatment, taxTreatment, accountingStatus, currentBookValue: values.currentBookValue, remainingTaxBasis: values.remainingTaxBasis, actor: actor.name, actorEmail: actor.email, at: now, notes: text(input.accountingNotes) }); data.accountingHistory = accountingHistory;
    auditAction = "Asset Accounting Treatment Saved"; auditSummary = `${text(data.assetTag)} · ${bookTreatment} · ${taxTreatment} · ${accountingStatus}. Operational status remains ${status}.`;
    await upsertFixedAssetRegister(db, row.id, row.title, status, data, actor, now);
    await audit(db, row.id, actor, auditAction, priorAccounting, accountingStatus, auditSummary);
    pushTimeline(auditAction, auditSummary); data.timeline = timeline;
    await db.update(commandRecords).set({ dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.id, assetId)));
    return Response.json({ saved: true, assetId, status, accountingStatus, currentBookValue: values.currentBookValue, remainingTaxBasis: values.remainingTaxBasis });
  } else if (action === "create-asset-journal-draft") {
    if (!access.canAccount) return forbidden("Accountant Or Company Owner Access Is Required To Create An Asset Journal Draft");
    const journalEvent = text(input.journalEvent); const journalAmount = roundMoney(number(input.journalAmount)); const entryDate = text(input.entryDate); const account = (prefix: string) => ({ number: currentAccountNumber(input[`${prefix}AccountNumber`]), name: text(input[`${prefix}AccountName`]) });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return bad("A Journal Entry Date Is Required");
    if (!['Capitalization', 'Book Depreciation', 'Full Write-Off'].includes(journalEvent)) return bad("Select A Valid Asset Journal Event");
    const lines: Array<Record<string, unknown>> = []; const assetAccount = account("asset"); const offsetAccount = account("offset"); const accumulatedAccount = account("accumulatedDepreciation"); const expenseAccount = account("depreciationExpense"); const support = `Asset ${text(data.assetTag)} · ${row.id}`;
    if (journalEvent === "Capitalization") {
      if (journalAmount <= 0 || !assetAccount.number || !assetAccount.name || !offsetAccount.number || !offsetAccount.name) return bad("Capitalization Amount Asset Account And Offset Account Are Required");
      lines.push(journalLine(assetAccount, journalAmount, 0, support), journalLine(offsetAccount, 0, journalAmount, support));
    } else if (journalEvent === "Book Depreciation") {
      if (journalAmount <= 0 || !expenseAccount.number || !expenseAccount.name || !accumulatedAccount.number || !accumulatedAccount.name) return bad("Depreciation Amount Expense Account And Accumulated Depreciation Account Are Required");
      lines.push(journalLine(expenseAccount, journalAmount, 0, support), journalLine(accumulatedAccount, 0, journalAmount, support));
    } else {
      const values = assetAccountingValues(data); const cost = values.acquisitionCost; const accumulated = Math.min(cost, values.accumulatedBookDepreciation); const loss = roundMoney(Math.max(0, cost - accumulated));
      if (cost <= 0 || !assetAccount.number || !assetAccount.name || !expenseAccount.number || !expenseAccount.name || (accumulated > 0 && (!accumulatedAccount.number || !accumulatedAccount.name))) return bad("Original Cost Asset Account Write-Off Account And Any Accumulated Depreciation Account Are Required");
      if (accumulated > 0) lines.push(journalLine(accumulatedAccount, accumulated, 0, support));
      if (loss > 0) lines.push(journalLine(expenseAccount, loss, 0, support));
      lines.push(journalLine(assetAccount, 0, cost, support));
    }
    const journalId = `JE-ASSET-${entryDate.replaceAll("-", "")}-${crypto.randomUUID()}`; const total = roundMoney(lines.reduce((sum, line) => sum + number(line.debit), 0)); const reference = `AST-${text(data.assetTag)}-${journalEvent.toUpperCase().replaceAll(" ", "-")}`; const journalData = { id: journalId, entryDate, entryType: "Adjusting", reference, description: `${journalEvent} · ${row.title}`, supportReference: support, lines, totals: { debit: total, credit: total, difference: 0 }, preparedBy: actor.name, preparedEmail: actor.email, preparedAt: now, updatedBy: actor.name, updatedAt: now, immutableAfterPosting: true, openingBalanceBatch: false, sourceAssetId: row.id, sourceAssetTag: text(data.assetTag), sourceOperationalStatus: status };
    await db.insert(commandRecords).values({ projectId: ACCOUNTING_PROJECT_ID, id: journalId, recordType: "Journal Entry", title: `Adjusting · ${reference}`, owner: actor.name, due: entryDate, status: "Draft", meta: `${money(total)} Debits · ${money(total)} Credits`, recordDate: entryDate, recordTime: now.slice(11,16), dateLocked: true, dataJson: JSON.stringify(journalData), updatedAt: now });
    await db.insert(recordAudits).values({ projectId: ACCOUNTING_PROJECT_ID, recordId: journalId, fieldName: "Accounting Coordination", oldValue: "New", newValue: "Draft", reason: "Controlled accounting workflow", actorName: actor.name, actorEmail: actor.email, summary: `${journalEvent} journal draft created from ${row.title}; independent approval and posting are still required.` });
    const drafts = array(data.accountingJournalDrafts); drafts.unshift({ id: journalId, journalEvent, amount: total, status: "Draft", entryDate, createdBy: actor.name, at: now }); data.accountingJournalDrafts = drafts;
    auditAction = "Asset Journal Draft Created"; auditSummary = `${journalEvent} draft ${journalId} created for ${money(total)}. No journal was posted and operational status remains ${status}.`;
  } else return bad("A Valid Asset Action Is Required");

  pushTimeline(auditAction, auditSummary);
  data.timeline = timeline;
  const title = `${text(data.assetTag) || text(parseAssetData(row.dataJson).assetTag)} · ${text(data.description) || row.title.split(" · ").slice(1).join(" · ")}`;
  await db.update(commandRecords).set({ title, owner: text(data.assignedToName) || actor.name, due: text(data.nextServiceDate), status, meta: `${text(data.category)} · ${status}${text(data.currentLocation) ? ` · ${text(data.currentLocation)}` : ""}`, dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.id, assetId)));
  await audit(db, assetId, actor, auditAction, row.status, status, auditSummary);
  await reconcileAssetReadiness(new Date());
  return Response.json({ saved: true, assetId, status });
}

async function uploadAssetDocument(request: Request, db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>, access: Awaited<ReturnType<typeof resolveAccess>>) {
  if (!access.canOperate) return forbidden("Asset Operations Access Is Required To Upload Documents");
  const form = await request.formData();
  if (String(form.get("action") || "") !== "upload-document") return bad("A Valid Asset Document Action Is Required");
  const assetId = String(form.get("assetId") || "").trim(); const documentKind = String(form.get("documentKind") || "Asset Document").trim(); const file = form.get("file"); const ocrStatus = String(form.get("ocrStatus") || "idle"); const ocrConfirmed = String(form.get("ocrConfirmed") || "false") === "true"; const ocrSuggestions = assetOcrSuggestions(form.get("ocrSuggestions"));
  if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES) return bad("Choose An Asset File Up To 25 MB");
  if (ocrStatus === "ready" && !ocrConfirmed) return bad("Review And Confirm The Asset Document OCR Suggestions Before Uploading");
  const asset = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.id, assetId), eq(commandRecords.recordType, ASSET_RECORD_TYPE))).limit(1);
  if (!asset[0]) return bad("Select A Valid Asset");
  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "-"); const storageKey = `${ASSET_PROJECT_ID}/${assetId}/${crypto.randomUUID()}-${safeName}`; const { env } = await import("cloudflare:workers"); const contentType = photoUploadContentType(file);
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType }, customMetadata: { assetId, documentKind, uploadedBy: actor.email } });
  const [saved] = await db.insert(projectFiles).values({ projectId: ASSET_PROJECT_ID, name: file.name, category: `Asset · ${documentKind}`, revision: assetId, storageKey, contentType, sizeBytes: file.size, uploadedBy: actor.name, access: "Authorized Mefford Asset Operations" }).returning();
  const now = new Date().toISOString();
  const data = parseAssetData(asset[0].dataJson);
  if (ocrStatus === "ready" && ocrConfirmed) {
    if (!text(data.vin) && ocrSuggestions.vin) data.vin = ocrSuggestions.vin;
    if (!text(data.licensePlate) && ocrSuggestions.licensePlate) data.licensePlate = ocrSuggestions.licensePlate;
    const expirationField = ({ Registration: "registrationExpiry", Insurance: "insuranceExpiry", Inspection: "inspectionExpiry", Warranty: "warrantyExpiry" } as Record<string, string>)[documentKind];
    if (expirationField && !text(data[expirationField]) && ocrSuggestions.expirationDate) data[expirationField] = ocrSuggestions.expirationDate;
    const history = Array.isArray(data.documentIntelligence) ? data.documentIntelligence as unknown[] : [];
    data.documentIntelligence = [...history, { fileId: saved.id, fileName: saved.name, documentKind, engine: "PDF Text + Tesseract OCR", status: "Human Reviewed", confidence: String(form.get("ocrConfidence") || ""), characterCount: Math.max(0, Number(form.get("ocrCharacterCount") || 0)), suggestions: ocrSuggestions, reviewedBy: actor.name, reviewedEmail: actor.email, reviewedAt: now, completedAt: String(form.get("ocrCompletedAt") || ""), originalPreserved: true }];
    const timeline = Array.isArray(data.timeline) ? data.timeline as unknown[] : [];
    data.timeline = [...timeline, { action: "Asset Document OCR Reviewed", actor: actor.name, at: now, detail: `${documentKind} · ${file.name} · only empty identity/expiration fields were eligible for prefill` }];
    await db.update(commandRecords).set({ dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.id, assetId)));
  }
  await audit(db, assetId, actor, "Asset Document Uploaded", "No New File", `${saved.id}`, `${documentKind} · ${file.name} permanently attached to ${asset[0].title}.`);
  return Response.json({ saved: true, file: clientFile(saved) }, { status: 201 });
}

function assetOcrSuggestions(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value || "{}")) as Record<string, unknown>;
    const date = (input: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(input)) ? text(input) : "";
    return { vin: text(parsed.vin).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17), licensePlate: text(parsed.licensePlate).toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 16), policyNumber: text(parsed.policyNumber).slice(0, 80), documentNumber: text(parsed.documentNumber).slice(0, 80), expirationDate: date(parsed.expirationDate), serviceDate: date(parsed.serviceDate), amount: Math.max(0, roundMoney(number(parsed.amount))) };
  } catch { return { vin: "", licensePlate: "", policyNumber: "", documentNumber: "", expirationDate: "", serviceDate: "", amount: 0 }; }
}

async function resolveAccess(db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>) {
  const member = await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1); const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel; const roles = stringArray(member[0]?.designationsJson || "[]");
  const isLeadership = ["Company Owner", "Administrator"].includes(accessLevel); const canManage = isLeadership || roles.some((role) => ["Fleet Manager", "Asset Manager", "Office Staff"].includes(role)); const canOperate = canManage || roles.some((role) => ["Project Manager", "Superintendent", "Safety Director", "Safety"].includes(role)); const canSeeCosts = isLeadership || roles.some((role) => ["Accountant", "Accounting Manager", "Financial Administrator"].includes(role)); const canAccount = accessLevel === "Company Owner" || roles.some((role) => ["Accountant", "Accounting Manager", "Financial Administrator"].includes(role));
  return { canView: canOperate || canSeeCosts, canOperate, canManage, canSeeCosts, canAccount, canReturnToService: canManage, isLeadership, accessLevel, roles, actorEmail: actor.email };
}

function profileData(input: AssetInput, includeCosts: boolean) { const result: Record<string, unknown> = {}; for (const field of PROFILE_FIELDS) { if (input[field] === undefined) continue; if (!includeCosts && ["acquisitionCost", "currentBookValue", "internalRate"].includes(field)) continue; result[field] = ["acquisitionCost", "currentBookValue", "internalRate"].includes(field) ? roundMoney(number(input[field])) : ["currentMeter", "nextServiceMeter"].includes(field) ? number(input[field]) : text(input[field]); } return result; }
function accountingData(input: AssetInput) { const result: Record<string, unknown> = {}; for (const field of ACCOUNTING_FIELDS) { if (input[field] === undefined) continue; result[field] = ["salvageValue", "accumulatedBookDepreciation", "impairmentAmount", "section179Amount", "bonusDepreciationAmount", "accumulatedTaxDepreciation"].includes(field) ? roundMoney(number(input[field])) : ["usefulLifeYears", "businessUsePercent"].includes(field) ? number(input[field]) : text(input[field]); } return result; }
function journalLine(account: { number: string; name: string }, debit: number, credit: number, description: string) { return { id: crypto.randomUUID(), accountNumber: currentAccountNumber(account.number), accountName: account.name, description, projectId: "", department: "Administration", debit: roundMoney(debit), credit: roundMoney(credit) }; }
async function upsertFixedAssetRegister(db: ReturnType<typeof import("../../../db").getDb>, assetId: string, title: string, operationalStatus: string, data: Record<string, unknown>, actor: ReturnType<typeof getCommandActor>, now: string) { const id = `FIXED-${assetId}`; const values = assetAccountingValues(data); const record = { assetId, assetTag: text(data.assetTag), category: text(data.category), operationalStatus, accountingStatus: text(data.accountingStatus), bookTreatment: text(data.bookTreatment), taxTreatment: text(data.taxTreatment), placedInServiceDate: text(data.placedInServiceDate), acquisitionCost: values.acquisitionCost, currentBookValue: values.currentBookValue, taxBasis: values.taxBasis, remainingTaxBasis: values.remainingTaxBasis, source: "Assets & Fleet", reviewedBy: actor.name, reviewedEmail: actor.email, reviewedAt: now };
  await db.insert(commandRecords).values({ projectId: ACCOUNTING_PROJECT_ID, id, recordType: "Fixed Asset Register", title, owner: actor.name, due: text(data.placedInServiceDate) || now.slice(0,10), status: text(data.accountingStatus) || "Needs Review", meta: `${text(data.bookTreatment)} · ${money(values.currentBookValue)} Book Value`, recordDate: text(data.placedInServiceDate) || now.slice(0,10), recordTime: now.slice(11,16), dateLocked: true, dataJson: JSON.stringify(record), updatedAt: now }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { title, owner: actor.name, status: text(data.accountingStatus) || "Needs Review", meta: `${text(data.bookTreatment)} · ${money(values.currentBookValue)} Book Value`, dataJson: JSON.stringify(record), updatedAt: now } }); }
function clientFile(file: typeof projectFiles.$inferSelect) { return { id: file.id, name: file.name, category: file.category, sizeBytes: file.sizeBytes, uploadedBy: file.uploadedBy, createdAt: file.createdAt }; }
async function audit(db: ReturnType<typeof import("../../../db").getDb>, recordId: string, actor: ReturnType<typeof getCommandActor>, action: string, oldValue: string, newValue: string, summary: string) { await db.insert(recordAudits).values({ projectId: ASSET_PROJECT_ID, recordId, fieldName: action, oldValue, newValue, reason: summary, actorName: actor.name, actorEmail: actor.email, summary }); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { const parsed = Number(String(value ?? "").replaceAll(",", "")); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown) { return Array.isArray(value) ? [...value] as Array<Record<string, unknown>> : []; }
function stringArray(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function bad(error: string) { return Response.json({ error }, { status: 400 }); }
function forbidden(error: string) { return Response.json({ error }, { status: 403 }); }
