/* Native image elements preserve exact dimensions in the printable invoice layout. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { calculateEstimateSummary } from "./estimate-template";
import type { AccountingActor } from "./accounting-erp";
import { CurrencyInput } from "./currency-input";
import { OWNER_CONTRACT_TYPES, contractTemplate, normalizeOwnerContractType } from "../lib/owner-contracts";
import { summaryDrilldownProps } from "./summary-drilldown";
import { ownerBillingAuthority, ownerBillingPhaseError, PHASE_ONE_BILLING, CONSTRUCTION_BILLING, PHASE_ONE_SOV_ID } from "../lib/owner-billing-authority";
import { isIssuedOwnerBilling } from "../lib/accounting-states";

type StoredRecord = {
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta?: string;
  recordDate?: string;
  dateLocked?: boolean;
  data?: Record<string, unknown>;
  initialAudit?: string;
};

type ProjectOption = {
  number: string;
  name: string;
  status: string;
  site?: string;
  ownerName: string;
  ownerContractDate?: string;
  ownerContractType?: string;
  ownerContractStatus?: string;
  ownerContractRecordId?: string;
  paymentTerms?: string;
  retainageInitialPercent?: string;
  retainageAfterHalfPercent?: string;
  architect?: string;
  contractAmount: string;
  currentContractAmount?: string;
  startDate: string;
  finalDate: string;
  projectManager: string;
};

type SovLine = {
  id: string;
  label: string;
  kind: "Project Management" | "General Conditions" | "Overhead & Profit" | "Trade" | "Change Order" | "Custom";
  costCodes: string[];
  scheduledValue: number;
  plannedFee: number;
};

type BillingLine = SovLine & {
  previousBilled: number;
  approvedCost: number;
  plannedFeeThisPeriod: number;
  suggestedThisPeriod: number;
};

type ProjectAllocation = {
  invoiceId: string;
  invoiceTitle: string;
  code: string;
  amount: number;
  commitmentReference: string;
  attachmentId: string;
  attachmentName: string;
};

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";
const SETUP_ID = "OWNER-BILLING-SETUP";
const APPROVED_INVOICE_STATUSES = new Set(["Approved Unpaid", "Payment Released", "Paid"]);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentMonth() {
  return today().slice(0, 7);
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordData(record?: StoredRecord) {
  return record?.data ?? {};
}

function monthLabel(value: string) {
  if (!value) return "Not Selected";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function displayDate(value: string) {
  if (!value) return "Not Yet Saved";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function displayTimestamp(value: string) {
  if (!value) return "Live Unsaved Draft";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function durationFromDates(startDate: string, finalDate: string) {
  if (!startDate || !finalDate) return 1;
  const start = new Date(`${startDate}T12:00:00`);
  const finish = new Date(`${finalDate}T12:00:00`);
  return Math.max(1, Math.ceil((finish.getTime() - start.getTime()) / 2_629_746_000));
}

function billingMonthNumber(startDate: string, period: string, duration: number) {
  const [startYear, startMonth] = startDate.slice(0, 7).split("-").map(Number);
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const raw = (periodYear - startYear) * 12 + periodMonth - startMonth + 1;
  return Math.min(duration, Math.max(1, raw));
}

async function saveProjectRecord(projectId: string, record: StoredRecord) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, recordType: record.type, record }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || "The Owner Billing Record Could Not Be Saved.");
}

async function coordinateAccounting(body: Record<string, unknown>) {
  const response = await fetch("/api/accounting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string; notice?: string };
  if (!response.ok) throw new Error(result.error || "The Accounting Coordination Action Could Not Be Saved.");
  return result;
}

export function OwnerBillingWorkspace({ actor, initialProjectId = "" }: { actor: AccountingActor; initialProjectId?: string }) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectNumber, setProjectNumber] = useState(initialProjectId);
  const [projectRecords, setProjectRecords] = useState<StoredRecord[]>([]);
  const [accountingRecords, setAccountingRecords] = useState<StoredRecord[]>([]);
  const [period, setPeriod] = useState(currentMonth());
  const [sovDraft, setSovDraft] = useState<SovLine[]>([]);
  const [workDrafts, setWorkDrafts] = useState<Record<string, string>>({});
  const [storedDrafts, setStoredDrafts] = useState<Record<string, string>>({});
  const [documentationChoice, setDocumentationChoice] = useState<"Yes" | "No" | "">("");
  const [overrideReason, setOverrideReason] = useState("");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [deliveryReference, setDeliveryReference] = useState("");
  const [receiptDraft, setReceiptDraft] = useState({ amount: "", receiptDate: today(), reference: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedBillingPhase, setSelectedBillingPhase] = useState("");
  const [phaseOneCreditLine, setPhaseOneCreditLine] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/projects").then(async (response) => {
        const result = await response.json() as { projects?: ProjectOption[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Projects Are Unavailable.");
        return result.projects ?? [];
      }),
      fetch(`/api/records?projectId=${ACCOUNTING_PROJECT_ID}&view=owner-billing`).then(async (response) => {
        const result = await response.json() as { records?: StoredRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Accounting Records Are Unavailable.");
        return result.records ?? [];
      }),
    ])
      .then(([projectList, records]) => {
        if (cancelled) return;
        setProjects(projectList);
        setAccountingRecords(records);
        setProjectNumber((current) => current || projectList.find((project) => project.status === "Active")?.number || projectList[0]?.number || "");
      })
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Owner Billing Is Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!projectNumber) return;
    let cancelled = false;
    fetch(`/api/records?projectId=${encodeURIComponent(projectNumber)}`)
      .then(async (response) => {
        const result = await response.json() as { records?: StoredRecord[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Project Billing Records Are Unavailable.");
        return result.records ?? [];
      })
      .then((records) => !cancelled && setProjectRecords(records))
      .catch((error) => !cancelled && setNotice(error instanceof Error ? error.message : "Project Billing Records Are Unavailable."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [projectNumber]);

  const project = projects.find((item) => item.number === projectNumber);
  const controlledContract = projectRecords.find(record => record.type === "Contracts" && record.id === project?.ownerContractRecordId);
  const authority = ownerBillingAuthority(project || {}, controlledContract);
  const billingPhase = selectedBillingPhase || (!authority.construction && authority.phaseOneAmount > 0 ? PHASE_ONE_BILLING : CONSTRUCTION_BILLING);
  const phaseOne = billingPhase === PHASE_ONE_BILLING;
  const billingBlocked = ownerBillingPhaseError(authority, billingPhase);
  const setupId = phaseOne ? PHASE_ONE_SOV_ID : SETUP_ID;
  const setupRecord = projectRecords.find((record) => record.type === "Owner Billing Setup" && record.id === setupId);
  const awardedEstimate = projectRecords.find((record) => record.type === "Awarded Estimates");
  const budgetRecords = projectRecords.filter((record) => record.type === "Budget" && recordData(record).selectedForProject === true);
  const allOwnerBillings = projectRecords.filter((record) => record.type === "Owner Billing");
  const ownerBillings = allOwnerBillings.filter(record => (recordData(record).billingPhase === PHASE_ONE_BILLING) === phaseOne);
  const issuedPhaseOne = allOwnerBillings.filter(record => recordData(record).billingPhase === PHASE_ONE_BILLING && isIssuedOwnerBilling(record.status));
  const phaseOneCredit = issuedPhaseOne.reduce((sum, record) => sum + numeric(recordData(record).currentEarned), 0);
  const currentDraft = ownerBillings.find((record) => String(recordData(record).billingPeriod || "") === period);
  const executedChanges = projectRecords.filter(record => !phaseOne && record.type === "Change Orders" && record.id.startsWith("CO-") && record.status === "Executed");
  const contractType = normalizeOwnerContractType(recordData(setupRecord).contractType || project?.ownerContractType) || "Plan & Spec Lump Sum";

  const estimate = recordData(awardedEstimate).estimate;
  const estimateSummary = estimate ? calculateEstimateSummary(estimate) : null;
  const durationMonths = phaseOne ? 1 : Math.max(
    1,
    numeric((recordData(awardedEstimate).estimate as { projectInputs?: { projectDurationMonths?: number } } | undefined)?.projectInputs?.projectDurationMonths) ||
      durationFromDates(project?.startDate || "", project?.finalDate || ""),
  );
  const billingMonth = billingMonthNumber(project?.startDate || `${period}-01`, period, durationMonths);
  const baseContract = phaseOne ? authority.phaseOneAmount : numeric(project?.contractAmount);
  const currentContract = phaseOne ? authority.phaseOneAmount : numeric(project?.currentContractAmount || project?.contractAmount);
  const explicitBaseProfit = phaseOne ? 0 : numeric(estimateSummary?.baseProfit);
  const budgetTotal = budgetRecords.reduce((sum, record) => sum + numeric(recordData(record).originalBudget), 0);

  const generatedSov = ((): SovLine[] => {
    if (phaseOne && authority.phaseOneAmount > 0) return [{ id: "SOV-PHASE1-DESIGN", label: "Phase 1 Design And Preconstruction", kind: "Custom", costCodes: [], scheduledValue: authority.phaseOneAmount, plannedFee: authority.phaseOneAmount }];
    if (!project || !budgetRecords.length || baseContract <= 0) return [];
    const management = budgetRecords.filter((record) => String(recordData(record).code || record.id).startsWith("0131"));
    const generalConditions = budgetRecords.filter((record) => {
      const code = String(recordData(record).code || record.id);
      return code.startsWith("01") && !code.startsWith("0131");
    });
    const trades = budgetRecords.filter((record) => !String(recordData(record).code || record.id).startsWith("01"));
    const managementAmount = management.reduce((sum, record) => sum + numeric(recordData(record).originalBudget), 0);
    const generalConditionsCost = generalConditions.reduce((sum, record) => sum + numeric(recordData(record).originalBudget), 0);
    const contractOnlyGeneralConditions = Math.max(0, baseContract - budgetTotal - explicitBaseProfit);
    return [
      {
        id: "SOV-PROJECT-MANAGEMENT",
        label: "Project Management",
        kind: "Project Management",
        costCodes: management.map((record) => String(recordData(record).code || record.id)),
        scheduledValue: managementAmount,
        plannedFee: 0,
      },
      {
        id: "SOV-GENERAL-CONDITIONS",
        label: "General Conditions",
        kind: "General Conditions",
        costCodes: generalConditions.map((record) => String(recordData(record).code || record.id)),
        scheduledValue: generalConditionsCost + contractOnlyGeneralConditions,
        plannedFee: contractOnlyGeneralConditions,
      },
      {
        id: "SOV-OVERHEAD-PROFIT",
        label: "Overhead & Profit",
        kind: "Overhead & Profit",
        costCodes: [],
        scheduledValue: explicitBaseProfit,
        plannedFee: explicitBaseProfit,
      },
      ...trades.map((record): SovLine => ({
        id: `SOV-${record.id}`,
        label: String(recordData(record).description || record.title),
        kind: "Trade",
        costCodes: [String(recordData(record).code || record.id)],
        scheduledValue: numeric(recordData(record).originalBudget),
        plannedFee: 0,
      })),
    ];
  })();

  const lockedSov = Array.isArray(recordData(setupRecord).sovLines)
    ? recordData(setupRecord).sovLines as SovLine[]
    : [];
  const sovLocked = setupRecord?.status === "Locked" && lockedSov.length > 0;
  const editableSov = sovDraft.length ? sovDraft : lockedSov.length ? lockedSov : generatedSov;
  const creditLineId = phaseOneCreditLine || String(recordData(setupRecord).phaseOneCreditLineId || "");
  const baseSov = sovLocked ? lockedSov : editableSov;

  const projectAllocations = accountingRecords
    .filter((record) => record.type === "AP Invoice" && APPROVED_INVOICE_STATUSES.has(record.status) && String(record.recordDate || "").startsWith(period))
    .flatMap((record): ProjectAllocation[] => {
      const data = recordData(record);
      const allocations = Array.isArray(data.allocations) ? data.allocations as Array<Record<string, unknown>> : [];
      return allocations
        .filter((allocation) => String(allocation.destination || "") === projectNumber)
        .map((allocation) => ({
          invoiceId: record.id,
          invoiceTitle: record.title,
          code: String(allocation.code || ""),
          amount: numeric(allocation.amount),
          commitmentReference: String(allocation.commitmentReference || ""),
          attachmentId: String(data.attachmentId || ""),
          attachmentName: String(data.attachmentName || ""),
        }));
    });

  const previousBillings = [...ownerBillings.filter((record) => String(recordData(record).billingPeriod || "") < period && isIssuedOwnerBilling(record.status)), ...(!phaseOne ? issuedPhaseOne : [])];
  const previousEarned = previousBillings.reduce((sum, record) => sum + numeric(recordData(record).currentEarned), 0);
  const previousRetainage = previousBillings.reduce((sum, record) => sum + numeric(recordData(record).retainageThisPeriod), 0);
  const billingLines = ((): BillingLine[] => {
    const changeOrderIds = new Set(executedChanges.map((record) => record.id));
    const changeLines: SovLine[] = executedChanges.map((record) => ({
      id: `SOV-${record.id}`,
      label: `${record.id} · ${record.title}`,
      kind: "Change Order",
      costCodes: Array.isArray(recordData(record).pricingLines)
        ? (recordData(record).pricingLines as Array<Record<string, unknown>>).map((line) => String(line.costCode || "")).filter(Boolean)
        : [],
      scheduledValue: numeric(recordData(record).approvedTotal),
      plannedFee: 0,
    }));
    return [...baseSov, ...changeLines].map((line) => {
      const previousBilled = previousBillings.reduce((sum, billing) => {
        const lines = Array.isArray(recordData(billing).lines) ? recordData(billing).lines as Array<Record<string, unknown>> : [];
        if (!phaseOne && recordData(billing).billingPhase === PHASE_ONE_BILLING) return sum + (line.id === creditLineId ? numeric(recordData(billing).currentEarned) : 0);
        const saved = lines.find((item) => item.id === line.id);
        return sum + numeric(saved?.totalThisPeriod);
      }, 0);
      const previousPlannedFee = previousBillings.reduce((sum, billing) => {
        const lines = Array.isArray(recordData(billing).lines) ? recordData(billing).lines as Array<Record<string, unknown>> : [];
        const saved = lines.find((item) => item.id === line.id);
        return sum + numeric(saved?.plannedFeeThisPeriod);
      }, 0);
      const approvedCost = projectAllocations
        .filter((allocation) => line.kind === "Change Order"
          ? allocation.commitmentReference === line.id.replace("SOV-", "")
          : line.costCodes.includes(allocation.code) && !changeOrderIds.has(allocation.commitmentReference))
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      const cumulativeFeeTarget = line.plannedFee * (billingMonth / durationMonths);
      const plannedFeeThisPeriod = Math.max(0, Math.min(line.plannedFee - previousPlannedFee, cumulativeFeeTarget - previousPlannedFee));
      const remaining = Math.max(0, line.scheduledValue - previousBilled);
      return {
        ...line,
        previousBilled,
        approvedCost,
        plannedFeeThisPeriod,
        suggestedThisPeriod: Math.min(remaining, approvedCost + plannedFeeThisPeriod),
      };
    });
  })();
  const baseBillingLines = billingLines.filter((line) => line.kind !== "Change Order");
  const changeOrderBillingLines = billingLines.filter((line) => line.kind === "Change Order");

  const savedBillingLines = Array.isArray(recordData(currentDraft).lines)
    ? recordData(currentDraft).lines as Array<Record<string, unknown>>
    : [];
  const workValue = (line: BillingLine) => workDrafts[line.id] ?? String(
    savedBillingLines.find((item) => item.id === line.id)?.workThisPeriod ?? line.suggestedThisPeriod.toFixed(2),
  );
  const storedValue = (line: BillingLine) => storedDrafts[line.id] ?? String(
    savedBillingLines.find((item) => item.id === line.id)?.storedMaterials ?? "0",
  );

  const currentEarned = billingLines.reduce((sum, line) => sum + numeric(workValue(line)) + numeric(storedValue(line)), 0);
  const cumulativeEarned = previousEarned + currentEarned;
  const completion = currentContract > 0 ? cumulativeEarned / currentContract : 0;
  const retainageInitialRate = numeric(recordData(setupRecord).retainageInitialPercent ?? project?.retainageInitialPercent ?? 10) / 100;
  const retainageAfterHalfRate = numeric(recordData(setupRecord).retainageAfterHalfPercent ?? project?.retainageAfterHalfPercent ?? 5) / 100;
  const retainageRate = completion > 0.5 ? retainageAfterHalfRate : retainageInitialRate;
  const targetRetainage = cumulativeEarned * retainageRate;
  const retainageThisPeriod = targetRetainage - previousRetainage;
  const currentPaymentDue = currentEarned - retainageThisPeriod;
  const netChangeOrders = currentContract - baseContract;
  const changeOrderAdditions = executedChanges.reduce((sum, record) => {
    const value = numeric(recordData(record).approvedTotal);
    return sum + Math.max(0, value);
  }, 0);
  const changeOrderDeductions = executedChanges.reduce((sum, record) => {
    const value = numeric(recordData(record).approvedTotal);
    return sum + Math.min(0, value);
  }, 0);
  const earnedLessRetainage = cumulativeEarned - targetRetainage;
  const previousCertificates = Math.max(0, previousEarned - previousRetainage);
  const balanceToFinish = Math.max(0, currentContract - earnedLessRetainage);
  const supportedCost = projectAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const unsupportedCost = projectAllocations.filter((allocation) => !allocation.attachmentId).reduce((sum, allocation) => sum + allocation.amount, 0);
  const documentationThreshold = supportedCost > 0 ? Math.min(5_000, supportedCost * 0.05) : 0;
  const documentationAlert = supportedCost > 0 && unsupportedCost >= documentationThreshold;
  const totalSov = baseSov.reduce((sum, line) => sum + numeric(line.scheduledValue), 0);
  const canLock = actor.accessLevel === "Company Owner" && !billingBlocked;
  const canPrepareBilling =
    actor.accessLevel === "Company Owner" ||
    actor.accessLevel === "Administrator" ||
    actor.name === project?.projectManager;
  const canCompleteAccountingReview =
    actor.accessLevel === "Company Owner" ||
    actor.designations.includes("Accountant") ||
    actor.designations.includes("Financial Administrator");
  const applicationNumber = numeric(recordData(currentDraft).applicationNumber) ||
    Math.max(0, ...allOwnerBillings.filter((record) => record.id !== currentDraft?.id).map((record) => numeric(recordData(record).applicationNumber))) + 1;
  const previewStage = currentDraft?.status || "PM Preparation";
  const previewStamp = currentDraft?.status === "Ready To Send" ? "READY TO SEND" : currentDraft?.status === "Paid" ? "PAID" : ["Sent", "Partially Paid"].includes(currentDraft?.status || "") ? String(currentDraft?.status || "").toUpperCase() : `DRAFT · ${previewStage.toUpperCase()}`;
  const approvalSteps = ["PM Preparation", "Accountant Review", "Owner Approval"];
  const previewStageIndex = currentDraft?.status === "Ready To Send"
    ? approvalSteps.length
    : Math.max(0, approvalSteps.indexOf(previewStage));
  const approvalPeople = [project?.projectManager || "Project Manager", "Accounting Team", "Company Owner"];

  function updateSovLine(id: string, key: "label" | "scheduledValue", value: string) {
    setSovDraft((current) => (current.length ? current : editableSov).map((line) => line.id === id ? { ...line, [key]: key === "scheduledValue" ? numeric(value) : value } : line));
  }

  function moveSovLine(id: string, direction: -1 | 1) {
    setSovDraft((current) => {
      const nextCurrent = current.length ? current : editableSov;
      const index = nextCurrent.findIndex((line) => line.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= nextCurrent.length) return current;
      const next = [...nextCurrent];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function lockSov(status = "Locked") {
    if (!project || actor.accessLevel !== "Company Owner") {
      setNotice("A Company Owner Must Review And Lock The First Owner Invoice Structure.");
      return;
    }
    if (status === "Locked" && billingBlocked) {
      setNotice(billingBlocked);
      return;
    }
    if (!editableSov.length || (status === "Locked" && Math.abs(editableSov.reduce((sum, line) => sum + line.scheduledValue, 0) - baseContract) > 0.01)) {
      setNotice("The Base Schedule Of Values Must Equal The Original Contract Before It Can Be Locked.");
      return;
    }
    setSaving(true);
    try {
      const record: StoredRecord = {
        id: setupId,
        type: "Owner Billing Setup",
        title: `${project.name} · ${billingPhase} Schedule Of Values`,
        owner: actor.name,
        due: today(),
        status,
        recordDate: today(),
        dateLocked: status === "Locked",
        meta: `${status} · ${actor.name} · ${editableSov.length} Base SOV Lines`,
        data: {
          ...recordData(setupRecord),
          billingPhase,
          phaseOneCreditLineId: phaseOne ? "" : creditLineId,
          projectNumber: project.number,
          contractType,
          contractRecordId: project.ownerContractRecordId || recordData(setupRecord).contractRecordId,
          contractStatus: project.ownerContractStatus || recordData(setupRecord).contractStatus,
          paymentTerms: project.paymentTerms || recordData(setupRecord).paymentTerms,
          retainageInitialPercent: retainageInitialRate * 100,
          retainageAfterHalfPercent: retainageAfterHalfRate * 100,
          sovLines: editableSov,
          standardRules: {
            projectManagement: "Combined Project Manager And Superintendent",
            generalConditions: "Division 01 Except Project Management Plus Technology Insurance And Other Contract Fees",
            overheadAndProfit: "Explicit Base Profit Only",
          },
          lockedBy: status === "Locked" ? actor.name : "",
          lockedAt: status === "Locked" ? new Date().toISOString() : "",
        },
        initialAudit: `${actor.name} Saved The ${billingPhase} Schedule Of Values As ${status}.`,
      };
      await saveProjectRecord(project.number, record);
      setProjectRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setNotice(status === "Locked" ? "Schedule Of Values Locked." : "Schedule Of Values Draft Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Billing Structure Could Not Be Locked.");
    } finally {
      setSaving(false);
    }
  }

  function buildBillingRecord(status: string, previous?: StoredRecord): StoredRecord {
    const lines = billingLines.map((line) => ({
      ...line,
      workThisPeriod: numeric(workValue(line)),
      storedMaterials: numeric(storedValue(line)),
      totalThisPeriod: numeric(workValue(line)) + numeric(storedValue(line)),
    }));
    return {
      id: previous?.id || `OWNER-BILL-${projectNumber}-${phaseOne ? "PHASE1-" : ""}${period}`,
      type: "Owner Billing",
      title: `${project?.name || projectNumber} · ${monthLabel(period)} Owner Billing`,
      owner: project?.projectManager || actor.name,
      due: `${period}-15`,
      status,
      recordDate: `${period}-01`,
      dateLocked: status === "Ready To Send",
      meta: `${money.format(currentPaymentDue)} Current Payment · ${status}`,
      data: {
        ...recordData(previous),
        billingPhase,
        projectNumber,
        projectName: project?.name,
        ownerName: project?.ownerName,
        projectManager: project?.projectManager,
        contractType: String(recordData(setupRecord).contractType || contractType),
        contractRecordId: project?.ownerContractRecordId || recordData(setupRecord).contractRecordId,
        contractStatus: project?.ownerContractStatus || recordData(setupRecord).contractStatus,
        paymentTerms: project?.paymentTerms || recordData(setupRecord).paymentTerms,
        billingPeriod: period,
        applicationNumber,
        durationMonths,
        billingMonth,
        baseContract,
        currentContract,
        explicitBaseProfit,
        monthlyProfitTarget: explicitBaseProfit / durationMonths,
        lines,
        previousEarned,
        currentEarned,
        cumulativeEarned,
        completion,
        retainageRate,
        retainageThisPeriod,
        retainageToDate: targetRetainage,
        currentPaymentDue,
        supportedCost,
        unsupportedCost,
        documentationThreshold,
        documentationAlert,
        supportingInvoiceIds: [...new Set(projectAllocations.map((allocation) => allocation.invoiceId))],
        supportingFileIds: [...new Set(projectAllocations.map((allocation) => allocation.attachmentId).filter(Boolean))],
        updatedBy: actor.name,
        updatedAt: new Date().toISOString(),
        livePosting: false,
        liveDistribution: false,
      },
    };
  }

  async function saveBilling(status: string) {
    if (status !== "PM Preparation" && billingBlocked) { setNotice(billingBlocked); return; }
    if (!project || !sovLocked) {
      setNotice("A Company Owner Must Lock The First Invoice Structure Before Monthly Billing Can Begin.");
      return;
    }
    if (billingLines.some((line) => numeric(workValue(line)) + numeric(storedValue(line)) > line.scheduledValue - line.previousBilled + 0.01)) {
      setNotice("A Billing Line Exceeds Its Remaining Scheduled Value. Reduce The Current Work Or Stored Materials.");
      return;
    }
    setSaving(true);
    try {
      const record = buildBillingRecord(status, currentDraft);
      await saveProjectRecord(project.number, record);
      setProjectRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setNotice(status === "PM Preparation" ? "Automated Owner Billing Draft Saved For PM Review." : `${record.title} Is Now In ${status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Billing Draft Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function finalizeBilling() {
    if (billingBlocked) { setNotice(billingBlocked); return; }
    if (!currentDraft || !project || !documentationChoice) {
      setNotice("Choose Whether Supporting Cost Documentation Is Required.");
      return;
    }
    if (currentDraft.status !== "Owner Approval") {
      setNotice("PM And Accountant Signoffs Are Required Before Finalization.");
      return;
    }
    if (actor.accessLevel !== "Company Owner") {
      setNotice("A Company Owner Must Finalize The Owner Invoice.");
      return;
    }
    if (documentationChoice === "Yes" && documentationAlert && !overrideReason.trim()) {
      const alerted = buildBillingRecord("Owner Approval", currentDraft);
      alerted.data = {
        ...recordData(alerted),
        documentationRequired: true,
        documentationAlert: true,
        alertReason: `${money.format(unsupportedCost)} Of Monthly Project Cost Is Missing Supporting Documentation.`,
        alertRecipients: [project.projectManager, "Company Administrators", "Company Owners"],
      };
      setSaving(true);
      try {
        await saveProjectRecord(project.number, alerted);
        setProjectRecords((current) => [alerted, ...current.filter((item) => item.id !== alerted.id)]);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The Documentation Alert Could Not Be Saved.");
        return;
      } finally {
        setSaving(false);
      }
      setNotice(`Documentation Alert Sent. ${money.format(unsupportedCost)} Is Unsupported. Resolve It Or Enter An Owner Override Reason.`);
      return;
    }
    const ready = buildBillingRecord("Ready To Send", currentDraft);
    ready.data = {
      ...recordData(ready),
      documentationRequired: documentationChoice === "Yes",
      documentationAlert,
      documentationOverrideReason: documentationAlert ? overrideReason.trim() : "",
      documentationApprovedBy: actor.name,
      finalizedAt: new Date().toISOString(),
    };
    setSaving(true);
    try {
      await saveProjectRecord(project.number, ready);
      setProjectRecords((current) => [ready, ...current.filter((item) => item.id !== ready.id)]);
      setFinalizeOpen(false);
      setNotice("Owner Invoice Finalized And Ready To Send. Nothing Was Distributed Automatically.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Invoice Could Not Be Finalized.");
    } finally {
      setSaving(false);
    }
  }

  async function reloadProjectBilling() {
    if (!projectNumber) return;
    const response = await fetch(`/api/records?projectId=${encodeURIComponent(projectNumber)}`);
    const result = await response.json() as { records?: StoredRecord[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Project Billing Records Are Unavailable.");
    setProjectRecords(result.records ?? []);
  }

  async function markBillingSent() {
    if (billingBlocked) { setNotice(billingBlocked); return; }
    if (!currentDraft || currentDraft.status !== "Ready To Send") return;
    setSaving(true);
    try {
      const result = await coordinateAccounting({ action: "send-owner-billing", projectId: projectNumber, recordId: currentDraft.id, deliveryReference: deliveryReference.trim() || "Recorded External Delivery" });
      setNotice(result.notice || "Owner Invoice Marked Sent And Added To Accounts Receivable.");
      setDeliveryReference("");
      await reloadProjectBilling();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Invoice Delivery Could Not Be Recorded.");
    } finally {
      setSaving(false);
    }
  }

  async function recordOwnerReceipt() {
    if (!currentDraft || !["Sent", "Partially Paid"].includes(currentDraft.status)) return;
    setSaving(true);
    try {
      const result = await coordinateAccounting({ action: "record-owner-receipt", projectId: projectNumber, recordId: currentDraft.id, amount: numeric(receiptDraft.amount), receiptDate: receiptDraft.receiptDate, reference: receiptDraft.reference.trim() });
      setNotice(result.notice || "Owner Receipt Posted To Accounting And The Project.");
      setReceiptOpen(false);
      setReceiptDraft({ amount: "", receiptDate: today(), reference: "" });
      await reloadProjectBilling();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Owner Receipt Could Not Be Posted.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="accounting-workspace owner-billing-workspace">
      <section className="accounting-hero owner-billing-hero">
        <div><h1>Monthly Billing Engine</h1></div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}

      <section className="billing-controls">
        {!initialProjectId ? <label className="field-label">Project<select value={projectNumber} onChange={(event) => { setLoading(true); setProjectRecords([]); setSelectedBillingPhase(""); setPhaseOneCreditLine(""); setSovDraft([]); setWorkDrafts({}); setStoredDrafts({}); setProjectNumber(event.target.value); }}><option value="">Select Project</option>{projects.map((item) => <option key={item.number} value={item.number}>{item.number} · {item.name}</option>)}</select></label> : null}
        {project?.ownerContractType === "Design-Build GMP" ? <label className="field-label">Billing Phase<select value={billingPhase} onChange={event => { setSelectedBillingPhase(event.target.value); setSovDraft([]); setWorkDrafts({}); setStoredDrafts({}); }}><option>{CONSTRUCTION_BILLING}</option><option>{PHASE_ONE_BILLING}</option></select></label> : null}
        <label className="field-label">Billing Period<input type="month" value={period} onChange={(event) => { setWorkDrafts({}); setStoredDrafts({}); setPeriod(event.target.value); }} /></label>

      </section>

      {project && billingBlocked ? <div className="accounting-notice" role="status">{billingBlocked}</div> : null}

      <section className="billing-summary-grid">
        <article {...summaryDrilldownProps({ title: "Base Contract Schedule Of Values", rows: baseSov.map((line) => ({ id: line.id, title: line.label, subtitle: `${line.kind} · ${line.costCodes.join(", ") || "No Cost Code"}`, value: money.format(line.scheduledValue), status: sovLocked ? "Locked" : "Draft" })) })}><span>BASE CONTRACT</span><strong>{money.format(baseContract)}</strong><small>{baseSov.length} Base SOV Lines</small></article>
        <article {...summaryDrilldownProps({ title: "Explicit Base Profit", rows: [{ id: awardedEstimate?.id || projectNumber, title: project?.name || projectNumber, subtitle: "Awarded estimate explicit base profit", value: money.format(explicitBaseProfit), status: awardedEstimate?.status || "Estimate Required", meta: `${money.format(explicitBaseProfit / durationMonths)} planned per month` }] })}><span>EXPLICIT BASE PROFIT</span><strong>{money.format(explicitBaseProfit)}</strong><small>{money.format(explicitBaseProfit / durationMonths)} Planned Per Month</small></article>
        <article {...summaryDrilldownProps({ title: `Owner Billing · ${monthLabel(period)}`, rows: [...previousBillings, ...(currentDraft ? [currentDraft] : [])].map((record) => ({ id: record.id, title: record.title, subtitle: String(recordData(record).billingPeriod || record.recordDate || "Period Not Set"), value: money.format(numeric(recordData(record).currentPaymentDue)), status: record.status, meta: record.meta })) })}><span>BILLING MONTH</span><strong>{billingMonth} Of {durationMonths}</strong><small>{monthLabel(period)}</small></article>
        <article {...summaryDrilldownProps({ title: "Supported Project Cost Allocations", rows: projectAllocations.map((allocation) => ({ id: `${allocation.invoiceId}-${allocation.code}`, title: allocation.invoiceTitle, subtitle: `${allocation.code} · ${allocation.commitmentReference || "No Commitment Reference"}`, value: money.format(allocation.amount), status: allocation.attachmentId ? "Documented" : "Record Only", meta: allocation.attachmentName || "No attachment" })) })}><span>SUPPORTED PROJECT COST</span><strong>{money.format(supportedCost)}</strong><small>{projectAllocations.length} Approved Cost Allocations</small></article>
        <article {...summaryDrilldownProps({ title: "Missing Billing Documentation", rows: projectAllocations.filter((allocation) => !allocation.attachmentId).map((allocation) => ({ id: `${allocation.invoiceId}-${allocation.code}`, title: allocation.invoiceTitle, subtitle: `${allocation.code} · ${allocation.commitmentReference || "No Commitment Reference"}`, value: money.format(allocation.amount), status: "Missing Document" })), emptyText: "No approved project cost allocations are missing documentation." }, documentationAlert ? "billing-alert-card" : "")}><span>MISSING DOCUMENTATION</span><strong>{money.format(unsupportedCost)}</strong><small>Alert At {money.format(documentationThreshold)}</small></article>
      </section>

      {!sovLocked ? (
        <section className="sov-setup-panel">
          <header><div><h2>Owner Schedule Of Values Review</h2></div><div><small>Draft Total</small><strong className={Math.abs(totalSov - baseContract) <= 0.01 ? "balanced-total" : "unbalanced-total"}>{money.format(totalSov)}</strong></div></header>
          <label className="field-label billing-contract-type">Contract Type<select value={contractType} disabled>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select><small>Controlled By The Executed Owner Contract</small></label>
          {!generatedSov.length ? <div className="ap-empty"><strong>Locked Budget And Awarded Estimate Required</strong><span>The Standard SOV Will Generate When The Project Contract And Cost Budget Are Ready.</span></div> : null}
          <div className="sov-setup-list">{editableSov.map((line, index) => <div key={line.id}><span>{String(index + 1).padStart(2, "0")}</span><input aria-label={`${line.label} Name`} value={line.label} onChange={(event) => updateSovLine(line.id, "label", event.target.value)} /><i>{line.kind}</i><CurrencyInput aria-label={`${line.label} Scheduled Value`} min="0" value={line.scheduledValue} onValueChange={(value) => updateSovLine(line.id, "scheduledValue", value)} /><button aria-label={`Move ${line.label} Up`} disabled={index === 0} onClick={() => moveSovLine(line.id, -1)}>↑</button><button aria-label={`Move ${line.label} Down`} disabled={index === editableSov.length - 1} onClick={() => moveSovLine(line.id, 1)}>↓</button></div>)}</div>
          {!phaseOne && phaseOneCredit > 0 ? <label className="field-label">SOV Line For Previously Billed Design · {money.format(phaseOneCredit)}<select value={creditLineId} onChange={event => setPhaseOneCreditLine(event.target.value)}><option value="">Select SOV Line</option>{editableSov.filter(line => line.scheduledValue >= phaseOneCredit).map(line => <option key={line.id} value={line.id}>{line.label}</option>)}</select></label> : null}
          <footer><div className="sov-setup-actions"><button className="secondary-action" onClick={() => setPreviewOpen(true)}>Preview G702 / G703 Layout</button><button className="secondary-action" disabled={saving || actor.accessLevel !== "Company Owner" || !editableSov.length} onClick={() => void lockSov("Draft")}>Save SOV Draft</button><button className="primary-action large" disabled={saving || !canLock || !editableSov.length} onClick={() => void lockSov()}>{saving ? "Saving..." : "Lock First Invoice Structure"}</button></div></footer>
        </section>
      ) : (
        <>

          <section className="billing-table-panel">
            <header><div><h2>{project?.name} · {monthLabel(period)}</h2></div><i className={`ap-status ${(currentDraft?.status || "Not Started").toLowerCase().replaceAll(" ", "-")}`}>{currentDraft?.status || "Not Started"}</i></header>
            <div className="billing-table-wrap"><div className="billing-table" data-reflow-table="">
              <div className="billing-table-row billing-head" data-reflow-head="wide"><span>SOV Line</span><span>Scheduled Value</span><span>Previous Billed</span><span>Approved Cost</span><span>Planned Fee</span><span>Work This Period</span><span>Stored Materials</span><span>Balance</span></div>
              {billingLines.map((line) => {
                const current = numeric(workValue(line)) + numeric(storedValue(line));
                return <div className={`billing-table-row ${line.kind === "Change Order" ? "change-order-line" : ""}`} key={line.id} data-reflow-row="wide"><span data-label="SOV Line"><b>{line.label}</b><small>{line.kind}{line.costCodes.length ? ` · ${line.costCodes.join(", ")}` : ""}</small></span><strong data-label="Scheduled Value">{money.format(line.scheduledValue)}</strong><span data-label="Previous Billed">{money.format(line.previousBilled)}</span><span data-label="Approved Cost">{money.format(line.approvedCost)}</span><span data-label="Planned Fee">{money.format(line.plannedFeeThisPeriod)}</span><label className="reflow-field" data-label="Work This Period"><CurrencyInput aria-label={`${line.label} Work This Period`} min="0" value={workValue(line)} onValueChange={(value) => setWorkDrafts((currentDrafts) => ({ ...currentDrafts, [line.id]: value }))} /></label><label className="reflow-field" data-label="Stored Materials"><CurrencyInput aria-label={`${line.label} Stored Materials`} min="0" value={storedValue(line)} onValueChange={(value) => setStoredDrafts((currentDrafts) => ({ ...currentDrafts, [line.id]: value }))} /></label><span data-label="Balance">{money.format(Math.max(0, line.scheduledValue - line.previousBilled - current))}</span></div>;
              })}
            </div></div>
          </section>

          <section className="billing-close-grid">
            <article><span>Previous Earned</span><strong>{money.format(previousEarned)}</strong></article><article><span>Current Earned</span><strong>{money.format(currentEarned)}</strong></article><article><span>Completion</span><strong>{(completion * 100).toFixed(1)}%</strong></article><article><span>Retainage Rate</span><strong>{(retainageRate * 100).toFixed(0)}%</strong></article><article><span>Retainage This Period</span><strong>{money.format(retainageThisPeriod)}</strong></article><article className="payment-due-card"><span>Current Payment Due</span><strong>{money.format(currentPaymentDue)}</strong></article>
          </section>

          {documentationAlert ? <section className="documentation-alert"><span>!</span><div><strong>Supporting Cost Discrepancy</strong><p>{money.format(unsupportedCost)} Of Approved Monthly Project Cost Is Missing A Stored Invoice Or Receipt. The Approved Alert Limit Is {money.format(documentationThreshold)}.</p></div><b>PM · ADMIN · OWNER</b></section> : null}

          <section className="billing-actions-panel"><div><strong>Billing Workflow</strong><span>PM Preparation → Accountant Review → Owner Approval → Ready To Send</span></div><div>
            <button className="secondary-action" onClick={() => setPreviewOpen(true)}>Preview Owner Invoice</button>
            {!currentDraft ? <button className="primary-action large" disabled={saving || !canPrepareBilling} onClick={() => void saveBilling("PM Preparation")}>Create Automated Billing Draft</button> : null}
            {currentDraft?.status === "PM Preparation" ? <button className="primary-action large" disabled={saving || Boolean(billingBlocked) || !canPrepareBilling} onClick={() => void saveBilling("Accountant Review")}>PM Signoff And Submit</button> : null}
            {currentDraft?.status === "Accountant Review" ? <button className="primary-action large" disabled={saving || Boolean(billingBlocked) || !canCompleteAccountingReview} onClick={() => void saveBilling("Owner Approval")}>Accountant Signoff</button> : null}
            {currentDraft?.status === "Owner Approval" ? <button className="primary-action large" disabled={saving || Boolean(billingBlocked)} onClick={() => { setDocumentationChoice(""); setOverrideReason(""); setFinalizeOpen(true); }}>Owner Finalize Invoice</button> : null}
            {currentDraft?.status === "Ready To Send" ? <><input aria-label="Owner Invoice Delivery Reference" value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} placeholder="Delivery Reference Or Method" /><button className="primary-action large" disabled={saving || Boolean(billingBlocked)} onClick={() => void markBillingSent()}>Mark Sent And Open AR</button></> : null}
            {["Sent", "Partially Paid"].includes(currentDraft?.status || "") ? <button className="primary-action large" disabled={saving} onClick={() => { const outstanding = Math.max(0, numeric(recordData(currentDraft).currentPaymentDue) - numeric(recordData(currentDraft).receivedToDate)); setReceiptDraft({ amount: outstanding.toFixed(2), receiptDate: today(), reference: "" }); setReceiptOpen(true); }}>Record Owner Receipt</button> : null}
            {currentDraft?.status === "Paid" ? <span className="billing-paid-state">✓ Paid In Full · {money.format(numeric(recordData(currentDraft).receivedToDate))}</span> : null}
          </div></section>
        </>
      )}

      {finalizeOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFinalizeOpen(false)}><section className="record-modal billing-finalize-modal" role="dialog" aria-modal="true" aria-labelledby="billing-finalize-title"><div className="modal-heading"><div><h2 id="billing-finalize-title">Is Supporting Cost Documentation Required?</h2></div><button aria-label="Close Owner Finalization" onClick={() => setFinalizeOpen(false)}>×</button></div><div className="documentation-choice"><button className={documentationChoice === "Yes" ? "active" : ""} onClick={() => setDocumentationChoice("Yes")}><strong>Yes</strong><span>Attach Every Available Invoice Receipt Labor Summary And Cost Record</span></button><button className={documentationChoice === "No" ? "active" : ""} onClick={() => setDocumentationChoice("No")}><strong>No</strong><span>Finalize The Invoice Without A Cost Documentation Package</span></button></div>{documentationChoice === "Yes" ? <div className={`documentation-readiness ${documentationAlert ? "alert" : "ready"}`}><strong>{documentationAlert ? "Documentation Discrepancy Requires Attention" : "Documentation Coverage Is Within The Approved Limit"}</strong><span>{money.format(supportedCost - unsupportedCost)} Supported · {money.format(unsupportedCost)} Missing · {projectAllocations.filter((allocation) => allocation.attachmentId).length} Stored Documents</span></div> : null}{documentationChoice === "Yes" && documentationAlert ? <label className="field-label">Owner Override Reason<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Resolve The Missing Documents Or Explain Why This Invoice May Proceed" /></label> : null}<div className="permission-note"><strong>External Distribution Required</strong><span>Download, send externally, and record the delivery reference.</span></div><div className="modal-actions"><button className="secondary-action" onClick={() => setFinalizeOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !documentationChoice} onClick={() => void finalizeBilling()}>{saving ? "Finalizing Invoice..." : "Finalize And Mark Ready To Send"}</button></div></section></div> : null}

      {receiptOpen && currentDraft ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReceiptOpen(false)}><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="owner-receipt-title"><div className="modal-heading"><div><h2 id="owner-receipt-title">Record Owner Receipt</h2></div><button aria-label="Close Owner Receipt" onClick={() => setReceiptOpen(false)}>×</button></div><div className="ap-detail-summary"><article><span>Invoice Amount</span><strong>{money.format(numeric(recordData(currentDraft).currentPaymentDue))}</strong></article><article><span>Previously Received</span><strong>{money.format(numeric(recordData(currentDraft).receivedToDate))}</strong></article><article><span>Outstanding</span><strong>{money.format(Math.max(0, numeric(recordData(currentDraft).currentPaymentDue) - numeric(recordData(currentDraft).receivedToDate)))}</strong></article></div><div className="field-grid three-column"><label className="field-label">Receipt Amount<CurrencyInput min="0.01" value={receiptDraft.amount} onValueChange={(value) => setReceiptDraft((current) => ({ ...current, amount: value }))} /></label><label className="field-label">Deposit Date<input type="date" value={receiptDraft.receiptDate} onChange={(event) => setReceiptDraft((current) => ({ ...current, receiptDate: event.target.value }))} /></label><label className="field-label">Deposit / Receipt Reference<input value={receiptDraft.reference} onChange={(event) => setReceiptDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Bank Deposit Or Check Reference" /></label></div><div className="modal-actions"><button className="secondary-action" onClick={() => setReceiptOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !receiptDraft.reference.trim() || numeric(receiptDraft.amount) <= 0} onClick={() => void recordOwnerReceipt()}>{saving ? "Posting Receipt..." : "Post Receipt To Accounting And Project"}</button></div></section></div> : null}

      {previewOpen ? <div className="modal-layer owner-invoice-preview-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewOpen(false)}><section className="owner-invoice-preview-modal" role="dialog" aria-modal="true" aria-labelledby="owner-invoice-preview-title"><div className="owner-invoice-preview-toolbar"><div><h2 id="owner-invoice-preview-title">G702 / G703-Style Billing Draft</h2></div><div><button className="secondary-action" onClick={() => window.print()}>Print Landscape Draft</button><button className="primary-action" onClick={() => setPreviewOpen(false)}>Close Preview</button></div></div><div className="owner-invoice-preview">
        <article className="owner-invoice-page owner-invoice-g702">
          <div className="owner-invoice-watermark">{previewStamp}</div>
          <header className="owner-invoice-document-head"><img src="/mefford-logo.png" alt="Mefford Contracting" /><div><p>MEFFORD CONTRACTING</p><h1>Application And Certificate For Payment</h1><span>G702-Style Owner Billing Summary</span></div><aside><strong>G702-STYLE</strong><span>Application #{applicationNumber}</span><small>Period To {displayDate(`${period}-01`)}</small></aside></header>
          <section className="owner-invoice-draft-banner"><strong>{previewStamp}</strong><span>{currentDraft ? `Saved ${displayTimestamp(String(recordData(currentDraft).updatedAt || ""))} By ${String(recordData(currentDraft).updatedBy || currentDraft.owner)}` : "Live Unsaved Draft · Review Before Creating The Approval Record"}</span></section>
          <section className="g702-routing-grid"><div className="wide"><span>Project</span><strong>{project?.name || "Project Not Selected"}</strong><small>{project?.site || "Project Address Not Entered"}</small></div><div><span>Application Number</span><strong>{applicationNumber}</strong></div><div><span>Period To</span><strong>{displayDate(`${period}-01`)}</strong></div><div className="wide"><span>To Owner</span><strong>{project?.ownerName || "Owner Not Entered"}</strong></div><div><span>Contract Date</span><strong>{displayDate(project?.ownerContractDate || "")}</strong></div><div><span>Project Number</span><strong>{project?.number || "Not Assigned"}</strong></div><div className="wide"><span>From Contractor</span><strong>Mefford Contracting</strong></div><div><span>Contract For</span><strong>{String(recordData(setupRecord).contractType || contractType)}</strong></div><div><span>Application Date</span><strong>{displayDate(today())}</strong></div><div className="wide"><span>Via Architect / Representative</span><strong>{project?.architect || "Not Entered"}</strong></div><div><span>Project Manager</span><strong>{project?.projectManager || "Not Assigned"}</strong></div><div><span>Status</span><strong>{previewStage}</strong></div></section>
          <div className="g702-body"><section className="g702-left-column"><div className="g702-certification-copy"><p>CONTRACTOR CERTIFICATION</p><h2>Application For Payment</h2><span>Mefford Contracting Certifies That The Work Represented In This Application Has Been Performed And The Amount Requested Is Supported By The Project Record.</span></div><div className="g702-change-summary"><header><strong>Change Order Summary</strong><span>Additions</span><span>Deductions</span></header><div><span>Approved In Previous Months</span><b>{money.format(changeOrderAdditions)}</b><b>{money.format(Math.abs(changeOrderDeductions))}</b></div><div><span>Total Approved Change Orders</span><b>{money.format(changeOrderAdditions)}</b><b>{money.format(Math.abs(changeOrderDeductions))}</b></div><footer><strong>Net Change By Change Orders</strong><b>{money.format(netChangeOrders)}</b></footer></div></section><section className="owner-invoice-summary"><header><div><p>CONTRACTOR APPLICATION FOR PAYMENT</p><h2>Contract Summary</h2></div><span>Amounts In U.S. Dollars</span></header><div className="owner-invoice-summary-row"><span>1</span><strong>Original Contract Sum</strong><b>{money.format(baseContract)}</b></div><div className="owner-invoice-summary-row"><span>2</span><strong>Net Change By Approved Change Orders</strong><b>{money.format(netChangeOrders)}</b></div><div className="owner-invoice-summary-row"><span>3</span><strong>Contract Sum To Date</strong><b>{money.format(currentContract)}</b></div><div className="owner-invoice-summary-row"><span>4</span><strong>Total Completed And Stored To Date</strong><b>{money.format(cumulativeEarned)}</b></div><div className="owner-invoice-summary-row"><span>5</span><strong>Retainage To Date · {(retainageRate * 100).toFixed(0)}%</strong><b>({money.format(targetRetainage)})</b></div><div className="owner-invoice-summary-row"><span>6</span><strong>Total Earned Less Retainage</strong><b>{money.format(earnedLessRetainage)}</b></div><div className="owner-invoice-summary-row"><span>7</span><strong>Less Previous Certificates For Payment</strong><b>({money.format(previousCertificates)})</b></div><div className="owner-invoice-summary-row current-payment"><span>8</span><strong>Current Payment Due</strong><b>{money.format(currentPaymentDue)}</b></div><div className="owner-invoice-summary-row"><span>9</span><strong>Balance To Finish Including Retainage</strong><b>{money.format(balanceToFinish)}</b></div></section></div>
          <section className="g702-contractor-execution" aria-label="Mefford Contracting signature and notary acknowledgment"><div className="g702-authorized-signature"><p>Mefford Contracting Execution</p><h3>Mefford Contracting Authorized Signature</h3><div><span>Authorized Signature</span><b /></div><div><span>Printed Name And Title</span><b /></div><div className="short"><span>Date</span><b /></div></div><div className="g702-notary"><p>Notary Acknowledgment</p><h3>State Of <b /> &nbsp; County Of <b /></h3><span>Acknowledged Before Me On <b /> By <b />, An Authorized Representative Of Mefford Contracting.</span><div><span>Notary Public Signature</span><b /></div><div><span>My Commission Expires</span><b /></div><small>Notary Seal</small></div></section>
          <section className="g702-certificate"><div><p>OWNER / ARCHITECT CERTIFICATE FOR PAYMENT</p><span>The Application Has Been Reviewed Against The Project Record. Approval In Command Center Establishes The Amount Authorized For This Billing Period.</span></div><strong>{money.format(currentPaymentDue)}</strong><div className="g702-certificate-lines"><span>Approved By <b>{currentDraft?.status === "Ready To Send" ? String(recordData(currentDraft).documentationApprovedBy || actor.name) : "Pending Owner Approval"}</b></span><span>Date <b>{currentDraft?.status === "Ready To Send" ? displayDate(String(recordData(currentDraft).finalizedAt || today())) : "________________"}</b></span></div></section>
          <section className="owner-invoice-approval-route"><header><p>COMMAND CENTER APPROVAL ROUTE</p><span>The Same Billing Draft Remains Visible As It Moves Forward.</span></header><div>{approvalSteps.map((step, index) => { const state = previewStageIndex > index ? "Approved" : previewStageIndex === index ? "In Review" : "Waiting"; return <article key={step} className={state.toLowerCase().replace(" ", "-")}><span>{index + 1}</span><div><strong>{step}</strong><small>{approvalPeople[index]}</small></div><b>{state}</b></article>; })}</div></section>
          <footer><span>{currentDraft?.status === "Ready To Send" ? "READY TO SEND · FINAL DISTRIBUTION HAS NOT OCCURRED" : "DRAFT PREVIEW ONLY · NOT APPROVED OR DISTRIBUTED"}</span><b>Page 1 · G702-Style</b></footer>
        </article>
        <article className="owner-invoice-page owner-invoice-g703">
          <div className="owner-invoice-watermark">{previewStamp}</div>
          <header className="g703-document-head"><div><img src="/mefford-logo.png" alt="Mefford Contracting" /><span><p>MEFFORD CONTRACTING</p><h1>Continuation Sheet</h1><small>G703-Style Schedule Of Values</small></span></div><strong>G703-STYLE</strong></header>
          <section className="g703-meta-grid"><div><span>Application Number</span><strong>{applicationNumber}</strong></div><div><span>Application Date</span><strong>{displayDate(today())}</strong></div><div><span>Period To</span><strong>{displayDate(`${period}-01`)}</strong></div><div><span>Project Number</span><strong>{project?.number || "Not Assigned"}</strong></div><div className="wide"><span>Project</span><strong>{project?.name || "Project Not Selected"}</strong></div><div className="wide"><span>Owner</span><strong>{project?.ownerName || "Owner Not Entered"}</strong></div></section>
          <section className="owner-invoice-continuation"><div className="owner-invoice-sov-wrap" data-reflow-table=""><table><colgroup>{[4, 24, 10, 9, 9, 9, 10, 6, 10, 9].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th rowSpan={3}>A<br />Item<br />No.</th><th rowSpan={3}>B<br />Description Of Work</th><th rowSpan={3}>C<br />Scheduled<br />Value</th><th colSpan={2}>D + E · Work Completed</th><th rowSpan={3}>F<br />Materials<br />Presently Stored</th><th rowSpan={3}>G<br />Total Completed<br />And Stored To Date</th><th rowSpan={3}>H<br />%<br />Complete</th><th rowSpan={3}>I<br />Balance<br />To Finish</th><th rowSpan={3}>J<br />Retainage</th></tr><tr><th>D<br />From Previous Applications</th><th>E<br />This Period</th></tr><tr><th>Prior Certificates</th><th>Current Application</th></tr></thead><tbody><tr className="owner-invoice-group-row"><td colSpan={10}>Mefford Contracting · Base Contract Schedule Of Values</td></tr>{baseBillingLines.map((line, index) => { const work = numeric(workValue(line)); const stored = numeric(storedValue(line)); const total = line.previousBilled + work + stored; const balance = Math.max(0, line.scheduledValue - total); return <tr key={line.id} data-reflow-row="xl"><td data-label="Item">{String(index + 1).padStart(2, "0")}</td><td data-label="Description Of Work"><strong>{line.label}</strong><small>{line.kind}{line.costCodes.length ? ` · ${line.costCodes.join(", ")}` : ""}</small></td><td data-label="Scheduled Value">{money.format(line.scheduledValue)}</td><td data-label="Previous Applications">{money.format(line.previousBilled)}</td><td data-label="This Period">{money.format(work)}</td><td data-label="Stored Materials">{money.format(stored)}</td><td data-label="Completed And Stored">{money.format(total)}</td><td data-label="Complete">{line.scheduledValue > 0 ? `${((total / line.scheduledValue) * 100).toFixed(1)}%` : "0.0%"}</td><td data-label="Balance To Finish">{money.format(balance)}</td><td data-label="Retainage">{money.format(total * retainageRate)}</td></tr>; })}<tr className="owner-invoice-subtotal-row" data-reflow-row="xl"><td colSpan={2} data-label="Item">Base Contract Totals</td><td data-label="Scheduled Value">{money.format(baseBillingLines.reduce((sum, line) => sum + line.scheduledValue, 0))}</td><td data-label="Previous Applications">{money.format(baseBillingLines.reduce((sum, line) => sum + line.previousBilled, 0))}</td><td data-label="This Period">{money.format(baseBillingLines.reduce((sum, line) => sum + numeric(workValue(line)), 0))}</td><td data-label="Stored Materials">{money.format(baseBillingLines.reduce((sum, line) => sum + numeric(storedValue(line)), 0))}</td><td data-label="Completed And Stored">{money.format(baseBillingLines.reduce((sum, line) => sum + line.previousBilled + numeric(workValue(line)) + numeric(storedValue(line)), 0))}</td><td data-label="Complete"></td><td data-label="Balance To Finish">{money.format(baseBillingLines.reduce((sum, line) => sum + Math.max(0, line.scheduledValue - line.previousBilled - numeric(workValue(line)) - numeric(storedValue(line))), 0))}</td><td data-label="Retainage">{money.format(baseBillingLines.reduce((sum, line) => sum + (line.previousBilled + numeric(workValue(line)) + numeric(storedValue(line))) * retainageRate, 0))}</td></tr>{changeOrderBillingLines.length ? <><tr className="owner-invoice-group-row change-orders"><td colSpan={10}>Approved Change Orders</td></tr>{changeOrderBillingLines.map((line, index) => { const work = numeric(workValue(line)); const stored = numeric(storedValue(line)); const total = line.previousBilled + work + stored; const balance = Math.max(0, line.scheduledValue - total); return <tr key={line.id} className="owner-invoice-change-row" data-reflow-row="xl"><td data-label="Item">{String(index + 1).padStart(2, "0")}</td><td data-label="Description Of Work"><strong>{line.label}</strong><small>{line.costCodes.length ? line.costCodes.join(", ") : "Approved Change Order"}</small></td><td data-label="Scheduled Value">{money.format(line.scheduledValue)}</td><td data-label="Previous Applications">{money.format(line.previousBilled)}</td><td data-label="This Period">{money.format(work)}</td><td data-label="Stored Materials">{money.format(stored)}</td><td data-label="Completed And Stored">{money.format(total)}</td><td data-label="Complete">{line.scheduledValue !== 0 ? `${((total / line.scheduledValue) * 100).toFixed(1)}%` : "0.0%"}</td><td data-label="Balance To Finish">{money.format(balance)}</td><td data-label="Retainage">{money.format(total * retainageRate)}</td></tr>; })}<tr className="owner-invoice-subtotal-row" data-reflow-row="xl"><td colSpan={2} data-label="Item">Change Order Totals</td><td data-label="Scheduled Value">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + line.scheduledValue, 0))}</td><td data-label="Previous Applications">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + line.previousBilled, 0))}</td><td data-label="This Period">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + numeric(workValue(line)), 0))}</td><td data-label="Stored Materials">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + numeric(storedValue(line)), 0))}</td><td data-label="Completed And Stored">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + line.previousBilled + numeric(workValue(line)) + numeric(storedValue(line)), 0))}</td><td data-label="Complete"></td><td data-label="Balance To Finish">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + Math.max(0, line.scheduledValue - line.previousBilled - numeric(workValue(line)) - numeric(storedValue(line))), 0))}</td><td data-label="Retainage">{money.format(changeOrderBillingLines.reduce((sum, line) => sum + (line.previousBilled + numeric(workValue(line)) + numeric(storedValue(line))) * retainageRate, 0))}</td></tr></> : null}<tr className="owner-invoice-total-row" data-reflow-row="xl"><td colSpan={2} data-label="Item">Grand Totals</td><td data-label="Scheduled Value">{money.format(billingLines.reduce((sum, line) => sum + line.scheduledValue, 0))}</td><td data-label="Previous Applications">{money.format(previousEarned)}</td><td data-label="This Period">{money.format(billingLines.reduce((sum, line) => sum + numeric(workValue(line)), 0))}</td><td data-label="Stored Materials">{money.format(billingLines.reduce((sum, line) => sum + numeric(storedValue(line)), 0))}</td><td data-label="Completed And Stored">{money.format(cumulativeEarned)}</td><td data-label="Complete">{currentContract > 0 ? `${(completion * 100).toFixed(1)}%` : "0.0%"}</td><td data-label="Balance To Finish">{money.format(Math.max(0, currentContract - cumulativeEarned))}</td><td data-label="Retainage">{money.format(targetRetainage)}</td></tr></tbody></table></div></section>
          <footer><span>{currentDraft?.status === "Ready To Send" ? "READY TO SEND · FINAL DISTRIBUTION HAS NOT OCCURRED" : "DRAFT PREVIEW ONLY · NOT APPROVED OR DISTRIBUTED"}</span><b>Continuation · G703-Style · Generated {displayDate(today())}</b></footer>
        </article>
      </div></section></div> : null}

      {loading ? <div className="accounting-notice">Loading Owner Billing Automation...</div> : null}
    </div>
  );
}
