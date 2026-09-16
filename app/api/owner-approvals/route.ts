import { and, desc, eq, inArray } from "drizzle-orm";
import { commandRecords, commandWorkItems, ownerApprovalSnapshots, projects, recordAudits } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import { buildOwnerApprovalQueue, type ApprovalSourceRecord, type OwnerApprovalItem } from "../../../lib/owner-approval-center";
import { OWNER_PROPOSAL_RECORD_TYPE, normalizeProposalData, proposalIssueErrors } from "../../../lib/proposals";
import { resolveCommandActor } from "../../../lib/server-actor";
import { calculateEstimateSummary, estimateOverrideReport, normalizeEstimateData } from "../../estimate-template";
import { POST as accountingPost } from "../accounting/route";
import { POST as procurementPost } from "../procurement/route";
import { POST as purchaseOrderPost } from "../purchase-orders/route";
import { POST as teamAccessPost } from "../team-access/route";

type DecisionPayload = { action?: "decide"; approvalItemId?: string; decision?: "Approved" | "Returned"; note?: string };

function recordData(value: string) {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

async function loadQueue(db: ReturnType<(typeof import("../../../db"))["getDb"]>) {
  const [rows, projectRows] = await Promise.all([
    db.select().from(commandRecords),
    db.select({ number: projects.number, name: projects.name }).from(projects),
  ]);
  const records: ApprovalSourceRecord[] = rows.map((row) => ({ projectId: row.projectId, id: row.id, recordType: row.recordType, title: row.title, owner: row.owner, due: row.due, status: row.status, meta: row.meta, data: recordData(row.dataJson), updatedAt: row.updatedAt }));
  return buildOwnerApprovalQueue(records, new Map(projectRows.map((project) => [project.number, project.name])));
}

async function packetHash(packetJson: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(packetJson));
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function forwardedRequest(request: Request, path: string, body: Record<string, unknown>) {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(new URL(path, request.url), { method: "POST", headers, body: JSON.stringify(body) });
}

async function dispatchExistingWorkflow(request: Request, item: OwnerApprovalItem, decision: "Approved" | "Returned", note: string) {
  if (item.adapter === "purchase-order") return purchaseOrderPost(forwardedRequest(request, `/api/purchase-orders?projectId=${encodeURIComponent(item.projectId)}`, { action: "owner-decision", projectId: item.projectId, recordId: item.recordId, decision, note }));
  if (item.adapter === "procurement") {
    const scope = item.projectId === "MEFFORD-SALES" ? "Sales" : "Project";
    const body = item.adapterAction === "approve-coverage-exception"
      ? { action: "approve-coverage-exception", scope, projectId: item.projectId, recordId: item.recordId }
      : { action: "owner-decision", scope, projectId: item.projectId, recordId: item.recordId, decision, note };
    return procurementPost(forwardedRequest(request, "/api/procurement", body));
  }
  if (item.adapter === "accounting") return accountingPost(forwardedRequest(request, "/api/accounting", { action: item.adapterAction, recordId: item.recordId }));
  if (item.adapter === "team-access") return teamAccessPost(forwardedRequest(request, "/api/team-access", { action: "decide-request", projectId: item.projectId, requestId: item.recordId, decision: decision === "Approved" ? "Approved" : "Rejected", decisionNote: note }));
  return Response.json({ error: "This Item Must Be Decided Inside Its Source Workflow" }, { status: 409 });
}

async function decideEstimate(db: ReturnType<(typeof import("../../../db"))["getDb"]>, item: OwnerApprovalItem, decision: "Approved" | "Returned", note: string, actor: { name: string; email: string }) {
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, item.projectId), eq(commandRecords.id, item.recordId), eq(commandRecords.recordType, "Sales Opportunities"))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Estimate Opportunity Not Found" }, { status: 404 });
  const data = recordData(row.dataJson);
  const estimate = normalizeEstimateData(data.estimate);
  if (estimate.status !== "Ready For Review") return Response.json({ error: "Only A Submitted Estimate Can Be Decided" }, { status: 409 });
  const now = new Date().toISOString();
  if (decision === "Returned") {
    if (note.trim().length < 8) return Response.json({ error: "A Specific Return Explanation Is Required" }, { status: 400 });
    const next = { ...estimate, status: "Draft" as const, returnedBy: actor.name, returnedAt: now, returnReason: note.trim(), approvedAt: undefined, approvedBy: undefined };
    await db.batch([
      db.update(commandRecords).set({ status: row.status, dataJson: JSON.stringify({ ...data, estimateStatus: "In Progress", estimate: next }), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id))),
      db.insert(recordAudits).values({ projectId: row.projectId, recordId: row.id, fieldName: "Estimate Owner Decision", oldValue: "Ready For Review", newValue: "Returned", reason: note.trim(), actorName: actor.name, actorEmail: actor.email, summary: `Estimate returned by Company Owner: ${note.trim()}` }),
    ]);
    return Response.json({ saved: true, status: "Returned" });
  }
  const summary = calculateEstimateSummary(estimate);
  if (summary.directJobCost <= 0 || Math.abs(summary.reconciliationDifference) > 0.01) return Response.json({ error: "The Estimate Must Have Positive Reconciled Job Cost Before Approval" }, { status: 409 });
  const next = { ...estimate, status: "Approved" as const, approvedAt: now, approvedBy: actor.name, approvedByEmail: actor.email, approvalNote: note.trim(), submittedOverrideReport: estimate.submittedOverrideReport ?? estimateOverrideReport(estimate), savedAt: now, savedBy: actor.name };
  await db.batch([
    db.update(commandRecords).set({ dataJson: JSON.stringify({ ...data, estimateStatus: "Approved", estimatedValue: summary.contractValue.toFixed(2), estimate: next }), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id))),
    db.insert(recordAudits).values({ projectId: row.projectId, recordId: row.id, fieldName: "Estimate Owner Decision", oldValue: "Ready For Review", newValue: "Approved", reason: note.trim() || "Approved from Owner Approval Center", actorName: actor.name, actorEmail: actor.email, summary: `Estimate approved at $${summary.contractValue.toFixed(2)} with ${next.submittedOverrideReport.length} precalculated override(s).` }),
  ]);
  return Response.json({ saved: true, status: "Approved" });
}

async function decideOwnerProposal(db: ReturnType<(typeof import("../../../db"))["getDb"]>, item: OwnerApprovalItem, decision: "Approved" | "Returned", note: string, actor: { name: string; email: string }) {
  const rows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, item.projectId),
    eq(commandRecords.id, item.recordId),
    eq(commandRecords.recordType, OWNER_PROPOSAL_RECORD_TYPE),
  )).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Owner Proposal Not Found" }, { status: 404 });
  if (row.status !== "Ready For Review") return Response.json({ error: "Only A Proposal Waiting For Review Can Be Decided" }, { status: 409 });
  const data = normalizeProposalData(recordData(row.dataJson));
  const now = new Date().toISOString();
  const nextStatus = decision === "Approved" ? "Approved To Send" : "Draft";
  if (decision === "Approved") {
    const errors = proposalIssueErrors(data);
    if (errors.length) return Response.json({ error: `Complete Before Approval: ${errors.join(", ")}`, missing: errors }, { status: 409 });
  }
  const nextData = normalizeProposalData({ ...data, status: nextStatus, updatedAt: now, updatedBy: actor.name });
  await db.update(commandRecords).set({
    status: nextStatus,
    meta: `${nextData.ownerName || "Owner Pending"} · $${nextData.contractPrice.toFixed(2)} · R${nextData.revision} · ${nextStatus}`,
    dataJson: JSON.stringify(nextData),
    updatedAt: now,
  }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));

  const opportunityRows = nextData.opportunityId ? await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, row.projectId),
    eq(commandRecords.id, nextData.opportunityId),
    eq(commandRecords.recordType, "Sales Opportunities"),
  )).limit(1) : [];
  if (opportunityRows[0]) {
    const opportunityData = recordData(opportunityRows[0].dataJson);
    const proposalHandoff = opportunityData.proposalHandoff && typeof opportunityData.proposalHandoff === "object" && !Array.isArray(opportunityData.proposalHandoff)
      ? opportunityData.proposalHandoff as Record<string, unknown>
      : {};
    await db.update(commandRecords).set({
      dataJson: JSON.stringify({ ...opportunityData, proposalStatus: nextStatus, proposalHandoff: { ...proposalHandoff, status: nextStatus } }),
      updatedAt: now,
    }).where(and(eq(commandRecords.projectId, opportunityRows[0].projectId), eq(commandRecords.id, opportunityRows[0].id)));
  }

  await ensureMyWorkTables();
  await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(and(
    eq(commandWorkItems.sourceType, OWNER_PROPOSAL_RECORD_TYPE),
    eq(commandWorkItems.sourceRecordId, row.id),
    inArray(commandWorkItems.status, ["Open", "Acknowledged", "Snoozed"]),
  ));
  if (decision === "Approved") {
    await upsertWorkItem(db, {
      dedupeKey: `proposal-release:${row.id}:R${nextData.revision}:${actor.email}`,
      projectId: row.projectId,
      recipientName: actor.name,
      recipientEmail: actor.email,
      kind: "Proposal Release",
      title: `Send ${nextData.projectName} Proposal To ${nextData.ownerName || "Project Owner"}`,
      message: `Revision ${nextData.revision} is approved. Open the estimate and select Send To Project Owner.`,
      priority: "High",
      sourceType: "Owner Proposal Release",
      sourceRecordId: nextData.opportunityId,
      actionTarget: "Estimating",
      dueAt: now,
      createdBy: actor.name,
    });
  }
  await db.insert(recordAudits).values({
    projectId: row.projectId,
    recordId: row.id,
    fieldName: "Owner Proposal Decision",
    oldValue: "Ready For Review",
    newValue: nextStatus,
    reason: note || (decision === "Approved" ? "Approved From Owner Approval Center" : "Returned By Company Owner"),
    actorName: actor.name,
    actorEmail: actor.email,
    summary: decision === "Approved"
      ? `${row.id} Revision ${nextData.revision} approved for release to ${nextData.ownerName || "the project owner"}.`
      : `${row.id} Revision ${nextData.revision} returned to Draft: ${note}`,
  });
  return Response.json({ saved: true, status: nextStatus, opportunityId: nextData.opportunityId });
}

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || actor.accessLevel !== "Company Owner") return Response.json({ error: "Company Owner Access Is Required" }, { status: 403 });
  const onboardingLock = await enforceOnboardingAccess(request); if (onboardingLock) return onboardingLock;
  const { getDb } = await import("../../../db"); const db = getDb();
  const [queue, history] = await Promise.all([loadQueue(db), db.select().from(ownerApprovalSnapshots).orderBy(desc(ownerApprovalSnapshots.createdAt)).limit(100)]);
  return Response.json({ queue, history, controls: { authority: "Company Owner only", releaseBoundary: "Every decision calls the existing controlled workflow", evidence: "Exact decision packet, source version, SHA-256, identity, result, and time are permanent", batching: "Routine items may be selected together; each receives an independent decision and evidence record" } });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || actor.accessLevel !== "Company Owner") return Response.json({ error: "Only A Company Owner Can Make An Owner Approval Decision" }, { status: 403 });
  const onboardingLock = await enforceOnboardingAccess(request); if (onboardingLock) return onboardingLock;
  const payload = await request.json() as DecisionPayload;
  if (payload.action !== "decide" || !payload.approvalItemId || !payload.decision) return Response.json({ error: "Approval Item And Decision Are Required" }, { status: 400 });
  const note = payload.note?.trim() || "";
  if (payload.decision === "Returned" && note.length < 8) return Response.json({ error: "A Specific Return Explanation Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db"); const db = getDb();
  const queue = await loadQueue(db);
  const item = queue.find((candidate) => candidate.id === payload.approvalItemId);
  if (!item) return Response.json({ error: "This Approval Is No Longer Pending. Refresh The Queue." }, { status: 409 });
  if (!item.canApproveHere || (payload.decision === "Returned" && !item.canReturnHere)) return Response.json({ error: "This Decision Must Be Completed Inside Its Source Workflow" }, { status: 409 });
  const packetJson = JSON.stringify(item);
  const snapshotId = `OAS-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(ownerApprovalSnapshots).values({ id: snapshotId, approvalItemId: item.id, projectId: item.projectId, sourceRecordId: item.recordId, sourceRecordType: item.recordType, sourceUpdatedAt: item.sourceUpdatedAt, decision: payload.decision, decisionNote: note, riskLevel: item.level, amountCents: Math.round(item.amount * 100), packetJson, packetSha256: await packetHash(packetJson), actorName: actor.name, actorEmail: actor.email, status: "Pending Dispatch", createdAt: now });
  let response: Response;
  try {
    response = item.adapter === "estimate"
      ? await decideEstimate(db, item, payload.decision, note, actor)
      : item.adapter === "owner-proposal"
        ? await decideOwnerProposal(db, item, payload.decision, note, actor)
        : await dispatchExistingWorkflow(request, item, payload.decision, note);
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : "Approval dispatch failed";
    await db.update(ownerApprovalSnapshots).set({ status: "Failed", dispatchResult: detail, completedAt: new Date().toISOString() }).where(eq(ownerApprovalSnapshots.id, snapshotId));
    return Response.json({ error: detail }, { status: 500 });
  }
  const resultText = await response.clone().text();
  await db.update(ownerApprovalSnapshots).set({ status: response.ok ? "Completed" : "Failed", dispatchResult: resultText.slice(0, 4_000), completedAt: new Date().toISOString() }).where(eq(ownerApprovalSnapshots.id, snapshotId));
  if (!response.ok) return response;
  return Response.json({ saved: true, snapshotId, decision: payload.decision, sourceResult: resultText ? JSON.parse(resultText) : {} });
}
