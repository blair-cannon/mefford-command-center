export const SELECTION_RECORD_TYPE = "Selections";

export type SelectionOption = {
  id: string;
  label: string;
  manufacturer: string;
  model: string;
  color: string;
  unitCost: number;
  leadDays: number;
  notes: string;
};

export type SelectionData = {
  category: string;
  location: string;
  description: string;
  decisionType: string;
  responsibleName: string;
  linkedReference: string;
  installationDate: string;
  allowance: number;
  quantity: number;
  materialDescription: string;
  costCode: string;
  vendorId: string;
  vendorName: string;
  size: string;
  unit: string;
  requiredDeliveryDate: string;
  paymentTerms: string;
  sourceUrl: string;
  sourceFileId: number;
  sourceFileName: string;
  purchaseOrderId: string;
  purchaseOrderStatus: string;
  options: SelectionOption[];
  selectedOptionId: string;
  decision: Record<string, unknown> | null;
  issuedAt: string;
  issuedBy: string;
  distributionReference: string;
  impactStatus: string;
  impactRecordId: string;
  releaseReference: string;
  releasedAt: string;
  releasedBy: string;
  installedAt: string;
  installedBy: string;
  installationEvidence: string;
  revisionOf: string;
  revisionNumber: number;
  supersededBy: string;
  timeline: Array<{ action: string; actor: string; at: string; detail: string }>;
};

export function parseSelectionData(value?: string | null): SelectionData {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch { data = {}; }
  const options = Array.isArray(data.options) ? data.options.map((item, index) => normalizeOption(item, index)).filter((item) => item.label) : [];
  return {
    category: String(data.category || "Finish"),
    location: String(data.location || ""),
    description: String(data.description || ""),
    decisionType: String(data.decisionType || "Owner"),
    responsibleName: String(data.responsibleName || ""),
    linkedReference: String(data.linkedReference || ""),
    installationDate: String(data.installationDate || ""),
    allowance: number(data.allowance),
    quantity: Math.max(1, number(data.quantity) || 1),
    materialDescription: String(data.materialDescription || data.description || ""),
    costCode: String(data.costCode || ""),
    vendorId: String(data.vendorId || ""),
    vendorName: String(data.vendorName || ""),
    size: String(data.size || ""),
    unit: String(data.unit || "EA"),
    requiredDeliveryDate: String(data.requiredDeliveryDate || data.installationDate || ""),
    paymentTerms: String(data.paymentTerms || "Net 30"),
    sourceUrl: String(data.sourceUrl || ""),
    sourceFileId: Math.max(0, Math.round(number(data.sourceFileId))),
    sourceFileName: String(data.sourceFileName || ""),
    purchaseOrderId: String(data.purchaseOrderId || ""),
    purchaseOrderStatus: String(data.purchaseOrderStatus || "Not Ordered"),
    options,
    selectedOptionId: String(data.selectedOptionId || ""),
    decision: data.decision && typeof data.decision === "object" && !Array.isArray(data.decision) ? data.decision as Record<string, unknown> : null,
    issuedAt: String(data.issuedAt || ""),
    issuedBy: String(data.issuedBy || ""),
    distributionReference: String(data.distributionReference || ""),
    impactStatus: String(data.impactStatus || "Not Evaluated"),
    impactRecordId: String(data.impactRecordId || ""),
    releaseReference: String(data.releaseReference || ""),
    releasedAt: String(data.releasedAt || ""),
    releasedBy: String(data.releasedBy || ""),
    installedAt: String(data.installedAt || ""),
    installedBy: String(data.installedBy || ""),
    installationEvidence: String(data.installationEvidence || ""),
    revisionOf: String(data.revisionOf || ""),
    revisionNumber: number(data.revisionNumber),
    supersededBy: String(data.supersededBy || ""),
    timeline: Array.isArray(data.timeline) ? data.timeline.filter((item): item is SelectionData["timeline"][number] => Boolean(item && typeof item === "object")) : [],
  };
}

export function selectionOptionTotal(option: SelectionOption | undefined, quantity: number) {
  return Math.round((option?.unitCost || 0) * Math.max(1, quantity) * 100) / 100;
}

function normalizeOption(value: unknown, index: number): SelectionOption {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: String(item.id || `OPT-${index + 1}`),
    label: String(item.label || "").trim(),
    manufacturer: String(item.manufacturer || "").trim(),
    model: String(item.model || "").trim(),
    color: String(item.color || "").trim(),
    unitCost: number(item.unitCost),
    leadDays: Math.max(0, Math.round(number(item.leadDays))),
    notes: String(item.notes || "").trim(),
  };
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
