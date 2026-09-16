import { and, eq } from "drizzle-orm";
import { commandRecords, recordAudits } from "../db/schema";
import {
  LIEN_WAIVER_FORM_LABELS,
  LIEN_WAIVER_RECORD_TYPE,
  isConditionalWaiver,
  isLienWaiverJurisdiction,
  isLienWaiverProjectClass,
  waiverPaymentGate,
  type LienWaiverType,
} from "./lien-waivers";
import { roundMoney } from "./money.js";

type Db = ReturnType<(typeof import("../db"))["getDb"]>;

export async function ensureConditionalWaiverForBilling(db: Db, input: { projectId: string; vendorId?: string; vendorName: string; vendorEmail?: string; commitmentReference: string; payApplicationReference: string; linkedSubmissionId?: string; linkedApRecordId?: string; amount: number; retainage?: number; throughDate: string; finalApplication?: boolean; createdBy: string; actorEmail: string }) {
  const link = input.linkedSubmissionId || input.linkedApRecordId || "";
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, input.projectId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE)));
  const duplicate = rows.find((row) => {
    const data = parseObject(row.dataJson);
    return Boolean(link) && [data.linkedSubmissionId, data.linkedApRecordId].includes(link);
  });
  if (duplicate) return duplicate.id;
  const controlRow = (await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, input.projectId), eq(commandRecords.id, "LIEN-WAIVER-CONTROL"))).limit(1))[0];
  const control = parseObject(controlRow?.dataJson || "{}");
  const formType: LienWaiverType = input.finalApplication ? "conditional-final" : "conditional-progress";
  const id = `LW-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const configured = isLienWaiverJurisdiction(control.jurisdiction) && isLienWaiverProjectClass(control.projectClass);
  const data = {
    formType,
    formLabel: LIEN_WAIVER_FORM_LABELS[formType],
    jurisdiction: configured ? control.jurisdiction : "",
    projectClass: configured ? control.projectClass : "",
    projectLegalName: configured ? control.projectLegalName : "",
    projectAddress: configured ? control.projectAddress : "",
    legalDescription: configured ? control.legalDescription : "",
    titleCompanyRequirements: configured ? control.titleCompanyRequirements : "",
    templateStatus: configured ? control.templateStatus : "Project Configuration And Counsel Review Required",
    vendorId: input.vendorId || "",
    vendorName: input.vendorName,
    vendorEmail: input.vendorEmail || "",
    commitmentReference: input.commitmentReference,
    payApplicationReference: input.payApplicationReference,
    linkedSubmissionId: input.linkedSubmissionId || "",
    linkedApRecordId: input.linkedApRecordId || "",
    amount: roundMoney(input.amount),
    retainage: Math.max(0, roundMoney(input.retainage || 0)),
    throughDate: input.throughDate,
    exceptions: "None",
    lowerTierStatement: "No unpaid lower-tier claims are known except those listed in Exceptions.",
    formVersion: configured ? `MEF-LW-${String(control.jurisdiction)}-v1` : "Setup Required",
    sourceReference: "Construction Lien Waiver - EDITABLE (1).pdf · visual reference only",
    createdBy: input.createdBy,
    createdAt: now,
    immutableLinks: [input.linkedSubmissionId, input.linkedApRecordId, input.commitmentReference].filter(Boolean),
  };
  await db.insert(commandRecords).values({ projectId: input.projectId, id, recordType: LIEN_WAIVER_RECORD_TYPE, title: `${LIEN_WAIVER_FORM_LABELS[formType]} · ${input.vendorName}`, owner: input.vendorName, due: input.throughDate, status: configured ? "Requested" : "Project Setup Required", meta: configured ? `${String(control.jurisdiction)} · ${String(control.projectClass)} · ${input.payApplicationReference}` : `State / Project Classification Required · ${input.payApplicationReference}`, recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: true, dataJson: JSON.stringify(data), updatedAt: now });
  await db.insert(recordAudits).values({ projectId: input.projectId, recordId: id, fieldName: "Automatic Conditional Waiver Request", oldValue: "None", newValue: configured ? "Requested" : "Project Setup Required", reason: "Billing intake created the linked conditional waiver task", actorName: input.createdBy, actorEmail: input.actorEmail, summary: `${input.payApplicationReference} created a linked ${LIEN_WAIVER_FORM_LABELS[formType]} request. Nothing was signed, approved, sent, posted, or paid automatically.` });
  return id;
}

export async function projectBillingWaiverGate(db: Db, projectId: string, linkedApRecordId: string) {
  const rows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE)));
  const waiver = rows.find((row) => {
    const data = parseObject(row.dataJson);
    return data.linkedApRecordId === linkedApRecordId && isConditionalWaiver(String(data.formType || "") as LienWaiverType);
  });
  if (!waiver) return { allowed: false, reason: "Conditional Lien Waiver Request Is Missing" };
  const data = parseObject(waiver.dataJson);
  if (!waiverPaymentGate(waiver.status, data.ownerOverride)) return { allowed: false, reason: `${waiver.id} Is ${waiver.status}` };
  return { allowed: true, waiverId: waiver.id, override: Boolean(data.ownerOverride) };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
