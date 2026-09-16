import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq, inArray } from "drizzle-orm";
import { commandRecords, commandWorkItems, companyMembers, projectFiles, projects, recordAudits, vendorProfiles, workItemAudits } from "../../../db/schema";
import { upsertWorkItem } from "../../../lib/my-work";
import { SELECTION_RECORD_TYPE, parseSelectionData, selectionOptionTotal, type SelectionData, type SelectionOption } from "../../../lib/selections";
import { PURCHASE_ORDER_RECORD_TYPE, type PurchaseOrderData } from "../../../lib/purchase-orders";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { PROJECT_TEAM_ASSIGNMENT_TYPE, normalizeDesignations, parseRecordData, projectTeamAssignmentId } from "../../../lib/team-access";
import { ensureVendorSchema } from "../../../lib/vendor-portal";
import { domainEventStatements, reconcileDomainEvent } from "../../../lib/domain-outbox";
import { normalizeUploadContentType } from "../../../lib/photo-uploads";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

type SelectionInput = {
  action?: string; projectId?: string; recordId?: string; title?: string; category?: string; location?: string;
  description?: string; decisionType?: string; responsibleName?: string; linkedReference?: string; installationDate?: string;
  allowance?: number; quantity?: number; options?: SelectionOption[]; distributionReference?: string; selectedOptionId?: string;
  approverName?: string; approverTitle?: string; approverEmail?: string; evidenceReference?: string; decisionNote?: string;
  releaseReference?: string; installedAt?: string; installedBy?: string; installationEvidence?: string; reason?: string;
  costCode?: string; vendorId?: string; materialDescription?: string; manufacturer?: string; model?: string; color?: string;
  size?: string; unit?: string; unitCost?: number; requiredDeliveryDate?: string; paymentTerms?: string; sourceUrl?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  const { getDb } = await import("../../../db"); const db = getDb();
  const context = await selectionContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  if (!context.canView) return Response.json({ error: "Selections Access Is Required" }, { status: 403 });
  const [rows, audits, budgetRows, vendors, purchaseOrders] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, SELECTION_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    db.select().from(recordAudits).where(eq(recordAudits.projectId, projectId)).orderBy(desc(recordAudits.id)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control"]))),
    db.select().from(vendorProfiles).orderBy(vendorProfiles.legalName),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))),
  ]);
  const purchaseOrderStatus = new Map(purchaseOrders.map((order) => [order.id, order.status]));
  const today = new Date().toISOString().slice(0, 10);
  return Response.json({
    project: context.project,
    selections: rows.map((row) => {
      const parsed = parseSelectionData(row.dataJson);
      const data = { ...parsed, purchaseOrderStatus: parsed.purchaseOrderId ? purchaseOrderStatus.get(parsed.purchaseOrderId) || "Missing" : "Not Ordered" };
      const chosen = data.options.find((option) => option.id === data.selectedOptionId);
      return { ...row, data, selectedTotal: selectionOptionTotal(chosen, data.quantity), allowanceVariance: selectionOptionTotal(chosen, data.quantity) - data.allowance, overdue: !["Decision Recorded", "Released To Project Team", "Installed / Verified", "Cancelled", "Superseded"].includes(row.status) && Boolean(row.due && row.due < today), audits: audits.filter((audit) => audit.recordId === row.id) };
    }),
    permissions: { canView: context.canView, canManage: context.canManage, canVerifyInstallation: context.canVerify, canCancel: ["Company Owner", "Administrator"].includes(context.level) },
    budget: selectionBudgetSummary(budgetRows),
    vendors: vendors.map((vendor) => ({ id: vendor.id, name: vendor.legalName, status: vendor.status, paymentTerms: vendor.paymentTerms })),
    controls: { decisionDate: "Automatically calculated from the installation date, the longest option lead time, and a seven-day procurement buffer", authority: "A PM records the named Owner or Designer decision and its evidence; Command Center never makes the selection", impact: "Allowance variance requires a linked potential change order and an executed change order before release", release: "Release is a separate manual step; no email, order, or payment is automatic", revisions: "Issued decisions are revised through a linked permanent revision; originals are never overwritten" },
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  let sourceFile: File | null = null;
  let input: SelectionInput;
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await request.formData();
    const candidate = form.get("file");
    sourceFile = candidate instanceof File ? candidate : null;
    input = { action: String(form.get("action") || ""), projectId: String(form.get("projectId") || ""), recordId: String(form.get("recordId") || "") };
  } else input = await request.json() as SelectionInput;
  const projectId = input.projectId?.trim() || "";
  const { getDb } = await import("../../../db"); const db = getDb();
  const context = await selectionContext(db, actor, projectId);
  if (!context.project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const now = new Date().toISOString();

  if (input.action === "upload-source") {
    if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    const recordId = input.recordId?.trim() || "";
    const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, SELECTION_RECORD_TYPE))).limit(1))[0];
    if (!row) return Response.json({ error: "Selection Not Found" }, { status: 404 });
    if (!sourceFile) return Response.json({ error: "Choose A Product Page, Quote, Specification, Or Material Source File" }, { status: 400 });
    if (sourceFile.size > MAX_SOURCE_BYTES) return Response.json({ error: "Selection Source Files Must Be 25 MB Or Smaller" }, { status: 413 });
    const safeName = sourceFile.name.replace(/[^a-zA-Z0-9._ -]+/g, "-");
    const storageKey = `${projectId}/selections/${recordId}/${crypto.randomUUID()}-${safeName}`;
    const { env } = await import("cloudflare:workers");
    await ensureProjectFileSchema();
    const contentType = normalizeUploadContentType(sourceFile.name, sourceFile.type);
    await env.BUCKET.put(storageKey, sourceFile.stream(), { httpMetadata: { contentType }, customMetadata: { uploadedBy: context.email, category: "Selection Source", selectionId: recordId } });
    const [savedFile] = await db.insert(projectFiles).values({ projectId, name: sourceFile.name, category: "Selection Source", revision: recordId, storageKey, contentType, sizeBytes: sourceFile.size, uploadedBy: context.name, access: "Project team" }).returning();
    const data = parseSelectionData(row.dataJson);
    const next: SelectionData = { ...data, sourceFileId: savedFile.id, sourceFileName: savedFile.name, timeline: [...data.timeline, { action: "Purchase Source Uploaded", actor: context.name, at: now, detail: savedFile.name }] };
    await save(db, row, row.status, row.title, row.due, next, context, "Selection Source", data.sourceFileName || "None", savedFile.name, row.dateLocked);
    return Response.json({ saved: true, file: { id: savedFile.id, name: savedFile.name, url: `/api/files?id=${savedFile.id}` } }, { status: 201 });
  }

  if (input.action === "create") {
    if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    const fields = validateFields(input);
    if (fields.error) return Response.json({ error: fields.error }, { status: 400 });
    const id = await nextSelectionId(db, projectId);
    const due = safeDecisionDate(fields.installationDate, fields.options);
    const data: SelectionData = { category: fields.category, location: fields.location, description: fields.description, decisionType: fields.decisionType, responsibleName: fields.responsibleName, linkedReference: fields.linkedReference, installationDate: fields.installationDate, allowance: fields.allowance, quantity: fields.quantity, materialDescription: fields.description, costCode: "", vendorId: "", vendorName: "", size: "", unit: "EA", requiredDeliveryDate: fields.installationDate, paymentTerms: "Net 30", sourceUrl: "", sourceFileId: 0, sourceFileName: "", purchaseOrderId: "", purchaseOrderStatus: "Not Ordered", options: fields.options, selectedOptionId: "", decision: null, issuedAt: "", issuedBy: "", distributionReference: "", impactStatus: "Not Evaluated", impactRecordId: "", releaseReference: "", releasedAt: "", releasedBy: "", installedAt: "", installedBy: "", installationEvidence: "", revisionOf: "", revisionNumber: 0, supersededBy: "", timeline: [{ action: "Selection Draft Created", actor: context.name, at: now, detail: `${fields.category} · ${fields.location} · safe decision date ${due}` }] };
    await db.insert(commandRecords).values({ projectId, id, recordType: SELECTION_RECORD_TYPE, title: fields.title, owner: context.project.projectManager, due, status: "Draft", meta: `${fields.category} · ${fields.location} · ${fields.decisionType} Decision`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false, dataJson: JSON.stringify(data), updatedAt: now });
    await audit(db, projectId, id, context, "Selection Draft", "None", "Draft", "Controlled selection draft created; nothing was issued or selected automatically");
    return Response.json({ saved: true, recordId: id }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const row = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, SELECTION_RECORD_TYPE))).limit(1))[0];
  if (!row) return Response.json({ error: "Selection Not Found" }, { status: 404 });
  const data = parseSelectionData(row.dataJson);

  if (input.action === "update-procurement-row") {
    if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    if (["Cancelled", "Superseded"].includes(row.status)) return Response.json({ error: "A Closed Selection Procurement Row Cannot Be Changed" }, { status: 409 });
    const budgetRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control"])));
    const budget = selectionBudgetSummary(budgetRows);
    const costCode = input.costCode?.trim() || "";
    if (costCode && !budget.codes.some((code) => code.code === costCode)) return Response.json({ error: "Select A Cost Code From The Live Project Budget" }, { status: 409 });
    const vendorId = input.vendorId?.trim() || "";
    const vendor = vendorId ? (await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, vendorId)).limit(1))[0] : null;
    if (vendorId && !vendor) return Response.json({ error: "Select A Vendor From Vendor Management" }, { status: 409 });
    const requiredDeliveryDate = input.requiredDeliveryDate?.trim() || "";
    if (requiredDeliveryDate && !validDate(requiredDeliveryDate)) return Response.json({ error: "Enter A Valid Required Delivery Date" }, { status: 400 });
    const sourceUrl = input.sourceUrl?.trim() || "";
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return Response.json({ error: "The Purchase Source Must Start With http:// Or https://" }, { status: 400 });
    const optionId = data.selectedOptionId || data.options[0]?.id || "";
    const options = data.options.map((option) => option.id === optionId ? { ...option, manufacturer: input.manufacturer?.trim() ?? option.manufacturer, model: input.model?.trim() ?? option.model, color: input.color?.trim() ?? option.color, unitCost: input.unitCost === undefined ? option.unitCost : Math.max(0, Number(input.unitCost || 0)) } : option);
    const next: SelectionData = { ...data, materialDescription: input.materialDescription?.trim() || data.materialDescription || data.description, costCode, vendorId, vendorName: vendor?.legalName || "", size: input.size?.trim() || "", unit: input.unit?.trim() || "EA", quantity: Math.max(1, Math.round(Number(input.quantity || data.quantity))), requiredDeliveryDate: requiredDeliveryDate || data.installationDate, paymentTerms: input.paymentTerms?.trim() || vendor?.paymentTerms || data.paymentTerms || "Net 30", sourceUrl, options, timeline: [...data.timeline, { action: "Procurement Schedule Updated", actor: context.name, at: now, detail: `${costCode || "No cost code"} · ${vendor?.legalName || "Vendor not assigned"} · ${requiredDeliveryDate || data.installationDate}` }] };
    await save(db, row, row.status, row.title, row.due, next, context, "Procurement Schedule", "Previous Row", "Updated", row.dateLocked);
    return Response.json({ saved: true });
  }

  if (input.action === "create-purchase-order") {
    if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    if (data.purchaseOrderId) {
      const linked = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, data.purchaseOrderId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))).limit(1))[0];
      return Response.json({ saved: true, purchaseOrderId: data.purchaseOrderId, status: linked?.status || "Missing", existing: true });
    }
    if (!["Decision Recorded", "Released To Project Team"].includes(row.status)) return Response.json({ error: "Record The Human Selection Decision Before Creating Its Purchase Order" }, { status: 409 });
    if (data.impactStatus === "Commercial Review Required") return Response.json({ error: "Resolve The Selection Allowance Variance Before Creating Its Purchase Order" }, { status: 409 });
    if (data.impactRecordId) { const pco = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, data.impactRecordId), eq(commandRecords.recordType, "Change Orders"))).limit(1))[0]; if (!pco || pco.status !== "Executed") return Response.json({ error: `${data.impactRecordId} Must Be Executed Before A Purchase Order Is Created` }, { status: 409 }); }
    const chosen = data.options.find((option) => option.id === data.selectedOptionId);
    if (!chosen) return Response.json({ error: "The Recorded Human Decision Must Identify The Selected Material Option" }, { status: 409 });
    const vendor = (await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, data.vendorId)).limit(1))[0];
    if (!vendor) return Response.json({ error: "Assign A Vendor From Vendor Management In The Selection Schedule" }, { status: 409 });
    const budgetRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), inArray(commandRecords.recordType, ["Budget", "Budget Control"])));
    const budget = selectionBudgetSummary(budgetRows);
    const code = budget.codes.find((item) => item.code === data.costCode);
    if (!code) return Response.json({ error: "Assign A Live Project Budget Cost Code Before Creating The Purchase Order" }, { status: 409 });
    if (!validDate(data.requiredDeliveryDate)) return Response.json({ error: "Set The Required Delivery Date Before Creating The Purchase Order" }, { status: 409 });
    const amount = selectionOptionTotal(chosen, data.quantity);
    if (amount <= 0) return Response.json({ error: "Record A Positive Unit Cost Before Creating The Purchase Order" }, { status: 409 });
    const poId = await nextPurchaseOrderId(db, projectId);
    const specification = [chosen.label, chosen.manufacturer, chosen.model, chosen.color, data.size].filter(Boolean).join(" · ");
    const poData: PurchaseOrderData = { vendorId: vendor.id, vendor: vendor.legalName, contactName: vendor.contactName, contactEmail: vendor.contactEmail, contactPhone: vendor.contactPhone, vendorAddress: formatVendorAddress(vendor.addressJson), amount, costCode: data.costCode, trade: data.category, scope: `${data.materialDescription || data.description}\nSelected material: ${specification}\nQuantity: ${data.quantity} ${data.unit}`.trim(), exclusions: "", deliveryLocation: context.project.site, requiredBy: data.requiredDeliveryDate, paymentTerms: data.paymentTerms || vendor.paymentTerms || "Net 30", freightTerms: "FOB Destination", taxIncluded: "Included", warranty: "Manufacturer standard warranty", specialInstructions: data.sourceUrl ? `Purchase source: ${data.sourceUrl}` : data.sourceFileName ? `Purchase source file: ${data.sourceFileName}` : "", sourceSelectionId: row.id, sourceBidPackageId: "", sourceBidRevisionId: "", procurementArchiveProjectId: projectId, ownerApproval: null, approvalRequired: false, approvalReasons: [], budgetAvailableAtSubmit: code.available, releasedAt: "", releasedBy: "", distributionReference: "", acknowledgedAt: "", acknowledgedBy: "", acknowledgmentReference: "", revisionOf: "", revisionNumber: 0, supersededBy: "", timeline: [{ action: "Controlled Draft Created From Selection", actor: context.name, at: now, detail: `${row.id} · ${vendor.legalName} · ${money(amount)} · no approval or release occurred` }] };
    await db.insert(commandRecords).values({ projectId, id: poId, recordType: PURCHASE_ORDER_RECORD_TYPE, title: `${vendor.legalName} · ${data.materialDescription || row.title}`, owner: context.name, due: data.requiredDeliveryDate, status: "Draft", meta: `${data.costCode} · ${money(amount)} · From ${row.id}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false, dataJson: JSON.stringify(poData), updatedAt: now });
    await audit(db, projectId, poId, context, "Purchase Order Draft", "None", "Draft", `Created from ${row.id}; no approval, release, or vendor delivery occurred`);
    const next: SelectionData = { ...data, purchaseOrderId: poId, purchaseOrderStatus: "Draft", timeline: [...data.timeline, { action: "Purchase Order Draft Created", actor: context.name, at: now, detail: `${poId} · ${money(amount)} · linked to this selection` }] };
    await save(db, row, row.status, row.title, row.due, next, context, "Purchase Order Link", "Not Ordered", `${poId} · Draft`, row.dateLocked);
    return Response.json({ saved: true, purchaseOrderId: poId, status: "Draft" }, { status: 201 });
  }

  if (input.action === "update-draft") {
    if (!context.canManage) return Response.json({ error: "Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    if (![("Draft"), "Returned"].includes(row.status)) return Response.json({ error: "Only A Draft Or Returned Selection May Be Edited" }, { status: 423 });
    const fields = validateFields(input); if (fields.error) return Response.json({ error: fields.error }, { status: 400 });
    const due = safeDecisionDate(fields.installationDate, fields.options);
    const next: SelectionData = { ...data, category: fields.category, location: fields.location, description: fields.description, decisionType: fields.decisionType, responsibleName: fields.responsibleName, linkedReference: fields.linkedReference, installationDate: fields.installationDate, allowance: fields.allowance, quantity: fields.quantity, options: fields.options, selectedOptionId: "", decision: null, impactStatus: "Not Evaluated", impactRecordId: "", timeline: [...data.timeline, { action: "Draft Updated", actor: context.name, at: now, detail: input.reason?.trim() || "Options and decision controls updated before issuance" }] };
    await save(db, row, "Draft", input.title?.trim() || row.title, due, next, context, "Draft Update", row.status, "Draft"); return Response.json({ saved: true });
  }

  if (input.action === "issue") {
    if (!context.canManage) return Response.json({ error: "Project Manager Authorization Is Required To Issue A Selection" }, { status: 403 });
    if (!["Draft", "Returned"].includes(row.status)) return Response.json({ error: "This Selection Is Not Ready For Issuance" }, { status: 409 });
    const reference = input.distributionReference?.trim() || "";
    if (reference.length < 5) return Response.json({ error: "Record The Manual Delivery Method Or Distribution Reference" }, { status: 400 });
    if (!data.options.length || !data.responsibleName) return Response.json({ error: "At Least One Complete Option And A Responsible Decision Party Are Required" }, { status: 409 });
    const next: SelectionData = { ...data, issuedAt: now, issuedBy: context.name, distributionReference: reference, timeline: [...data.timeline, { action: "Selection Request Issued", actor: context.name, at: now, detail: `${data.decisionType}: ${data.responsibleName} · ${reference}` }] };
    await save(db, row, "Awaiting Decision", row.title, row.due, next, context, "Controlled Issuance", row.status, "Awaiting Decision", true);
    if (context.pm) await upsertWorkItem(db, { dedupeKey: selectionWorkKey(projectId, row.id, context.pm.email), projectId, recipientName: context.pm.displayName, recipientEmail: context.pm.email, kind: "Selection Decision", title: `Obtain ${row.id} · ${row.title}`, message: `${data.responsibleName} must decide by ${row.due}. Record the named human decision and evidence in Selections.`, priority: row.due <= now.slice(0, 10) ? "Critical" : "High", sourceType: SELECTION_RECORD_TYPE, sourceRecordId: row.id, actionTarget: "Selections", dueAt: `${row.due}T17:00:00.000Z`, createdBy: context.name });
    return Response.json({ saved: true, status: "Awaiting Decision" });
  }

  if (input.action === "record-decision") {
    if (!context.canManage) return Response.json({ error: "Project Manager Authorization Is Required To Record The Human Decision" }, { status: 403 });
    if (row.status !== "Awaiting Decision") return Response.json({ error: "An Issued Selection Request Is Required" }, { status: 409 });
    const selected = data.options.find((option) => option.id === input.selectedOptionId);
    const approverName = input.approverName?.trim() || ""; const evidence = input.evidenceReference?.trim() || "";
    if (!selected || approverName.length < 2 || evidence.length < 5) return Response.json({ error: "Selected Option, Named Human Approver, And Evidence Reference Are Required" }, { status: 400 });
    const selectedTotal = selectionOptionTotal(selected, data.quantity); const variance = selectedTotal - data.allowance;
    const next: SelectionData = { ...data, selectedOptionId: selected.id, decision: { approverName, approverTitle: input.approverTitle?.trim() || data.decisionType, approverEmail: input.approverEmail?.trim() || "", evidenceReference: evidence, note: input.decisionNote?.trim() || "", recordedBy: context.name, recordedByEmail: context.email, decidedAt: now, selectedTotal, allowanceVariance: variance }, impactStatus: variance === 0 ? "No Cost Impact" : "Commercial Review Required", timeline: [...data.timeline, { action: "Human Decision Recorded", actor: context.name, at: now, detail: `${approverName} selected ${selected.label} · evidence ${evidence} · allowance variance ${money(variance)}` }] };
    await save(db, row, "Decision Recorded", row.title, row.due, next, context, "Selection Decision", "Awaiting Decision", "Decision Recorded", true);
    await closeSelectionWork(db, projectId, row.id, context.pm?.email || "", context);
    return Response.json({ saved: true, status: "Decision Recorded", commercialReviewRequired: variance !== 0 });
  }

  if (input.action === "create-impact-review") {
    if (!context.canManage) return Response.json({ error: "Project Manager Authorization Is Required" }, { status: 403 });
    if (row.status !== "Decision Recorded" || data.impactStatus !== "Commercial Review Required" || data.impactRecordId) return Response.json({ error: "A New Unlinked Allowance Variance Is Required" }, { status: 409 });
    const chosen = data.options.find((option) => option.id === data.selectedOptionId); const variance = selectionOptionTotal(chosen, data.quantity) - data.allowance;
    const pcoId = await nextPcoId(db, projectId);
    const pcoData = { description: `${row.id} selection allowance variance for ${chosen?.label || row.title}`, reason: "Selection Allowance Variance", requestedBy: String(data.decision?.approverName || data.responsibleName), submittedBy: context.name, relatedReference: row.id, scheduleImpact: "Unknown", scheduleDays: 0, attachments: [], costStatus: "To Be Determined", pricingLines: [{ id: `${pcoId}-SEL`, category: "Selection", costCode: "", description: `${chosen?.label || row.title} allowance variance`, cost: Math.abs(variance), markupPercent: 0 }], pricingNotes: `Selected total ${money(selectionOptionTotal(chosen, data.quantity))}; allowance ${money(data.allowance)}. Validate supplier quote, applicable markup, tax, and scope before any release.`, changeType: variance < 0 ? "Deductive" : "Additive", approvedTotal: 0, originalContractValue: 0, previousApprovedChangeOrders: 0, contractValueAfterThisChange: 0, newSubstantialDate: "", newFinalDate: "", workflowHistory: [`${now} · Created from ${row.id} by ${context.name}; no pricing, release, or approval occurred automatically.`] };
    await db.insert(commandRecords).values({ projectId, id: pcoId, recordType: "Change Orders", title: `${row.id} · ${row.title}`, owner: context.project.projectManager, due: row.due, status: "Open", meta: `${row.id} Selection Impact · ${money(variance)} Preliminary Variance`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(pcoData), updatedAt: now });
    const next: SelectionData = { ...data, impactStatus: "Potential Change Order Created", impactRecordId: pcoId, timeline: [...data.timeline, { action: "Commercial Review Created", actor: context.name, at: now, detail: `${pcoId} created as an unapproved potential change order for ${money(variance)}` }] };
    await save(db, row, row.status, row.title, row.due, next, context, "Commercial Impact", "Commercial Review Required", `Linked ${pcoId}`, true);
    return Response.json({ saved: true, impactRecordId: pcoId }, { status: 201 });
  }

  if (input.action === "release") {
    if (!context.canManage) return Response.json({ error: "Project Manager Authorization Is Required To Release A Selection" }, { status: 403 });
    if (row.status !== "Decision Recorded") return Response.json({ error: "A Recorded Human Decision Is Required Before Release" }, { status: 409 });
    if (data.impactRecordId) { const pco = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, data.impactRecordId), eq(commandRecords.recordType, "Change Orders"))).limit(1))[0]; if (!pco || pco.status !== "Executed") return Response.json({ error: `${data.impactRecordId} Must Be Fully Executed Before This Cost-Impacting Selection Is Released` }, { status: 409 }); }
    if (data.impactStatus === "Commercial Review Required") return Response.json({ error: "Create And Resolve The Linked Commercial Review Before Release" }, { status: 409 });
    const reference = input.releaseReference?.trim() || ""; if (reference.length < 5) return Response.json({ error: "A Manual Project-Team Release Reference Is Required" }, { status: 400 });
    const next: SelectionData = { ...data, releaseReference: reference, releasedAt: now, releasedBy: context.name, timeline: [...data.timeline, { action: "Selection Released To Project Team", actor: context.name, at: now, detail: `Manual release ${reference}; no order, email, or payment was automatic` }] };
    const { env } = await import("cloudflare:workers");
    const eventId = `selection-released:${projectId}:${row.id}:${data.revisionNumber}`;
    const eventStatements = domainEventStatements(env.DB, {
      id: eventId,
      idempotencyKey: eventId,
      eventType: "selection.released",
      aggregateType: SELECTION_RECORD_TYPE,
      aggregateId: row.id,
      projectId,
      actorName: context.name,
      actorEmail: context.email,
      occurredAt: now,
      payload: { projectId, selectionId: row.id, revisionNumber: data.revisionNumber, releaseReference: reference, purchaseOrderId: data.purchaseOrderId || "" },
      consumers: [
        { key: "procurement-register", completedInSourceTransaction: true, result: { status: "Released To Project Team" } },
        { key: "purchase-order-draft", completedInSourceTransaction: true, result: { purchaseOrderId: data.purchaseOrderId || "Not Yet Created", automaticRelease: false } },
        { key: "selection-audit-history", completedInSourceTransaction: true, result: { field: "Project Team Release", reference } },
      ],
    });
    await env.DB.batch([
      env.DB.prepare(`UPDATE command_records SET status = 'Released To Project Team', title = ?, due = ?, owner = ?, meta = ?, date_locked = 1, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(row.title, row.due, row.owner, `${next.category} · ${next.location} · Released To Project Team`, JSON.stringify(next), now, projectId, row.id),
      env.DB.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary) VALUES (?, ?, 'Project Team Release', 'Decision Recorded', 'Released To Project Team', 'release', ?, ?, ?)`).bind(projectId, row.id, context.name, context.email, `Project Team Release: Decision Recorded → Released To Project Team · ${reference}`),
      ...eventStatements,
    ]);
    const handoff = await reconcileDomainEvent(env.DB, eventId);
    return Response.json({ saved: true, handoff: { eventId, status: handoff?.status || "Partially Applied", consumers: handoff?.consumers || [] } });
  }

  if (input.action === "verify-installation") {
    if (!context.canVerify) return Response.json({ error: "Superintendent, Project Manager, Administrator, Or Owner Authorization Is Required" }, { status: 403 });
    if (row.status !== "Released To Project Team") return Response.json({ error: "The Approved Selection Must Be Released Before Installation Verification" }, { status: 409 });
    const installedAt = input.installedAt?.trim() || ""; const installedBy = input.installedBy?.trim() || context.name; const evidence = input.installationEvidence?.trim() || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(installedAt) || installedBy.length < 2 || evidence.length < 5) return Response.json({ error: "Installation Date, Verifier, And Evidence Reference Are Required" }, { status: 400 });
    const next: SelectionData = { ...data, installedAt, installedBy, installationEvidence: evidence, timeline: [...data.timeline, { action: "Installation Verified", actor: context.name, at: now, detail: `${installedBy} verified installed selection · ${evidence}` }] };
    await save(db, row, "Installed / Verified", row.title, row.due, next, context, "Installation Verification", "Released To Project Team", "Installed / Verified", true); return Response.json({ saved: true });
  }

  if (input.action === "create-revision") {
    if (!context.canManage) return Response.json({ error: "Project Manager Authorization Is Required" }, { status: 403 });
    if (!["Awaiting Decision", "Decision Recorded", "Released To Project Team"].includes(row.status)) return Response.json({ error: "This Selection Does Not Require A Controlled Revision" }, { status: 409 });
    const reason = input.reason?.trim() || ""; if (reason.length < 10) return Response.json({ error: "A Specific Revision Reason Is Required" }, { status: 400 });
    const revisionNumber = data.revisionNumber + 1; const revisionId = `${row.id.replace(/-R\d+$/, "")}-R${revisionNumber}`;
    const revision: SelectionData = { ...data, selectedOptionId: "", decision: null, issuedAt: "", issuedBy: "", distributionReference: "", impactStatus: "Not Evaluated", impactRecordId: "", releaseReference: "", releasedAt: "", releasedBy: "", installedAt: "", installedBy: "", installationEvidence: "", purchaseOrderId: "", purchaseOrderStatus: "Not Ordered", revisionOf: row.id, revisionNumber, supersededBy: "", timeline: [...data.timeline, { action: "Revision Draft Created", actor: context.name, at: now, detail: reason }] };
    await db.insert(commandRecords).values({ projectId, id: revisionId, recordType: SELECTION_RECORD_TYPE, title: row.title, owner: row.owner, due: safeDecisionDate(data.installationDate, data.options), status: "Draft", meta: `${data.category} · Revision ${revisionNumber}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false, dataJson: JSON.stringify(revision), updatedAt: now });
    const prior: SelectionData = { ...data, supersededBy: revisionId, timeline: [...data.timeline, { action: "Superseded By Revision", actor: context.name, at: now, detail: `${revisionId} · ${reason}` }] };
    await save(db, row, "Superseded", row.title, row.due, prior, context, "Controlled Revision", row.status, `Superseded By ${revisionId}`, true); return Response.json({ saved: true, revisionId }, { status: 201 });
  }

  if (input.action === "cancel") {
    if (!["Company Owner", "Administrator"].includes(context.level)) return Response.json({ error: "Owner Or Administrator Authorization Is Required" }, { status: 403 });
    const reason = input.reason?.trim() || ""; if (reason.length < 10) return Response.json({ error: "A Specific Cancellation Reason Is Required" }, { status: 400 });
    if (["Cancelled", "Superseded", "Installed / Verified"].includes(row.status)) return Response.json({ error: "This Selection Is Already Permanently Closed" }, { status: 409 });
    const next: SelectionData = { ...data, timeline: [...data.timeline, { action: "Selection Cancelled", actor: context.name, at: now, detail: reason }] };
    await save(db, row, "Cancelled", row.title, row.due, next, context, "Cancellation", row.status, "Cancelled", true); return Response.json({ saved: true });
  }
  return Response.json({ error: "A Valid Selection Action Is Required" }, { status: 400 });
}

async function selectionContext(db: ReturnType<typeof import("../../../db").getDb>, actor: ReturnType<typeof getCommandActor>, projectId: string) {
  const [projectRows, memberRows] = await Promise.all([db.select().from(projects).where(eq(projects.number, projectId)).limit(1), db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1)]);
  const project = projectRows[0] || null; const member = memberRows[0]; const level = member?.companyAccessLevel || actor.accessLevel; let designations = normalizeDesignations(parseJsonArray(member?.designationsJson));
  if (project && member) { const assignment = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, projectTeamAssignmentId(member.email)), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))).limit(1))[0]; if (assignment) designations = normalizeDesignations(parseRecordData(assignment.dataJson).projectDesignations); }
  if (project) designations = await projectDesignationsFor(db, actor, project, designations);
  const name = member?.displayName || actor.name; const elevated = ["Company Owner", "Administrator"].includes(level); const isPm = designations.includes("Project Manager") || project?.projectManager === name; const isSuper = designations.includes("Superintendent") || project?.superintendent === name; const office = designations.includes("Office Staff");
  const pm = project ? (await db.select().from(companyMembers).where(eq(companyMembers.displayName, project.projectManager)).limit(1))[0] || null : null;
  return { ...actor, name, level, project, pm, canView: Boolean(member?.isActive && (elevated || isPm || isSuper || office)), canManage: Boolean(member?.isActive && (elevated || isPm)), canVerify: Boolean(member?.isActive && (elevated || isPm || isSuper)) };
}

function validateFields(input: SelectionInput) {
  const title = input.title?.trim() || ""; const category = input.category?.trim() || ""; const location = input.location?.trim() || ""; const description = input.description?.trim() || ""; const decisionType = input.decisionType?.trim() || "Owner"; const responsibleName = input.responsibleName?.trim() || ""; const linkedReference = input.linkedReference?.trim() || ""; const installationDate = input.installationDate?.trim() || ""; const allowance = Number(input.allowance || 0); const quantity = Math.max(1, Math.round(Number(input.quantity || 1))); const options = normalizeOptions(input.options);
  const error = title.length < 4 || !category || location.length < 2 || description.length < 10 || responsibleName.length < 2 || !validDate(installationDate) || !Number.isFinite(allowance) || allowance < 0 || !options.length ? "Title Category Location Detailed Description Responsible Decision Party Valid Installation Date Nonnegative Allowance And At Least One Complete Option Are Required" : "";
  return { title, category, location, description, decisionType, responsibleName, linkedReference, installationDate, allowance, quantity, options, error };
}

function normalizeOptions(value: unknown): SelectionOption[] { if (!Array.isArray(value)) return []; return value.map((item, index) => { const option = item && typeof item === "object" ? item as Record<string, unknown> : {}; return { id: String(option.id || `OPT-${index + 1}`), label: String(option.label || "").trim(), manufacturer: String(option.manufacturer || "").trim(), model: String(option.model || "").trim(), color: String(option.color || "").trim(), unitCost: Number(option.unitCost || 0), leadDays: Math.max(0, Math.round(Number(option.leadDays || 0))), notes: String(option.notes || "").trim() }; }).filter((option) => option.label && Number.isFinite(option.unitCost) && option.unitCost >= 0 && Number.isFinite(option.leadDays)); }
function safeDecisionDate(installationDate: string, options: SelectionOption[]) { const lead = Math.max(0, ...options.map((option) => option.leadDays)) + 7; const date = new Date(`${installationDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - lead); return date.toISOString().slice(0, 10); }
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
async function nextSelectionId(db: ReturnType<typeof import("../../../db").getDb>, projectId: string) { const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, SELECTION_RECORD_TYPE))); const next = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/^SEL-(\d+)/)?.[1] || 0)), 0) + 1; return `SEL-${String(next).padStart(3, "0")}`; }
async function nextPcoId(db: ReturnType<typeof import("../../../db").getDb>, projectId: string) { const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Change Orders"))); const next = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/^PCO-(\d+)/)?.[1] || 0)), 0) + 1; return `PCO-${String(next).padStart(3, "0")}`; }
async function nextPurchaseOrderId(db: ReturnType<typeof import("../../../db").getDb>, projectId: string) { const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))); const next = rows.reduce((max, row) => Math.max(max, Number(row.id.match(/^PO-(\d+)/)?.[1] || 0)), 0) + 1; return `PO-${String(next).padStart(3, "0")}`; }
function selectionBudgetSummary(rows: typeof commandRecords.$inferSelect[]) {
  const control = rows.find((row) => row.recordType === "Budget Control");
  const controls = parseRecordData(control?.dataJson);
  const codes = rows.filter((row) => row.recordType === "Budget").map((row) => { const data = parseRecordData(row.dataJson); const original = Number(data.originalBudget || 0); const changes = Number(data.approvedChanges || 0); const committed = Number(data.committedCost || 0); return { code: String(data.code || row.id), description: String(data.description || row.title), budget: original + changes, available: original + changes - committed, selected: data.selectedForProject === true || original !== 0 || changes !== 0 }; }).filter((item) => item.selected);
  return { locked: controls.locked === true, codes };
}
function formatVendorAddress(value: string) { try { const address = JSON.parse(value || "{}") as Record<string, unknown>; const cityLine = [address.city, address.state, address.postalCode].filter(Boolean).map(String).join(" "); return [address.street, cityLine].filter(Boolean).map(String).join(", "); } catch { return ""; } }
async function save(db: ReturnType<typeof import("../../../db").getDb>, row: typeof commandRecords.$inferSelect, status: string, title: string, due: string, data: SelectionData, actor: { name: string; email: string }, field: string, oldValue: string, newValue: string, locked = false) { await db.update(commandRecords).set({ status, title, due, owner: row.owner, meta: `${data.category} · ${data.location} · ${status}`, dateLocked: locked || row.dateLocked, dataJson: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id))); await audit(db, row.projectId, row.id, actor, field, oldValue, newValue, `${field}: ${oldValue} → ${newValue}`); }
async function audit(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, recordId: string, actor: { name: string; email: string }, fieldName: string, oldValue: string, newValue: string, reason: string) { await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason, actorName: actor.name, actorEmail: actor.email, summary: `${recordId} · ${reason}` }); const { reconcileProjectHealthAfterUpdate } = await import("../project-health/route"); await reconcileProjectHealthAfterUpdate(projectId, actor); }
function selectionWorkKey(projectId: string, recordId: string, email: string) { return `selection:${projectId}:${recordId}:${email}`; }
async function closeSelectionWork(db: ReturnType<typeof import("../../../db").getDb>, projectId: string, recordId: string, email: string, actor: { name: string; email: string }) { if (!email) return; const key = selectionWorkKey(projectId, recordId, email); const item = (await db.select().from(commandWorkItems).where(eq(commandWorkItems.dedupeKey, key)).limit(1))[0]; if (!item) return; const now = new Date().toISOString(); await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(eq(commandWorkItems.id, item.id)); await db.insert(workItemAudits).values({ workItemId: item.id, action: "Completed From Source", actorName: actor.name, actorEmail: actor.email, detail: `${recordId} human decision was recorded with evidence.` }); }
function parseJsonArray(value?: string | null) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
