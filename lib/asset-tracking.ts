import { and, eq, inArray } from "drizzle-orm";
import { commandRecords, commandWorkItems, companyMembers } from "../db/schema";
import { upsertWorkItem } from "./my-work";
import { roundMoney } from "./money";

export const ASSET_PROJECT_ID = "MEFFORD-ASSETS";
export const ASSET_RECORD_TYPE = "Company Asset";
export const ASSET_CATEGORIES = ["Vehicle", "Heavy Equipment", "Trailer", "Small Equipment", "Tool", "Technology", "Other"] as const;
export const ASSET_STATUSES = ["Available", "Assigned", "In Service", "Out Of Service", "Maintenance Due", "Missing / Stolen", "Retired"] as const;
export const ASSET_BOOK_TREATMENTS = ["Operational Tracking Only", "Capitalize & Depreciate", "Expense At Purchase", "Written Off / Impaired"] as const;
export const ASSET_TAX_TREATMENTS = ["Not Determined", "MACRS Depreciation", "Section 179 Election", "Bonus Depreciation", "Section 179 + Bonus + MACRS", "Nondepreciable / Tax Tracking Only"] as const;
export const ASSET_ACCOUNTING_STATUSES = ["Needs Review", "Draft", "Reviewed", "Fully Depreciated", "Disposed"] as const;
export const ASSET_BOOK_METHODS = ["Straight Line", "Units Of Production", "Accountant Schedule / Imported", "None"] as const;

export function assetAccountingValues(input: Record<string, unknown>) {
  const acquisitionCost = nonnegative(input.acquisitionCost);
  const salvageValue = Math.min(acquisitionCost, nonnegative(input.salvageValue));
  const accumulatedBookDepreciation = nonnegative(input.accumulatedBookDepreciation);
  const impairmentAmount = nonnegative(input.impairmentAmount);
  const businessUsePercent = Math.min(100, Math.max(0, nonnegative(input.businessUsePercent ?? 100)));
  const taxBasis = roundMoney(acquisitionCost * businessUsePercent / 100);
  const section179Amount = nonnegative(input.section179Amount);
  const bonusDepreciationAmount = nonnegative(input.bonusDepreciationAmount);
  const accumulatedTaxDepreciation = nonnegative(input.accumulatedTaxDepreciation);
  const bookTreatment = text(input.bookTreatment) || "Operational Tracking Only";
  const accountingStatus = text(input.accountingStatus) || "Needs Review";
  const currentBookValue = accountingStatus === "Disposed" || ["Expense At Purchase", "Operational Tracking Only"].includes(bookTreatment)
    ? 0
    : roundMoney(Math.max(0, acquisitionCost - accumulatedBookDepreciation - impairmentAmount));
  const remainingTaxBasis = roundMoney(Math.max(0, taxBasis - section179Amount - bonusDepreciationAmount - accumulatedTaxDepreciation));
  const usefulLifeYears = nonnegative(input.usefulLifeYears);
  const annualBookDepreciation = bookTreatment === "Capitalize & Depreciate" && text(input.bookMethod) === "Straight Line" && usefulLifeYears > 0
    ? roundMoney(Math.max(0, acquisitionCost - salvageValue) / usefulLifeYears)
    : 0;
  return { acquisitionCost, salvageValue, accumulatedBookDepreciation, impairmentAmount, businessUsePercent, taxBasis, section179Amount, bonusDepreciationAmount, accumulatedTaxDepreciation, currentBookValue, remainingTaxBasis, annualBookDepreciation };
}

export type AssetAlert = {
  key: string;
  severity: "Normal" | "High" | "Critical";
  title: string;
  detail: string;
  dueAt: string | null;
};

export function parseAssetData(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function assetAlerts(asset: { id: string; title: string; status: string; dataJson?: string; data?: Record<string, unknown> }, now = new Date()): AssetAlert[] {
  const data = asset.data || parseAssetData(asset.dataJson);
  if (asset.status === "Retired") return [];
  const today = now.toISOString().slice(0, 10);
  const alerts: AssetAlert[] = [];
  const dateChecks = [
    ["nextServiceDate", "Preventive Service"],
    ["registrationExpiry", "Registration"],
    ["insuranceExpiry", "Insurance"],
    ["inspectionExpiry", "Annual / DOT Inspection"],
  ] as const;
  for (const [field, label] of dateChecks) {
    const due = text(data[field]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
    const days = Math.round((new Date(`${due}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
    if (days > 30) continue;
    const overdue = days < 0;
    alerts.push({
      key: `${field}:${due}`,
      severity: overdue || days <= 7 ? "Critical" : "High",
      title: `${label} ${overdue ? "Overdue" : "Due Soon"}`,
      detail: `${asset.title} · ${overdue ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` : `due in ${days} day${days === 1 ? "" : "s"}`}.`,
      dueAt: `${due}T13:00:00.000Z`,
    });
  }
  const currentMeter = number(data.currentMeter);
  const nextServiceMeter = number(data.nextServiceMeter);
  if (nextServiceMeter > 0 && currentMeter >= nextServiceMeter) {
    alerts.push({ key: `meter:${nextServiceMeter}`, severity: "Critical", title: "Meter Service Due", detail: `${asset.title} reached ${formatNumber(currentMeter)} ${text(data.meterType) || "meter units"}; service was due at ${formatNumber(nextServiceMeter)}.`, dueAt: now.toISOString() });
  } else if (nextServiceMeter > 0 && currentMeter >= nextServiceMeter * 0.95) {
    alerts.push({ key: `meter-soon:${nextServiceMeter}`, severity: "High", title: "Meter Service Approaching", detail: `${asset.title} is at ${formatNumber(currentMeter)} of ${formatNumber(nextServiceMeter)} ${text(data.meterType) || "meter units"}.`, dueAt: null });
  }
  if (asset.status === "Missing / Stolen") alerts.push({ key: `security:${text(data.activeIssueAt) || today}`, severity: "Critical", title: "Missing / Stolen Asset", detail: `${asset.title} is flagged missing or stolen. Protect people, preserve evidence, and follow the company security response.`, dueAt: now.toISOString() });
  if (asset.status === "Out Of Service") alerts.push({ key: `out-of-service:${text(data.activeIssueAt) || today}`, severity: "Critical", title: "Asset Out Of Service", detail: `${asset.title} may not be used until an authorized return-to-service record is completed.`, dueAt: now.toISOString() });
  if (text(data.geofenceStatus) === "Breach") alerts.push({ key: `geofence:${text(data.lastSeenAt) || today}`, severity: "Critical", title: "Geofence Alert", detail: `${asset.title} is outside its authorized area. Confirm custody and location immediately.`, dueAt: now.toISOString() });
  if (text(data.telematicsStatus) === "Connected" && staleHours(text(data.lastSeenAt), now) > 24) alerts.push({ key: `tracker-stale:${text(data.lastSeenAt) || today}`, severity: "High", title: "Tracker Signal Stale", detail: `${asset.title} has not reported a tracker location in more than 24 hours.`, dueAt: now.toISOString() });
  return alerts;
}

export async function reconcileAssetReadiness(now = new Date()) {
  const { getDb } = await import("../db");
  const db = getDb();
  const [assets, members] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, ASSET_PROJECT_ID), eq(commandRecords.recordType, ASSET_RECORD_TYPE))),
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
  ]);
  const managers = members.filter((member) => {
    const roles = stringArray(member.designationsJson);
    return ["Company Owner", "Administrator"].includes(member.companyAccessLevel) || roles.some((role) => ["Fleet Manager", "Asset Manager", "Office Staff"].includes(role));
  });
  const recipients = managers.length ? managers : members.filter((member) => ["Company Owner", "Administrator"].includes(member.companyAccessLevel));
  let workItems = 0;
  const activeDedupeKeys = new Set<string>();
  for (const asset of assets) {
    for (const alert of assetAlerts(asset, now)) {
      for (const recipient of recipients) {
        const dedupeKey = `asset:${asset.id}:${alert.key}:${recipient.email}`;
        activeDedupeKeys.add(dedupeKey);
        await upsertWorkItem(db, {
          dedupeKey,
          projectId: ASSET_PROJECT_ID,
          recipientName: recipient.displayName,
          recipientEmail: recipient.email,
          kind: "Asset Readiness",
          title: `${alert.title} · ${asset.title}`,
          message: alert.detail,
          priority: alert.severity,
          sourceType: "Asset Tracking",
          sourceRecordId: asset.id,
          actionTarget: "Assets & Fleet",
          dueAt: alert.dueAt,
          createdBy: "Asset Readiness Automation",
        });
        workItems += 1;
      }
    }
  }
  const currentItems = await db.select({ id: commandWorkItems.id, dedupeKey: commandWorkItems.dedupeKey }).from(commandWorkItems).where(eq(commandWorkItems.sourceType, "Asset Tracking"));
  const resolvedIds = currentItems.filter((item) => !activeDedupeKeys.has(item.dedupeKey)).map((item) => item.id);
  if (resolvedIds.length) {
    const completedAt = now.toISOString();
    await db.update(commandWorkItems).set({ status: "Completed", completedAt, updatedAt: completedAt }).where(inArray(commandWorkItems.id, resolvedIds));
  }
  return { assets: assets.length, alerts: assets.reduce((total, asset) => total + assetAlerts(asset, now).length, 0), workItems, resolved: resolvedIds.length };
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function nonnegative(value: unknown) { return Math.max(0, roundMoney(String(value ?? "").replaceAll(",", ""))); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value); }
function staleHours(value: string, now: Date) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 0 : (now.getTime() - parsed.getTime()) / 3_600_000; }
function stringArray(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
