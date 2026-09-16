"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { extractBusinessCardFields } from "../lib/business-card-ocr";
import { findCompanyMatches } from "../lib/company-matching";
type SalesTeamPerson = { name: string; email: string };
import { CurrencyInput } from "./currency-input";
import { EstimateProjectWorkspace } from "./estimate-project-workspace";
import { FormModalLayer } from "./form-modal-layer";
import { parseSpreadsheetFile } from "./secure-spreadsheet-client";
import { isPhotoUpload } from "../lib/photo-uploads";
import { summaryDrilldownProps } from "./summary-drilldown";
import { missingSalesOpportunityHandoffFields, salesOpportunityQualification } from "../lib/sales-opportunity.js";
import { roundMoney } from "../lib/money";
import { normalizeSalesFunnelStage, salesOpportunityValue } from "../lib/sales-opportunity-value";
import { opportunityContract, signedSalesRecords, withSalesContract, type SalesContract } from "../lib/sales-contract";
import { readWorkspaceJson, WorkspaceRequestError } from "../lib/workspace-request";
import { OWNER_CONTRACT_TYPES, contractTemplate, normalizeOwnerContractType, type OwnerContractType } from "../lib/owner-contracts";
import {
  calculateEstimateEntry,
  calculateEstimateSummary,
  estimateEntryTotal,
  normalizeEstimateData,
} from "./estimate-template";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const CONTACT_RECORD_TYPE = "Sales Contacts";
const OPPORTUNITY_RECORD_TYPE = "Sales Opportunities";
const SALES_GOAL_RECORD_TYPE = "Sales Goals";
const SALES_QUARTER_WEIGHTS = [0.1, 0.35, 0.4, 0.15] as const;

const funnelStages = [
  "New Lead",
  "Qualified Opportunity",
  "Estimating",
  "Proposal Submitted",
  "Negotiation",
] as const;

const outcomeStages = ["On Hold", "Awarded", "Lost"] as const;
const stageProbabilities: Record<string, number> = {
  "New Lead": 10,
  "Qualified Opportunity": 25,
  Estimating: 55,
  "Proposal Submitted": 70,
  Negotiation: 85,
  Awarded: 100,
  Lost: 0,
};
const lostReasons = [
  "Price",
  "Budget",
  "Schedule",
  "Competition",
  "No Response",
  "Project Cancelled",
  "Other",
];
const companyTypes = [
  "Owner / Developer",
  "Architect / Designer",
  "Property Manager",
  "Broker / Realtor",
  "Public Agency",
  "Subcontractor / Vendor",
  "Other",
];
const projectTypes = [
  "Commercial",
  "Industrial",
  "Institutional",
  "Healthcare",
  "Hospitality",
  "Multifamily",
  "Renovation",
  "Site Development",
  "Other",
];
const deliveryMethods = [
  "Negotiated",
  "Hard Bid",
  "Design-Build",
  "Design-Build GMP",
  "Design-Build Lump Sum",
  "Construction Management",
  "Unknown",
];
const leadSources = [
  "Repeat Client",
  "Referral",
  "Architect",
  "Website",
  "Public Bid",
  "Owner Invitation",
  "Sales Outreach",
  "Other",
];
const estimateStatuses = [
  "Not Started",
  "In Progress",
  "Ready For Review",
  "Proposal Submitted",
  "Approved",
  "Awarded",
];

type SalesMode = "dashboard" | "contacts" | "funnel" | "estimating" | "goals";

type SessionActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type SalesRecord = {
  id: string;
  type?: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  recordTime?: string;
  data?: Record<string, unknown>;
};

type ContactDraft = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  companyType: string;
  jobTitle: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  website: string;
  source: string;
  assignedRep: string;
  relationshipStatus: string;
  lastContactDate: string;
  nextFollowUpDate: string;
  notes: string;
};

type BusinessCardFields = ReturnType<typeof extractBusinessCardFields>;
type BusinessCardOcrState = {
  status: "idle" | "scanning" | "ready" | "error";
  percent: number;
  label: string;
  extracted: BusinessCardFields;
  completedAt: string;
  confirmed: boolean;
};

type CompanyResolution = {
  input: string;
  canonical: string;
  decision: "Reuse Existing" | "Confirmed Separate";
  score: number;
  reason: string;
};

const emptyBusinessCardFields = (): BusinessCardFields => ({ firstName: "", lastName: "", company: "", jobTitle: "", email: "", phone: "", address: "", city: "", state: "", postalCode: "", website: "", confidence: "", characterCount: 0 });
const blankBusinessCardOcr = (): BusinessCardOcrState => ({ status: "idle", percent: 0, label: "", extracted: emptyBusinessCardFields(), completedAt: "", confirmed: false });

type OpportunityDraft = {
  id: string;
  projectName: string;
  contactId: string;
  contactName: string;
  company: string;
  projectLocation: string;
  projectType: string;
  deliveryMethod: string;
  ownerContractType: OwnerContractType;
  leadSource: string;
  estimatedValue: string;
  probability: string;
  stage: string;
  assignedRep: string;
  nextFollowUpDate: string;
  lastContactDate: string;
  expectedAwardDate: string;
  bidDueDate: string;
  notes: string;
  estimatingRequestedAt: string;
  estimatingLockedAt: string;
  estimatingLockedBy: string;
  estimateStatus: string;
  assignedEstimator: string;
  lostReason: string;
  qualificationStatus?: "Incomplete" | "Ready For Estimating";
  qualificationMissingFields?: string[];
};

type SalesGoalData = {
  year: number;
  companyGoal: number;
  quarterWeights: number[];
  salespersonGoals: Array<{ name: string; email: string; goal: number }>;
  savedAt?: string;
  savedBy?: string;
};

type AwardedSale = {
  id: string;
  title: string;
  awardDate: string;
  company: string;
  salesperson: string;
  contractValue: number;
  managementHours: number;
  managementRevenue: number;
  insuranceRevenue: number;
  technologyFee: number;
  grossProfit: number;
  grossMargin: number;
};

function todayInput() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function displayDate(value: string) {
  if (!value) return "Not Set";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatCompactCurrency(value: number) {
  return formatCurrency(value);
}

function daysBetween(start: string, end: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  return Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime
    ? Math.max(0, Math.round((endTime - startTime) / 86_400_000))
    : null;
}

function currentEasternYear() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
    }).format(new Date()),
  );
}

function defaultSalesGoal(year: number): SalesGoalData | null {
  void year;
  return null;
}

function goalRecordData(record: SalesRecord | undefined): SalesGoalData | null {
  if (!record) return null;
  const data = record.data ?? {};
  const year = Number(data.year || record.id.replace("SALES-GOALS-", ""));
  if (!Number.isFinite(year)) return null;
  const rawPeople = Array.isArray(data.salespersonGoals) ? data.salespersonGoals : [];
  return {
    year,
    companyGoal: Number(data.companyGoal || 0),
    quarterWeights: Array.isArray(data.quarterWeights)
      ? data.quarterWeights.map((value) => Number(value || 0))
      : [...SALES_QUARTER_WEIGHTS],
    salespersonGoals: rawPeople.flatMap((person) => {
      if (!person || typeof person !== "object") return [];
      const value = person as Record<string, unknown>;
      return [{
        name: String(value.name || ""),
        email: String(value.email || ""),
        goal: Number(value.goal || 0),
      }];
    }),
    savedAt: String(data.savedAt || ""),
    savedBy: String(data.savedBy || record.owner || ""),
  };
}

function awardedSale(record: SalesRecord): AwardedSale | null {
  const data = record.data ?? {};
  const contract = opportunityContract(data);
  if (!contract?.signed) return null;
  const estimate = normalizeEstimateData(data.estimate);
  const stored = data.salesMetrics && typeof data.salesMetrics === "object"
    ? data.salesMetrics as Record<string, unknown>
    : null;
  const summary = calculateEstimateSummary(estimate);
  const managementEntries = [
    calculateEstimateEntry(estimate, "0131.00", "100", { quantity: 0, unit: "HR" }).entry,
    calculateEstimateEntry(estimate, "0131.00", "200", { quantity: 0, unit: "HR" }).entry,
  ];
  const contractValue = contract.recognizedValue;
  const originalCost = Number(stored?.contractValue ?? summary.contractValue)
    - Number(stored?.grossProfit ?? summary.grossProfit);
  const grossProfit = roundMoney(contractValue - originalCost);
  return {
    id: record.id,
    title: record.title,
    awardDate: contract.signedDate,
    company: String(data.company || "Company Not Entered"),
    salesperson: String(data.salesperson || data.assignedRep || record.owner || "Unassigned"),
    contractValue,
    managementHours: Number(
      stored?.managementHours ??
      managementEntries.reduce((total, entry) => total + entry.quantity, 0),
    ),
    managementRevenue: Number(
      stored?.managementRevenue ??
      managementEntries.reduce((total, entry) => total + estimateEntryTotal(entry), 0),
    ),
    insuranceRevenue: Number(
      stored?.insuranceRevenue ??
      summary.budgetRollups.find((rollup) => rollup.code === "0142.00")?.amount ?? 0,
    ),
    technologyFee: Number(stored?.technologyFee ?? summary.technologyFee),
    grossProfit,
    grossMargin: contractValue ? grossProfit / contractValue : 0,
  };
}

function contactData(record: SalesRecord) {
  const data = record.data ?? {};
  return {
    firstName: String(data.firstName ?? ""),
    lastName: String(data.lastName ?? ""),
    company: String(data.company ?? ""),
    companyType: String(data.companyType ?? "Owner / Developer"),
    jobTitle: String(data.jobTitle ?? ""),
    email: String(data.email ?? ""),
    phone: String(data.phone ?? ""),
    address: String(data.address ?? ""),
    city: String(data.city ?? ""),
    state: String(data.state ?? "KY"),
    postalCode: String(data.postalCode ?? ""),
    website: String(data.website ?? ""),
    source: String(data.source ?? "Referral"),
    assignedRep: String(data.assignedRep ?? record.owner),
    relationshipStatus: String(data.relationshipStatus ?? "Active"),
    lastContactDate: String(data.lastContactDate ?? ""),
    nextFollowUpDate: String(data.nextFollowUpDate ?? ""),
    notes: String(data.notes ?? ""),
  };
}

function opportunityData(record: SalesRecord) {
  const data = record.data ?? {};
  const proposalHandoff = data.proposalHandoff && typeof data.proposalHandoff === "object" && !Array.isArray(data.proposalHandoff)
    ? data.proposalHandoff as Record<string, unknown>
    : {};
  const stage = normalizeSalesFunnelStage(data.stage ?? record.status);
  return {
    projectName: String(data.projectName ?? record.title),
    contactId: String(data.contactId ?? ""),
    contactName: String(data.contactName ?? ""),
    company: String(data.company ?? ""),
    projectLocation: String(data.projectLocation ?? ""),
    projectType: String(data.projectType ?? "Commercial"),
    deliveryMethod: String(data.deliveryMethod ?? "Unknown"),
    ownerContractType: normalizeOwnerContractType(data.ownerContractType)
      || normalizeOwnerContractType(data.deliveryMethod)
      || normalizeOwnerContractType(proposalHandoff.ownerContractType)
      || "Plan & Spec Lump Sum",
    leadSource: String(data.leadSource ?? "Referral"),
    estimatedValue: String(data.estimatedValue ?? ""),
    probability: String(data.probability ?? stageProbabilities[stage] ?? "10"),
    stage,
    assignedRep: String(data.assignedRep ?? record.owner),
    nextFollowUpDate: String(data.nextFollowUpDate ?? ""),
    lastContactDate: String(data.lastContactDate ?? ""),
    expectedAwardDate: String(data.expectedAwardDate ?? ""),
    bidDueDate: String(data.bidDueDate ?? ""),
    notes: String(data.notes ?? ""),
    estimatingRequestedAt: String(data.estimatingRequestedAt ?? ""),
    estimatingLockedAt: String(data.estimatingLockedAt ?? ""),
    estimatingLockedBy: String(data.estimatingLockedBy ?? ""),
    estimateStatus: String(data.estimateStatus ?? "Not Started"),
    assignedEstimator: String(data.assignedEstimator ?? ""),
    lostReason: String(data.lostReason ?? ""),
    awardedProjectNumber: String(data.awardedProjectNumber ?? ""),
  };
}

function emptyContact(actor: SessionActor, availableSalespeople: SalesTeamPerson[] = []): ContactDraft {
  const defaultSalesperson = availableSalespeople.some((person) => person.name === actor.name)
    ? actor.name
    : availableSalespeople[0]?.name || "";
  return {
    id: "",
    firstName: "",
    lastName: "",
    company: "",
    companyType: "Owner / Developer",
    jobTitle: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "KY",
    postalCode: "",
    website: "",
    source: "Referral",
    assignedRep: defaultSalesperson,
    relationshipStatus: "Active",
    lastContactDate: todayInput(),
    nextFollowUpDate: todayInput(),
    notes: "",
  };
}

function emptyOpportunity(actor: SessionActor, availableSalespeople: SalesTeamPerson[] = []): OpportunityDraft {
  const defaultSalesperson = availableSalespeople.some((person) => person.name === actor.name)
    ? actor.name
    : availableSalespeople[0]?.name || "";
  return {
    id: "",
    projectName: "",
    contactId: "",
    contactName: "",
    company: "",
    projectLocation: "",
    projectType: "Commercial",
    deliveryMethod: "Unknown",
    ownerContractType: "Plan & Spec Lump Sum",
    leadSource: "Referral",
    estimatedValue: "",
    probability: "10",
    stage: "New Lead",
    assignedRep: defaultSalesperson,
    nextFollowUpDate: todayInput(),
    lastContactDate: todayInput(),
    expectedAwardDate: todayInput(),
    bidDueDate: todayInput(),
    notes: "",
    estimatingRequestedAt: "",
    estimatingLockedAt: "",
    estimatingLockedBy: "",
    estimateStatus: "Not Started",
    assignedEstimator: "",
    lostReason: "",
  };
}

function salesRecordId(prefix: "CNT" | "LEAD", records: SalesRecord[]) {
  const next =
    records.reduce((highest, record) => {
      if (!record.id.startsWith(`${prefix}-`)) return highest;
      return Math.max(highest, Number(record.id.slice(prefix.length + 1)) || 0);
    }, 0) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function spreadsheetText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function spreadsheetDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const text = spreadsheetText(value);
  if (!text) return todayInput();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : todayInput();
}

function normalizedSpreadsheetRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      value,
    ]),
  );
}

function contactMatchKey(data: ReturnType<typeof contactData> | ContactDraft) {
  const email = data.email.trim().toLowerCase();
  if (email) return `email:${email}`;
  return `name:${data.firstName.trim().toLowerCase()}|${data.lastName.trim().toLowerCase()}|${data.company.trim().toLowerCase()}`;
}

function companyContactKey(value: unknown) {
  const words = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const legalSuffixes = new Set(["co", "company", "corp", "corporation", "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited"]);
  while (words.length > 1 && legalSuffixes.has(words.at(-1) || "")) words.pop();
  return words.join(" ");
}

function contactsForCompany(contacts: SalesRecord[], company: unknown) {
  const key = companyContactKey(company);
  return key ? contacts.filter((record) => companyContactKey(contactData(record).company) === key) : [];
}

function contactLocation(record: SalesRecord | null | undefined) {
  if (!record) return "";
  const data = contactData(record);
  if (!data.address && !data.city) return "";
  return [data.address, data.city, data.state, data.postalCode].filter(Boolean).join(", ");
}

function resolvedCompanyMatches(input: string, canonicalCompanies: string[], records: SalesRecord[]) {
  const aliases = new Map<string, { alias: string; canonical: string }>();
  records.forEach((record) => {
    const canonical = contactData(record).company;
    if (!canonical) return;
    const data = record.data || {};
    const resolution = data.companyResolution && typeof data.companyResolution === "object" ? data.companyResolution as Record<string, unknown> : null;
    if (resolution?.decision === "Reuse Existing" && String(resolution.input || "").trim()) aliases.set(String(resolution.input).trim().toLowerCase(), { alias: String(resolution.input).trim(), canonical: String(resolution.canonical || canonical).trim() || canonical });
    if (Array.isArray(data.companyNameHistory)) data.companyNameHistory.map(String).filter(Boolean).forEach((alias) => aliases.set(alias.trim().toLowerCase(), { alias: alias.trim(), canonical }));
  });
  const raw = findCompanyMatches(input, [...canonicalCompanies, ...[...aliases.values()].map((item) => item.alias)], 8);
  const resolved = new Map<string, { company: string; score: number; reason: string }>();
  raw.forEach((match) => {
    const alias = aliases.get(match.company.toLowerCase());
    const company = alias?.canonical || match.company;
    const candidate = { company, score: match.score, reason: alias ? `Matches saved company alias “${alias.alias}”` : match.reason };
    const current = resolved.get(company.toLowerCase());
    if (!current || candidate.score > current.score) resolved.set(company.toLowerCase(), candidate);
  });
  return [...resolved.values()].filter((item) => item.company.trim().toLowerCase() !== input.trim().toLowerCase()).sort((left, right) => right.score - left.score || left.company.localeCompare(right.company)).slice(0, 3);
}

async function persistSalesRecord(recordType: string, record: SalesRecord) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: SALES_PROJECT_ID,
      recordType,
      record,
    }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "The Sales Record Could Not Be Saved.");
  }
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "sales-field sales-field-wide" : "sales-field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function SalesEstimatingWorkspace({
  mode,
  actor,
  onProjectCreated,
  onOpenContract,
  initialEstimateId = "",
  onInitialEstimateOpened,
}: {
  mode: SalesMode;
  actor: SessionActor;
  onProjectCreated?: (projectNumber: string) => void;
  onOpenContract?: (projectNumber: string) => void;
  initialEstimateId?: string;
  onInitialEstimateOpened?: () => void;
}) {
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [recordsRetry, setRecordsRetry] = useState(0);
  const [teamError, setTeamError] = useState("");
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [teamRetry, setTeamRetry] = useState(0);
  const [salespeople, setSalespeople] = useState<SalesTeamPerson[]>([]);
  const [estimators, setEstimators] = useState<SalesTeamPerson[]>([]);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [opportunityOpen, setOpportunityOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>(() =>
    emptyContact(actor, salespeople),
  );
  const [businessCardFile, setBusinessCardFile] = useState<File | null>(null);
  const [businessCardOcr, setBusinessCardOcr] = useState<BusinessCardOcrState>(() => blankBusinessCardOcr());
  const [companyResolution, setCompanyResolution] = useState<CompanyResolution | null>(null);
  const [opportunityDraft, setOpportunityDraft] = useState<OpportunityDraft>(
    () => emptyOpportunity(actor, salespeople),
  );
  const [saving, setSaving] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);
  const [directEstimateOpen, setDirectEstimateOpen] = useState(false);
  const [directEstimateDraft, setDirectEstimateDraft] = useState<OpportunityDraft>(() => ({
    ...emptyOpportunity(actor, salespeople),
    stage: "Estimating",
    estimatingRequestedAt: new Date().toISOString(),
    assignedEstimator: estimators[0]?.name || "",
  }));
  const [directCompanyResolution, setDirectCompanyResolution] = useState<CompanyResolution | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("All Outcomes");
  const [draggedOpportunityId, setDraggedOpportunityId] = useState("");
  const dragOpportunityRef = useRef("");
  const dragFrameRef = useRef(0);
  const suppressCardClickUntil = useRef(0);
  const pendingMoves = useRef(new Set<string>());
  const [movingOpportunityIds, setMovingOpportunityIds] = useState<string[]>([]);
  const [dropStage, setDropStage] = useState("");
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [estimateDeleteTarget, setEstimateDeleteTarget] = useState<SalesRecord | null>(null);
  const [estimateDeleteConfirmation, setEstimateDeleteConfirmation] = useState("");
  const [estimateDeleteError, setEstimateDeleteError] = useState("");
  const [estimateDeleteSaving, setEstimateDeleteSaving] = useState(false);
  const [estimateDeletePreview, setEstimateDeletePreview] = useState<{ records: number; files: number; linkedRows: number; linkedProjectNumber: string } | null>(null);
  const [selectedSalesYear, setSelectedSalesYear] = useState(currentEasternYear);
  const [goalYear, setGoalYear] = useState(currentEasternYear);
  const [goalCompanyAmount, setGoalCompanyAmount] = useState(() =>
    String(defaultSalesGoal(currentEasternYear())?.companyGoal || ""),
  );
  const [goalPeople, setGoalPeople] = useState<Record<string, string>>(() => {
    const goal = defaultSalesGoal(currentEasternYear());
    return Object.fromEntries(
      (goal?.salespersonGoals || []).map((person) => [person.email, String(person.goal || "")]),
    );
  });
  const [returnContactToOpportunity, setReturnContactToOpportunity] = useState(false);
  const [mergeCompanyOpen, setMergeCompanyOpen] = useState(false);
  const [mergeCompanyFrom, setMergeCompanyFrom] = useState("");
  const [mergeCompanyTo, setMergeCompanyTo] = useState("");
  const contactImportInput = useRef<HTMLInputElement>(null);

  const contacts = useMemo(
    () => records.filter((record) => record.type === CONTACT_RECORD_TYPE),
    [records],
  );
  const opportunities = useMemo(
    () => records.filter((record) => record.type === OPPORTUNITY_RECORD_TYPE),
    [records],
  );
  const goalRecords = useMemo(
    () => records.filter((record) => record.type === SALES_GOAL_RECORD_TYPE),
    [records],
  );
  const allAwardedSales = useMemo(
    () => signedSalesRecords(opportunities).flatMap((record) => {
      const sale = awardedSale(record);
      return sale ? [sale] : [];
    }),
    [opportunities],
  );

  const contractsToSign = contracts.filter(contract => contract.pendingSignature);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void readWorkspaceJson<{ records: SalesRecord[]; contracts?: SalesContract[] }>(
      `/api/records?projectId=${encodeURIComponent(SALES_PROJECT_ID)}`,
      "Sales and estimating records",
      (body) => Array.isArray(body.records),
      controller.signal,
    )
      .then(({ records: loaded, contracts: loadedContracts = [] }) => {
        if (!cancelled) {
          setRecords(loaded);
          setContracts(loadedContracts);
          setRecordsLoaded(true);
          setRecordsError("");
          const year = currentEasternYear();
          const stored = goalRecordData(
            loaded.find(
              (record) => record.type === SALES_GOAL_RECORD_TYPE && Number(record.data?.year) === year,
            ),
          );
          const goal = stored || defaultSalesGoal(year);
          setGoalCompanyAmount(goal?.companyGoal ? String(goal.companyGoal) : "");
          setGoalPeople(
            Object.fromEntries(
              (goal?.salespersonGoals || []).map((person) => [
                person.email,
                String(person.goal || ""),
              ]),
            ),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRecordsError(error instanceof Error ? error.message : "Sales records could not be loaded.");
          if (error instanceof WorkspaceRequestError && [401, 403].includes(error.status)) {
            setRecords([]);
            setContracts([]);
            setRecordsLoaded(false);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [recordsRetry]);

  useEffect(() => {
    if (!recordsLoaded || !["dashboard", "funnel", "goals"].includes(mode)) return;
    const controller = new AbortController();
    let refreshing = false;
    const refreshContracts = async () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const result = await readWorkspaceJson<{ contracts: SalesContract[] }>(
          `/api/records?projectId=${SALES_PROJECT_ID}&view=contract-sales`,
          "Contract sales", body => Array.isArray(body.contracts), controller.signal,
        );
        if (controller.signal.aborted) return;
        const contracts = new Map(result.contracts.map(contract => [contract.projectNumber, contract]));
        setContracts(result.contracts);
        setRecords(current => current.map(record => record.type === OPPORTUNITY_RECORD_TYPE
          ? { ...record, data: withSalesContract(record.data ?? {}, contracts) } : record));
        setRecordsError("");
      } catch (error) {
        if (!controller.signal.aborted) setRecordsError(error instanceof Error ? error.message : "Contract sales could not be refreshed.");
      } finally { refreshing = false; }
    };
    const timer = window.setInterval(() => void refreshContracts(), 15_000);
    window.addEventListener("focus", refreshContracts);
    document.addEventListener("visibilitychange", refreshContracts);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refreshContracts);
      document.removeEventListener("visibilitychange", refreshContracts);
    };
  }, [mode, recordsLoaded]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void readWorkspaceJson<{ salespeople: SalesTeamPerson[]; estimators: SalesTeamPerson[] }>(
      "/api/sales-team",
      "Sales and estimating team",
      (body) => Array.isArray(body.salespeople) && Array.isArray(body.estimators),
      controller.signal,
    ).then((team) => {
      if (cancelled) return;
      setSalespeople(team.salespeople);
      setEstimators(team.estimators);
      setTeamLoaded(true);
      setTeamError("");
    }).catch((error) => {
      if (cancelled) return;
      setTeamLoaded(false);
      setTeamError(error instanceof Error ? error.message : "The team list could not be loaded.");
      if (error instanceof WorkspaceRequestError && [401, 403].includes(error.status)) {
        setSalespeople([]);
        setEstimators([]);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [teamRetry]);

  useEffect(() => {
    if (mode !== "estimating" || loading || !initialEstimateId) return;
    const available = records.some((record) => record.id === initialEstimateId && record.type === OPPORTUNITY_RECORD_TYPE);
    if (!available) return;
    const timer = window.setTimeout(() => {
      setSelectedEstimateId(initialEstimateId);
      onInitialEstimateOpened?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialEstimateId, loading, mode, onInitialEstimateOpened, records]);

  useEffect(() => {
    const openContact = () => {
      setContactDraft(emptyContact(actor, salespeople));
      setBusinessCardFile(null);
      setBusinessCardOcr(blankBusinessCardOcr());
      setCompanyResolution(null);
      setReturnContactToOpportunity(false);
      setContactOpen(true);
    };
    const openOpportunity = () => {
      setOpportunityDraft(emptyOpportunity(actor, salespeople));
      setOpportunityOpen(true);
    };
    window.addEventListener("command:new-contact", openContact);
    window.addEventListener("command:new-opportunity", openOpportunity);
    return () => {
      window.removeEventListener("command:new-contact", openContact);
      window.removeEventListener("command:new-opportunity", openOpportunity);
    };
  }, [actor, salespeople]);

  const openContactEditor = (record?: SalesRecord, fromOpportunity = false) => {
    setBusinessCardFile(null);
    setBusinessCardOcr(blankBusinessCardOcr());
    setCompanyResolution(null);
    if (!record) {
      setContactDraft({
        ...emptyContact(actor, salespeople),
        company: fromOpportunity ? opportunityDraft.company : "",
      });
    } else {
      setContactDraft({ id: record.id, ...contactData(record) });
    }
    setReturnContactToOpportunity(fromOpportunity);
    setContactOpen(true);
  };

  const closeContactEditor = () => {
    setContactOpen(false);
    setReturnContactToOpportunity(false);
  };

  const openOpportunityEditor = (record?: SalesRecord) => {
    if (!record) {
      setOpportunityDraft(emptyOpportunity(actor, salespeople));
    } else {
      setOpportunityDraft({ id: record.id, ...opportunityData(record) });
    }
    setOpportunityOpen(true);
  };

  const openOpportunityFromContact = (contact: SalesRecord) => {
    const contactInfo = contactData(contact);
    const location = [contactInfo.address, contactInfo.city, contactInfo.state, contactInfo.postalCode]
      .filter(Boolean)
      .join(", ");
    setOpportunityDraft({
      ...emptyOpportunity(actor, salespeople),
      contactId: contact.id,
      contactName: contact.title,
      company: contactInfo.company,
      projectLocation: location,
      leadSource: contactInfo.source,
      assignedRep: contactInfo.assignedRep,
      lastContactDate: contactInfo.lastContactDate || todayInput(),
      nextFollowUpDate: contactInfo.nextFollowUpDate || todayInput(),
      notes: contactInfo.notes,
    });
    setContactOpen(false);
    setReturnContactToOpportunity(false);
    setOpportunityOpen(true);
  };

  function selectGoalYear(year: number) {
    const stored = goalRecordData(
      goalRecords.find((record) => Number(record.data?.year) === year),
    );
    const goal = stored || defaultSalesGoal(year);
    setGoalYear(year);
    setGoalCompanyAmount(goal?.companyGoal ? String(goal.companyGoal) : "");
    setGoalPeople(
      Object.fromEntries(
        salespeople.map((person) => [
          person.email,
          String(goal?.salespersonGoals.find((item) => item.email === person.email)?.goal || ""),
        ]),
      ),
    );
  }

  async function scanBusinessCard(file: File | null) {
    setBusinessCardFile(file);
    setBusinessCardOcr(blankBusinessCardOcr());
    setCompanyResolution(null);
    if (!file) return;
    if (!isPhotoUpload(file)) {
      setBusinessCardOcr({ ...blankBusinessCardOcr(), status: "error", label: "Use a clear photo or image of the business card. Manual contact entry is still available." });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setBusinessCardOcr({ ...blankBusinessCardOcr(), status: "error", label: "This photo is larger than 20 MB. Choose a smaller image or enter the contact manually." });
      return;
    }
    setBusinessCardOcr({ ...blankBusinessCardOcr(), status: "scanning", percent: 1, label: "Preparing business card OCR" });
    try {
      const { recognizeMobileDocument } = await import("../lib/mobile-ocr");
      const text = await recognizeMobileDocument(file, (progress) => setBusinessCardOcr((current) => ({ ...current, status: "scanning", percent: progress.percent, label: progress.label, confirmed: false })));
      const extracted = extractBusinessCardFields(text);
      setContactDraft((current) => {
        const untouchedLocation = !current.address && !current.city && !current.postalCode;
        return {
          ...current,
          firstName: current.firstName || extracted.firstName,
          lastName: current.lastName || extracted.lastName,
          company: current.company || extracted.company,
          jobTitle: current.jobTitle || extracted.jobTitle,
          email: current.email || extracted.email,
          phone: current.phone || extracted.phone,
          address: current.address || extracted.address,
          city: current.city || extracted.city,
          state: untouchedLocation ? extracted.state || current.state : current.state || extracted.state,
          postalCode: current.postalCode || extracted.postalCode,
          website: current.website || extracted.website,
        };
      });
      setBusinessCardOcr({ status: "ready", percent: 100, label: "Contact suggestions were filled below. Check them against the card before saving.", extracted, completedAt: new Date().toISOString(), confirmed: false });
    } catch (error) {
      setBusinessCardOcr({ ...blankBusinessCardOcr(), status: "error", label: error instanceof Error ? `The card could not be read automatically: ${error.message}` : "The card could not be read automatically. Enter the contact manually." });
    }
  }

  async function uploadBusinessCard(contactId: string, file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", SALES_PROJECT_ID);
    form.set("category", `Sales Contacts / ${contactId} / Business Card`);
    form.set("revision", `${contactId} · Original Business Card · OCR Source`);
    form.set("access", "Pre-Construction Sales Team");
    const response = await fetch("/api/files", { method: "POST", body: form });
    const result = await response.json() as { file?: { id: number; name: string; contentType?: string; sizeBytes?: number }; error?: string };
    if (!response.ok || !result.file) throw new Error(result.error || "The business card image could not be stored.");
    return result.file;
  }

  async function saveContact() {
    if (businessCardOcr.status === "scanning") {
      setNotice("Let The Business Card Finish Reading Before Saving The Contact.");
      return;
    }
    if (businessCardOcr.status === "ready" && !businessCardOcr.confirmed) {
      setNotice("Review The Business Card Suggestions Against The Photo Before Saving.");
      return;
    }
    const possibleCompanies = resolvedCompanyMatches(contactDraft.company, contactCompanies.filter((company) => company.trim().toLowerCase() !== contactDraft.company.trim().toLowerCase()), records);
    const resolutionCoversMatch = companyResolution?.decision === "Confirmed Separate" && companyResolution.input.trim().toLowerCase() === contactDraft.company.trim().toLowerCase() || companyResolution?.decision === "Reuse Existing" && companyResolution.canonical.trim().toLowerCase() === contactDraft.company.trim().toLowerCase();
    if (possibleCompanies.length && !resolutionCoversMatch) {
      setNotice(`Choose The Existing Company Match Or Confirm That ${contactDraft.company || "This Entry"} Is Truly A Separate Company.`);
      return;
    }
    if (
      !contactDraft.firstName.trim() ||
      !contactDraft.lastName.trim() ||
      !contactDraft.company.trim()
    ) {
      setNotice("Add The Contact First Name Last Name And Company Before Saving.");
      return;
    }
    const id = contactDraft.id || salesRecordId("CNT", records);
    const fullName = `${contactDraft.firstName.trim()} ${contactDraft.lastName.trim()}`;
    setSaving(true);
    try {
      const existing = contacts.find((item) => item.id === id);
      const existingData = existing?.data || {};
      let businessCard = existingData.businessCard && typeof existingData.businessCard === "object" ? existingData.businessCard as Record<string, unknown> : null;
      if (businessCardFile) {
        const stored = await uploadBusinessCard(id, businessCardFile);
        businessCard = {
          fileId: stored.id,
          fileName: stored.name,
          contentType: stored.contentType || businessCardFile.type,
          sizeBytes: stored.sizeBytes || businessCardFile.size,
          originalPreserved: true,
          capturedAt: businessCardOcr.completedAt || new Date().toISOString(),
          ocr: {
            status: businessCardOcr.status === "ready" ? "Human Reviewed" : "OCR Unavailable · Manual Entry",
            engine: "Tesseract OCR",
            confidence: businessCardOcr.extracted.confidence || "Not Rated",
            characterCount: businessCardOcr.extracted.characterCount,
            extracted: businessCardOcr.extracted,
            reviewed: { firstName: contactDraft.firstName, lastName: contactDraft.lastName, company: contactDraft.company, jobTitle: contactDraft.jobTitle, email: contactDraft.email, phone: contactDraft.phone, address: contactDraft.address, city: contactDraft.city, state: contactDraft.state, postalCode: contactDraft.postalCode, website: contactDraft.website },
            reviewedBy: actor.name,
            reviewedAt: new Date().toISOString(),
          },
        };
      }
      const record: SalesRecord = {
        id,
        title: fullName,
        owner: contactDraft.assignedRep || actor.name,
        due: displayDate(contactDraft.nextFollowUpDate),
        status: contactDraft.relationshipStatus,
        meta: `${contactDraft.company || "Independent Contact"} · ${contactDraft.email || contactDraft.phone || "Contact Details Pending"}`,
        recordDate: todayInput(),
        data: { ...existingData, ...contactDraft, id: undefined, companyResolution: companyResolution ? { ...companyResolution, decidedBy: actor.name, decidedAt: new Date().toISOString() } : undefined, ...(businessCard ? { businessCard } : {}) },
      };
      await persistSalesRecord(CONTACT_RECORD_TYPE, record);
      setRecords((current) => [
        { ...record, type: CONTACT_RECORD_TYPE },
        ...current.filter((item) => item.id !== id),
      ]);
      if (returnContactToOpportunity) {
        const contactLocation = [contactDraft.address, contactDraft.city, contactDraft.state, contactDraft.postalCode]
          .filter(Boolean)
          .join(", ");
        setOpportunityDraft((current) => ({
          ...current,
          company: contactDraft.company.trim(),
          contactId: id,
          contactName: fullName,
          projectLocation: current.projectLocation || contactLocation,
          leadSource: contactDraft.source || current.leadSource,
          assignedRep: contactDraft.assignedRep || current.assignedRep,
          lastContactDate: contactDraft.lastContactDate || current.lastContactDate,
          nextFollowUpDate: contactDraft.nextFollowUpDate || current.nextFollowUpDate,
        }));
      }
      closeContactEditor();
      setBusinessCardFile(null);
      setBusinessCardOcr(blankBusinessCardOcr());
      setCompanyResolution(null);
      setNotice(`${fullName} Saved To Sales Contacts!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Contact Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function importContacts(file: File) {
    setImportingContacts(true);
    try {
      const { rows } = await parseSpreadsheetFile(file, "contacts");
      const existingKeys = new Set(contacts.map((record) => contactMatchKey(contactData(record))));
      const importedRecords: SalesRecord[] = [];
      let skippedDuplicates = 0;
      let skippedIncomplete = 0;
      let skippedCompanyReview = 0;
      let canonicalCompanyReuses = 0;
      const knownCompanies = [...contactCompanies];
      let nextNumber = records.reduce((highest, record) => {
        if (!record.id.startsWith("CNT-")) return highest;
        return Math.max(highest, Number(record.id.slice(4)) || 0);
      }, 0) + 1;

      for (const originalRow of rows) {
        const row = normalizedSpreadsheetRow(originalRow);
        const firstName = spreadsheetText(row.firstname);
        const lastName = spreadsheetText(row.lastname);
        if (!firstName && !lastName && !spreadsheetText(row.company)) continue;
        if (!firstName || !lastName || !spreadsheetText(row.company)) {
          skippedIncomplete += 1;
          continue;
        }
        const companyTypeValue = spreadsheetText(row.companytype);
        const sourceValue = spreadsheetText(row.leadsource);
        const statusValue = spreadsheetText(row.relationshipstatus);
        const enteredCompany = spreadsheetText(row.company);
        const exactCompany = knownCompanies.find((company) => company.toLowerCase() === enteredCompany.toLowerCase());
        const companyMatches = exactCompany ? [] : resolvedCompanyMatches(enteredCompany, knownCompanies, records);
        const uniqueStrongMatch = companyMatches.length === 1 && companyMatches[0].score >= 86 ? companyMatches[0] : null;
        if (companyMatches.length && !uniqueStrongMatch) {
          skippedCompanyReview += 1;
          continue;
        }
        const resolvedCompany = exactCompany || uniqueStrongMatch?.company || enteredCompany;
        const importCompanyResolution = uniqueStrongMatch ? { input: enteredCompany, canonical: uniqueStrongMatch.company, decision: "Reuse Existing", score: uniqueStrongMatch.score, reason: uniqueStrongMatch.reason, decidedBy: actor.name, decidedAt: new Date().toISOString(), source: "Contacts Import" } : null;
        if (uniqueStrongMatch) canonicalCompanyReuses += 1;
        if (!exactCompany && !uniqueStrongMatch) knownCompanies.push(enteredCompany);
        const draft: ContactDraft = {
          id: "",
          firstName,
          lastName,
          company: resolvedCompany,
          companyType: companyTypes.includes(companyTypeValue) ? companyTypeValue : "Owner / Developer",
          jobTitle: spreadsheetText(row.titleposition),
          email: spreadsheetText(row.email),
          phone: spreadsheetText(row.phone),
          address: spreadsheetText(row.streetaddress),
          city: spreadsheetText(row.city),
          state: spreadsheetText(row.state) || "KY",
          postalCode: spreadsheetText(row.postalcode),
          website: spreadsheetText(row.website),
          source: leadSources.includes(sourceValue) ? sourceValue : "Referral",
          assignedRep: spreadsheetText(row.assignedsalesperson) || actor.name,
          relationshipStatus: ["Active", "Prospect", "Inactive"].includes(statusValue) ? statusValue : "Active",
          lastContactDate: spreadsheetDate(row.lastcontactdate),
          nextFollowUpDate: spreadsheetDate(row.nextfollowupdate),
          notes: spreadsheetText(row.notes),
        };
        const matchKey = contactMatchKey(draft);
        if (existingKeys.has(matchKey)) {
          skippedDuplicates += 1;
          continue;
        }
        existingKeys.add(matchKey);
        const id = `CNT-${String(nextNumber).padStart(4, "0")}`;
        nextNumber += 1;
        const fullName = `${draft.firstName} ${draft.lastName}`;
        importedRecords.push({
          id,
          title: fullName,
          owner: draft.assignedRep,
          due: displayDate(draft.nextFollowUpDate),
          status: draft.relationshipStatus,
          meta: `${draft.company || "Independent Contact"} · ${draft.email || draft.phone || "Contact Details Pending"}`,
          recordDate: todayInput(),
          data: { ...draft, id: undefined, ...(importCompanyResolution ? { companyResolution: importCompanyResolution } : {}) },
        });
      }

      if (!importedRecords.length) {
        setNotice(
          skippedDuplicates || skippedIncomplete || skippedCompanyReview
            ? `No Contacts Imported · ${skippedDuplicates} Duplicate${skippedDuplicates === 1 ? "" : "s"} · ${skippedIncomplete} Missing Required Name Or Company · ${skippedCompanyReview} Company Name${skippedCompanyReview === 1 ? "" : "s"} Need Review`
            : "No Completed Contact Rows Were Found In The Workbook.",
        );
        return;
      }
      const results = await Promise.allSettled(
        importedRecords.map((record) => persistSalesRecord(CONTACT_RECORD_TYPE, record)),
      );
      const savedRecords = importedRecords.filter((_, index) => results[index].status === "fulfilled");
      const failed = results.length - savedRecords.length;
      setRecords((current) => [
        ...savedRecords.map((record) => ({ ...record, type: CONTACT_RECORD_TYPE })),
        ...current,
      ]);
      setNotice(
        `${savedRecords.length} Contact${savedRecords.length === 1 ? "" : "s"} Imported! · ${canonicalCompanyReuses} Existing Compan${canonicalCompanyReuses === 1 ? "y" : "ies"} Reused · ${skippedDuplicates} Duplicate${skippedDuplicates === 1 ? "" : "s"} Skipped · ${skippedIncomplete} Incomplete Row${skippedIncomplete === 1 ? "" : "s"} Skipped · ${skippedCompanyReview} Ambiguous Company Name${skippedCompanyReview === 1 ? "" : "s"} Skipped${failed ? ` · ${failed} Could Not Be Saved` : ""}`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Contact Workbook Could Not Be Imported.");
    } finally {
      setImportingContacts(false);
      if (contactImportInput.current) contactImportInput.current.value = "";
    }
  }

  function openDirectEstimate() {
    const defaultEstimator = estimators[0]?.name || "";
    setDirectEstimateDraft({
      ...emptyOpportunity(actor, salespeople),
      stage: "Estimating",
      estimatingRequestedAt: new Date().toISOString(),
      estimateStatus: "Not Started",
      assignedEstimator: defaultEstimator,
    });
    setDirectCompanyResolution(null);
    setDirectEstimateOpen(true);
  }

  function setDirectEstimateCompany(company: string) {
    const matchingContacts = contactsForCompany(contacts, company);
    setDirectEstimateDraft((current) => {
      const currentContact = matchingContacts.find((contact) => contact.id === current.contactId);
      const selectedContact = currentContact || (matchingContacts.length === 1 ? matchingContacts[0] : null);
      return {
        ...current,
        company,
        contactId: selectedContact?.id || "",
        contactName: selectedContact?.title || "",
        projectLocation: current.projectLocation || contactLocation(selectedContact),
      };
    });
  }

  function setOpportunityCompany(company: string) {
    const matchingContacts = contactsForCompany(contacts, company);
    const selectedContact = matchingContacts.length === 1 ? matchingContacts[0] : null;
    setOpportunityDraft((current) => ({
      ...current,
      company,
      contactId: selectedContact?.id || "",
      contactName: selectedContact?.title || "",
      projectLocation: current.projectLocation || contactLocation(selectedContact),
    }));
  }

  async function saveDirectEstimate() {
    if (!directEstimateDraft.projectName.trim()) {
      setNotice("Add The Project Or Estimate Name Before Saving.");
      return;
    }
    if (!directEstimateDraft.assignedEstimator) {
      setNotice("Select The Assigned Estimator Before Creating The Estimate Workspace.");
      return;
    }
    const possibleCompanies = resolvedCompanyMatches(directEstimateDraft.company, contactCompanies.filter((company) => company.trim().toLowerCase() !== directEstimateDraft.company.trim().toLowerCase()), records);
    const resolutionCoversMatch = directCompanyResolution?.decision === "Confirmed Separate" && directCompanyResolution.input.trim().toLowerCase() === directEstimateDraft.company.trim().toLowerCase() || directCompanyResolution?.decision === "Reuse Existing" && directCompanyResolution.canonical.trim().toLowerCase() === directEstimateDraft.company.trim().toLowerCase();
    if (directEstimateDraft.company.trim() && possibleCompanies.length && !resolutionCoversMatch) {
      setNotice(`Choose The Existing Company Match Or Confirm That ${directEstimateDraft.company} Is Truly A Separate Company.`);
      return;
    }
    const matchingContacts = contactsForCompany(contacts, directEstimateDraft.company);
    const explicitlySelectedContact = matchingContacts.find((contact) => contact.id === directEstimateDraft.contactId);
    const selectedContact = explicitlySelectedContact || (matchingContacts.length === 1 ? matchingContacts[0] : null);
    const selectedContactData = selectedContact ? contactData(selectedContact) : null;
    const id = salesRecordId("LEAD", records);
    const nextDraft: OpportunityDraft = {
      ...directEstimateDraft,
      estimatedValue: directEstimateDraft.estimatedValue.trim() ? roundMoney(directEstimateDraft.estimatedValue).toFixed(2) : "",
      stage: "Estimating",
      probability: String(stageProbabilities.Estimating),
      assignedRep: directEstimateDraft.assignedEstimator || actor.name,
      company: selectedContactData?.company || directEstimateDraft.company,
      contactId: selectedContact?.id || "",
      contactName: selectedContact?.title || "",
      estimatingRequestedAt: directEstimateDraft.estimatingRequestedAt || new Date().toISOString(),
      estimateStatus: "Not Started",
    };
    const record: SalesRecord = {
      id,
      title: nextDraft.projectName.trim(),
      owner: nextDraft.assignedEstimator || actor.name,
      due: displayDate(nextDraft.bidDueDate),
      status: "Estimating",
      meta: `${nextDraft.company || "Direct Estimate"} · ${nextDraft.projectLocation || "Location Pending"} · ${formatCurrency(Number(nextDraft.estimatedValue || 0))}`,
      recordDate: todayInput(),
      data: { ...nextDraft, directEstimate: true, contactAutoLinked: Boolean(selectedContact && !explicitlySelectedContact), companyResolution: directCompanyResolution ? { ...directCompanyResolution, decidedBy: actor.name, decidedAt: new Date().toISOString() } : undefined },
    };
    setSaving(true);
    try {
      await persistSalesRecord(OPPORTUNITY_RECORD_TYPE, record);
      setRecords((current) => [
        { ...record, type: OPPORTUNITY_RECORD_TYPE },
        ...current,
      ]);
      setDirectEstimateOpen(false);
      setDirectCompanyResolution(null);
      setSelectedEstimateId(id);
      setNotice(`${record.title} Estimate Workspace And Connected Sales Funnel Card Created${selectedContact ? ` With ${selectedContact.title} Linked` : ""}!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Estimate Workspace Could Not Be Created.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOpportunity(sendToEstimating = false) {
    if (!opportunityDraft.projectName.trim()) {
      setNotice("Add The Project Or Opportunity Name Before Saving The Sales Draft.");
      return;
    }
    if (opportunityDraft.stage === "Lost" && !opportunityDraft.lostReason) {
      setNotice("Select A Lost Opportunity Reason Before Saving.");
      return;
    }
    const existingOpportunity = opportunityDraft.id
      ? records.find((item) => item.id === opportunityDraft.id)
      : undefined;
    const directEstimateOpportunity = existingOpportunity?.data?.directEstimate === true;
    const matchingContacts = contactsForCompany(contacts, opportunityDraft.company);
    const explicitlySelectedContact = matchingContacts.find((contact) => contact.id === opportunityDraft.contactId);
    const selectedContact = explicitlySelectedContact || (matchingContacts.length === 1 ? matchingContacts[0] : null);
    const selectedContactData = selectedContact ? contactData(selectedContact) : null;
    const resolvedOpportunityDraft: OpportunityDraft = {
      ...opportunityDraft,
      contactId: selectedContact?.id || opportunityDraft.contactId,
      contactName: selectedContact?.title || opportunityDraft.contactName,
      company: selectedContactData?.company || opportunityDraft.company,
    };
    const handoffMissing = missingSalesOpportunityHandoffFields(resolvedOpportunityDraft);
    if (!directEstimateOpportunity && (sendToEstimating || opportunityDraft.stage === "Estimating") && handoffMissing.length) {
      setNotice(`Complete These Fields Before Estimating: ${handoffMissing.join(", ")}.`);
      return;
    }
    if (sendToEstimating && !window.confirm("Release This Project To Estimating?\n\nOnce released, it cannot move backward into Sales. It will remain a permanent estimating record until recorded as Won or Lost, and its estimate history and files will be retained for company reporting.")) return;
    const id = opportunityDraft.id || salesRecordId("LEAD", records);
    const nextStage = sendToEstimating ? "Estimating" : resolvedOpportunityDraft.stage;
    const savedOpportunity = records.find((item) => item.id === id);
    const existingData = savedOpportunity?.data ?? {};
    const estimatingRequestedAt =
      sendToEstimating
        ? resolvedOpportunityDraft.estimatingRequestedAt || new Date().toISOString()
        : String(existingData.estimatingRequestedAt || resolvedOpportunityDraft.estimatingRequestedAt || "");
    const nextDraftBase: OpportunityDraft = {
      ...resolvedOpportunityDraft,
      estimatedValue: resolvedOpportunityDraft.estimatedValue.trim() ? roundMoney(resolvedOpportunityDraft.estimatedValue).toFixed(2) : "",
      stage: nextStage,
      probability: String(Math.min(100, Math.max(0, Number(opportunityDraft.probability || stageProbabilities[nextStage] || 0)))),
      contactName:
        selectedContact?.title || opportunityDraft.contactName,
      company:
        selectedContactData?.company || opportunityDraft.company,
      estimatingRequestedAt,
      estimatingLockedAt: sendToEstimating ? resolvedOpportunityDraft.estimatingLockedAt || new Date().toISOString() : resolvedOpportunityDraft.estimatingLockedAt,
      estimatingLockedBy: sendToEstimating ? resolvedOpportunityDraft.estimatingLockedBy || actor.name : resolvedOpportunityDraft.estimatingLockedBy,
    };
    const qualification = salesOpportunityQualification(nextDraftBase);
    const nextDraft: OpportunityDraft = {
      ...nextDraftBase,
      qualificationStatus: qualification.status,
      qualificationMissingFields: qualification.missingFields,
    };
    const record: SalesRecord = {
      id,
      title: nextDraft.projectName.trim(),
      owner: nextDraft.assignedRep || actor.name,
      due: displayDate(nextDraft.nextFollowUpDate),
      status: nextStage,
      meta: `${nextDraft.company || "Client Pending"} · ${nextDraft.projectLocation || "Location Pending"} · ${formatCurrency(Number(nextDraft.estimatedValue || 0))}`,
      recordDate: todayInput(),
      data: {
        ...(records.find((item) => item.id === id)?.data ?? {}),
        ...nextDraft,
        id: undefined,
      },
    };
    setSaving(true);
    try {
      await persistSalesRecord(OPPORTUNITY_RECORD_TYPE, record);
      setRecords((current) => [
        { ...record, type: OPPORTUNITY_RECORD_TYPE },
        ...current.filter((item) => item.id !== id),
      ]);
      setOpportunityDraft(nextDraft);
      setOpportunityOpen(false);
      setNotice(
        sendToEstimating
          ? `${record.title} Sent To Estimating!`
          : qualification.missingFields.length
            ? `${record.title} Saved As A Sales Draft · Estimating Held Until ${qualification.missingFields.join(", ")}.`
            : `${record.title} Saved In The Sales Funnel!`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Opportunity Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function moveOpportunity(record: SalesRecord, nextStage: string) {
    if (pendingMoves.current.has(record.id)) return;
    const current = opportunityData(record);
    if (current.stage === nextStage) return;
    if (current.estimatingRequestedAt && !["Lost", "Awarded", "Proposal Submitted", "Negotiation", "Estimating"].includes(nextStage)) {
      setNotice("This Project Is Locked In Estimating Until It Is Recorded As Won Or Lost. Its History And Files Cannot Move Backward.");
      return;
    }
    if (nextStage === "Estimating" && !current.estimatingRequestedAt) {
      setOpportunityDraft({ ...current, id: record.id, stage: current.stage });
      setOpportunityOpen(true);
      setNotice("Select The Estimator And Use Send To Estimating. You Will Confirm The Permanent One-Way Handoff.");
      return;
    }
    if (nextStage === "Awarded") {
      setNotice("Awarded Is Controlled By The Approved Estimate And Project-Creation Workflow.");
      return;
    }
    if (nextStage === "Lost") {
      setOpportunityDraft({ ...current, id: record.id, stage: nextStage, probability: "0" });
      setOpportunityOpen(true);
      setNotice("Select The Lost Reason And Save To Complete This Move.");
      return;
    }
    const updatedData = {
      ...(record.data ?? {}),
      ...current,
      stage: nextStage,
      probability: String(stageProbabilities[nextStage] ?? Number(current.probability || 0)),
      estimatingRequestedAt: current.estimatingRequestedAt,
    };
    const updated: SalesRecord = {
      ...record,
      status: nextStage,
      data: updatedData,
    };
    pendingMoves.current.add(record.id);
    setMovingOpportunityIds([...pendingMoves.current]);
    setRecords((items) => items.map((item) => item.id === record.id ? { ...updated, type: OPPORTUNITY_RECORD_TYPE } : item));
    try {
      await persistSalesRecord(OPPORTUNITY_RECORD_TYPE, updated);
      setNotice(
        nextStage === "Estimating" && !updatedData.estimatingRequestedAt
          ? `${record.title} Moved To The Estimating Stage. Use Send To Estimating When The Handoff Is Ready.`
          : `${record.title} Moved To ${nextStage}!`,
      );
    } catch (error) {
      setRecords((items) => items.map((item) => item.id === record.id ? record : item));
      setNotice(error instanceof Error ? error.message : "The Funnel Move Could Not Be Saved.");
    } finally {
      pendingMoves.current.delete(record.id);
      setMovingOpportunityIds([...pendingMoves.current]);
    }
  }

  async function updateEstimate(record: SalesRecord, field: string, value: string) {
    const data = opportunityData(record);
    const updated: SalesRecord = {
      ...record,
      owner: field === "assignedEstimator" && value ? value : record.owner,
      data: { ...(record.data ?? {}), ...data, [field]: value },
    };
    setRecords((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    try {
      await persistSalesRecord(OPPORTUNITY_RECORD_TYPE, updated);
      setNotice(`${updated.title} Estimate Updated!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Estimate Could Not Be Updated.");
    }
  }

  async function openEstimateDeletion(record: SalesRecord) {
    setEstimateDeleteTarget(record);
    setEstimateDeleteConfirmation("");
    setEstimateDeleteError("");
    setEstimateDeletePreview(null);
    try {
      const response = await fetch(`/api/owner-delete?kind=estimate&targetId=${encodeURIComponent(record.id)}`, { cache: "no-store" });
      const result = (await response.json()) as { preview?: { records: number; files: number; linkedRows: number; linkedProjectNumber: string }; error?: string };
      if (!response.ok || !result.preview) throw new Error(result.error || "Deletion impact could not be loaded.");
      setEstimateDeletePreview(result.preview);
    } catch (error) {
      setEstimateDeleteError(error instanceof Error ? error.message : "Deletion impact could not be loaded.");
    }
  }

  async function deleteEstimatePermanently() {
    if (!estimateDeleteTarget || estimateDeleteConfirmation !== estimateDeleteTarget.title) return;
    setEstimateDeleteSaving(true);
    setEstimateDeleteError("");
    try {
      const response = await fetch("/api/owner-delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "estimate", targetId: estimateDeleteTarget.id, confirmation: estimateDeleteConfirmation }),
      });
      const result = (await response.json()) as { deleted?: boolean; quarantined?: boolean; error?: string };
      if (!response.ok || !result.deleted) throw new Error(result.error || "The estimate could not be moved to deletion quarantine.");
      const deletedTitle = estimateDeleteTarget.title;
      const deletedId = estimateDeleteTarget.id;
      setRecords((current) => current.filter((record) => record.id !== deletedId));
      if (selectedEstimateId === deletedId) setSelectedEstimateId("");
      setEstimateDeleteTarget(null);
      setEstimateDeleteConfirmation("");
      setEstimateDeletePreview(null);
      setNotice(`${deletedTitle} And Its Related Preconstruction Records Were Moved To 30-Day Owner Recovery Quarantine.`);
    } catch (error) {
      setEstimateDeleteError(error instanceof Error ? error.message : "The estimate could not be moved to deletion quarantine.");
    } finally {
      setEstimateDeleteSaving(false);
    }
  }

  async function saveSalesGoals() {
    if (!teamLoaded) {
      setNotice("Load the team list before saving sales goals.");
      return;
    }
    if (actor.accessLevel !== "Company Owner") {
      setNotice("Only A Company Owner Can Save Company And Salesperson Goals.");
      return;
    }
    const companyGoal = Math.max(0, roundMoney(goalCompanyAmount));
    if (!companyGoal) {
      setNotice("Enter A Positive Company Sales Goal Before Saving.");
      return;
    }
    const salespersonGoals = salespeople.map((person) => ({
      name: person.name,
      email: person.email,
      goal: Math.max(0, roundMoney(goalPeople[person.email] || 0)),
    }));
    const data: SalesGoalData = {
      year: goalYear,
      companyGoal,
      quarterWeights: [...SALES_QUARTER_WEIGHTS],
      salespersonGoals,
      savedAt: new Date().toISOString(),
      savedBy: actor.name,
    };
    const record: SalesRecord = {
      id: `SALES-GOALS-${goalYear}`,
      title: `${goalYear} Mefford Sales Goals`,
      owner: actor.name,
      due: `01/01/${goalYear}`,
      status: "Active",
      meta: `${formatCurrency(companyGoal)} Company Goal · Owner Controlled`,
      recordDate: `${goalYear}-01-01`,
      data: data as unknown as Record<string, unknown>,
    };
    setSaving(true);
    try {
      await persistSalesRecord(SALES_GOAL_RECORD_TYPE, record);
      setRecords((current) => [
        { ...record, type: SALES_GOAL_RECORD_TYPE },
        ...current.filter((item) => item.id !== record.id),
      ]);
      setSelectedSalesYear(goalYear);
      setNotice(`${goalYear} Company And Salesperson Goals Saved!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Sales Goals Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function mergeCompanyNames() {
    if (!["Company Owner", "Administrator"].includes(actor.accessLevel)) {
      setNotice("Only A Company Owner Or Administrator Can Merge Company Names.");
      return;
    }
    if (!mergeCompanyFrom || !mergeCompanyTo || mergeCompanyFrom === mergeCompanyTo) {
      setNotice("Select Two Different Company Names Before Merging.");
      return;
    }
    const affected = records.filter((record) => {
      if (record.type === CONTACT_RECORD_TYPE) return contactData(record).company === mergeCompanyFrom;
      if (record.type === OPPORTUNITY_RECORD_TYPE) return opportunityData(record).company === mergeCompanyFrom;
      return false;
    });
    const updatedRecords = affected.map((record) => {
      const existingData = record.data ?? {};
      const lostReason = record.type === OPPORTUNITY_RECORD_TYPE &&
        opportunityData(record).stage === "Lost" &&
        !String(existingData.lostReason || "").trim()
        ? "Other"
        : existingData.lostReason;
      return {
        ...record,
        meta: record.meta.replace(mergeCompanyFrom, mergeCompanyTo),
        data: { ...existingData, company: mergeCompanyTo, lostReason, companyNameHistory: [...new Set([...(Array.isArray(existingData.companyNameHistory) ? existingData.companyNameHistory.map(String) : []), mergeCompanyFrom])], companyResolution: { input: mergeCompanyFrom, canonical: mergeCompanyTo, decision: "Reuse Existing", score: 100, reason: "Company Owner or Administrator completed a controlled company-name merge", decidedBy: actor.name, decidedAt: new Date().toISOString(), source: "Company Merge" } },
      };
    });
    setSaving(true);
    try {
      await Promise.all(
        updatedRecords.map((record) => persistSalesRecord(record.type!, record)),
      );
      const updatedMap = new Map(updatedRecords.map((record) => [record.id, record]));
      setRecords((current) => current.map((record) => updatedMap.get(record.id) || record));
      setMergeCompanyOpen(false);
      setNotice(`${mergeCompanyFrom} Merged Into ${mergeCompanyTo}!`);
      setMergeCompanyFrom("");
      setMergeCompanyTo("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Company Names Could Not Be Merged.");
    } finally {
      setSaving(false);
    }
  }

  const funnelOpportunities = opportunities;
  const activeOpportunities = funnelOpportunities.filter(
    (record) => !outcomeStages.includes(opportunityData(record).stage as (typeof outcomeStages)[number]),
  );
  const pipelineValue = activeOpportunities.reduce(
    (total, record) => total + salesOpportunityValue(record.data, record.status),
    0,
  );
  const weightedValue = activeOpportunities.reduce((total, record) => {
    const data = opportunityData(record);
    return total + salesOpportunityValue(record.data, record.status) * (Number(data.probability || 0) / 100);
  }, 0);
  const today = todayInput();
  const followUpsDueRecords = [...contacts, ...activeOpportunities].filter((record) => {
    const nextDate = record.type === CONTACT_RECORD_TYPE
      ? contactData(record).nextFollowUpDate
      : opportunityData(record).nextFollowUpDate;
    return nextDate && nextDate <= today;
  });
  const followUpsDue = followUpsDueRecords.length;

  const availableSalesYears = Array.from(new Set([
    2026,
    currentEasternYear(),
    ...goalRecords.map((record) => Number(record.data?.year || 0)).filter(Boolean),
    ...allAwardedSales.map((sale) => Number(sale.awardDate.slice(0, 4))).filter(Boolean),
    ...opportunities.map((record) => Number(String(record.data?.estimatingLockedAt || record.data?.estimatingRequestedAt || "").slice(0, 4))).filter(Boolean),
  ])).sort((a, b) => b - a);
  const selectedGoal = goalRecordData(
    goalRecords.find((record) => Number(record.data?.year) === selectedSalesYear),
  ) || defaultSalesGoal(selectedSalesYear);
  const selectedYearSales = allAwardedSales.filter(
    (sale) => Number(sale.awardDate.slice(0, 4)) === selectedSalesYear,
  );
  const totalSales = selectedYearSales.reduce((total, sale) => total + sale.contractValue, 0);
  const totalManagementHours = selectedYearSales.reduce(
    (total, sale) => total + sale.managementHours,
    0,
  );
  const totalManagementRevenue = selectedYearSales.reduce(
    (total, sale) => total + sale.managementRevenue,
    0,
  );
  const totalInsurance = selectedYearSales.reduce(
    (total, sale) => total + sale.insuranceRevenue,
    0,
  );
  const totalTechnologyFee = selectedYearSales.reduce(
    (total, sale) => total + sale.technologyFee,
    0,
  );
  const totalGrossProfit = selectedYearSales.reduce(
    (total, sale) => total + sale.grossProfit,
    0,
  );
  const averageGrossMargin = totalSales > 0 ? totalGrossProfit / totalSales : 0;
  const companyGoal = selectedGoal?.companyGoal || 0;
  const goalPercent = companyGoal > 0 ? totalSales / companyGoal : 0;
  const monthlySales = Array.from({ length: 12 }, (_, month) =>
    selectedYearSales
      .filter((sale) => Number(sale.awardDate.slice(5, 7)) === month + 1)
      .reduce((total, sale) => total + sale.contractValue, 0),
  );
  const quarterlySales = SALES_QUARTER_WEIGHTS.map((_, quarter) =>
    monthlySales.slice(quarter * 3, quarter * 3 + 3).reduce((total, value) => total + value, 0),
  );
  const monthlyGoals = SALES_QUARTER_WEIGHTS.flatMap((weight) =>
    Array.from({ length: 3 }, () => (companyGoal * weight) / 3),
  );
  const salespersonTotals = Array.from(
    selectedYearSales.reduce((map, sale) => {
      map.set(sale.salesperson, (map.get(sale.salesperson) || 0) + sale.contractValue);
      return map;
    }, new Map<string, number>()),
  )
    .map(([name, total]) => ({
      name,
      total,
      goal: selectedGoal?.salespersonGoals.find((person) => person.name === name)?.goal || 0,
    }))
    .concat(
      (selectedGoal?.salespersonGoals || [])
        .filter((person) => !selectedYearSales.some((sale) => sale.salesperson === person.name))
        .map((person) => ({ name: person.name, total: 0, goal: person.goal })),
    )
    .sort((a, b) => b.total - a.total);
  const clientTotals = Array.from(
    selectedYearSales.reduce((map, sale) => {
      map.set(sale.company, (map.get(sale.company) || 0) + sale.contractValue);
      return map;
    }, new Map<string, number>()),
  )
    .map(([company, total]) => ({ company, total }))
    .sort((a, b) => b.total - a.total);
  const selectedYearPipeline = activeOpportunities.filter(
    (record) => Number(opportunityData(record).expectedAwardDate.slice(0, 4)) === selectedSalesYear,
  );
  const selectedPipelineValue = selectedYearPipeline.reduce(
    (total, record) => total + salesOpportunityValue(record.data, record.status),
    0,
  );
  const selectedWeightedPipeline = selectedYearPipeline.reduce((total, record) => {
    const data = opportunityData(record);
    return total + salesOpportunityValue(record.data, record.status) * (Number(data.probability || 0) / 100);
  }, 0);
  const canViewSalesProfit =
    ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
    actor.designations.includes("Estimator");
  const historicalEstimateRecords = opportunities.filter((record) => {
    const data = opportunityData(record);
    const enteredAt = String(record.data?.estimatingLockedAt || data.estimatingRequestedAt || "");
    return Boolean(enteredAt) && Number(enteredAt.slice(0, 4)) === selectedSalesYear;
  });
  const sectorHistory = Array.from(historicalEstimateRecords.reduce((map, record) => {
    const data = opportunityData(record);
    const sector = data.projectType || "Other";
    const estimate = normalizeEstimateData(record.data?.estimate);
    const summary = calculateEstimateSummary(estimate);
    const squareFeet = Number(estimate.projectInputs.buildingSquareFeet || 0);
    const proposalHandoff = record.data?.proposalHandoff && typeof record.data.proposalHandoff === "object" ? record.data.proposalHandoff as Record<string, unknown> : null;
    const proposedValue = Number(proposalHandoff?.contractAmount || 0) || summary.contractValue || salesOpportunityValue(record.data, record.status);
    const proposalDays = daysBetween(String(record.data?.estimatingLockedAt || data.estimatingRequestedAt || ""), String(record.data?.proposalSubmittedAt || ""));
    const outcome = data.stage === "Lost" ? "lost" : opportunityContract(record.data)?.signed ? "won" : "open";
    const current = map.get(sector) || { sector, won: 0, lost: 0, open: 0, pricedSquareFeet: 0, pricedValue: 0, proposalDays: [] as number[] };
    current[outcome] += 1;
    if (squareFeet > 0 && proposedValue > 0) { current.pricedSquareFeet += squareFeet; current.pricedValue += proposedValue; }
    if (proposalDays !== null) current.proposalDays.push(proposalDays);
    map.set(sector, current);
    return map;
  }, new Map<string, { sector: string; won: number; lost: number; open: number; pricedSquareFeet: number; pricedValue: number; proposalDays: number[] }>()).values()).sort((a, b) => (b.won + b.lost + b.open) - (a.won + a.lost + a.open));

  const filteredContacts = contacts.filter((record) => {
    const data = contactData(record);
    const haystack = `${record.title} ${data.company} ${data.email} ${data.phone}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const contactCompanies = Array.from(
    new Set([...contacts.map((record) => contactData(record).company), ...opportunities.map((record) => opportunityData(record).company)].filter(Boolean)),
  ).sort();
  const companyMatches = resolvedCompanyMatches(contactDraft.company, contactCompanies.filter((company) => company.trim().toLowerCase() !== contactDraft.company.trim().toLowerCase()), records);
  const separateCompanyConfirmed = companyResolution?.decision === "Confirmed Separate" && companyResolution.input.trim().toLowerCase() === contactDraft.company.trim().toLowerCase();
  const existingCompanyReused = companyResolution?.decision === "Reuse Existing" && companyResolution.canonical.trim().toLowerCase() === contactDraft.company.trim().toLowerCase();
  const companyMatchNeedsDecision = companyMatches.length > 0 && !separateCompanyConfirmed && !existingCompanyReused;
  const directCompanyMatches = resolvedCompanyMatches(directEstimateDraft.company, contactCompanies.filter((company) => company.trim().toLowerCase() !== directEstimateDraft.company.trim().toLowerCase()), records);
  const directSeparateConfirmed = directCompanyResolution?.decision === "Confirmed Separate" && directCompanyResolution.input.trim().toLowerCase() === directEstimateDraft.company.trim().toLowerCase();
  const directExistingReused = directCompanyResolution?.decision === "Reuse Existing" && directCompanyResolution.canonical.trim().toLowerCase() === directEstimateDraft.company.trim().toLowerCase();
  const directCompanyNeedsDecision = Boolean(directEstimateDraft.company.trim()) && directCompanyMatches.length > 0 && !directSeparateConfirmed && !directExistingReused;
  const opportunityCompanyContacts = contactsForCompany(contacts, opportunityDraft.company);
  const directEstimateCompanyContacts = contactsForCompany(contacts, directEstimateDraft.company);
  const opportunityResolvedContact = opportunityCompanyContacts.find((contact) => contact.id === opportunityDraft.contactId)
    || (opportunityCompanyContacts.length === 1 ? opportunityCompanyContacts[0] : null);
  const opportunityHandoffMissing = missingSalesOpportunityHandoffFields({
    ...opportunityDraft,
    contactId: opportunityResolvedContact?.id || opportunityDraft.contactId,
    contactName: opportunityResolvedContact?.title || opportunityDraft.contactName,
  });
  const opportunityReadyForEstimating = opportunityHandoffMissing.length === 0;
  const editingDirectEstimate = Boolean(
    opportunityDraft.id && records.find((record) => record.id === opportunityDraft.id)?.data?.directEstimate,
  );

  const estimatingProjects = opportunities.filter((record) => {
    const data = opportunityData(record);
    const enteredEstimating = Boolean(record.data?.directEstimate) || Boolean(data.estimatingRequestedAt);
    return enteredEstimating &&
      !["Awarded", "Lost"].includes(data.stage) &&
      data.estimateStatus !== "Awarded" &&
      !data.awardedProjectNumber;
  });
  const selectedEstimate = estimatingProjects.find(
    (record) => record.id === selectedEstimateId,
  );
  const salesRemainingGoal = Math.max(0, companyGoal - totalSales);
  const salesGoalCoverage = salesRemainingGoal > 0 ? selectedWeightedPipeline / salesRemainingGoal : null;
  const salesNextMovesDue = activeOpportunities.filter((record) => {
    const next = opportunityData(record).nextFollowUpDate;
    return !next || next <= today;
  });
  const estimateOverdue = estimatingProjects.filter((record) => {
    const data = opportunityData(record);
    return Boolean(data.bidDueDate) && data.bidDueDate < today && !["Proposal Submitted", "Approved"].includes(data.estimateStatus);
  });
  const estimateDueSeven = estimatingProjects.filter((record) => {
    const data = opportunityData(record);
    const days = daysBetween(today, data.bidDueDate);
    return days !== null && days <= 7 && !["Proposal Submitted", "Approved"].includes(data.estimateStatus);
  });
  const estimateUnassigned = estimatingProjects.filter((record) => !opportunityData(record).assignedEstimator);
  const estimateReadyForReview = estimatingProjects.filter((record) => opportunityData(record).estimateStatus === "Ready For Review");

  if (loading) {
    return <div className="sales-loading">Loading Sales And Estimating...</div>;
  }

  if (!recordsLoaded && recordsError) {
    return <div className="workspace-load-error" role="alert">
      <span>{recordsError}</span>
      <button className="secondary-action" onClick={() => { setLoading(true); setRecordsRetry((value) => value + 1); }}>Retry Loading Projects</button>
    </div>;
  }

  return (
    <div className="sales-workspace" data-mode={mode}>
      {teamError ? <div className="workspace-load-error" role="alert"><span>{teamError}</span><button className="secondary-action" onClick={() => setTeamRetry((value) => value + 1)}>Retry Team List</button></div> : null}
      {recordsError ? <div className="workspace-load-error" role="alert"><span>{recordsError}</span><button className="secondary-action" onClick={() => setRecordsRetry((value) => value + 1)}>Retry Loading Projects</button></div> : null}
      {notice ? (
        <button className="sales-notice" role="status" onClick={() => setNotice("")}>
          {notice} <span>×</span>
        </button>
      ) : null}

      {mode === "dashboard" ? (
        <>
          <section className="sales-heading sales-dashboard-heading">
            <div>

              <h1>{selectedSalesYear} Sales Dashboard</h1>

            </div>
            <label className="sales-year-picker">
              <span>Dashboard Year</span>
              <select value={selectedSalesYear} onChange={(event) => setSelectedSalesYear(Number(event.target.value))}>
                {availableSalesYears.map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
            <button className="secondary-action" onClick={() => setHistoryOpen(true)}>Opportunity History</button>
          </section>

          <section className="role-outcome-command sales-outcome-command">

            <div {...summaryDrilldownProps({ title: "Contracts To Sign", rows: contractsToSign.map(contract => {
              const record = opportunities.find(record => opportunityContract(record.data)?.projectNumber === contract.projectNumber);
              return { id: contract.projectNumber, title: contract.projectName, subtitle: contract.company, status: contract.status,
                value: formatCurrency(contract.contractValue), meta: String(record?.data?.assignedRep || record?.owner || contract.projectNumber),
                onOpen: onOpenContract ? () => onOpenContract(contract.projectNumber) : undefined, openLabel: "Open Contract →" };
            }) })}><small>CONTRACTS TO SIGN</small><strong>{contractsToSign.length}</strong><span>{formatCurrency(contractsToSign.reduce((sum, contract) => sum + contract.contractValue, 0))}</span></div>

            <div><small>WEIGHTED GOAL COVERAGE</small><strong>{companyGoal <= 0 ? "Goal Not Set" : salesGoalCoverage === null ? "Covered" : `${salesGoalCoverage.toFixed(2)}×`}</strong><span>{formatCurrency(selectedWeightedPipeline)} weighted against {formatCurrency(salesRemainingGoal)} remaining</span></div>
            <div className={salesNextMovesDue.length ? "risk" : ""}><small>NEXT MOVES DUE</small><strong>{salesNextMovesDue.length}</strong></div>
            <div className={goalPercent < 1 ? "risk" : ""}><small>SIGNED SALES PACE</small><strong>{(goalPercent * 100).toFixed(1)}%</strong><span>{formatCurrency(totalSales)} signed of {formatCurrency(companyGoal)} goal</span></div>
          </section>

          {!selectedGoal && selectedSalesYear === currentEasternYear() ? (
            <section className="sales-goal-alert" role="alert">
              <span>!</span>
              <div><strong>{selectedSalesYear} Sales Goal Needs Attention</strong><small>Set company and salesperson goals in Admin → Sales Goals.</small></div>
            </section>
          ) : null}

          <section {...summaryDrilldownProps({ title: `${selectedSalesYear} Signed Sales`, description: "Contracts signed by both parties, credited on the final-signature date.", rows: selectedYearSales.map((sale) => ({ id: sale.id, title: sale.title, subtitle: sale.company, status: "Signed", value: formatCurrency(sale.contractValue), meta: `${sale.salesperson} · ${displayDate(sale.awardDate)}` })) }, "sales-goal-hero")}>
            <div>
              <span>{selectedSalesYear} Total Signed Sales</span>
              <strong>{formatCompactCurrency(totalSales)}</strong>
              <small>Goal {formatCompactCurrency(companyGoal)} · {Math.min(999, goalPercent * 100).toFixed(1)}% Complete</small>
            </div>
            <div className="sales-goal-progress" aria-label={`${(goalPercent * 100).toFixed(1)} Percent Of Sales Goal`}>
              <span style={{ width: `${Math.min(100, goalPercent * 100)}%` }} />
            </div>
            <div className="sales-goal-balance">
              <span>Remaining To Goal</span>
              <strong>{formatCurrency(Math.max(0, companyGoal - totalSales))}</strong>
              <small>{selectedYearSales.length} Signed Contract{selectedYearSales.length === 1 ? "" : "s"}</small>
            </div>
          </section>

          <section className="sales-dashboard-metrics">
            <article {...summaryDrilldownProps({ title: "Management Sold", description: "Signed contracts contributing PM and Superintendent management revenue.", rows: selectedYearSales.filter((sale) => sale.managementRevenue || sale.managementHours).map((sale) => ({ id: sale.id, title: sale.title, subtitle: sale.company, value: formatCurrency(sale.managementRevenue), meta: `${Math.round(sale.managementHours).toLocaleString()} management hours · ${sale.salesperson}` })) })}><span>MANAGEMENT SOLD</span><strong>{formatCurrency(totalManagementRevenue)}</strong><small>{Math.round(totalManagementHours).toLocaleString()} Combined PM And Superintendent Hours</small></article>
            <article {...summaryDrilldownProps({ title: "Insurance Sold", description: "Signed-contract estimate insurance lines contributing to this total.", rows: selectedYearSales.filter((sale) => sale.insuranceRevenue).map((sale) => ({ id: sale.id, title: sale.title, subtitle: sale.company, value: formatCurrency(sale.insuranceRevenue), meta: `${sale.salesperson} · ${displayDate(sale.awardDate)}` })) })}><span>INSURANCE SOLD</span><strong>{formatCurrency(totalInsurance)}</strong></article>
            <article {...summaryDrilldownProps({ title: "Technology Fee Sold", description: "Signed contracts contributing technology fee revenue.", rows: selectedYearSales.filter((sale) => sale.technologyFee).map((sale) => ({ id: sale.id, title: sale.title, subtitle: sale.company, value: formatCurrency(sale.technologyFee), meta: `${sale.salesperson} · ${displayDate(sale.awardDate)}` })) })}><span>TECH FEE SOLD</span><strong>{formatCurrency(totalTechnologyFee)}</strong></article>
            {canViewSalesProfit ? <article {...summaryDrilldownProps({ title: "Gross Profit Sold", description: "Signed contracts contributing gross profit and margin.", rows: selectedYearSales.map((sale) => ({ id: sale.id, title: sale.title, subtitle: sale.company, value: formatCurrency(sale.grossProfit), meta: `${sale.contractValue ? (sale.grossProfit / sale.contractValue * 100).toFixed(1) : "0.0"}% margin · ${sale.salesperson}` })) }, "profit-card")}><span>GROSS PROFIT SOLD</span><strong>{formatCurrency(totalGrossProfit)}</strong><small>{(averageGrossMargin * 100).toFixed(1)}% Average Gross Margin</small></article> : <article className="restricted-card"><span>PROFITABILITY</span><strong>Restricted</strong><small>Owners Administrators And Estimators</small></article>}
          </section>

          <section className="sales-dashboard-grid sales-chart-row">
            <article className="sales-dashboard-card monthly-sales-card">
              <header><div><h2>Monthly Sales</h2></div><span>■ Signed　□ Goal</span></header>
              <div className="monthly-sales-chart">
                {monthlySales.map((value, index) => {
                  const maximum = Math.max(...monthlySales, ...monthlyGoals, 1);
                  return <div className="month-column" key={index}><div className="month-value">{formatCompactCurrency(value)}</div><div className="month-bars"><span className="month-goal-bar" style={{ height: `${Math.max(3, monthlyGoals[index] / maximum * 100)}%` }} /><span className="month-sales-bar" style={{ height: `${value ? Math.max(5, value / maximum * 100) : 2}%` }} /></div><small>{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index]}</small></div>;
                })}
              </div>
            </article>
            <article className="sales-dashboard-card quarterly-sales-card">
              <header><div><h2>Quarterly Sales</h2></div></header>
              <div className="quarter-grid">
                {quarterlySales.map((value, index) => {
                  const quarterGoal = companyGoal * SALES_QUARTER_WEIGHTS[index];
                  const percentComplete = quarterGoal > 0 ? value / quarterGoal : 0;
                  return <div key={index}><span>Q{index + 1}</span><strong>{formatCompactCurrency(value)}</strong><small>Goal {formatCompactCurrency(quarterGoal)}</small><div><i style={{ width: `${Math.min(100, percentComplete * 100)}%` }} /></div><b>{(percentComplete * 100).toFixed(0)}%</b></div>;
                })}
              </div>
            </article>
          </section>

          <section className="sales-dashboard-grid leader-row">
            <article className="sales-dashboard-card leaderboard-card">
              <header><div><h2>Top Salespeople</h2></div></header>
              <div className="leader-list">
                {salespersonTotals.length ? salespersonTotals.slice(0, 6).map((person, index) => <div key={person.name}><span>{index + 1}</span><div><strong>{person.name}</strong><small>{person.goal ? `${(person.total / person.goal * 100).toFixed(1)}% Of ${formatCompactCurrency(person.goal)} Goal` : "Goal Not Set"}</small></div><b>{formatCurrency(person.total)}</b></div>) : <p className="dashboard-empty-copy">No signed sales.</p>}
              </div>
            </article>
            <article className="sales-dashboard-card leaderboard-card">
              <header><div><h2>Top Client Companies</h2></div></header>
              <div className="leader-list">
                {clientTotals.length ? clientTotals.slice(0, 6).map((client, index) => <div key={client.company}><span>{index + 1}</span><div><strong>{client.company}</strong><small>{selectedYearSales.filter((sale) => sale.company === client.company).length} Signed Contract{selectedYearSales.filter((sale) => sale.company === client.company).length === 1 ? "" : "s"}</small></div><b>{formatCurrency(client.total)}</b></div>) : <p className="dashboard-empty-copy">No signed contracts.</p>}
              </div>
            </article>
          </section>

          <section className="sales-dashboard-grid pipeline-row">
            <article {...summaryDrilldownProps({ title: `${selectedSalesYear} Open Pipeline`, description: "Every opportunity included in the selected-year open pipeline.", rows: selectedYearPipeline.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: data.company, status: data.stage, value: formatCurrency(salesOpportunityValue(record.data, record.status)), meta: `${data.probability}% probability · ${data.assignedRep}`, onOpen: () => openOpportunityEditor(record), openLabel: "Open Opportunity →" }; }) }, "sales-dashboard-card pipeline-summary-card")}><span>OPEN PIPELINE</span><strong>{formatCurrency(selectedPipelineValue)}</strong><small>{selectedYearPipeline.length} Opportunities Expected In {selectedSalesYear}</small></article>
            <article {...summaryDrilldownProps({ title: `${selectedSalesYear} Weighted Pipeline`, description: "Every opportunity and its probability-adjusted value.", rows: selectedYearPipeline.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: `${data.company} · ${data.stage}`, status: `${data.probability}% Probability`, value: formatCurrency(salesOpportunityValue(record.data, record.status) * Number(data.probability || 0) / 100), meta: `Gross opportunity ${formatCurrency(salesOpportunityValue(record.data, record.status))}`, onOpen: () => openOpportunityEditor(record), openLabel: "Open Opportunity →" }; }) }, "sales-dashboard-card pipeline-summary-card")}><span>WEIGHTED PIPELINE</span><strong>{formatCurrency(selectedWeightedPipeline)}</strong></article>
            <article className="sales-dashboard-card recent-wins-card"><header><div><h2>Recently Signed Contracts</h2></div></header>{selectedYearSales.length ? selectedYearSales.slice().sort((a, b) => b.awardDate.localeCompare(a.awardDate)).slice(0, 3).map((sale) => <div key={sale.id}><span>{displayDate(sale.awardDate)}</span><strong>{sale.title}</strong><b>{formatCurrency(sale.contractValue)}</b></div>) : <p className="dashboard-empty-copy">No contracts were signed in this year.</p>}</article>
          </section>
          <section className="sales-dashboard-card sector-history-card">
            <header><div><h2>Estimating Performance By Sector</h2></div><span>{historicalEstimateRecords.length} ESTIMATES ENTERED IN {selectedSalesYear}</span></header>
            {sectorHistory.length ? <div className="sector-history-table" data-reflow-table=""><div className="sector-history-head" data-reflow-head="medium"><b>Sector</b><b>Won / Lost / Open</b><b>Win Rate</b><b>Running $ / SF</b><b>Avg. Estimate To Proposal</b></div>{sectorHistory.map((sector) => { const decided = sector.won + sector.lost; const averageDays = sector.proposalDays.length ? sector.proposalDays.reduce((sum, value) => sum + value, 0) / sector.proposalDays.length : null; return <div key={sector.sector} data-reflow-row="medium"><strong data-label="Sector">{sector.sector}</strong><span data-label="Won / Lost / Open">{sector.won} / {sector.lost} / {sector.open}</span><span data-label="Win Rate">{decided ? `${(sector.won / decided * 100).toFixed(1)}%` : "Pending"}</span><span data-label="Running $ / SF">{sector.pricedSquareFeet ? `${formatCurrency(sector.pricedValue / sector.pricedSquareFeet)} / SF` : "Awaiting SF + Price"}</span><span data-label="Avg. Estimate To Proposal">{averageDays === null ? "Awaiting Proposal" : `${averageDays.toFixed(1)} Days`}</span></div>; })}</div> : <p className="dashboard-empty-copy">No estimate history for this year.</p>}
          </section>
        </>
      ) : null}

      {mode === "goals" ? (
        <>
          <section className="sales-heading">
            <div>

              <h1>Sales Goals</h1>

            </div>
            <label className="sales-year-picker"><span>Goal Year</span><select value={goalYear} onChange={(event) => selectGoalYear(Number(event.target.value))}>{Array.from(new Set([currentEasternYear(), currentEasternYear() + 1, ...goalRecords.map((record) => Number(record.data?.year || 0))])).sort((a, b) => b - a).map((year) => <option key={year}>{year}</option>)}</select></label>
          </section>
          {actor.accessLevel === "Company Owner" ? (
            <>
              <section className="sales-goal-admin-grid">
                <article className="sales-dashboard-card goal-company-card">
                  <header><div><h2>{goalYear} Company Goal</h2></div></header>
                  <label><span>Annual Signed Sales Goal</span><div><b>$</b><CurrencyInput aria-label="Annual Signed Sales Goal" min="0" value={goalCompanyAmount} onValueChange={setGoalCompanyAmount} /></div></label>
                  <div className="goal-quarter-preview">{SALES_QUARTER_WEIGHTS.map((weight, index) => <span key={index}><small>Q{index + 1} · {(weight * 100).toFixed(0)}%</small><strong>{formatCurrency(Number(goalCompanyAmount || 0) * weight)}</strong></span>)}</div>
                </article>
                <article className="sales-dashboard-card goal-people-card">
                  <header><div><h2>Salesperson Goals</h2></div></header>
                  <div>{salespeople.map((person) => <label key={person.email}><span><strong>{person.name}</strong><small>{person.email}</small></span><div><b>$</b><CurrencyInput aria-label={`${person.name} Annual Sales Goal`} min="0" value={goalPeople[person.email] || ""} onValueChange={(value) => setGoalPeople((current) => ({ ...current, [person.email]: value }))} /></div></label>)}</div>
                  {salespeople.reduce((total, person) => total + Number(goalPeople[person.email] || 0), 0) !== Number(goalCompanyAmount || 0) ? <p className="goal-warning">Individual goals differ from the company goal.</p> : <p className="goal-match">Individual Goals Equal The Company Goal.</p>}
                </article>
              </section>
              <div className="sales-goal-save"><button className="primary-action large" disabled={saving} onClick={() => void saveSalesGoals()}>{saving ? "Saving Sales Goals..." : `Save ${goalYear} Sales Goals`}</button></div>
            </>
          ) : <section className="sales-dashboard-card sales-goal-restricted"><strong>Company Owner Access Required</strong><p>Administrators Sales Representatives And Estimators Can View Approved Goals On The Sales Dashboard. Only A Company Owner Can Set Or Change Them.</p></section>}
        </>
      ) : null}

      {mode === "contacts" ? (
        <>
          <section className="sales-heading">
            <div>

              <h1>Contacts</h1>

            </div>
            <div className="sales-heading-actions">
              {["Company Owner", "Administrator"].includes(actor.accessLevel) && contactCompanies.length > 1 ? <button className="secondary-action" onClick={() => setMergeCompanyOpen(true)}>Merge Company Names</button> : null}
              <a className="secondary-action" href="/templates/Mefford_Contacts_Import_Template.xlsx" download>Download Contact Template</a>
              <label className={`secondary-action contact-import-label ${importingContacts ? "disabled" : ""}`}><span>{importingContacts ? "Importing Contacts..." : "Import Contacts From Excel"}</span><input ref={contactImportInput} className="contact-import-input" type="file" data-format-required="true" accept=".xlsx,.xls" disabled={importingContacts} onChange={(event) => event.target.files?.[0] && void importContacts(event.target.files[0])} /></label>
              <button className="primary-action large" onClick={() => openContactEditor()}>＋ New Contact</button>
            </div>
          </section>
          <section className="sales-summary-grid">
            <article {...summaryDrilldownProps({ title: "Sales Contacts", description: "Every person included in the CRM contact total.", rows: contacts.map((record) => { const data = contactData(record); return { id: record.id, title: record.title, subtitle: `${data.company} · ${data.jobTitle || data.companyType}`, status: data.relationshipStatus, meta: `${data.email || "No email"} · Follow-up ${displayDate(data.nextFollowUpDate)}`, onOpen: () => openContactEditor(record), openLabel: "Open Contact →" }; }) })}><span>TOTAL CONTACTS</span><strong>{contacts.length}</strong><small>People In The Company CRM</small></article>
            <article {...summaryDrilldownProps({ title: "Active Sales Companies", description: "Every organization represented by the contact total.", rows: Array.from(new Set(contacts.map((record) => contactData(record).company).filter(Boolean))).sort().map((company) => ({ id: company, title: company, subtitle: `${contacts.filter((record) => contactData(record).company === company).length} contact(s)`, status: "Active CRM Company", onOpen: () => setSearch(company), openLabel: "Show Contacts →" })) })}><span>ACTIVE COMPANIES</span><strong>{new Set(contacts.map((record) => contactData(record).company).filter(Boolean)).size}</strong><small>Organizations Represented</small></article>
            <article {...summaryDrilldownProps({ title: "Sales Follow-Ups Due", description: "Contacts and opportunities with a follow-up date due today or earlier.", rows: followUpsDueRecords.map((record) => { const contact = record.type === CONTACT_RECORD_TYPE; const data = contact ? contactData(record) : opportunityData(record); return { id: record.id, title: record.title, subtitle: contact ? contactData(record).company : opportunityData(record).company, status: contact ? "Contact Follow-Up" : opportunityData(record).stage, meta: `Due ${displayDate(data.nextFollowUpDate)}`, onOpen: () => contact ? openContactEditor(record) : openOpportunityEditor(record), openLabel: contact ? "Open Contact →" : "Open Opportunity →" }; }) })}><span>FOLLOW-UPS DUE</span><strong>{followUpsDue}</strong><small>Due Today Or Earlier</small></article>
          </section>
          <section className="sales-panel">
            <div className="sales-panel-heading">
              <div><h2>Company Contacts</h2></div>
              <label className="sales-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Contacts Or Companies" /></label>
            </div>
            {filteredContacts.length ? (
              <div className="company-contact-groups">
                {Array.from(new Set(filteredContacts.map((record) => contactData(record).company || "Company Not Entered"))).sort().map((company) => {
                  const companyContacts = filteredContacts.filter((record) => (contactData(record).company || "Company Not Entered") === company);
                  return <section key={company}><header><div><span>COMPANY</span><strong>{company}</strong></div><small>{companyContacts.length} Contact{companyContacts.length === 1 ? "" : "s"}</small></header><div>{companyContacts.map((record) => { const data = contactData(record); return <button key={record.id} onClick={() => openContactEditor(record)}><span><strong>{record.title}</strong><small>{data.jobTitle || data.companyType}</small></span><span><strong>{data.email || "No Email Entered"}</strong><small>{data.phone || "No Phone Entered"}</small></span><span><strong>{data.assignedRep}</strong><small>Next Follow-Up {displayDate(data.nextFollowUpDate)}</small></span><i className={`crm-status ${data.relationshipStatus.toLowerCase()}`}>{data.relationshipStatus}</i></button>; })}</div></section>;
                })}
              </div>
            ) : (
              <div className="sales-empty"><span>＋</span><strong>No Sales Contacts Yet</strong><p>Add Your First Real Client Contact To Start Building The Mefford CRM.</p><button onClick={() => openContactEditor()}>Add First Contact</button></div>
            )}
          </section>
        </>
      ) : null}

      {mode === "funnel" ? (
        <>
          <section className="sales-heading">
            <div>

              <h1>Sales Funnel</h1>

            </div>
            <button className="primary-action large" onClick={() => openOpportunityEditor()}>
              ＋ New Opportunity
            </button>
          </section>
          <section className="sales-summary-grid four funnel-summary">
            <article {...summaryDrilldownProps({ title: "Open Sales Opportunities", description: "Every active funnel project included in this count.", rows: activeOpportunities.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: data.company, status: data.stage, value: formatCurrency(salesOpportunityValue(record.data, record.status)), meta: `${data.probability}% probability · ${data.assignedRep}`, onOpen: () => openOpportunityEditor(record), openLabel: "Open Opportunity →" }; }) })}><span>OPEN OPPORTUNITIES</span><strong>{activeOpportunities.length}</strong><small>Active Funnel Projects</small></article>
            <article {...summaryDrilldownProps({ title: "Sales Pipeline Value", description: "Every opportunity contributing to total potential contract value.", rows: activeOpportunities.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: `${data.company} · ${data.stage}`, status: `${data.probability}% Probability`, value: formatCurrency(salesOpportunityValue(record.data, record.status)), onOpen: () => openOpportunityEditor(record), openLabel: "Open Opportunity →" }; }) })}><span>PIPELINE VALUE</span><strong>{formatCurrency(pipelineValue)}</strong><small>Total Potential Contract Value</small></article>
            <article {...summaryDrilldownProps({ title: "Weighted Sales Pipeline", description: "Every active opportunity with its probability-adjusted value.", rows: activeOpportunities.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: `${data.company} · ${data.stage}`, status: `${data.probability}% Probability`, value: formatCurrency(salesOpportunityValue(record.data, record.status) * Number(data.probability || 0) / 100), meta: `Gross opportunity ${formatCurrency(salesOpportunityValue(record.data, record.status))}`, onOpen: () => openOpportunityEditor(record), openLabel: "Open Opportunity →" }; }) })}><span>WEIGHTED PIPELINE</span><strong>{formatCurrency(weightedValue)}</strong><small>Value Adjusted By Probability</small></article>
            <article {...summaryDrilldownProps({ title: "Sales Follow-Ups Due", description: "Contacts and opportunities due for follow-up today or earlier.", rows: followUpsDueRecords.map((record) => { const contact = record.type === CONTACT_RECORD_TYPE; const data = contact ? contactData(record) : opportunityData(record); return { id: record.id, title: record.title, subtitle: contact ? contactData(record).company : opportunityData(record).company, status: contact ? "Contact Follow-Up" : opportunityData(record).stage, meta: `Due ${displayDate(data.nextFollowUpDate)}`, onOpen: () => contact ? openContactEditor(record) : openOpportunityEditor(record), openLabel: contact ? "Open Contact →" : "Open Opportunity →" }; }) })}><span>FOLLOW-UPS DUE</span><strong>{followUpsDue}</strong><small>Due Today Or Earlier</small></article>
          </section>
          <section className="funnel-board" aria-label="Construction Sales Funnel">
            {funnelStages.map((stage, stageIndex) => {
              const stageRecords = funnelOpportunities.filter((record) => opportunityData(record).stage === stage);
              const stageValue = stageRecords.reduce((total, record) => total + salesOpportunityValue(record.data, record.status), 0);
              return (
                <article
                  className={`funnel-column ${draggedOpportunityId ? "drag-ready" : ""} ${dropStage === stage ? "drop-target" : ""}`}
                  key={stage}
                  data-funnel-stage={stage}
                  onDragOver={(event) => { if (!dragOpportunityRef.current) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage); }}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStage(""); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const recordId = dragOpportunityRef.current;
                    const record = funnelOpportunities.find((item) => item.id === recordId);
                    cancelAnimationFrame(dragFrameRef.current);
                    dragOpportunityRef.current = "";
                    setDraggedOpportunityId("");
                    setDropStage("");
                    suppressCardClickUntil.current = Date.now() + 350;
                    if (record) void moveOpportunity(record, stage);
                  }}
                >
                  <header><span className={`stage-number stage-${Math.min(stageIndex + 1, 8)}`}>{stageIndex + 1}</span><div><strong>{stage}</strong><small>{stageRecords.length} Project{stageRecords.length === 1 ? "" : "s"} · {formatCurrency(stageValue)}</small></div></header>
                  <div className="funnel-card-list">
                    {stageRecords.map((record) => {
                      const data = opportunityData(record);
                      return (
                        <div className="funnel-card-shell" key={record.id} aria-busy={movingOpportunityIds.includes(record.id)}>
                        <button
                          className={`funnel-card ${draggedOpportunityId === record.id ? "is-dragging" : ""}`}
                          disabled={movingOpportunityIds.includes(record.id)}
                          draggable={!movingOpportunityIds.includes(record.id)}
                          onDragStart={(event) => {
                            dragOpportunityRef.current = record.id;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", record.id);
                            // Let the browser capture the card before updating drag feedback.
                            dragFrameRef.current = requestAnimationFrame(() => setDraggedOpportunityId(record.id));
                          }}
                          onDragEnd={() => { cancelAnimationFrame(dragFrameRef.current); dragOpportunityRef.current = ""; setDraggedOpportunityId(""); setDropStage(""); suppressCardClickUntil.current = Date.now() + 350; }}
                          onClick={() => { if (Date.now() >= suppressCardClickUntil.current) openOpportunityEditor(record); }}
                        >
                          <strong>{record.title}</strong>
                          <span className="funnel-customer">{data.company || data.contactName || "Client Pending"}</span>
                          <span className="funnel-value">{formatCurrency(salesOpportunityValue(record.data, record.status))}</span>
                          <span className="funnel-salesperson">{data.assignedRep || "Unassigned"}</span>
                        </button>
                        </div>
                      );
                    })}
                    {!stageRecords.length ? <div className="funnel-empty">No Projects In This Stage</div> : null}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      ) : null}

      {mode === "estimating" ? (
        <>
          <section className="sales-heading estimating-heading">
            <div>

              <h1>Estimating</h1>

            </div>
            <div className="estimating-heading-actions">

              <button className="primary-action large" onClick={openDirectEstimate}>＋ New Estimate</button>
            </div>
          </section>
          <section className="role-outcome-command estimating-outcome-command">

            <div className={estimateDueSeven.length ? "risk" : ""}><small>DUE IN 7 DAYS</small><strong>{estimateDueSeven.length}</strong></div>
            <div className={estimateOverdue.length ? "critical" : ""}><small>OVERDUE PROPOSALS</small><strong>{estimateOverdue.length}</strong></div>
            <div className={estimateUnassigned.length ? "risk" : ""}><small>ASSIGNMENT CONTROL</small><strong>{estimateUnassigned.length}</strong><span>Unassigned · {estimateReadyForReview.length} ready for internal review</span></div>
          </section>
          <section className="sales-summary-grid four">
            {[["Estimating Projects", "", "Sent From The Sales Funnel"], ["Not Started", "Not Started", "Ready For Assignment"], ["In Progress", "In Progress", "Active Estimates"], ["Ready For Review", "Ready For Review", "Awaiting Internal Review"]].map(([label, filter, detail]) => { const matching = filter ? estimatingProjects.filter((record) => opportunityData(record).estimateStatus === filter) : estimatingProjects; return <article key={label} {...summaryDrilldownProps({ title: label, description: `Every estimating project included in ${label.toLowerCase()}.`, rows: matching.map((record) => { const data = opportunityData(record); return { id: record.id, title: record.title, subtitle: `${data.company || "Direct Estimate"} · ${data.assignedEstimator || "Estimator Needed"}`, status: data.estimateStatus, value: formatCurrency(salesOpportunityValue(record.data, record.status)), meta: `Bid due ${displayDate(data.bidDueDate)}`, onOpen: () => setSelectedEstimateId(record.id), openLabel: "Open Estimate →" }; }) })}><span>{label.toUpperCase()}</span><strong>{matching.length}</strong><small>{detail}</small></article>; })}
          </section>
          <section className="sales-panel estimating-panel">
            <div className="sales-panel-heading"><div><h2>Estimating Projects</h2></div></div>
            {estimatingProjects.length ? (
              <div className="estimate-list">
                {estimatingProjects.map((record) => {
                  const data = opportunityData(record);
                  return (
                    <article className="estimate-row" key={record.id}>
                      <button className="estimate-project" onClick={() => setSelectedEstimateId(record.id)}><span>{record.id}</span><strong>{record.title}</strong><small>{data.company || (record.data?.directEstimate ? "Direct Estimate" : "Client Pending")} · {data.projectLocation || "Location Pending"}</small></button>
                      <div><span>Potential Value</span><strong>{formatCurrency(salesOpportunityValue(record.data, record.status))}</strong></div>
                      <div><span>Bid Due</span><strong>{displayDate(data.bidDueDate)}</strong></div>
                      <label><span>Assigned Estimator</span><select value={data.assignedEstimator} onChange={(event) => void updateEstimate(record, "assignedEstimator", event.target.value)}><option value="">Select Estimator</option>{data.assignedEstimator && !estimators.some((person) => person.name === data.assignedEstimator) ? <option>{data.assignedEstimator}</option> : null}{estimators.map((person) => <option key={person.email} value={person.name}>{person.name}</option>)}</select></label>
                      <label><span>Estimate Status</span><select value={data.estimateStatus} disabled={["Approved", "Awarded"].includes(data.estimateStatus)} onChange={(event) => void updateEstimate(record, "estimateStatus", event.target.value)}>{estimateStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                      <div className="estimate-row-actions"><button className="open-estimate-button" onClick={() => setSelectedEstimateId(record.id)}>Open Project →</button></div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="sales-empty estimate-empty"><span>→</span><strong>No Estimates Yet</strong></div>
            )}
          </section>
        </>
      ) : null}

      {mergeCompanyOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setMergeCompanyOpen(false)}>
          <section className="record-modal sales-modal merge-company-modal" role="dialog" aria-modal="true" aria-labelledby="merge-company-title">
            <div className="modal-heading"><div><h2 id="merge-company-title">Merge Company Names</h2></div><button aria-label="Close Company Merge" onClick={() => setMergeCompanyOpen(false)}>×</button></div>
            <div className="sales-form-grid"><Field label="Company Name To Replace"><select value={mergeCompanyFrom} onChange={(event) => setMergeCompanyFrom(event.target.value)}><option value="">Select Company</option>{contactCompanies.map((company) => <option key={company}>{company}</option>)}</select></Field><Field label="Keep This Company Name"><select value={mergeCompanyTo} onChange={(event) => setMergeCompanyTo(event.target.value)}><option value="">Select Company</option>{contactCompanies.filter((company) => company !== mergeCompanyFrom).map((company) => <option key={company}>{company}</option>)}</select></Field></div>
            <div className="sales-modal-actions"><button className="secondary-action" onClick={() => setMergeCompanyOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={() => void mergeCompanyNames()}>{saving ? "Merging Companies..." : "Merge Company Names"}</button></div>
          </section>
        </div>
      ) : null}

      {contactOpen ? (
        <FormModalLayer
          nested={returnContactToOpportunity}
          parentDialogId="opportunity-form-dialog"
          onDismiss={closeContactEditor}
        >
          <section className="record-modal wide sales-modal" role="dialog" aria-modal="true" aria-labelledby="contact-form-title">
            <div className="modal-heading"><div><h2 id="contact-form-title">{contactDraft.id ? "Update Contact" : "New Contact"}</h2></div><button aria-label="Close Contact" onClick={closeContactEditor}>×</button></div>
            <div className="sales-form-grid">
              <section className={`business-card-intake ${businessCardOcr.status}`}>
                <header><div><h3>Take A Picture. We’ll Fill The Contact.</h3></div><label className="business-card-capture"><input type="file" accept="image/*,.heic,.heif" capture="environment" onChange={(event) => { const file = event.target.files?.[0] || null; void scanBusinessCard(file); event.currentTarget.value = ""; }} /><b>{businessCardOcr.status === "scanning" ? "Reading Card…" : businessCardFile ? "Scan Another Card" : "Take Photo / Choose Image"}</b></label></header>
                {businessCardFile ? <div className="business-card-source"><span><b>ORIGINAL CARD</b>{businessCardFile.name}</span><button type="button" disabled={businessCardOcr.status === "scanning" || saving} onClick={() => { setBusinessCardFile(null); setBusinessCardOcr(blankBusinessCardOcr()); }}>Remove Card</button></div> : null}
                {businessCardOcr.status === "scanning" ? <div className="business-card-progress"><div><i style={{ width: `${businessCardOcr.percent}%` }} /></div><span>{businessCardOcr.label}</span><b>{businessCardOcr.percent}%</b></div> : null}
                {businessCardOcr.status === "ready" ? <div className="business-card-review"><div className="business-card-detected">{[
                  ["Name", [businessCardOcr.extracted.firstName, businessCardOcr.extracted.lastName].filter(Boolean).join(" ")],
                  ["Company", businessCardOcr.extracted.company],
                  ["Title", businessCardOcr.extracted.jobTitle],
                  ["Email", businessCardOcr.extracted.email],
                  ["Phone", businessCardOcr.extracted.phone],
                  ["Address", [businessCardOcr.extracted.address, businessCardOcr.extracted.city, businessCardOcr.extracted.state, businessCardOcr.extracted.postalCode].filter(Boolean).join(", ")],
                  ["Website", businessCardOcr.extracted.website],
                ].filter(([, value]) => Boolean(value)).map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}</div><label><input type="checkbox" checked={businessCardOcr.confirmed} onChange={(event) => setBusinessCardOcr((current) => ({ ...current, confirmed: event.target.checked }))} /><span>I checked the filled fields below against the original card. My edits—not the OCR—are the final contact record.</span></label><small>{businessCardOcr.extracted.confidence} · Original card will stay attached to this contact.</small></div> : null}
                {businessCardOcr.status === "error" ? <div className="business-card-error"><b>Automatic Reading Wasn’t Reliable</b><span>{businessCardOcr.label} The original can still be attached when you save.</span></div> : null}
              </section>
              <Field label="First Name"><input data-modal-initial-focus value={contactDraft.firstName} onChange={(event) => setContactDraft((current) => ({ ...current, firstName: event.target.value }))} /></Field>
              <Field label="Last Name"><input value={contactDraft.lastName} onChange={(event) => setContactDraft((current) => ({ ...current, lastName: event.target.value }))} /></Field>
              <Field label="Company Required" wide><div className="company-name-entry"><input list="sales-company-options" value={contactDraft.company} onChange={(event) => { setCompanyResolution(null); setContactDraft((current) => ({ ...current, company: event.target.value })); }} placeholder="Start typing the company name" /><datalist id="sales-company-options">{contactCompanies.map((company) => <option key={company} value={company} />)}</datalist>{companyMatches.length && !existingCompanyReused ? <section className={`company-match-guard ${separateCompanyConfirmed ? "resolved" : ""}`}><header><span>!</span><div><b>Possible Existing {companyMatches.length === 1 ? "Company" : "Companies"}</b><small>Reuse the company already in Command Center so contacts, opportunities, estimates, projects and marketing stay together.</small></div></header><div>{companyMatches.map((match) => <button type="button" key={match.company} onClick={() => { const original = contactDraft.company; setCompanyResolution({ input: original, canonical: match.company, decision: "Reuse Existing", score: match.score, reason: match.reason }); setContactDraft((current) => ({ ...current, company: match.company })); }}><span><b>Use {match.company}</b><small>{match.reason}</small></span><i>{match.score}% MATCH</i></button>)}</div><label><input type="checkbox" checked={separateCompanyConfirmed} onChange={(event) => setCompanyResolution(event.target.checked ? { input: contactDraft.company, canonical: companyMatches[0].company, decision: "Confirmed Separate", score: companyMatches[0].score, reason: "User confirmed a distinct legal or operating company after reviewing possible matches" } : null)} /><span>This is truly a different company—not another spelling, abbreviation, office, or legal suffix for the company above.</span></label></section> : companyResolution?.decision === "Reuse Existing" ? <div className="company-name-resolved"><b>✓ Existing Company Reused</b><span>{companyResolution.input} was linked to {companyResolution.canonical}.</span></div> : null}</div></Field>
              <Field label="Company Type"><select value={contactDraft.companyType} onChange={(event) => setContactDraft((current) => ({ ...current, companyType: event.target.value }))}>{companyTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Title / Position"><input value={contactDraft.jobTitle} onChange={(event) => setContactDraft((current) => ({ ...current, jobTitle: event.target.value }))} /></Field>
              <Field label="Salesperson"><select value={contactDraft.assignedRep} onChange={(event) => setContactDraft((current) => ({ ...current, assignedRep: event.target.value }))}><option value="">Select Salesperson</option>{contactDraft.assignedRep && !salespeople.some((person) => person.name === contactDraft.assignedRep) ? <option>{contactDraft.assignedRep}</option> : null}{salespeople.map((person) => <option key={person.email} value={person.name}>{person.name}</option>)}</select></Field>
              <Field label="Email"><input type="email" value={contactDraft.email} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} /></Field>
              <Field label="Phone"><input value={contactDraft.phone} onChange={(event) => setContactDraft((current) => ({ ...current, phone: event.target.value }))} /></Field>
              <Field label="Street Address" wide><input value={contactDraft.address} onChange={(event) => setContactDraft((current) => ({ ...current, address: event.target.value }))} /></Field>
              <Field label="City"><input value={contactDraft.city} onChange={(event) => setContactDraft((current) => ({ ...current, city: event.target.value }))} /></Field>
              <Field label="State"><input value={contactDraft.state} onChange={(event) => setContactDraft((current) => ({ ...current, state: event.target.value }))} /></Field>
              <Field label="ZIP / Postal Code"><input value={contactDraft.postalCode} onChange={(event) => setContactDraft((current) => ({ ...current, postalCode: event.target.value }))} /></Field>
              <Field label="Website"><input inputMode="url" value={contactDraft.website} onChange={(event) => setContactDraft((current) => ({ ...current, website: event.target.value }))} /></Field>
              <Field label="Lead Source"><select value={contactDraft.source} onChange={(event) => setContactDraft((current) => ({ ...current, source: event.target.value }))}>{leadSources.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Relationship Status"><select value={contactDraft.relationshipStatus} onChange={(event) => setContactDraft((current) => ({ ...current, relationshipStatus: event.target.value }))}><option>Active</option><option>Prospect</option><option>Inactive</option></select></Field>
              <Field label="Last Contact Date"><input type="date" value={contactDraft.lastContactDate} onChange={(event) => setContactDraft((current) => ({ ...current, lastContactDate: event.target.value }))} /></Field>
              <Field label="Next Follow-Up Date"><input type="date" value={contactDraft.nextFollowUpDate} onChange={(event) => setContactDraft((current) => ({ ...current, nextFollowUpDate: event.target.value }))} /></Field>
              <Field label="Relationship Notes" wide><textarea rows={4} value={contactDraft.notes} onChange={(event) => setContactDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
            </div>
            <div className="sales-modal-actions"><button className="secondary-action" onClick={closeContactEditor}>Cancel</button>{contactDraft.id && !returnContactToOpportunity ? <button className="secondary-action" disabled={saving} onClick={() => { const contact = contacts.find((item) => item.id === contactDraft.id); if (contact) openOpportunityFromContact(contact); }}>Create Opportunity From Contact →</button> : null}<button className="primary-action large" disabled={saving || companyMatchNeedsDecision || businessCardOcr.status === "scanning" || (businessCardOcr.status === "ready" && !businessCardOcr.confirmed)} onClick={() => void saveContact()}>{saving ? "Saving Contact..." : businessCardOcr.status === "scanning" ? "Reading Business Card..." : businessCardOcr.status === "ready" && !businessCardOcr.confirmed ? "Review Card Fields First" : companyMatchNeedsDecision ? "Resolve Company Match First" : returnContactToOpportunity ? "Save And Select Contact" : "Save Contact"}</button></div>
          </section>
        </FormModalLayer>
      ) : null}

      {opportunityOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpportunityOpen(false)}>
          <section id="opportunity-form-dialog" className="record-modal wide sales-modal opportunity-modal" role="dialog" aria-modal="true" aria-labelledby="opportunity-form-title">
            <div className="modal-heading"><div><h2 id="opportunity-form-title">{opportunityDraft.id ? opportunityDraft.projectName : "New Opportunity"}</h2></div><button aria-label="Close Opportunity" onClick={() => setOpportunityOpen(false)}>×</button></div>
            <div className="sales-form-grid">
              <Field label="Project / Opportunity Name" wide><input value={opportunityDraft.projectName} onChange={(event) => setOpportunityDraft((current) => ({ ...current, projectName: event.target.value }))} /></Field>
              <Field label="Sales Stage"><select value={opportunityDraft.stage} onChange={(event) => { const stage = event.target.value; setOpportunityDraft((current) => ({ ...current, stage, probability: String(stageProbabilities[stage] ?? current.probability), lostReason: stage === "Lost" ? current.lostReason : "" })); }}>{[...funnelStages, ...outcomeStages].map((stage) => <option key={stage} disabled={stage === "Estimating" && !opportunityDraft.estimatingRequestedAt}>{stage === "Estimating" && !opportunityDraft.estimatingRequestedAt ? "Estimating · Use Handoff Button" : stage}</option>)}</select></Field>
              <Field label="Forecast Probability"><div className="probability-input"><input type="number" min="0" max="100" step="1" value={opportunityDraft.probability} onChange={(event) => setOpportunityDraft((current) => ({ ...current, probability: String(Math.min(100, Math.max(0, Number(event.target.value) || 0))) }))} /><b>%</b></div></Field>
              <Field label={opportunityDraft.leadSource === "Public Bid" ? "Public Agency / Company" : "Primary Company"}>{opportunityDraft.leadSource === "Public Bid" ? <><input list="public-opportunity-agencies" value={opportunityDraft.company} onChange={event => setOpportunityCompany(event.target.value)} placeholder="Enter agency or company name" /><datalist id="public-opportunity-agencies">{contactCompanies.map(company => <option key={company} value={company} />)}</datalist></> : <select value={opportunityDraft.company} onChange={(event) => setOpportunityCompany(event.target.value)}><option value="">Select Company</option>{contactCompanies.map((company) => <option key={company}>{company}</option>)}</select>}</Field>
              <Field label={opportunityDraft.leadSource === "Public Bid" ? "Company Contact (Optional For Public Bid)" : "Company Contact"}><div className="opportunity-contact-select"><select value={opportunityResolvedContact?.id || ""} disabled={!opportunityDraft.company} onChange={(event) => { const selected = opportunityCompanyContacts.find((contact) => contact.id === event.target.value); const selectedData = selected ? contactData(selected) : null; const selectedLocation = contactLocation(selected); setOpportunityDraft((current) => ({ ...current, contactId: event.target.value, contactName: selected?.title || "", projectLocation: current.projectLocation || selectedLocation, assignedRep: selectedData?.assignedRep || current.assignedRep, leadSource: selectedData?.source || current.leadSource, lastContactDate: selectedData?.lastContactDate || current.lastContactDate, nextFollowUpDate: selectedData?.nextFollowUpDate || current.nextFollowUpDate })); }}><option value="">{opportunityDraft.company ? "Select Contact" : "Select Company First"}</option>{opportunityCompanyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.title} · {contactData(contact).jobTitle || "Contact"}</option>)}</select><button type="button" onClick={() => openContactEditor(undefined, true)}>＋ Add New Contact</button></div></Field>
              <Field label="Project Location" wide><input value={opportunityDraft.projectLocation} onChange={(event) => setOpportunityDraft((current) => ({ ...current, projectLocation: event.target.value }))} /></Field>
              <Field label="Project Type"><select value={opportunityDraft.projectType} onChange={(event) => setOpportunityDraft((current) => ({ ...current, projectType: event.target.value }))}>{projectTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Delivery Method"><select value={opportunityDraft.deliveryMethod} onChange={(event) => setOpportunityDraft((current) => ({ ...current, deliveryMethod: event.target.value }))}>{deliveryMethods.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Project Owner Contract Type"><select value={opportunityDraft.ownerContractType} onChange={(event) => setOpportunityDraft((current) => ({ ...current, ownerContractType: event.target.value as OwnerContractType }))}>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select></Field>
              <Field label="Lead Source"><select value={opportunityDraft.leadSource} onChange={(event) => setOpportunityDraft((current) => ({ ...current, leadSource: event.target.value }))}>{leadSources.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Salesperson"><select value={opportunityDraft.assignedRep} onChange={(event) => setOpportunityDraft((current) => ({ ...current, assignedRep: event.target.value }))}><option value="">Select Salesperson</option>{opportunityDraft.assignedRep && !salespeople.some((person) => person.name === opportunityDraft.assignedRep) ? <option>{opportunityDraft.assignedRep}</option> : null}{salespeople.map((person) => <option key={person.email} value={person.name}>{person.name}</option>)}</select></Field>
              <Field label="Estimated Contract Value"><CurrencyInput value={opportunityDraft.estimatedValue} onValueChange={(value) => setOpportunityDraft((current) => ({ ...current, estimatedValue: value }))} /></Field>
              <Field label="Assigned Estimator"><select value={opportunityDraft.assignedEstimator} onChange={(event) => setOpportunityDraft((current) => ({ ...current, assignedEstimator: event.target.value }))}><option value="">Select Before Estimating Handoff</option>{opportunityDraft.assignedEstimator && !estimators.some((person) => person.name === opportunityDraft.assignedEstimator) ? <option>{opportunityDraft.assignedEstimator}</option> : null}{estimators.map((person) => <option key={person.email} value={person.name}>{person.name}</option>)}</select></Field>
              <Field label="Bid Due Date"><input type="date" value={opportunityDraft.bidDueDate} onChange={(event) => setOpportunityDraft((current) => ({ ...current, bidDueDate: event.target.value }))} /></Field>
              <Field label="Expected Award Date"><input type="date" value={opportunityDraft.expectedAwardDate} onChange={(event) => setOpportunityDraft((current) => ({ ...current, expectedAwardDate: event.target.value }))} /></Field>
              <Field label="Last Contact Date"><input type="date" value={opportunityDraft.lastContactDate} onChange={(event) => setOpportunityDraft((current) => ({ ...current, lastContactDate: event.target.value }))} /></Field>
              <Field label="Next Follow-Up Date"><input type="date" value={opportunityDraft.nextFollowUpDate} onChange={(event) => setOpportunityDraft((current) => ({ ...current, nextFollowUpDate: event.target.value }))} /></Field>
              {opportunityDraft.stage === "Lost" ? <Field label="Lost Opportunity Reason"><select value={opportunityDraft.lostReason} onChange={(event) => setOpportunityDraft((current) => ({ ...current, lostReason: event.target.value }))}><option value="">Select Lost Reason</option>{lostReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></Field> : null}
              <Field label="Opportunity Notes And Next Steps" wide><textarea rows={5} value={opportunityDraft.notes} onChange={(event) => setOpportunityDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
            </div>
            {editingDirectEstimate ? <div className="estimating-handoff-status"><strong>Estimate-Originated Opportunity</strong><span>This connected funnel card was created from Estimating. A sole matching company contact is linked when saved; choose the correct contact when the company has more than one.</span></div> : opportunityDraft.estimatingRequestedAt ? <div className="estimating-handoff-status"><strong>Permanent Estimating Record</strong><span>This Project Is Locked In Estimating Until Won Or Lost. Its Estimate History And Files Remain Available For Company Reporting.</span></div> : opportunityReadyForEstimating ? <div className="estimating-handoff-status"><strong>Ready For Estimating</strong><span>All handoff fields are complete. Sending creates the permanent Estimating record.</span></div> : <div className="estimating-lock-warning"><strong>Sales Draft Can Be Saved Now</strong><span>Estimating remains blocked until: {opportunityHandoffMissing.join(", ")}.</span></div>}
            <div className="sales-modal-actions split"><button className="secondary-action" onClick={() => setOpportunityOpen(false)}>Cancel</button><span /><button className="secondary-action" disabled={saving} onClick={() => void saveOpportunity(false)}>{saving ? "Saving..." : opportunityReadyForEstimating ? "Save Opportunity" : "Save Sales Draft"}</button>{!opportunityDraft.estimatingRequestedAt && !["On Hold", "Lost", "Awarded"].includes(opportunityDraft.stage) ? <button className="primary-action large" disabled={saving || !opportunityReadyForEstimating} title={opportunityReadyForEstimating ? "Release this opportunity to Estimating" : `Complete before Estimating: ${opportunityHandoffMissing.join(", ")}`} onClick={() => void saveOpportunity(true)}>{opportunityReadyForEstimating ? "Send To Estimating →" : "Complete Handoff Fields"}</button> : null}</div>
          </section>
        </div>
      ) : null}

      {historyOpen ? <FormModalLayer onDismiss={() => setHistoryOpen(false)}>
        <section className="record-modal wide sales-modal" role="dialog" aria-modal="true" aria-labelledby="sales-history-title">
          <div className="modal-heading"><h2 id="sales-history-title">Opportunity History</h2><button aria-label="Close Opportunity History" onClick={() => setHistoryOpen(false)}>×</button></div>
          <label className="field-label">Status<select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>{["All Outcomes", ...outcomeStages].map((status) => <option key={status}>{status}</option>)}</select></label>
          <div className="sales-history-list">
            {opportunities.filter((record) => outcomeStages.includes(opportunityData(record).stage as (typeof outcomeStages)[number]) && (historyFilter === "All Outcomes" || opportunityData(record).stage === historyFilter)).map((record) => {
              const data = opportunityData(record);
              return <article key={record.id}><button onClick={() => { setHistoryOpen(false); openOpportunityEditor(record); }}><strong>{record.title}</strong><span>{data.company || data.contactName || "Client Pending"}</span><span>{data.stage} · {formatCurrency(salesOpportunityValue(record.data, record.status))}</span></button>{data.stage === "Awarded" && data.awardedProjectNumber && onProjectCreated ? <button className="secondary-action" onClick={() => { setHistoryOpen(false); onProjectCreated(data.awardedProjectNumber); }}>Open Production Project</button> : null}</article>;
            })}
          </div>
        </section>
      </FormModalLayer> : null}

      {directEstimateOpen ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDirectEstimateOpen(false)}>
          <section className="record-modal wide sales-modal" role="dialog" aria-modal="true" aria-labelledby="direct-estimate-form-title">
            <div className="modal-heading"><div><h2 id="direct-estimate-form-title">New Estimate</h2></div><button aria-label="Close New Estimate" onClick={() => setDirectEstimateOpen(false)}>×</button></div>
            <div className="sales-form-grid">
              <Field label="Project / Estimate Name" wide><input value={directEstimateDraft.projectName} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, projectName: event.target.value }))} /></Field>
              <Field label="Client / Company Optional" wide><div className="company-name-entry"><input list="direct-estimate-company-options" value={directEstimateDraft.company} onChange={(event) => { setDirectCompanyResolution(null); setDirectEstimateCompany(event.target.value); }} placeholder="Start typing the company name" /><datalist id="direct-estimate-company-options">{contactCompanies.map((company) => <option key={company} value={company} />)}</datalist>{directCompanyMatches.length && !directExistingReused ? <section className={`company-match-guard ${directSeparateConfirmed ? "resolved" : ""}`}><header><span>!</span><div><b>Possible Existing {directCompanyMatches.length === 1 ? "Company" : "Companies"}</b><small>Use the existing name so this estimate stays with the company’s contacts, pipeline and future projects.</small></div></header><div>{directCompanyMatches.map((match) => <button type="button" key={match.company} onClick={() => { const original = directEstimateDraft.company; setDirectCompanyResolution({ input: original, canonical: match.company, decision: "Reuse Existing", score: match.score, reason: match.reason }); setDirectEstimateCompany(match.company); }}><span><b>Use {match.company}</b><small>{match.reason}</small></span><i>{match.score}% MATCH</i></button>)}</div><label><input type="checkbox" checked={directSeparateConfirmed} onChange={(event) => setDirectCompanyResolution(event.target.checked ? { input: directEstimateDraft.company, canonical: directCompanyMatches[0].company, decision: "Confirmed Separate", score: directCompanyMatches[0].score, reason: "User confirmed a distinct company after reviewing possible matches" } : null)} /><span>This is truly a different company—not another spelling, abbreviation, office, or legal suffix.</span></label></section> : directCompanyResolution?.decision === "Reuse Existing" ? <div className="company-name-resolved"><b>✓ Existing Company Reused</b><span>{directCompanyResolution.input} was linked to {directCompanyResolution.canonical}.</span></div> : null}</div></Field>
              <Field label="Company Contact"><select value={directEstimateDraft.contactId} disabled={!directEstimateDraft.company || !directEstimateCompanyContacts.length} onChange={(event) => { const selected = directEstimateCompanyContacts.find((contact) => contact.id === event.target.value); setDirectEstimateDraft((current) => ({ ...current, contactId: selected?.id || "", contactName: selected?.title || "" })); }}><option value="">{!directEstimateDraft.company ? "Enter Company First" : directEstimateCompanyContacts.length ? "Select Contact" : "No Matching CRM Contact"}</option>{directEstimateCompanyContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.title} · {contactData(contact).jobTitle || "Contact"}</option>)}</select></Field>
              <Field label="Assigned Estimator"><select value={directEstimateDraft.assignedEstimator} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, assignedEstimator: event.target.value }))}><option value="">Select Estimator</option>{estimators.map((person) => <option key={person.email} value={person.name}>{person.name}</option>)}</select></Field>
              <Field label="Project Location" wide><input value={directEstimateDraft.projectLocation} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, projectLocation: event.target.value }))} /></Field>
              <Field label="Project Type"><select value={directEstimateDraft.projectType} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, projectType: event.target.value }))}>{projectTypes.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Delivery Method"><select value={directEstimateDraft.deliveryMethod} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, deliveryMethod: event.target.value }))}>{deliveryMethods.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Project Owner Contract Type"><select value={directEstimateDraft.ownerContractType} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, ownerContractType: event.target.value as OwnerContractType }))}>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select></Field>
              <Field label="Bid Due Date"><input type="date" value={directEstimateDraft.bidDueDate} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, bidDueDate: event.target.value }))} /></Field>
              <Field label="Estimated Contract Value Optional"><CurrencyInput value={directEstimateDraft.estimatedValue} onValueChange={(value) => setDirectEstimateDraft((current) => ({ ...current, estimatedValue: value }))} /></Field>
              <Field label="Estimate Notes" wide><textarea rows={5} value={directEstimateDraft.notes} onChange={(event) => setDirectEstimateDraft((current) => ({ ...current, notes: event.target.value }))} /></Field>
            </div>
            <div className="estimating-handoff-status"><strong>One Connected Record</strong><span>A sole matching company contact is linked automatically. When several contacts exist, choose the right one here; the field stays optional only when no CRM contact is available.</span></div>
            <div className="sales-modal-actions"><button className="secondary-action" onClick={() => setDirectEstimateOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || directCompanyNeedsDecision} onClick={() => void saveDirectEstimate()}>{saving ? "Creating Estimate..." : directCompanyNeedsDecision ? "Resolve Company Match First" : "Create Estimate"}</button></div>
          </section>
        </div>
      ) : null}

      {estimateDeleteTarget && actor.accessLevel === "Company Owner" ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEstimateDeleteTarget(null)}>
          <section className="record-modal project-reset-modal" role="dialog" aria-modal="true" aria-labelledby="estimate-delete-title">
            <div className="modal-heading"><div><h2 id="estimate-delete-title">Remove {estimateDeleteTarget.title}</h2></div><button aria-label="Close estimate deletion" onClick={() => setEstimateDeleteTarget(null)}>×</button></div>
            <div className="project-reset-warning"><strong>30-Day Recovery Protection</strong><p>Command Center first verifies an immutable recovery manifest, then hides the estimate, files, quotes, proposal drafts, design work, bid packages and Sales opportunity in Owner-controlled quarantine. No file is deleted during the cooling period. Any separately created project remains.</p>{estimateDeletePreview ? <small>{estimateDeletePreview.records.toLocaleString()} Related Records · {estimateDeletePreview.files.toLocaleString()} Files{estimateDeletePreview.linkedProjectNumber ? ` · Project ${estimateDeletePreview.linkedProjectNumber} Will Remain` : ""}</small> : <small>Calculating the complete deletion impact…</small>}</div>
            <label className="field-label">Type {estimateDeleteTarget.title} To Confirm<input autoFocus value={estimateDeleteConfirmation} onChange={(event) => setEstimateDeleteConfirmation(event.target.value)} placeholder={estimateDeleteTarget.title} /></label>
            {estimateDeleteError ? <div className="form-error">{estimateDeleteError}</div> : null}
            <div className="modal-actions"><button className="secondary-action" onClick={() => setEstimateDeleteTarget(null)}>Keep Estimate</button><button className="danger-action" disabled={estimateDeleteSaving || !estimateDeletePreview || estimateDeleteConfirmation !== estimateDeleteTarget.title} onClick={() => void deleteEstimatePermanently()}>{estimateDeleteSaving ? "Creating Recovery Snapshot..." : "Move Estimate To Quarantine"}</button></div>
          </section>
        </div>
      ) : null}

      {selectedEstimate ? (
        <EstimateProjectWorkspace
          record={selectedEstimate}
          actor={actor}
          onClose={() => setSelectedEstimateId("")}
          onRecordSaved={(updated) =>
            setRecords((current) =>
              current.map((item) =>
                item.id === updated.id
                  ? { ...updated, type: OPPORTUNITY_RECORD_TYPE }
                  : item,
              ),
            )
          }
          onProjectCreated={onProjectCreated}
        />
      ) : null}
    </div>
  );
}
