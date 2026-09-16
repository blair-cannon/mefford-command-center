import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projects,
  recordAudits,
  vendorAudits,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { complianceState, ensureVendorSchema, parseStringArray } from "../../../lib/vendor-portal";
import {
  PURCHASE_ORDER_APPROVAL_THRESHOLD,
  PURCHASE_ORDER_RECORD_TYPE,
  parsePurchaseOrderData,
  type PurchaseOrderData,
} from "../../../lib/purchase-orders";
import {
  PROJECT_TEAM_ASSIGNMENT_TYPE,
  normalizeDesignations,
  parseRecordData,
  projectTeamAssignmentId,
} from "../../../lib/team-access";
import { roundMoney } from "../../../lib/money.js";

type PurchaseOrderInput = {
  action?: string;
  projectId?: string;
  recordId?: string;
  vendorId?: string;
  amount?: number;
  costCode?: string;
  trade?: string;
  scope?: string;
  exclusions?: string;
  deliveryLocation?: string;
  requiredBy?: string;
  paymentTerms?: string;
  freightTerms?: string;
  taxIncluded?: string;
  warranty?: string;
  specialInstructions?: string;
  sourceSelectionId?: string;
  decision?: "Approved" | "Returned";
  note?: string;
  distributionReference?: string;
  acknowledgedBy?: string;
  acknowledgmentReference?: string;
  reason?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const context = await purchaseOrderContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canView) return Response.json({ error: "Purchase Order Access Is Required" }, { status: 403 });
  const [rows, audits, vendors, accessRows, budgetRows, accountingRows] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)).orderBy(desc(recordAudits.id)),
    db.select().from(vendorProfiles).orderBy(vendorProfiles.legalName),
    db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control"]))),
    db.select().from(commandRecords).where(eq(commandRecords.projectId, "MEFFORD-ACCOUNTING")),
  ]);
  const budget = budgetSummary(budgetRows, rows);
  const vendorOptions = await Promise.all(vendors.map(async (vendor) => {
    const compliance = await complianceState(db, vendor.id, projectId);
    return {
      id: vendor.id,
      name: vendor.legalName,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      contactPhone: vendor.contactPhone,
      address: formatVendorAddress(vendor.addressJson),
      paymentTerms: vendor.paymentTerms,
      status: vendor.status,
      shared: accessRows.some((access) => access.vendorId === vendor.id),
      paymentHold: compliance.paymentBlocked,
      temporaryApproval: Boolean(compliance.activeOverride),
    };
  }));
  const orders = rows.map((row) => {
    const data = parsePurchaseOrderData(row.dataJson);
    const invoices = accountingRows.filter((invoice) => invoiceMatchesPurchaseOrder(invoice.dataJson, projectId, row.id));
    return {
      id: row.id,
      title: row.title,
      owner: row.owner,
      due: row.due,
      status: row.status,
      meta: row.meta,
      recordDate: row.recordDate,
      updatedAt: row.updatedAt,
      data,
      invoicedAmount: invoices.reduce((total, invoice) => total + matchedInvoiceAmount(invoice.dataJson, projectId, row.id), 0),
      paidAmount: invoices.filter((invoice) => ["Paid", "Posted"].includes(invoice.status)).reduce((total, invoice) => total + matchedInvoiceAmount(invoice.dataJson, projectId, row.id), 0),
      audits: audits.filter((audit) => audit.recordId === row.id),
    };
  });
  return Response.json({
    project: context.project,
    orders,
    vendors: vendorOptions,
    budget,
    permissions: { canView: context.canView, canManage: context.canManage, canOwnerApprove: context.level === "Company Owner", canRelease: context.canManage },
    controls: { threshold: PURCHASE_ORDER_APPROVAL_THRESHOLD, ownerApproval: "Required above $10,000.00 or for a budget exception", release: "PM/Admin/Owner after every required approval", distribution: "Recorded manual delivery until operational email is connected", amendments: "Released orders are revised by a new linked revision; originals remain permanent", accounting: "Released and acknowledged orders become AP matching commitments" },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const input = await request.json() as PurchaseOrderInput;
  const projectId = input.projectId?.trim() || "";
  const { getDb } = await import("../../../db");
  const db = getDb();
  const context = await purchaseOrderContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
  const now = new Date().toISOString();

  if (input.action === "create") {
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.vendorId?.trim() || "")).limit(1);
    const fields = validateOrderFields(input);
    if (!vendor[0] || fields.error) return Response.json({ error: fields.error || "Vendor Directory Record Is Required" }, { status: 400 });
    const budgetRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control", PURCHASE_ORDER_RECORD_TYPE])));
    const controls = budgetSummary(budgetRows.filter((row) => row.recordType !== PURCHASE_ORDER_RECORD_TYPE), budgetRows.filter((row) => row.recordType === PURCHASE_ORDER_RECORD_TYPE));
    const code = controls.codes.find((item) => item.code === fields.costCode);
    if (!code) return Response.json({ error: "Select An Active Project Budget Cost Code" }, { status: 409 });
    const id = await nextPurchaseOrderId(db, projectId);
    const data: PurchaseOrderData = {
      vendorId: vendor[0].id,
      vendor: vendor[0].legalName,
      contactName: vendor[0].contactName,
      contactEmail: vendor[0].contactEmail,
      contactPhone: vendor[0].contactPhone,
      vendorAddress: formatVendorAddress(vendor[0].addressJson),
      amount: fields.amount,
      costCode: fields.costCode,
      trade: fields.trade,
      scope: fields.scope,
      exclusions: fields.exclusions,
      deliveryLocation: fields.deliveryLocation,
      requiredBy: fields.requiredBy,
      paymentTerms: fields.paymentTerms,
      freightTerms: fields.freightTerms,
      taxIncluded: fields.taxIncluded,
      warranty: fields.warranty,
      specialInstructions: fields.specialInstructions,
      sourceSelectionId: input.sourceSelectionId?.trim() || "",
      sourceBidPackageId: "",
      sourceBidRevisionId: "",
      procurementArchiveProjectId: projectId,
      ownerApproval: null,
      approvalRequired: false,
      approvalReasons: [],
      budgetAvailableAtSubmit: code.available,
      releasedAt: "",
      releasedBy: "",
      distributionReference: "",
      acknowledgedAt: "",
      acknowledgedBy: "",
      acknowledgmentReference: "",
      revisionOf: "",
      revisionNumber: 0,
      supersededBy: "",
      timeline: [{ action: "Controlled Draft Created", actor: context.name, at: now, detail: `${vendor[0].legalName} · ${money(fields.amount)} · ${fields.costCode}` }],
    };
    await db.insert(commandRecords).values({ projectId, id, recordType: PURCHASE_ORDER_RECORD_TYPE, title: `${vendor[0].legalName} · ${fields.scope.slice(0, 80)}`, owner: context.name, due: fields.requiredBy, status: "Draft", meta: `${fields.costCode} · ${money(fields.amount)} · Controlled Draft`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false, dataJson: JSON.stringify(data), updatedAt: now });
    await audit(db, projectId, id, context, "Purchase Order Draft", "None", "Draft", "New controlled purchase order created; no approval, release, or delivery occurred");
    return Response.json({ saved: true, recordId: id }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Purchase Order Not Found" }, { status: 404 });
  const data = parsePurchaseOrderData(row.dataJson);

  if (input.action === "update-draft") {
    if (!["Draft", "Returned"].includes(row.status)) return Response.json({ error: "Only A Draft Or Returned Purchase Order May Be Edited" }, { status: 423 });
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, input.vendorId?.trim() || data.vendorId)).limit(1);
    const fields = validateOrderFields(input);
    if (!vendor[0] || fields.error) return Response.json({ error: fields.error || "Vendor Record Is Required" }, { status: 400 });
    const budgetRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control", PURCHASE_ORDER_RECORD_TYPE])));
    const controls = budgetSummary(budgetRows.filter((item) => item.recordType !== PURCHASE_ORDER_RECORD_TYPE), budgetRows.filter((item) => item.recordType === PURCHASE_ORDER_RECORD_TYPE && item.id !== row.id));
    if (!controls.codes.some((item) => item.code === fields.costCode)) return Response.json({ error: "Select An Active Project Budget Cost Code" }, { status: 409 });
    const next = { ...data, vendorId: vendor[0].id, vendor: vendor[0].legalName, contactName: vendor[0].contactName, contactEmail: vendor[0].contactEmail, contactPhone: vendor[0].contactPhone, vendorAddress: formatVendorAddress(vendor[0].addressJson), amount: fields.amount, costCode: fields.costCode, trade: fields.trade, scope: fields.scope, exclusions: fields.exclusions, deliveryLocation: fields.deliveryLocation, requiredBy: fields.requiredBy, paymentTerms: fields.paymentTerms, freightTerms: fields.freightTerms, taxIncluded: fields.taxIncluded, warranty: fields.warranty, specialInstructions: fields.specialInstructions, ownerApproval: null, approvalReasons: [], approvalRequired: false, timeline: [...data.timeline, { action: "Draft Updated", actor: context.name, at: now, detail: input.reason?.trim() || "Controlled draft fields updated before approval" }] };
    await saveRow(db, row, "Draft", next, context, "Draft Revision", row.status, "Draft", false, input.reason?.trim() || "Draft updated before approval");
    return Response.json({ saved: true });
  }

  if (input.action === "submit") {
    if (!["Draft", "Returned"].includes(row.status)) return Response.json({ error: "This Purchase Order Is Not Ready For Submission" }, { status: 409 });
    const budgetRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control", PURCHASE_ORDER_RECORD_TYPE])));
    const budget = budgetSummary(budgetRows.filter((item) => item.recordType !== PURCHASE_ORDER_RECORD_TYPE), budgetRows.filter((item) => item.recordType === PURCHASE_ORDER_RECORD_TYPE && item.id !== row.id));
    const code = budget.codes.find((item) => item.code === data.costCode);
    if (!budget.locked) return Response.json({ error: "The Original Budget Must Be Locked Before Submission" }, { status: 409 });
    if (!code) return Response.json({ error: "The Purchase Order Cost Code Is Not Active In The Locked Budget" }, { status: 409 });
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, data.vendorId)).limit(1);
    if (!vendor[0]) return Response.json({ error: "The Vendor Must Exist In Vendor Management At Submission" }, { status: 409 });
    const reasons = [data.amount > PURCHASE_ORDER_APPROVAL_THRESHOLD ? `Amount exceeds ${money(PURCHASE_ORDER_APPROVAL_THRESHOLD)}` : "", data.amount > code.available ? `Budget exception on ${data.costCode}` : ""].filter(Boolean);
    const approvalRequired = reasons.length > 0;
    const status = approvalRequired ? "Owner Approval Required" : "Ready For Release";
    const next = { ...data, approvalRequired, approvalReasons: reasons, budgetAvailableAtSubmit: code?.available || 0, timeline: [...data.timeline, { action: "Submitted For Approval", actor: context.name, at: now, detail: approvalRequired ? reasons.join(" · ") : "Within delegated PM release threshold and available budget" }] };
    await saveRow(db, row, status, next, context, "Approval Routing", row.status, status);
    return Response.json({ saved: true, status });
  }

  if (input.action === "owner-decision") {
    if (context.level !== "Company Owner") return Response.json({ error: "Company Owner Authorization Is Required" }, { status: 403 });
    if (row.status !== "Owner Approval Required" || !input.decision) return Response.json({ error: "A Pending Owner Decision Is Required" }, { status: 409 });
    const note = input.note?.trim() || "";
    if (input.decision === "Returned" && note.length < 8) return Response.json({ error: "A Specific Return Explanation Is Required" }, { status: 400 });
    const status = input.decision === "Approved" ? "Ready For Release" : "Returned";
    const next = { ...data, ownerApproval: { decision: input.decision, note, ownerName: context.name, ownerEmail: context.email, decidedAt: now }, timeline: [...data.timeline, { action: `Owner ${input.decision}`, actor: context.name, at: now, detail: note || data.approvalReasons.join(" · ") }] };
    await saveRow(db, row, status, next, context, "Owner Decision", row.status, status);
    return Response.json({ saved: true, status });
  }

  if (input.action === "release") {
    if (row.status !== "Ready For Release") return Response.json({ error: "Every Required Approval Must Be Complete Before Release" }, { status: 409 });
    const reference = input.distributionReference?.trim() || "";
    if (reference.length < 5) return Response.json({ error: "Record The Manual Delivery Method Or Distribution Reference" }, { status: 400 });
    const next = { ...data, releasedAt: now, releasedBy: context.name, distributionReference: reference, timeline: [...data.timeline, { action: "Purchase Order Released", actor: context.name, at: now, detail: `Controlled document released · ${reference}` }] };
    await saveRow(db, row, "Released", next, context, "Controlled Release", row.status, "Released", true);
    await grantVendorPurchaseOrderAccess(db, context.project, data.vendorId, row.id, context.email, now);
    return Response.json({ saved: true, status: "Released", documentUrl: `/api/purchase-orders/document?projectId=${encodeURIComponent(projectId)}&recordId=${encodeURIComponent(row.id)}` });
  }

  if (input.action === "acknowledge") {
    if (row.status !== "Released") return Response.json({ error: "Only A Released Purchase Order May Be Acknowledged" }, { status: 409 });
    const by = input.acknowledgedBy?.trim() || "";
    const reference = input.acknowledgmentReference?.trim() || "";
    if (by.length < 2 || reference.length < 5) return Response.json({ error: "Vendor Acknowledgment Name And Evidence Reference Are Required" }, { status: 400 });
    const next = { ...data, acknowledgedAt: now, acknowledgedBy: by, acknowledgmentReference: reference, timeline: [...data.timeline, { action: "Vendor Acknowledgment Recorded", actor: context.name, at: now, detail: `${by} · ${reference}` }] };
    await saveRow(db, row, "Acknowledged", next, context, "Vendor Acknowledgment", "Released", "Acknowledged", true);
    return Response.json({ saved: true, status: "Acknowledged" });
  }

  if (input.action === "create-revision") {
    if (!["Released", "Acknowledged"].includes(row.status)) return Response.json({ error: "Only A Released Order Requires A New Permanent Revision" }, { status: 409 });
    const reason = input.reason?.trim() || "";
    if (reason.length < 10) return Response.json({ error: "A Specific Revision Reason Is Required" }, { status: 400 });
    const revisionNumber = data.revisionNumber + 1;
    const revisionId = `${row.id.replace(/-R\d+$/, "")}-R${revisionNumber}`;
    const next: PurchaseOrderData = { ...data, ownerApproval: null, approvalRequired: false, approvalReasons: [], releasedAt: "", releasedBy: "", distributionReference: "", acknowledgedAt: "", acknowledgedBy: "", acknowledgmentReference: "", revisionOf: row.id, revisionNumber, supersededBy: "", timeline: [...data.timeline, { action: "Revision Draft Created", actor: context.name, at: now, detail: reason }] };
    await db.insert(commandRecords).values({ projectId, id: revisionId, recordType: PURCHASE_ORDER_RECORD_TYPE, title: row.title, owner: context.name, due: row.due, status: "Draft", meta: `${data.costCode} · ${money(data.amount)} · Revision ${revisionNumber}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false, dataJson: JSON.stringify(next), updatedAt: now });
    const prior = { ...data, supersededBy: revisionId, timeline: [...data.timeline, { action: "Superseded By Revision", actor: context.name, at: now, detail: `${revisionId} · ${reason}` }] };
    await saveRow(db, row, "Superseded", prior, context, "Controlled Revision", row.status, `Superseded By ${revisionId}`, true);
    return Response.json({ saved: true, revisionId }, { status: 201 });
  }

  if (input.action === "cancel") {
    if (!(["Company Owner", "Administrator"].includes(context.level))) return Response.json({ error: "Owner Or Administrator Authorization Is Required" }, { status: 403 });
    const reason = input.reason?.trim() || "";
    if (reason.length < 10) return Response.json({ error: "A Specific Cancellation Reason Is Required" }, { status: 400 });
    if (["Cancelled", "Superseded"].includes(row.status)) return Response.json({ error: "This Order Is Already Inactive" }, { status: 409 });
    const next = { ...data, timeline: [...data.timeline, { action: "Purchase Order Cancelled", actor: context.name, at: now, detail: reason }] };
    await saveRow(db, row, "Cancelled", next, context, "Cancellation", row.status, "Cancelled", true, reason);
    return Response.json({ saved: true, status: "Cancelled" });
  }

  return Response.json({ error: "A Valid Purchase Order Action Is Required" }, { status: 400 });
}

async function purchaseOrderContext(db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>, projectId: string) {
  const [memberRows, projectRows] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1),
    db.select().from(projects).where(eq(projects.number, projectId)).limit(1),
  ]);
  const member = memberRows[0];
  const project = projectRows[0] || null;
  const level = member?.companyAccessLevel || actor.accessLevel;
  let designations = parseStringArray(member?.designationsJson || "[]");
  if (member && project) {
    const assignment = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, projectTeamAssignmentId(member.email)), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))).limit(1);
    if (assignment[0]) designations = normalizeDesignations(parseRecordData(assignment[0].dataJson).projectDesignations);
    designations = await projectDesignationsFor(db, actor, project, designations);
  }
  const name = member?.displayName || actor.name;
  const elevated = ["Company Owner", "Administrator"].includes(level);
  const isPm = designations.includes("Project Manager") || project?.projectManager === name;
  const office = designations.includes("Office Staff");
  return { ...actor, name, level, project, designations, canView: Boolean(member?.isActive && (elevated || isPm || office)), canManage: Boolean(member?.isActive && (elevated || isPm)) };
}

function validateOrderFields(input: PurchaseOrderInput) {
  const amount = roundMoney(input.amount || 0);
  const costCode = input.costCode?.trim() || "";
  const trade = input.trade?.trim() || "";
  const scope = input.scope?.trim() || "";
  const exclusions = input.exclusions?.trim() || "";
  const deliveryLocation = input.deliveryLocation?.trim() || "";
  const requiredBy = input.requiredBy?.trim() || "";
  const paymentTerms = input.paymentTerms?.trim() || "Net 30";
  const freightTerms = input.freightTerms?.trim() || "FOB Destination";
  const taxIncluded = input.taxIncluded?.trim() || "Included";
  const warranty = input.warranty?.trim() || "Manufacturer standard warranty";
  const specialInstructions = input.specialInstructions?.trim() || "";
  const error = !Number.isFinite(amount) || amount <= 0 || !costCode || trade.length < 2 || scope.length < 10 || deliveryLocation.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(requiredBy) ? "Vendor Positive Amount Cost Code Trade Detailed Scope Delivery Location And Required-By Date Are Required" : "";
  return { amount, costCode, trade, scope, exclusions, deliveryLocation, requiredBy, paymentTerms, freightTerms, taxIncluded, warranty, specialInstructions, error };
}

function formatVendorAddress(value: string) {
  try {
    const address = JSON.parse(value || "{}") as Record<string, unknown>;
    const cityLine = [address.city, address.state, address.postalCode].filter(Boolean).map(String).join(" ");
    return [address.street, cityLine].filter(Boolean).map(String).join(", ");
  } catch { return ""; }
}

function budgetSummary(budgetRows: typeof commandRecords.$inferSelect[], purchaseOrders: typeof commandRecords.$inferSelect[]) {
  const control = budgetRows.find((row) => row.recordType === "Budget Control");
  const controlData = parseRecordData(control?.dataJson);
  const activeStatuses = new Set(["Owner Approval Required", "Ready For Release", "Released", "Acknowledged"]);
  const committedByCode = new Map<string, number>();
  for (const order of purchaseOrders.filter((item) => activeStatuses.has(item.status))) {
    const data = parsePurchaseOrderData(order.dataJson);
    committedByCode.set(data.costCode, roundMoney((committedByCode.get(data.costCode) || 0) + data.amount));
  }
  const codes = budgetRows.filter((row) => row.recordType === "Budget").map((row) => {
    const data = parseRecordData(row.dataJson);
    const original = Number(data.originalBudget || 0);
    const changes = Number(data.approvedChanges || 0);
    const otherCommitted = Number(data.committedCost || 0);
    const poCommitted = committedByCode.get(String(data.code || row.id)) || 0;
    const budget = roundMoney(original + changes);
    const committed = roundMoney(otherCommitted + poCommitted);
    return { code: String(data.code || row.id), description: String(data.description || row.title), budget, committed, available: roundMoney(budget - committed), selected: data.selectedForProject === true || original !== 0 || changes !== 0 };
  }).filter((item) => item.selected);
  return { locked: controlData.locked === true, lockedBy: String(controlData.lockedBy || ""), codes };
}

async function nextPurchaseOrderId(db: ReturnType<typeof import("../../../db").getDb>, projectId: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE)));
  const next = rows.reduce((largest, row) => Math.max(largest, Number(row.id.match(/^PO-(\d+)/)?.[1] || 0)), 0) + 1;
  return `PO-${String(next).padStart(3, "0")}`;
}

async function saveRow(db: ReturnType<typeof import("../../../db").getDb>, row: typeof commandRecords.$inferSelect, status: string, data: PurchaseOrderData, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, locked = false, reason = "") {
  await db.update(commandRecords).set({ status, title: `${data.vendor} · ${data.scope.slice(0, 80)}`, due: data.requiredBy || row.due, meta: `${data.costCode} · ${money(data.amount)} · ${status}`, dateLocked: locked || row.dateLocked, dataJson: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
  await audit(db, row.projectId, row.id, actor, fieldName, oldValue, newValue, reason || `${fieldName}: ${oldValue} → ${newValue}`);
}

async function audit(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, reason: string) {
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason, actorName: actor.name, actorEmail: actor.email, summary: `${recordId} · ${reason}` });
  const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route");
  await reconcileProjectHealthAfterUpdate(projectId, actor);
}

async function grantVendorPurchaseOrderAccess(db: ReturnType<typeof import("../../../db").getDb>, project: typeof projects.$inferSelect, vendorId: string, recordId: string, actorEmail: string, now: string) {
  if (!vendorId) return;
  const id = `${vendorId}:${project.number}`;
  const existing = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.id, id)).limit(1);
  const permissions = new Set(existing[0] ? parseStringArray(existing[0].permissionsJson) : []); permissions.add("Purchase Order View And Acknowledgment");
  const shared = new Set(existing[0] ? parseStringArray(existing[0].sharedRecordsJson) : []); shared.add(recordId);
  await db.insert(vendorProjectAccess).values({ id, vendorId, projectId: project.number, projectName: project.name, status: existing[0]?.status || "Active", trade: existing[0]?.trade || "Material Or Equipment Vendor", contractReference: recordId, costCode: existing[0]?.costCode || "", committedAmount: existing[0]?.committedAmount || "0", permissionsJson: JSON.stringify([...permissions]), sharedRecordsJson: JSON.stringify([...shared]), grantedBy: actorEmail, updatedAt: now }).onConflictDoUpdate({ target: vendorProjectAccess.id, set: { status: "Active", contractReference: recordId, permissionsJson: JSON.stringify([...permissions]), sharedRecordsJson: JSON.stringify([...shared]), updatedAt: now } });
  await db.insert(vendorAudits).values({ vendorId, actorName: "Command Center", actorEmail, action: "Purchase Order Shared", detail: `${project.name} · ${recordId} · Least-privilege acknowledgment access` });
}

function invoiceMatchesPurchaseOrder(value: string, projectId: string, recordId: string) {
  return matchedInvoiceAmount(value, projectId, recordId) > 0;
}

function matchedInvoiceAmount(value: string, projectId: string, recordId: string) {
  const data = parseRecordData(value);
  const allocations = Array.isArray(data.allocations) ? data.allocations as Array<Record<string, unknown>> : [];
  return allocations.filter((line) => String(line.destination || "") === projectId && String(line.commitmentReference || "") === recordId).reduce((total, line) => total + Number(line.amount || 0), 0);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
