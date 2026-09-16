export const PURCHASE_ORDER_RECORD_TYPE = "Purchase Orders";
export const PURCHASE_ORDER_APPROVAL_THRESHOLD = 10_000;

export type PurchaseOrderData = {
  vendorId: string;
  vendor: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  vendorAddress: string;
  amount: number;
  costCode: string;
  trade: string;
  scope: string;
  exclusions: string;
  deliveryLocation: string;
  requiredBy: string;
  paymentTerms: string;
  freightTerms: string;
  taxIncluded: string;
  warranty: string;
  specialInstructions: string;
  sourceSelectionId: string;
  sourceBidPackageId: string;
  sourceBidRevisionId: string;
  procurementArchiveProjectId: string;
  ownerApproval: Record<string, unknown> | null;
  approvalRequired: boolean;
  approvalReasons: string[];
  budgetAvailableAtSubmit: number;
  releasedAt: string;
  releasedBy: string;
  distributionReference: string;
  acknowledgedAt: string;
  acknowledgedBy: string;
  acknowledgmentReference: string;
  revisionOf: string;
  revisionNumber: number;
  supersededBy: string;
  timeline: Array<{ action: string; actor: string; at: string; detail: string }>;
};

export function parsePurchaseOrderData(value?: string | null): PurchaseOrderData {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  const amount = Number(data.amount ?? data.purchaseOrderAmount ?? data.total ?? 0);
  return {
    vendorId: String(data.vendorId || ""),
    vendor: String(data.vendor || ""),
    contactName: String(data.contactName || ""),
    contactEmail: String(data.contactEmail || ""),
    contactPhone: String(data.contactPhone || ""),
    vendorAddress: String(data.vendorAddress || ""),
    amount: Number.isFinite(amount) ? amount : 0,
    costCode: String(data.costCode || ""),
    trade: String(data.trade || ""),
    scope: String(data.scope || ""),
    exclusions: String(data.exclusions || ""),
    deliveryLocation: String(data.deliveryLocation || ""),
    requiredBy: String(data.requiredBy || ""),
    paymentTerms: String(data.paymentTerms || "Net 30"),
    freightTerms: String(data.freightTerms || "FOB Destination"),
    taxIncluded: String(data.taxIncluded || "Included"),
    warranty: String(data.warranty || "Manufacturer standard warranty"),
    specialInstructions: String(data.specialInstructions || ""),
    sourceSelectionId: String(data.sourceSelectionId || ""),
    sourceBidPackageId: String(data.sourceBidPackageId || ""),
    sourceBidRevisionId: String(data.sourceBidRevisionId || ""),
    procurementArchiveProjectId: String(data.procurementArchiveProjectId || ""),
    ownerApproval: data.ownerApproval && typeof data.ownerApproval === "object" ? data.ownerApproval as Record<string, unknown> : null,
    approvalRequired: data.approvalRequired === true,
    approvalReasons: Array.isArray(data.approvalReasons) ? data.approvalReasons.filter((item): item is string => typeof item === "string") : [],
    budgetAvailableAtSubmit: Number(data.budgetAvailableAtSubmit || 0),
    releasedAt: String(data.releasedAt || ""),
    releasedBy: String(data.releasedBy || ""),
    distributionReference: String(data.distributionReference || ""),
    acknowledgedAt: String(data.acknowledgedAt || ""),
    acknowledgedBy: String(data.acknowledgedBy || ""),
    acknowledgmentReference: String(data.acknowledgmentReference || ""),
    revisionOf: String(data.revisionOf || ""),
    revisionNumber: Number(data.revisionNumber || 0),
    supersededBy: String(data.supersededBy || ""),
    timeline: Array.isArray(data.timeline) ? data.timeline.filter((item): item is PurchaseOrderData["timeline"][number] => Boolean(item && typeof item === "object")) : [],
  };
}

export function purchaseOrderAmount(data: PurchaseOrderData) {
  return Math.round(data.amount * 100) / 100;
}
