"use client";

import { useEffect, useState } from "react";
import { useLedgerAccounts } from "./use-ledger-accounts";
import { currentAccountNumber } from "../lib/accounting-numbering";
import type { AccountingActor } from "./accounting-erp";
import { MEFFORD_MASTER_COST_CODES } from "./estimate-template";
import { CurrencyInput } from "./currency-input";
import { extractInvoiceFields } from "../lib/invoice-ocr";
import { isPdfOrPhotoUpload } from "../lib/photo-uploads";
import { summaryDrilldownProps } from "./summary-drilldown";

function accountingClientId() {
  return globalThis.crypto?.randomUUID?.() || `acct-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ApView = "Invoice Register" | "Recurring Payments" | "Expected Payments" | "Wire Requests";
type PaymentMethod = "Printed Check" | "Bank Bill Pay" | "Credit Card" | "Scheduled Wire";

type StoredRecord = {
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type ProjectOption = {
  number: string;
  name: string;
  projectManager: string;
};

type Allocation = {
  id: string;
  destination: string;
  code: string;
  commitmentType: "Subcontract" | "Purchase Order" | "Approved Change Order" | "Direct Expense" | "Overhead Expense";
  commitmentReference: string;
  suggestedVendor: string;
  description: string;
  amount: string;
};

type ProjectCommitment = {
  id: string;
  type: "Subcontract" | "Purchase Order";
  vendor: string;
  costCodes: string[];
  status: string;
};

type InvoiceDraft = {
  id: string;
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  description: string;
  allocations: Allocation[];
  recurringSourceId?: string;
  recurringOccurrenceDate?: string;
  preferredPaymentMethod?: PaymentMethod;
};

type PaymentDraft = {
  invoiceId: string;
  paymentMethod: PaymentMethod;
  cardProvider: "Ramp" | "Chase";
  cardholder: string;
  cardLastFour: string;
};

type RecurringDraft = {
  vendor: string;
  description: string;
  amount: string;
  amountType: "Fixed" | "Estimated";
  dueDay: string;
  startDate: string;
  endDate: string;
  noEndDate: boolean;
  leadDays: string;
  destination: string;
  code: string;
  paymentMethod: PaymentMethod;
  cardProvider: "Ramp" | "Chase";
  cardholder: string;
  cardLastFour: string;
  responsiblePerson: string;
};

type WireDraft = {
  invoiceId: string;
  fundingAccount: string;
  requestedDate: string;
  notes: string;
};

type InvoiceOcrState = {
  status: "idle" | "scanning" | "ready" | "error";
  percent: number;
  label: string;
  confidence: string;
  characterCount: number;
  extracted: { vendor: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: number; totalSource: string; poReference: string; description: string };
  completedAt: string;
  confirmed: boolean;
};

const ACCOUNTING_PROJECT_ID = "MEFFORD-ACCOUNTING";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blankInvoiceOcr = (): InvoiceOcrState => ({ status: "idle", percent: 0, label: "", confidence: "", characterCount: 0, extracted: { vendor: "", invoiceNumber: "", invoiceDate: "", dueDate: "", total: 0, totalSource: "", poReference: "", description: "" }, completedAt: "", confirmed: false });

function currentDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function datePlusDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function newAllocation(): Allocation {
  return {
    id: accountingClientId(),
    destination: "",
    code: "",
    commitmentType: "Direct Expense",
    commitmentReference: "",
    suggestedVendor: "",
    description: "",
    amount: "",
  };
}

function newInvoiceDraft(): InvoiceDraft {
  const date = currentDate();
  return {
    id: `AP-${Date.now()}`,
    vendor: "",
    invoiceNumber: "",
    invoiceDate: date,
    dueDate: datePlusDays(date, 30),
    total: "",
    description: "",
    allocations: [newAllocation()],
  };
}

function newRecurringDraft(actor: AccountingActor): RecurringDraft {
  const date = currentDate();
  return {
    vendor: "",
    description: "",
    amount: "",
    amountType: "Fixed",
    dueDay: "1",
    startDate: date,
    endDate: "",
    noEndDate: true,
    leadDays: "7",
    destination: "Company Overhead",
    code: "",
    paymentMethod: "Printed Check",
    cardProvider: "Ramp",
    cardholder: "",
    cardLastFour: "",
    responsiblePerson: actor.name,
  };
}

function recordData(record: StoredRecord) {
  return record.data ?? {};
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function nextRecurringDate(record: StoredRecord) {
  const data = recordData(record);
  const today = currentDate();
  const start = String(data.startDate || today);
  const end = String(data.endDate || "");
  const dueDay = Math.min(28, Math.max(1, numeric(data.dueDay) || 1));
  const cursor = new Date(`${today > start ? today : start}T12:00:00`);
  let candidate = new Date(cursor.getFullYear(), cursor.getMonth(), dueDay, 12);
  if (candidate < cursor) candidate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, dueDay, 12);
  const result = candidate.toISOString().slice(0, 10);
  return end && result > end ? "" : result;
}

async function saveRecord(record: StoredRecord) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: ACCOUNTING_PROJECT_ID,
      recordType: record.type,
      record,
    }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || "The Accounts Payable Record Could Not Be Saved.");
}

async function coordinateAccounting(body: Record<string, unknown>) {
  const response = await fetch("/api/accounting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string; notice?: string };
  if (!response.ok) throw new Error(result.error || "The Coordinated Accounting Action Could Not Be Saved.");
  return result;
}

export function AccountsPayableWorkspace({ actor }: { actor: AccountingActor }) {
  const { accounts: ledgerAccounts, error: ledgerAccountError } = useLedgerAccounts();
  const [records, setRecords] = useState<StoredRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [view, setView] = useState<ApView>("Invoice Register");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [wireOpen, setWireOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft>(() => newInvoiceDraft());
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft>(() => newRecurringDraft(actor));
  const [wireDraft, setWireDraft] = useState<WireDraft>({ invoiceId: "", fundingAccount: "", requestedDate: currentDate(), notes: "" });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [invoiceOcr, setInvoiceOcr] = useState<InvoiceOcrState>(blankInvoiceOcr);
  const [commitmentsByProject, setCommitmentsByProject] = useState<Record<string, ProjectCommitment[]>>({});
  const [loadingProjectCommitments, setLoadingProjectCommitments] = useState<string[]>([]);
  const [batchSelections, setBatchSelections] = useState<string[]>([]);
  const [batchConfirmationDrafts, setBatchConfirmationDrafts] = useState<Record<string, string>>({});
  const [confirmationDrafts, setConfirmationDrafts] = useState<Record<string, string>>({});
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({ invoiceId: "", paymentMethod: "Printed Check", cardProvider: "Ramp", cardholder: "", cardLastFour: "" });

  async function loadWorkspace() {
    setLoading(true);
    try {
      const [recordResponse, projectResponse] = await Promise.all([
        fetch(`/api/records?projectId=${ACCOUNTING_PROJECT_ID}`),
        fetch("/api/projects"),
      ]);
      const recordResult = (await recordResponse.json()) as { records?: StoredRecord[]; error?: string };
      const projectResult = (await projectResponse.json()) as { projects?: ProjectOption[]; error?: string };
      if (!recordResponse.ok) throw new Error(recordResult.error || "Accounts Payable Is Unavailable.");
      if (!projectResponse.ok) throw new Error(projectResult.error || "Projects Are Unavailable.");
      setRecords(recordResult.records ?? []);
      setProjects(projectResult.projects ?? []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Accounts Payable Is Unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const open = () => {
      setInvoiceDraft(newInvoiceDraft());
      setAttachment(null);
      setInvoiceOcr(blankInvoiceOcr());
      setInvoiceOpen(true);
    };
    window.addEventListener("command:new-ap-invoice", open);
    return () => window.removeEventListener("command:new-ap-invoice", open);
  }, []);

  const invoices = records.filter((record) => record.type === "AP Invoice");
  const recurring = records.filter((record) => record.type === "Recurring Payment");
  const wires = records.filter((record) => record.type === "Wire Request");
  const batches = records.filter((record) => record.type === "Payment Batch");
  const approvedUnpaid = invoices.filter((record) => record.status === "Approved Unpaid");
  const selectedInvoice = invoices.find((record) => record.id === selectedInvoiceId);

  useEffect(() => {
    const linkedRecordId = new URLSearchParams(window.location.search).get("record") || "";
    if (linkedRecordId && invoices.some((record) => record.id === linkedRecordId)) {
      const timer = window.setTimeout(() => setSelectedInvoiceId(linkedRecordId), 0);
      return () => window.clearTimeout(timer);
    }
  }, [invoices]);
  const pendingTotal = invoices
    .filter((record) => !["Paid", "Voided", "Archived"].includes(record.status))
    .reduce((total, record) => total + numeric(recordData(record).total), 0);
  const allocatedTotal = invoiceDraft.allocations.reduce((total, line) => total + numeric(line.amount), 0);
  const allocationDifference = numeric(invoiceDraft.total) - allocatedTotal;

  const expectedRows = (() => {
    const invoiceRows = approvedUnpaid.map((record) => ({
      id: record.id,
      sourceId: record.id,
      kind: "Approved Invoice",
      vendor: String(recordData(record).vendor || record.title),
      dueDate: record.due,
      runDate: datePlusDays(record.due, -7),
      amount: numeric(recordData(record).total),
      method: String(recordData(record).paymentMethod || "Not Selected"),
      processingStatus: record.status,
    }));
    const recurringRows = recurring
      .filter((record) => record.status === "Active")
      .map((record) => {
        const dueDate = nextRecurringDate(record);
        const linkedInvoice = invoices.find((invoice) => {
          const data = recordData(invoice);
          return data.recurringSourceId === record.id && data.recurringOccurrenceDate === dueDate;
        });
        return {
          id: linkedInvoice?.id || `${record.id}-${dueDate}`,
          sourceId: record.id,
          kind: "Recurring Schedule",
          vendor: String(recordData(record).vendor || record.title),
          dueDate,
          runDate: dueDate ? datePlusDays(dueDate, -numeric(recordData(record).leadDays || 7)) : "",
          amount: numeric(recordData(record).amount),
          method: `Preferred ${String(recordData(record).paymentMethod || "Printed Check")}`,
          processingStatus: linkedInvoice?.status || "Not Started",
        };
      })
      .filter(
        (row) =>
          row.dueDate &&
          !["Approved Unpaid", "Paid", "Voided", "Archived"].includes(row.processingStatus),
      );
    return [...invoiceRows, ...recurringRows].sort((a, b) => a.runDate.localeCompare(b.runDate));
  })();

  async function loadProjectCommitments(projectId: string) {
    if (!projectId || projectId === "Company Overhead") return [];
    if (commitmentsByProject[projectId]) return commitmentsByProject[projectId];
    setLoadingProjectCommitments((current) => [...new Set([...current, projectId])]);
    try {
      const response = await fetch(`/api/records?projectId=${encodeURIComponent(projectId)}`);
      const result = (await response.json()) as { records?: StoredRecord[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Project Commitments Are Unavailable.");
      const commitments = (result.records ?? [])
        .filter(
          (record) =>
            ["Subcontracts", "Purchase Orders"].includes(record.type) &&
            !["Draft", "Returned", "Rejected", "Cancelled", "Superseded", "Voided", "Archived", "Deleted"].includes(record.status),
        )
        .map((record): ProjectCommitment => {
          const data = recordData(record);
          const allocations = Array.isArray(data.costAllocations)
            ? data.costAllocations as Array<Record<string, unknown>>
            : Array.isArray(data.allocations)
              ? data.allocations as Array<Record<string, unknown>>
              : [];
          const costCodes = allocations
            .map((allocation) => String(allocation.costCode || allocation.code || "").trim())
            .filter(Boolean);
          const singleCode = String(data.costCode || data.code || "").trim();
          if (singleCode) costCodes.push(singleCode);
          return {
            id: record.id,
            type: record.type === "Purchase Orders" ? "Purchase Order" : "Subcontract",
            vendor: String(data.subcontractor || data.vendor || record.title).trim(),
            costCodes: [...new Set(costCodes)],
            status: record.status,
          };
        })
        .filter((commitment) => commitment.vendor && commitment.costCodes.length);
      setCommitmentsByProject((current) => ({ ...current, [projectId]: commitments }));
      return commitments;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project Commitments Are Unavailable.");
      return [];
    } finally {
      setLoadingProjectCommitments((current) => current.filter((item) => item !== projectId));
    }
  }

  function matchingCommitments(line: Allocation) {
    const matches = (commitmentsByProject[line.destination] ?? []).filter(
      (commitment) => commitment.costCodes.includes(line.code),
    );
    if (!invoiceDraft.vendor.trim()) return matches;
    const vendorMatches = matches.filter(
      (commitment) => commitment.vendor.toLowerCase() === invoiceDraft.vendor.trim().toLowerCase(),
    );
    return vendorMatches.length ? vendorMatches : matches;
  }

  function applyCommitment(allocationId: string, commitment: ProjectCommitment) {
    const currentVendor = invoiceDraft.vendor.trim();
    if (currentVendor && currentVendor.toLowerCase() !== commitment.vendor.toLowerCase()) {
      setNotice(`This Commitment Belongs To ${commitment.vendor}. Confirm The Invoice Vendor Before Submitting.`);
    }
    setInvoiceDraft((current) => {
      const savedVendor = current.vendor.trim();
      return {
        ...current,
        vendor: savedVendor || commitment.vendor,
        allocations: current.allocations.map((line) =>
          line.id === allocationId
            ? {
                ...line,
                commitmentType: commitment.type,
                commitmentReference: commitment.id,
                suggestedVendor: commitment.vendor,
              }
            : line,
        ),
      };
    });
  }

  async function selectAllocationDestination(id: string, destination: string) {
    updateAllocation(id, "destination", destination);
    if (destination && destination !== "Company Overhead") {
      const commitments = await loadProjectCommitments(destination);
      if (commitments.length) {
        setNotice(`${commitments.length} Existing Commitment${commitments.length === 1 ? " Was" : "s Were"} Found For This Project.`);
      }
    }
  }

  async function selectAllocationCode(id: string, code: string) {
    const line = invoiceDraft.allocations.find((item) => item.id === id);
    if (!line) return;
    updateAllocation(id, "code", code);
    if (!code || line.destination === "Company Overhead") return;
    const commitments = await loadProjectCommitments(line.destination);
    const codeMatches = commitments.filter((commitment) => commitment.costCodes.includes(code));
    const vendorMatches = invoiceDraft.vendor.trim()
      ? codeMatches.filter((commitment) => commitment.vendor.toLowerCase() === invoiceDraft.vendor.trim().toLowerCase())
      : [];
    const bestMatches = vendorMatches.length ? vendorMatches : codeMatches;
    if (bestMatches.length === 1) {
      applyCommitment(id, bestMatches[0]);
      setNotice(`${bestMatches[0].vendor} And ${bestMatches[0].id} Were Filled From The Project Commitment.`);
    } else if (bestMatches.length > 1) {
      setNotice(`${bestMatches.length} Commitments Match This Cost Code. Select The Correct One Below.`);
    } else {
      setNotice("No Existing Commitment Matches This Project And Cost Code. The Line Will Remain A Direct Expense.");
    }
  }

  function updateAllocation(id: string, key: keyof Allocation, value: string) {
    setInvoiceDraft((current) => ({
      ...current,
      allocations: current.allocations.map((line) =>
        line.id === id
          ? {
              ...line,
              [key]: value,
              ...(key === "destination"
                ? { code: "", commitmentType: value === "Company Overhead" ? "Overhead Expense" : "Direct Expense", commitmentReference: "", suggestedVendor: "" }
                : key === "code"
                  ? { commitmentType: "Direct Expense", commitmentReference: "", suggestedVendor: "" }
                : {}),
            }
          : line,
      ),
    }));
  }

  async function uploadAttachment(invoiceId: string) {
    if (!attachment) return null;
    const form = new FormData();
    form.append("file", attachment);
    form.append("projectId", ACCOUNTING_PROJECT_ID);
    form.append("category", `Accounts Payable / ${invoiceId}`);
    form.append("revision", "Original Vendor Invoice");
    form.append("access", "Accounting Restricted");
    const response = await fetch("/api/files", { method: "POST", body: form });
    const result = (await response.json()) as { file?: { id: number; name: string }; error?: string };
    if (!response.ok) throw new Error(result.error || "The Invoice Attachment Could Not Be Stored.");
    return result.file ?? null;
  }

  async function scanInvoiceAttachment(file: File | null) {
    setAttachment(file);
    setInvoiceOcr(blankInvoiceOcr());
    if (!file) return;
    if (!isPdfOrPhotoUpload(file)) {
      setInvoiceOcr({ ...blankInvoiceOcr(), status: "error", label: "OCR supports PDF and image invoices. Manual entry remains available and the original will still be stored." });
      return;
    }
    setInvoiceOcr({ ...blankInvoiceOcr(), status: "scanning", percent: 1, label: "Preparing invoice OCR" });
    try {
      const { recognizeMobileDocument } = await import("../lib/mobile-ocr");
      const text = await recognizeMobileDocument(file, (progress) => setInvoiceOcr((current) => ({ ...current, status: "scanning", percent: progress.percent, label: progress.label, confirmed: false })));
      const extracted = extractInvoiceFields(text);
      setInvoiceDraft((current) => ({
        ...current,
        vendor: current.vendor || extracted.vendor,
        invoiceNumber: current.invoiceNumber || extracted.invoiceNumber,
        invoiceDate: extracted.invoiceDate || current.invoiceDate,
        dueDate: extracted.dueDate || current.dueDate,
        total: current.total || (extracted.total ? String(extracted.total) : ""),
        description: current.description || extracted.description,
      }));
      setInvoiceOcr({ status: "ready", percent: 100, label: "Suggestions are ready for Accounting review", confidence: extracted.confidence, characterCount: extracted.characterCount, extracted, completedAt: new Date().toISOString(), confirmed: false });
    } catch (error) {
      setInvoiceOcr({ ...blankInvoiceOcr(), status: "error", label: error instanceof Error ? `OCR needs review: ${error.message}` : "OCR could not read this invoice. Manual entry remains available." });
    }
  }

  function validateInvoice() {
    const total = numeric(invoiceDraft.total);
    if (!invoiceDraft.vendor.trim() || !invoiceDraft.invoiceNumber.trim() || !invoiceDraft.invoiceDate || !invoiceDraft.dueDate || total <= 0) {
      return "Vendor Invoice Number Dates And A Positive Total Are Required.";
    }
    if (!invoiceDraft.allocations.length || invoiceDraft.allocations.some((line) => !line.destination || !line.code || numeric(line.amount) <= 0)) {
      return "Every Allocation Requires A Project Or Overhead Account A Cost Code And A Positive Amount.";
    }
    if (Math.abs(allocationDifference) > 0.005) return "Allocation Lines Must Equal The Complete Invoice Total.";
    if (invoiceOcr.status === "scanning") return "Wait For Invoice OCR To Finish Or Remove The Attachment.";
    if (invoiceOcr.status === "ready" && !invoiceOcr.confirmed) return "Review The OCR Suggestions Against The Original Invoice And Confirm Them Before Saving.";
    const duplicate = invoices.find((record) => {
      const data = recordData(record);
      return record.id !== invoiceDraft.id &&
        String(data.vendor || "").trim().toLowerCase() === invoiceDraft.vendor.trim().toLowerCase() &&
        String(data.invoiceNumber || "").trim().toLowerCase() === invoiceDraft.invoiceNumber.trim().toLowerCase();
    });
    if (duplicate) return `Invoice Number ${invoiceDraft.invoiceNumber} Already Exists For ${invoiceDraft.vendor}.`;
    return "";
  }

  async function storeInvoice(submitForReview: boolean) {
    const validation = validateInvoice();
    if (validation) {
      setNotice(validation);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const previous = invoices.find((record) => record.id === invoiceDraft.id);
      const previousData = previous ? recordData(previous) : {};
      const uploaded = await uploadAttachment(invoiceDraft.id);
      const total = numeric(invoiceDraft.total);
      const noPoAlert = total > 5000 && invoiceDraft.allocations.some(
        (line) => line.destination !== "Company Overhead" && line.commitmentType !== "Purchase Order",
      );
      const record: StoredRecord = {
        id: invoiceDraft.id,
        type: "AP Invoice",
        title: `${invoiceDraft.vendor} · ${invoiceDraft.invoiceNumber}`,
        owner: actor.name,
        due: invoiceDraft.dueDate,
        status: submitForReview ? "Project Review" : previous?.status || "Draft",
        recordDate: invoiceDraft.invoiceDate,
        data: {
          ...previousData,
          ...invoiceDraft,
          total,
          allocations: invoiceDraft.allocations.map((line) => ({ ...line, amount: numeric(line.amount) })),
          noPoAlert,
          overOwnerThreshold: total > 200000,
          paymentStatus: previousData.paymentStatus || "Unscheduled",
          attachmentId: uploaded?.id || previousData.attachmentId || null,
          attachmentName: uploaded?.name || previousData.attachmentName || "",
          createdBy: previousData.createdBy || actor.name,
          createdAt: previousData.createdAt || new Date().toISOString(),
          approvalHistory: previousData.approvalHistory || [],
          documentIntelligence: attachment ? {
            engine: "PDF Text + Tesseract OCR",
            status: invoiceOcr.status === "ready" ? "Human Reviewed" : "Manual Entry - OCR Unavailable",
            confidence: invoiceOcr.confidence,
            characterCount: invoiceOcr.characterCount,
            extracted: invoiceOcr.extracted,
            reviewed: { vendor: invoiceDraft.vendor, invoiceNumber: invoiceDraft.invoiceNumber, invoiceDate: invoiceDraft.invoiceDate, dueDate: invoiceDraft.dueDate, total, description: invoiceDraft.description },
            reviewedBy: actor.name,
            reviewedAt: new Date().toISOString(),
            completedAt: invoiceOcr.completedAt,
            originalPreserved: true,
          } : previousData.documentIntelligence || null,
          livePosting: false,
        },
      };
      await saveRecord(record);
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setInvoiceOpen(false);
      setAttachment(null);
      setInvoiceOcr(blankInvoiceOcr());
      if (invoiceDraft.recurringSourceId) setView("Invoice Register");
      setNotice(submitForReview ? "Invoice Saved And Sent To Project Review." : "Invoice Draft Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Invoice Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  function editInvoice(record: StoredRecord) {
    const data = recordData(record);
    const allocations = Array.isArray(data.allocations) ? data.allocations as Allocation[] : [newAllocation()];
    setInvoiceDraft({
      id: record.id,
      vendor: String(data.vendor || ""),
      invoiceNumber: String(data.invoiceNumber || ""),
      invoiceDate: record.recordDate || currentDate(),
      dueDate: record.due,
      total: String(data.total || ""),
      description: String(data.description || ""),
      allocations: allocations.map((line) => ({ ...line, id: line.id || accountingClientId(), suggestedVendor: line.suggestedVendor || "", amount: String(line.amount || "") })),
      recurringSourceId: String(data.recurringSourceId || "") || undefined,
      recurringOccurrenceDate: String(data.recurringOccurrenceDate || "") || undefined,
      preferredPaymentMethod: data.preferredPaymentMethod as PaymentMethod | undefined,
    });
    setAttachment(null);
    setInvoiceOcr(blankInvoiceOcr());
    setInvoiceOpen(true);
  }

  async function advanceInvoice(record: StoredRecord) {
    const total = numeric(recordData(record).total);
    const nextStatus = record.status === "Project Review"
      ? "Accounting Review"
      : record.status === "Accounting Review"
        ? total > 200000 ? "Owner Approval" : "Approved Unpaid"
        : record.status === "Owner Approval"
          ? "Approved Unpaid"
          : "";
    if (!nextStatus) return;
    setSaving(true);
    try {
      const history = Array.isArray(recordData(record).approvalHistory) ? recordData(record).approvalHistory as unknown[] : [];
      const updated: StoredRecord = {
        ...record,
        status: nextStatus,
        data: {
          ...recordData(record),
          approvalHistory: [...history, { from: record.status, to: nextStatus, by: actor.name, date: currentDate() }],
        },
      };
      await saveRecord(updated);
      setRecords((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setNotice(`${record.title} Is Now In ${nextStatus}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Invoice Status Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  function openPaymentPreparation(record: StoredRecord) {
    const data = recordData(record);
    setPaymentDraft({
      invoiceId: record.id,
      paymentMethod: (data.paymentMethod as PaymentMethod) || (data.preferredPaymentMethod as PaymentMethod) || "Printed Check",
      cardProvider: data.cardProvider === "Chase" ? "Chase" : "Ramp",
      cardholder: String(data.cardholder || ""),
      cardLastFour: String(data.cardLastFour || ""),
    });
    setPaymentOpen(true);
  }

  async function savePaymentPreparation() {
    const invoice = invoices.find((record) => record.id === paymentDraft.invoiceId);
    if (!invoice || invoice.status !== "Approved Unpaid") {
      setNotice("Only An Approved Unpaid Invoice Can Be Prepared For Payment.");
      return;
    }
    if (
      paymentDraft.paymentMethod === "Credit Card" &&
      (!paymentDraft.cardholder.trim() || !/^\d{4}$/.test(paymentDraft.cardLastFour))
    ) {
      setNotice("Credit Card Payment Preparation Requires Ramp Or Chase The Cardholder And The Last Four Digits.");
      return;
    }
    setSaving(true);
    try {
      const updated: StoredRecord = {
        ...invoice,
        data: {
          ...recordData(invoice),
          ...paymentDraft,
          paymentStatus: "Prepared",
          paymentPreparedBy: actor.name,
          paymentPreparedDate: currentDate(),
        },
      };
      await saveRecord(updated);
      setRecords((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setPaymentOpen(false);
      setNotice(`${invoice.title} Was Prepared For ${paymentDraft.paymentMethod}. No Payment Was Released.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Payment Preparation Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function storeRecurring() {
    const amount = numeric(recurringDraft.amount);
    if (!recurringDraft.vendor.trim() || !recurringDraft.description.trim() || amount <= 0 || !recurringDraft.startDate || !recurringDraft.destination || !recurringDraft.code) {
      setNotice("Vendor Description Amount Start Date And Accounting Allocation Are Required.");
      return;
    }
    if (!recurringDraft.noEndDate && !recurringDraft.endDate) {
      setNotice("Enter An End Date Or Select No End Date.");
      return;
    }
    if (recurringDraft.paymentMethod === "Credit Card" && (!recurringDraft.cardholder.trim() || !/^\d{4}$/.test(recurringDraft.cardLastFour))) {
      setNotice("Credit Card Payments Require The Provider Cardholder And Last Four Digits.");
      return;
    }
    setSaving(true);
    try {
      const id = `REC-${accountingClientId()}`;
      const record: StoredRecord = {
        id,
        type: "Recurring Payment",
        title: `${recurringDraft.vendor} · ${recurringDraft.description}`,
        owner: actor.name,
        due: recurringDraft.noEndDate ? "No End Date" : recurringDraft.endDate,
        status: "Active",
        recordDate: currentDate(),
        data: {
          ...recurringDraft,
          amount,
          cashFlowForecast: true,
          accountsPayableProcessing: true,
          createdBy: actor.name,
          livePosting: false,
        },
      };
      await saveRecord(record);
      setRecords((current) => [record, ...current]);
      setRecurringOpen(false);
      setRecurringDraft(newRecurringDraft(actor));
      setNotice("Recurring Payment Schedule Saved For Cash Forecasting And Monthly Accounts Payable Processing.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Recurring Payment Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRecurring(record: StoredRecord) {
    const updated = { ...record, status: record.status === "Active" ? "Paused" : "Active" };
    setSaving(true);
    try {
      await saveRecord(updated);
      setRecords((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setNotice(`${record.title} Is Now ${updated.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Schedule Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  async function prepareRecurringPayable(record: StoredRecord) {
    const data = recordData(record);
    const dueDate = nextRecurringDate(record);
    if (!dueDate) {
      setNotice("This Recurring Schedule Is Complete And Has No Remaining Payable Date.");
      return;
    }
    const existing = invoices.find((invoice) => {
      const invoiceData = recordData(invoice);
      return invoiceData.recurringSourceId === record.id && invoiceData.recurringOccurrenceDate === dueDate;
    });
    if (existing) {
      setView("Invoice Register");
      if (existing.status === "Draft") editInvoice(existing);
      else setSelectedInvoiceId(existing.id);
      setNotice(`${record.title} Already Has An Accounts Payable Item For ${formatDate(dueDate)}.`);
      return;
    }

    const destination = String(data.destination || "Company Overhead");
    const code = String(data.code || "");
    const amount = numeric(data.amount);
    let matchedCommitment: ProjectCommitment | undefined;
    if (destination !== "Company Overhead") {
      const commitments = await loadProjectCommitments(destination);
      const codeMatches = commitments.filter((commitment) => commitment.costCodes.includes(code));
      const vendorMatches = codeMatches.filter(
        (commitment) => commitment.vendor.toLowerCase() === String(data.vendor || "").trim().toLowerCase(),
      );
      matchedCommitment = vendorMatches.length === 1
        ? vendorMatches[0]
        : codeMatches.length === 1
          ? codeMatches[0]
          : undefined;
    }

    const allocation: Allocation = {
      id: accountingClientId(),
      destination,
      code,
      commitmentType: destination === "Company Overhead"
        ? "Overhead Expense"
        : matchedCommitment?.type || "Direct Expense",
      commitmentReference: matchedCommitment?.id || "",
      suggestedVendor: matchedCommitment?.vendor || "",
      description: String(data.description || "Recurring Payment"),
      amount: String(amount),
    };
    setInvoiceDraft({
      id: `AP-${record.id}-${dueDate}`,
      vendor: String(data.vendor || record.title),
      invoiceNumber: `RECURRING-${dueDate}-${record.id.slice(-6).toUpperCase()}`,
      invoiceDate: currentDate(),
      dueDate,
      total: String(amount),
      description: String(data.description || "Recurring Payment"),
      allocations: [allocation],
      recurringSourceId: record.id,
      recurringOccurrenceDate: dueDate,
      preferredPaymentMethod: (data.paymentMethod as PaymentMethod) || "Printed Check",
    });
    setAttachment(null);
    setInvoiceOpen(true);
    setNotice("The Monthly Accounts Payable Item Was Prefilled From The Recurring Schedule. Confirm The Actual Invoice Details Then Save Or Submit It.");
  }

  function openWire(record: StoredRecord) {
    setWireDraft({ invoiceId: record.id, fundingAccount: "", requestedDate: currentDate(), notes: "" });
    setWireOpen(true);
  }

  async function storeWire() {
    const invoice = invoices.find((record) => record.id === wireDraft.invoiceId);
    if (!invoice || !wireDraft.fundingAccount.trim() || !wireDraft.requestedDate) {
      setNotice("Select An Invoice Funding Account And Requested Wire Date.");
      return;
    }
    setSaving(true);
    try {
      const total = numeric(recordData(invoice).total);
      const id = `WIRE-${accountingClientId()}`;
      const record: StoredRecord = {
        id,
        type: "Wire Request",
        title: `Wire · ${invoice.title}`,
        owner: actor.name,
        due: wireDraft.requestedDate,
        status: "Requested",
        recordDate: currentDate(),
        data: {
          ...wireDraft,
          vendor: recordData(invoice).vendor,
          amount: total,
          preparedBy: actor.name,
          approvalsRequired: total > 200000 ? 2 : 1,
          approvals: [],
          bankConfirmation: "",
          initiatedBy: "",
          initiatedAt: "",
          liveTransmission: false,
        },
      };
      await saveRecord(record);
      setRecords((current) => [record, ...current]);
      setWireOpen(false);
      setView("Wire Requests");
      setNotice("Wire Request Saved. The Bank Will Execute It Outside Command Center.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Wire Request Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function advanceWire(record: StoredRecord) {
    const data = recordData(record);
    let status = record.status;
    let nextData = { ...data };
    if (status === "Requested") {
      const approvals = Array.isArray(data.approvals) ? [...data.approvals as unknown[]] : [];
      if (actor.accessLevel !== "Company Owner") {
        setNotice("A Company Owner Must Approve The Wire Request.");
        return;
      }
      approvals.push({ owner: actor.name, date: currentDate() });
      nextData = { ...nextData, approvals };
      status = approvals.length >= numeric(data.approvalsRequired || 1) ? "Approved" : "Second Owner Approval";
    } else if (status === "Second Owner Approval") {
      if (actor.accessLevel !== "Company Owner") {
        setNotice("A Second Company Owner Must Approve This Wire.");
        return;
      }
      const approvals: Array<{ owner?: string; date?: string }> = Array.isArray(data.approvals) ? [...data.approvals as Array<{ owner?: string; date?: string }>] : [];
      if (approvals.some((approval) => approval.owner === actor.name)) {
        setNotice("The Second Approval Must Come From A Different Company Owner.");
        return;
      }
      approvals.push({ owner: actor.name, date: currentDate() });
      nextData = { ...nextData, approvals };
      status = "Approved";
    } else if (status === "Approved") {
      const confirmation = (confirmationDrafts[record.id] || "").trim();
      if (!confirmation) {
        setNotice("Enter The Bank Confirmation Number Before Marking The Wire Initiated.");
        return;
      }
      status = "Initiated";
      nextData = { ...nextData, bankConfirmation: confirmation, initiatedBy: actor.name, initiatedAt: new Date().toISOString() };
    } else if (status === "Initiated") {
      setSaving(true);
      try {
        const result = await coordinateAccounting({ action: "clear-wire", recordId: record.id, confirmation: String(data.bankConfirmation || "") });
        setNotice(result.notice || `${record.title} Is Now Cleared.`);
        await loadWorkspace();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The Wire Could Not Be Cleared.");
      } finally {
        setSaving(false);
      }
      return;
    } else return;
    setSaving(true);
    try {
      const updated = { ...record, status, data: nextData };
      await saveRecord(updated);
      setRecords((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setNotice(`${record.title} Is Now ${status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Wire Record Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  async function createExpectedBatch() {
    const selected = approvedUnpaid.filter((record) => batchSelections.includes(record.id));
    if (!selected.length) {
      setNotice("Select At Least One Approved Invoice For The Expected Payment Batch.");
      return;
    }
    const unprepared = selected.filter((record) => !String(recordData(record).paymentMethod || "").trim());
    if (unprepared.length) {
      setNotice("Choose A Payment Method For Every Selected Invoice Before Creating The Expected Batch.");
      return;
    }
    setSaving(true);
    try {
      const id = `BATCH-${accountingClientId()}`;
      const total = selected.reduce((sum, record) => sum + numeric(recordData(record).total), 0);
      const record: StoredRecord = {
        id,
        type: "Payment Batch",
        title: `Expected Payment Batch · ${formatDate(currentDate())}`,
        owner: actor.name,
        due: currentDate(),
        status: "Prepared",
        recordDate: currentDate(),
        data: { invoiceIds: selected.map((record) => record.id), total, preparedBy: actor.name, liveRelease: false },
      };
      await saveRecord(record);
      setRecords((current) => [record, ...current]);
      setBatchSelections([]);
      setNotice(`Expected Payment Batch Saved For ${money.format(total)}. No Payment Was Released.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Expected Batch Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function advanceBatch(record: StoredRecord) {
    const action = record.status === "Prepared" ? "release-payment-batch" : record.status === "Released" ? "clear-payment-batch" : "";
    if (!action) return;
    const confirmation = (batchConfirmationDrafts[record.id] || "").trim();
    if (action === "clear-payment-batch" && !confirmation) {
      setNotice("Enter The External Check Bank Card Or Wire Clearing Confirmation Before Posting The Batch.");
      return;
    }
    setSaving(true);
    try {
      const result = await coordinateAccounting({ action, recordId: record.id, confirmation });
      setNotice(result.notice || `${record.title} Was Updated.`);
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Payment Batch Could Not Be Updated.");
    } finally {
      setSaving(false);
    }
  }

  function codeOptions(destination: string) {
    if (destination === "Company Overhead") {
      return ledgerAccounts.filter((account) => ["Administrative Expense", "Overhead Expense", "Direct Expense"].includes(account.category));
    }
    return MEFFORD_MASTER_COST_CODES.filter((code) => code.budgetable);
  }

  return (
    <div className="accounting-workspace ap-workspace">{ledgerAccountError ? <p role="alert">{ledgerAccountError}</p> : null}
      <section className="accounting-hero ap-hero">
        <div>

          <h1>Invoice And Payment Control</h1>

        </div>

      </section>

      {notice ? <div className="accounting-notice" role="status">{notice}</div> : null}

      <section className="accounting-summary-grid ap-summary" aria-label="Accounts Payable Summary">
        <article {...summaryDrilldownProps({ title: "Open Accounts Payable", rows: invoices.filter((record) => !["Paid", "Voided", "Archived"].includes(record.status)).map((record) => apRecordSummaryRow(record, setSelectedInvoiceId, () => setView("Invoice Register"))) })}><span>OPEN AP</span><strong>{money.format(pendingTotal)}</strong><small>{invoices.filter((record) => !["Paid", "Voided", "Archived"].includes(record.status)).length} Open Invoices</small></article>
        <article {...summaryDrilldownProps({ title: "Approved Unpaid Invoices", rows: approvedUnpaid.map((record) => apRecordSummaryRow(record, setSelectedInvoiceId, () => setView("Invoice Register"))) })}><span>APPROVED UNPAID</span><strong>{money.format(approvedUnpaid.reduce((sum, record) => sum + numeric(recordData(record).total), 0))}</strong><small>Ready For Payment Preparation</small></article>
        <article {...summaryDrilldownProps({ title: "Expected Payments", rows: expectedRows.map((row) => ({ id: row.id, title: row.vendor, subtitle: `${row.kind} · Run ${formatDate(row.runDate)} · Due ${formatDate(row.dueDate)}`, status: row.processingStatus, value: money.format(row.amount), meta: row.method, onOpen: () => setView("Expected Payments"), openLabel: "Open Expected Payments →" })) })}><span>EXPECTED PAYMENTS</span><strong>{money.format(expectedRows.reduce((sum, row) => sum + row.amount, 0))}</strong><small>Invoices And Recurring Schedules</small></article>
        <article {...summaryDrilldownProps({ title: "Active Recurring Payments", rows: recurring.filter((record) => record.status === "Active").map((record) => ({ id: record.id, title: String(recordData(record).vendor || record.title), subtitle: `${String(recordData(record).frequency || "Recurring")} · Next ${formatDate(nextRecurringDate(record))}`, status: record.status, value: money.format(numeric(recordData(record).amount)), onOpen: () => setView("Recurring Payments"), openLabel: "Open Recurring Payments →" })) })}><span>ACTIVE RECURRING</span><strong>{recurring.filter((record) => record.status === "Active").length}</strong><small>Included In Cash Forecast</small></article>
      </section>

      <section className="ap-toolbar">
        <div className="ap-view-tabs" role="tablist">
          {(["Invoice Register", "Recurring Payments", "Expected Payments", "Wire Requests"] as ApView[]).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)} role="tab" aria-selected={view === item}>{item}</button>
          ))}
        </div>
        <div className="ap-toolbar-actions">
          {view === "Recurring Payments" ? <button className="primary-action" onClick={() => setRecurringOpen(true)}>＋ New Recurring Payment</button> : null}
          {view === "Invoice Register" ? <button className="primary-action" onClick={() => { setInvoiceDraft(newInvoiceDraft()); setAttachment(null); setInvoiceOcr(blankInvoiceOcr()); setInvoiceOpen(true); }}>＋ New Invoice</button> : null}
        </div>
      </section>

      {view === "Invoice Register" ? (
        <section className="ap-panel">
          <div className="ap-panel-heading"><div><h2>Invoice Register</h2></div><span>{loading ? "Loading..." : `${invoices.length} Invoices`}</span></div>
          <div className="ap-table-wrap">
            <div className="ap-table ap-invoice-table" role="table" data-reflow-table="">
              <div className="ap-table-row header" role="row" data-reflow-head="wide"><span>Vendor / Invoice</span><span>Invoice Date</span><span>Due Date</span><span>Total</span><span>Status</span><span>Alerts</span><span>Actions</span></div>
              {!loading && !invoices.length ? <div className="ap-empty"><strong>No Invoices Yet</strong><span>Create The First Manual Invoice To Test The Complete Workflow.</span></div> : null}
              {invoices.map((record) => {
                const data = recordData(record);
                return (
                  <div className="ap-table-row" role="row" key={record.id} data-reflow-row="wide">
                    <span data-label="Vendor / Invoice"><b>{String(data.vendor || record.title)}</b><small>#{String(data.invoiceNumber || "—")} · {Array.isArray(data.allocations) ? data.allocations.length : 0} Allocations</small></span>
                    <span data-label="Invoice Date">{formatDate(record.recordDate || "")}</span>
                    <span data-label="Due Date">{formatDate(record.due)}</span>
                    <strong data-label="Total">{money.format(numeric(data.total))}</strong>
                    <span data-label="Status"><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i></span>
                    <span className="ap-alerts" data-label="Alerts">{data.recurringSourceId ? <b>RECURRING</b> : null}{data.noPoAlert ? <b>$5,000.00 NO PO</b> : null}{data.overOwnerThreshold ? <b>OWNER APPROVAL</b> : null}</span>
                    <span className="ap-row-actions" data-label="Actions">
                      <button onClick={() => setSelectedInvoiceId(record.id)}>Open</button>
                      {record.status === "Draft" ? <button onClick={() => editInvoice(record)}>Edit</button> : null}
                      {["Project Review", "Accounting Review", "Owner Approval"].includes(record.status) ? <button disabled={saving} onClick={() => void advanceInvoice(record)}>{record.status === "Project Review" ? "Approve Work" : record.status === "Accounting Review" ? "Approve Accounting" : "Owner Approve"}</button> : null}
                      {record.status === "Approved Unpaid" ? <button onClick={() => openPaymentPreparation(record)}>{data.paymentMethod ? "Edit Payment Prep" : "Prepare Payment"}</button> : null}
                      {record.status === "Approved Unpaid" && data.paymentMethod === "Scheduled Wire" && !wires.some((wire) => recordData(wire).invoiceId === record.id) ? <button onClick={() => openWire(record)}>Create Wire</button> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {view === "Recurring Payments" ? (
        <section className="ap-panel">
          <div className="ap-panel-heading"><div><h2>Recurring Payments</h2></div><button className="secondary-action" onClick={() => setRecurringOpen(true)}>＋ Add Schedule</button></div>

          <div className="recurring-grid">
            {!recurring.length ? <div className="ap-empty"><strong>No Recurring Schedules Yet</strong><span>Add Rent Utilities Loans Subscriptions Or Other Monthly Commitments.</span></div> : null}
            {recurring.map((record) => {
              const data = recordData(record);
              const nextDate = nextRecurringDate(record);
              const currentPayable = invoices.find((invoice) => {
                const invoiceData = recordData(invoice);
                return invoiceData.recurringSourceId === record.id && invoiceData.recurringOccurrenceDate === nextDate;
              });
              return <article key={record.id}>
                <div><span className={`ap-status ${record.status.toLowerCase()}`}>{record.status}</span><small>{String(data.amountType || "Fixed")} Monthly</small></div>
                <h3>{String(data.vendor || record.title)}</h3><p>{String(data.description || "")}</p>
                <strong>{money.format(numeric(data.amount))}</strong>
                <dl><div><dt>Next Due</dt><dd>{nextDate ? formatDate(nextDate) : "Schedule Complete"}</dd></div><div><dt>AP Preparation Date</dt><dd>{nextDate ? formatDate(datePlusDays(nextDate, -numeric(data.leadDays || 7))) : "—"}</dd></div><div><dt>Preferred Method</dt><dd>{String(data.paymentMethod || "—")}</dd></div><div><dt>Current AP Status</dt><dd>{currentPayable?.status || "Not Started"}</dd></div></dl>
                <div className="recurring-card-actions">
                  <button className="primary-action" disabled={saving || record.status !== "Active" || !nextDate} onClick={() => void prepareRecurringPayable(record)}>{currentPayable ? currentPayable.status === "Draft" ? "Edit Current AP Draft" : "Open Current AP" : "Prepare Current AP"}</button>
                  <button className="secondary-action" disabled={saving} onClick={() => void toggleRecurring(record)}>{record.status === "Active" ? "Pause Schedule" : "Resume Schedule"}</button>
                </div>
              </article>;
            })}
          </div>
        </section>
      ) : null}

      {view === "Expected Payments" ? (
        <section className="ap-panel">
          <div className="ap-panel-heading"><div><h2>Expected Payments And Check Runs</h2></div><button className="primary-action" disabled={saving || !batchSelections.length} onClick={() => void createExpectedBatch()}>Create Expected Batch</button></div>
          <div className="ap-table-wrap">
            <div className="ap-table ap-expected-table" role="table" data-reflow-table="">
              <div className="ap-table-row header" data-reflow-head="wide"><span>Select</span><span>Vendor</span><span>Source</span><span>Expected Run</span><span>Due Date</span><span>Method</span><span>Amount</span><span>Action</span></div>
              {!expectedRows.length ? <div className="ap-empty"><strong>No Expected Payments Yet</strong><span>Approved Invoices And Active Recurring Schedules Will Appear Here.</span></div> : null}
              {expectedRows.map((row) => <div className="ap-table-row" key={`${row.kind}-${row.id}`} data-reflow-row="wide">
                <span data-label="Select">{row.kind === "Approved Invoice" ? row.method === "Scheduled Wire" ? "Wire" : <input aria-label={`Select ${row.vendor}`} type="checkbox" disabled={row.method === "Not Selected"} checked={batchSelections.includes(row.id)} onChange={(event) => setBatchSelections((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /> : "Forecast"}</span>
                <span data-label="Vendor"><b>{row.vendor}</b><small>{row.kind === "Recurring Schedule" ? row.processingStatus : ""}</small></span><span data-label="Source">{row.kind}</span><span data-label="Expected Run">{formatDate(row.runDate)}</span><span data-label="Due Date">{formatDate(row.dueDate)}</span><span data-label="Method">{row.method}</span><strong data-label="Amount">{money.format(row.amount)}</strong><span className="ap-row-actions" data-label="Action">{row.kind === "Approved Invoice" ? <button onClick={() => openPaymentPreparation(invoices.find((record) => record.id === row.id)!)}>{row.method === "Not Selected" ? "Choose Method" : "Edit Method"}</button> : <button onClick={() => { const schedule = recurring.find((record) => record.id === row.sourceId); if (schedule) void prepareRecurringPayable(schedule); }}>{row.processingStatus === "Not Started" ? "Prepare AP" : "Open AP"}</button>}</span>
              </div>)}
            </div>
          </div>
          {batches.length ? <div className="batch-history coordinated-batches"><strong>Payment Batch Control</strong>{batches.map((batch) => <article key={batch.id}><span><b>{batch.title}</b><small>{Array.isArray(recordData(batch).invoiceIds) ? (recordData(batch).invoiceIds as unknown[]).length : 0} Invoices · {money.format(numeric(recordData(batch).total))}</small></span><i className={`ap-status ${batch.status.toLowerCase().replaceAll(" ", "-")}`}>{batch.status}</i>{batch.status === "Released" ? <input aria-label={`Clearing Confirmation For ${batch.title}`} value={batchConfirmationDrafts[batch.id] || ""} onChange={(event) => setBatchConfirmationDrafts((current) => ({ ...current, [batch.id]: event.target.value }))} placeholder="External Clearing Confirmation" /> : null}{["Prepared", "Released"].includes(batch.status) ? <button className="primary-action" disabled={saving} onClick={() => void advanceBatch(batch)}>{batch.status === "Prepared" ? "Owner Release" : "Match Clear And Post"}</button> : <b>Posted To Project Job Cost</b>}</article>)}</div> : null}
        </section>
      ) : null}

      {view === "Wire Requests" ? (
        <section className="ap-panel">
          <div className="ap-panel-heading"><div><h2>Wire Request Records</h2></div><span>{wires.length} Wire Records</span></div>
          <div className="wire-grid">
            {!wires.length ? <div className="ap-empty"><strong>No Wire Requests Yet</strong><span>An Approved Unpaid Invoice With Scheduled Wire As Its Method Can Start A Request.</span></div> : null}
            {wires.map((record) => {
              const data = recordData(record);
              return <article key={record.id}>
                <div><i className={`ap-status ${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</i><small>{formatDate(record.due)}</small></div>
                <h3>{String(data.vendor || record.title)}</h3><strong>{money.format(numeric(data.amount))}</strong>
                <p>Funding Account: {String(data.fundingAccount || "—")}</p><p>Prepared By: {String(data.preparedBy || "—")}</p><p>Approvals: {Array.isArray(data.approvals) ? data.approvals.length : 0} Of {numeric(data.approvalsRequired || 1)}</p>
                {record.status === "Approved" ? <input aria-label={`Bank Confirmation For ${record.title}`} placeholder="Bank Confirmation Number" value={confirmationDrafts[record.id] || ""} onChange={(event) => setConfirmationDrafts((current) => ({ ...current, [record.id]: event.target.value }))} /> : null}
                {data.bankConfirmation ? <p>Confirmation: {String(data.bankConfirmation)}</p> : null}
                {["Requested", "Second Owner Approval", "Approved", "Initiated"].includes(record.status) ? <button className="primary-action" disabled={saving} onClick={() => void advanceWire(record)}>{record.status === "Requested" || record.status === "Second Owner Approval" ? "Approve Wire" : record.status === "Approved" ? "Mark Initiated" : "Match And Clear"}</button> : null}
              </article>;
            })}
          </div>
        </section>
      ) : null}

      {selectedInvoice ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedInvoiceId("")}>
          <section className="record-modal ap-detail-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
            <div className="modal-heading"><div><h2 id="invoice-detail-title">{selectedInvoice.title}</h2></div><button aria-label="Close Invoice Details" onClick={() => setSelectedInvoiceId("")}>×</button></div>
            <div className="ap-detail-summary"><article><span>Total</span><strong>{money.format(numeric(recordData(selectedInvoice).total))}</strong></article><article><span>Status</span><strong>{selectedInvoice.status}</strong></article><article><span>Due</span><strong>{formatDate(selectedInvoice.due)}</strong></article><article><span>Payment Method</span><strong>{String(recordData(selectedInvoice).paymentMethod || "Not Selected Yet")}</strong></article></div>
            <div className="ap-allocation-review"><h3>Allocations</h3>{Array.isArray(recordData(selectedInvoice).allocations) ? (recordData(selectedInvoice).allocations as Array<Record<string, unknown>>).map((line, index) => <div key={String(line.id || index)}><span>{String(line.destination || "—")}</span><span>{String(line.code || "—")}</span><span>{String(line.commitmentType || "—")}</span><strong>{money.format(numeric(line.amount))}</strong></div>) : null}</div>
            {recordData(selectedInvoice).attachmentId ? <button className="secondary-action" onClick={() => window.open(`/api/files?id=${recordData(selectedInvoice).attachmentId}`, "_blank", "noopener,noreferrer")}>Open Original Invoice</button> : <div className="permission-note"><strong>No Attachment</strong><span>This Invoice Was Entered Manually Without A Supporting File.</span></div>}

          </section>
        </div>
      ) : null}

      {invoiceOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setInvoiceOpen(false)}>
          <section className="record-modal ap-entry-modal" role="dialog" aria-modal="true" aria-labelledby="new-invoice-title">
            <div className="modal-heading"><div><h2 id="new-invoice-title">{invoices.some((record) => record.id === invoiceDraft.id) ? "Edit Invoice Draft" : "New Vendor Invoice"}</h2></div><button aria-label="Close Invoice Entry" onClick={() => setInvoiceOpen(false)}>×</button></div>
            <div className="field-grid three-column">
              <label className="field-label">Vendor<input value={invoiceDraft.vendor} onChange={(event) => setInvoiceDraft((current) => ({ ...current, vendor: event.target.value }))} placeholder="Vendor Company" /></label>
              <label className="field-label">Invoice Number<input value={invoiceDraft.invoiceNumber} onChange={(event) => setInvoiceDraft((current) => ({ ...current, invoiceNumber: event.target.value }))} placeholder="Invoice Number" /></label>
              <label className="field-label">Invoice Total<CurrencyInput min="0" value={invoiceDraft.total} onValueChange={(value) => setInvoiceDraft((current) => ({ ...current, total: value }))} placeholder="0.00" /></label>
              <label className="field-label">Invoice Date<input type="date" value={invoiceDraft.invoiceDate} onChange={(event) => setInvoiceDraft((current) => ({ ...current, invoiceDate: event.target.value }))} /></label>
              <label className="field-label">Due Date<input type="date" value={invoiceDraft.dueDate} onChange={(event) => setInvoiceDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
            </div>
            <label className="field-label">Description<textarea value={invoiceDraft.description} onChange={(event) => setInvoiceDraft((current) => ({ ...current, description: event.target.value }))} placeholder="What Is This Invoice For?" /></label>

            <div className="ap-upload-row"><label><span>Supporting Invoice</span><input type="file" onChange={(event) => void scanInvoiceAttachment(event.target.files?.[0] || null)} /></label><small>{attachment ? attachment.name : String(recordData(invoices.find((record) => record.id === invoiceDraft.id) || { data: {} } as StoredRecord).attachmentName || "Optional For Manual Entry")}</small><i>The original is stored permanently. OCR suggestions never replace Accounting review.</i></div>
            {invoiceOcr.status !== "idle" ? <section className={`invoice-ocr-review ${invoiceOcr.status}`}><header><div><h3>{invoiceOcr.status === "scanning" ? `${invoiceOcr.percent}% · Reading Invoice` : invoiceOcr.status === "ready" ? `${invoiceOcr.confidence} Confidence · Review Required` : "OCR Could Not Prefill This File"}</h3></div><b>{invoiceOcr.status === "ready" ? "OCR" : invoiceOcr.status === "scanning" ? "…" : "!"}</b></header><span>{invoiceOcr.label}</span>{invoiceOcr.status === "ready" ? <><div><p><b>Vendor</b>{invoiceOcr.extracted.vendor || "Not detected"}</p><p><b>Invoice #</b>{invoiceOcr.extracted.invoiceNumber || "Not detected"}</p><p><b>Total</b>{invoiceOcr.extracted.total ? money.format(invoiceOcr.extracted.total) : "Not detected"}</p><p><b>Invoice Date</b>{invoiceOcr.extracted.invoiceDate || "Not detected"}</p><p><b>Due Date</b>{invoiceOcr.extracted.dueDate || "Not detected"}</p><p><b>PO Reference</b>{invoiceOcr.extracted.poReference || "Not detected"}</p></div><label><input type="checkbox" checked={invoiceOcr.confirmed} onChange={(event) => setInvoiceOcr((current) => ({ ...current, confirmed: event.target.checked }))} /><span>I checked the suggested vendor, invoice number, dates, total, description, and PO reference against the original invoice. My edited fields above are the reviewed values.</span></label></> : null}</section> : null}
            <section className="allocation-editor">
              <div><div><h3>Split Across Projects And Cost Codes</h3></div><button className="secondary-action" onClick={() => setInvoiceDraft((current) => ({ ...current, allocations: [...current.allocations, newAllocation()] }))}>＋ Add Allocation</button></div>
              {invoiceDraft.allocations.map((line, index) => {
                const matches = matchingCommitments(line);
                return <article key={line.id}>
                  <span className="allocation-number">{index + 1}</span>
                  <label className="field-label">Project Or Overhead<select value={line.destination} onChange={(event) => void selectAllocationDestination(line.id, event.target.value)}><option value="">Select Destination</option><option>Company Overhead</option>{projects.map((project) => <option value={project.number} key={project.number}>{project.number} · {project.name}</option>)}</select>{loadingProjectCommitments.includes(line.destination) ? <small>Finding Existing Commitments...</small> : null}</label>
                  <label className="field-label">Cost Code Or GL Account<select value={line.destination === "Company Overhead" ? currentAccountNumber(line.code) : line.code} onChange={(event) => void selectAllocationCode(line.id, event.target.value)} disabled={!line.destination}><option value="">Select Code</option>{codeOptions(line.destination).map((code) => "accountNumber" in code ? <option value={code.accountNumber} key={code.accountNumber}>{code.accountNumber} · {code.legacyName}</option> : <option value={code.code} key={code.code}>{code.code} · {code.description}</option>)}</select></label>
                  {matches.length ? <label className="field-label smart-commitment-field">Matched Commitment<select value={line.commitmentReference} onChange={(event) => { const commitment = matches.find((item) => item.id === event.target.value); if (commitment) applyCommitment(line.id, commitment); }}><option value="">Select Matching Commitment</option>{matches.map((commitment) => <option key={commitment.id} value={commitment.id}>{commitment.id} · {commitment.vendor} · {commitment.type}</option>)}</select><small>{line.suggestedVendor ? `✓ Vendor Filled From ${line.commitmentReference}` : `${matches.length} Match${matches.length === 1 ? "" : "es"} Found`}</small></label> : <label className="field-label">Commitment Type<select value={line.commitmentType} onChange={(event) => updateAllocation(line.id, "commitmentType", event.target.value)} disabled={line.destination === "Company Overhead"}>{["Subcontract", "Purchase Order", "Approved Change Order", "Direct Expense", "Overhead Expense"].map((type) => <option key={type}>{type}</option>)}</select></label>}
                  <label className="field-label">Reference<input value={line.commitmentReference} onChange={(event) => updateAllocation(line.id, "commitmentReference", event.target.value)} placeholder="Auto-Filled Or Enter Direct Expense Reference" readOnly={Boolean(line.suggestedVendor)} /></label>
                  <label className="field-label">Line Description<input value={line.description} onChange={(event) => updateAllocation(line.id, "description", event.target.value)} placeholder="Allocation Description" /></label>
                  <label className="field-label">Amount<CurrencyInput min="0" value={line.amount} onValueChange={(value) => updateAllocation(line.id, "amount", value)} placeholder="0.00" /></label>
                  {invoiceDraft.allocations.length > 1 ? <button className="allocation-remove" aria-label={`Remove Allocation ${index + 1}`} onClick={() => setInvoiceDraft((current) => ({ ...current, allocations: current.allocations.filter((item) => item.id !== line.id) }))}>Remove</button> : null}
                </article>;
              })}
              <div className={`allocation-reconciliation ${Math.abs(allocationDifference) < 0.005 && numeric(invoiceDraft.total) > 0 ? "balanced" : ""}`}><span>Invoice Total <b>{money.format(numeric(invoiceDraft.total))}</b></span><span>Allocated <b>{money.format(allocatedTotal)}</b></span><span>Remaining <b>{money.format(allocationDifference)}</b></span></div>
            </section>
            <div className="modal-actions"><button className="secondary-action" onClick={() => setInvoiceOpen(false)}>Cancel</button><button className="secondary-action" disabled={saving} onClick={() => void storeInvoice(false)}>Save Draft</button><button className="primary-action large" disabled={saving} onClick={() => void storeInvoice(true)}>{saving ? "Saving Invoice..." : "Save And Submit For Review"}</button></div>
          </section>
        </div>
      ) : null}

      {paymentOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPaymentOpen(false)}>
          <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="payment-preparation-title">
            <div className="modal-heading"><div><h2 id="payment-preparation-title">Choose Payment Method</h2></div><button aria-label="Close Payment Preparation" onClick={() => setPaymentOpen(false)}>×</button></div>
            <label className="field-label">Approved Unpaid Invoice<select value={paymentDraft.invoiceId} onChange={(event) => { const invoice = approvedUnpaid.find((record) => record.id === event.target.value); if (invoice) openPaymentPreparation(invoice); }}>{approvedUnpaid.map((record) => <option value={record.id} key={record.id}>{record.title} · {money.format(numeric(recordData(record).total))}</option>)}</select></label>
            <label className="field-label">Payment Method<select value={paymentDraft.paymentMethod} onChange={(event) => setPaymentDraft((current) => ({ ...current, paymentMethod: event.target.value as PaymentMethod }))}>{["Printed Check", "Bank Bill Pay", "Credit Card", "Scheduled Wire"].map((method) => <option key={method}>{method}</option>)}</select></label>
            {paymentDraft.paymentMethod === "Credit Card" ? <div className="credit-card-fields"><label className="field-label">Card Provider<select value={paymentDraft.cardProvider} onChange={(event) => setPaymentDraft((current) => ({ ...current, cardProvider: event.target.value as "Ramp" | "Chase" }))}><option>Ramp</option><option>Chase</option></select></label><label className="field-label">Actual Cardholder<input value={paymentDraft.cardholder} onChange={(event) => setPaymentDraft((current) => ({ ...current, cardholder: event.target.value }))} placeholder="Employee Name" /></label><label className="field-label">Card Last Four<input inputMode="numeric" maxLength={4} value={paymentDraft.cardLastFour} onChange={(event) => setPaymentDraft((current) => ({ ...current, cardLastFour: event.target.value.replace(/\D/g, "") }))} placeholder="0000" /></label></div> : null}
            {paymentDraft.paymentMethod === "Scheduled Wire" ? <div className="permission-note"><strong>Wire Request Follows</strong><span>Save, then create the wire request.</span></div> : null}

            <div className="modal-actions"><button className="secondary-action" onClick={() => setPaymentOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={() => void savePaymentPreparation()}>{saving ? "Saving Preparation..." : "Save Payment Preparation"}</button></div>
          </section>
        </div>
      ) : null}

      {recurringOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRecurringOpen(false)}>
          <section className="record-modal recurring-modal" role="dialog" aria-modal="true" aria-labelledby="recurring-title">
            <div className="modal-heading"><div><h2 id="recurring-title">New Monthly Schedule</h2></div><button aria-label="Close Recurring Payment" onClick={() => setRecurringOpen(false)}>×</button></div>
            <div className="field-grid three-column"><label className="field-label">Vendor<input value={recurringDraft.vendor} onChange={(event) => setRecurringDraft((current) => ({ ...current, vendor: event.target.value }))} /></label><label className="field-label">Monthly Amount<CurrencyInput min="0" value={recurringDraft.amount} onValueChange={(value) => setRecurringDraft((current) => ({ ...current, amount: value }))} /></label><label className="field-label">Amount Type<select value={recurringDraft.amountType} onChange={(event) => setRecurringDraft((current) => ({ ...current, amountType: event.target.value as "Fixed" | "Estimated" }))}><option>Fixed</option><option>Estimated</option></select></label></div>
            <label className="field-label">Description<input value={recurringDraft.description} onChange={(event) => setRecurringDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Rent Utilities Subscription Loan Or Other Commitment" /></label>
            <div className="field-grid three-column"><label className="field-label">Monthly Due Day<input type="number" min="1" max="28" value={recurringDraft.dueDay} onChange={(event) => setRecurringDraft((current) => ({ ...current, dueDay: event.target.value }))} /></label><label className="field-label">Start Date<input type="date" value={recurringDraft.startDate} onChange={(event) => setRecurringDraft((current) => ({ ...current, startDate: event.target.value }))} /></label><label className="field-label">Check Run Lead Days<input type="number" min="0" max="31" value={recurringDraft.leadDays} onChange={(event) => setRecurringDraft((current) => ({ ...current, leadDays: event.target.value }))} /></label></div>
            <div className="recurring-end-row"><label><input type="checkbox" checked={recurringDraft.noEndDate} onChange={(event) => setRecurringDraft((current) => ({ ...current, noEndDate: event.target.checked }))} /> No End Date</label>{!recurringDraft.noEndDate ? <label className="field-label">End Date<input type="date" value={recurringDraft.endDate} onChange={(event) => setRecurringDraft((current) => ({ ...current, endDate: event.target.value }))} /></label> : null}</div>
            <div className="field-grid"><label className="field-label">Project Or Overhead<select value={recurringDraft.destination} onChange={(event) => setRecurringDraft((current) => ({ ...current, destination: event.target.value, code: "" }))}><option>Company Overhead</option>{projects.map((project) => <option value={project.number} key={project.number}>{project.number} · {project.name}</option>)}</select></label><label className="field-label">Cost Code Or GL Account<select value={recurringDraft.destination === "Company Overhead" ? currentAccountNumber(recurringDraft.code) : recurringDraft.code} onChange={(event) => setRecurringDraft((current) => ({ ...current, code: event.target.value }))}><option value="">Select Code</option>{codeOptions(recurringDraft.destination).map((code) => "accountNumber" in code ? <option value={code.accountNumber} key={code.accountNumber}>{code.accountNumber} · {code.legacyName}</option> : <option value={code.code} key={code.code}>{code.code} · {code.description}</option>)}</select></label></div>
            <div className="field-grid"><label className="field-label">Preferred Payment Method<select value={recurringDraft.paymentMethod} onChange={(event) => setRecurringDraft((current) => ({ ...current, paymentMethod: event.target.value as PaymentMethod }))}>{["Printed Check", "Bank Bill Pay", "Credit Card", "Scheduled Wire"].map((method) => <option key={method}>{method}</option>)}</select><small>This Is Suggested Later After The Monthly Invoice Is Approved Unpaid.</small></label><label className="field-label">Responsible Person<input value={recurringDraft.responsiblePerson} onChange={(event) => setRecurringDraft((current) => ({ ...current, responsiblePerson: event.target.value }))} /></label></div>
            {recurringDraft.paymentMethod === "Credit Card" ? <div className="credit-card-fields"><label className="field-label">Card Provider<select value={recurringDraft.cardProvider} onChange={(event) => setRecurringDraft((current) => ({ ...current, cardProvider: event.target.value as "Ramp" | "Chase" }))}><option>Ramp</option><option>Chase</option></select></label><label className="field-label">Cardholder<input value={recurringDraft.cardholder} onChange={(event) => setRecurringDraft((current) => ({ ...current, cardholder: event.target.value }))} /></label><label className="field-label">Last Four Digits<input maxLength={4} inputMode="numeric" value={recurringDraft.cardLastFour} onChange={(event) => setRecurringDraft((current) => ({ ...current, cardLastFour: event.target.value.replace(/\D/g, "") }))} /></label></div> : null}

            <div className="modal-actions"><button className="secondary-action" onClick={() => setRecurringOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={() => void storeRecurring()}>{saving ? "Saving Schedule..." : "Save Recurring Schedule"}</button></div>
          </section>
        </div>
      ) : null}

      {wireOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setWireOpen(false)}>
          <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="wire-title">
            <div className="modal-heading"><div><h2 id="wire-title">Prepare Wire Request</h2></div><button aria-label="Close Wire Request" onClick={() => setWireOpen(false)}>×</button></div>
            <label className="field-label">Approved Invoice<select value={wireDraft.invoiceId} onChange={(event) => setWireDraft((current) => ({ ...current, invoiceId: event.target.value }))}>{approvedUnpaid.filter((record) => recordData(record).paymentMethod === "Scheduled Wire").map((record) => <option value={record.id} key={record.id}>{record.title} · {money.format(numeric(recordData(record).total))}</option>)}</select></label>
            <div className="field-grid"><label className="field-label">Funding Account<input value={wireDraft.fundingAccount} onChange={(event) => setWireDraft((current) => ({ ...current, fundingAccount: event.target.value }))} placeholder="Bank Account Name · Last Four Only" /></label><label className="field-label">Requested Date<input type="date" value={wireDraft.requestedDate} onChange={(event) => setWireDraft((current) => ({ ...current, requestedDate: event.target.value }))} /></label></div>
            <label className="field-label">Notes<textarea value={wireDraft.notes} onChange={(event) => setWireDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Bank Instructions Or Internal Notes Without Sensitive Account Details" /></label>
            <div className="permission-note"><strong>External Bank Execution</strong><span>Execute the wire through your bank.</span></div>
            <div className="modal-actions"><button className="secondary-action" onClick={() => setWireOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={() => void storeWire()}>{saving ? "Saving Wire Request..." : "Save Wire Request"}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function apRecordSummaryRow(record: StoredRecord, select: (id: string) => void, openRegister: () => void) {
  const data = recordData(record);
  return { id: record.id, title: String(data.vendor || record.title), subtitle: `${String(data.invoiceNumber || record.id)} · Due ${formatDate(record.due)}`, status: record.status, value: money.format(numeric(data.total)), meta: String(data.description || ""), onOpen: () => { select(record.id); openRegister(); }, openLabel: "Open Invoice →" };
}
