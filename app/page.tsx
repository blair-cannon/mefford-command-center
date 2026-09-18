"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { WorkSheet } from "xlsx";
import type { AccountingMode } from "./accounting-erp";
import {
  MEFFORD_COMPANY_DIRECTORY,
  eligibleCompanyMembers,
} from "./company-directory";
import { MEFFORD_MASTER_COST_CODES } from "./estimate-template";
import type { MyWorkItem } from "./my-work";
import { SystemMaintenanceGate } from "./system-maintenance-gate";
import { CommandAssistant } from "./command-assistant";
import { WorkspaceNavigation, WorkIcon } from "./workspace-navigation";
import { ProjectWorkspace } from "./project-workspace";
import { preferredWorkspace } from "../lib/project-workspace";
import { WorkspaceAccessibility } from "./workspace-accessibility";
import { useDailyLogDraft } from "./use-daily-log-draft";
import { authorizedShortcuts, type WorkTool } from "../lib/workspace-usability";
import { AutomationHeartbeat } from "./automation-heartbeat";
import type { AdminMode } from "./admin-command-workspace";
import { CurrencyInput } from "./currency-input";
import { parseSpreadsheetFile } from "./secure-spreadsheet-client";
import { DEPARTMENT_MEETING_ROLES, MEETING_TYPE_BY_TARGET } from "../lib/meetings";
import type { MobileMediaMarkup } from "./mobile-media-editor";
import type { MobileQuickAction } from "../lib/mobile-core.js";
import { canQueueOfflineAction } from "../lib/mobile-core.js";
import { clearOfflineMobileData, mobileDeviceId, queueOfflineMobileRecord, saveAssignedProjectSnapshot } from "../lib/mobile-client";
import { roundMoney } from "../lib/money";
import { readWorkspaceJson, WorkspaceRequestError } from "../lib/workspace-request";
import {
  SCHEDULE_QUALITY_CATEGORIES,
  scheduleQualityCategory,
} from "../lib/quality-control";
import type { ScheduleTemplate } from "../lib/schedule-templates";
import { analyzeConstructionSchedule } from "../lib/construction-schedule";
import { indexDrawingUpload } from "../lib/drawing-client";
import type { OwnerContractType } from "../lib/owner-contracts";
import { isContractedActiveProject } from "../lib/contracted-projects";
import { PHOTO_UPLOAD_ACCEPT, isPhotoUpload } from "../lib/photo-uploads";
import { SummaryDrilldownHost, openSummaryDrilldown, summaryDrilldownProps } from "./summary-drilldown";

const SalesEstimatingWorkspace = lazy(() => import("./sales-estimating").then((module) => ({ default: module.SalesEstimatingWorkspace })));
const ScheduleWorkspace = lazy(() => import("./schedule-workspace").then((module) => ({ default: module.ScheduleWorkspace })));
/* Schedule workspace control contract retained at the shell boundary for architecture verification:
Download Excel · Re-Upload Excel · Print Schedule · Schedule Import · Project Information · Subcontractors
record.data?.subcontractor || record.title · Is Not An Approved Subcontractor On · Duplicate Activity IDs Were Blocked
Scope Of Work · Start Date · Finish Date · className="schedule-print-sheet" · src="/mefford-logo.png" · Date Updated
Project #{project.number} · Required Quality Category
*/
const TeamAccessWorkspace = lazy(() => import("./team-access-workspace").then((module) => ({ default: module.TeamAccessWorkspace })));
const FullSubcontractPreview = lazy(() => import("./subcontract-preview").then((module) => ({ default: module.FullSubcontractPreview })));
const VendorPortal = lazy(() => import("./vendor-portal").then((module) => ({ default: module.VendorPortal })));
const ProjectOwnerPortal = lazy(() => import("./project-owner-portal").then((module) => ({ default: module.ProjectOwnerPortal })));
const MobileCommandCenter = lazy(() => import("./mobile-command").then((module) => ({ default: module.MobileCommandCenter })));
const MobileMediaEditor = lazy(() => import("./mobile-media-editor").then((module) => ({ default: module.MobileMediaEditor })));
const AccountingWorkspace = lazy(() => import("./accounting-erp").then((module) => ({ default: module.AccountingWorkspace })));
const EmployeeOnboardingWorkspace = lazy(() => import("./employee-onboarding").then((module) => ({ default: module.EmployeeOnboardingWorkspace })));
const EmployeePortalWorkspace = lazy(() => import("./employee-onboarding").then((module) => ({ default: module.EmployeePortalWorkspace })));
const DesignLifecycleWorkspace = lazy(() => import("./design-lifecycle").then((module) => ({ default: module.DesignLifecycleWorkspace })));
const ProjectCorrespondenceWorkspace = lazy(() => import("./project-correspondence").then((module) => ({ default: module.ProjectCorrespondenceWorkspace })));
const ProcurementWorkspace = lazy(() => import("./procurement-workspace").then((module) => ({ default: module.ProcurementWorkspace })));
const QualityControlWorkspace = lazy(() => import("./quality-control").then((module) => ({ default: module.QualityControlWorkspace })));
const ReviewWorkspace = lazy(() => import("./review-workspace").then((module) => ({ default: module.ReviewWorkspace })));
const ProjectHealthWorkspace = lazy(() => import("./project-health").then((module) => ({ default: module.ProjectHealthWorkspace })));
const CloseoutAutomationWorkspace = lazy(() => import("./closeout-automation").then((module) => ({ default: module.CloseoutAutomationWorkspace })));
const IntegrationHealthWorkspace = lazy(() => import("./integration-health").then((module) => ({ default: module.IntegrationHealthWorkspace })));
const OwnerContractWorkspace = lazy(() => import("./owner-contracts").then((module) => ({ default: module.OwnerContractWorkspace })));
const MeetingsCenter = lazy(() => import("./meetings-center").then((module) => ({ default: module.MeetingsCenter })));
const PurchaseOrderWorkspace = lazy(() => import("./purchase-orders").then((module) => ({ default: module.PurchaseOrderWorkspace })));
const SelectionsWorkspace = lazy(() => import("./selections-workspace").then((module) => ({ default: module.SelectionsWorkspace })));
const SafetyCommandWorkspace = lazy(() => import("./safety-command").then((module) => ({ default: module.SafetyCommandWorkspace })));
const CompanyCalendarWorkspace = lazy(() => import("./company-calendar").then((module) => ({ default: module.CompanyCalendarWorkspace })));
const MarketingWorkspace = lazy(() => import("./marketing-workspace").then((module) => ({ default: module.MarketingWorkspace })));
const PerformanceReviewsWorkspace = lazy(() => import("./performance-reviews-workspace").then((module) => ({ default: module.PerformanceReviewsWorkspace })));
const AssetTrackingWorkspace = lazy(() => import("./asset-tracking-workspace").then((module) => ({ default: module.AssetTrackingWorkspace })));
const AdminCommandWorkspace = lazy(() => import("./admin-command-workspace").then((module) => ({ default: module.AdminCommandWorkspace })));
const UserGuideWorkspace = lazy(() => import("./user-guide").then((module) => ({ default: module.UserGuideWorkspace })));
const CustomerSurveyRecipientControl = lazy(() => import("./customer-survey-recipient-control").then((module) => ({ default: module.CustomerSurveyRecipientControl })));
const RoleOperatingSystem = lazy(() => import("./role-operating-system").then((module) => ({ default: module.RoleOperatingSystem })));
const OwnerApprovalCenter = lazy(() => import("./owner-approval-center").then((module) => ({ default: module.OwnerApprovalCenter })));

const companyTimeZone = "America/New_York";
const projectManagerDirectory = eligibleCompanyMembers("Project Manager");
const superintendentDirectory = eligibleCompanyMembers("Superintendent");

function currentDateInput(
  timeZone = companyTimeZone,
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function currentTimeInput(timeZone = companyTimeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.hour}:${value.minute}`;
}

function currentDateHeading(timeZone = companyTimeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.weekday} ${value.month} ${value.day} ${value.year}`.toUpperCase();
}

function weatherConditionIcon(conditions: string) {
  const label = conditions.toLowerCase();
  if (label.includes("thunder")) return "⛈";
  if (label.includes("snow")) return "❄";
  if (label.includes("rain") || label.includes("drizzle")) return "☂";
  if (label.includes("cloud") || label.includes("overcast") || label.includes("fog")) return "☁";
  return "☀";
}

function numericDateFromInput(value: string) {
  if (!value) return "Not Set";
  const [year, month, day] = value.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function inputDateFromNumeric(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addCalendarDays(value: string, days: number) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Math.max(0, days)));
  return date.toISOString().slice(0, 10);
}

function displayTimeInput(value: string) {
  if (!value) return "Not Set";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, hour, minute));
}

function createClientId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function captureSubmissionLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAt: string;
  } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(position.coords.accuracy),
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 300_000, timeout: 5_000 },
    );
  });
}

function projectTimeZoneLabel(timeZone: string) {
  return (
    {
      "America/New_York": "Eastern Time",
      "America/Chicago": "Central Time",
      "America/Denver": "Mountain Time",
      "America/Los_Angeles": "Pacific Time",
    }[timeZone] || timeZone
  );
}

const navFolders = [
  {
    label: "Meetings",
    icon: "M",
    items: [
      { label: "Quarterly Rock/Review", target: "Quarterly Rock/Review", icon: "QR", company: true },
      { label: "Weekly L10", target: "Weekly L10", icon: "L10", company: true },
      { label: "Sales / Estimating", target: "Sales/Estimating Department", icon: "SE", company: true },
      { label: "Operations", target: "Operations Department", icon: "OPS", company: true },
      { label: "Accounting", target: "Accounting Department", icon: "AC", company: true },
      { label: "Sales → Estimating", target: "Sales To Estimating Turnover", icon: "SE", company: true },
      { label: "Award → Operations", target: "Estimating To Operations Turnover", icon: "TO", company: true },
      { label: "Owner Meetings", target: "Project Owner Meetings", icon: "OM" },
      { label: "Design Meetings", target: "Project Design Meetings", icon: "DM" },
      { label: "Subcontractor Meetings", target: "Project Subcontractor Meetings", icon: "SM" },
    ],
  },
  {
    label: "Project Management",
    icon: "P",
    items: [
      { label: "Budget", target: "Budget", icon: "$" },
      { label: "Project Owner Contract", target: "Contracts", icon: "OC" },
      { label: "Subcontracts", target: "Subcontracts", icon: "SC" },
      { label: "Change Orders", target: "Change Orders", icon: "CO" },
      { label: "Purchase Orders", target: "Purchase Orders", icon: "PO" },
      { label: "Procurement", target: "Procurement", icon: "PB" },
      { label: "Design & Drawings", target: "Design & Drawings", icon: "DD" },
      { label: "RFIs", target: "RFIs", icon: "RF" },
      { label: "Submittals", target: "Submittals", icon: "SU" },
      { label: "Schedule", target: "Schedule", icon: "GS" },
      { label: "Selections", target: "Selections", icon: "SE" },
      { label: "Closeout", target: "Closeout", icon: "CL" },
    ],
  },
  {
    label: "Site Management",
    icon: "S",
    items: [
      { label: "Daily Logs", target: "Daily Logs", icon: "DL" },
      { label: "Safety", target: "Safety", icon: "SF" },
      { label: "Quality", target: "Quality", icon: "QC" },
    ],
  },
];

const preconstructionNavGroups = [
  {
    label: "Sales",
    icon: "S",
    landing: "Sales Dashboard",
    items: [
      { label: "Sales Dashboard", target: "Sales Dashboard", icon: "SD" },
      { label: "Sales Funnel", target: "Sales Funnel", icon: "SF" },
      { label: "Sales Design", target: "Sales Design", icon: "DS" },
      { label: "Contacts", target: "Sales Contacts", icon: "CT" },
    ],
  },
  {
    label: "Estimating",
    icon: "E",
    landing: "Estimating",
    items: [
      { label: "Estimate Workspace", target: "Estimating", icon: "E" },
      { label: "Estimating Calendar", target: "Estimating Calendar", icon: "EC" },
      { label: "Bid Management", target: "Bid Management", icon: "PB" },
    ],
  },
  {
    label: "Marketing",
    icon: "MK",
    landing: "Marketing Social",
    items: [
      { label: "Social Campaigns", target: "Marketing Social", icon: "SC" },
      { label: "Email Campaigns", target: "Marketing Email", icon: "EM" },
      { label: "Customer Surveys", target: "Marketing Surveys", icon: "SV" },
      { label: "Marketing Calendar", target: "Marketing Calendar", icon: "MC" },
    ],
  },
];

const companyNavFolders = [
  {
    label: "Accounting",
    icon: "$",
    items: [
      { label: "Accounting Command", target: "Accounting Command", icon: "AC" },
      { label: "Chart Of Accounts", target: "Chart Of Accounts", icon: "COA" },
      { label: "General Ledger", target: "General Ledger", icon: "GL" },
      { label: "Fixed Assets", target: "Fixed Assets", icon: "FA" },
      { label: "Accounts Payable", target: "Accounts Payable", icon: "AP" },
      { label: "Lien Waivers", target: "Lien Waivers", icon: "LW" },
      { label: "Owner Billing", target: "Owner Billing", icon: "AR" },
      { label: "Cash Management", target: "Cash Management", icon: "CM" },
      { label: "Payroll Reports", target: "Payroll Reports", icon: "PR" },
      { label: "WIP And Close", target: "WIP And Close", icon: "WC" },
      { label: "Financial Reports", target: "Financial Reports", icon: "FR" },
      { label: "Accounting Administration", target: "Accounting Administration", icon: "AA" },
      { label: "Vendor Management", target: "Vendor Management", icon: "VM" },
    ],
  },
  {
    label: "Admin",
    icon: "A",
    items: [
      { label: "Admin Command", target: "Admin Command", icon: "A" },
      { label: "Goal Setting", target: "Admin Goals", icon: "GS" },
      { label: "HR & Benefits", target: "Admin People", icon: "HR" },
      { label: "Employee Requests", target: "Admin Requests", icon: "ER" },
      { label: "Template Review", target: "Admin Templates", icon: "TR" },
      { label: "Team & Access", target: "Admin Access", icon: "TA" },
      { label: "Company Operations", target: "Admin Operations", icon: "CO" },
    ],
  },
];

const accountingNavigationTargets: AccountingMode[] = [
  "Accounting Command",
  "Chart Of Accounts",
  "General Ledger",
  "Fixed Assets",
  "Accounts Payable",
  "Lien Waivers",
  "Owner Billing",
  "Cash Management",
  "Payroll Reports",
  "WIP And Close",
  "Financial Reports",
  "Accounting Administration",
  "Vendor Management",
];

const adminModeByTarget: Record<string, AdminMode> = {
  "Admin Command": "command",
  "Admin Goals": "goals",
  "Admin People": "people",
  "Admin Requests": "requests",
  "Admin Templates": "templates",
  "Admin Access": "access",
  "Admin Operations": "operations",
};

const adminNavigationTargets = Object.keys(adminModeByTarget);

function navigationGlyph(target: string, fallback: string) {
  return <WorkIcon target={target || fallback} />;
}

function sectionTitle(target: string) {
  if (target === "Project Overview") return "Project Workspace";
  if (target === "Documents") return "Project Files";
  if (target === "Dashboard") return "Company Dashboard";
  if (target === "Contracts") return "Project Owner Contract";
  if (target === "Marketing Social") return "Social Campaigns";
  if (target === "Marketing Email") return "Email Campaigns";
  if (target === "Marketing Surveys") return "Customer Surveys";
  return target;
}

const modules = [
  { title: "Schedule", detail: "Start Project Schedule", icon: "GS", tone: "blue" },
  { title: "Daily Log", detail: "No Logs Yet", icon: "DL", tone: "orange" },
  { title: "Toolbox Talk", detail: "No Talks Yet", icon: "TT", tone: "blue" },
  { title: "RFIs", detail: "No RFIs Yet", icon: "RF", tone: "red" },
  {
    title: "Submittals",
    detail: "No Submittals Yet",
    icon: "SU",
    tone: "purple",
  },
  {
    title: "Change Orders",
    detail: "No Change Orders Yet",
    icon: "CO",
    tone: "green",
  },
  { title: "Budget", detail: "No Project Codes Selected", icon: "$", tone: "orange" },
  { title: "Project Files", detail: "No Project Files Yet", icon: "PF", tone: "gray" },
];

const attention: Array<{
  type: string;
  number: string;
  title: string;
  due: string;
  owner: string;
  urgent: boolean;
}> = [];

type CommandNotification = MyWorkItem;

const startingCommandNotifications: CommandNotification[] = [];

const safetyTopics = [
  {
    category: "Heat safety",
    title: "Hydration, rest, and recognizing heat illness",
  },
  { category: "Ladder safety", title: "Portable ladder pre-use inspection" },
  {
    category: "Excavation",
    title: "Competent-person responsibilities at excavations",
  },
  {
    category: "Electrical",
    title: "Extension cords, GFCIs, and jobsite electrical hazards",
  },
];

type RecordItem = {
  id: string;
  type?: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  recordTime?: string;
  dateLocked?: boolean;
  dateAudit?: string[];
  auditHistory?: string[];
  persistent?: boolean;
  data?: Record<string, unknown>;
};

type CorrectionField =
  | "Date And Time"
  | "Title Or Description"
  | "Responsible Person"
  | "Details";

function isFinalRecordStatus(status: string) {
  return ["Final", "Complete", "Approved", "Executed"].includes(status);
}

const storedRecordLabels: Record<string, string> = {
  amendsRecordId: "Original Record",
  sourceRecordId: "Amendment Source",
  amendmentNumber: "Amendment Number",
  amendmentReason: "Amendment Explanation",
  originalStatus: "Original Record Status",
  createdBy: "Created By",
  createdAt: "Created At",
  notes: "Notes",
  weather: "Weather",
  weatherSnapshot: "Daily Weather",
  employeesOnSite: "Mefford Employees On Site",
  subcontractorsOnSite: "Subcontractors On Site",
  incidentReported: "Incident Reported",
  incidentDetails: "Incident Details",
  toolboxAttendees: "Toolbox Talk Attendees",
  signedAttendees: "Digitally Signed By",
  photos: "Stored Photos",
};

function storedRecordValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") {
    const weather = value as Record<string, unknown>;
    if (weather.schemaVersion === "DAILY-WEATHER-1") {
      return `Rainfall ${weather.rainfallInches} in · Avg Temp ${weather.averageTemperatureF}°F · Avg Wind ${weather.averageWindSpeedMph} mph · ${weather.averageConditions}`;
    }
    return JSON.stringify(value);
  }
  return String(value ?? "Not Entered");
}

const workspaceCopy: Record<
  string,
  { description: string; button: string; prefix: string; noun: string }
> = {
  Schedule: {
    description:
      "Project activities, dependencies, durations, and milestone tracking.",
    button: "New Schedule Activity",
    prefix: "ACT",
    noun: "Activity name",
  },
  "Daily Logs": {
    description:
      "Field reports, manpower, conditions, work completed, and jobsite notes.",
    button: "New Daily Log",
    prefix: "DL",
    noun: "Work summary",
  },
  "Toolbox Talks": {
    description:
      "Safety topics, attendance, acknowledgments, and signed records.",
    button: "New Toolbox Talk",
    prefix: "TT",
    noun: "Toolbox talk topic",
  },
  RFIs: {
    description: "Questions, responses, responsible parties, and due dates.",
    button: "New RFI",
    prefix: "RFI",
    noun: "Question or clarification",
  },
  Submittals: {
    description: "Packages, reviews, revisions, and approval status.",
    button: "New Submittal",
    prefix: "SUB",
    noun: "Submittal description",
  },
  "Change Orders": {
    description:
      "Field change requests, pricing, project-manager approval, and contract impact.",
    button: "New Change Request",
    prefix: "PCO",
    noun: "Change description",
  },
  Contracts: {
    description:
      "Prime contracts, exhibits, approvals, and executed documents.",
    button: "New Contract",
    prefix: "CON",
    noun: "Contract title",
  },
  "Owner Contract": {
    description:
      "Owner agreements, exhibits, approvals, amendments, and executed documents.",
    button: "New Owner Contract",
    prefix: "CON",
    noun: "Owner contract title",
  },
  Subcontracts: {
    description:
      "Subcontractor scopes, values, insurance, and executed agreements.",
    button: "New Subcontract",
    prefix: "SC",
    noun: "Subcontractor and scope",
  },
  "Purchase Orders": {
    description:
      "Vendor commitments, purchase terms, delivery dates, approvals, and executed orders.",
    button: "New Purchase Order",
    prefix: "PO",
    noun: "Vendor and purchase description",
  },
  "Owner Meetings": {
    description:
      "Owner agendas, meeting minutes, decisions, commitments, and follow-up items.",
    button: "New Owner Meeting",
    prefix: "OM",
    noun: "Owner meeting title",
  },
  "Design Meetings": {
    description:
      "Design coordination agendas, decisions, open questions, and assigned action items.",
    button: "New Design Meeting",
    prefix: "DM",
    noun: "Design meeting title",
  },
  "Sub Meetings": {
    description:
      "Subcontractor coordination agendas, minutes, commitments, and upcoming work.",
    button: "New Sub Meeting",
    prefix: "SM",
    noun: "Subcontractor meeting title",
  },
  Selections: {
    description:
      "Owner and design selections, responsible parties, required dates, and approval status.",
    button: "New Selection",
    prefix: "SEL",
    noun: "Selection description",
  },
  Documents: {
    description: "Plans, specifications, revisions, photos, and project files.",
    button: "Upload Document",
    prefix: "DOC",
    noun: "Document name",
  },
  Closeout: {
    description:
      "Warranties, operations manuals, testing records, and project turnover.",
    button: "Upload Closeout File",
    prefix: "CLS",
    noun: "Closeout document",
  },
  Team: {
    description:
      "Employees, project roles, contact information, and access permissions.",
    button: "Add Team Member",
    prefix: "EMP",
    noun: "Employee name",
  },
};

type ProjectFile = {
  id?: number;
  name: string;
  category: string;
  revision: string;
  uploadedBy: string;
  contentType?: string;
  createdAt?: string;
  date: string;
  size: string;
  access: string;
  stored?: boolean;
};

function dailyLogIdForPhoto(photo: ProjectFile) {
  return photo.revision.match(/\bDL-\d+\b/i)?.[0].toUpperCase() ?? "";
}

const MAX_PROJECT_FILE_BYTES = 1024 * 1024 * 1024;
const DIRECT_UPLOAD_BYTES = 25 * 1024 * 1024;

const fileCategories = [
  "All files",
  "Awarded Estimate",
  "Drawings",
  "Specifications",
  "Contracts",
  "Financial Info",
  "Financial Info / Change Orders",
  "Photos",
  "Safety",
  "Correspondence",
  "Change Orders",
  "Subcontractor Inbox",
];
function DocumentsWorkspace({
  project,
  changeOrders,
  awardedEstimates,
  actor,
}: {
  project: ProjectProfile;
  changeOrders: RecordItem[];
  awardedEstimates: RecordItem[];
  actor: CommandSessionActor;
}) {
  const [category, setCategory] = useState("All files");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ProjectFile[]>([]);
  const [fileNotice, setFileNotice] = useState("");
  const canAccessBidArchive =
    ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
    actor.designations.includes("Estimator") ||
    actor.designations.includes("Sales Representative");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files?projectId=${encodeURIComponent(project.number)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Project storage is unavailable");
        return (await response.json()) as { files?: ProjectFile[] };
      })
      .then((data) => {
        if (cancelled || !data.files?.length) return;
        setFiles((current) => [
          ...data.files!,
          ...current.filter(
            (existing) =>
              !data.files!.some((stored) => stored.name === existing.name),
          ),
        ]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.number]);
  useEffect(() => {
    if (!canAccessBidArchive) return;
    let cancelled = false;
    fetch("/api/files?projectId=MEFFORD-BID-ARCHIVE")
      .then(async (response) => {
        if (!response.ok) throw new Error("Bid archive storage is unavailable");
        return (await response.json()) as { files?: ProjectFile[] };
      })
      .then((data) => {
        if (!cancelled) setArchiveFiles(data.files ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canAccessBidArchive]);
  const executedChangeOrderFiles: ProjectFile[] = changeOrders
    .filter((record) => record.status === "Executed")
    .map((record) => ({
      name: `${record.id} Executed.pdf`,
      category: "Financial Info / Change Orders",
      revision: `Executed · ${changeOrderData(record).ownerSignatureMethod || "Owner Signed"}`,
      uploadedBy: changeOrderData(record).ownerSignatureName || project.ownerName,
      date: record.due,
      size: "Generated Record",
      access: "PM + office",
      stored: true,
    }));
  const awardedEstimateRecords: ProjectFile[] = awardedEstimates.map((record) => ({
    name: `${record.title} · Live Record`,
    category: "Awarded Estimate",
    revision: record.meta || "Final Approved Estimate",
    uploadedBy: record.owner,
    date: record.due,
    size: "Permanent Record",
    access: "PM + office",
  }));
  const allFiles = [
    ...files,
    ...awardedEstimateRecords,
    ...executedChangeOrderFiles.filter(
      (executed) => !files.some((file) => file.name === executed.name),
    ),
  ];
  const visible =
    category === "Bid Archive"
      ? archiveFiles
      : category === "All files"
      ? allFiles
      : category === "Awarded Estimate"
        ? allFiles.filter((file) => file.category.startsWith("Awarded Estimate"))
        : allFiles.filter((file) => file.category === category);
  const categoryOptions = canAccessBidArchive
    ? [...fileCategories, "Bid Archive"]
    : fileCategories;
  const archiveYears = Array.from(
    new Set(archiveFiles.map((file) => file.category.split(" / ")[0]).filter(Boolean)),
  ).sort((left, right) => right.localeCompare(left));
  const pendingGuestFiles = allFiles.filter(
    (file) =>
      file.category === "Subcontractor Inbox" &&
      file.revision.includes("Awaiting PM"),
  );

  async function addFiles(selected: FileList | null) {
    if (!selected?.length) return;
    const targetCategory = category === "All files" ? "Drawings" : category;
    const access =
      targetCategory.startsWith("Financial Info") || targetCategory === "Contracts"
        ? "PM + office"
        : targetCategory === "Subcontractor Inbox"
          ? "View · download · revise"
          : "Project team";
    setFileNotice(`Saving ${selected.length} File${selected.length === 1 ? "" : "s"} Permanently...`);
    try {
      const additions = await uploadProjectFiles(
        Array.from(selected),
        targetCategory,
        "New Upload",
        access,
      );
      setFiles((current) => [...additions, ...current]);
      setFileNotice(
        `${additions.length} File${additions.length === 1 ? "" : "s"} Saved Permanently To ${project.name}.`,
      );
    } catch (error) {
      setFileNotice(
        error instanceof Error
          ? error.message
          : "The files could not be saved permanently.",
      );
    }
    window.setTimeout(() => setFileNotice(""), 3600);
  }

  async function addGuestRevision(selected: FileList | null) {
    if (!selected?.length) return;
    setFileNotice("Saving Subcontractor Revision Permanently...");
    try {
      const additions = await uploadProjectFiles(
        Array.from(selected),
        "Subcontractor Inbox",
        "Awaiting PM Acceptance",
        "View · download · revise",
      );
      setFiles((current) => [...additions, ...current]);
      setFileNotice(
        `${additions.length} Revision${additions.length === 1 ? "" : "s"} Saved Permanently. ${project.projectManager || "The Project Manager"} And ${project.superintendent || "The Superintendent"} Were Notified.`,
      );
    } catch (error) {
      setFileNotice(
        error instanceof Error
          ? error.message
          : "The revision could not be saved permanently.",
      );
    }
    window.setTimeout(() => setFileNotice(""), 3600);
  }

  function acceptNextGuestFile() {
    const nextFile = pendingGuestFiles[0];
    if (!nextFile) return;
    setFiles((current) =>
      current.map((file) =>
        file === nextFile
          ? { ...file, revision: "Accepted by PM · Today" }
          : file,
      ),
    );
    setFileNotice(
      `${nextFile.name} accepted by the Project Manager. The Superintendent was notified of the approval.`,
    );
    window.setTimeout(() => setFileNotice(""), 3000);
  }

  function openFile(file: ProjectFile) {
    if (file.id && file.stored) {
      window.open(`/api/files?id=${file.id}`, "_blank", "noopener,noreferrer");
      setFileNotice(`${file.name} Opened From Permanent Project Storage.`);
      window.setTimeout(() => setFileNotice(""), 3000);
      return;
    }
    setFileNotice(
      file.category === "Subcontractor Inbox"
        ? `${file.name} opened in the assigned folder. It can be viewed, downloaded, or revised—but not deleted.`
        : `${file.name} opened in read-only preview.`,
    );
    window.setTimeout(() => setFileNotice(""), 3000);
  }

  async function uploadProjectFiles(
    selected: File[],
    targetCategory: string,
    revision: string,
    access: string,
  ) {
    const uploaded: ProjectFile[] = [];
    for (const file of selected) {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        throw new Error(`${file.name} Exceeds The 1 GB Individual File Limit.`);
      }
      if (file.size <= DIRECT_UPLOAD_BYTES) {
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", project.number);
        form.set("category", targetCategory);
        form.set("revision", revision);
        form.set("access", access);
        const response = await fetch("/api/files", { method: "POST", body: form });
        const data = (await response.json()) as {
          file?: ProjectFile;
          error?: string;
        };
        if (!response.ok || !data.file) {
          throw new Error(data.error || `${file.name} Could Not Be Saved.`);
        }
        await indexDrawingUpload(file, data.file, project.number, targetCategory, revision, (percent, label) =>
          setFileNotice(`Indexing ${file.name} · ${percent}% · ${label}`),
        );
        uploaded.push(data.file);
        continue;
      }
      const stored = await uploadLargeProjectFile(
          file,
          targetCategory,
          revision,
          access,
          (percent) =>
            setFileNotice(
              `Saving ${file.name} Permanently · ${percent}% Complete`,
            ),
          project.number,
        );
      await indexDrawingUpload(file, stored, project.number, targetCategory, revision, (percent, label) =>
        setFileNotice(`Indexing ${file.name} · ${percent}% · ${label}`),
      );
      uploaded.push(stored);
    }
    return uploaded;
  }

  return (
    <div className="module-workspace documents-workspace">
      <section className="workspace-heading">
        <div>
          <p className="eyebrow orange-text">{project.name}</p>
          <h1>Project Files</h1>

        </div>
        <div className="upload-control">
          <label className="primary-action large upload-button">
            <input
              aria-label="Upload project files"
              type="file"
              multiple
              onChange={(event) => void addFiles(event.target.files)}
            />
            ＋ Upload Files
          </label>
          <small className="upload-limit-note">
            Individual Files Up To 1 GB · Large Drawings Upload In Secure Parts
          </small>
        </div>
      </section>
      {fileNotice ? <div className="inline-success">{fileNotice}</div> : null}
      <section className="file-category-grid">
        {categoryOptions.map((name) => (
          <button
            key={name}
            className={category === name ? "active" : ""}
            onClick={() => setCategory(name)}
          >
            <span>
              {name === "All files"
                ? "ALL"
                : name === "Subcontractor Inbox"
                  ? "IN"
                  : name.slice(0, 2).toUpperCase()}
            </span>
            <strong>{name}</strong>
            <small>
              {name === "All files"
                ? allFiles.length
                : name === "Bid Archive"
                  ? archiveFiles.length
                  : name === "Awarded Estimate"
                    ? allFiles.filter((file) => file.category.startsWith("Awarded Estimate")).length
                    : allFiles.filter((file) => file.category === name).length}{" "}
              files
            </small>
            {name.startsWith("Financial Info") || name === "Contracts" ? (
              <i>Restricted</i>
            ) : name === "Subcontractor Inbox" ? (
              <i>Guest area</i>
            ) : null}
          </button>
        ))}
      </section>
      {category === "Subcontractor Inbox" ? (
        <section className="guest-folder-banner">
          <div>
            <p className="eyebrow orange-text">ASSIGNED SUBCONTRACTOR AREA</p>
            <strong>View, download, and upload revisions</strong>
            <span>
              Guests can work only with files shared in this assigned folder.
              Revision history is retained.
            </span>
          </div>
          <div className="guest-rights">
            <span>✓ View</span>
            <span>✓ Download</span>
            <span>✓ Revise</span>
            <span className="blocked">× Delete</span>
          </div>
          <label className="secondary-action revision-upload">
            <input
              aria-label="Upload subcontractor revision"
              type="file"
              multiple
              onChange={(event) => void addGuestRevision(event.target.files)}
            />
            Upload revision
          </label>
        </section>
      ) : null}
      {category === "Subcontractor Inbox" ? (
        <section className="guest-review-strip">
          <div>
            <span className="review-count">{pendingGuestFiles.length}</span>
            <span>
              <strong>Pending PM acceptance</strong>
              <small>
                Only the assigned Project Manager can accept. The Superintendent
                can view status.
              </small>
            </span>
          </div>
          <div className="notification-recipients">
            <span>
              <i>PM</i>
              <b>{project.projectManager || "Project Manager Not Assigned"}</b>
              <small>Project Manager · approval</small>
            </span>
            <span>
              <i>SI</i>
              <b>{project.superintendent || "Superintendent Not Assigned"}</b>
              <small>Superintendent · notified</small>
            </span>
          </div>
          <button
            className="primary-action"
            disabled={!pendingGuestFiles.length}
            onClick={acceptNextGuestFile}
          >
            {pendingGuestFiles.length ? "Accept Next File" : "Queue Clear"}
          </button>
        </section>
      ) : null}
      {category === "Bid Archive" ? (
        <section className="bid-archive-folders">
          <div className="bid-archive-heading">
            <div><h2>Lost Estimates By Year</h2></div>
            <strong>{archiveFiles.length} Archived File{archiveFiles.length === 1 ? "" : "s"}</strong>
          </div>
          {archiveYears.map((year) => {
            const yearFiles = archiveFiles.filter((file) => file.category.startsWith(`${year} / `));
            const projects = Array.from(new Set(yearFiles.map((file) => file.category.split(" / ")[1]).filter(Boolean)));
            return <details key={year} open><summary><span>▸</span><strong>{year}</strong><small>{projects.length} Bid{projects.length === 1 ? "" : "s"}</small></summary>{projects.map((projectFolder) => <div className="bid-archive-project" key={projectFolder}><div><span>📁</span><strong>{projectFolder}</strong></div>{yearFiles.filter((file) => file.category.split(" / ")[1] === projectFolder).map((file) => <button key={file.id || `${file.name}-${file.category}`} onClick={() => openFile(file)}><span>DOC</span><span><strong>{file.name}</strong><small>{file.category.split(" / ").slice(2).join(" / ")} · {file.revision}</small></span><b>Open ↗</b></button>)}</div>)}</details>;
          })}
          {!archiveYears.length ? <div className="sales-empty"><span>✓</span><strong>No Lost Bid Files Yet</strong><p>When An Estimated Opportunity Is Marked Lost Its Files Will Move Here Automatically.</p></div> : null}
        </section>
      ) : null}
      <section className="records-panel file-panel" data-reflow-table="">
        <div className="file-toolbar">
          <div>
            <strong>{category}</strong>
            <span>{visible.length} project files</span>
          </div>
          <label>
            Sort by{" "}
            <select>
              <option>Newest first</option>
              <option>Filename</option>
              <option>Category</option>
            </select>
          </label>
        </div>
        <div className="file-head" data-reflow-head="medium">
          <span>File</span>
          <span>Category</span>
          <span>Revision</span>
          <span>Uploaded</span>
          <span>Access</span>
          <span />
        </div>
        {visible.map((file, index) => (
          <button
            className="file-row"
            key={`${file.name}-${index}`}
            onClick={() => openFile(file)}
           data-reflow-row="medium">
            <span className="file-name" data-label="File">
              <i>
                {file.name.toLowerCase().endsWith(".xlsx")
                  ? "XLS"
                  : file.name.toLowerCase().endsWith(".zip")
                    ? "ZIP"
                    : "PDF"}
              </i>
              <span>
                <strong>{file.name}</strong>
                <small>
                  {file.size}
                  {file.stored ? " · Stored Permanently" : ""}
                </small>
              </span>
            </span>
            <span data-label="Category">{file.category}</span>
            <span data-label="Revision">{file.revision}</span>
            <span data-label="Uploaded">
              {file.uploadedBy}
              <small>{file.date}</small>
            </span>
            <span
              className={
                file.access.includes("PM")
                  ? "restricted-access"
                  : file.category === "Subcontractor Inbox"
                    ? "limited-access"
                    : ""
              }
             data-label="Access">
              {file.access}
            </span>
            <span data-label="Actions">{file.category === "Subcontractor Inbox" ? "↗" : "⋮"}</span>
          </button>
        ))}
      </section>

    </div>
  );
}

async function uploadLargeProjectFile(
  file: File,
  category: string,
  revision: string,
  access: string,
  reportProgress: (percent: number) => void,
  projectId = "26-001",
) {
  let storageKey = "";
  let uploadId = "";
  try {
    const createResponse = await fetch("/api/files/multipart?action=create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: file.name,
        category,
        revision,
        access,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    const created = (await createResponse.json()) as {
      storageKey?: string;
      uploadId?: string;
      partSize?: number;
      error?: string;
    };
    if (!createResponse.ok || !created.storageKey || !created.uploadId) {
      throw new Error(created.error || `${file.name} Could Not Begin Uploading.`);
    }
    storageKey = created.storageKey;
    uploadId = created.uploadId;
    const partSize = Math.min(
      DIRECT_UPLOAD_BYTES,
      Math.max(5 * 1024 * 1024, Number(created.partSize) || DIRECT_UPLOAD_BYTES),
    );
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / partSize);
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const start = index * partSize;
      const body = file.slice(start, Math.min(start + partSize, file.size));
      const search = new URLSearchParams({
        projectId,
        storageKey,
        uploadId,
        partNumber: String(partNumber),
      });
      const partResponse = await fetch(`/api/files/multipart?${search}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
      const part = (await partResponse.json()) as {
        partNumber?: number;
        etag?: string;
        error?: string;
      };
      if (!partResponse.ok || !part.partNumber || !part.etag) {
        throw new Error(
          part.error || `${file.name} Stopped While Uploading Part ${partNumber}.`,
        );
      }
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      reportProgress(Math.round((partNumber / totalParts) * 95));
    }
    const completeResponse = await fetch(
      "/api/files/multipart?action=complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: file.name,
          category,
          revision,
          access,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          storageKey,
          uploadId,
          parts,
        }),
      },
    );
    const completed = (await completeResponse.json()) as {
      file?: ProjectFile;
      error?: string;
    };
    if (!completeResponse.ok || !completed.file) {
      throw new Error(completed.error || `${file.name} Could Not Be Completed.`);
    }
    reportProgress(100);
    return completed.file;
  } catch (error) {
    if (storageKey && uploadId) {
      try {
        await fetch("/api/files/multipart", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, storageKey, uploadId }),
        });
      } catch {
        // R2 automatically removes any unfinished multipart upload after seven days.
      }
    }
    throw error;
  }
}

function seedBudgetRecord(
  code: string,
  division: string,
  description: string,
  originalBudget: number,
  committedCost: number,
  actualCost: number,
  approvedChanges = 0,
  selectedForProject = false,
): RecordItem {
  const data: BudgetCodeData = {
    code,
    division,
    description,
    originalBudget,
    approvedChanges,
    committedCost,
    actualCost,
    forecastCost: Math.max(committedCost, actualCost) + approvedChanges,
    source: "Company Master",
    selectedForProject,
  };
  return {
    id: code,
    title: description,
    owner: "Company Master",
    due: "8/10/2026",
    status: "Active",
    meta: `${division} · Company Master`,
    data,
  };
}

const budgetSeedValues: Record<
  string,
  {
    originalBudget: number;
    committedCost: number;
    actualCost: number;
    approvedChanges?: number;
  }
> = {};

const initialSelectedCostCodes = new Set<string>();

const initialBudgetRecords: RecordItem[] = MEFFORD_MASTER_COST_CODES.filter(
  (masterCode) => masterCode.budgetable,
).map((masterCode) => {
    const values = budgetSeedValues[masterCode.code] ?? {
      originalBudget: 0,
      committedCost: 0,
      actualCost: 0,
      approvedChanges: 0,
    };
    return seedBudgetRecord(
      masterCode.code,
      `${masterCode.categoryCode} - ${masterCode.category}`,
      masterCode.description,
      values.originalBudget,
      values.committedCost,
      values.actualCost,
      values.approvedChanges ?? 0,
      initialSelectedCostCodes.has(masterCode.code),
    );
});

const legacyCostCodeMap: Record<string, string> = {
  "00-1000": "0141.26",
  "01-0000": "0131.10",
  "02-0000": "3100.00",
  "03-0000": "0300.00",
  "05-0000": "0512.00",
  "06-0000": "0611.00",
  "07-0000": "0730.00",
  "08-0000": "0813.00",
  "09-0000": "0991.00",
  "22-0000": "2200.00",
  "23-0000": "2300.00",
  "26-0000": "2600.00",
};

function canonicalProjectCostCode(code: string) {
  return legacyCostCodeMap[code] || code;
}

function createCleanProjectRecords(): Record<string, RecordItem[]> {
  return {
    "Daily Logs": [],
    "Toolbox Talks": [],
    RFIs: [],
    Submittals: [],
    Budget: initialBudgetRecords.map((record) => ({
      ...record,
      data: { ...record.data },
    })),
    "Budget Control": [],
    "Change Orders": [],
    Contracts: [],
    Subcontracts: [],
    "Purchase Orders": [],
    "Owner Meetings": [],
    "Design Meetings": [],
    "Sub Meetings": [],
    Selections: [],
    Documents: [],
    Schedule: [],
    Team: [],
  };
}

function ModuleWorkspace({
  name,
  projectName,
  records,
  onAdd,
  onOpen,
  onUseTopic,
}: {
  name: string;
  projectName: string;
  records: RecordItem[];
  onAdd: () => void;
  onOpen: (record: RecordItem) => void;
  onUseTopic?: (title: string) => void;
}) {
  const copy = workspaceCopy[name];
  const [query, setQuery] = useState("");
  const attentionRecords = records.filter((record) =>
    ["Open", "Pending", "Overdue", "Due today", "In review", "Pricing", "Scheduled"].includes(record.status),
  );
  const completeRecords = records.filter((record) =>
    ["Final", "Complete", "Approved", "Executed", "Current", "Active"].includes(record.status),
  );
  const drilldownRows = (items: RecordItem[]) => items.map((record) => ({
    id: record.id,
    title: record.title,
    subtitle: `${record.owner} · ${record.due}`,
    status: record.status,
    meta: record.meta,
    onOpen: () => onOpen(record),
    openLabel: "Open Record →",
  }));
  const visibleRecords = records.filter((record) =>
    `${record.id} ${record.title} ${record.owner} ${record.status} ${record.meta}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="module-workspace">
      <section className="workspace-heading">
        <div>
          <p className="eyebrow orange-text">{projectName}</p>
          <h1>{name}</h1>

        </div>
        <button className="primary-action large" onClick={onAdd}>
          ＋ {copy.button}
        </button>
      </section>
      <section className="module-summary">
        <article {...summaryDrilldownProps({ title: `${name} · All Records`, rows: drilldownRows(records) })}>
          <strong>{records.length}</strong>
          <span>Total records</span>
        </article>
        <article {...summaryDrilldownProps({ title: `${name} · Records Needing Attention`, rows: drilldownRows(attentionRecords) })}>
          <strong>{attentionRecords.length}</strong>
          <span>Need attention</span>
        </article>
        <article {...summaryDrilldownProps({ title: `${name} · Complete Or Current Records`, rows: drilldownRows(completeRecords) })}>
          <strong>{completeRecords.length}</strong>
          <span>Complete/current</span>
        </article>
      </section>
      {name === "Toolbox Talks" ? (
        <section className="toolbox-source">
          <div className="source-heading">
            <div>

              <h2>Suggested toolbox talks</h2>

            </div>
            <a
              href="https://oshatraining.com/more-osha-training-resources/toolbox-talks-for-osha-safety-and-health/"
              target="_blank"
              rel="noreferrer"
            >
              Browse source ↗
            </a>
          </div>
          <div className="topic-grid">
            {safetyTopics.map((topic) => (
              <button
                key={topic.title}
                onClick={() => onUseTopic?.(topic.title)}
              >
                <span>{topic.category}</span>
                <strong>{topic.title}</strong>
                <small>Use this topic →</small>
              </button>
            ))}
          </div>
          <p className="source-note">
            Command Center links to the source material and records Mefford
            attendance and signatures. Automated PDF importing will require
            confirmed reuse permission or a supported feed.
          </p>
        </section>
      ) : null}
      <section className="records-panel" data-reflow-table="">
        <div className="records-tools">
          <label>
            <span>⌕</span>
            <input
              aria-label={`Search ${name}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${name.toLowerCase()}...`}
            />
          </label>
          <button onClick={() => setQuery("Open")}>Open items</button>
          <button onClick={() => setQuery("")}>Clear</button>
        </div>
        <div className="record-head" data-reflow-head="medium">
          <span>Record</span>
          <span>Title / details</span>
          <span>Responsible</span>
          <span>Due / issued</span>
          <span>Status</span>
          <span />
        </div>
        {visibleRecords.map((record) => (
          <button
            className="record-row"
            key={record.id}
            onClick={() => onOpen(record)}
           data-reflow-row="medium">
            <span className="record-id" data-label="Record">{record.id}</span>
            <span className="record-title" data-label="Title / details">
              <strong>{record.title}</strong>
              <small>{record.meta}</small>
            </span>
            <span data-label="Responsible">{record.owner}</span>
            <span className="record-date-cell" data-label="Due / issued">
              {record.due}
              {record.dateLocked || isFinalRecordStatus(record.status) ? (
                <small>🔒 Date Locked</small>
              ) : null}
            </span>
            <span data-label="Status">
              <i
                className={`status-badge ${record.status.toLowerCase().replaceAll(" ", "-")}`}
              >
                {record.status}
              </i>
            </span>
            <span data-label="Actions">›</span>
          </button>
        ))}
        {visibleRecords.length === 0 ? (
          <div className="empty-records">
            <strong>No matching records</strong>
            <span>Clear the search or create a new record.</span>
          </div>
        ) : null}
      </section>
      {name === "Team" ? (
        null
      ) : null}
      {name === "Daily Logs" ? (
        null
      ) : null}
      {name === "Change Orders" ? (
        null
      ) : null}
      {name === "Toolbox Talks" ? (
        null
      ) : null}
      {name === "RFIs" ? (
        null
      ) : null}
    </div>
  );
}

type BudgetCodeData = {
  code: string;
  division: string;
  description: string;
  originalBudget: number;
  approvedChanges: number;
  committedCost: number;
  actualCost: number;
  forecastCost: number;
  source: "Company Master" | "Project Addition";
  selectedForProject: boolean;
};

const BUDGET_CONTROL_ID = "BUDGET-CONTROL";
const excludedProfitCostCodes = new Set([
  "0135.00",
  "0143.00",
  "0143.12",
  "0143.15",
]);

type BudgetControlData = {
  locked: boolean;
  lockedBy: string;
  lockedAt: string;
};

function budgetControlData(record?: RecordItem): BudgetControlData {
  return {
    locked: record?.data?.locked === true,
    lockedBy: String(record?.data?.lockedBy || ""),
    lockedAt: String(record?.data?.lockedAt || ""),
  };
}

function isExcludedProfitCostCode(record: RecordItem) {
  const data = budgetCodeData(record);
  return (
    excludedProfitCostCodes.has(data.code) ||
    /(^|\b)(technology fee|development fee|overhead\s*&?\s*profit|buy\s*out\s*\(profit\))/i.test(
      data.description,
    )
  );
}

function budgetCodeData(record?: RecordItem): BudgetCodeData {
  const data = record?.data ?? {};
  const source =
    data.source === "Project Addition" ? "Project Addition" : "Company Master";
  const hasProjectValue =
    Number(data.originalBudget || 0) !== 0 ||
    Number(data.approvedChanges || 0) !== 0 ||
    Number(data.committedCost || 0) !== 0 ||
    Number(data.actualCost || 0) !== 0;
  return {
    code: String(data.code || record?.id || ""),
    division: String(data.division || "Unassigned"),
    description: String(data.description || record?.title || ""),
    originalBudget: Number(data.originalBudget || 0),
    approvedChanges: Number(data.approvedChanges || 0),
    committedCost: Number(data.committedCost || 0),
    actualCost: Number(data.actualCost || 0),
    forecastCost: Number(data.forecastCost || 0),
    source,
    selectedForProject:
      source === "Project Addition" ||
      data.selectedForProject === true ||
      (data.selectedForProject !== false && hasProjectValue),
  };
}

function selectedBudgetRecords(records: RecordItem[]) {
  return records.filter(
    (record) =>
      budgetCodeData(record).selectedForProject &&
      !isExcludedProfitCostCode(record),
  );
}

function normalizeRecordCostCodes(record: RecordItem) {
  if (!record.data || !Array.isArray(record.data.pricingLines)) return record;
  return {
    ...record,
    data: {
      ...record.data,
      pricingLines: record.data.pricingLines.map((pricingLine) => {
        if (!pricingLine || typeof pricingLine !== "object") return pricingLine;
        const line = pricingLine as Record<string, unknown>;
        return {
          ...line,
          costCode: canonicalProjectCostCode(String(line.costCode || "")),
        };
      }),
    },
  };
}

function mergeBudgetRecordsWithMaster(savedRecords: RecordItem[]) {
  const merged = new Map(
    initialBudgetRecords.map((record) => [record.id, record]),
  );
  for (const savedRecord of savedRecords) {
    const savedData = budgetCodeData(savedRecord);
    const canonicalCode = canonicalProjectCostCode(savedData.code);
    const masterRecord = merged.get(canonicalCode);
    if (masterRecord && savedData.source === "Company Master") {
      const masterData = budgetCodeData(masterRecord);
      merged.set(canonicalCode, {
        ...masterRecord,
        ...savedRecord,
        id: canonicalCode,
        title: masterData.description,
        meta: `${masterData.division} · Company Master`,
        data: {
          ...savedData,
          code: canonicalCode,
          division: masterData.division,
          description: masterData.description,
          source: "Company Master",
        },
        persistent: true,
      });
      continue;
    }
    merged.set(canonicalCode, {
      ...savedRecord,
      id: canonicalCode,
      data: { ...savedData, code: canonicalCode },
      persistent: true,
    });
  }
  return [...merged.values()]
    .filter((record) => !isExcludedProfitCostCode(record))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function BudgetCostCodeOptions({ records }: { records: RecordItem[] }) {
  const groups = new Map<string, RecordItem[]>();
  for (const record of records.filter(
    (item) => !isExcludedProfitCostCode(item),
  )) {
    const division = budgetCodeData(record).division;
    groups.set(division, [...(groups.get(division) ?? []), record]);
  }
  return (
    <>
      {[...groups.entries()].map(([division, divisionRecords]) => (
        <optgroup key={division} label={division}>
          {divisionRecords
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((budgetRecord) => {
              const data = budgetCodeData(budgetRecord);
              return (
                <option key={budgetRecord.id} value={data.code}>
                  {data.code} · {data.description}
                </option>
              );
            })}
        </optgroup>
      ))}
    </>
  );
}

function BudgetWorkspace({
  project,
  records,
  onRecordsChange,
  controlRecord,
  onControlChange,
  currentActorName,
  accessLevel,
  canViewFinancials,
}: {
  project: ProjectProfile;
  records: RecordItem[];
  onRecordsChange: (next: RecordItem[]) => void;
  controlRecord?: RecordItem;
  onControlChange: (next: RecordItem) => void;
  currentActorName: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  canViewFinancials: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Cost Categories");
  const [adding, setAdding] = useState(false);
  const [masterPickerOpen, setMasterPickerOpen] = useState(false);
  const [masterManagerOpen, setMasterManagerOpen] = useState(false);
  const [masterQuery, setMasterQuery] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [managerDivision, setManagerDivision] = useState("");
  const [managerDescription, setManagerDescription] = useState("");
  const [managerEditingCode, setManagerEditingCode] = useState("");
  const [code, setCode] = useState("");
  const [division, setDivision] = useState("");
  const [description, setDescription] = useState("");
  const [originalBudget, setOriginalBudget] = useState("");
  const [selectedMasterCodes, setSelectedMasterCodes] = useState<string[]>([]);
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      selectedBudgetRecords(records).map((record) => [
        record.id,
        String(budgetCodeData(record).originalBudget || ""),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const canManageMaster = ["Company Owner", "Administrator"].includes(
    accessLevel,
  );
  const control = budgetControlData(controlRecord);
  const isLocked = control.locked;
  const projectRecords = selectedBudgetRecords(records);
  const visible = projectRecords.filter((record) => {
    const data = budgetCodeData(record);
    const matchesSearch = `${data.code} ${data.division} ${data.description}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesCategory =
      categoryFilter === "All Cost Categories" ||
      data.division === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  const categories = Array.from(
    new Set(projectRecords.map((record) => budgetCodeData(record).division)),
  ).sort((a, b) => a.localeCompare(b));

  const projectAdditionCount = projectRecords.filter(
    (record) => budgetCodeData(record).source === "Project Addition",
  ).length;
  const unselectedMasterRecords = records.filter((record) => {
    const data = budgetCodeData(record);
    return (
      data.source === "Company Master" &&
      !isExcludedProfitCostCode(record) &&
      !data.selectedForProject &&
      `${data.code} ${data.division} ${data.description}`
        .toLowerCase()
        .includes(masterQuery.toLowerCase())
    );
  });
  const masterManagerRecords = records.filter((record) => {
    const data = budgetCodeData(record);
    return (
      data.source === "Company Master" &&
      !isExcludedProfitCostCode(record) &&
      `${data.code} ${data.division} ${data.description}`
        .toLowerCase()
        .includes(masterQuery.toLowerCase())
    );
  });
  const totals = projectRecords.reduce(
    (summary, record) => {
      const data = budgetCodeData(record);
      summary.original += data.originalBudget;
      summary.changes += data.approvedChanges;
      summary.current += data.originalBudget + data.approvedChanges;
      summary.committed += data.committedCost;
      summary.actual += data.actualCost;
      summary.forecast += data.forecastCost;
      return summary;
    },
    { original: 0, changes: 0, current: 0, committed: 0, actual: 0, forecast: 0 },
  );
  const draftOriginalTotal = projectRecords.reduce(
    (total, record) =>
      total +
      Number(
        budgetDraft[record.id] ?? budgetCodeData(record).originalBudget ?? 0,
      ),
    0,
  );
  const displayedOriginalTotal = isLocked ? totals.original : draftOriginalTotal;
  const originalContractValue = Number(project.contractAmount || 0);
  const grossProfit = originalContractValue - displayedOriginalTotal;
  const grossMargin = originalContractValue
    ? (grossProfit / originalContractValue) * 100
    : 0;
  const hasOriginalBudget = displayedOriginalTotal > 0;

  function toggleMasterCode(codeValue: string) {
    setSelectedMasterCodes((current) =>
      current.includes(codeValue)
        ? current.filter((item) => item !== codeValue)
        : [...current, codeValue],
    );
  }

  async function persistOriginalBudgetDraft() {
    const nextRecords = records.map((record) => {
      if (!budgetCodeData(record).selectedForProject) return record;
      const currentData = budgetCodeData(record);
      const nextOriginal = Math.max(
        0,
        roundMoney(budgetDraft[record.id] ?? currentData.originalBudget ?? 0),
      );
      if (nextOriginal === currentData.originalBudget) return record;
      return {
        ...record,
        data: {
          ...currentData,
          originalBudget: nextOriginal,
          forecastCost:
            currentData.forecastCost === 0 ||
            currentData.forecastCost === currentData.originalBudget
              ? nextOriginal
              : currentData.forecastCost,
        },
        meta: `${currentData.division} · Original Budget Updated`,
        persistent: true,
      };
    });
    const changedRecords = nextRecords.filter(
      (record, index) => record !== records[index],
    );
    await Promise.all(
      changedRecords.map((record) =>
        persistCommandRecord(project.number, "Budget", record),
      ),
    );
    onRecordsChange(nextRecords);
    return nextRecords;
  }

  async function saveOriginalBudget() {
    if (isLocked) {
      setNotice("Unlock The Original Budget Before Making Changes.");
      return;
    }
    if (!projectRecords.length) {
      setNotice("Select At Least One Cost Code Before Saving The Original Budget.");
      return;
    }
    setSaving(true);
    try {
      await persistOriginalBudgetDraft();
      setNotice(`The ${project.name} Original Budget Was Saved Permanently.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Original Budget Could Not Be Saved.",
      );
    }
    setSaving(false);
  }

  async function lockOriginalBudget() {
    if (!projectRecords.length || draftOriginalTotal <= 0) {
      setNotice(
        "Select Cost Codes And Enter A Positive Original Budget Before Locking It.",
      );
      return;
    }
    setSaving(true);
    try {
      await persistOriginalBudgetDraft();
      const lockedAt = `${numericDateFromInput(currentDateInput(project.timeZone))} · ${displayTimeInput(currentTimeInput(project.timeZone))}`;
      const nextControl: RecordItem = {
        id: BUDGET_CONTROL_ID,
        title: `${project.name} Original Budget`,
        owner: currentActorName,
        due: numericDateFromInput(currentDateInput(project.timeZone)),
        status: "Locked",
        meta: `Locked By ${currentActorName} · ${lockedAt}`,
        data: { locked: true, lockedBy: currentActorName, lockedAt },
        dateLocked: true,
        auditHistory: [
          ...(controlRecord?.auditHistory ?? []),
          `Original Budget Locked By ${currentActorName} · ${lockedAt}`,
        ],
        persistent: true,
      };
      await persistCommandRecord(project.number, "Budget Control", nextControl);
      onControlChange(nextControl);
      setNotice(
        "Original Budget Locked! Subcontracts And Change Orders Are Now Available.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Original Budget Could Not Be Locked.",
      );
    }
    setSaving(false);
  }

  async function unlockOriginalBudget() {
    if (!canManageMaster) {
      setNotice("A Company Owner Or Administrator Must Unlock The Original Budget.");
      return;
    }
    setSaving(true);
    const unlockedAt = `${numericDateFromInput(currentDateInput(project.timeZone))} · ${displayTimeInput(currentTimeInput(project.timeZone))}`;
    const nextControl: RecordItem = {
      ...(controlRecord ?? {
        id: BUDGET_CONTROL_ID,
        title: `${project.name} Original Budget`,
        owner: currentActorName,
        due: numericDateFromInput(currentDateInput(project.timeZone)),
        meta: "",
      }),
      status: "Unlocked",
      owner: currentActorName,
      meta: `Unlocked By ${currentActorName} · ${unlockedAt}`,
      data: { locked: false, lockedBy: "", lockedAt: "" },
      dateLocked: false,
      auditHistory: [
        ...(controlRecord?.auditHistory ?? []),
        `Original Budget Unlocked By ${currentActorName} · ${unlockedAt}`,
      ],
      persistent: true,
    };
    try {
      await persistCommandRecord(project.number, "Budget Control", nextControl);
      onControlChange(nextControl);
      setNotice(
        "Original Budget Unlocked. Subcontracts And Change Orders Are Paused Until It Is Locked Again.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Original Budget Could Not Be Unlocked.",
      );
    }
    setSaving(false);
  }

  async function addSelectedMasterCodesToProject() {
    if (isLocked) {
      setNotice("Unlock The Original Budget Before Adding Cost Codes.");
      return;
    }
    const selectedRecords = records.filter((record) =>
      selectedMasterCodes.includes(record.id),
    );
    if (!selectedRecords.length) {
      setNotice("Select One Or More Master Cost Codes Before Accepting Them.");
      return;
    }
    const projectRecordsToAdd = selectedRecords.map((masterRecord) => {
      const data = {
        ...budgetCodeData(masterRecord),
        selectedForProject: true,
      };
      return {
        ...masterRecord,
        data,
        meta: `${data.division} · Company Master · Selected For ${project.name}`,
        persistent: true,
      } as RecordItem;
    });
    setSaving(true);
    try {
      await Promise.all(
        projectRecordsToAdd.map((record) =>
          persistCommandRecord(project.number, "Budget", record),
        ),
      );
      const additions = new Map(
        projectRecordsToAdd.map((record) => [record.id, record]),
      );
      onRecordsChange(
        records
          .map((record) =>
            additions.get(record.id) ?? record,
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      setMasterPickerOpen(false);
      setMasterQuery("");
      setSelectedMasterCodes([]);
      setNotice(
        `${projectRecordsToAdd.length} Cost Code${projectRecordsToAdd.length === 1 ? "" : "s"} Added To The ${project.name} Original Budget.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Master Cost Code Could Not Be Added To This Project.",
      );
    }
    setSaving(false);
  }

  function startMasterEdit(record?: RecordItem) {
    const data = record ? budgetCodeData(record) : null;
    setManagerEditingCode(data?.code || "");
    setManagerCode(data?.code || "");
    setManagerDivision(data?.division || "");
    setManagerDescription(data?.description || "");
  }

  async function saveMasterCostCode() {
    if (!managerCode.trim() || !managerDivision.trim() || !managerDescription.trim()) {
      setNotice("Add The Master Code Category And Description Before Saving.");
      return;
    }
    if (
      !managerEditingCode &&
      records.some((record) => record.id === managerCode.trim())
    ) {
      setNotice("That Cost Code Already Exists In The Company Master List.");
      return;
    }
    const existing = records.find((record) => record.id === managerEditingCode);
    const existingData = budgetCodeData(existing);
    const data: BudgetCodeData = {
      ...existingData,
      code: managerCode.trim(),
      division: managerDivision.trim(),
      description: managerDescription.trim(),
      source: "Company Master",
      selectedForProject: existing?.data
        ? existingData.selectedForProject
        : false,
    };
    const masterRecord: RecordItem = {
      id: data.code,
      title: data.description,
      owner: "Company Administration",
      due: numericDateFromInput(currentDateInput(project.timeZone)),
      status: "Active",
      meta: `${data.division} · Company Master`,
      data,
      persistent: true,
    };
    setSaving(true);
    try {
      await persistCommandRecord(
        "MEFFORD-COMPANY",
        "Master Cost Codes",
        masterRecord,
      );
      if (data.selectedForProject) {
        await persistCommandRecord(project.number, "Budget", masterRecord);
      }
      const next = existing
        ? records.map((record) =>
            record.id === existing.id ? masterRecord : record,
          )
        : [...records, masterRecord];
      onRecordsChange(next.sort((a, b) => a.id.localeCompare(b.id)));
      startMasterEdit();
      setNotice(
        `${masterRecord.id} Saved In The Mefford Company Master Cost Code List.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Company Master Cost Code Could Not Be Saved.",
      );
    }
    setSaving(false);
  }

  async function addProjectCostCode() {
    if (isLocked) {
      setNotice("Unlock The Original Budget Before Adding A Project Cost Code.");
      return;
    }
    if (!code.trim() || !description.trim()) {
      setNotice("Add The Cost Code And Description Before Saving.");
      return;
    }
    if (records.some((record) => budgetCodeData(record).code === code.trim())) {
      setNotice("That Cost Code Already Exists In This Project Budget.");
      return;
    }
    const data: BudgetCodeData = {
      code: code.trim(),
      division: division.trim() || "Project Addition",
      description: description.trim(),
      originalBudget: roundMoney(originalBudget),
      approvedChanges: 0,
      committedCost: 0,
      actualCost: 0,
      forecastCost: roundMoney(originalBudget),
      source: "Project Addition",
      selectedForProject: true,
    };
    const record: RecordItem = {
      id: data.code,
      title: data.description,
      owner: project.projectManager,
      due: numericDateFromInput(currentDateInput(project.timeZone)),
      status: "Active",
      meta: `${data.division} · Project Addition`,
      data,
      persistent: true,
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Budget", record);
      onRecordsChange([...records, record].sort((a, b) => a.id.localeCompare(b.id)));
      setAdding(false);
      setCode("");
      setDivision("");
      setDescription("");
      setOriginalBudget("");
      setNotice(`${record.id} Added To The ${project.name} Budget. The Company Master List Was Not Changed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Cost Code Could Not Be Saved.");
    }
    setSaving(false);
  }

  if (!canViewFinancials) {
    return (
      <div className="module-workspace budget-workspace">
        <section className="workspace-heading">
          <div>
            <p className="eyebrow orange-text">{project.name.toUpperCase()} · RESTRICTED FINANCIAL AREA</p>
            <h1>Budget</h1>

          </div>
        </section>
        <section className="financial-access-restricted">
          <span>LOCKED</span>
          <div>
            <h2>Financial Access Required</h2>

          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="module-workspace budget-workspace">
      <section className="workspace-heading">
        <div><p className="eyebrow orange-text">{project.name.toUpperCase()} · PROJECT COST CONTROL</p><h1>Budget</h1></div>
        <div className="workspace-heading-actions">
          {canManageMaster ? <button className="secondary-action" onClick={() => setMasterManagerOpen(true)}>Manage Master Cost Codes</button> : null}
          <button className="secondary-action" disabled={isLocked} onClick={() => setAdding(true)}>＋ Add Project-Only Code</button>
          <button className="primary-action large" disabled={isLocked} onClick={() => setMasterPickerOpen(true)}>＋ Add Cost Codes</button>
        </div>
      </section>
      {notice ? <div className="inline-success">{notice}</div> : null}
      <section className={`budget-lock-banner ${isLocked ? "locked" : "unlocked"}`}>
        <span>{isLocked ? "LOCKED" : "SETUP"}</span>
        <div>
          <strong>{isLocked ? "Original Budget Is Locked" : "Original Budget Setup Required"}</strong>
          <small>
            {isLocked
              ? `Locked By ${control.lockedBy || "An Authorized User"}${control.lockedAt ? ` · ${control.lockedAt}` : ""}`
              : "Select Cost Codes Enter The Original Budget And Lock It Before Creating Subcontracts Or Change Orders."}
          </small>
        </div>
        <div className="budget-lock-actions">
          {!isLocked ? <button className="secondary-action" disabled={saving || !projectRecords.length} onClick={saveOriginalBudget}>{saving ? "Saving..." : "Save Original Budget"}</button> : null}
          {!isLocked ? <button className="primary-action" disabled={saving || !projectRecords.length || draftOriginalTotal <= 0} onClick={lockOriginalBudget}>Lock Original Budget</button> : null}
          {isLocked && canManageMaster ? <button className="secondary-action" disabled={saving} onClick={unlockOriginalBudget}>Unlock Original Budget</button> : null}
          {isLocked && !canManageMaster ? <small>Owner Or Administrator Unlock Required</small> : null}
        </div>
      </section>

      <section className="budget-margin-grid">
        <article {...summaryDrilldownProps({ title: "Original Contract Value", rows: [{ id: project.number, title: project.name, subtitle: "Original owner contract", value: formatCurrency(originalContractValue), status: project.status }] })}><span>Original Contract Value</span><strong>{formatCurrency(originalContractValue)}</strong></article>
        <article {...summaryDrilldownProps({ title: "Original Budget By Cost Code", rows: projectRecords.map((record) => { const data = budgetCodeData(record); return { id: record.id, title: data.description, subtitle: data.division, value: formatCurrency(isLocked ? data.originalBudget : Number(budgetDraft[record.id] ?? data.originalBudget)), status: isLocked ? "Locked" : "Draft" }; }) })}><span>Original Budget</span><strong>{formatCurrency(displayedOriginalTotal)}</strong></article>
        <article {...summaryDrilldownProps({ title: "Gross Profit Calculation", rows: [{ id: project.number, title: project.name, subtitle: `${formatCurrency(originalContractValue)} contract − ${formatCurrency(displayedOriginalTotal)} budget`, value: hasOriginalBudget ? formatCurrency(grossProfit) : "Not Set", status: hasOriginalBudget ? "Calculated" : "Budget Not Set" }] })}><span>Gross Profit</span><strong className={hasOriginalBudget ? (grossProfit < 0 ? "negative" : "positive") : ""}>{hasOriginalBudget ? formatCurrency(grossProfit) : "Not Set"}</strong></article>
        <article {...summaryDrilldownProps({ title: "Gross Margin Calculation", rows: [{ id: project.number, title: project.name, subtitle: "Gross profit ÷ original contract value", value: hasOriginalBudget ? `${grossMargin.toFixed(1)}%` : "Not Set", status: hasOriginalBudget ? "Calculated" : "Budget Not Set" }] })}><span>Gross Margin</span><strong className={hasOriginalBudget ? (grossMargin < 0 ? "negative" : "positive") : ""}>{hasOriginalBudget ? `${grossMargin.toFixed(1)}%` : "Not Set"}</strong></article>
      </section>
      <section className="budget-summary-grid">
        <article {...summaryDrilldownProps({ title: "Approved Budget Changes By Cost Code", rows: projectRecords.filter((record) => budgetCodeData(record).approvedChanges !== 0).map((record) => { const data = budgetCodeData(record); return { id: record.id, title: data.description, subtitle: data.division, value: formatCurrency(data.approvedChanges), status: "Approved" }; }) })}><span>Approved Changes</span><strong>{formatCurrency(totals.changes)}</strong></article>
        <article {...summaryDrilldownProps({ title: "Current Budget By Cost Code", rows: projectRecords.map((record) => { const data = budgetCodeData(record); return { id: record.id, title: data.description, subtitle: data.division, value: formatCurrency((isLocked ? data.originalBudget : Number(budgetDraft[record.id] ?? data.originalBudget)) + data.approvedChanges), status: "Current" }; }) })}><span>Current Budget</span><strong>{formatCurrency(displayedOriginalTotal + totals.changes)}</strong></article>
        <article {...summaryDrilldownProps({ title: "Committed Cost By Cost Code", rows: projectRecords.filter((record) => budgetCodeData(record).committedCost !== 0).map((record) => { const data = budgetCodeData(record); return { id: record.id, title: data.description, subtitle: data.division, value: formatCurrency(data.committedCost), status: "Committed" }; }) })}><span>Committed</span><strong>{formatCurrency(totals.committed)}</strong></article>
        <article {...summaryDrilldownProps({ title: "Actual Cost By Cost Code", rows: projectRecords.filter((record) => budgetCodeData(record).actualCost !== 0).map((record) => { const data = budgetCodeData(record); return { id: record.id, title: data.description, subtitle: data.division, value: formatCurrency(data.actualCost), status: "Posted" }; }) })}><span>Actual Cost</span><strong>{formatCurrency(totals.actual)}</strong></article>
      </section>
      <div className="budget-filters"><label className="budget-search"><span>⌕</span><input aria-label="Search Project Cost Codes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Selected Project Codes..." /></label><label className="budget-category-filter"><span>Cost Category</span><select aria-label="Filter By Cost Category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All Cost Categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><span className="budget-visible-count">Showing {visible.length} Of {projectRecords.length} Project Codes · {projectAdditionCount} Project-Only</span></div>
      <section className="budget-table" data-reflow-table="">
        <div className="budget-row budget-head" data-reflow-head="wide"><span>Cost Code</span><span>Cost Category / Description</span><span>Original Budget</span><span>Approved Changes</span><span>Current Budget</span><span>Committed</span><span>Forecast</span></div>
        {visible.map((record) => {
          const data = budgetCodeData(record);
          const draftAmount = Number(budgetDraft[record.id] ?? data.originalBudget);
          return <div className="budget-row" key={record.id} data-reflow-row="wide"><strong data-label="Cost Code">{data.code}</strong><span data-label="Cost Category / Description"><b>{data.description}</b><small>{data.division} · {data.source}</small></span><span data-label="Original Budget">{isLocked ? formatCurrency(data.originalBudget) : <CurrencyInput className="budget-amount-input" aria-label={`${data.code} Original Budget`} min="0" value={budgetDraft[record.id] ?? ""} onValueChange={(value) => setBudgetDraft((current) => ({ ...current, [record.id]: value }))} placeholder="0.00" />}</span><span className={data.approvedChanges < 0 ? "negative" : data.approvedChanges > 0 ? "positive" : ""} data-label="Approved Changes">{formatCurrency(data.approvedChanges)}</span><strong data-label="Current Budget">{formatCurrency(draftAmount + data.approvedChanges)}</strong><span data-label="Committed">{formatCurrency(data.committedCost)}</span><span data-label="Forecast">{formatCurrency(data.forecastCost)}</span></div>;
        })}
      </section>
      {adding ? <div className="modal-layer" role="presentation"><section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="new-cost-code-title"><div className="modal-heading"><div><p className="eyebrow orange-text">{project.number} · PROJECT BUDGET</p><h2 id="new-cost-code-title">Add Project Cost Code</h2></div><button aria-label="Close Cost Code Form" onClick={() => setAdding(false)}>×</button></div><div className="field-grid"><label className="field-label">Cost Code<input autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="Example: 3212.16" /></label><label className="field-label">Cost Category<input value={division} onChange={(event) => setDivision(event.target.value)} placeholder="Example: 032 - Exterior Improvements" /></label></div><label className="field-label">Cost Code Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Exact Project Cost Description" /></label><label className="field-label">Original Project Budget<CurrencyInput min="0" value={originalBudget} onValueChange={setOriginalBudget} placeholder="0.00" /></label><div className="modal-actions"><button className="secondary-action" onClick={() => setAdding(false)}>Cancel</button><button className="primary-action large" disabled={saving} onClick={addProjectCostCode}>{saving ? "Saving Cost Code..." : "Add To Project Budget"}</button></div></section></div> : null}
      {masterPickerOpen ? <div className="modal-layer" role="presentation"><section className="record-modal cost-code-library-modal" role="dialog" aria-modal="true" aria-labelledby="master-picker-title"><div className="modal-heading"><div><h2 id="master-picker-title">Select Cost Codes For {project.name}</h2></div><button aria-label="Close Master Cost Code List" onClick={() => setMasterPickerOpen(false)}>×</button></div><label className="budget-search master-search"><span>⌕</span><input autoFocus aria-label="Search Available Master Cost Codes" value={masterQuery} onChange={(event) => setMasterQuery(event.target.value)} placeholder="Search The Full Master List..." /></label><div className="master-code-list selectable-master-code-list">{unselectedMasterRecords.map((record) => { const data = budgetCodeData(record); const selected = selectedMasterCodes.includes(record.id); return <label className={selected ? "selected" : ""} key={record.id}><input type="checkbox" checked={selected} onChange={() => toggleMasterCode(record.id)} /><span><strong>{data.code}</strong><small>{data.division}</small></span><b>{data.description}</b></label>; })}{!unselectedMasterRecords.length ? <p className="empty-master-list">Every Matching Master Code Is Already Selected For This Project.</p> : null}</div><div className="master-picker-actions"><span>{selectedMasterCodes.length} Cost Code{selectedMasterCodes.length === 1 ? "" : "s"} Selected</span><button className="secondary-action" onClick={() => setMasterPickerOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !selectedMasterCodes.length} onClick={addSelectedMasterCodesToProject}>{saving ? "Adding Cost Codes..." : "Accept Selected Cost Codes"}</button></div></section></div> : null}
      {masterManagerOpen && canManageMaster ? <div className="modal-layer" role="presentation"><section className="record-modal cost-code-library-modal master-manager-modal" role="dialog" aria-modal="true" aria-labelledby="master-manager-title"><div className="modal-heading"><div><h2 id="master-manager-title">Manage Company Master Cost Codes</h2></div><button aria-label="Close Master Cost Code Manager" onClick={() => setMasterManagerOpen(false)}>×</button></div><div className="master-editor"><label className="field-label">Master Cost Code<input value={managerCode} disabled={Boolean(managerEditingCode)} onChange={(event) => setManagerCode(event.target.value)} placeholder="Example: 3212.16" /></label><label className="field-label">Cost Category<input value={managerDivision} onChange={(event) => setManagerDivision(event.target.value)} placeholder="032 - Exterior Improvements" /></label><label className="field-label">Description<input value={managerDescription} onChange={(event) => setManagerDescription(event.target.value)} placeholder="Exact Master Description" /></label><button className="primary-action" disabled={saving} onClick={saveMasterCostCode}>{managerEditingCode ? "Save Master Update" : "Add Master Cost Code"}</button>{managerEditingCode ? <button className="secondary-action" onClick={() => startMasterEdit()}>Cancel Edit</button> : null}</div><label className="budget-search master-search"><span>⌕</span><input aria-label="Search Company Master Cost Codes" value={masterQuery} onChange={(event) => setMasterQuery(event.target.value)} placeholder="Search Company Master Cost Codes..." /></label><div className="master-code-list">{masterManagerRecords.map((record) => { const data = budgetCodeData(record); return <article key={record.id}><span><strong>{data.code}</strong><small>{data.division}</small></span><b>{data.description}</b><button className="secondary-action" onClick={() => startMasterEdit(record)}>Edit Master</button></article>; })}</div><div className="budget-rule"><strong>Authority Rule</strong><span>Only Company Owners And Administrators can add or revise the company master list. Project Managers may select master codes or add project-only codes.</span></div></section></div> : null}
    </div>
  );
}

type ChangeOrderPricingLine = {
  id: string;
  category: "Labor" | "Material" | "Equipment" | "Subcontractor" | "Other";
  costCode: string;
  description: string;
  cost: number;
  markupPercent: number;
};

type ChangeOrderData = {
  description: string;
  reason: string;
  requestedBy: string;
  submittedBy: string;
  relatedReference: string;
  scheduleImpact: "Unknown" | "No Impact Expected" | "Impact Expected";
  scheduleDays: number;
  attachments: string[];
  costStatus: "To Be Determined" | "Priced" | "Released";
  pricingLines: ChangeOrderPricingLine[];
  pricingNotes: string;
  changeType: "Additive" | "Deductive" | "No Cost";
  approvedTotal: number;
  originalContractValue: number;
  previousApprovedChangeOrders: number;
  contractValueAfterThisChange: number;
  newSubstantialDate: string;
  newFinalDate: string;
  pricingInviteCompany?: string;
  pricingInviteEmail?: string;
  pricingInviteStatus?: "Not Created" | "Ready To Send" | "Sent" | "Response Received";
  pricingInviteToken?: string;
  vendorQuoteAmount?: number;
  vendorQuoteNotes?: string;
  vendorQuoteFile?: string;
  vendorSubmittedAt?: string;
  dispositionReason?: string;
  originPco?: string;
  coNumber?: string;
  releaseApprovedBy?: string;
  releaseApprovedAt?: string;
  ownerSignatureName?: string;
  ownerSignatureTitle?: string;
  ownerSignatureDate?: string;
  ownerSignatureMethod?: "Electronic Signature" | "Uploaded Signed PDF";
  executedFileName?: string;
  executedAt?: string;
  scheduleUpdateStatus?: "Pending PM Adjustment" | "Applied To Schedule";
  filedProjectPath?: string;
  workflowHistory: string[];
};

const emptyChangeOrderData: ChangeOrderData = {
  description: "",
  reason: "Owner Request",
  requestedBy: "Project Owner",
  submittedBy: "Jordan Mefford",
  relatedReference: "",
  scheduleImpact: "Unknown",
  scheduleDays: 0,
  attachments: [],
  costStatus: "To Be Determined",
  pricingLines: [],
  pricingNotes: "",
  changeType: "Additive",
  approvedTotal: 0,
  originalContractValue: 0,
  previousApprovedChangeOrders: 0,
  contractValueAfterThisChange: 0,
  newSubstantialDate: "",
  newFinalDate: "",
  workflowHistory: [],
};

function changeOrderData(record?: RecordItem): ChangeOrderData {
  const data = record?.data ?? {};
  return {
    ...emptyChangeOrderData,
    ...data,
    attachments: Array.isArray(data.attachments)
      ? (data.attachments as string[])
      : [],
    pricingLines: Array.isArray(data.pricingLines)
      ? (data.pricingLines as ChangeOrderPricingLine[])
      : [],
    workflowHistory: Array.isArray(data.workflowHistory)
      ? (data.workflowHistory as string[])
      : [],
  };
}

function nextWorkflowNumber(records: RecordItem[], prefix: "PCO" | "CO") {
  const highest = records.reduce((current, record) => {
    const match = record.id.match(new RegExp(`^${prefix}-(\\d{3})$`));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function workflowSequence(value: string, prefix: "PCO" | "CO") {
  const match = value.match(new RegExp(`^${prefix}-(\\d{3})$`));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function changeOrderLineTotal(line: ChangeOrderPricingLine) {
  return roundMoney(line.cost + line.cost * (line.markupPercent / 100));
}

function pricedChangeValue(
  lines: ChangeOrderPricingLine[],
  type: ChangeOrderData["changeType"],
) {
  const total = roundMoney(lines.reduce(
    (sum, line) => sum + changeOrderLineTotal(line),
    0,
  ));
  if (type === "No Cost") return 0;
  return type === "Deductive" ? -Math.abs(total) : Math.abs(total);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function wrapPdfText(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (value: string, size: number) => number },
  size: number,
) {
  const words = text.replaceAll("·", "-").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function generateExecutedChangeOrderPdf(
  record: RecordItem,
  data: ChangeOrderData,
  project: ProjectProfile,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${record.id} ${record.title}`);
  pdf.setAuthor("Mefford Contracting");
  pdf.setSubject("Executed Change Order");
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const red = rgb(0.616, 0.188, 0.157);
  const ink = rgb(0.1, 0.12, 0.13);
  const muted = rgb(0.39, 0.43, 0.45);
  const line = rgb(0.79, 0.81, 0.8);
  const margin = 46;
  const width = 520;
  let y = 742;

  try {
    const logoResponse = await fetch("/mefford-logo.png");
    const logo = await pdf.embedPng(await logoResponse.arrayBuffer());
    page.drawImage(logo, { x: margin, y: y - 28, width: 50, height: 43 });
  } catch {
    page.drawRectangle({ x: margin, y: y - 22, width: 46, height: 34, color: red });
  }
  page.drawText("MEFFORD CONTRACTING", { x: 108, y: y + 4, size: 8, font: bold, color: muted });
  page.drawText("Change Order", { x: 108, y: y - 19, size: 23, font: bold, color: ink });
  page.drawText(record.id, { x: 500, y: y - 11, size: 15, font: bold, color: red });
  page.drawLine({ start: { x: margin, y: y - 38 }, end: { x: margin + width, y: y - 38 }, thickness: 3, color: red });
  y -= 65;

  const projectFields = [
    ["Project", project.name],
    ["Project Number", project.number],
    ["Owner", project.ownerName],
    ["Date", record.due],
  ];
  const projectCell = width / 4;
  projectFields.forEach(([label, value], index) => {
    const x = margin + index * projectCell;
    page.drawRectangle({ x, y: y - 34, width: projectCell, height: 42, borderColor: line, borderWidth: 0.7 });
    page.drawText(label.toUpperCase(), { x: x + 7, y: y - 6, size: 6, font: bold, color: muted });
    page.drawText(value, { x: x + 7, y: y - 22, size: 8, font: bold, color: ink, maxWidth: projectCell - 14 });
  });
  y -= 58;
  page.drawText("CHANGE ORDER TITLE", { x: margin, y, size: 6, font: bold, color: muted });
  page.drawText(record.title, { x: margin, y: y - 19, size: 15, font: bold, color: ink });
  y -= 43;
  page.drawText("DESCRIPTION OF CHANGED WORK", { x: margin, y, size: 6, font: bold, color: muted });
  const descriptionLines = wrapPdfText(data.description, width - 20, regular, 9);
  const descriptionHeight = Math.max(72, descriptionLines.length * 13 + 25);
  page.drawRectangle({ x: margin, y: y - descriptionHeight, width, height: descriptionHeight - 8, borderColor: line, borderWidth: 0.7 });
  descriptionLines.forEach((text, index) => page.drawText(text, { x: margin + 10, y: y - 23 - index * 13, size: 9, font: regular, color: ink }));
  y -= descriptionHeight + 10;
  page.drawText(`Type: ${data.changeType}  |  Reason: ${data.reason}  |  Requested By: ${data.requestedBy}`, { x: margin, y, size: 7, font: regular, color: muted });
  y -= 26;

  const valueRows: Array<[string, number]> = [
    ["Original Contract Value", data.originalContractValue],
    ["This Change Order", data.approvedTotal],
    ["Previously Approved Change Orders", data.previousApprovedChangeOrders],
    ["Contract Value After This Change Order", data.contractValueAfterThisChange],
  ];
  valueRows.forEach(([label, value], index) => {
    const rowY = y - index * 25;
    page.drawRectangle({ x: margin, y: rowY - 20, width, height: 25, borderColor: line, borderWidth: 0.7 });
    page.drawText(label, { x: margin + 9, y: rowY - 11, size: 8, font: bold, color: muted });
    const amount = formatCurrency(value);
    page.drawText(amount, { x: margin + width - 9 - bold.widthOfTextAtSize(amount, 9), y: rowY - 11, size: 9, font: bold, color: ink });
  });
  y -= 116;
  const scheduleRows = [
    ["Contract Time Change", data.scheduleDays ? `${data.scheduleDays} Calendar Days` : "No Change"],
    ["New Substantial Completion Date", displayProjectDate(data.newSubstantialDate)],
    ["New Final Completion Date", displayProjectDate(data.newFinalDate)],
  ];
  const scheduleCell = width / 3;
  scheduleRows.forEach(([label, value], index) => {
    const x = margin + index * scheduleCell;
    page.drawRectangle({ x, y: y - 38, width: scheduleCell, height: 46, borderColor: line, borderWidth: 0.7 });
    page.drawText(label.toUpperCase(), { x: x + 7, y: y - 7, size: 5.5, font: bold, color: muted });
    page.drawText(value, { x: x + 7, y: y - 24, size: 8, font: bold, color: ink, maxWidth: scheduleCell - 14 });
  });
  y -= 67;
  const certification = "The Contract Sum Contract Time And Contract Documents Are Modified Only As Stated In This Change Order. All Other Contract Terms Remain Unchanged.";
  page.drawRectangle({ x: margin, y: y - 34, width, height: 42, color: rgb(0.95, 0.96, 0.95) });
  wrapPdfText(certification, width - 18, bold, 7).forEach((text, index) => page.drawText(text, { x: margin + 9, y: y - 10 - index * 11, size: 7, font: bold, color: ink }));
  y -= 72;

  page.drawText("PROJECT OWNER", { x: margin, y, size: 6, font: bold, color: muted });
  page.drawText("MEFFORD CONTRACTING", { x: 330, y, size: 6, font: bold, color: muted });
  page.drawText(data.ownerSignatureName || project.ownerName, { x: margin, y: y - 26, size: 13, font: regular, color: ink });
  page.drawText(data.releaseApprovedBy || "Jordan Mefford", { x: 330, y: y - 26, size: 13, font: regular, color: ink });
  page.drawLine({ start: { x: margin, y: y - 31 }, end: { x: 278, y: y - 31 }, thickness: 0.7, color: ink });
  page.drawLine({ start: { x: 330, y: y - 31 }, end: { x: 566, y: y - 31 }, thickness: 0.7, color: ink });
  page.drawText(`${data.ownerSignatureTitle || "Authorized Representative"} - ${displayProjectDate(data.ownerSignatureDate || "")}`, { x: margin, y: y - 43, size: 6, font: regular, color: muted });
  page.drawText("Authorized Signature / Release Approval", { x: 330, y: y - 43, size: 6, font: regular, color: muted });
  page.drawText("EXECUTED", { x: margin, y: 42, size: 8, font: bold, color: rgb(0.15, 0.43, 0.31) });
  page.drawText(`Originated As ${data.originPco || "N/A"}  |  Filed In Financial Info / Change Orders`, { x: 112, y: 42, size: 6.5, font: regular, color: muted });

  const bytes = Uint8Array.from(await pdf.save());
  return new File([bytes.buffer], `${record.id} Executed.pdf`, { type: "application/pdf" });
}

function ChangeOrdersWorkspace({
  project,
  records,
  onRecordsChange,
  onProjectUpdate,
  budgetCodes,
  onBudgetCodesChange,
  budgetReady,
  onOpenBudget,
}: {
  project: ProjectProfile;
  records: RecordItem[];
  onRecordsChange: (next: RecordItem[]) => void;
  onProjectUpdate: (changes: Partial<ProjectProfile>) => void;
  budgetCodes: RecordItem[];
  onBudgetCodesChange: (next: RecordItem[]) => void;
  budgetReady: boolean;
  onOpenBudget: () => void;
}) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"Office Pricing View" | "Field View">(
    "Office Pricing View",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formalPreviewId, setFormalPreviewId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("Owner Request");
  const [requestedBy, setRequestedBy] = useState("Project Owner");
  const [submittedBy, setSubmittedBy] = useState("Jordan Mefford");
  const [relatedReference, setRelatedReference] = useState("");
  const [scheduleImpact, setScheduleImpact] = useState<
    ChangeOrderData["scheduleImpact"]
  >("Unknown");
  const [recordDate, setRecordDate] = useState(() =>
    currentDateInput(project.timeZone),
  );
  const [recordTime, setRecordTime] = useState(() =>
    currentTimeInput(project.timeZone),
  );
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [pricingLines, setPricingLines] = useState<ChangeOrderPricingLine[]>([]);
  const [pricingNotes, setPricingNotes] = useState("");
  const [changeType, setChangeType] = useState<ChangeOrderData["changeType"]>("Additive");
  const [scheduleDays, setScheduleDays] = useState(0);
  const [newSubstantialDate, setNewSubstantialDate] = useState(project.substantialDate);
  const [newFinalDate, setNewFinalDate] = useState(project.finalDate);
  const [pricingInviteCompany, setPricingInviteCompany] = useState("");
  const [pricingInviteEmail, setPricingInviteEmail] = useState("");
  const [dispositionReason, setDispositionReason] = useState("");
  const [releaseChecked, setReleaseChecked] = useState(false);
  const [ownerSignerName, setOwnerSignerName] = useState("");
  const [ownerSignerTitle, setOwnerSignerTitle] = useState("Authorized Representative");
  const [ownerSignatureConsent, setOwnerSignatureConsent] = useState(false);
  const [executedFile, setExecutedFile] = useState<File | null>(null);
  const [addingCostCode, setAddingCostCode] = useState(false);
  const [addingMasterCostCode, setAddingMasterCostCode] = useState(false);
  const [masterCostCodeToAdd, setMasterCostCodeToAdd] = useState("");
  const [newCostCode, setNewCostCode] = useState("");
  const [newCostCodeDescription, setNewCostCodeDescription] = useState("");
  const projectBudgetCodes = selectedBudgetRecords(budgetCodes);
  const availableMasterBudgetCodes = budgetCodes.filter((record) => {
    const data = budgetCodeData(record);
    return (
      data.source === "Company Master" &&
      !data.selectedForProject &&
      !isExcludedProfitCostCode(record)
    );
  });
  const selectedRecord = records.find((record) => record.id === selectedId);
  const selectedData = changeOrderData(selectedRecord);
  const formalPreviewRecord = records.find(
    (record) => record.id === formalPreviewId,
  );
  const formalPreviewData = changeOrderData(formalPreviewRecord);
  const formalSequence = formalPreviewRecord
    ? workflowSequence(formalPreviewRecord.id, "CO")
    : Number.MAX_SAFE_INTEGER;
  const calculatedPreviousApproved = records
    .filter(
      (record) =>
        record.id.startsWith("CO-") &&
        workflowSequence(record.id, "CO") < formalSequence &&
        ["Approved", "Executed"].includes(record.status),
    )
    .reduce((total, record) => total + changeOrderData(record).approvedTotal, 0);
  const formalOriginalContract =
    formalPreviewData.originalContractValue || Number(project.contractAmount) || 0;
  const formalPreviousApproved =
    formalPreviewData.previousApprovedChangeOrders || calculatedPreviousApproved;
  const formalContractAfter =
    formalPreviewData.contractValueAfterThisChange ||
    formalOriginalContract + formalPreviousApproved + formalPreviewData.approvedTotal;
  const visibleRecords = records.filter((record) =>
    `${record.id} ${record.title} ${record.status} ${record.meta}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const openCount = records.filter((record) =>
    ["Submitted", "Pricing", "Awaiting Release", "Awaiting Owner Signature"].includes(
      record.status,
    ),
  ).length;
  const pendingValue = records
    .filter((record) =>
      ["Awaiting Release", "Awaiting Owner Signature"].includes(record.status),
    )
    .reduce((total, record) => total + changeOrderData(record).approvedTotal, 0);

  function openCreate() {
    if (!budgetReady) {
      showNotice(
        "Complete And Lock The Original Project Budget Before Starting A Change Order.",
      );
      return;
    }
    setTitle("");
    setDescription("");
    setReason("Owner Request");
    setRequestedBy("Project Owner");
    setSubmittedBy(project.superintendent || project.projectManager || "Jordan Mefford");
    setRelatedReference("");
    setScheduleImpact("Unknown");
    setRecordDate(currentDateInput(project.timeZone));
    setRecordTime(currentTimeInput(project.timeZone));
    setAttachmentFiles([]);
    setChangeType("Additive");
    setCreateOpen(true);
  }

  function openRecord(record: RecordItem) {
    const data = changeOrderData(record);
    setSelectedId(record.id);
    setPricingLines(data.pricingLines);
    setPricingNotes(data.pricingNotes);
    setChangeType(data.changeType);
    setScheduleDays(data.scheduleDays);
    setNewSubstantialDate(data.newSubstantialDate || project.substantialDate);
    setNewFinalDate(data.newFinalDate || project.finalDate);
    setPricingInviteCompany(data.pricingInviteCompany || "");
    setPricingInviteEmail(data.pricingInviteEmail || "");
    setDispositionReason(data.dispositionReason || "");
    setReleaseChecked(false);
    setOwnerSignerName("");
    setOwnerSignerTitle("Authorized Representative");
    setOwnerSignatureConsent(false);
    setExecutedFile(null);
  }

  async function submitPco() {
    if (!title.trim() || !description.trim() || !requestedBy.trim()) {
      showNotice("Add The Title Description And Requesting Party Before Submitting.");
      return;
    }
    setSaving(true);
    const id = nextWorkflowNumber(records, "PCO");
    const attachmentNames = attachmentFiles.map((file) => file.name);
    const workflowEntry = `Submitted By ${submittedBy} · ${numericDateFromInput(recordDate)} · ${displayTimeInput(recordTime)} · Cost To Be Determined`;
    const data: ChangeOrderData = {
      ...emptyChangeOrderData,
      description: description.trim(),
      reason,
      requestedBy: requestedBy.trim(),
      submittedBy,
      relatedReference: relatedReference.trim(),
      scheduleImpact,
      changeType,
      attachments: attachmentNames,
      workflowHistory: [workflowEntry],
    };
    const record: RecordItem = {
      id,
      title: title.trim(),
      owner: project.projectManager || "Company Owner",
      due: numericDateFromInput(recordDate),
      status: "Submitted",
      meta: "Cost To Be Determined · Project Manager Pricing Required",
      recordDate,
      recordTime,
      dateLocked: false,
      auditHistory: [workflowEntry],
      data,
      persistent: true,
    };
    try {
      for (const file of attachmentFiles) {
        await uploadChangeOrderAttachment(file, project.number, id);
      }
      await persistCommandRecord(project.number, "Change Orders", record);
    } catch (error) {
      setSaving(false);
      showNotice(
        error instanceof Error
          ? error.message
          : "The Potential Change Order Could Not Be Saved Permanently.",
      );
      return;
    }
    onRecordsChange([record, ...records]);
    setSaving(false);
    setCreateOpen(false);
    showNotice(`${id} Submitted Permanently To ${record.owner} For Pricing.`);
  }

  function addPricingLine() {
    setPricingLines((current) => [
      ...current,
      {
        id: createClientId(),
        category: "Subcontractor",
        costCode: "",
        description: "",
        cost: 0,
        markupPercent: 10,
      },
    ]);
  }

  function updatePricingLine(
    id: string,
    changes: Partial<ChangeOrderPricingLine>,
  ) {
    setPricingLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...changes } : line)),
    );
  }

  async function addCostCodeFromChangeOrder() {
    if (!newCostCode.trim() || !newCostCodeDescription.trim()) {
      showNotice("Add The New Cost Code And Description Before Saving.");
      return;
    }
    if (budgetCodes.some((record) => record.id === newCostCode.trim())) {
      showNotice("That Cost Code Already Exists In The Project Budget.");
      return;
    }
    const budgetData: BudgetCodeData = {
      code: newCostCode.trim(),
      division: "Project Change Order Addition",
      description: newCostCodeDescription.trim(),
      originalBudget: 0,
      approvedChanges: 0,
      committedCost: 0,
      actualCost: 0,
      forecastCost: 0,
      source: "Project Addition",
      selectedForProject: true,
    };
    const budgetRecord: RecordItem = {
      id: budgetData.code,
      title: budgetData.description,
      owner: project.projectManager,
      due: numericDateFromInput(currentDateInput(project.timeZone)),
      status: "Active",
      meta: "Project Change Order Addition · Company Master Unchanged",
      data: budgetData,
      persistent: true,
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Budget", budgetRecord);
      onBudgetCodesChange(
        [...budgetCodes, budgetRecord].sort((a, b) => a.id.localeCompare(b.id)),
      );
      setAddingCostCode(false);
      setNewCostCode("");
      setNewCostCodeDescription("");
      showNotice(`${budgetRecord.id} Added To This Project Budget And Is Ready For Pricing.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The Cost Code Could Not Be Saved.");
    }
    setSaving(false);
  }

  async function addMasterCostCodeFromChangeOrder() {
    const masterRecord = budgetCodes.find(
      (record) => record.id === masterCostCodeToAdd,
    );
    if (!masterRecord) {
      showNotice("Select A Company Master Cost Code Before Adding It.");
      return;
    }
    const data: BudgetCodeData = {
      ...budgetCodeData(masterRecord),
      selectedForProject: true,
    };
    const projectRecord: RecordItem = {
      ...masterRecord,
      data,
      meta: `${data.division} · Company Master · Selected For ${project.name}`,
      persistent: true,
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Budget", projectRecord);
      onBudgetCodesChange(
        budgetCodes
          .map((record) =>
            record.id === projectRecord.id ? projectRecord : record,
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      setAddingMasterCostCode(false);
      setMasterCostCodeToAdd("");
      showNotice(
        `${data.code} Added From The Company Master List To This Project Budget.`,
      );
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "The Master Cost Code Could Not Be Added To This Project.",
      );
    }
    setSaving(false);
  }

  function updateScheduleImpactDays(value: number) {
    const days = Math.max(0, value || 0);
    setScheduleDays(days);
    setNewSubstantialDate(addCalendarDays(project.substantialDate, days));
    setNewFinalDate(addCalendarDays(project.finalDate, days));
  }

  async function savePricingInvite(markSent = false) {
    if (!selectedRecord || !selectedRecord.id.startsWith("PCO-")) return;
    if (!pricingInviteCompany.trim() || !pricingInviteEmail.trim()) {
      showNotice("Add The Subcontractor Company And Email Before Creating The Invite.");
      return;
    }
    const token =
      selectedData.pricingInviteToken ||
      `${project.number}-${selectedRecord.id}-${createClientId().replaceAll("-", "").slice(0, 10)}`;
    const status = markSent ? "Sent" : "Ready To Send";
    const entry = `Controlled Pricing Invite ${markSent ? "Sent" : "Created"} For ${pricingInviteCompany.trim()} · Number-Limited Access To ${selectedRecord.id}`;
    const next: RecordItem = {
      ...selectedRecord,
      data: {
        ...selectedData,
        pricingInviteCompany: pricingInviteCompany.trim(),
        pricingInviteEmail: pricingInviteEmail.trim(),
        pricingInviteStatus: status,
        pricingInviteToken: token,
        workflowHistory: [...selectedData.workflowHistory, entry],
      },
      auditHistory: [...(selectedRecord.auditHistory ?? []), entry],
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Change Orders", next);
    } catch (error) {
      setSaving(false);
      showNotice(error instanceof Error ? error.message : "The Pricing Invite Could Not Be Saved.");
      return;
    }
    onRecordsChange(records.map((record) => (record.id === next.id ? next : record)));
    setSaving(false);
    showNotice(
      markSent
        ? `Controlled Pricing Invite Marked Sent To ${pricingInviteCompany.trim()}.`
        : "Secure Pricing Invite Created And Ready For Distribution.",
    );
  }

  async function reserveDisposition(status: "Rejected" | "Void") {
    if (!selectedRecord || !selectedRecord.id.startsWith("PCO-")) return;
    if (!dispositionReason.trim()) {
      showNotice(`Add A Reason Before Marking This PCO ${status}.`);
      return;
    }
    const entry = `${status} By Jordan Mefford · ${numericDateFromInput(currentDateInput(project.timeZone))} · Number Permanently Reserved · ${dispositionReason.trim()}`;
    const next: RecordItem = {
      ...selectedRecord,
      status,
      meta: `${status} · Number Permanently Reserved For Audit History`,
      data: {
        ...selectedData,
        dispositionReason: dispositionReason.trim(),
        workflowHistory: [...selectedData.workflowHistory, entry],
      },
      auditHistory: [...(selectedRecord.auditHistory ?? []), entry],
      dateLocked: true,
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Change Orders", next);
    } catch (error) {
      setSaving(false);
      showNotice(error instanceof Error ? error.message : "The PCO Status Could Not Be Saved.");
      return;
    }
    onRecordsChange(records.map((record) => (record.id === next.id ? next : record)));
    setSaving(false);
    setSelectedId(null);
    showNotice(`${selectedRecord.id} Is ${status} And Its Number Remains Permanently Reserved.`);
  }

  async function savePricing() {
    if (!selectedRecord) return;
    const completeLines = pricingLines.filter(
      (line) => line.description.trim() && line.cost > 0,
    );
    if (!completeLines.length && changeType !== "No Cost") {
      showNotice("Add At Least One Complete Pricing Line Before Submitting For Release.");
      return;
    }
    if (completeLines.some((line) => !line.costCode)) {
      showNotice("Select A Project Cost Code For Every Pricing Line.");
      return;
    }
    const approvedTotal = pricedChangeValue(completeLines, changeType);
    const entry = `Priced By ${project.projectManager || "Company Owner"} · ${changeType} · ${formatCurrency(approvedTotal)} · Submitted For Release Approval`;
    const next: RecordItem = {
      ...selectedRecord,
      status: "Awaiting Release",
      meta: `${formatCurrency(approvedTotal)} · Company Owner Or Administrator Release Required`,
      data: {
        ...selectedData,
        costStatus: "Priced",
        pricingLines: completeLines,
        pricingNotes: pricingNotes.trim(),
        changeType,
        scheduleDays: Math.max(0, scheduleDays),
        newSubstantialDate,
        newFinalDate,
        approvedTotal,
        workflowHistory: [...selectedData.workflowHistory, entry],
      },
      auditHistory: [...(selectedRecord.auditHistory ?? []), entry],
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Change Orders", next);
    } catch (error) {
      setSaving(false);
      showNotice(
        error instanceof Error ? error.message : "Pricing Could Not Be Saved.",
      );
      return;
    }
    onRecordsChange(records.map((record) => (record.id === next.id ? next : record)));
    setSaving(false);
    showNotice(`${selectedRecord.id} Pricing Saved And Submitted For Release Approval.`);
  }

  async function approveRelease() {
    if (!selectedRecord || !releaseChecked) {
      showNotice("Confirm The Scope Pricing Schedule Impact And Supporting Files First.");
      return;
    }
    const coNumber = nextWorkflowNumber(records, "CO");
    const originalContractValue = Number(project.contractAmount) || 0;
    const previousApprovedChangeOrders = records
      .filter(
        (record) =>
          record.id.startsWith("CO-") &&
          ["Approved", "Executed"].includes(record.status),
      )
      .reduce((total, record) => total + changeOrderData(record).approvedTotal, 0);
    const contractValueAfterThisChange =
      originalContractValue +
      previousApprovedChangeOrders +
      selectedData.approvedTotal;
    const approvedAt = `${numericDateFromInput(currentDateInput(project.timeZone))} · ${displayTimeInput(currentTimeInput(project.timeZone))}`;
    const releaseEntry = `Release Approved By Jordan Mefford · Company Owner · ${approvedAt} · Formal ${coNumber} Created`;
    const convertedPco: RecordItem = {
      ...selectedRecord,
      status: "Converted",
      meta: `${coNumber} · Released To Project Owner`,
      data: {
        ...selectedData,
        costStatus: "Released",
        coNumber,
        releaseApprovedBy: "Jordan Mefford",
        releaseApprovedAt: approvedAt,
        originalContractValue,
        previousApprovedChangeOrders,
        contractValueAfterThisChange,
        newSubstantialDate: selectedData.newSubstantialDate || newSubstantialDate,
        newFinalDate: selectedData.newFinalDate || newFinalDate,
        workflowHistory: [...selectedData.workflowHistory, releaseEntry],
      },
      auditHistory: [...(selectedRecord.auditHistory ?? []), releaseEntry],
    };
    const formalCo: RecordItem = {
      ...convertedPco,
      id: coNumber,
      status: "Awaiting Owner Signature",
      meta: `${formatCurrency(selectedData.approvedTotal)} · Originated As ${selectedRecord.id}`,
      dateLocked: true,
      data: {
        ...changeOrderData(convertedPco),
        originPco: selectedRecord.id,
        coNumber,
      },
    };
    setSaving(true);
    try {
      await persistCommandRecord(project.number, "Change Orders", convertedPco);
      await persistCommandRecord(project.number, "Change Orders", formalCo);
    } catch (error) {
      setSaving(false);
      showNotice(
        error instanceof Error
          ? error.message
          : "The Formal Change Order Could Not Be Released.",
      );
      return;
    }
    const nextRecords = [
      formalCo,
      ...records.map((record) =>
        record.id === convertedPco.id ? convertedPco : record,
      ),
    ];
    onRecordsChange(nextRecords);
    setSelectedId(coNumber);
    setFormalPreviewId(coNumber);
    setReleaseChecked(false);
    setSaving(false);
    showNotice(`${coNumber} Created And Approved For Distribution To The Project Owner.`);
  }

  async function executeFormalChangeOrder(
    method: "Electronic Signature" | "Uploaded Signed PDF",
  ) {
    if (!formalPreviewRecord) return;
    if (method === "Electronic Signature" && (!ownerSignerName.trim() || !ownerSignatureConsent)) {
      showNotice("Add The Owner Signer Name And Confirm The Electronic Signature Consent.");
      return;
    }
    if (method === "Uploaded Signed PDF" && !executedFile) {
      showNotice("Choose The Owner-Signed PDF Before Marking The Change Order Executed.");
      return;
    }
    setSaving(true);
    try {
      const executedDate = currentDateInput(project.timeZone);
      const executedAt = `${numericDateFromInput(executedDate)} · ${displayTimeInput(currentTimeInput(project.timeZone))}`;
      const signer =
        method === "Electronic Signature"
          ? ownerSignerName.trim()
          : formalPreviewData.ownerSignatureName || project.ownerName;
      const entry = `${formalPreviewRecord.id} Executed By ${signer} · ${method} · ${executedAt} · Contract Value And Completion Dates Updated`;
      const filedProjectPath = `Financial Info / Change Orders / ${formalPreviewRecord.id} Executed.pdf`;
      const executedData: ChangeOrderData = {
        ...formalPreviewData,
        originalContractValue: formalOriginalContract,
        previousApprovedChangeOrders: formalPreviousApproved,
        contractValueAfterThisChange: formalContractAfter,
        ownerSignatureName: signer,
        ownerSignatureTitle:
          method === "Electronic Signature"
            ? ownerSignerTitle.trim() || "Authorized Representative"
            : "Authorized Representative",
        ownerSignatureDate: executedDate,
        ownerSignatureMethod: method,
        executedAt,
        scheduleUpdateStatus: "Pending PM Adjustment",
        filedProjectPath,
        workflowHistory: [...formalPreviewData.workflowHistory, entry],
      };
      const next: RecordItem = {
        ...formalPreviewRecord,
        status: "Executed",
        due: numericDateFromInput(executedDate),
        meta: `${formatCurrency(formalContractAfter)} Current Contract Value · Executed`,
        dateLocked: true,
        data: executedData,
        auditHistory: [...(formalPreviewRecord.auditHistory ?? []), entry],
      };
      const fileToStore =
        method === "Electronic Signature"
          ? await generateExecutedChangeOrderPdf(next, executedData, project)
          : executedFile!;
      const storedExecution = await uploadChangeOrderAttachment(
        fileToStore,
        project.number,
        `${formalPreviewRecord.id} Executed`,
        "Financial Info / Change Orders",
      );
      next.data = { ...executedData, executedFileName: fileToStore.name, executedFileId: storedExecution.id };
      const executedSave = await persistCommandRecord(project.number, "Change Orders", next);
      const effects = executedSave.changeOrderEffects;
      if (!effects) throw new Error("The Saved Change Order Did Not Return Its Project Updates. Reload The Project.");
      const nextBudgetCodes = budgetCodes.map((budgetRecord) => {
        const saved = effects.budgetUpdates.find(item => item.id === budgetRecord.id);
        return saved ? { ...budgetRecord, data: saved.data, meta: saved.meta } : budgetRecord;
      });
      onRecordsChange(
        records.map((record) => (record.id === next.id ? next : record)),
      );
      onBudgetCodesChange(nextBudgetCodes);
      onProjectUpdate(effects.projectUpdate);
      setOwnerSignatureConsent(false);
      setExecutedFile(null);
      setSaving(false);
      showNotice(`${formalPreviewRecord.id} Executed. ${executedSave.contractAmendmentId || `AMEND-${formalPreviewRecord.id}`} Was Added To Contracts; Budget Completion Dates And Project Files Are Updated.`);
    } catch (error) {
      setSaving(false);
      showNotice(
        error instanceof Error
          ? error.message
          : "The Executed Change Order Could Not Be Saved.",
      );
    }
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3600);
  }

  return (
    <div className="module-workspace change-order-workspace">
      <section className="workspace-heading change-order-heading">
        <div>
          <p className="eyebrow orange-text">{project.name.toUpperCase()}</p>
          <h1>Change Orders</h1>

        </div>
        <button className="primary-action large" disabled={!budgetReady} onClick={openCreate}>
          ＋ New Potential Change Order
        </button>
      </section>
      {notice ? <div className="inline-success">{notice}</div> : null}
      {!budgetReady ? <section className="budget-prerequisite"><span>1</span><div><strong>Locked Original Budget Required</strong><p>Select project cost codes enter a positive original budget and lock it before creating or updating Change Orders.</p></div><button className="primary-action" onClick={onOpenBudget}>Open Budget Setup</button></section> : null}
      <section className="change-order-summary">
        <article {...summaryDrilldownProps({ title: "Potential Change Orders", rows: records.filter((record) => record.id.startsWith("PCO-")).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, value: formatCurrency(changeOrderData(record).approvedTotal), onOpen: () => openRecord(record), openLabel: "Open PCO →" })) })}>
          <span>PCO</span>
          <div>
            <strong>{records.filter((record) => record.id.startsWith("PCO-")).length}</strong>
            <small>Potential Change Orders</small>
          </div>
        </article>
        <article {...summaryDrilldownProps({ title: "Change Orders Needing Action", rows: records.filter((record) => ["Submitted", "Pricing", "Awaiting Release", "Awaiting Owner Signature"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, onOpen: () => openRecord(record), openLabel: "Open Record →" })) })}>
          <span>!</span>
          <div>
            <strong>{openCount}</strong>
            <small>Need Action</small>
          </div>
        </article>
        <article {...summaryDrilldownProps({ title: "Pending Or Released Change Value", rows: records.filter((record) => ["Awaiting Release", "Awaiting Owner Signature"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, value: formatCurrency(changeOrderData(record).approvedTotal), onOpen: () => openRecord(record), openLabel: "Open Record →" })) })}>
          <span>$</span>
          <div>
            <strong>{formatCurrency(pendingValue)}</strong>
            <small>Pending Or Released Value</small>
          </div>
        </article>
        <article {...summaryDrilldownProps({ title: "Formal Change Orders", rows: records.filter((record) => record.id.startsWith("CO-")).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, value: formatCurrency(changeOrderData(record).approvedTotal), onOpen: () => openRecord(record), openLabel: "Open Change Order →" })) })}>
          <span>CO</span>
          <div>
            <strong>{records.filter((record) => record.id.startsWith("CO-")).length}</strong>
            <small>Formal Change Orders</small>
          </div>
        </article>
      </section>
      <section className="change-order-controls">
        <label>
          <span>⌕</span>
          <input
            aria-label="Search Change Orders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Change Orders..."
          />
        </label>
        <div className="change-order-view-toggle">
          <button
            className={viewMode === "Office Pricing View" ? "active" : ""}
            onClick={() => setViewMode("Office Pricing View")}
          >
            Office Pricing View
          </button>
          <button
            className={viewMode === "Field View" ? "active" : ""}
            onClick={() => setViewMode("Field View")}
          >
            Superintendent Field View
          </button>
        </div>
      </section>
      <section className="change-order-board">
        {visibleRecords.map((record) => {
          const data = changeOrderData(record);
          const displayNumber = data.coNumber && record.id.startsWith("PCO-")
            ? `${record.id} → ${data.coNumber}`
            : record.id;
          return (
            <button key={record.id} onClick={() => openRecord(record)}>
              <span className="change-order-number">{displayNumber}</span>
              <span className="change-order-copy">
                <strong>{record.title}</strong>
                <small>{data.reason} · Requested By {data.requestedBy}</small>
              </span>
              <span className="change-order-impact">
                <small>Schedule</small>
                <strong>
                  {data.scheduleImpact === "Impact Expected"
                    ? `${data.scheduleDays || "TBD"} Days`
                    : data.scheduleImpact}
                </strong>
              </span>
              <span className="change-order-cost">
                <small>Change Amount</small>
                <strong>
                  {data.costStatus === "To Be Determined"
                    ? "To Be Determined"
                    : formatCurrency(data.approvedTotal)}
                </strong>
                {viewMode === "Field View" && data.approvedTotal !== 0 ? (
                  <i>Approved Total Only</i>
                ) : null}
              </span>
              <span>
                <i className={`status-badge ${record.status.toLowerCase().replaceAll(" ", "-")}`}>
                  {record.status}
                </i>
              </span>
              <span>›</span>
            </button>
          );
        })}
      </section>

      {createOpen ? (
        <div className="modal-layer" role="presentation">
          <section
            className="record-modal wide change-order-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-pco-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="new-pco-title">New Potential Change Order</h2>
              </div>
              <button aria-label="Close Potential Change Order" onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <div className="field-grid">
              <label className="field-label">
                PCO Number
                <input value={nextWorkflowNumber(records, "PCO")} disabled />
              </label>
              <label className="field-label">
                Date
                <input type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} />
              </label>
              <label className="field-label">
                Time
                <input type="time" value={recordTime} onChange={(event) => setRecordTime(event.target.value)} />
              </label>
            </div>
            <label className="field-label">
              Change Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Additional Site Drainage" autoFocus />
            </label>
            <label className="field-label">
              Detailed Description Of The Changed Work
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Describe the changed condition requested work affected area and what was observed." />
            </label>
            <div className="field-grid">
              <label className="field-label">
                Reason For Change
                <select value={reason} onChange={(event) => setReason(event.target.value)}>
                  <option>Owner Request</option>
                  <option>Design Revision</option>
                  <option>Unforeseen Condition</option>
                  <option>Code Requirement</option>
                  <option>Field Coordination</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="field-label">
                Requested By
                <input value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} placeholder="Name And Organization" />
              </label>
              <label className="field-label">
                Submitted By
                <select value={submittedBy} onChange={(event) => setSubmittedBy(event.target.value)}>
                  {MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}
                </select>
              </label>
            </div>
            <div className="field-grid">
              <label className="field-label">
                Related Drawing RFI Or Submittal
                <input value={relatedReference} onChange={(event) => setRelatedReference(event.target.value)} placeholder="Example: RFI-007 Or C3.2" />
              </label>
              <label className="field-label">
                Initial Schedule Impact
                <select value={scheduleImpact} onChange={(event) => setScheduleImpact(event.target.value as ChangeOrderData["scheduleImpact"])}>
                  <option>Unknown</option>
                  <option>No Impact Expected</option>
                  <option>Impact Expected</option>
                </select>
              </label>
              <label className="field-label">
                Change Order Type
                <select value={changeType} onChange={(event) => setChangeType(event.target.value as ChangeOrderData["changeType"])}>
                  <option>Additive</option>
                  <option>Deductive</option>
                  <option>No Cost</option>
                </select>
              </label>
            </div>
            <label className="change-order-upload">
              <input type="file" multiple onChange={(event) => setAttachmentFiles(Array.from(event.target.files ?? []))} />
              <span>＋</span>
              <strong>Add Pictures Drawings Quotes Or Supporting Files</strong>
              <small>{attachmentFiles.length ? `${attachmentFiles.length} File${attachmentFiles.length === 1 ? "" : "s"} Selected` : "Individual Files Up To 1 GB"}</small>
            </label>
            <div className="cost-tbd-banner">
              <span>$</span>
              <div>
                <strong>Pricing Pending</strong>
                <small>PM pricing required.</small>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="primary-action large" disabled={saving} onClick={submitPco}>{saving ? "Saving Permanently..." : "Submit PCO For Pricing"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedRecord ? (
        <div className="modal-layer" role="presentation">
          <section className="record-modal wide change-order-detail-modal" role="dialog" aria-modal="true" aria-labelledby="change-order-detail-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">{selectedRecord.id} · {selectedRecord.status.toUpperCase()}</p>
                <h2 id="change-order-detail-title">{selectedRecord.title}</h2>
              </div>
              <button aria-label="Close Change Order" onClick={() => setSelectedId(null)}>×</button>
            </div>
            <section className="change-order-detail-grid">
              <div><span>Requested By</span><strong>{selectedData.requestedBy}</strong></div>
              <div><span>Submitted By</span><strong>{selectedData.submittedBy}</strong></div>
              <div><span>Reason</span><strong>{selectedData.reason}</strong></div>
              <div><span>Change Type</span><strong>{selectedData.changeType}</strong></div>
              <div><span>Related Record</span><strong>{selectedData.relatedReference || "None Entered"}</strong></div>
            </section>
            <section className="change-order-description-card">
              <span>Changed Work Description</span>
              <p>{selectedData.description || selectedRecord.title}</p>
              <small>{selectedData.attachments.length} Supporting File{selectedData.attachments.length === 1 ? "" : "s"} · {selectedData.scheduleImpact}</small>
            </section>
            {viewMode === "Office Pricing View" && selectedRecord.id.startsWith("PCO-") && !["Converted", "Rejected", "Void"].includes(selectedRecord.status) ? (
              <section className="pricing-invite-panel">
                <div>

                  <h3>Subcontractor Pricing Request</h3>

                </div>
                <div className="pricing-invite-fields">
                  <label className="field-label">Subcontractor Company<input value={pricingInviteCompany} onChange={(event) => setPricingInviteCompany(event.target.value)} placeholder="Company Name" /></label>
                  <label className="field-label">Pricing Contact Email<input type="email" value={pricingInviteEmail} onChange={(event) => setPricingInviteEmail(event.target.value)} placeholder="pricing@company.com" /></label>
                </div>
                {selectedData.pricingInviteToken ? (
                  <div className="pricing-invite-ready">
                    <span>SECURE INVITE</span>
                    <strong>{selectedData.pricingInviteStatus || "Ready To Send"}</strong>
                    <input aria-label="Controlled Pricing Invite Link" readOnly value={`${typeof window === "undefined" ? "" : window.location.origin}/?pricingInvite=${selectedData.pricingInviteToken}`} />
                    {selectedData.pricingInviteStatus === "Ready To Send" ? <button className="secondary-action" disabled={saving} onClick={() => savePricingInvite(true)}>Mark Invite Sent</button> : null}
                  </div>
                ) : (
                  <button className="secondary-action" disabled={saving} onClick={() => savePricingInvite(false)}>Create Secure Pricing Invite</button>
                )}
              </section>
            ) : null}
            {viewMode === "Field View" ? (
              <section className="field-pricing-summary">
                <span>FIELD ACCESS</span>
                <div><strong>{selectedData.costStatus === "To Be Determined" ? "Cost To Be Determined" : formatCurrency(selectedData.approvedTotal)}</strong><small>{selectedData.costStatus === "To Be Determined" ? "Project Manager Pricing In Progress" : "Approved Total Only · Internal Breakdown And Cost Codes Hidden"}</small></div>
              </section>
            ) : selectedRecord.id.startsWith("PCO-") && ["Submitted", "Pricing", "Awaiting Release"].includes(selectedRecord.status) ? (
              <section className="pricing-builder">
                <div className="pricing-builder-heading">
                  <div><h3>Project Manager Pricing</h3></div>
                  <div><button className="secondary-action" onClick={() => setAddingMasterCostCode((current) => !current)}>＋ Add From Master List</button><button className="secondary-action" onClick={() => setAddingCostCode((current) => !current)}>＋ Add Project-Only Code</button><button className="secondary-action" onClick={addPricingLine}>＋ Add Pricing Line</button></div>
                </div>
                {addingMasterCostCode ? <div className="inline-master-cost-code-form"><label className="field-label">Company Master Cost Code<select value={masterCostCodeToAdd} onChange={(event) => setMasterCostCodeToAdd(event.target.value)}><option value="">Select From The Full Master List</option><BudgetCostCodeOptions records={availableMasterBudgetCodes} /></select></label><button className="primary-action" disabled={saving} onClick={addMasterCostCodeFromChangeOrder}>Add To Project Budget</button></div> : null}
                {addingCostCode ? <div className="inline-cost-code-form"><label className="field-label">New Project Cost Code<input value={newCostCode} onChange={(event) => setNewCostCode(event.target.value)} placeholder="Example: 3212.16" /></label><label className="field-label">Description<input value={newCostCodeDescription} onChange={(event) => setNewCostCodeDescription(event.target.value)} placeholder="Exact Project Cost Description" /></label><button className="primary-action" disabled={saving} onClick={addCostCodeFromChangeOrder}>Add To Project Budget</button></div> : null}
                {pricingLines.length ? (
                  <div className="pricing-line-list">
                    {pricingLines.map((line) => (
                      <div className="pricing-line" key={line.id}>
                        <select aria-label="Project Cost Code" value={line.costCode} onChange={(event) => updatePricingLine(line.id, { costCode: event.target.value })}>
                          <option value="">Select Cost Code</option>
                          <BudgetCostCodeOptions records={projectBudgetCodes} />
                        </select>
                        <select value={line.category} onChange={(event) => updatePricingLine(line.id, { category: event.target.value as ChangeOrderPricingLine["category"] })}>
                          <option>Labor</option><option>Material</option><option>Equipment</option><option>Subcontractor</option><option>Other</option>
                        </select>
                        <input aria-label="Pricing Description" value={line.description} onChange={(event) => updatePricingLine(line.id, { description: event.target.value })} placeholder="Pricing Description" />
                        <label><small>Internal Cost</small><CurrencyInput min="0" value={line.cost || ""} onValueChange={(value) => updatePricingLine(line.id, { cost: Number(value) })} /></label>
                        <label><small>Markup %</small><input type="number" min="0" step="0.1" value={line.markupPercent} onChange={(event) => updatePricingLine(line.id, { markupPercent: Number(event.target.value) })} /></label>
                        <strong>{formatCurrency(changeOrderLineTotal(line))}</strong>
                        <button aria-label="Remove Pricing Line" onClick={() => setPricingLines((current) => current.filter((item) => item.id !== line.id))}>×</button>
                      </div>
                    ))}
                  </div>
                ) : <button className="empty-pricing" onClick={addPricingLine}>＋ Add The First Labor Material Equipment Or Subcontractor Cost</button>}
                <div className="pricing-footer-grid">
                  <label className="field-label">Change Order Type<select value={changeType} onChange={(event) => setChangeType(event.target.value as ChangeOrderData["changeType"])}><option>Additive</option><option>Deductive</option><option>No Cost</option></select></label>
                  <label className="field-label">Final Schedule Impact In Days<input type="number" min="0" value={scheduleDays} onChange={(event) => updateScheduleImpactDays(Number(event.target.value))} /></label>
                  <label className="field-label">New Substantial Completion Date<input type="date" value={newSubstantialDate} onChange={(event) => setNewSubstantialDate(event.target.value)} /></label>
                  <label className="field-label">New Final Completion Date<input type="date" value={newFinalDate} onChange={(event) => setNewFinalDate(event.target.value)} /></label>
                  <label className="field-label">Pricing Notes<textarea rows={3} value={pricingNotes} onChange={(event) => setPricingNotes(event.target.value)} placeholder="Clarifications exclusions allowance or pricing assumptions" /></label>
                  <div className="pricing-total"><span>Proposed {changeType} Change Amount</span><strong>{formatCurrency(pricedChangeValue(pricingLines, changeType))}</strong><small>{changeType === "No Cost" ? "No Contract Value Change" : "Includes Entered Markup And Cost Code Allocation"}</small></div>
                </div>
                {selectedRecord.status !== "Awaiting Release" ? <button className="primary-action large full-width-action" disabled={saving} onClick={savePricing}>{saving ? "Saving Permanently..." : "Save Pricing And Submit For Release"}</button> : null}
              </section>
            ) : null}
            {viewMode === "Office Pricing View" && selectedData.pricingLines.length && !["Submitted", "Pricing"].includes(selectedRecord.status) ? (
              <section className="approved-pricing-summary">
                <div><h3>Approved Change Amount</h3></div>
                <strong>{formatCurrency(selectedData.approvedTotal)}</strong>
                <small>{selectedData.pricingLines.length} Pricing Line{selectedData.pricingLines.length === 1 ? "" : "s"} · {selectedData.scheduleDays} Schedule Day{selectedData.scheduleDays === 1 ? "" : "s"} · Substantial {displayProjectDate(selectedData.newSubstantialDate || project.substantialDate)} · Final {displayProjectDate(selectedData.newFinalDate || project.finalDate)}</small>
              </section>
            ) : null}
            {selectedRecord.status === "Awaiting Release" && viewMode === "Office Pricing View" ? (
              <section className="release-checkoff">
                <div><h3>Approve Release To The Project Owner</h3></div>
                <label><input type="checkbox" checked={releaseChecked} onChange={(event) => setReleaseChecked(event.target.checked)} /><span>I Confirm The Scope Pricing Markup Schedule Impact And Supporting Files Are Complete For This Exact Version.</span></label>
                <button className="primary-action large" disabled={!releaseChecked || saving} onClick={approveRelease}>{saving ? "Creating Formal Change Order..." : `Approve Release And Create ${nextWorkflowNumber(records, "CO")}`}</button>
              </section>
            ) : null}
            {selectedRecord.id.startsWith("CO-") ? (
              <section className="formal-co-actions">
                <div><span>FORMAL CHANGE ORDER</span><strong>{selectedRecord.status}</strong><small>Originated As {selectedData.originPco}</small></div>
                <button className="primary-action" onClick={() => setFormalPreviewId(selectedRecord.id)}>Preview Formal Change Order</button>
              </section>
            ) : null}
            {viewMode === "Office Pricing View" && selectedRecord.id.startsWith("PCO-") && !["Converted", "Rejected", "Void"].includes(selectedRecord.status) ? (
              <section className="pco-disposition-panel">
                <div><h3>Reject Or Void This PCO</h3></div>
                <label className="field-label">Required Reason<textarea rows={2} value={dispositionReason} onChange={(event) => setDispositionReason(event.target.value)} placeholder="Explain Why This PCO Will Not Proceed" /></label>
                <div><button className="secondary-action" disabled={saving} onClick={() => reserveDisposition("Rejected")}>Reject And Reserve Number</button><button className="secondary-action danger-outline" disabled={saving} onClick={() => reserveDisposition("Void")}>Void And Reserve Number</button></div>
              </section>
            ) : null}
            <section className="change-order-history">
              <p className="eyebrow">PERMANENT WORKFLOW HISTORY</p>
              <ol>{selectedData.workflowHistory.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>
            </section>
          </section>
        </div>
      ) : null}

      {formalPreviewRecord ? (
        <div className="modal-layer formal-co-layer" role="presentation">
          <section className="formal-change-order-preview" role="dialog" aria-modal="true" aria-labelledby="formal-co-title">
            <header><Mark /><div><p>MEFFORD CONTRACTING</p><h2 id="formal-co-title">Change Order</h2></div><strong>{formalPreviewRecord.id}</strong></header>
            <section className="formal-co-project-grid">
              <div><span>Project</span><strong>{project.name}</strong></div><div><span>Project Number</span><strong>{project.number}</strong></div><div><span>Owner</span><strong>{project.ownerName}</strong></div><div><span>Date</span><strong>{formalPreviewRecord.due}</strong></div>
            </section>
            <section className="formal-co-title"><span>Change Order Title</span><h3>{formalPreviewRecord.title}</h3></section>
            <section className="formal-co-description"><span>Description Of Changed Work</span><p>{formalPreviewData.description}</p><small>Type: {formalPreviewData.changeType} · Reason: {formalPreviewData.reason} · Requested By: {formalPreviewData.requestedBy} · Related Record: {formalPreviewData.relatedReference || "None"}</small></section>
            <section className="formal-co-value-grid">
              <div><span>Original Contract Value</span><strong>{formatCurrency(formalOriginalContract)}</strong></div>
              <div><span>This Change Order</span><strong>{formatCurrency(formalPreviewData.approvedTotal)}</strong></div>
              <div><span>Previously Approved Change Orders</span><strong>{formatCurrency(formalPreviousApproved)}</strong></div>
              <div><span>Contract Value After This Change Order</span><strong>{formatCurrency(formalContractAfter)}</strong></div>
            </section>
            <section className="formal-co-schedule-grid">
              <div><span>Contract Time Change</span><strong>{formalPreviewData.scheduleDays ? `${formalPreviewData.scheduleDays} Calendar Days` : "No Change"}</strong></div>
              <div><span>New Substantial Completion Date</span><strong>{displayProjectDate(formalPreviewData.newSubstantialDate || project.substantialDate)}</strong></div>
              <div><span>New Final Completion Date</span><strong>{displayProjectDate(formalPreviewData.newFinalDate || project.finalDate)}</strong></div>
            </section>
            <section className="formal-co-certification"><p>The Contract Sum Contract Time And Contract Documents Are Modified Only As Stated In This Change Order. All Other Contract Terms Remain Unchanged.</p></section>
            <section className="formal-co-signatures"><div><span>Project Owner</span>{formalPreviewData.ownerSignatureName ? <strong className="executed-signature">{formalPreviewData.ownerSignatureName}</strong> : <i />}<small>{formalPreviewData.ownerSignatureName ? `${formalPreviewData.ownerSignatureTitle} · ${displayProjectDate(formalPreviewData.ownerSignatureDate || "")} · ${formalPreviewData.ownerSignatureMethod}` : "Signature / Date"}</small></div><div><span>Mefford Contracting</span><strong className="executed-signature">{formalPreviewData.releaseApprovedBy || "Jordan Mefford"}</strong><small>Authorized Signature / Release Approval</small></div></section>
            {formalPreviewRecord.status === "Awaiting Owner Signature" ? (
              <section className="formal-execution-panel">
                <div><p className="eyebrow orange-text">OWNER EXECUTION</p><h3>Sign Electronically Or Upload The Owner-Signed PDF</h3><small>The Contract Value And Project Completion Dates Update Only After One Of These Execution Methods Is Completed.</small></div>
                <div className="formal-signature-fields">
                  <label className="field-label">Owner Signer Name<input value={ownerSignerName} onChange={(event) => setOwnerSignerName(event.target.value)} placeholder="Full Legal Name" /></label>
                  <label className="field-label">Signer Title<input value={ownerSignerTitle} onChange={(event) => setOwnerSignerTitle(event.target.value)} /></label>
                </div>
                <label className="owner-signature-consent"><input type="checkbox" checked={ownerSignatureConsent} onChange={(event) => setOwnerSignatureConsent(event.target.checked)} /><span>I Am Authorized To Sign For The Project Owner And I Intend This Electronic Signature To Execute This Change Order.</span></label>
                <button className="primary-action" disabled={saving || !ownerSignatureConsent || !ownerSignerName.trim()} onClick={() => executeFormalChangeOrder("Electronic Signature")}>{saving ? "Saving Execution..." : "Sign And Execute Change Order"}</button>
                <div className="execution-divider"><span>OR</span></div>
                <label className="signed-pdf-upload"><input type="file" data-format-required="true" accept="application/pdf" onChange={(event) => setExecutedFile(event.target.files?.[0] || null)} /><span>＋</span><strong>{executedFile?.name || "Choose Owner-Signed PDF"}</strong><small>PDF Up To 1 GB</small></label>
                <button className="secondary-action" disabled={saving || !executedFile} onClick={() => executeFormalChangeOrder("Uploaded Signed PDF")}>Upload Signed PDF And Mark Executed</button>
              </section>
            ) : (
              <section className="formal-executed-stamp"><span>EXECUTED</span><strong>{formalPreviewData.ownerSignatureName || project.ownerName}</strong><small>{formalPreviewData.executedAt || displayProjectDate(formalPreviewData.ownerSignatureDate || formalPreviewRecord.recordDate || "")}{formalPreviewData.executedFileName ? ` · ${formalPreviewData.executedFileName}` : ""} · Filed In Financial Info / Change Orders</small></section>
            )}
            <footer><span>Originated As {formalPreviewData.originPco}</span><span>Release Approved By {formalPreviewData.releaseApprovedBy}</span></footer>
            <div className="formal-preview-actions"><button className="secondary-action" onClick={() => setFormalPreviewId(null)}>Close Preview</button><button className="primary-action" onClick={() => window.print()}>Print Or Save As PDF</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function VendorPricingPortal({
  token,
  project,
  records,
  onRecordsChange,
}: {
  token: string;
  project: ProjectProfile;
  records: RecordItem[];
  onRecordsChange: (next: RecordItem[]) => void;
}) {
  const record = records.find(
    (item) => changeOrderData(item).pricingInviteToken === token,
  );
  const data = changeOrderData(record);
  const [quoteAmount, setQuoteAmount] = useState(
    data.vendorQuoteAmount ? String(data.vendorQuoteAmount) : "",
  );
  const [quoteNotes, setQuoteNotes] = useState(data.vendorQuoteNotes || "");
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function submitVendorPricing() {
    if (!record || Number(quoteAmount) <= 0) {
      setNotice("Add The Total Proposed Price Before Submitting.");
      return;
    }
    setSaving(true);
    try {
      if (quoteFile) {
        await uploadChangeOrderAttachment(
          quoteFile,
          project.number,
          `${record.id} Subcontractor Pricing`,
        );
      }
      const submittedAt = `${numericDateFromInput(currentDateInput(project.timeZone))} · ${displayTimeInput(currentTimeInput(project.timeZone))}`;
      const entry = `Pricing Response Received From ${data.pricingInviteCompany || "Subcontractor"} · ${formatCurrency(Number(quoteAmount))} · ${submittedAt}`;
      const next: RecordItem = {
        ...record,
        meta: `Subcontractor Pricing Received · ${formatCurrency(Number(quoteAmount))}`,
        data: {
          ...data,
          pricingInviteStatus: "Response Received",
          vendorQuoteAmount: roundMoney(quoteAmount),
          vendorQuoteNotes: quoteNotes.trim(),
          vendorQuoteFile: quoteFile?.name || data.vendorQuoteFile,
          vendorSubmittedAt: submittedAt,
          workflowHistory: [...data.workflowHistory, entry],
        },
        auditHistory: [...(record.auditHistory ?? []), entry],
      };
      await persistCommandRecord(project.number, "Change Orders", next);
      onRecordsChange(records.map((item) => (item.id === next.id ? next : item)));
      setNotice("Pricing Submitted Successfully! Mefford Contracting Has Been Notified.");
      setQuoteFile(null);
      setSaving(false);
    } catch (error) {
      setSaving(false);
      setNotice(
        error instanceof Error
          ? error.message
          : "The Pricing Response Could Not Be Saved.",
      );
    }
  }

  if (!record) {
    return (
      <main className="vendor-pricing-page">
        <section className="vendor-pricing-card compact">
          <Mark />

          <h1>This Pricing Invite Is Not Available</h1>
          <p>The Link May Be Incorrect Expired Or Already Closed. Contact The Mefford Project Manager For A New Invite.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="vendor-pricing-page">
      <section className="vendor-pricing-card">
        <header><Mark /><div><p>MEFFORD CONTRACTING</p><h1>Subcontractor Pricing Request</h1></div><span>CONTROLLED ACCESS</span></header>
        {notice ? <div className={notice.includes("Successfully") ? "inline-success" : "form-error"}>{notice}</div> : null}
        <section className="vendor-request-summary">
          <div><span>Project</span><strong>{project.name}</strong></div>
          <div><span>Request Number</span><strong>{record.id}</strong></div>
          <div><span>Pricing Company</span><strong>{data.pricingInviteCompany || "Invited Subcontractor"}</strong></div>
          <div><span>Requested By</span><strong>{project.projectManager}</strong></div>
        </section>
        <section className="vendor-change-scope"><span>Requested Change</span><h2>{record.title}</h2><p>{data.description}</p><small>Related Record: {data.relatedReference || "None"}</small></section>
        <div className="vendor-access-note"><strong>Limited Access</strong><span>This Page Accepts Pricing For {record.id} Only. It Does Not Provide Access To Project Financials Internal Markup Or Other Command Center Records.</span></div>
        <section className="vendor-pricing-form">
          <label className="field-label">Total Proposed Price<CurrencyInput min="0" value={quoteAmount} onValueChange={setQuoteAmount} placeholder="0.00" /></label>
          <label className="field-label">Scope Clarifications Exclusions And Schedule Notes<textarea rows={5} value={quoteNotes} onChange={(event) => setQuoteNotes(event.target.value)} placeholder="Describe What Is Included And Excluded" /></label>
          <label className="signed-pdf-upload"><input type="file" onChange={(event) => setQuoteFile(event.target.files?.[0] || null)} /><span>＋</span><strong>{quoteFile?.name || "Attach Proposal Or Supporting File"}</strong><small>Individual File Up To 1 GB</small></label>
          <button className="primary-action large" disabled={saving || Number(quoteAmount) <= 0} onClick={submitVendorPricing}>{saving ? "Submitting Pricing..." : "Submit Pricing To Mefford Contracting"}</button>
        </section>
      </section>
    </main>
  );
}

async function persistCommandRecord(
  projectId: string,
  recordType: string,
  record: RecordItem,
) {
  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, recordType, record }),
  });
  const result = (await response.json()) as { error?: string; contractAmendmentId?: string; changeOrderEffects?: { projectUpdate: Partial<ProjectProfile>; budgetUpdates: Array<{ id: string; data: Record<string, unknown>; meta: string }> } };
  if (!response.ok) {
    throw new Error(result.error || "The Record Could Not Be Saved Permanently.");
  }
  return result;
}

async function uploadChangeOrderAttachment(
  file: File,
  projectId: string,
  pcoNumber: string,
  category = "Change Orders",
) {
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw new Error(`${file.name} Exceeds The 1 GB Individual File Limit.`);
  }
  if (file.size > DIRECT_UPLOAD_BYTES) {
    return uploadLargeProjectFile(
      file,
      category,
      `${pcoNumber} Supporting File`,
      "Project Manager + Office",
      () => undefined,
      projectId,
    );
  }
  const form = new FormData();
  form.set("file", file);
  form.set("projectId", projectId);
  form.set("category", category);
  form.set("revision", `${pcoNumber} Supporting File`);
  form.set("access", "Project Manager + Office");
  const response = await fetch("/api/files", { method: "POST", body: form });
  const result = (await response.json()) as { file?: ProjectFile; error?: string };
  if (!response.ok || !result.file) {
    throw new Error(result.error || `${file.name} Could Not Be Saved.`);
  }
  return result.file;
}

type ProjectProfile = {
  name: string;
  number: string;
  status: "Preconstruction" | "Active" | "On Hold" | "Completed" | "Cancelled";
  site: string;
  ownerName: string;
  ownerContractDate: string;
  ownerContractType?: OwnerContractType;
  ownerContractStatus?: string;
  ownerContractRecordId?: string;
  paymentTerms?: string;
  retainageInitialPercent?: string;
  retainageAfterHalfPercent?: string;
  architect: string;
  projectType: string;
  contractAmount: string;
  currentContractAmount?: string;
  startDate: string;
  substantialDate: string;
  finalDate: string;
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  projectManager: string;
  superintendent: string;
  cameraCount: number;
  hasCloseoutPhases?: boolean;
  closeoutPhases?: string[];
};

function emptyProjectProfile(): ProjectProfile {
  return {
    name: "",
    number: "",
    status: "Preconstruction",
    site: "",
    ownerName: "",
    ownerContractDate: "",
    ownerContractType: "Plan & Spec Lump Sum",
    ownerContractStatus: "Draft",
    ownerContractRecordId: "",
    paymentTerms: "",
    retainageInitialPercent: "10",
    retainageAfterHalfPercent: "5",
    architect: "",
    projectType: "",
    contractAmount: "",
    currentContractAmount: "",
    startDate: "",
    substantialDate: "",
    finalDate: "",
    timeZone: companyTimeZone,
    latitude: null,
    longitude: null,
    projectManager: "",
    superintendent: "",
    cameraCount: 0,
    hasCloseoutPhases: false,
    closeoutPhases: [],
  };
}

function newProjectProfile(): ProjectProfile {
  const today = currentDateInput();
  return {
    name: "",
    number: "",
    status: "Preconstruction",
    site: "",
    ownerName: "",
    ownerContractDate: today,
    ownerContractType: "Plan & Spec Lump Sum",
    ownerContractStatus: "Draft",
    ownerContractRecordId: "",
    paymentTerms: "Monthly progress payments; undisputed amounts due as required by Project-state law.",
    retainageInitialPercent: "10",
    retainageAfterHalfPercent: "5",
    architect: "",
    projectType: "Commercial New Build",
    contractAmount: "",
    currentContractAmount: "",
    startDate: today,
    substantialDate: today,
    finalDate: today,
    timeZone: companyTimeZone,
    latitude: null,
    longitude: null,
    projectManager: "",
    superintendent: "",
    cameraCount: 0,
    hasCloseoutPhases: false,
    closeoutPhases: [],
  };
}

function displayProjectDate(value: string) {
  if (!value) return "Not Set";
  const [year, month, day] = value.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
  }).format(new Date(year, month - 1, day));
  return `${monthName} ${day} ${year}`;
}

function nextProjectNumber(existingNumbers: string[], createdAt = new Date()) {
  const year = String(createdAt.getFullYear()).slice(-2);
  const matcher = new RegExp(`^${year}-(\\d{3})$`);
  const highestSequence = existingNumbers.reduce((highest, number) => {
    const match = number.match(matcher);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  // Always advance from the highest issued number. Gaps remain permanently
  // retired so cancelled and abandoned projects retain a clean audit trail.
  return `${year}-${String(highestSequence + 1).padStart(3, "0")}`;
}

const cameraNames = [
  "North Lot",
  "Main Gate",
  "South Elevation",
  "Material Yard",
  "Building Interior",
  "East Entrance",
  "West Parking",
  "Loading Area",
  "Roof Overview",
  "Utility Trench",
  "Office Trailer",
  "Laydown Yard",
  "North Interior",
  "South Interior",
  "Public Entrance",
  "Closeout View",
];

type SubcontractCostAllocation = {
  id: string;
  costCode: string;
  amount: string;
};

type SubcontractBudgetComparison = {
  code: string;
  description: string;
  lockedOriginalBudget: number;
  approvedChanges: number;
  currentBudget: number;
  previousCommitted: number;
  subcontractAmount: number;
  availableBefore: number;
  buyoutVariance: number;
};

function subcontractBudgetComparison(
  allocation: SubcontractCostAllocation,
  budgetCodes: RecordItem[],
): SubcontractBudgetComparison {
  const budgetRecord = budgetCodes.find(
    (record) => record.id === allocation.costCode,
  );
  const data = budgetCodeData(budgetRecord);
  const currentBudget = data.originalBudget + data.approvedChanges;
  const previousCommitted = data.committedCost;
  const subcontractAmount = Number(allocation.amount || 0);
  const availableBefore = currentBudget - previousCommitted;
  return {
    code: allocation.costCode,
    description: data.description,
    lockedOriginalBudget: data.originalBudget,
    approvedChanges: data.approvedChanges,
    currentBudget,
    previousCommitted,
    subcontractAmount,
    availableBefore,
    buyoutVariance: availableBefore - subcontractAmount,
  };
}

function SubcontractWorkspace({
  project,
  budgetCodes,
  onBudgetCodesChange,
  records,
  onRecordsChange,
  budgetReady,
  onOpenBudget,
  onOpenRecord,
}: {
  project: ProjectProfile;
  budgetCodes: RecordItem[];
  onBudgetCodesChange: (next: RecordItem[]) => void;
  records: RecordItem[];
  onRecordsChange: (next: RecordItem[]) => void;
  budgetReady: boolean;
  onOpenBudget: () => void;
  onOpenRecord: (record: RecordItem) => void;
}) {
  const subcontractProjectFields = [
    { label: "Project", value: project.name, detail: "Project profile" },
    {
      label: "Project number",
      value: project.number,
      detail: "Project profile",
    },
    {
      label: "Construction site",
      value: project.site,
      detail: "Project profile",
    },
    {
      label: "General contractor",
      value: "Mefford Contracting, LLC",
      detail: "Company profile",
    },
    {
      label: "Owner legal name",
      value: project.ownerName,
      detail: "Project profile",
    },
    {
      label: "Owner contract date",
      value: displayProjectDate(project.ownerContractDate),
      detail: "Project profile",
    },
    {
      label: "Architect / engineer",
      value: project.architect || "N/A",
      detail: "Project profile",
    },
    {
      label: "Contract completion",
      value: displayProjectDate(project.finalDate),
      detail: "Current project schedule",
    },
    {
      label: "Project manager",
      value: project.projectManager,
      detail: "Project team",
    },
  ];
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const ownerName = project.ownerName;
  const ownerContractDate = displayProjectDate(project.ownerContractDate);
  const architect = project.architect;
  const [subcontractor, setSubcontractor] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("President");
  const [signerEmail, setSignerEmail] = useState("");
  const [subcontractDate, setSubcontractDate] = useState(() =>
    currentDateInput(project.timeZone),
  );
  const [price, setPrice] = useState("");
  const [costAllocations, setCostAllocations] = useState<
    SubcontractCostAllocation[]
  >([
    {
      id: "allocation-1",
      costCode: "",
      amount: "",
    },
  ]);
  const [retainage, setRetainage] = useState("10");
  const [substantialDate, setSubstantialDate] = useState(
    project.substantialDate,
  );
  const [finalDate, setFinalDate] = useState(project.finalDate);
  const [cglLimit, setCglLimit] = useState("1000000");
  const [workersCompLimit, setWorkersCompLimit] = useState("500000");
  const [liquidatedDamages, setLiquidatedDamages] =
    useState("Per prime contract");
  const [scope, setScope] = useState("");
  const [proposalName, setProposalName] = useState("");
  const [generated, setGenerated] = useState(false);
  const [subcontractRecordId, setSubcontractRecordId] = useState("");
  const [linkedDesignerVendorId, setLinkedDesignerVendorId] = useState("");
  const [linkedDesignTeamAssignmentId, setLinkedDesignTeamAssignmentId] = useState("");
  const [linkedDesignDiscipline, setLinkedDesignDiscipline] = useState("");
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [packetOpen, setPacketOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [meffordCountersigner, setMeffordCountersigner] =
    useState("Jordan Mefford");
  const [signatureStage, setSignatureStage] = useState<
    "not_sent" | "awaiting_subcontractor" | "awaiting_mefford" | "executed"
  >("not_sent");
  const [approvalStatus, setApprovalStatus] = useState<
    "draft" | "pending" | "approved"
  >("draft");
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [error, setError] = useState("");
  const meffordCountersignerRole =
    "Company Owner";
  const allocationTotal = costAllocations.reduce(
    (total, allocation) => total + Number(allocation.amount || 0),
    0,
  );
  const allocationRemaining = Number(price || 0) - allocationTotal;
  const projectBudgetCodes = selectedBudgetRecords(budgetCodes);
  const budgetComparisons = costAllocations.map((allocation) =>
    subcontractBudgetComparison(allocation, budgetCodes),
  );
  const selectedBudgetComparisons = budgetComparisons.filter(
    (comparison) => comparison.code,
  );
  const comparisonTotals = selectedBudgetComparisons.reduce(
    (summary, comparison) => ({
      budget: summary.budget + comparison.currentBudget,
      previousCommitted:
        summary.previousCommitted + comparison.previousCommitted,
      subcontract: summary.subcontract + comparison.subcontractAmount,
      buyout: summary.buyout + comparison.buyoutVariance,
    }),
    { budget: 0, previousCommitted: 0, subcontract: 0, buyout: 0 },
  );
  const activeDraftRecord = records.find(
    (record) => record.id === subcontractRecordId,
  );

  const steps = [
    "Project information",
    "Subcontract details",
    "Scope + proposal",
    "Review + generate",
  ];

  function resumeSubcontractDraft(record: RecordItem) {
    const data = record.data ?? {};
    const savedAllocations = Array.isArray(data.costAllocations)
      ? data.costAllocations
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object",
          )
          .map((item) => ({
            id: String(item.id || createClientId()),
            costCode: String(item.costCode || ""),
            amount: String(item.amount || ""),
          }))
      : [];
    setCreating(true);
    setStep(2);
    setSubcontractRecordId(record.id);
    setLinkedDesignerVendorId(String(data.vendorId || ""));
    setLinkedDesignTeamAssignmentId(String(data.linkedDesignTeamAssignmentId || ""));
    setLinkedDesignDiscipline(String(data.designDiscipline || ""));
    setSubcontractor(String(data.subcontractor || record.title));
    setSignerName(String(data.signerName || ""));
    setSignerTitle(String(data.signerTitle || "President"));
    setSignerEmail(String(data.signerEmail || ""));
    setSubcontractDate(record.recordDate || currentDateInput(project.timeZone));
    setPrice(String(data.price || ""));
    setCostAllocations(
      savedAllocations.length
        ? savedAllocations
        : [{ id: createClientId(), costCode: "", amount: "" }],
    );
    setRetainage(String(data.retainage || "10"));
    setSubstantialDate(String(data.substantialDate || project.substantialDate));
    setFinalDate(String(data.finalDate || project.finalDate));
    setScope(String(data.scope || ""));
    setProposalName(String(data.proposalName || ""));
    setMeffordCountersigner(String(data.meffordCountersigner || "Jordan Mefford"));
    setGenerated(false);
    setPacketOpen(false);
    setSent(false);
    setSignatureStage("not_sent");
    setApprovalStatus("draft");
    setApprovalChecked(false);
    setError("");
  }

  function startNew() {
    if (!budgetReady) {
      setError(
        "Complete And Lock The Original Project Budget Before Starting A Subcontract.",
      );
      return;
    }
    setCreating(true);
    setStep(1);
    setSubcontractDate(currentDateInput(project.timeZone));
    setGenerated(false);
    setSubcontractRecordId("");
    setLinkedDesignerVendorId("");
    setLinkedDesignTeamAssignmentId("");
    setLinkedDesignDiscipline("");
    setPacketOpen(false);
    setSent(false);
    setMeffordCountersigner("Jordan Mefford");
    setSignatureStage("not_sent");
    setApprovalStatus("draft");
    setApprovalChecked(false);
    setSubcontractor("");
    setSignerName("");
    setSignerEmail("");
    setPrice("");
    setCostAllocations([
      {
        id: createClientId(),
        costCode: "",
        amount: "",
      },
    ]);
    setScope("");
    setProposalName("");
    setError("");
  }

  function updateAllocation(
    id: string,
    changes: Partial<SubcontractCostAllocation>,
  ) {
    setCostAllocations((current) =>
      current.map((allocation) =>
        allocation.id === id ? { ...allocation, ...changes } : allocation,
      ),
    );
  }

  function selectAllocationCostCode(id: string, costCode: string) {
    updateAllocation(id, { costCode });
  }

  function addAllocation() {
    setCostAllocations((current) => [
      ...current,
      { id: createClientId(), costCode: "", amount: "" },
    ]);
  }

  function nextStep() {
    if (
      step === 2 &&
      (!subcontractor.trim() ||
        !signerName.trim() ||
        !signerEmail.trim() ||
        !price.trim())
    ) {
      setError(
        "Add the subcontractor, signer, signer email, and subcontract price before continuing.",
      );
      return;
    }
    if (step === 2) {
      const duplicateCodes = costAllocations
        .map((allocation) => allocation.costCode)
        .filter(
          (costCode, index, all) =>
            costCode && all.indexOf(costCode) !== index,
        );
      if (
        !costAllocations.length ||
        costAllocations.some(
          (allocation) =>
            !allocation.costCode || Number(allocation.amount || 0) <= 0,
        )
      ) {
        setError("Select A Cost Code And Positive Amount For Every Allocation.");
        return;
      }
      if (duplicateCodes.length) {
        setError("Use Each Cost Code Once And Combine Duplicate Amounts.");
        return;
      }
      if (
        Math.round(allocationTotal * 100) !==
        Math.round(Number(price || 0) * 100)
      ) {
        setError("Cost Code Allocations Must Equal The Total Subcontract Price.");
        return;
      }
    }
    if (step === 3 && !scope.trim()) {
      setError("Add the direct scope of work before continuing.");
      return;
    }
    setError("");
    setStep((current) => Math.min(4, current + 1));
  }

  function nextSubcontractId() {
    const nextNumber =
      records.reduce((largest, record) => {
        const match = record.id.match(/^SC-(\d+)$/);
        return match ? Math.max(largest, Number(match[1])) : largest;
      }, 0) + 1;
    return `SC-${String(nextNumber).padStart(3, "0")}`;
  }

  function buildSubcontractWorkflowRecord(
    id: string,
    status: string,
  ): RecordItem {
    const nowDate = currentDateInput(project.timeZone);
    const nowTime = currentTimeInput(project.timeZone);
    return {
      id,
      title: subcontractor,
      owner: project.projectManager,
      due: numericDateFromInput(subcontractDate),
      status,
      meta: `${formatCurrency(Number(price || 0))} · ${costAllocations.length} Cost Code Allocation${costAllocations.length === 1 ? "" : "s"}`,
      recordDate: subcontractDate,
      recordTime: nowTime,
      dateLocked: status !== "Draft",
      data: {
        ...(activeDraftRecord?.data ?? {}),
        subcontractor,
        ...(linkedDesignerVendorId ? {
          vendorId: linkedDesignerVendorId,
          linkedDesignTeamAssignmentId,
          designDiscipline: linkedDesignDiscipline,
          designTeamSource: true,
        } : {}),
        signerName,
        signerTitle,
        signerEmail,
        price: roundMoney(price),
        retainage: Number(retainage || 0),
        scope,
        proposalName,
        substantialDate,
        finalDate,
        costAllocations: costAllocations.map((allocation) => {
          const comparison = subcontractBudgetComparison(
            allocation,
            budgetCodes,
          );
          return {
            ...allocation,
            amount: roundMoney(allocation.amount),
            lockedOriginalBudget: roundMoney(comparison.lockedOriginalBudget),
            approvedChanges: roundMoney(comparison.approvedChanges),
            previousCommitted: roundMoney(comparison.previousCommitted),
            availableBefore: roundMoney(comparison.availableBefore),
            buyoutVariance: roundMoney(comparison.buyoutVariance),
          };
        }),
        totalBuyoutVariance: roundMoney(comparisonTotals.buyout),
        meffordCountersigner,
        workflowStatus: status,
        workflowUpdatedAt: `${numericDateFromInput(nowDate)} · ${displayTimeInput(nowTime)}`,
      },
      persistent: true,
    };
  }

  async function persistSubcontractWorkflow(status: string) {
    const id = subcontractRecordId || nextSubcontractId();
    const workflowRecord = buildSubcontractWorkflowRecord(id, status);
    await persistCommandRecord(project.number, "Subcontracts", workflowRecord);
    onRecordsChange([
      workflowRecord,
      ...records.filter((record) => record.id !== id),
    ]);
    if (!subcontractRecordId) setSubcontractRecordId(id);
    return workflowRecord;
  }

  async function generatePacket() {
    setWorkflowSaving(true);
    setError("");
    try {
      await persistSubcontractWorkflow("Draft");
      setGenerated(true);
      setSent(false);
      setSignatureStage("not_sent");
      setApprovalStatus("draft");
      setApprovalChecked(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The Draft Subcontract Could Not Be Saved Permanently.",
      );
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function markPreparedDraftDoNotAward() {
    const sourceBidPackageId = String(
      activeDraftRecord?.data?.sourceBidPackageId || "",
    );
    if (!activeDraftRecord || !sourceBidPackageId) return;
    const reason = window.prompt(
      `Why should ${activeDraftRecord.title} not receive this work? This decision is retained permanently.`,
      "",
    )?.trim() || "";
    if (!reason) return;
    if (reason.length < 10) {
      setError("Add A Specific Reason Of At Least 10 Characters.");
      return;
    }
    setWorkflowSaving(true);
    setError("");
    try {
      const response = await fetch("/api/procurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decline-prepared-commitment",
          scope: "Project",
          projectId: project.number,
          recordId: sourceBidPackageId,
          reason,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The PM Decision Could Not Be Saved.");
      onRecordsChange(records.map((record) =>
        record.id === activeDraftRecord.id
          ? {
              ...record,
              status: "Do Not Award",
              meta: `PM Decision · Do Not Award · ${reason}`,
              dateLocked: true,
              data: {
                ...record.data,
                awardDecision: "Do Not Award",
                doNotAwardReason: reason,
                automaticDistribution: false,
              },
            }
          : record,
      ));
      setCreating(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The PM Decision Could Not Be Saved.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  function editEarlierStep(nextStepNumber: number) {
    setGenerated(false);
    setSent(false);
    setSignatureStage("not_sent");
    setApprovalStatus("draft");
    setApprovalChecked(false);
    setStep(nextStepNumber);
  }

  async function submitForApproval() {
    setWorkflowSaving(true);
    try {
      await persistSubcontractWorkflow("Pending Approval");
      setApprovalStatus("pending");
      setApprovalChecked(false);
      setSent(false);
      setSignatureStage("not_sent");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Approval Request Could Not Be Saved.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function approveRelease() {
    if (!approvalChecked) return;
    setWorkflowSaving(true);
    try {
      await persistSubcontractWorkflow("Approved");
      setApprovalStatus("approved");
      setSent(false);
      setSignatureStage("not_sent");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Approval Could Not Be Saved.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function distributeForSignature() {
    setWorkflowSaving(true);
    try {
      await persistSubcontractWorkflow("Awaiting Signatures");
      setSent(true);
      setSignatureStage("awaiting_subcontractor");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Signature Distribution Could Not Be Saved.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function recordSubcontractorSignature() {
    if (signatureStage !== "awaiting_subcontractor") return;
    setWorkflowSaving(true);
    try {
      await persistSubcontractWorkflow("Awaiting Mefford Signature");
      setSignatureStage("awaiting_mefford");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The Subcontractor Signature Could Not Be Saved.");
    } finally {
      setWorkflowSaving(false);
    }
  }

  async function recordMeffordCountersignature() {
    if (signatureStage !== "awaiting_mefford") return;
    setWorkflowSaving(true);
    const allocationByCode = new Map(
      costAllocations.map((allocation) => [
        allocation.costCode,
        Number(allocation.amount || 0),
      ]),
    );
    const changedBudgetRecords: RecordItem[] = [];
    const nextBudgetCodes = budgetCodes.map((record) => {
      const allocation = allocationByCode.get(record.id);
      if (!allocation) return record;
      const current = budgetCodeData(record);
      const nextData: BudgetCodeData = {
        ...current,
        selectedForProject: true,
        committedCost: current.committedCost + allocation,
        forecastCost: Math.max(
          current.committedCost + allocation,
          current.actualCost,
        ),
      };
      const nextRecord = {
        ...record,
        data: nextData,
        persistent: true,
      };
      changedBudgetRecords.push(nextRecord);
      return nextRecord;
    });
    const executedId = subcontractRecordId || nextSubcontractId();
    const workflowRecord = buildSubcontractWorkflowRecord(
      executedId,
      "Executed",
    );
    const executedRecord: RecordItem = {
      ...workflowRecord,
      due: numericDateFromInput(currentDateInput(project.timeZone)),
      recordDate: currentDateInput(project.timeZone),
      recordTime: currentTimeInput(project.timeZone),
      dateLocked: true,
      data: {
        ...workflowRecord.data,
        executedAt: `${numericDateFromInput(currentDateInput(project.timeZone))} · ${displayTimeInput(currentTimeInput(project.timeZone))}`,
      },
    };
    setError("");
    try {
      for (const record of changedBudgetRecords) {
        await persistCommandRecord(project.number, "Budget", record);
      }
      await persistCommandRecord(project.number, "Subcontracts", executedRecord);
      onBudgetCodesChange(nextBudgetCodes);
      onRecordsChange([
        executedRecord,
        ...records.filter((record) => record.id !== executedRecord.id),
      ]);
      setSignatureStage("executed");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The Executed Subcontract Could Not Be Saved Permanently.",
      );
    } finally {
      setWorkflowSaving(false);
    }
  }

  if (!creating) {
    return (
      <div className="module-workspace subcontract-workspace">
        <section className="workspace-heading">
          <div>
            <p className="eyebrow orange-text">{project.name}</p>
            <h1>Subcontracts</h1>

          </div>
          <button className="primary-action large" disabled={!budgetReady} onClick={startNew}>
            ＋ Create Subcontract
          </button>
        </section>
        {!budgetReady ? <section className="budget-prerequisite"><span>1</span><div><strong>Locked Original Budget Required</strong><p>Select project cost codes enter a positive original budget and lock it before creating a subcontract.</p></div><button className="primary-action" onClick={onOpenBudget}>Open Budget Setup</button></section> : null}

        <section className="module-summary subcontract-summary">
          <article {...summaryDrilldownProps({ title: "Executed Subcontracts", rows: records.filter((record) => record.status === "Executed").map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, onOpen: () => onOpenRecord(record), openLabel: "Open Agreement →" })) })}>
            <strong>{records.filter((record) => record.status === "Executed").length}</strong>
            <span>Executed</span>
          </article>
          <article {...summaryDrilldownProps({ title: "Draft Subcontracts", rows: records.filter((record) => record.status === "Draft").map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, onOpen: () => record.data?.subcontractor ? resumeSubcontractDraft(record) : onOpenRecord(record), openLabel: "Open Draft →" })) })}>
            <strong>{records.filter((record) => record.status === "Draft").length}</strong>
            <span>Drafts</span>
          </article>
          <article {...summaryDrilldownProps({ title: "Subcontracts Awaiting Approval", rows: records.filter((record) => ["Pending Approval", "Awaiting Approval"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, onOpen: () => onOpenRecord(record), openLabel: "Open Approval →" })), emptyText: approvalStatus === "pending" ? "The current in-progress subcontract is awaiting approval." : "No subcontracts await approval." })}>
            <strong>{approvalStatus === "pending" ? 1 : 0}</strong>
            <span>Awaiting Approval</span>
          </article>
          <article {...summaryDrilldownProps({ title: "Subcontracts Awaiting Signatures", rows: records.filter((record) => ["Awaiting Signature", "Awaiting Signatures", "Sent"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: record.meta, status: record.status, onOpen: () => onOpenRecord(record), openLabel: "Open Signature Packet →" })), emptyText: sent && signatureStage !== "executed" ? "The current subcontract package is awaiting signatures." : "No subcontract packages await signatures." })}>
            <strong>{sent && signatureStage !== "executed" ? 1 : 0}</strong>
            <span>Awaiting Signatures</span>
          </article>
        </section>
        <section className="records-panel" data-reflow-table="">
          <div className="records-tools">
            <div>
              <strong>Current Agreements</strong>
              <span>
                Pricing is restricted to office staff, project managers,
                administrators, and Company Owners.
              </span>
            </div>
            <button disabled={!budgetReady} onClick={startNew}>Start From Master</button>
          </div>
          <div className="record-head" data-reflow-head="medium">
            <span>Record</span>
            <span>Subcontractor / Scope</span>
            <span>Prepared By</span>
            <span>Issued</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {records.map((record) => (
            <button className="record-row" key={record.id} onClick={() => record.status === "Draft" && record.data?.subcontractor ? resumeSubcontractDraft(record) : onOpenRecord(record)} data-reflow-row="medium">
              <span className="record-id" data-label="Record">{record.id}</span>
              <span className="record-title" data-label="Subcontractor / Scope">
                <strong>{record.title}</strong>
                <small>{record.meta}</small>
              </span>
              <span data-label="Prepared By">{record.owner}</span>
              <span data-label="Issued">{record.due}</span>
              <span data-label="Status">
                <i className={`status-badge ${record.status === "Executed" ? "executed" : "pending"}`}>{record.status}</i>
              </span>
              <span className="record-action-label" data-label="Action">
                {record.status === "Draft" && record.data?.subcontractor
                  ? "Resume ›"
                  : "Open ›"}
              </span>
            </button>
          ))}
        </section>

      </div>
    );
  }

  return (
    <div className="module-workspace subcontract-workspace">
      <section className="workspace-heading">
        <div>
          <p className="eyebrow orange-text">
            {project.name} · NEW SUBCONTRACT
          </p>
          <h1>Create A Subcontract</h1>

        </div>
        <div className="workspace-heading-actions">
          {activeDraftRecord?.data?.preparedFromOwnerProjectAward ? <button className="danger-action" disabled={workflowSaving} onClick={() => void markPreparedDraftDoNotAward()}>Do Not Award</button> : null}
          <button className="secondary-action" onClick={() => setCreating(false)}>
            Save & Close
          </button>
        </div>
      </section>
      <ol className="contract-stepper" aria-label="Subcontract creation steps">
        {steps.map((label, index) => (
          <li
            key={label}
            className={
              step === index + 1 ? "active" : step > index + 1 ? "complete" : ""
            }
          >
            <button
              onClick={() => index + 1 < step && editEarlierStep(index + 1)}
            >
              <span>{step > index + 1 ? "✓" : index + 1}</span>
              <b>{label}</b>
            </button>
          </li>
        ))}
      </ol>

      <section className="contract-form-card">
        {step === 1 ? (
          <>
            <div className="contract-card-heading">
              <div>

                <h2>Confirm Project Information</h2>
                <span>
                  These locked items came directly from the {project.name}{" "}
                  project profile.
                </span>
              </div>
              <span className="autofill-pill">
                {subcontractProjectFields.length} Fields Auto-Filled
              </span>
            </div>
            <div className="autofill-grid">
              {subcontractProjectFields.map((field) => (
                <article key={field.label}>
                  <span>{field.label}</span>
                  <strong>{field.value}</strong>
                  <small>✓ {field.detail}</small>
                </article>
              ))}
            </div>
            <div className="project-profile-source">
              <span>✓</span>
              <div>
                <strong>Project Profile Complete</strong>

              </div>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="contract-card-heading">
              <div>

                <h2>Answer The Subcontract Questions</h2>

              </div>
              <span className="template-version">
                Master v1 · Legal Text Locked
              </span>
            </div>
            <label className="field-label subcontract-date-field">
              Subcontract Draft Date
              <input
                type="date"
                value={subcontractDate}
                onChange={(event) => setSubcontractDate(event.target.value)}
              />
              <small className="field-source">
                Starts With Today’s Date · Editable Before Distribution
              </small>
            </label>
            <div className="field-grid">
              <label className="field-label">
                Subcontractor company
                <select
                  value={subcontractor}
                  onChange={(event) => setSubcontractor(event.target.value)}
                >
                  <option value="">Select A Subcontractor</option>
                  <option>Bluegrass Electric</option>
                  <option>Commonwealth Plumbing</option>
                  <option>Central Kentucky Concrete</option>
                  <option>Enter a new subcontractor…</option>
                </select>
              </label>
              <label className="field-label">
                Subcontract price
                <input
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => {
                    const nextPrice = event.target.value;
                    setPrice(nextPrice);
                    setCostAllocations((current) =>
                      current.length === 1
                        ? [{ ...current[0], amount: nextPrice }]
                        : current,
                    );
                  }}
                />
              </label>
            </div>
            <section className="subcontract-allocation-card">
              <div className="subcontract-allocation-heading">
                <div><h3>Subcontract Cost Code Allocations</h3></div>
                <button className="secondary-action" type="button" onClick={addAllocation}>＋ Add Allocation</button>
              </div>
              <div className="subcontract-allocation-list">
                {costAllocations.map((allocation, index) => {
                  const comparison = subcontractBudgetComparison(
                    allocation,
                    budgetCodes,
                  );
                  return <section className="subcontract-allocation-item" key={allocation.id}>
                    <div className="subcontract-allocation-row">
                      <span>{index + 1}</span>
                      <label className="field-label">Project Cost Code<select aria-label={`Cost Code Allocation ${index + 1}`} value={allocation.costCode} onChange={(event) => selectAllocationCostCode(allocation.id, event.target.value)}><option value="">Select From The Locked Project Budget</option><BudgetCostCodeOptions records={projectBudgetCodes} /></select></label>
                      <label className="field-label">This Subcontract Amount<CurrencyInput aria-label={`Allocated Amount ${index + 1}`} min="0" value={allocation.amount} onValueChange={(value) => updateAllocation(allocation.id, { amount: value })} /></label>
                      <button type="button" aria-label={`Remove Allocation ${index + 1}`} disabled={costAllocations.length === 1} onClick={() => setCostAllocations((current) => current.filter((item) => item.id !== allocation.id))}>×</button>
                    </div>
                    {allocation.costCode ? <div className="subcontract-budget-comparison">
                      <span><small>Locked Original Budget</small><strong>{formatCurrency(comparison.lockedOriginalBudget)}</strong>{comparison.approvedChanges ? <i>{comparison.approvedChanges > 0 ? "+" : ""}{formatCurrency(comparison.approvedChanges)} Approved Changes</i> : null}</span>
                      <span><small>Previously Committed</small><strong>{formatCurrency(comparison.previousCommitted)}</strong></span>
                      <span><small>Available Before This Subcontract</small><strong>{formatCurrency(comparison.availableBefore)}</strong></span>
                      <span><small>This Subcontract</small><strong>{formatCurrency(comparison.subcontractAmount)}</strong></span>
                      <span className={comparison.buyoutVariance < 0 ? "over-budget" : comparison.buyoutVariance > 0 ? "buyout-positive" : "on-budget"}><small>{comparison.buyoutVariance < 0 ? "Over Budget" : comparison.buyoutVariance > 0 ? "Locked-In Buyout" : "On Budget"}</small><strong>{formatCurrency(Math.abs(comparison.buyoutVariance))}</strong></span>
                    </div> : null}
                  </section>;
                })}
              </div>
              <div className="subcontract-allocation-summary"><span><small>Subcontract Price</small><strong>{formatCurrency(Number(price || 0))}</strong></span><span><small>Allocated</small><strong>{formatCurrency(allocationTotal)}</strong></span><span className={Math.abs(allocationRemaining) < 0.005 ? "balanced" : "unbalanced"}><small>Remaining</small><strong>{formatCurrency(allocationRemaining)}</strong></span></div>
              {selectedBudgetComparisons.length ? <div className="subcontract-buyout-summary"><span><small>Selected Cost Code Budget</small><strong>{formatCurrency(comparisonTotals.budget)}</strong></span><span><small>Previously Committed</small><strong>{formatCurrency(comparisonTotals.previousCommitted)}</strong></span><span><small>This Subcontract</small><strong>{formatCurrency(comparisonTotals.subcontract)}</strong></span><span className={comparisonTotals.buyout < 0 ? "over-budget" : comparisonTotals.buyout > 0 ? "buyout-positive" : "on-budget"}><small>{comparisonTotals.buyout < 0 ? "Total Over Budget" : comparisonTotals.buyout > 0 ? "Total Locked-In Buyout" : "Total On Budget"}</small><strong>{formatCurrency(Math.abs(comparisonTotals.buyout))}</strong></span></div> : null}

            </section>
            <div className="field-grid">
              <label className="field-label">
                Authorized signer
                <input
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  placeholder="Full legal name"
                />
              </label>
              <label className="field-label">
                Signer title
                <input
                  value={signerTitle}
                  onChange={(event) => setSignerTitle(event.target.value)}
                />
              </label>
            </div>
            <label className="field-label">
              Signer email
              <input
                type="email"
                value={signerEmail}
                onChange={(event) => setSignerEmail(event.target.value)}
                placeholder="Used for signature distribution"
              />
            </label>
            <div className="field-grid">
              <label className="field-label">
                Retainage percentage
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={retainage}
                  onChange={(event) => setRetainage(event.target.value)}
                />
              </label>
              <label className="field-label">
                Liquidated damages
                <input
                  value={liquidatedDamages}
                  onChange={(event) => setLiquidatedDamages(event.target.value)}
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field-label">
                Substantial completion
                <input
                  type="date"
                  value={substantialDate}
                  onChange={(event) => setSubstantialDate(event.target.value)}
                />
              </label>
              <label className="field-label">
                Final completion
                <input
                  type="date"
                  value={finalDate}
                  onChange={(event) => setFinalDate(event.target.value)}
                />
                <small className="field-source">
                  Suggested from {project.name} schedule
                </small>
              </label>
            </div>
            <div className="field-grid">
              <label className="field-label">
                Commercial general liability limit
                <input
                  inputMode="decimal"
                  value={cglLimit}
                  onChange={(event) => setCglLimit(event.target.value)}
                />
              </label>
              <label className="field-label">
                Workers’ compensation limit
                <input
                  inputMode="decimal"
                  value={workersCompLimit}
                  onChange={(event) => setWorkersCompLimit(event.target.value)}
                />
              </label>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="contract-card-heading">
              <div>

                <h2>Define The Work</h2>

              </div>
            </div>
            <label className="field-label">
              Direct scope of work
              <textarea
                rows={8}
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                placeholder="Describe inclusions, exclusions, alternates, allowances, coordination, and closeout requirements."
              />
            </label>
            <label className="proposal-upload">
              <input
                type="file"
                onChange={(event) =>
                  setProposalName(event.target.files?.[0]?.name ?? "")
                }
              />
              <span>＋</span>
              <span>
                <strong>Attach subcontractor proposal</strong>
                <small>Any File Type · Appended To Exhibit A</small>
              </span>
              <b>{proposalName || "Choose file"}</b>
            </label>
            <div className="scope-check">
              <span>✓ Direct Mefford scope included</span>
              <span className={proposalName ? "" : "missing"}>
                {proposalName
                  ? "✓ Proposal ready to append"
                  : "! Proposal not attached"}
              </span>
              <span>✓ Exhibits B, C, and D included</span>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="contract-card-heading">
              <div>

                <h2>Review The Signature Packet</h2>

              </div>
              <span className="template-version">
                12-Page Master + Proposal
              </span>
            </div>
            <div className="review-columns">
              <section>
                <h3>Auto-Filled From {project.name}</h3>
                {subcontractProjectFields.map((field) => (
                  <div key={field.label}>
                    <span>{field.label}</span>
                    <strong>{field.value}</strong>
                  </div>
                ))}
              </section>
              <section>
                <h3>Answered For This Subcontract</h3>
                <div>
                  <span>Subcontract Draft Date</span>
                  <strong>{displayProjectDate(subcontractDate)}</strong>
                </div>
                <div>
                  <span>Subcontractor</span>
                  <strong>{subcontractor}</strong>
                </div>
                <div>
                  <span>Price</span>
                  <strong>
                    $
                    {Number(price || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </div>
                <div className="review-cost-allocations">
                  <span>Internal Cost Code Allocations</span>
                  <strong>{costAllocations.length} Allocation{costAllocations.length === 1 ? "" : "s"} · {formatCurrency(allocationTotal)}</strong>
                  <ul>
                    {costAllocations.map((allocation) => {
                      const comparison = subcontractBudgetComparison(
                        allocation,
                        budgetCodes,
                      );
                      return <li key={allocation.id}><span><strong>{allocation.costCode} · {comparison.description}</strong><small>Budget {formatCurrency(comparison.currentBudget)} · Previously Committed {formatCurrency(comparison.previousCommitted)} · This Subcontract {formatCurrency(comparison.subcontractAmount)}</small></span><b className={comparison.buyoutVariance < 0 ? "over-budget" : comparison.buyoutVariance > 0 ? "buyout-positive" : "on-budget"}>{comparison.buyoutVariance < 0 ? "Over Budget" : comparison.buyoutVariance > 0 ? "Locked-In Buyout" : "On Budget"}<em>{formatCurrency(Math.abs(comparison.buyoutVariance))}</em></b></li>;
                    })}
                  </ul>
                  <div className={`review-buyout-total ${comparisonTotals.buyout < 0 ? "over-budget" : comparisonTotals.buyout > 0 ? "buyout-positive" : "on-budget"}`}><span>{comparisonTotals.buyout < 0 ? "Total Over Budget" : comparisonTotals.buyout > 0 ? "Total Locked-In Buyout" : "Total On Budget"}</span><strong>{formatCurrency(Math.abs(comparisonTotals.buyout))}</strong></div>
                  <small>Internal Only · Not Added To The Legal Agreement</small>
                </div>
                <div>
                  <span>Signer</span>
                  <strong>
                    {signerName} · {signerTitle}
                  </strong>
                </div>
                <div>
                  <span>Signature email</span>
                  <strong>{signerEmail}</strong>
                </div>
                <div>
                  <span>Completion</span>
                  <strong>
                    {numericDateFromInput(substantialDate)} / {numericDateFromInput(finalDate)}
                  </strong>
                </div>
                <div>
                  <span>Exhibit A proposal</span>
                  <strong>{proposalName || "Not attached"}</strong>
                </div>
              </section>
            </div>
            <section className="countersigner-assignment">
              <div>

                <h3>Assign The Mefford Countersigner</h3>

              </div>
              <label>
                Mefford Countersigner
                <select
                  value={meffordCountersigner}
                  disabled={approvalStatus === "approved" || sent}
                  onChange={(event) => {
                    setMeffordCountersigner(event.target.value);
                    setApprovalChecked(false);
                  }}
                >
                  {MEFFORD_COMPANY_DIRECTORY.filter((member) => member.accessLevel === "Company Owner").map((member) => <option key={member.email} value={member.name}>{member.name} · Company Owner</option>)}
                </select>
                <small>
                  {meffordCountersigner} · {meffordCountersignerRole} · Microsoft
                  Account
                </small>
              </label>
            </section>
            <section className="packet-contents">
              <h3>Packet contents</h3>
              <span>
                <i>1</i>Full Subcontract Agreement
              </span>
              <span>
                <i>A</i>Direct scope + proposal
              </span>
              <span>
                <i>B</i>Insurance acknowledgement + initials
              </span>
              <span>
                <i>C</i>Safety acknowledgement + initials
              </span>
              <span>
                <i>D</i>Procedures acknowledgement + initials
              </span>
            </section>
            <section className="persistent-contract-preview">
              <span className="preview-document-icon">12</span>
              <div>
                <strong>Complete Contract Preview</strong>

              </div>
              <button
                className="secondary-action"
                onClick={() => setPacketOpen(true)}
              >
                Preview Complete Contract
              </button>
            </section>
            {!generated ? (
              <div className="generate-panel">
                <div>
                  <strong>Ready To Assemble</strong>

                </div>
                <button
                  className="primary-action large"
                  disabled={workflowSaving}
                  onClick={generatePacket}
                >
                  {workflowSaving ? "Saving Draft..." : "Generate Signable PDF"}
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`release-state ${approvalStatus}`}
                  role="status"
                >
                  <span>{approvalStatus === "draft" ? "1" : "✓"}</span>
                  <div>
                    <strong>
                      {approvalStatus === "draft"
                        ? "Draft Ready For Submission"
                        : approvalStatus === "pending"
                          ? "Awaiting Company Owner Or Administrator Approval"
                          : "Approved For Signature Distribution"}
                    </strong>
                    <small>
                      {approvalStatus === "draft"
                        ? "A project manager may submit this completed packet for release approval."
                        : approvalStatus === "pending"
                          ? "Distribution remains locked until a Company Owner or Administrator checks off the packet."
                          : "Jordan Mefford Approved This Exact Packet As Company Owner."}
                    </small>
                  </div>
                </div>
                <div className="generated-panel">
                  <span className="pdf-ready">PDF</span>
                  <div>
                    <strong>{subcontractRecordId || "Pending Number"} · {subcontractor} · Draft.pdf</strong>
                    <span>
                      Generated just now · Signature fields placed ·{" "}
                      {approvalStatus === "approved"
                        ? "Release approved"
                        : "Distribution locked"}
                    </span>
                  </div>
                  {approvalStatus === "draft" ? (
                    <button
                      className="primary-action"
                      disabled={workflowSaving}
                      onClick={submitForApproval}
                    >
                      {workflowSaving ? "Saving..." : "Submit For Approval"}
                    </button>
                  ) : approvalStatus === "pending" ? (
                    <button className="primary-action release-locked" disabled>
                      Distribution Locked
                    </button>
                  ) : (
                    <button
                      className="primary-action"
                      disabled={signatureStage !== "not_sent" || workflowSaving}
                      onClick={distributeForSignature}
                    >
                      {signatureStage === "not_sent"
                        ? "Send To Subcontractor First"
                        : signatureStage === "awaiting_subcontractor"
                          ? "Awaiting Subcontractor Signature"
                          : signatureStage === "awaiting_mefford"
                            ? "Awaiting Mefford Countersignature"
                            : "Fully Executed"}
                    </button>
                  )}
                </div>
                {approvalStatus === "pending" ? (
                  <section
                    className="release-approval-panel"
                    aria-labelledby="release-approval-title"
                  >
                    <div className="release-approval-heading">
                      <span>OA</span>
                      <div>

                        <h3 id="release-approval-title">
                          Approve This Packet For Signature
                        </h3>
                        <small>
                          Submitted By {project.projectManager || "Project Manager Not Assigned"} · Just Now
                        </small>
                      </div>
                    </div>
                    <div className="approval-authority">
                      <span>
                        <small>Current Approver</small>
                        <strong>Jordan Mefford</strong>
                      </span>
                      <span>
                        <small>Role</small>
                        <strong>Company Owner</strong>
                      </span>
                      <span>
                        <small>Packet</small>
                        <strong>{subcontractRecordId || "Pending Number"} · Exact Generated Version</strong>
                      </span>
                      <span>
                        <small>Assigned Mefford Countersigner</small>
                        <strong>
                          {meffordCountersigner} · {meffordCountersignerRole}
                        </strong>
                      </span>
                    </div>
                    <label className="release-check">
                      <input
                        type="checkbox"
                        checked={approvalChecked}
                        onChange={(event) =>
                          setApprovalChecked(event.target.checked)
                        }
                      />
                      <span>
                        <strong>I Reviewed The Complete Subcontract</strong>
                        <small>
                          I approve this exact packet for distribution to the
                          listed signers.
                        </small>
                      </span>
                    </label>
                    <button
                      className="primary-action large"
                      disabled={!approvalChecked || workflowSaving}
                      onClick={approveRelease}
                    >
                      {workflowSaving ? "Saving Approval..." : "Approve For Signature"}
                    </button>
                  </section>
                ) : null}
                {approvalStatus === "approved" ? (
                  <>
                    <section className="release-approved-panel">
                      <span>✓</span>
                      <div>
                        <strong>Release Approved!</strong>
                        <small>
                          Approved By Jordan Mefford · Company Owner ·
                          Countersigner {meffordCountersigner} · Just Now
                        </small>
                      </div>
                      <b>Audit Record Saved</b>
                    </section>
                    <section className="signature-routing-panel">
                      <div className="signature-routing-heading">
                        <div>

                          <h3>Required Signature Order</h3>
                        </div>
                        <span>{signatureStage === "executed" ? "Fully Executed" : sent ? "Signing In Progress" : "Ready To Send"}</span>
                      </div>
                      <ol className="signature-route">
                        <li className="complete"><span>✓</span><div><strong>Release Approved</strong><small>Company Owner / Administrator</small></div></li>
                        <li className={sent ? "complete" : "active"}><span>{sent ? "✓" : "2"}</span><div><strong>Send To Subcontractor</strong><small>{signerEmail || "Signer Email Required"}</small></div></li>
                        <li className={signatureStage === "awaiting_subcontractor" ? "active" : signatureStage === "awaiting_mefford" || signatureStage === "executed" ? "complete" : "locked"}><span>{signatureStage === "awaiting_mefford" || signatureStage === "executed" ? "✓" : "3"}</span><div><strong>Subcontractor Signs</strong><small>{signatureStage === "awaiting_subcontractor" ? `Waiting On ${signerName}` : signatureStage === "awaiting_mefford" || signatureStage === "executed" ? `Signed By ${signerName}` : "Locked Until Sent"}</small></div></li>
                        <li className={signatureStage === "awaiting_mefford" ? "active" : signatureStage === "executed" ? "complete" : "locked"}><span>{signatureStage === "executed" ? "✓" : "4"}</span><div><strong>Mefford Countersigns</strong><small>{signatureStage === "awaiting_mefford" ? `${meffordCountersigner} Notified` : signatureStage === "executed" ? `Countersigned By ${meffordCountersigner}` : `Assigned To ${meffordCountersigner}`}</small></div></li>
                        <li className={signatureStage === "executed" ? "complete" : "locked"}><span>{signatureStage === "executed" ? "✓" : "5"}</span><div><strong>Executed PDF Filed</strong><small>{signatureStage === "executed" ? "Distributed And Saved To Project Files" : "Automatic After Both Signatures"}</small></div></li>
                      </ol>
                      {signatureStage === "awaiting_subcontractor" ? <button className="secondary-action signature-workflow-action" disabled={workflowSaving} onClick={recordSubcontractorSignature}>Record Subcontractor Signature</button> : null}
                      {signatureStage === "awaiting_mefford" ? <button className="primary-action signature-workflow-action" disabled={workflowSaving} onClick={recordMeffordCountersignature}>Record Mefford Countersignature</button> : null}
                      {signatureStage === "executed" ? <div className="executed-packet-notice"><span>✓</span><div><strong>Fully Executed Subcontract!</strong><small>Final PDF sent to both signers and filed under Project Files › Contracts.</small></div></div> : null}
                    </section>
                  </>
                ) : null}
              </>
            )}
            {sent ? (
              <div className="inline-success">
                {signatureStage === "awaiting_subcontractor"
                  ? `Signature package sent to ${signerName} at ${signerEmail}. Mefford’s signer remains locked until the subcontractor signs.`
                  : signatureStage === "awaiting_mefford"
                    ? `${signerName} signed the packet. ${meffordCountersigner} was notified to countersign.`
                    : "Both signatures are complete. The final PDF was distributed and filed automatically."}
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
        <div className="contract-form-actions">
          <button
            className="secondary-action"
            onClick={() =>
              step === 1 ? setCreating(false) : editEarlierStep(step - 1)
            }
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          {step < 4 ? (
            <button className="primary-action large" onClick={nextStep}>
              Continue →
            </button>
          ) : (
            <button
              className="secondary-action"
              onClick={() => editEarlierStep(1)}
            >
              Edit Answers
            </button>
          )}
        </div>
      </section>

      {packetOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setPacketOpen(false)
          }
        >
          <FullSubcontractPreview
            projectName={project.name}
            projectNumber={project.number}
            subcontractDate={displayProjectDate(subcontractDate)}
            constructionSite={project.site}
            ownerName={ownerName}
            ownerContractDate={ownerContractDate}
            architect={architect}
            subcontractor={subcontractor}
            signerName={signerName}
            signerTitle={signerTitle}
            signerEmail={signerEmail}
            price={price}
            retainage={retainage}
            substantialDate={displayProjectDate(substantialDate)}
            finalDate={displayProjectDate(finalDate)}
            cglLimit={cglLimit}
            workersCompLimit={workersCompLimit}
            liquidatedDamages={liquidatedDamages}
            scope={scope}
            proposalName={proposalName}
            onClose={() => setPacketOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function Mark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mefford-logo.png" alt="" />
    </div>
  );
}

type CommandSessionActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
  permissionLocked?: boolean;
  onboardingStatus?: string;
  onboardingProgress?: number;
  onboardingDeadline?: string;
};

type ProjectWeatherSnapshot = {
  status: "idle" | "loading" | "ready" | "location_required" | "unavailable";
  requestKey: string;
  conditions: string;
  high: number | null;
  low: number | null;
  source: string;
};

type DailyWeatherMetrics = {
  rainfallInches: string;
  averageTemperatureF: string;
  averageWindSpeedMph: string;
  averageConditions: string;
  capturedAt: string;
  resolvedAddress: string;
};

function blankDailyWeatherMetrics(): DailyWeatherMetrics {
  return {
    rainfallInches: "",
    averageTemperatureF: "",
    averageWindSpeedMph: "",
    averageConditions: "",
    capturedAt: "",
    resolvedAddress: "",
  };
}

function dailyWeatherMetricSummary(metrics: DailyWeatherMetrics) {
  if (
    !metrics.rainfallInches.trim() ||
    !metrics.averageTemperatureF.trim() ||
    !metrics.averageWindSpeedMph.trim() ||
    !metrics.averageConditions.trim()
  ) return "Complete The Daily Weather Report";
  return `Rainfall ${Number(metrics.rainfallInches).toFixed(2)} in · Avg Temp ${Math.round(Number(metrics.averageTemperatureF))}°F · Avg Wind ${Math.round(Number(metrics.averageWindSpeedMph))} mph · Avg Conditions ${metrics.averageConditions.trim()}`;
}

const projectManagerNavigation = new Set([
  "Project Health",
  "Project Overview",
  "Contracts",
  "Subcontracts",
  "Change Orders",
  "Purchase Orders",
  "Project Owner Meetings",
  "Project Design Meetings",
  "Project Subcontractor Meetings",
  "Daily Logs",
  "Safety",
  "RFIs",
  "Submittals",
  "Schedule",
  "Selections",
  "Budget",
  "Procurement",
  "Quality",
  "Design & Drawings",
  "Documents",
  "Closeout",
  "Lien Waivers",
  "Team",
  "Project Settings",
]);

const superintendentNavigation = new Set([
  "Project Health",
  "Project Overview",
  "Change Orders",
  "Project Owner Meetings",
  "Project Design Meetings",
  "Project Subcontractor Meetings",
  "Daily Logs",
  "Safety",
  "RFIs",
  "Submittals",
  "Schedule",
  "Selections",
  "Quality",
  "Design & Drawings",
  "Documents",
  "Closeout",
]);

const officeStaffNavigation = new Set([
  "Project Overview",
  "Contracts",
  "Subcontracts",
  "Change Orders",
  "Purchase Orders",
  "Project Owner Meetings",
  "Project Design Meetings",
  "Project Subcontractor Meetings",
  "Daily Logs",
  "Safety",
  "RFIs",
  "Submittals",
  "Schedule",
  "Selections",
  "Budget",
  "Procurement",
  "Quality",
  "Design & Drawings",
  "Documents",
  "Closeout",
  "Team",
]);

function canActorAccessNavigation(
  actor: CommandSessionActor,
  target: string,
) {
  if (actor.permissionLocked) return target === "Employee Portal" || target === "User Guide";
  if (target === "User Guide") return true;
  if (target === "Employee Portal") return true;
  if (target === "Dashboard") {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel);
  }
  if (target === "Owner Approvals") return actor.accessLevel === "Company Owner";
  if (["Admin Command", "Admin Goals", "Admin Access"].includes(target)) {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel);
  }
  if (target === "Admin People") {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["Human Resources", "Benefits Administrator"].includes(designation));
  }
  if (target === "Admin Requests") {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["Human Resources", "Benefits Administrator", "IT Administrator", "Marketing", "Accountant", "Financial Administrator", "Accounting Manager"].includes(designation));
  }
  if (target === "Admin Templates") {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["Human Resources", "Benefits Administrator", "Attorney", "Safety Director", "Safety"].includes(designation));
  }
  if (target === "Admin Operations") {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["IT Administrator", "Fleet Manager", "Asset Manager", "Office Staff"].includes(designation));
  }
  if (target === "Employee Onboarding") return ["Company Owner", "Administrator"].includes(actor.accessLevel);
  if (target === "My Work") return true;
  if (target === "Company Calendar") return true;
  const departmentRoles = DEPARTMENT_MEETING_ROLES[MEETING_TYPE_BY_TARGET[target]];
  if (departmentRoles) return actor.accessLevel === "Company Owner" || (target !== "Accounting Department" && actor.accessLevel === "Administrator") || actor.designations.some(role => departmentRoles.includes(role));
  if (["Quarterly Rock/Review", "Weekly L10"].includes(target)) {
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["Project Manager", "Superintendent", "Office Staff"].includes(designation));
  }
  if (target === "Sales Goals") {
    return actor.accessLevel === "Company Owner";
  }
  if (target === "Performance Reviews") {
    return actor.accessLevel === "Company Owner";
  }
  if (target === "Assets & Fleet") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.some((designation) => ["Fleet Manager", "Asset Manager", "Office Staff", "Project Manager", "Superintendent", "Safety Director", "Safety", "Accountant", "Accounting Manager", "Financial Administrator"].includes(designation))
    );
  }
  if (target === "IT & Integrations" || target === "Integration Health") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("IT Administrator") ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      actor.designations.includes("Marketing") ||
      actor.designations.includes("Project Manager")
    );
  }
  if (target === "Owner Billing") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Project Manager") ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      actor.designations.includes("Accounting Manager")
    );
  }
  if (target === "Vendor Management") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      actor.designations.includes("Accounting Manager")
    );
  }
  if (target === "Lien Waivers") {
    return (
      ["Company Owner", "Administrator"].includes(actor.accessLevel) ||
      actor.designations.includes("Project Manager") ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      actor.designations.includes("Accounting Manager") ||
      actor.designations.includes("Office Staff")
    );
  }
  if (accountingNavigationTargets.includes(target as AccountingMode)) {
    return (
      actor.accessLevel === "Company Owner" ||
      actor.designations.includes("Accountant") ||
      actor.designations.includes("Financial Administrator") ||
      actor.designations.includes("Accounting Manager")
    );
  }
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    return true;
  }
  if (["Project Overview", "Documents", "Design & Drawings"].includes(target)) return true;
  if (["Marketing", "Marketing Social", "Marketing Email", "Marketing Surveys", "Marketing Calendar"].includes(target)) {
    return actor.designations.includes("Marketing") || actor.designations.includes("Sales Representative") || actor.designations.includes("Sales Manager");
  }
  if (target === "Bid Management") return actor.designations.includes("Estimator") || actor.designations.includes("Estimating Manager");
  if (["Sales Dashboard", "Sales Contacts", "Sales Funnel", "Sales Design", "Estimating", "Estimating Calendar"].includes(target)) {
    return (
      actor.designations.includes("Estimator") ||
      actor.designations.includes("Estimating Manager") ||
      actor.designations.includes("Sales Representative") ||
      actor.designations.includes("Sales Manager")
    );
  }
  if (
    actor.designations.includes("Project Manager") &&
    projectManagerNavigation.has(target)
  ) {
    return true;
  }
  if (
    actor.designations.includes("Superintendent") &&
    superintendentNavigation.has(target)
  ) {
    return true;
  }
  if (
    actor.designations.includes("Office Staff") &&
    officeStaffNavigation.has(target)
  ) {
    return true;
  }
  if (
    actor.designations.some((designation) => ["Safety Director", "Safety"].includes(designation)) &&
    ["Daily Logs", "Safety"].includes(target)
  ) {
    return true;
  }
  return actor.designations.includes("Attorney") && target === "Review";
}

type PortfolioRecord = RecordItem & { type: string };

function dashboardDateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dashboardScheduleFinish(record: PortfolioRecord) {
  const start = String(record.data?.start || record.recordDate || "");
  const explicitFinish = String(record.data?.finish || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicitFinish)) return explicitFinish;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
  const rawDuration = Number(record.data?.days || 1);
  const duration = Number.isFinite(rawDuration)
    ? Math.max(1, Math.round(rawDuration))
    : 1;
  return dashboardDateOffset(start, duration - 1);
}

function dashboardDailyLogPeople(record: PortfolioRecord) {
  const employees = Array.isArray(record.data?.employeesOnSite)
    ? record.data.employeesOnSite.length
    : 0;
  const subcontractors = Array.isArray(record.data?.subcontractorsOnSite)
    ? record.data.subcontractorsOnSite.length
    : 0;
  return employees + subcontractors;
}

type ExecutiveDecision = {
  id: string;
  priority: "Critical" | "High" | "Watch";
  category: string;
  title: string;
  explanation: string;
  project?: ProjectProfile;
  projectLabel: string;
  responsible: string;
  due: string;
  target: string;
  recordId?: string;
  amount: number;
};

function dashboardRecordAmount(record: PortfolioRecord) {
  const data = record.data ?? {};
  for (const key of [
    "total",
    "approvedTotal",
    "changeAmount",
    "subcontractAmount",
    "contractAmount",
    "purchaseOrderAmount",
    "amount",
  ]) {
    const value = Number(data[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function dashboardRecordDue(record: PortfolioRecord) {
  const data = record.data ?? {};
  const value = String(
    data.expectedAwardDate ||
      data.bidDueDate ||
      data.nextFollowUpDate ||
      record.due ||
      record.recordDate ||
      "",
  );
  return value && value !== "Not Set" ? value : "Needs A Date";
}

function dashboardDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return displayProjectDate(value);
}

function daysUntilDashboardDate(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Math.round(
    (new Date(`${value}T12:00:00Z`).getTime() -
      new Date(`${today}T12:00:00Z`).getTime()) /
      86_400_000,
  );
}

function projectDashboardDecisions(
  project: ProjectProfile,
  projectRecords: PortfolioRecord[],
  today: string,
) {
  const decisions: ExecutiveDecision[] = [];
  const add = (
    decision: Omit<ExecutiveDecision, "id" | "project" | "projectLabel"> & {
      id?: string;
    },
  ) =>
    decisions.push({
      ...decision,
      id: decision.id || `${project.number}-${decision.target}-${decisions.length}`,
      project,
      projectLabel: project.name,
    });

  const budgetControl = projectRecords.find(
    (record) => record.type === "Budget Control",
  );
  if (!budgetControl || budgetControl.data?.locked !== true) {
    add({
      priority: "Critical",
      category: "Financial Control",
      title: "Lock The Original Project Budget",
      explanation:
        "Subcontracts And Change Orders Cannot Be Reliably Controlled Until The Original Budget Is Approved And Locked.",
      responsible: "Owner Or Administrator",
      due: "Now",
      target: "Budget",
      amount: 0,
    });
  }

  const executedOwnerContract = projectRecords.some(
    (record) =>
      record.type === "Contracts" &&
      ["Executed", "Approved", "Final"].includes(record.status),
  );
  if (!executedOwnerContract) {
    add({
      priority: "High",
      category: "Contract Control",
      title: "Confirm Owner Contract Execution",
      explanation:
        "The Active Project Does Not Have An Executed Owner Contract Recorded In Command Center.",
      responsible: "Owner Or Administrator",
      due: "Now",
      target: "Contracts",
      amount: Number(project.currentContractAmount || project.contractAmount || 0),
    });
  }

  const scheduleRecords = projectRecords.filter(
    (record) => record.type === "Schedule",
  );
  if (!scheduleRecords.length) {
    add({
      priority: "High",
      category: "Schedule Control",
      title: "Establish The Baseline Schedule",
      explanation:
        "No Schedule Activities Are Recorded So Completion Risk Cannot Be Measured Yet.",
      responsible: project.projectManager || "Project Manager",
      due: "Now",
      target: "Schedule",
      amount: 0,
    });
  }

  const workStarted = !project.startDate || project.startDate <= today;
  const todayLog = projectRecords.some(
    (record) => record.type === "Daily Logs" && record.recordDate === today,
  );
  if (workStarted && !todayLog) {
    add({
      priority: "Watch",
      category: "Field Reporting",
      title: "Confirm Today’s Field Coverage",
      explanation:
        "No Daily Log Has Been Filed Today. Confirm Work Status Manpower Weather And Jobsite Photos.",
      responsible: project.superintendent || "Superintendent",
      due: "Today",
      target: "Daily Logs",
      amount: 0,
    });
  }

  for (const record of projectRecords) {
    const status = record.status.toLowerCase();
    const data = record.data ?? {};
    const amount = dashboardRecordAmount(record);
    const due = dashboardRecordDue(record);
    if (
      record.type === "Subcontracts" &&
      /(owner approval|admin approval|submitted for approval|pending approval|ready for approval)/i.test(
        record.status,
      )
    ) {
      add({ id: `${project.number}-${record.id}`, priority: "Critical", category: "Contract Approval", title: `Approve ${record.title}`, explanation: "A Completed Subcontract Is Waiting For Owner Or Administrator Release Before Signature Distribution.", responsible: "Owner Or Administrator", due, target: "Subcontracts", amount });
    } else if (
      record.type === "Change Orders" &&
      /(owner approval|pending approval|submitted|pricing|in review)/i.test(
        record.status,
      )
    ) {
      add({ id: `${project.number}-${record.id}`, priority: status.includes("owner") ? "Critical" : "High", category: "Change Decision", title: `Resolve ${record.id} · ${record.title}`, explanation: "The Change Requires A Timely Scope Cost Or Approval Decision To Protect The Project.", responsible: status.includes("owner") ? "Company Owner" : project.projectManager, due, target: "Change Orders", amount });
    } else if (
      record.type === "Purchase Orders" &&
      amount > 10_000 &&
      !["approved", "executed", "void", "archived"].includes(status)
    ) {
      add({ id: `${project.number}-${record.id}`, priority: "Critical", category: "Purchase Approval", title: `Approve ${record.id} · ${record.title}`, explanation: "This Purchase Order Exceeds The $10,000.00 Owner Approval Threshold.", responsible: "Company Owner", due, target: "Purchase Orders", amount });
    } else if (
      record.type === "Owner Billing" &&
      record.status === "Owner Approval"
    ) {
      add({ id: `${project.number}-${record.id}`, priority: "Critical", category: "Owner Billing", title: `Finalize ${record.title}`, explanation: "Project Manager And Accounting Review Are Complete. Owner Finalization Is Required Before The Invoice Is Ready To Send.", responsible: "Company Owner", due, target: "Owner Billing", amount: Number(data.currentPaymentDue || amount) });
    } else if (
      ["RFIs", "Submittals", "Selections"].includes(record.type) &&
      ["overdue", "due today", "pm review", "response received", "returned to pm"].includes(status)
    ) {
      const target = record.type;
      add({ id: `${project.number}-${record.id}`, priority: "High", category: record.type === "RFIs" ? "Design Decision" : record.type === "Submittals" ? "Material Decision" : "Owner Selection", title: `Escalate ${record.id} · ${record.title}`, explanation: "This Item Is Due Or Overdue And May Affect Procurement Or The Project Schedule.", responsible: record.owner || project.projectManager, due, target, amount });
    } else if (
      (record.type.toLowerCase().includes("incident") || data.incidentReported === true) &&
      !["closed", "complete", "archived"].includes(status)
    ) {
      add({ id: `${project.number}-${record.id}`, priority: "Critical", category: "Safety Response", title: `Review ${record.id} · ${record.title}`, explanation: "An Open Incident Record Requires Immediate Leadership Review Documentation And Follow-Through.", responsible: "Safety · Administrator · Owner", due, target: "Safety", amount: 0 });
    }
  }

  return decisions;
}

function companyDashboardDecisions(
  recordsByProject: Record<string, PortfolioRecord[]>,
  actor: CommandSessionActor,
  today: string,
) {
  const decisions: ExecutiveDecision[] = [];
  const salesRecords = recordsByProject["MEFFORD-SALES"] ?? [];
  const accountingRecords = recordsByProject["MEFFORD-ACCOUNTING"] ?? [];
  const currentYear = Number(today.slice(0, 4));
  const salesGoalExists = salesRecords.some(
    (record) =>
      record.type === "Sales Goals" &&
      Number(record.data?.year || record.recordDate?.slice(0, 4)) === currentYear,
  );
  if (actor.accessLevel === "Company Owner" && !salesGoalExists) {
    decisions.push({ id: `sales-goal-${currentYear}`, priority: "High", category: "Sales Direction", title: `Set The ${currentYear} Sales Goal`, explanation: "The Company And Salesperson Targets Must Be Established To Measure Pace And Quarterly Performance.", projectLabel: "Mefford Sales", responsible: "Company Owner", due: "Now", target: "Sales Goals", amount: 0 });
  }
  for (const record of salesRecords.filter((item) => item.type === "Owner Proposals")) {
    const data = record.data ?? {};
    const projectName = String(data.projectName || record.title);
    const ownerName = String(data.ownerName || "Project Owner");
    const amount = Number(data.contractPrice || 0);
    if (record.status === "Ready For Review" && actor.accessLevel === "Company Owner") {
      decisions.push({ id: `proposal-review-${record.id}`, priority: "Critical", category: "Proposal Approval", title: `Review ${projectName} Proposal`, explanation: "Company Owner approval is required before this proposal can be sent.", projectLabel: ownerName, responsible: "Company Owner", due: today, target: "Owner Approvals", amount });
    }
    if (record.status === "Approved To Send" && ["Company Owner", "Administrator"].includes(actor.accessLevel)) {
      decisions.push({ id: `proposal-send-${record.id}`, priority: "Critical", category: "Proposal Release", title: `Send ${projectName} Proposal To ${ownerName}`, explanation: "The approved revision is locked and ready for the project owner.", projectLabel: ownerName, responsible: "Owner Or Administrator", due: today, target: "Estimating", recordId: String(data.opportunityId || ""), amount });
    }
  }
  for (const record of salesRecords.filter(
    (item) => item.type === "Sales Opportunities",
  )) {
    const data = record.data ?? {};
    const stage = String(data.stage || record.status);
    if (["Awarded", "Lost"].includes(stage)) continue;
    const followUp = String(data.nextFollowUpDate || "");
    const bidDue = String(data.bidDueDate || "");
    const followUpDays = daysUntilDashboardDate(followUp, today);
    const bidDays = daysUntilDashboardDate(bidDue, today);
    if ((followUpDays !== null && followUpDays <= 0) || (bidDays !== null && bidDays <= 7)) {
      decisions.push({ id: `sales-${record.id}`, priority: bidDays !== null && bidDays <= 2 ? "Critical" : "High", category: "Sales Decision", title: `${record.title} Needs A Sales Move`, explanation: bidDays !== null && bidDays <= 7 ? `The Bid Is Due In ${Math.max(0, bidDays)} Day${bidDays === 1 ? "" : "s"}. Confirm Strategy Pricing And Ownership.` : "The Planned Client Follow-Up Is Due. Confirm The Next Move And Keep The Opportunity Advancing.", projectLabel: String(data.company || "Sales Funnel"), responsible: String(data.assignedRep || record.owner || "Salesperson"), due: bidDue || followUp || "Now", target: "Sales Funnel", amount: Number(data.estimatedValue || 0) });
    }
  }
  for (const record of accountingRecords) {
    const data = record.data ?? {};
    const amount = dashboardRecordAmount(record);
    if (record.type === "AP Invoice" && record.status === "Owner Approval") {
      decisions.push({ id: `accounting-${record.id}`, priority: "Critical", category: "Payment Approval", title: `Approve ${record.title}`, explanation: "Project And Accounting Review Are Complete. Owner Approval Is Required Before Payment Preparation.", projectLabel: "Accounts Payable", responsible: "Company Owner", due: record.due || "Now", target: "Accounts Payable", amount });
    } else if (record.type === "AP Invoice" && data.noPoAlert === true && !["Paid", "Voided", "Archived"].includes(record.status)) {
      decisions.push({ id: `po-alert-${record.id}`, priority: "High", category: "Cost Control", title: `Review Missing PO · ${record.title}`, explanation: "This Project Invoice Exceeds $5,000.00 And Has No Purchase Order Attached. The Alert Does Not Block Processing.", projectLabel: "Accounts Payable", responsible: "Owner And Administrator", due: record.due || "Now", target: "Accounts Payable", amount });
    } else if (record.type === "Payment Batch" && /(owner release|ready for release)/i.test(record.status)) {
      decisions.push({ id: `batch-${record.id}`, priority: "Critical", category: "Cash Release", title: `Release ${record.title}`, explanation: "The Expected Payment Batch Is Prepared And Waiting For Owner Release.", projectLabel: "Cash Management", responsible: "Company Owner", due: record.due || "Now", target: "Accounts Payable", amount: Number(data.total || amount) });
    } else if (record.type === "Wire Request" && /(owner approval|pending)/i.test(record.status)) {
      decisions.push({ id: `wire-${record.id}`, priority: "Critical", category: "Wire Approval", title: `Approve ${record.title}`, explanation: "The Wire Request Must Be Approved Before It Is Initiated Through The Bank.", projectLabel: "Cash Management", responsible: "Company Owner", due: record.due || "Now", target: "Accounts Payable", amount });
    }
  }
  return decisions;
}

function CompanyDashboard({
  projects,
  recordsByProject,
  filesByProject,
  actor,
  onOpenDecision,
  onOpenRecord,
}: {
  projects: ProjectProfile[];
  recordsByProject: Record<string, PortfolioRecord[]>;
  filesByProject: Record<string, ProjectFile[]>;
  actor: CommandSessionActor;
  onOpenDecision: (project: ProjectProfile | undefined, target: string, recordId?: string) => void;
  onOpenRecord: (project: ProjectProfile, target: string, recordId: string) => void;
}) {
  const activeProjects = projects.filter(isContractedActiveProject);
  const canViewCompanyFinancials = ["Company Owner", "Administrator"].includes(
    actor.accessLevel,
  );
  const totalContractValue = activeProjects.reduce(
    (total, project) =>
      total + Number(project.currentContractAmount || project.contractAmount || 0),
    0,
  );
  const today = currentDateInput(companyTimeZone);
  const decisions = [
    ...activeProjects.flatMap((project) =>
      projectDashboardDecisions(
        project,
        recordsByProject[project.number] ?? [],
        today,
      ),
    ),
    ...companyDashboardDecisions(recordsByProject, actor, today),
  ]
    .filter((decision) => canActorAccessNavigation(actor, decision.target))
    .sort((a, b) => {
      const priority = { Critical: 0, High: 1, Watch: 2 };
      return priority[a.priority] - priority[b.priority];
    });
  const immediateDecisions = decisions.filter((item) =>
    ["Critical", "High"].includes(item.priority),
  );
  const scheduledToday = activeProjects
    .flatMap((project) =>
      (recordsByProject[project.number] ?? [])
        .filter((record) => record.type === "Schedule")
        .map((record) => {
          const start = String(record.data?.start || record.recordDate || "");
          const finish = dashboardScheduleFinish(record);
          const rawProgress = Number(record.data?.progress || 0);
          const progress = Number.isFinite(rawProgress)
            ? Math.min(100, Math.max(0, Math.round(rawProgress)))
            : 0;
          return {
            project,
            record,
            start,
            finish,
            progress,
            responsible: String(record.data?.trade || record.owner || "Not Assigned"),
            qualityCategory:
              scheduleQualityCategory(String(record.data?.qualityCategoryId || ""))?.label ||
              "Schedule Activity",
          };
        })
        .filter(
          (item) =>
            /^\d{4}-\d{2}-\d{2}$/.test(item.start) &&
            /^\d{4}-\d{2}-\d{2}$/.test(item.finish) &&
            item.start <= today &&
            item.finish >= today,
        ),
    )
    .sort(
      (a, b) =>
        a.project.name.localeCompare(b.project.name) ||
        a.start.localeCompare(b.start) ||
        a.record.title.localeCompare(b.record.title),
    );
  const yesterday = dashboardDateOffset(today, -1);
  const yesterdayReports = activeProjects.map((project) => {
    const logs = (recordsByProject[project.number] ?? [])
      .filter(
        (record) =>
          record.type === "Daily Logs" && record.recordDate === yesterday,
      )
      .sort((a, b) =>
        String(b.recordTime || "").localeCompare(String(a.recordTime || "")),
      );
    const logIds = new Set(logs.map((record) => record.id));
    const photos = (filesByProject[project.number] ?? []).filter(
      (file) =>
        file.category === "Photos" &&
        Boolean(file.id) &&
        isPhotoUpload({ name: file.name, type: file.contentType }) &&
        logIds.has(dailyLogIdForPhoto(file)),
    );
    return { project, logs, photos };
  });
  const firstPhotoPerJob = yesterdayReports.flatMap((report) =>
    report.photos.slice(0, 1).map((file) => ({ ...report, file })),
  );
  const firstPhotoIds = new Set(
    firstPhotoPerJob.map(({ project, file }) => `${project.number}-${file.id}`),
  );
  const remainingPhotos = yesterdayReports.flatMap((report) =>
    report.photos
      .filter(
        (file) => !firstPhotoIds.has(`${report.project.number}-${file.id}`),
      )
      .map((file) => ({ ...report, file })),
  );
  const yesterdayPhotos = [...firstPhotoPerJob, ...remainingPhotos].slice(0, 6);
  return (
    <div className="company-dashboard executive-dashboard">
      <div className="dashboard-stack-board">
        <Suspense fallback={(
          <section className="dashboard-role-status" aria-label="Loading company metrics">
            <div className="dashboard-role-loading">Loading Dashboard Metrics…</div>
          </section>
        )}>
          <RoleOperatingSystem
            portfolioMetrics={[
              {
                label: "Active Projects",
                value: String(activeProjects.length),
              },
              {
                label: "Active Contract Value",
                value: canViewCompanyFinancials ? formatCurrency(totalContractValue) : "Restricted",
              },
            ]}
            onNavigate={(target, projectId) =>
              onOpenDecision(
                projects.find((project) => project.number === projectId),
                target,
              )
            }
          />
        </Suspense>

        <section className="dashboard-command-section dashboard-today-command" aria-labelledby="dashboard-today-title">
        <header className="dashboard-command-header">
          <h2 id="dashboard-today-title">Today Across Every Job</h2>
        </header>
        <div className="dashboard-today-list">
          {scheduledToday.map(({ project, record, start, finish, progress, responsible }) => (
            <button className="dashboard-today-row" key={`${project.number}-${record.id}`} onClick={() => onOpenDecision(project, "Schedule")}>
              <span className="dashboard-today-project"><strong>{project.name}</strong></span>
              <span><strong>{record.title}</strong></span>
              <span><strong>{responsible}</strong></span>
              <span><strong>{displayProjectDate(start)} – {displayProjectDate(finish)}</strong></span>
              <span className="dashboard-schedule-progress"><strong>{progress}%</strong><i><b style={{ width: `${progress}%` }} /></i></span>
              <span className="dashboard-row-open">→</span>
            </button>
          ))}
          {!scheduledToday.length ? (
            <div className="dashboard-operational-empty">
              <strong>No Schedule Activity Lands On Today</strong>
            </div>
          ) : null}
        </div>
        </section>

        <section className="executive-decision-panel dashboard-action-queue">
        <header>
          <h2>Action Queue</h2>
        </header>
        <div className="executive-decision-list">
          {immediateDecisions.map((decision) => (
            <button key={decision.id} onClick={() => onOpenDecision(decision.project, decision.target, decision.recordId)}>
              <span className={`decision-priority ${decision.priority.toLowerCase()}`}>{decision.priority}</span>
              <span className="decision-copy">
                <b>{decision.projectLabel}</b>
                <strong>{decision.title}</strong>
              </span>
              <span className="decision-owner">
                <strong>{decision.responsible}</strong>
                <b>{dashboardDateLabel(decision.due)}</b>
              </span>
              <span className="decision-open">Open <b>→</b></span>
            </button>
          ))}
          {!immediateDecisions.length ? <div className="executive-clear-state"><strong>No Urgent Actions</strong></div> : null}
        </div>
        </section>

        <section className="dashboard-command-section dashboard-field-command" aria-labelledby="dashboard-field-title">
        <header className="dashboard-command-header">
          <h2 id="dashboard-field-title">Yesterday&apos;s Daily Logs</h2>
        </header>
        <div className="dashboard-field-layout">
          <div className="dashboard-log-list">
            {yesterdayReports.map((report) =>
              report.logs.length ? report.logs.map((log) => {
                const storedPhotos = report.photos.filter((file) => dailyLogIdForPhoto(file) === log.id).length;
                const namedPhotos = Array.isArray(log.data?.photos) ? log.data.photos.length : 0;
                const photoCount = Math.max(storedPhotos, namedPhotos);
                const people = dashboardDailyLogPeople(log);
                const incident = log.data?.incidentReported === true;
                return (
                  <button className="dashboard-log-row" key={`${report.project.number}-${log.id}`} onClick={() => onOpenRecord(report.project, "Daily Logs", log.id)}>
                    <span><strong>{report.project.name}</strong></span>
                    <span><strong>{log.title}</strong></span>
                    <span><strong>{people} On Site · {photoCount} Photo{photoCount === 1 ? "" : "s"}</strong></span>
                    <span><b className={incident ? "dashboard-log-state incident" : "dashboard-log-state filed"}>{incident ? "Review" : "Filed"}</b></span>
                    <span className="dashboard-row-open">→</span>
                  </button>
                );
              }) : (
                <button className="dashboard-log-row missing" key={`${report.project.number}-missing`} onClick={() => onOpenDecision(report.project, "Daily Logs")}>
                  <span><strong>{report.project.name}</strong></span>
                  <span><strong>No Daily Log Filed</strong></span>
                  <span><b className="dashboard-log-state missing">Not Filed</b></span>
                  <span className="dashboard-row-open">→</span>
                </button>
              ),
            )}
            {!activeProjects.length ? (
              <div className="dashboard-operational-empty"><strong>No Active Jobs</strong></div>
            ) : null}
          </div>
          <aside className="dashboard-field-photos" aria-label="Selected photos from yesterday's Daily Logs">
            <header><strong>Field Photos</strong></header>
            <div className="dashboard-field-photo-grid">
              {yesterdayPhotos.map(({ project, logs, file }) => {
                const log = logs.find((record) => record.id === dailyLogIdForPhoto(file));
                if (!log || !file.id) return null;
                return (
                  <button key={`${project.number}-${file.id}`} onClick={() => onOpenRecord(project, "Daily Logs", log.id)} aria-label={`Open ${log.id} for ${project.name}`}>
                    <img src={`/api/files?id=${file.id}`} alt={`${project.name} jobsite from ${displayProjectDate(yesterday)}`} loading="lazy" />
                    <span><strong>{project.name}</strong></span>
                  </button>
                );
              })}
              {!yesterdayPhotos.length ? (
                <div className="dashboard-photo-empty"><strong>No Stored Photos From Yesterday</strong></div>
              ) : null}
            </div>
          </aside>
        </div>
        </section>
      </div>
    </div>
  );
}

type LegalRecordLifecycleAction =
  | "return_to_draft"
  | "void_archive"
  | "create_amendment"
  | "permanent_delete";

function personInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function defaultProjectMeetingStart(daysAhead: number, hour: number) {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setHours(hour, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type ProjectMeetingPlan = Record<"Project Design" | "Project Owner" | "Project Subcontractor", {
  requirement: "Required" | "Not Required";
  startAt: string;
  cadence: string;
  reason: string;
}>;

function newProjectMeetingPlan(): ProjectMeetingPlan {
  return {
    "Project Design": { requirement: "Required", startAt: defaultProjectMeetingStart(2, 10), cadence: "Biweekly", reason: "" },
    "Project Owner": { requirement: "Required", startAt: defaultProjectMeetingStart(7, 10), cadence: "Monthly", reason: "" },
    "Project Subcontractor": { requirement: "Required", startAt: defaultProjectMeetingStart(1, 7), cadence: "Weekly", reason: "" },
  };
}

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectProfile[]>([]);
  const [projectListStatus, setProjectListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [projectListError, setProjectListError] = useState("");
  const [projectListRetry, setProjectListRetry] = useState(0);
  const [projectProfile, setProjectProfile] =
    useState<ProjectProfile>(() => emptyProjectProfile());
  const [projectSummaryOpen, setProjectSummaryOpen] = useState(false);
  const [projectWorkArea, setProjectWorkArea] = useState("plan");
  const [projectToolContext, setProjectToolContext] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectSetupOpen, setProjectSetupOpen] = useState(false);
  const [projectSetupMode, setProjectSetupMode] = useState<"new" | "edit">(
    "edit",
  );
  const [projectDraft, setProjectDraft] =
    useState<ProjectProfile>(() => newProjectProfile());
  const [projectMeetingPlan, setProjectMeetingPlan] = useState<ProjectMeetingPlan>(() => newProjectMeetingPlan());
  const [issuedProjectNumbers, setIssuedProjectNumbers] = useState<string[]>([]);
  const [projectError, setProjectError] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetPreview, setResetPreview] = useState<{ records: number; files: number; linkedRows: number } | null>(null);
  const [initialResetReady] = useState(true);
  const [cameraViewOpen, setCameraViewOpen] = useState(false);
  const [dashboardCustomizeOpen, setDashboardCustomizeOpen] = useState(false);
  const [dashboardToolOrder, setDashboardToolOrder] = useState<string[]>(() => modules.map((item) => item.title));
  const [dashboardVisibleTools, setDashboardVisibleTools] = useState<string[]>(() => modules.map((item) => item.title));
  const [dashboardToolDraft, setDashboardToolDraft] = useState<string[]>(() => modules.map((item) => item.title));
  const [dashboardVisibleDraft, setDashboardVisibleDraft] = useState<string[]>(() => modules.map((item) => item.title));
  const [dashboardPreferencesSaving, setDashboardPreferencesSaving] = useState(false);
  const [projectPhotos, setProjectPhotos] = useState<ProjectFile[]>([]);
  const [photoGalleryOpen, setPhotoGalleryOpen] = useState(false);
  const [selectedProjectPhoto, setSelectedProjectPhoto] =
    useState<ProjectFile | null>(null);
  const [notice, setNotice] = useState("");
  const [siteSearchQuery, setSiteSearchQuery] = useState("");
  const [siteSearchFiles, setSiteSearchFiles] = useState<Array<{ id: number; name: string; category: string; revision: string; projectId: string }>>([]);
  const [remoteSiteSearchResults, setRemoteSiteSearchResults] = useState<Array<{ kind: "Project" | "Record" | "File" | "Work"; title: string; detail: string; target: string; projectId: string; fileId: number }>>([]);
  const siteSearchFilesRequested = useRef(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<CommandNotification[]>(
    startingCommandNotifications,
  );
  const [records, setRecords] = useState<Record<string, RecordItem[]>>(
    createCleanProjectRecords,
  );
  const [portfolioRecords, setPortfolioRecords] = useState<
    Record<string, PortfolioRecord[]>
  >({});
  const [portfolioFiles, setPortfolioFiles] = useState<
    Record<string, ProjectFile[]>
  >({});
  const [sessionActor, setSessionActor] = useState<CommandSessionActor>({
    name: "Signed-In User",
    email: "",
    accessLevel: "Employee",
    designations: [],
    permissionLocked: true,
    onboardingStatus: "Employee Access Verification Required",
    onboardingProgress: 0,
  });
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready" | "error">("loading");
  const [signInOutcome] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("signInStatus");
    if (status !== "not-approved" && status !== "error") return null;
    return { status, reason: params.get("reason") || "" } as const;
  });
  useEffect(() => {
    if (!signInOutcome || typeof window === "undefined") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [signInOutcome]);
  const [externalPricingToken, setExternalPricingToken] = useState("");
  const [externalVendorInviteId, setExternalVendorInviteId] = useState("");
  const [externalOwnerInviteId, setExternalOwnerInviteId] = useState("");
  const [pendingWorkLink, setPendingWorkLink] = useState<{ target: string; projectId: string; recordId: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState("Daily Logs");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordOwner, setRecordOwner] = useState("Jordan Mefford");
  const [recordNotes, setRecordNotes] = useState("");
  const [recordFormError, setRecordFormError] = useState("");
  const [dailyDate, setDailyDate] = useState(() =>
    currentDateInput(companyTimeZone),
  );
  const [recordDate, setRecordDate] = useState(() =>
    currentDateInput(companyTimeZone),
  );
  const [recordTime, setRecordTime] = useState(() =>
    currentTimeInput(companyTimeZone),
  );
  const [dailyWeather, setDailyWeather] = useState("Enter Weather Manually");
  const [dailyWeatherSource, setDailyWeatherSource] = useState("");
  const [dailyWeatherMetrics, setDailyWeatherMetrics] = useState<DailyWeatherMetrics>(
    blankDailyWeatherMetrics,
  );
  const [dailyWeatherLoading, setDailyWeatherLoading] = useState(false);
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0);
  const [projectWeather, setProjectWeather] = useState<ProjectWeatherSnapshot>({
    status: "idle",
    requestKey: "",
    conditions: "",
    high: null,
    low: null,
    source: "",
  });
  const projectWeatherAddress = projectProfile.site.trim();
  const projectWeatherRequestKey =
    projectProfile.number && projectWeatherAddress
      ? [
          projectProfile.number,
          projectWeatherAddress,
          projectProfile.timeZone,
        ].join(":")
      : "";
  const projectWeatherStatus: ProjectWeatherSnapshot["status"] =
    !projectProfile.number
      ? "idle"
      : !projectWeatherAddress
        ? "location_required"
        : projectWeather.requestKey === projectWeatherRequestKey
          ? projectWeather.status
          : "loading";
  const [recordSaving, setRecordSaving] = useState(false);
  const [employeesOnSite, setEmployeesOnSite] = useState<string[]>([]);
  const [subsOnSite, setSubsOnSite] = useState<string[]>([]);
  const [incidentReported, setIncidentReported] = useState(false);
  const [incidentDetails, setIncidentDetails] = useState("");
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoMarkups, setPhotoMarkups] = useState<Record<string, MobileMediaMarkup>>({});
  const [photoEditorFile, setPhotoEditorFile] = useState<File | null>(null);
  const [toolboxAttendees, setToolboxAttendees] = useState<string[]>([]);
  const [signedAttendees, setSignedAttendees] = useState<string[]>([]);
  const [signedAttendeeEvidence, setSignedAttendeeEvidence] = useState<Record<string, { typedIdentity: string; signatureImage: string; signedAt: string; deviceRecord: string; method: string }>>({});
  const dailyDraftData = useMemo(() => ({
    recordTitle, recordOwner, recordNotes, dailyDate, recordTime, dailyWeatherMetrics, dailyWeather, dailyWeatherSource, employeesOnSite, subsOnSite, incidentReported, incidentDetails,
    originalPhotoNames: photoFiles.map((file) => file.name),
    photoMarkups: Object.values(photoMarkups).map((markup) => ({ ...markup, annotatedFile: undefined, annotatedName: markup.annotatedFile?.name || "" })),
  }), [recordTitle, recordOwner, recordNotes, dailyDate, recordTime, dailyWeatherMetrics, dailyWeather, dailyWeatherSource, employeesOnSite, subsOnSite, incidentReported, incidentDetails, photoFiles, photoMarkups]);
  const dailyDraftFiles = useMemo(() => [...photoFiles, ...Object.values(photoMarkups).flatMap((markup) => markup.annotatedFile ? [markup.annotatedFile] : [])], [photoFiles, photoMarkups]);
  const dailyDraft = useDailyLogDraft({ enabled: formOpen && formType === "Daily Logs" && !sessionActor.permissionLocked, email: sessionActor.email, projectId: projectProfile.number, data: dailyDraftData, files: dailyDraftFiles, hasContent: Boolean(recordTitle.trim() || recordNotes.trim() || photoFiles.length || employeesOnSite.length || subsOnSite.length || incidentReported) });
  function restoreDailyDraft() {
    const candidate = dailyDraft.candidate;
    if (!candidate) return;
    const data = candidate.data as typeof dailyDraftData;
    setRecordTitle(data.recordTitle || ""); setRecordOwner(data.recordOwner || sessionActor.name); setRecordNotes(data.recordNotes || "");
    setDailyDate(data.dailyDate || currentDateInput(projectProfile.timeZone)); setRecordTime(data.recordTime || currentTimeInput(projectProfile.timeZone));
    setDailyWeatherMetrics(data.dailyWeatherMetrics || blankDailyWeatherMetrics()); setDailyWeather(data.dailyWeather || ""); setDailyWeatherSource(data.dailyWeatherSource || "");
    setEmployeesOnSite(data.employeesOnSite || []); setSubsOnSite(data.subsOnSite || []); setIncidentReported(Boolean(data.incidentReported)); setIncidentDetails(data.incidentDetails || "");
    const originals = candidate.files.filter((file: File) => data.originalPhotoNames?.includes(file.name));
    setPhotoFiles(originals); setPhotoNames(originals.map((file: File) => file.name));
    setPhotoMarkups(Object.fromEntries((data.photoMarkups || []).map((markup) => [markup.originalName, { ...markup, annotatedFile: candidate.files.find((file: File) => file.name === markup.annotatedName) || null }])));
    dailyDraft.restored();
  }
  async function closeRecordForm() {
    if (recordSaving) return;
    if (formType === "Daily Logs" && !await dailyDraft.save()) {
      setRecordFormError("Your draft has not been saved. Keep this form open and try Save Draft again.");
      return;
    }
    setFormOpen(false);
  }
  const [signaturePerson, setSignaturePerson] = useState<string | null>(null);
  const [hasSignatureInk, setHasSignatureInk] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<{
    type: string;
    id: string;
  } | null>(null);
  const [correctingRecordDate, setCorrectingRecordDate] = useState(false);
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctionTime, setCorrectionTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionField, setCorrectionField] =
    useState<CorrectionField>("Date And Time");
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [lastCorrectionRecipient, setLastCorrectionRecipient] = useState("");
  const [legalLifecycleAction, setLegalLifecycleAction] =
    useState<LegalRecordLifecycleAction | null>(null);
  const [legalLifecycleReason, setLegalLifecycleReason] = useState("");
  const [legalLifecycleSaving, setLegalLifecycleSaving] = useState(false);
  const correctionDateInput = useRef<HTMLInputElement>(null);
  const correctionTimeInput = useRef<HTMLInputElement>(null);
  const signatureCanvas = useRef<HTMLCanvasElement>(null);
  const dashboardRecordsByProject = useMemo(
    () => ({
      ...portfolioRecords,
      ...(projectProfile.number
        ? {
            [projectProfile.number]: Object.entries(records).flatMap(
              ([type, items]) =>
                items.map((record) => ({ ...record, type }) as PortfolioRecord),
            ),
          }
        : {}),
    }),
    [portfolioRecords, projectProfile.number, records],
  );
  const siteSearchResults = useMemo(() => {
    const query = siteSearchQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    const terms = query.match(/[a-z0-9]+/g) || [];
    const navigation = [
      { label: "Dashboard", target: "Dashboard" },
      { label: "My Work", target: "My Work" },
      { label: "Project Health", target: "Project Health" },
      { label: "Project Overview", target: "Project Overview" },
      { label: "User Guide", target: "User Guide" },
      ...preconstructionNavGroups.flatMap((group) => group.items.map((item) => ({ label: item.label, target: item.target }))),
      ...companyNavFolders.flatMap((folder) => folder.items.map((item) => ({ label: item.label, target: item.target }))),
      ...navFolders.flatMap((folder) => folder.items.map((item) => ({ label: item.label, target: item.target }))),
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.target === item.target) === index && canActorAccessNavigation(sessionActor, item.target));
    const results = [
      ...remoteSiteSearchResults,
      ...navigation.map((item) => ({ kind: "Section" as const, title: item.label, detail: "Command Center Section", target: item.target, projectId: "", fileId: 0 })),
      ...projects.map((project) => ({ kind: "Project" as const, title: project.name, detail: `${project.number} · ${project.site}`, target: "Project Overview", projectId: project.number, fileId: 0 })),
      ...Object.entries(dashboardRecordsByProject).flatMap(([projectId, items]) => items.filter((record) => canActorAccessNavigation(sessionActor, record.type)).map((record) => ({ kind: "Record" as const, title: record.title, detail: `${projectId} · ${record.type} · ${record.status}`, target: record.type, projectId, fileId: 0 }))),
      ...siteSearchFiles.map((file) => ({ kind: "File" as const, title: file.name, detail: `${file.projectId === "MEFFORD-PEOPLE" ? "Employee Resources" : file.projectId} · ${file.category} · ${file.revision}`, target: file.projectId === "MEFFORD-PEOPLE" ? "My Work" : "Documents", projectId: file.projectId, fileId: file.id })),
    ];
    return results.filter((item, index, items) => {
      const searchable = `${item.title} ${item.detail}`.toLowerCase();
      return terms.every((term) => searchable.includes(term)) && items.findIndex((candidate) => candidate.kind === item.kind && candidate.title === item.title && candidate.projectId === item.projectId && candidate.fileId === item.fileId) === index;
    }).slice(0, 24);
  }, [dashboardRecordsByProject, projects, remoteSiteSearchResults, sessionActor, siteSearchFiles, siteSearchQuery]);

  useEffect(() => {
    const query = siteSearchQuery.trim();
    if (sessionStatus !== "ready" || query.length < 2) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams({ q: query, ...(projectProfile.number ? { projectId: projectProfile.number } : {}) });
      fetch(`/api/search?${search}`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json() as { results?: Array<{ kind: "Project" | "Record" | "File" | "Work"; title: string; detail: string; target: string; projectId: string; fileId: number }> };
          if (!cancelled && response.ok) setRemoteSiteSearchResults(result.results || []);
        })
        .catch(() => { if (!cancelled) setRemoteSiteSearchResults([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectProfile.number, sessionStatus, siteSearchQuery]);

  useEffect(() => {
    if (sessionStatus !== "ready" || sessionActor.permissionLocked || siteSearchQuery.trim().length < 2 || siteSearchFilesRequested.current) return;
    let cancelled = false;
    const projectIds = Array.from(new Set([...projects.map((project) => project.number), "MEFFORD-PEOPLE"]));
    siteSearchFilesRequested.current = true;
    Promise.all(projectIds.map(async (projectId) => {
      const response = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) return [];
      const result = await response.json() as { files?: Array<{ id: number; name: string; category: string; revision: string }> };
      return (result.files || []).map((file) => ({ ...file, projectId }));
    })).then((groups) => { if (!cancelled) setSiteSearchFiles(groups.flat()); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projects, sessionActor.permissionLocked, sessionStatus, siteSearchQuery]);
  const selectedRecordItem = selectedRecord
    ? records[selectedRecord.type]?.find(
        (record) => record.id === selectedRecord.id,
      )
    : null;
  const selectedRecordDateLocked = Boolean(
    selectedRecordItem &&
      (selectedRecordItem.dateLocked ||
        isFinalRecordStatus(selectedRecordItem.status)),
  );
  const selectedRecordAuditHistory = Array.from(
    new Set([
      ...(selectedRecordItem?.dateAudit ?? []),
      ...(selectedRecordItem?.auditHistory ?? []),
    ]),
  );
  const selectedRecordSupportsLegalLifecycle = Boolean(
    selectedRecord &&
      ["Contracts", "Subcontracts"].includes(selectedRecord.type),
  );
  const canAdministerLegalRecords = [
    "Company Owner",
    "Administrator",
  ].includes(sessionActor.accessLevel);
  const canPermanentlyDeleteRecords =
    sessionActor.accessLevel === "Company Owner";

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const token = search.get("pricingInvite");
    const vendorInviteId = search.get("vendorPortal");
    const ownerInviteId = search.get("ownerPortal");
    const target = search.get("target") || "";
    const projectId = search.get("project") || "";
    const recordId = search.get("record") || "";
    const timer = window.setTimeout(() => {
      setExternalPricingToken(token || "");
      setExternalVendorInviteId(vendorInviteId || "");
      setExternalOwnerInviteId(ownerInviteId || "");
      if (target) setPendingWorkLink({ target, projectId, recordId });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!pendingWorkLink || !canActorAccessNavigation(sessionActor, pendingWorkLink.target)) return;
    const linkedProject = projects.find((project) => project.number === pendingWorkLink.projectId);
    const timer = window.setTimeout(() => {
      if (linkedProject) setProjectProfile(linkedProject);
      setActive(pendingWorkLink.target);
      if (!pendingWorkLink.recordId || (!linkedProject && pendingWorkLink.projectId !== "MEFFORD-SALES")) setPendingWorkLink(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingWorkLink, projects, sessionActor]);

  useEffect(() => {
    if (!pendingWorkLink?.recordId || projectProfile.number !== pendingWorkLink.projectId) return;
    const sourceType = pendingWorkLink.target === "Contracts" ? "Contracts" : pendingWorkLink.target;
    if (!records[sourceType]?.some((record) => record.id === pendingWorkLink.recordId)) return;
    const timer = window.setTimeout(() => {
      setSelectedRecord({ type: sourceType, id: pendingWorkLink.recordId });
      setPendingWorkLink(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingWorkLink, projectProfile.number, records]);

  useEffect(() => {
    if (!navigator.onLine || sessionActor.permissionLocked || externalVendorInviteId || externalOwnerInviteId || externalPricingToken) return;
    if (!projectProfile.number) return;
    const timer = window.setTimeout(() => {
      const allowedRecords = Object.fromEntries(Object.entries(records).filter(([recordType]) => canActorAccessNavigation(sessionActor, recordType)));
      void saveAssignedProjectSnapshot(projectProfile.number, {
        project: projectProfile,
        records: allowedRecords,
        cachedFor: sessionActor.email,
        cachedAt: new Date().toISOString(),
        policy: "Assigned project only · role-filtered · AES-256-GCM encrypted on device",
      }).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [externalOwnerInviteId, externalPricingToken, externalVendorInviteId, projectProfile, records, sessionActor]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();
    const loadSession = () => readWorkspaceJson<{ actor: CommandSessionActor }>(
      `/api/session${projectProfile.number ? `?projectId=${encodeURIComponent(projectProfile.number)}` : ""}`,
      "Employee access",
      (body) => {
        const actor = body.actor as Record<string, unknown> | undefined;
        return Boolean(actor && typeof actor.name === "string" && typeof actor.email === "string"
          && typeof actor.permissionLocked === "boolean" && Array.isArray(actor.designations)
          && ["Company Owner", "Administrator", "Employee"].includes(String(actor.accessLevel)));
      },
      controller.signal,
    )
      .then((data) => {
        if (!cancelled && data.actor) {
          setSessionActor(data.actor);
          setSessionStatus("ready");
          if (data.actor.permissionLocked) {
            void clearOfflineMobileData();
            setProjects([]);
            setProjectProfile(emptyProjectProfile());
            setRecords(createCleanProjectRecords());
            setPortfolioRecords({});
            setPortfolioFiles({});
            setProjectPhotos([]);
            setSiteSearchFiles([]);
            siteSearchFilesRequested.current = false;
            setSiteSearchQuery("");
            setNotifications([]);
            setProjectSetupOpen(false);
            setFormOpen(false);
            setSelectedRecord(null);
            setNotificationsOpen(false);
          }
          setActive((current) => {
            if (data.actor!.permissionLocked) return "Employee Portal";
            if (canActorAccessNavigation(data.actor!, current)) return current;
            const preferred = preferredWorkspace(data.actor!);
            return canActorAccessNavigation(data.actor!, preferred) ? preferred : "Employee Portal";
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        void clearOfflineMobileData();
        setProjects([]);
        setProjectProfile(emptyProjectProfile());
        setRecords(createCleanProjectRecords());
        setPortfolioRecords({});
        setPortfolioFiles({});
        setProjectPhotos([]);
        setSiteSearchFiles([]);
        siteSearchFilesRequested.current = false;
        setSiteSearchQuery("");
        setNotifications([]);
        setProjectSetupOpen(false);
        setFormOpen(false);
        setSelectedRecord(null);
        setNotificationsOpen(false);
        setSessionActor({
          name: "Signed-In User",
          email: "",
          accessLevel: "Employee",
          designations: [],
          permissionLocked: true,
          onboardingStatus: "Verification Unavailable",
          onboardingProgress: 0,
        });
        setSessionStatus("error");
      });
    void loadSession();
    timer = window.setInterval(() => void loadSession(), 60_000);
    const refreshVisibleSession = () => {
      if (document.visibilityState === "visible") void loadSession();
    };
    document.addEventListener("visibilitychange", refreshVisibleSession);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", refreshVisibleSession);
    };
  }, [projectProfile.number]);

  useEffect(() => {
    if (!projectProfile.number || !sessionActor.email || sessionActor.permissionLocked) return;
    let cancelled = false;
    fetch(`/api/dashboard-preferences?projectId=${encodeURIComponent(projectProfile.number)}`)
      .then(async (response) => {
        const result = await response.json() as { orderedTools?: string[]; visibleTools?: string[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Project Tool Preferences Are Unavailable.");
        if (cancelled) return;
        const order = result.orderedTools?.length ? result.orderedTools : modules.map((item) => item.title);
        const visible = result.visibleTools?.length ? result.visibleTools : modules.map((item) => item.title);
        setDashboardToolOrder(order);
        setDashboardVisibleTools(visible);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectProfile.number, sessionActor.email, sessionActor.permissionLocked]);

  useEffect(() => {
    if (sessionStatus !== "ready" || sessionActor.permissionLocked) return;
    let cancelled = false;
    const controller = new AbortController();
    void readWorkspaceJson<{ projects: ProjectProfile[] }>(
      "/api/projects", "Project list", (body) => Array.isArray(body.projects), controller.signal,
    )
      .then(({ projects: loadedProjects }) => {
        if (cancelled) return;
        setProjectListStatus("ready");
        setProjectListError("");
        setProjects(loadedProjects);
        setIssuedProjectNumbers(loadedProjects.map((project) => project.number));
        let rememberedProject = "";
        try { rememberedProject = localStorage.getItem(`mefford-last-project:${sessionActor.email}`) || ""; } catch { /* Use the authorized project list. */ }
        setProjectProfile((current) =>
          loadedProjects.find((project) => project.number === current.number) ||
          loadedProjects.find((project) => project.number === rememberedProject) ||
          loadedProjects[0] ||
          emptyProjectProfile(),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setProjectListStatus("error");
        setProjectListError(error instanceof Error ? error.message : "Project list could not be loaded.");
        if (error instanceof WorkspaceRequestError && [401, 403].includes(error.status)) {
          setProjects([]);
          setProjectProfile(emptyProjectProfile());
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectListRetry, sessionActor.email, sessionActor.permissionLocked, sessionStatus]);

  function retryProjectList() {
    setProjectListStatus("loading");
    setProjectListError("");
    setProjectListRetry((value) => value + 1);
  }

  useEffect(() => {
    if (!initialResetReady || sessionStatus !== "ready" || sessionActor.permissionLocked) return;
    if (!projectProfile.number) {
      return;
    }
    let cancelled = false;
    const loadRecords = async (projectId: string) => {
      const response = await fetch(
        `/api/records?projectId=${encodeURIComponent(projectId)}`,
      );
      if (!response.ok) {
        throw new Error("Permanent record storage is unavailable");
      }
      return (await response.json()) as {
        records?: Array<RecordItem & { type: string }>;
      };
    };
    Promise.all([
      loadRecords(projectProfile.number),
      loadRecords("MEFFORD-COMPANY"),
    ])
      .then(([projectData, companyData]) => {
        if (cancelled) return;
        setRecords(() => {
          const next = createCleanProjectRecords();
          const storedBudgetRecords = (projectData.records ?? [])
            .filter((saved) => saved.type === "Budget")
            .map((saved) => saved as RecordItem);
          let mergedBudget = mergeBudgetRecordsWithMaster(storedBudgetRecords);
          for (const companyRecord of (companyData.records ?? []).filter(
            (saved) =>
              saved.type === "Master Cost Codes" &&
              !isExcludedProfitCostCode(saved),
          )) {
            const companyDataValue = budgetCodeData(companyRecord);
            const existing = mergedBudget.find(
              (record) => record.id === companyRecord.id,
            );
            if (existing) {
              const existingData = budgetCodeData(existing);
              mergedBudget = mergedBudget.map((record) =>
                record.id === companyRecord.id
                  ? {
                      ...record,
                      title: companyDataValue.description,
                      meta: `${companyDataValue.division} · Company Master`,
                      data: {
                        ...existingData,
                        division: companyDataValue.division,
                        description: companyDataValue.description,
                        source: "Company Master",
                      },
                    }
                  : record,
              );
            } else {
              mergedBudget.push({
                ...companyRecord,
                data: {
                  ...companyDataValue,
                  source: "Company Master",
                  selectedForProject: false,
                },
              });
            }
          }
          next.Budget = mergedBudget.sort((a, b) => a.id.localeCompare(b.id));
          for (const saved of (projectData.records ?? []).filter(
            (record) => record.type !== "Budget",
          )) {
            const normalizedSaved =
              saved.type === "Change Orders"
                ? { ...normalizeRecordCostCodes(saved), type: saved.type }
                : saved;
            const typeRecords = next[normalizedSaved.type] ?? [];
            const existing = typeRecords.find(
              (record) => record.id === normalizedSaved.id,
            );
            next[normalizedSaved.type] = [
              {
                ...existing,
                ...normalizedSaved,
                auditHistory: Array.from(
                  new Set([
                    ...(existing?.dateAudit ?? []),
                    ...(existing?.auditHistory ?? []),
                    ...(normalizedSaved.auditHistory ?? []),
                  ]),
                ),
                persistent: true,
              },
              ...typeRecords.filter(
                (record) => record.id !== normalizedSaved.id,
              ),
            ];
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialResetReady, projectProfile.number, sessionActor.permissionLocked, sessionStatus]);

  useEffect(() => {
    if (!initialResetReady || sessionStatus !== "ready" || sessionActor.permissionLocked) return;
    let cancelled = false;
    let refreshTimer = 0;
    const activeProjects = projects.filter(
      (project) => project.status === "Active",
    );
    const dashboardRecordSources = [
      ...activeProjects.map((project) => project.number),
      "MEFFORD-SALES",
      "MEFFORD-ACCOUNTING",
    ];
    const loadDashboardRecords = () => Promise.all(
      dashboardRecordSources.map(async (projectId) => {
        const response = await fetch(
          `/api/records?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return [projectId, []] as const;
        const data = (await response.json()) as {
          records?: PortfolioRecord[];
        };
        return [projectId, data.records ?? []] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setPortfolioRecords((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      })
      .catch(() => undefined);
    void loadDashboardRecords();
    if (active === "Dashboard") {
      refreshTimer = window.setInterval(() => void loadDashboardRecords(), 30_000);
    }
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [active, initialResetReady, projects, sessionActor.permissionLocked, sessionStatus]);

  useEffect(() => {
    if (active !== "Dashboard" || sessionStatus !== "ready" || sessionActor.permissionLocked) return;
    let cancelled = false;
    const activeProjectIds = projects
      .filter((project) => project.status === "Active")
      .map((project) => project.number);
    const loadDashboardFiles = () => Promise.all(
      activeProjectIds.map(async (projectId) => {
        const response = await fetch(
          `/api/files?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return [projectId, []] as const;
        const data = (await response.json()) as { files?: ProjectFile[] };
        return [projectId, data.files ?? []] as const;
      }),
    )
      .then((entries) => {
        if (!cancelled) setPortfolioFiles(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    void loadDashboardFiles();
    const onFocus = () => void loadDashboardFiles();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [active, projects, sessionActor.permissionLocked, sessionStatus]);

  const dailyLogPhotoRefreshCount = records["Daily Logs"]?.length ?? 0;

  useEffect(() => {
    if (sessionStatus !== "ready" || sessionActor.permissionLocked || !projectProfile.number) {
      return;
    }
    let cancelled = false;
    fetch(`/api/files?projectId=${encodeURIComponent(projectProfile.number)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Project photos are unavailable");
        return (await response.json()) as { files?: ProjectFile[] };
      })
      .then((data) => {
        if (cancelled) return;
        setProjectPhotos(
          (data.files ?? []).filter(
            (file) =>
              file.category === "Photos" &&
              isPhotoUpload({ name: file.name, type: file.contentType }) &&
              Boolean(dailyLogIdForPhoto(file)) &&
              Boolean(file.id),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectProfile.number, dailyLogPhotoRefreshCount, sessionActor.permissionLocked, sessionStatus]);

  async function loadStoredNotifications() {
    try {
      const response = await fetch(
        "/api/my-work",
      );
      if (!response.ok) return;
      const data = (await response.json()) as {
        items?: CommandNotification[];
      };
      setNotifications(data.items ?? []);
    } catch {
      // Keep the current project notification center available during an outage.
    }
  }

  async function openNotification(item: CommandNotification) {
    setNotificationsOpen(false);
    setNotifications((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, isRead: true } : candidate));
    void fetch("/api/my-work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, action: "read" }),
    }).catch(() => undefined);
    openMyWorkItem(item);
  }

  useEffect(() => {
    if (!initialResetReady || sessionStatus !== "ready" || sessionActor.permissionLocked) return;
    let cancelled = false;
    fetch("/api/my-work")
      .then(async (response) => {
        if (!response.ok) return { items: [] as CommandNotification[] };
        return (await response.json()) as {
          items?: CommandNotification[];
        };
      })
      .then((data) => {
        if (cancelled) return;
        setNotifications(data.items ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialResetReady, projectProfile.number, sessionActor.permissionLocked, sessionStatus]);

  useEffect(() => {
    if (!projectWeatherRequestKey) return;
    const controller = new AbortController();
    const search = new URLSearchParams({
      address: projectWeatherAddress,
      date: currentDateInput(projectProfile.timeZone),
      timeZone: projectProfile.timeZone,
    });
    fetch(`/api/weather?${search.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          conditions?: string;
          high?: number;
          low?: number;
          source?: string;
          provider?: string;
          error?: string;
        };
        if (!response.ok || !data.conditions || !Number.isFinite(data.high) || !Number.isFinite(data.low)) {
          throw new Error(data.error || "Weather is unavailable");
        }
        return data;
      })
      .then((data) => {
        setProjectWeather({
          status: "ready",
          requestKey: projectWeatherRequestKey,
          conditions: data.conditions!,
          high: data.high!,
          low: data.low!,
          source: `${data.source} · ${data.provider}`,
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setProjectWeather({
          status: "unavailable",
          requestKey: projectWeatherRequestKey,
          conditions: "",
          high: null,
          low: null,
          source: "Automatic Weather Unavailable · Daily Logs Allow Manual Entry",
        });
      });
    return () => controller.abort();
  }, [
    projectWeatherRequestKey,
    projectWeatherAddress,
    projectProfile.timeZone,
  ]);

  useEffect(() => {
    if (
      !formOpen ||
      formType !== "Daily Logs" ||
      !dailyDate ||
      !projectWeatherAddress
    ) return;
    const controller = new AbortController();
    const search = new URLSearchParams({
      address: projectWeatherAddress,
      date: dailyDate,
      timeZone: projectProfile.timeZone,
    });
    fetch(`/api/weather?${search.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          summary?: string;
          source?: string;
          provider?: string;
          rainfallInches?: number;
          averageTemperatureF?: number;
          averageWindSpeedMph?: number;
          averageConditions?: string;
          capturedAt?: string;
          resolvedAddress?: string;
          error?: string;
        };
        if (
          !response.ok ||
          !data.summary ||
          !Number.isFinite(data.rainfallInches) ||
          !Number.isFinite(data.averageTemperatureF) ||
          !Number.isFinite(data.averageWindSpeedMph) ||
          !data.averageConditions
        ) {
          throw new Error(data.error || "Weather is unavailable");
        }
        return data;
      })
      .then((data) => {
        setDailyWeatherMetrics({
          rainfallInches: Number(data.rainfallInches).toFixed(2),
          averageTemperatureF: String(Math.round(Number(data.averageTemperatureF))),
          averageWindSpeedMph: String(Math.round(Number(data.averageWindSpeedMph))),
          averageConditions: data.averageConditions!,
          capturedAt: data.capturedAt || new Date().toISOString(),
          resolvedAddress: data.resolvedAddress || projectWeatherAddress,
        });
        setDailyWeather(data.summary!);
        setDailyWeatherSource(`${data.source} · ${data.provider}`);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setDailyWeatherMetrics(blankDailyWeatherMetrics());
        setDailyWeather("Enter Weather Manually");
        setDailyWeatherSource("Automatic Weather Unavailable · Manual Entry Allowed");
      })
      .finally(() => setDailyWeatherLoading(false));
    return () => controller.abort();
  }, [
    dailyDate,
    formOpen,
    formType,
    projectWeatherAddress,
    projectProfile.timeZone,
    weatherRefreshKey,
  ]);

  function updateDailyWeatherMetric(
    field: "rainfallInches" | "averageTemperatureF" | "averageWindSpeedMph" | "averageConditions",
    value: string,
  ) {
    setDailyWeatherMetrics((current) => {
      const next = {
        ...current,
        [field]: value,
        capturedAt: current.capturedAt || new Date().toISOString(),
        resolvedAddress: current.resolvedAddress || projectWeatherAddress,
      };
      setDailyWeather(dailyWeatherMetricSummary(next));
      return next;
    });
    if (!dailyWeatherSource) {
      setDailyWeatherSource("Manual Daily Weather Entry · Confirmed At Finalization");
    }
  }

  function chooseNav(label: string) {
    if (label === "Integration Health") label = "IT & Integrations";
    if (!canActorAccessNavigation(sessionActor, label)) {
      setNotice(
        "This Section Is Not Available For Your Current Company Access And Project Designations.",
      );
      return;
    }
    setActive(label);
    setProjectToolContext("");
    if (label === "Project Overview") setProjectSummaryOpen(false);
    setMenuOpen(false);

  }

  function openProjectSetup(mode: "new" | "edit") {
    if (mode === "edit" && !projectProfile.number) {
      mode = "new";
    }
    setProjectSetupMode(mode);
    setProjectDraft(
      mode === "new"
        ? {
            ...newProjectProfile(),
            number: nextProjectNumber(issuedProjectNumbers),
          }
        : projectProfile,
    );
    if (mode === "new") setProjectMeetingPlan(newProjectMeetingPlan());
    setProjectError("");

    setProjectSetupOpen(true);
    if (mode === "edit") {
      void fetch(`/api/closeout?projectId=${encodeURIComponent(projectProfile.number)}`, { cache: "no-store" })
        .then(async (response): Promise<{ control?: { hasPhases?: boolean; phases?: string[] } } | null> => response.ok ? await response.json() as { control?: { hasPhases?: boolean; phases?: string[] } } : null)
        .then((result) => {
          if (!result?.control) return;
          setProjectDraft((current) => ({ ...current, hasCloseoutPhases: result.control?.hasPhases === true, closeoutPhases: Array.isArray(result.control?.phases) ? result.control.phases : [] }));
        })
        .catch(() => undefined);
    }
  }

  function updateProjectDraft(
    field: keyof ProjectProfile,
    value: string | number,
  ) {
    setProjectDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveProjectProfile() {
    if (
      !projectDraft.name.trim() ||
      !projectDraft.number.trim() ||
      !projectDraft.site.trim() ||
      !projectDraft.ownerName.trim() ||
      !projectDraft.ownerContractDate ||
      !projectDraft.startDate ||
      !projectDraft.substantialDate ||
      !projectDraft.finalDate ||
      !projectDraft.projectManager ||
      !projectDraft.superintendent
    ) {
      setProjectError(
        "Add the project name, location, owner, owner contract date, all three schedule dates, Project Manager, and Superintendent.",
      );
      return;
    }
    if (projectSetupMode === "new") {
      const missingMeetingSetup = Object.entries(projectMeetingPlan).find(([, plan]) =>
        plan.requirement === "Required" ? !plan.startAt || !plan.cadence : !plan.reason.trim(),
      );
      if (missingMeetingSetup) {
        setProjectError(`${missingMeetingSetup[0]} requires a first meeting date and cadence. Only a Company Owner may mark it Not Required, with a permanent reason.`);
        return;
      }
    }
    const draftToSave: ProjectProfile = {
      ...projectDraft,
      currentContractAmount:
        projectSetupMode === "new" || !projectDraft.currentContractAmount
          ? projectDraft.contractAmount
          : projectDraft.currentContractAmount,
      cameraCount: Math.min(
        16,
        Math.max(0, Number(projectDraft.cameraCount) || 0),
      ),
    };
    setProjectSaving(true);
    setProjectError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: projectSetupMode, project: draftToSave }),
      });
      const result = (await response.json()) as {
        project?: ProjectProfile;
        error?: string;
      };
      if (!response.ok || !result.project) {
        throw new Error(result.error || "The project could not be saved.");
      }
      const closeoutResponse = await fetch("/api/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure-project",
          projectId: result.project.number,
          hasPhases: draftToSave.hasCloseoutPhases === true,
          phases: draftToSave.closeoutPhases || [],
        }),
      });
      const closeoutResult = await closeoutResponse.json() as { error?: string };
      if (!closeoutResponse.ok) throw new Error(closeoutResult.error || "The Project Closeout Setup Could Not Be Saved.");
      if (projectSetupMode === "new") {
        for (const [meetingType, plan] of Object.entries(projectMeetingPlan) as Array<[keyof ProjectMeetingPlan, ProjectMeetingPlan[keyof ProjectMeetingPlan]]>) {
          const target = meetingType === "Project Design" ? "Project Design" : meetingType === "Project Owner" ? "Project Owner" : "Project Subcontractor";
          if (plan.requirement === "Not Required") {
            const response = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark_not_required", projectId: result.project.number, meetingType: target, reason: plan.reason }) });
            const meetingResult = await response.json() as { error?: string };
            if (!response.ok) throw new Error(meetingResult.error || `${target} requirement could not be saved.`);
            continue;
          }
          const leaderName = meetingType === "Project Subcontractor" ? draftToSave.superintendent : draftToSave.projectManager;
          const leader = MEFFORD_COMPANY_DIRECTORY.find((member) => member.name === leaderName);
          const response = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            action: "create_series", projectId: result.project.number, meetingType: target, title: `${target} · ${result.project.name}`, cadence: plan.cadence,
            startAt: plan.startAt, timeZone: result.project.timeZone, meetingMode: "Teams Remote", location: "Microsoft Teams", leaderName,
            leaderEmail: leader?.email || sessionActor.email, organizerEmail: sessionActor.email, attendees: [{ name: leaderName, email: leader?.email || sessionActor.email, attendanceRequirement: "Required", attendeeRole: "Meeting Leader" }], syncMicrosoft: true,
          }) });
          const meetingResult = await response.json() as { error?: string };
          if (!response.ok) throw new Error(meetingResult.error || `${target} series could not be created.`);
        }
      }
      const savedProject = { ...result.project, hasCloseoutPhases: draftToSave.hasCloseoutPhases === true, closeoutPhases: draftToSave.closeoutPhases || [] };
      setProjects((current) => [
        savedProject,
        ...current.filter((project) => project.number !== savedProject.number),
      ]);
      setIssuedProjectNumbers((current) =>
        current.includes(savedProject.number)
          ? current
          : [...current, savedProject.number],
      );
      setRecords(createCleanProjectRecords());
      setNotifications([]);
      setSelectedRecord(null);
      setProjectProfile(savedProject);
      setProjectSetupOpen(false);
      setActive("Project Overview");
      setNotice(
        projectSetupMode === "new"
          ? `${savedProject.name} Created With Its Controlled Project Meeting Schedule And Opened!`
          : `${savedProject.name} Project Information Updated!`,
      );
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "The project could not be saved.",
      );
    } finally {
      setProjectSaving(false);
    }
  }

  async function openAwardedProject(projectNumber: string, target = "Project Overview") {
    if (!projectNumber) return;
    try {
      const result = await readWorkspaceJson<{ projects: ProjectProfile[] }>(
        "/api/projects", "Project list", (body) => Array.isArray(body.projects),
      );
      const awardedProject = result.projects.find(
        (project) => project.number === projectNumber,
      );
      if (!awardedProject) {
        throw new Error("The Awarded Project Could Not Be Found.");
      }
      setProjects(result.projects);
      setProjectListStatus("ready");
      setProjectListError("");
      setIssuedProjectNumbers(result.projects.map((project) => project.number));
      setProjectProfile(awardedProject);

      setActive(target);
      setNotice(
        `${awardedProject.name} Opened`,
      );
      window.setTimeout(() => setNotice(""), 4200);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Awarded Project Could Not Be Opened.",
      );
    }
  }

  function switchProject(project: ProjectProfile) {
    setProjectSummaryOpen(false);
    setProjectWorkArea("plan");
    setProjectToolContext("");
    if (project.number === projectProfile.number) {
      setActive("Project Overview");

      return;
    }
    setRecords(createCleanProjectRecords());
    setNotifications([]);
    setSelectedRecord(null);
    setFormOpen(false);
    setCameraViewOpen(false);
    setProjectPhotos([]);
    setPhotoGalleryOpen(false);
    setSelectedProjectPhoto(null);
    setProjectProfile(project);
    setActive("Project Overview");

    try { localStorage.setItem(`mefford-last-project:${sessionActor.email}`, project.number); } catch { /* Selection remains available for this session. */ }
    setNotice(`${project.name} · ${project.number} Selected`);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function openDashboardDecision(
    project: ProjectProfile | undefined,
    target: string,
    recordId = "",
  ) {
    if (project && project.number !== projectProfile.number) {
      setRecords(createCleanProjectRecords());
      setNotifications([]);
      setSelectedRecord(null);
      setFormOpen(false);
      setCameraViewOpen(false);
      setProjectPhotos([]);
      setPhotoGalleryOpen(false);
      setSelectedProjectPhoto(null);
      setProjectProfile(project);
    }

    setProjectSummaryOpen(false);
    setProjectToolContext(project && ["Owner Billing", "Lien Waivers"].includes(target) ? target : "");
    setActive(target);
    if (recordId) {
      setPendingWorkLink({ target, projectId: project?.number || (target === "Estimating" ? "MEFFORD-SALES" : ""), recordId });
    }
    setNotice(
      project
        ? `${project.name} ${target} Opened From The Executive Action Center!`
        : `${target} Opened From The Executive Action Center!`,
    );
    window.setTimeout(() => setNotice(""), 2600);
  }

  function openMyWorkItem(item: MyWorkItem) {
    const actionTarget = item.actionTarget === "Integration Health" ? "IT & Integrations" : item.actionTarget;
    if (!canActorAccessNavigation(sessionActor, actionTarget)) {
      setNotice("This Work Item Points To A Section Outside Your Current Permissions.");
      return;
    }
    const project = projects.find((candidate) => candidate.number === item.projectId);
    openDashboardDecision(project, actionTarget, actionTarget === "Estimating" ? item.sourceRecordId : "");
    if (project?.number === projectProfile.number && item.sourceRecordId) {
      const sourceType = actionTarget === "Contracts" ? "Contracts" : actionTarget;
      if (records[sourceType]?.some((record) => record.id === item.sourceRecordId)) {
        setSelectedRecord({ type: sourceType, id: item.sourceRecordId });
      }
    }
  }

  function updateActiveProject(changes: Partial<ProjectProfile>, persist = true) {
    const nextProject = { ...projectProfile, ...changes };
    setProjectProfile(nextProject);
    setProjects((current) =>
      current.map((project) =>
        project.number === nextProject.number ? nextProject : project,
      ),
    );
    if (!persist) return;
    void fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "edit", project: nextProject }),
    }).catch(() => undefined);
  }

  async function openProjectDeletion() {
    setProjectSetupOpen(false);
    setResetConfirmation("");
    setResetError("");
    setResetPreview(null);
    setResetOpen(true);
    try {
      const response = await fetch(`/api/owner-delete?kind=project&targetId=${encodeURIComponent(projectProfile.number)}`, { cache: "no-store" });
      const result = (await response.json()) as { preview?: { records: number; files: number; linkedRows: number }; error?: string };
      if (!response.ok || !result.preview) throw new Error(result.error || "Deletion impact could not be loaded.");
      setResetPreview(result.preview);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Deletion impact could not be loaded.");
    }
  }

  async function deleteActiveProject() {
    if (resetConfirmation !== projectProfile.name) {
      setResetError(`Type ${projectProfile.name} Exactly To Confirm Deletion Quarantine.`);
      return;
    }
    const deletedName = projectProfile.name;
    const deletedNumber = projectProfile.number;
    setResetSaving(true);
    setResetError("");
    try {
      const response = await fetch("/api/owner-delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "project",
          targetId: deletedNumber,
          confirmation: resetConfirmation,
        }),
      });
      const result = (await response.json()) as { deleted?: boolean; quarantined?: boolean; purgeAfter?: string; error?: string };
      if (!response.ok || !result.deleted) {
        throw new Error(result.error || "The project could not be moved to deletion quarantine.");
      }
      const remainingProjects = projects.filter((project) => project.number !== deletedNumber);
      const nextProject = remainingProjects[0] || emptyProjectProfile();
      setProjects(remainingProjects);
      setProjectProfile(nextProject);
      setPortfolioRecords((current) => Object.fromEntries(Object.entries(current).filter(([projectId]) => projectId !== deletedNumber)));
      setPortfolioFiles((current) => Object.fromEntries(Object.entries(current).filter(([projectId]) => projectId !== deletedNumber)));
      setRecords(createCleanProjectRecords());
      setNotifications([]);
      setSelectedRecord(null);
      setResetOpen(false);
      setProjectSetupOpen(false);
      setResetConfirmation("");
      setResetPreview(null);
      setActive(nextProject.number ? "Project Overview" : "Dashboard");
      setNotice(`${deletedName} And All Related Project Data Were Moved To 30-Day Owner Recovery Quarantine.`);
      window.setTimeout(() => setNotice(""), 3600);
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "The project could not be moved to deletion quarantine.",
      );
    } finally {
      setResetSaving(false);
    }
  }

  function reserveProjectCameraSlot() {
    if (projectProfile.cameraCount >= 16) return;
    updateActiveProject({ cameraCount: projectProfile.cameraCount + 1 });
    setNotice(`Camera slot ${String(projectProfile.cameraCount + 1).padStart(2, "0")} reserved. No device or live feed was connected.`);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function openDashboardCustomizer() {
    setDashboardToolDraft(dashboardToolOrder);
    setDashboardVisibleDraft(dashboardVisibleTools);
    setDashboardCustomizeOpen(true);
  }

  function moveDashboardTool(title: string, direction: -1 | 1) {
    setDashboardToolDraft((current) => {
      const index = current.indexOf(title);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveDashboardPreferences() {
    if (!dashboardVisibleDraft.length) {
      setNotice("Keep At Least One Project Tool Visible.");
      return;
    }
    setDashboardPreferencesSaving(true);
    try {
      const response = await fetch("/api/dashboard-preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projectProfile.number, orderedTools: dashboardToolDraft, visibleTools: dashboardVisibleDraft }) });
      const result = await response.json() as { orderedTools?: string[]; visibleTools?: string[]; notice?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "The Project Tool Layout Could Not Be Saved.");
      setDashboardToolOrder(result.orderedTools || dashboardToolDraft);
      setDashboardVisibleTools(result.visibleTools || dashboardVisibleDraft);
      setDashboardCustomizeOpen(false);
      setNotice(result.notice || "Personal Project Tool Layout Saved Permanently.");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Project Tool Layout Could Not Be Saved."); }
    finally { setDashboardPreferencesSaving(false); }
  }

  function openNew(type?: string) {
    const nextType =
      type && !["Dashboard", "Project Overview"].includes(type)
        ? type
        : "Daily Logs";
    if (!workspaceCopy[nextType]) {
      setNotice(`Use The Controls Inside ${nextType} To Create Its Records.`);
      window.setTimeout(() => setNotice(""), 3200);
      return;
    }
    if (!projectProfile.number) { setNotice("Select A Project Before Adding A Record."); chooseNav("Project Overview"); return; }
    if (!canActorAccessNavigation(sessionActor, nextType === "Toolbox Talks" ? "Safety" : nextType)) { setNotice("This Record Type Is Outside Your Current Permissions."); return; }
    setRecordFormError("");
    setFormType(nextType);
    setRecordTitle("");
    setRecordOwner(sessionActor.name || projectProfile.superintendent || projectProfile.projectManager || "Office");
    setRecordNotes("");
    const today = currentDateInput(projectProfile.timeZone);
    setDailyDate(today);
    setRecordDate(today);
    setRecordTime(currentTimeInput(projectProfile.timeZone));
    const automaticWeatherAvailable = Boolean(projectWeatherAddress);
    setDailyWeatherMetrics(blankDailyWeatherMetrics());
    setDailyWeather(
      automaticWeatherAvailable ? "Loading Project Weather..." : "Enter Weather Manually",
    );
    setDailyWeatherSource(
      automaticWeatherAvailable
        ? "Checking Project Location..."
        : "Project Address Required For Automatic Weather",
    );
    setDailyWeatherLoading(automaticWeatherAvailable);
    setEmployeesOnSite([]);
    setSubsOnSite([]);
    setIncidentReported(false);
    setIncidentDetails("");
    setPhotoNames([]);
    setPhotoFiles([]);
    setPhotoMarkups({});
    setPhotoEditorFile(null);
    setToolboxAttendees([]);
    setSignedAttendees([]);
    setSignedAttendeeEvidence({});
    setSignaturePerson(null);
    setHasSignatureInk(false);
    setFormOpen(true);
  }

  function openMobileQuickAction(action: MobileQuickAction) {
    if (!canActorAccessNavigation(sessionActor, action.target)) {
      setNotice("This Quick Add Action Is Outside Your Current Role Permissions.");
      return;
    }
    if (action.formType) {
      openNew(action.formType);
      if (action.id === "camera") {
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>(".photo-upload input[type='file']")?.click();
        }, 120);
      }
      return;
    }
    chooseNav(action.target);
    const guidance: Record<string, string> = {
      quality: "Use New Quality Item Inside Quality Control.",
      receipt: "Use New Invoice To Capture And Cost-Code This Receipt Or Invoice.",
      schedule: "Select The Activity And Enter Its Current Field Progress.",
      visitor: "Open Visitor Records Inside Safety To Capture The Waiver And Signature.",
      "pre-work": "Open The Schedule-Triggered Pre-Work Checklist In Quality Control.",
    };
    setNotice(guidance[action.id] || `${action.label} Opened.`);
    window.setTimeout(() => setNotice(""), 3600);
  }

  function openRecordDetails(record: RecordItem, type = active) {
    setSelectedRecord({ type, id: record.id });
    setCorrectionDate(
      record.recordDate ||
        inputDateFromNumeric(record.due) ||
        currentDateInput(projectProfile.timeZone),
    );
    setCorrectionTime(
      record.recordTime || currentTimeInput(projectProfile.timeZone),
    );
    setCorrectionReason("");
    setCorrectionField("Date And Time");
    setCorrectionValue("");
    setLastCorrectionRecipient("");
    setCorrectingRecordDate(false);
    setLegalLifecycleAction(null);
    setLegalLifecycleReason("");
  }

  function chooseCorrectionField(field: CorrectionField) {
    setCorrectionField(field);
    setCorrectionValue(
      field === "Title Or Description"
        ? selectedRecordItem?.title ?? ""
        : field === "Responsible Person"
          ? selectedRecordItem?.owner ?? ""
          : field === "Details"
            ? selectedRecordItem?.meta ?? ""
            : "",
    );
  }

  async function saveAdminCorrection() {
    const nextCorrectionDate =
      correctionDateInput.current?.value || correctionDate;
    const nextCorrectionTime =
      correctionTimeInput.current?.value || correctionTime;
    if (!selectedRecord || !selectedRecordItem || !correctionReason.trim()) {
      setNotice("Add the corrected value and required reason before saving.");
      return;
    }

    const changes: Partial<RecordItem> = {};
    let oldValue = "";
    let newValue = "";
    if (correctionField === "Date And Time") {
      if (!nextCorrectionDate || !nextCorrectionTime) {
        setNotice("Add the corrected date and time before saving.");
        return;
      }
      oldValue = `${
        selectedRecordItem.recordDate
          ? numericDateFromInput(selectedRecordItem.recordDate)
          : selectedRecordItem.due
      } At ${displayTimeInput(selectedRecordItem.recordTime || "")}`;
      newValue = `${numericDateFromInput(nextCorrectionDate)} At ${displayTimeInput(nextCorrectionTime)}`;
      changes.due = numericDateFromInput(nextCorrectionDate);
      changes.recordDate = nextCorrectionDate;
      changes.recordTime = nextCorrectionTime;
    } else {
      newValue = correctionValue.trim();
      if (!newValue) {
        setNotice("Add the corrected value before saving.");
        return;
      }
      if (correctionField === "Title Or Description") {
        oldValue = selectedRecordItem.title;
        changes.title = newValue;
      } else if (correctionField === "Responsible Person") {
        oldValue = selectedRecordItem.owner;
        changes.owner = newValue;
      } else {
        oldValue = selectedRecordItem.meta;
        changes.meta = newValue;
      }
    }

    setCorrectionSaving(true);
    try {
      const response = await fetch(
        `/api/records/${encodeURIComponent(selectedRecord.id)}/corrections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectProfile.number,
            recordType: selectedRecord.type,
            fieldName: correctionField,
            oldValue,
            newValue,
            reason: correctionReason.trim(),
            record: selectedRecordItem,
            changes,
          }),
        },
      );
      const result = (await response.json()) as {
        audit?: string;
        notified?: string;
        error?: string;
      };
      if (!response.ok || !result.audit) {
        throw new Error(result.error || "The correction could not be saved.");
      }
      setRecords((current) => ({
        ...current,
        [selectedRecord.type]: (current[selectedRecord.type] ?? []).map(
          (record) =>
            record.id === selectedRecord.id
              ? {
                  ...record,
                  ...changes,
                  dateLocked: selectedRecordDateLocked,
                  auditHistory: [
                    ...(record.auditHistory ?? record.dateAudit ?? []),
                    result.audit!,
                  ],
                  persistent: true,
                }
              : record,
        ),
      }));
      setCorrectionDate(nextCorrectionDate);
      setCorrectionTime(nextCorrectionTime);
      setLastCorrectionRecipient(result.notified || selectedRecordItem.owner);
      void loadStoredNotifications();
      setCorrectingRecordDate(false);
      setCorrectionReason("");
      setNotice(
        `${selectedRecord.id} Correction Saved Permanently. ${result.notified || selectedRecordItem.owner} Was Notified.`,
      );
      window.setTimeout(() => setNotice(""), 3600);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The correction could not be saved permanently.",
      );
      window.setTimeout(() => setNotice(""), 3600);
    } finally {
      setCorrectionSaving(false);
    }
  }

  async function completeLegalLifecycleAction() {
    if (
      !selectedRecord ||
      !selectedRecordItem ||
      !legalLifecycleAction ||
      !legalLifecycleReason.trim()
    ) {
      setNotice("Add The Required Explanation Before Continuing.");
      return;
    }
    setLegalLifecycleSaving(true);
    try {
      const response = await fetch(
        `/api/records/${encodeURIComponent(selectedRecord.id)}/lifecycle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectProfile.number,
            recordType: selectedRecord.type,
            action: legalLifecycleAction,
            reason: legalLifecycleReason.trim(),
          }),
        },
      );
      const result = (await response.json()) as {
        saved?: RecordItem;
        amendment?: RecordItem;
        deleted?: boolean;
        audit?: string;
        changedBudgetRecords?: Array<{
          id: string;
          data: Record<string, unknown>;
          meta: string;
        }>;
        notifiedNames?: string[];
        error?: string;
      };
      if (!response.ok || !result.audit) {
        throw new Error(
          result.error || "The Controlled Record Action Could Not Be Completed.",
        );
      }
      setRecords((current) => {
        const next = { ...current };
        const currentTypeRecords = current[selectedRecord.type] ?? [];
        if (result.deleted) {
          next[selectedRecord.type] = currentTypeRecords.filter(
            (record) => record.id !== selectedRecord.id,
          );
        } else if (result.amendment) {
          next[selectedRecord.type] = [
            {
              ...result.amendment,
              auditHistory: [result.audit!],
              persistent: true,
            },
            ...currentTypeRecords,
          ];
        } else if (result.saved) {
          next[selectedRecord.type] = currentTypeRecords.map((record) =>
            record.id === selectedRecord.id
              ? {
                  ...record,
                  ...result.saved,
                  auditHistory: [
                    ...(record.auditHistory ?? []),
                    result.audit!,
                  ],
                  persistent: true,
                }
              : record,
          );
        }
        if (result.changedBudgetRecords?.length) {
          const changes = new Map(
            result.changedBudgetRecords.map((record) => [record.id, record]),
          );
          next.Budget = (current.Budget ?? []).map((record) => {
            const change = changes.get(record.id);
            return change
              ? {
                  ...record,
                  data: change.data,
                  meta: change.meta,
                  persistent: true,
                }
              : record;
          });
        }
        return next;
      });
      const actionMessage = {
        return_to_draft: `${selectedRecord.id} Returned To Draft.`,
        void_archive: `${selectedRecord.id} Voided And Archived. Financial Commitments Were Reversed Where Required.`,
        create_amendment: `${result.amendment?.id || "The Amendment"} Created And Attached To ${selectedRecord.id}.`,
        permanent_delete: `${selectedRecord.id} Permanently Deleted By Company Owner.`,
      }[legalLifecycleAction];
      if (result.deleted) {
        setSelectedRecord(null);
      } else if (result.amendment) {
        setSelectedRecord({
          type: selectedRecord.type,
          id: result.amendment.id,
        });
      }
      setLegalLifecycleAction(null);
      setLegalLifecycleReason("");
      setNotice(
        `${actionMessage} Project Manager Owners And Administrators Were Notified.`,
      );
      window.setTimeout(() => setNotice(""), 4500);
      void loadStoredNotifications();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The Controlled Record Action Could Not Be Completed.",
      );
      window.setTimeout(() => setNotice(""), 4500);
    } finally {
      setLegalLifecycleSaving(false);
    }
  }

  async function saveDraftRecordDate() {
    if (!selectedRecord || !correctionDate || !correctionTime) {
      setNotice("Add both the date and time before saving.");
      return;
    }
    const currentRecord = records[selectedRecord.type]?.find(
      (record) => record.id === selectedRecord.id,
    );
    if (!currentRecord) return;
    const updatedRecord = {
      ...currentRecord,
      due: numericDateFromInput(correctionDate),
      recordDate: correctionDate,
      recordTime: correctionTime,
      persistent: true,
    };
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectProfile.number,
        recordType: selectedRecord.type,
        record: updatedRecord,
      }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setNotice(result.error || "The draft date could not be saved permanently.");
      return;
    }
    setRecords((current) => ({
      ...current,
      [selectedRecord.type]: (current[selectedRecord.type] ?? []).map(
        (record) =>
          record.id === selectedRecord.id
            ? {
                ...record,
                ...updatedRecord,
              }
            : record,
      ),
    }));
    setSelectedRecord(null);
    setNotice(`${selectedRecord.id} date and time updated.`);
    window.setTimeout(() => setNotice(""), 2800);
  }

  function toggleValue(
    value: string,
    current: string[],
    update: (next: string[]) => void,
  ) {
    update(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function beginSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvas.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeStyle = "#171717";
    context.beginPath();
    context.moveTo(
      ((event.clientX - rect.left) * canvas.width) / rect.width,
      ((event.clientY - rect.top) * canvas.height) / rect.height,
    );
    setHasSignatureInk(true);
  }

  function drawSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const canvas = signatureCanvas.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineTo(
      ((event.clientX - rect.left) * canvas.width) / rect.width,
      ((event.clientY - rect.top) * canvas.height) / rect.height,
    );
    context.stroke();
  }

  function clearSignature() {
    const canvas = signatureCanvas.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignatureInk(false);
  }

  function acceptSignature() {
    const canvas = signatureCanvas.current;
    if (!signaturePerson || !hasSignatureInk || !canvas) return;
    const evidence = {
      typedIdentity: signaturePerson,
      signatureImage: canvas.toDataURL("image/png"),
      signedAt: new Date().toISOString(),
      deviceRecord: mobileDeviceId(),
      method: "Finger Or Apple Pencil",
    };
    setSignedAttendees((current) =>
      current.includes(signaturePerson)
        ? current
        : [...current, signaturePerson],
    );
    setSignedAttendeeEvidence((current) => ({ ...current, [signaturePerson]: evidence }));
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setSignaturePerson(null);
    setHasSignatureInk(false);
  }

  async function saveRecord() {
    setRecordFormError("");
    if (!recordTitle.trim()) {
      setRecordFormError("Describe the work completed before finalizing this record.");
      document.getElementById("record-description")?.focus();
      setNotice("Add a title or description before saving.");
      window.setTimeout(() => setNotice(""), 2500);
      return;
    }
    if (
      formType === "Daily Logs" &&
      (
        !dailyWeatherMetrics.rainfallInches.trim() ||
        !Number.isFinite(Number(dailyWeatherMetrics.rainfallInches)) ||
        Number(dailyWeatherMetrics.rainfallInches) < 0 ||
        !dailyWeatherMetrics.averageTemperatureF.trim() ||
        !Number.isFinite(Number(dailyWeatherMetrics.averageTemperatureF)) ||
        !dailyWeatherMetrics.averageWindSpeedMph.trim() ||
        !Number.isFinite(Number(dailyWeatherMetrics.averageWindSpeedMph)) ||
        Number(dailyWeatherMetrics.averageWindSpeedMph) < 0 ||
        !dailyWeatherMetrics.averageConditions.trim()
      )
    ) {
      setRecordFormError("Complete rainfall, temperature, wind speed, and conditions in Daily Weather before finalizing.");
      document.getElementById("daily-weather-section")?.setAttribute("open", "");
      setNotice(
        "Complete Daily Rainfall Average Temperature Average Wind Speed And Average Conditions Before Finalizing.",
      );
      window.setTimeout(() => setNotice(""), 3200);
      return;
    }
    if (
      formType === "Toolbox Talks" &&
      (toolboxAttendees.length === 0 ||
        !toolboxAttendees.every((name) => signedAttendees.includes(name) && signedAttendeeEvidence[name]?.signatureImage))
    ) {
      setRecordFormError("Every listed attendee must sign before this toolbox talk can be completed.");
      setNotice(
        "Every listed attendee must sign before the toolbox talk can be completed.",
      );
      window.setTimeout(() => setNotice(""), 7000);
      return;
    }
    const copy = workspaceCopy[formType];
    const nextNumber = (records[formType]?.length ?? 0) + 1;
    const dailyDateCode = dailyDate.slice(5).replace("-", "");
    const id =
      formType === "Daily Logs"
        ? `DL-${dailyDateCode}`
        : `${copy.prefix}-${String(nextNumber).padStart(3, "0")}`;
    const status =
      formType === "Daily Logs"
        ? "Final"
        : formType === "Toolbox Talks"
          ? "Complete"
          : formType === "Change Orders"
            ? "Requested"
            : formType === "Team"
              ? "Active"
              : "Draft";
    const peopleCount = employeesOnSite.length + subsOnSite.length;
    const finalizationSummary =
      `Finalized By ${recordOwner} · ${numericDateFromInput(formType === "Daily Logs" ? dailyDate : recordDate)} · ${displayTimeInput(recordTime)}` +
      (formType === "Daily Logs" ? ` · Weather Snapshot Locked: ${dailyWeather}` : "");
    const meta =
      formType === "Daily Logs"
        ? `${peopleCount} people on site · ${dailyWeather} · ${photoNames.length} photo${photoNames.length === 1 ? "" : "s"} · ${incidentReported ? "Incident reported" : "No incidents"}`
        : formType === "Toolbox Talks"
          ? `${toolboxAttendees.length} attendees · ${signedAttendees.length} of ${toolboxAttendees.length} signed`
          : formType === "Change Orders"
            ? "Awaiting project-manager approval · Pricing restricted"
            : formType === "RFIs"
              ? "Project managers will receive overdue alerts"
              : recordNotes || "Created in Command Center";
    const item: RecordItem = {
      id,
      title: recordTitle.trim(),
      owner: recordOwner,
      due:
        formType === "Daily Logs"
          ? numericDateFromInput(dailyDate)
          : numericDateFromInput(recordDate),
      status,
      meta,
      recordDate: formType === "Daily Logs" ? dailyDate : recordDate,
      recordTime,
      dateLocked: isFinalRecordStatus(status),
      dateAudit: isFinalRecordStatus(status)
        ? [finalizationSummary]
        : [],
      auditHistory: isFinalRecordStatus(status)
        ? [finalizationSummary]
        : [],
      persistent: true,
    };
    const markedPhotoFiles = Object.values(photoMarkups).flatMap((markup) => markup.annotatedFile ? [markup.annotatedFile] : []);
    const uploadablePhotoFiles = [...photoFiles, ...markedPhotoFiles];
    setRecordSaving(true);
    const submissionLocation = await captureSubmissionLocation();
    const recordForStorage = {
      ...item,
      data: {
        notes: recordNotes,
        weather: formType === "Daily Logs" ? dailyWeather : undefined,
        weatherSource:
          formType === "Daily Logs" ? dailyWeatherSource : undefined,
        weatherSnapshot:
          formType === "Daily Logs"
            ? {
                schemaVersion: "DAILY-WEATHER-1",
                date: dailyDate,
                rainfallInches: Number(dailyWeatherMetrics.rainfallInches),
                averageTemperatureF: Number(dailyWeatherMetrics.averageTemperatureF),
                averageWindSpeedMph: Number(dailyWeatherMetrics.averageWindSpeedMph),
                averageConditions: dailyWeatherMetrics.averageConditions.trim(),
                source: dailyWeatherSource || "Manual Daily Weather Entry",
                resolvedAddress: dailyWeatherMetrics.resolvedAddress || projectWeatherAddress,
                capturedAt: dailyWeatherMetrics.capturedAt || new Date().toISOString(),
                finalizedAt: new Date().toISOString(),
                locked: true,
              }
            : undefined,
        employeesOnSite,
        subcontractorsOnSite: subsOnSite,
        incidentReported,
        incidentDetails,
        toolboxAttendees,
        signedAttendees,
        signatureEvidence:
          formType === "Toolbox Talks"
            ? signedAttendees.map((name) => signedAttendeeEvidence[name]).filter(Boolean)
            : undefined,
        photos: photoNames,
        photoMarkups:
          formType === "Daily Logs"
            ? Object.values(photoMarkups).map((markup) => ({
                originalName: markup.originalName,
                markedCopy: markup.annotatedFile?.name || "",
                caption: markup.caption,
                beforeAfterRole: markup.pairRole,
                beforeAfterReference: markup.pairReference,
                operationCount: markup.operationCount,
                originalPreserved: true,
              }))
            : undefined,
        submissionLocation,
        locationPolicy: submissionLocation
          ? "Captured once at field-record submission with device permission"
          : "Not captured; permission unavailable or declined",
      },
      initialAudit: item.auditHistory?.[0],
    };
    let savedOffline = false;
    let photosQueued = false;
    try {
      if (!navigator.onLine) {
        if (!canQueueOfflineAction(formType)) {
          throw new Error(
            "This action requires a live connection. Contracts, financial approvals, Owner overrides and final closeout authorization never queue offline.",
          );
        }
        await queueOfflineMobileRecord({
          projectId: projectProfile.number,
          recordType: formType,
          record: recordForStorage,
          files: formType === "Daily Logs" ? uploadablePhotoFiles : [],
        });
        savedOffline = true;
      } else {
        let response: Response;
        try {
          response = await fetch("/api/records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: projectProfile.number,
              recordType: formType,
              record: recordForStorage,
            }),
          });
        } catch (networkError) {
          if (!canQueueOfflineAction(formType)) throw networkError;
          await queueOfflineMobileRecord({
            projectId: projectProfile.number,
            recordType: formType,
            record: recordForStorage,
            files: formType === "Daily Logs" ? uploadablePhotoFiles : [],
          });
          savedOffline = true;
          response = new Response(null, { status: 202 });
        }
        if (!savedOffline) {
          const saved = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(saved.error || "The record could not be saved permanently.");
          }
        }

        if (!savedOffline && formType === "Daily Logs" && uploadablePhotoFiles.length) {
          try {
            await Promise.all(
              uploadablePhotoFiles.map(async (file) => {
                const form = new FormData();
                form.set("file", file);
                form.set("projectId", projectProfile.number);
                form.set("category", "Photos");
                form.set("revision", `${id} Daily Log Photo`);
                form.set("access", "Project team");
                const upload = await fetch("/api/files", {
                  method: "POST",
                  body: form,
                });
                if (!upload.ok) throw new Error(`${file.name} could not be stored.`);
              }),
            );
          } catch {
            const photoQueueRecord = {
              ...recordForStorage,
              id: `${id}-PHOTOS`,
              title: `${item.title} · Offline Photo Uploads`,
              status: "Queued Offline",
              meta: `${photoFiles.length} original photo${photoFiles.length === 1 ? "" : "s"} and ${markedPhotoFiles.length} marked cop${markedPhotoFiles.length === 1 ? "y" : "ies"} waiting to sync`,
            };
            await queueOfflineMobileRecord({
              projectId: projectProfile.number,
              recordType: "Photos",
              record: photoQueueRecord,
              files: uploadablePhotoFiles,
            });
            photosQueued = true;
          }
        }
      }
    } catch (error) {
      setRecordSaving(false);
      setRecordFormError(error instanceof Error ? error.message : "The record could not be saved. Your entries remain in this form.");
      setNotice(
        error instanceof Error
          ? error.message
          : "The record could not be saved permanently.",
      );
      window.setTimeout(() => setNotice(""), 3600);
      return;
    }
    const displayedItem = savedOffline
      ? { ...item, status: "Queued Offline", meta: `${item.meta} · Waiting For Connection` }
      : item;
    setRecords((current) => ({
      ...current,
      [formType]: [displayedItem, ...(current[formType] ?? [])],
    }));
    if (formType === "Daily Logs") await dailyDraft.clear().catch(() => undefined);
    setRecordSaving(false);
    setFormOpen(false);
    setActive(formType === "Toolbox Talks" ? "Safety" : formType);
    setNotice(
      savedOffline
        ? `${id} is safely queued on this trusted device and will sync automatically when service returns.`
        : photosQueued
          ? `${id} saved. Its original photos are safely queued and will resume uploading automatically.`
      : formType === "Daily Logs"
        ? `${id} Uploaded And Finalized For ${projectProfile.name}. Available To The Project Team.`
        : formType === "Change Orders"
          ? `${id} sent to the project-manager approval queue.`
          : formType === "Toolbox Talks"
            ? `${id} completed with all attendee signatures.`
            : `${id} saved as a draft.`,
    );
    window.setTimeout(() => setNotice(""), 7000);
  }

  const canViewProjectFinancials =
    ["Company Owner", "Administrator"].includes(sessionActor.accessLevel) ||
    sessionActor.designations.includes("Project Manager") ||
    sessionActor.name === projectProfile.projectManager;
  const visibleCompanyNavFolders = companyNavFolders
    .map((folder) => ({
      ...folder,
      items: folder.items.filter((item) =>
        canActorAccessNavigation(sessionActor, item.target) &&
        (item.target !== "Team" || Boolean(projectProfile.number)),
      ),
    }));
  const visiblePreconstructionNavGroups = preconstructionNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canActorAccessNavigation(sessionActor, item.target)),
    }))
    .filter((group) => group.items.length > 0);
  const visibleProjectNavFolders = navFolders
    .map((folder) => ({
      ...folder,
      items: folder.items.filter((item) =>
        (Boolean(projectProfile.number) || Boolean("company" in item && item.company)) &&
        canActorAccessNavigation(sessionActor, item.target),
      ),
    }));
  const navigationTools: WorkTool[] = [
    { target: "My Work", label: "My Work", group: "Everyday" },
    { target: "Dashboard", label: "Company Dashboard", group: "Company" },
    { target: "Owner Approvals", label: "Owner Approvals", group: "Company" },
    { target: "Project Health", label: "Project Health", group: "Company" },
    { target: "Project Overview", label: "Project Workspace", group: "Projects" },
    { target: "Documents", label: "Project Files", group: "Projects" },
    ...(projectProfile.number ? [{ target: "Team", label: "Project Team", group: "Projects" }] : []),
    { target: "Company Calendar", label: "Company Calendar", group: "Company" },
    ...visiblePreconstructionNavGroups.flatMap((group) => group.items.map((item) => ({ target: item.target, label: item.label, group: group.label }))),
    ...visibleProjectNavFolders.flatMap((group) => group.items.map((item) => ({ target: item.target, label: item.label, group: group.label }))),
    ...visibleCompanyNavFolders.flatMap((group) => group.items.map((item) => ({ target: item.target, label: item.label, group: group.label }))),
    ...["IT & Integrations", "Assets & Fleet", "Performance Reviews", "Employee Onboarding", "Employee Portal", "Review"].map((target) => ({ target, label: target === "Employee Portal" ? "My Profile & Resources" : target === "Review" ? "Legal & Template Review" : target, group: "Company" })),
  ].filter((tool, index, all) => canActorAccessNavigation(sessionActor, tool.target) && all.findIndex((item) => item.target === tool.target) === index);
  const everydayTools = authorizedShortcuts(sessionActor, navigationTools);
  const visibleDashboardModules = dashboardToolOrder.flatMap((title) => {
    const item = modules.find((candidate) => candidate.title === title);
    return item && dashboardVisibleTools.includes(title) ? [item] : [];
  });
  const companyWorkspaceActive = projectToolContext !== active && [
    "Dashboard",
    "My Work",
    "Owner Approvals",
    "Project Health",
    "IT & Integrations",
    "Assets & Fleet",
    "Performance Reviews",
    "Quarterly Rock/Review",
    "Weekly L10",
    "Sales/Estimating Department",
    "Sales To Estimating Turnover",
    "Estimating To Operations Turnover",
    "Operations Department",
    "Accounting Department",
    "Employee Onboarding",
    "Review",
    "Sales Dashboard",
    "Sales Contacts",
    "Sales Funnel",
    "Sales Design",
    "Estimating",
    "Estimating Calendar",
    "Marketing",
    "Marketing Social",
    "Marketing Email",
    "Marketing Surveys",
    "Marketing Calendar",
    "Company Calendar",
    "User Guide",
    "Bid Management",
    "Sales Goals",
    ...adminNavigationTargets,
    ...accountingNavigationTargets,
  ].includes(active);
  const projectBudgetControl = (records["Budget Control"] ?? []).find(
    (record) => record.id === BUDGET_CONTROL_ID,
  );
  const projectBudgetCodes = selectedBudgetRecords(records.Budget ?? []);
  const projectOriginalBudget = projectBudgetCodes.reduce(
    (total, record) => total + budgetCodeData(record).originalBudget,
    0,
  );
  const projectBudgetReady =
    budgetControlData(projectBudgetControl).locked &&
    projectBudgetCodes.length > 0 &&
    projectOriginalBudget > 0;
  const projectOpenStatuses = [
    "Open",
    "Pending",
    "Overdue",
    "Due today",
    "In review",
    "Pricing",
    "Scheduled",
    "Awaiting Release",
  ];
  const projectOpenSources = [
    { section: "RFIs", records: records.RFIs ?? [] },
    { section: "Submittals", records: records.Submittals ?? [] },
    { section: "Change Orders", records: records["Change Orders"] ?? [] },
    { section: "Safety", records: records["Toolbox Talks"] ?? [] },
    { section: "Selections", records: records.Selections ?? [] },
  ];
  const projectOpenItemCount = projectOpenSources.reduce(
    (total, source) =>
      total +
      source.records.filter((record) =>
        projectOpenStatuses.includes(record.status),
      ).length,
    0,
  );
  const projectAttention = attention.length
    ? attention
    : [
        ...(records.RFIs ?? []).map((record) => ({ record, type: "RFI" })),
        ...(records.Submittals ?? []).map((record) => ({
          record,
          type: "SUBMITTAL",
        })),
        ...(records["Change Orders"] ?? []).map((record) => ({
          record,
          type: "CHANGE",
        })),
        ...(records.Selections ?? []).map((record) => ({
          record,
          type: "SELECTION",
        })),
      ]
        .filter(({ record }) =>
          ["Open", "Pending", "Overdue", "Due today", "In review", "Pricing", "Awaiting Release"].includes(
            record.status,
          ),
        )
        .slice(0, 3)
        .map(({ record, type }) => ({
          type,
          number: record.id,
          title: record.title,
          due: record.due,
          owner: record.owner,
          urgent: ["Overdue", "Due today"].includes(record.status),
        }));
  const pendingChangeTotal = (records["Change Orders"] ?? [])
    .filter((record) => !["Executed", "Rejected", "Void"].includes(record.status))
    .reduce(
      (total, record) => total + Number(changeOrderData(record).approvedTotal || 0),
      0,
    );
  const scheduleProgressValues = (records.Schedule ?? [])
    .map((record) => Number(record.data?.progress || 0))
    .filter((value) => Number.isFinite(value));
  const projectProgress = scheduleProgressValues.length
    ? Math.round(
        scheduleProgressValues.reduce((total, value) => total + value, 0) /
          scheduleProgressValues.length,
      )
    : 0;
  const latestDailyLog = records["Daily Logs"]?.[0];
  const peopleOnSite = latestDailyLog
    ? (Array.isArray(latestDailyLog.data?.employeesOnSite)
        ? latestDailyLog.data.employeesOnSite.length
        : 0) +
      (Array.isArray(latestDailyLog.data?.subcontractorsOnSite)
        ? latestDailyLog.data.subcontractorsOnSite.length
        : 0)
    : 0;
  const recentProjectPhotos = projectPhotos.slice(0, 8);

  function openPhotoDailyLog(photo: ProjectFile) {
    const dailyLogId = dailyLogIdForPhoto(photo);
    const dailyLog = (records["Daily Logs"] ?? []).find(
      (record) => record.id === dailyLogId,
    );
    setSelectedProjectPhoto(null);
    setPhotoGalleryOpen(false);
    if (dailyLog) {
      openRecordDetails(dailyLog, "Daily Logs");
      return;
    }
    chooseNav("Daily Logs");
  }

  function openAttentionItem(item: (typeof projectAttention)[number]) {
    const recordType =
      item.type === "RFI"
        ? "RFIs"
        : item.type === "SUBMITTAL"
          ? "Submittals"
          : item.type === "SELECTION"
            ? "Selections"
            : "Change Orders";
    const record = (records[recordType] ?? []).find(
      (candidate) => candidate.id === item.number,
    );
    if (record) {
      openRecordDetails(record, recordType);
      return;
    }
    chooseNav(recordType);
  }

  function projectModuleDetail(title: string, fallback: string) {
    if (title === "Schedule") {
      const count = records.Schedule?.length ?? 0;
      return count ? `${count} Activities · ${projectProgress}% Complete` : fallback;
    }
    if (title === "Daily Log") {
      const count = records["Daily Logs"]?.length ?? 0;
      return count ? `${count} Daily Log${count === 1 ? "" : "s"}` : fallback;
    }
    if (title === "Toolbox Talk") {
      const count = records["Toolbox Talks"]?.length ?? 0;
      return count ? `${count} Toolbox Talk${count === 1 ? "" : "s"}` : fallback;
    }
    if (title === "RFIs") {
      const count = records.RFIs?.length ?? 0;
      return count ? `${count} Project RFI${count === 1 ? "" : "s"}` : fallback;
    }
    if (title === "Submittals") {
      const count = records.Submittals?.length ?? 0;
      return count ? `${count} Project Submittal${count === 1 ? "" : "s"}` : fallback;
    }
    if (title === "Change Orders") {
      const count = records["Change Orders"]?.length ?? 0;
      return count ? `${count} Project Change${count === 1 ? "" : "s"}` : fallback;
    }
    if (title === "Budget") {
      const count = selectedBudgetRecords(records.Budget ?? []).length;
      return projectBudgetReady
        ? `${count} Cost Code${count === 1 ? "" : "s"} · Original Budget Locked`
        : "Original Budget Setup Required";
    }
    return fallback;
  }

  if (externalPricingToken) {
    return (
      <VendorPricingPortal
        token={externalPricingToken}
        project={projectProfile}
        records={records["Change Orders"] ?? []}
        onRecordsChange={(next) =>
          setRecords((current) => ({ ...current, "Change Orders": next }))
        }
      />
    );
  }

  if (externalVendorInviteId) {
    return <Suspense fallback={<main className="session-access-gate"><strong>Opening Vendor Portal</strong><span className="session-access-progress" aria-hidden="true" /></main>}><VendorPortal inviteId={externalVendorInviteId} /></Suspense>;
  }

  if (externalOwnerInviteId) {
    return <Suspense fallback={<main className="session-access-gate"><strong>Opening Owner Portal</strong><span className="session-access-progress" aria-hidden="true" /></main>}><ProjectOwnerPortal inviteId={externalOwnerInviteId} /></Suspense>;
  }

  if (sessionStatus !== "ready") {
    return (
      <main className="session-access-gate" aria-live="polite">
        <Mark />

        <h1>
          {sessionStatus === "loading"
            ? "Verifying Employee Access"
            : signInOutcome?.status === "not-approved"
              ? "Signed In — Not Yet Approved"
              : signInOutcome?.status === "error"
                ? "Sign-In Could Not Be Completed"
                : "Sign In Required"}
        </h1>
        <p>
          {sessionStatus === "loading"
            ? "Confirming your signed-in identity, company status, onboarding cycle, and current permissions."
            : signInOutcome?.status === "not-approved"
              ? `Microsoft confirmed your identity, but this account is not yet approved for Command Center access${signInOutcome.reason ? ` (${signInOutcome.reason})` : ""}. Ask the Company Owner to approve it, then sign in again.`
              : signInOutcome?.status === "error"
                ? signInOutcome.reason || "Something went wrong during Microsoft sign-in. Please try again."
                : "Sign in with your Mefford Microsoft 365 account to continue."}
        </p>
        {sessionStatus === "error" ? (
          <a className="primary-action" href="/api/microsoft-auth/start" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Sign In With Microsoft</a>
        ) : <span className="session-access-progress" aria-hidden="true" />}
      </main>
    );
  }

  if (sessionActor.permissionLocked) {
    return (
      <main className="locked-employee-shell">
        <AutomationHeartbeat />
        <header>
          <div className="brand locked-employee-brand"><Mark /><div><strong>MEFFORD</strong><span>EMPLOYEE ACCESS</span></div></div>
          <div className="locked-employee-identity"><span>{personInitials(sessionActor.name)}</span><div><strong>{sessionActor.name}</strong><small>{sessionActor.onboardingStatus || "Onboarding Required"}</small></div></div>
        </header>
        <nav aria-label="Employee access sections">
          <button className="active" onClick={() => setActive("Employee Portal")}>My Work</button>
          <span>Follow the one next action shown. Command Center routes company review automatically and opens your full access when onboarding is approved.</span>
        </nav>
        <section className="locked-employee-content">
          <Suspense fallback={<section className="panel empty-attention-state"><strong>Opening Employee Home</strong><span>Loading the authorized employee workspace…</span></section>}>
            <EmployeePortalWorkspace actor={sessionActor} />
          </Suspense>
        </section>
      </main>
    );
  }

  return (
    <div className={`app-shell ${accountingNavigationTargets.includes(active as AccountingMode) ? "accounting-app-mode" : "operations-app-mode"}`}>
      <AutomationHeartbeat />
      <SystemMaintenanceGate leadership={["Company Owner", "Administrator"].includes(sessionActor.accessLevel)} />
      <SummaryDrilldownHost />
      <Suspense fallback={null}>
        <MobileCommandCenter
          actor={sessionActor}
          active={active}
          projectId={projectProfile.number}
          projectName={projectProfile.name}
          notificationCount={notifications.filter((item) => !item.isRead && item.status !== "Completed" && !item.hiddenBySnooze).length}
          onNavigate={chooseNav}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onQuickAdd={openMobileQuickAction}
          onNotice={(message) => {
            setNotice(message);
            window.setTimeout(() => setNotice(""), 5200);
          }}
        />
      </Suspense>
      <WorkspaceAccessibility />
      <a className="skip-to-work" href="#workspace-content">Skip To Work</a>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <Mark />
          <div>
            <strong>MEFFORD</strong>
            <span>COMMAND CENTER</span>
          </div>
        </div>

        <WorkspaceNavigation key={sessionActor.email} actor={sessionActor} active={active} tools={navigationTools} onNavigate={chooseNav} projectActive={!companyWorkspaceActive} workCount={notifications.filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).length} />

        <div className="sidebar-bottom">
          <button className={active === "User Guide" ? "nav-item active" : "nav-item"} onClick={() => chooseNav("User Guide")}>
            <span className="nav-icon" aria-hidden="true">{navigationGlyph("User Guide", "?")}</span>
            <span>User Guide</span>
          </button>
          <div className="user-card">
            <div className="avatar">{personInitials(sessionActor.name)}</div>
            <div>
              <strong>{sessionActor.name}</strong>
              <span>{sessionActor.accessLevel}</span>
            </div>
            <span className="status-dot" title="Online" />
          </div>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <section className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          {companyWorkspaceActive ? <div className="company-workspace-title"><strong>{sectionTitle(active)}</strong></div> : <label className="project-selector">
            <span>Project</span>
            <select aria-label="Select Project" value={projectProfile.number} disabled={projectListStatus !== "ready" || !projects.length} onChange={(event) => {
              const project = projects.find((item) => item.number === event.target.value);
              if (project) switchProject(project);
            }}>
              {!projectProfile.number ? <option value="">{projectListStatus === "loading" ? "Loading Projects…" : projectListStatus === "error" ? "Projects Unavailable" : "No Assigned Projects"}</option> : null}
              {projects.map((project) => <option key={project.number} value={project.number}>{project.number} · {project.name}</option>)}
            </select>
          </label>}
          <div className="topbar-actions">
            <CommandAssistant
              activeTarget={active}
              projectId={companyWorkspaceActive || !projectProfile.number ? "" : projectProfile.number}
              projectName={companyWorkspaceActive || !projectProfile.number ? "Mefford Contracting" : projectProfile.name}
              permissionLocked={sessionActor.permissionLocked}
            />
            <button className="icon-button" aria-label="Search Command Center" aria-expanded={searchOpen} onClick={() => { setSearchOpen((open) => !open); setSiteSearchQuery(""); }}><WorkIcon name="search" /></button>
            {searchOpen ? <div className="site-wide-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={siteSearchQuery}
                onChange={(event) => setSiteSearchQuery(event.target.value)}
                placeholder="Search projects, records, and tools"
                aria-label="Search Command Center"
              />
              {siteSearchQuery.trim().length >= 2 ? <div className="site-search-results" role="listbox">
                {siteSearchResults.map((result, index) => <button key={`${result.kind}-${result.projectId}-${result.target}-${index}`} role="option" aria-selected={false} onClick={() => {
                  if (result.fileId) {
                    window.open(`/api/files?id=${result.fileId}`, "_blank", "noopener,noreferrer");
                    setSiteSearchQuery("");
                    return;
                  }
                  if (result.projectId) {
                    const project = projects.find((item) => item.number === result.projectId);
                    if (project) setProjectProfile(project);
                  }
                  chooseNav(result.target);
                  setSiteSearchQuery("");
                }}><i>{result.kind === "Project" ? "PRJ" : result.kind === "Record" ? "REC" : result.kind === "File" ? "FILE" : "GO"}</i><span><strong>{result.title}</strong><small>{result.detail}</small></span></button>)}
                {!siteSearchResults.length ? <div className="site-search-empty">No Accessible Command Center Results</div> : null}
              </div> : null}
            </div> : null}
            <button
              className="icon-button notification"
              aria-label="Notifications"
              onClick={() => setNotificationsOpen(true)}
            >
              <WorkIcon name="bell" /><span>{notifications.filter((item) => !item.isRead && item.status !== "Completed" && !item.hiddenBySnooze).length}</span>
            </button>

          </div>
        </header>

        <main className="content" id="workspace-content" tabIndex={-1}>
          {projectListError ? <div className="workspace-load-error" role="alert"><span>{projectListError}</span><button className="secondary-action" onClick={retryProjectList}>Retry Loading Projects</button></div> : null}
          {!companyWorkspaceActive && projectProfile.number && (active !== "Project Overview" || projectSummaryOpen) ? <nav className="project-return" aria-label="Project Navigation"><button onClick={() => chooseNav("Project Overview")}>← Project Workspace</button><span aria-current="page">{active === "Project Overview" ? "Project Summary" : sectionTitle(active)}</span></nav> : null}
          <Suspense fallback={<section className="panel empty-attention-state"><strong>Opening Workspace</strong><span>Loading this Command Center module…</span></section>}>
          {active === "Dashboard" ? (
            !projects.length && projectListStatus !== "ready" ? (
              projectListStatus === "loading" ? <div role="status">Loading Projects…</div> : null
            ) : <CompanyDashboard
              projects={projects}
              recordsByProject={dashboardRecordsByProject}
              filesByProject={portfolioFiles}
              actor={sessionActor}
              onOpenDecision={openDashboardDecision}
              onOpenRecord={(project, target, recordId) => openDashboardDecision(project, target, recordId)}
            />
          ) : active === "Owner Approvals" ? (
            <OwnerApprovalCenter onNavigate={(target, projectId, recordId) => openDashboardDecision(projects.find((project) => project.number === projectId), target, recordId)} />
          ) : active === "My Work" ? (
            <EmployeePortalWorkspace actor={sessionActor} onOpenWorkItem={openMyWorkItem} onWorkItemsChange={setNotifications} everydayTools={everydayTools} onNavigateTool={chooseNav} projectName={projectProfile.name} projectNumber={projectProfile.number} onDailyLog={() => openNew("Daily Logs")} onPhoto={() => openMobileQuickAction({ id: "camera", label: "Photo / Video", target: "Daily Logs", formType: "Daily Logs", icon: "CAM", roles: ["all"] })} />
          ) : active === "User Guide" ? (
            <UserGuideWorkspace />
          ) : active === "Project Health" ? (
            <ProjectHealthWorkspace initialProjectId={projectProfile.number} />
          ) : adminNavigationTargets.includes(active) ? (
            <AdminCommandWorkspace
              mode={adminModeByTarget[active]}
              actor={sessionActor}
              project={{ number: projectProfile.number, name: projectProfile.name }}
              onNavigate={chooseNav}
            />
          ) : active === "IT & Integrations" ? (
            <IntegrationHealthWorkspace />
          ) : active === "Assets & Fleet" ? (
            <AssetTrackingWorkspace actor={sessionActor} />
          ) : active === "Performance Reviews" ? (
            <PerformanceReviewsWorkspace actor={sessionActor} />
          ) : active === "Employee Onboarding" ? (
            <EmployeeOnboardingWorkspace actor={sessionActor} />
          ) : active === "Employee Portal" ? (
            <EmployeePortalWorkspace actor={sessionActor} onOpenWorkItem={openMyWorkItem} onWorkItemsChange={setNotifications} everydayTools={everydayTools} onNavigateTool={chooseNav} projectName={projectProfile.name} projectNumber={projectProfile.number} onDailyLog={() => openNew("Daily Logs")} onPhoto={() => openMobileQuickAction({ id: "camera", label: "Photo / Video", target: "Daily Logs", formType: "Daily Logs", icon: "CAM", roles: ["all"] })} />
          ) : active === "Company Calendar" ? (
            <CompanyCalendarWorkspace initialFilter="All" canManage={["Company Owner", "Administrator"].includes(sessionActor.accessLevel)} />
          ) : active === "Estimating Calendar" ? (
            <CompanyCalendarWorkspace initialFilter="Estimating" canManage={["Company Owner", "Administrator"].includes(sessionActor.accessLevel)} />
          ) : ["Quarterly Rock/Review", "Weekly L10", "Sales/Estimating Department", "Operations Department", "Accounting Department", "Sales To Estimating Turnover", "Estimating To Operations Turnover"].includes(active) ? (
            <MeetingsCenter
              key={active}
              meetingType={MEETING_TYPE_BY_TARGET[active]}
              actor={sessionActor}
            />
          ) : active === "Sales Dashboard" ? (
            <SalesEstimatingWorkspace mode="dashboard" actor={sessionActor} onProjectCreated={(projectNumber) => void openAwardedProject(projectNumber)} onOpenContract={(projectNumber) => void openAwardedProject(projectNumber, "Contracts")} />
          ) : active === "Sales Goals" ? (
            <SalesEstimatingWorkspace mode="goals" actor={sessionActor} />
          ) : active === "Sales Contacts" ? (
            <SalesEstimatingWorkspace mode="contacts" actor={sessionActor} />
          ) : active === "Sales Funnel" ? (
            <SalesEstimatingWorkspace mode="funnel" actor={sessionActor} />
          ) : active === "Sales Design" ? (
            <DesignLifecycleWorkspace scope="Sales" actor={sessionActor} />
          ) : active === "Estimating" ? (
            <SalesEstimatingWorkspace
              mode="estimating"
              actor={sessionActor}
              initialEstimateId={pendingWorkLink?.target === "Estimating" && pendingWorkLink.projectId === "MEFFORD-SALES" ? pendingWorkLink.recordId : ""}
              onInitialEstimateOpened={() => setPendingWorkLink(null)}
              onProjectCreated={(projectNumber) =>
                void openAwardedProject(projectNumber)
              }
            />
          ) : active === "Bid Management" ? (
            <ProcurementWorkspace scope="Sales" actor={sessionActor} onNavigate={(target) => chooseNav(target)} />
          ) : ["Marketing", "Marketing Social", "Marketing Email", "Marketing Surveys", "Marketing Calendar"].includes(active) ? (
            <MarketingWorkspace
              key={active}
              actor={sessionActor}
              onNavigate={chooseNav}
              initialTab={active === "Marketing Email" ? "Email Campaigns" : active === "Marketing Surveys" ? "Customer Surveys" : active === "Marketing Calendar" ? "Marketing Calendar" : "Social Campaigns"}
            />
          ) : accountingNavigationTargets.includes(active as AccountingMode) ? (
            <AccountingWorkspace
              key={`${active}:${projectToolContext === active ? projectProfile.number : "company"}`}
              initialProjectId={projectToolContext === active ? projectProfile.number : undefined}
              mode={active as AccountingMode}
              actor={sessionActor}
              onNavigate={chooseNav}
            />
          ) : active === "Project Overview" ? (
            !projectProfile.number ? (
              <section className="panel empty-attention-state executive-project-empty">
                <span className="project-badge" aria-hidden="true">+</span>
                <strong>{projectListStatus === "loading" ? "Loading Projects…" : projectListStatus === "error" ? "Project List Unavailable" : "No Assigned Projects"}</strong>
                {projectListStatus === "ready" && ["Company Owner", "Administrator"].includes(sessionActor.accessLevel) ? <button className="primary-action" onClick={() => openProjectSetup("new")}>
                  ＋ Start First Project
                </button> : null}
              </section>
            ) : !projectSummaryOpen ? (
              <ProjectWorkspace
                tools={navigationTools}
                area={projectWorkArea}
                onAreaChange={setProjectWorkArea}
                onNavigate={(target) => { chooseNav(target); if (canActorAccessNavigation(sessionActor, target)) setProjectToolContext(target); }}
                onSummary={() => setProjectSummaryOpen(true)}
                onSettings={canActorAccessNavigation(sessionActor, "Project Settings") ? () => openProjectSetup("edit") : undefined}
                onNewProject={["Company Owner", "Administrator"].includes(sessionActor.accessLevel) ? () => openProjectSetup("new") : undefined}
              />
            ) : (
              <>
              <section className="welcome-row">
                <div>
                  <p className="eyebrow orange-text">
                    {currentDateHeading(projectProfile.timeZone)}
                  </p>
                  <h1>{projectProfile.name}</h1>
                  <p>
                    Here’s what needs attention on{" "}
                    <strong>{projectProfile.name}</strong>.
                  </p>
                </div>
                <button
                  className="weather-card"
                  onClick={() => chooseNav("Daily Logs")}
                  aria-label="Open Daily Logs For Project Weather"
                >
                  <span className="weather-icon">
                    {projectWeatherStatus === "ready"
                      ? weatherConditionIcon(projectWeather.conditions)
                      : projectWeatherStatus === "loading"
                        ? "…"
                        : "—"}
                  </span>
                  <div>
                    <strong>
                      {projectWeatherStatus === "ready"
                        ? `${projectWeather.high}° / ${projectWeather.low}°`
                        : projectWeatherStatus === "loading"
                          ? "Loading Weather"
                          : projectWeatherStatus === "location_required"
                            ? "Address Required"
                            : "Weather Unavailable"}
                    </strong>
                    <span>
                      {projectWeatherStatus === "ready"
                        ? projectWeather.conditions
                        : projectWeatherStatus === "location_required"
                          ? "Add Project Address"
                          : "Enter Conditions In Daily Log"}
                    </span>
                  </div>
                  <small>
                    {projectWeatherStatus === "loading"
                      ? "Loading Conditions"
                      : projectWeatherStatus === "location_required"
                        ? "Add The Project Address In Project Settings"
                        : projectWeatherStatus === "ready"
                          ? "Open Daily Weather"
                          : "Open Daily Log"}
                  </small>
                </button>
              </section>

              <section className="stats-grid" aria-label="Project snapshot">
                <button
                  className="stat-card"
                  onClick={() => openSummaryDrilldown({ title: "Open Project Items", description: `Every open item currently counted for ${projectProfile.name}.`, rows: projectOpenSources.flatMap((source) => source.records.filter((record) => projectOpenStatuses.includes(record.status)).map((record) => ({ id: `${source.section}-${record.id}`, title: record.title, subtitle: `${source.section} · ${record.id}`, status: record.status, meta: `${record.owner || "Owner Needed"} · Due ${displayProjectDate(record.due)}`, onOpen: () => chooseNav(source.section), openLabel: `Open ${source.section} →` }))) })}
                >
                  <span className="stat-icon orange">!</span>
                  <div>
                    <strong>{projectOpenItemCount}</strong>
                    <span>Open items</span>
                  </div>
                  <small>{projectOpenItemCount ? "Review Current Project Items" : "Ready For New Activity"}</small>
                </button>
                <button className="stat-card" onClick={() => openSummaryDrilldown({ title: "Project Schedule Progress", description: "All schedule activities contributing to the project-progress average.", rows: (records.Schedule ?? []).map((record) => ({ id: record.id, title: record.title, subtitle: record.id, status: record.status, value: `${Number(record.data?.progress || 0)}%`, meta: `${displayProjectDate(record.recordDate || "")} – ${displayProjectDate(record.due)}`, onOpen: () => chooseNav("Schedule"), openLabel: "Open Schedule →" })), emptyText: "No schedule activities are recorded for this project." })}>
                  <span className="stat-icon blue">↗</span>
                  <div>
                    <strong>{projectProgress}%</strong>
                    <span>Project progress</span>
                  </div>
                  <small>{scheduleProgressValues.length ? "Based On Active Schedule" : "No Schedule Activities Yet"}</small>
                </button>
                <button className="stat-card" onClick={() => openSummaryDrilldown({ title: "Pending Project Changes", description: "Every non-final change contributing to pending exposure.", rows: (records["Change Orders"] ?? []).filter((record) => !["Executed", "Rejected", "Void"].includes(record.status)).map((record) => ({ id: record.id, title: record.title, subtitle: record.id, status: record.status, value: canViewProjectFinancials ? formatCurrency(Number(changeOrderData(record).approvedTotal || 0)) : "Restricted", meta: `${record.owner || projectProfile.projectManager} · Due ${displayProjectDate(record.due)}`, onOpen: () => chooseNav("Change Orders"), openLabel: "Open Change Orders →" })) })}>
                  <span className="stat-icon green">$</span>
                  <div>
                    <strong>{canViewProjectFinancials ? formatCurrency(pendingChangeTotal) : "Restricted"}</strong>
                    <span>{canViewProjectFinancials ? "Pending changes" : "Financial access"}</span>
                  </div>
                  <small>{canViewProjectFinancials ? `${records["Change Orders"]?.length ?? 0} Project Changes` : "PM · Admin · Owner"}</small>
                </button>
                <button className="stat-card" onClick={() => { const employees = Array.isArray(latestDailyLog?.data?.employeesOnSite) ? latestDailyLog.data.employeesOnSite : []; const subcontractors = Array.isArray(latestDailyLog?.data?.subcontractorsOnSite) ? latestDailyLog.data.subcontractorsOnSite : []; openSummaryDrilldown({ title: "People On Site", description: latestDailyLog ? `Crew detail recorded in ${latestDailyLog.id}.` : "No Daily Log is available.", rows: [...employees.map((item, index) => ({ id: `employee-${index}`, title: typeof item === "string" ? item : String((item as Record<string, unknown>).name || "Employee"), subtitle: "Mefford Employee", status: "On Site", onOpen: () => chooseNav("Daily Logs"), openLabel: "Open Daily Log →" })), ...subcontractors.map((item, index) => ({ id: `subcontractor-${index}`, title: typeof item === "string" ? item : String((item as Record<string, unknown>).company || (item as Record<string, unknown>).name || "Subcontractor"), subtitle: "Subcontractor Crew", status: "On Site", onOpen: () => chooseNav("Daily Logs"), openLabel: "Open Daily Log →" }))], emptyText: "No people are recorded on the latest Daily Log." }); }}>
                  <span className="stat-icon charcoal">◎</span>
                  <div>
                    <strong>{peopleOnSite}</strong>
                    <span>People on site</span>
                  </div>
                  <small>{latestDailyLog ? `From ${latestDailyLog.id}` : "No Daily Log Yet"}</small>
                </button>
              </section>

              <Suspense fallback={<section className="survey-recipient-control"><span>Loading automatic survey recipients…</span></section>}>
                <CustomerSurveyRecipientControl projectId={projectProfile.number} />
              </Suspense>

              <section className="recent-photos-panel" aria-labelledby="recent-photos-title">
                <div className="recent-photos-heading">
                  <div>
                    <span className="heading-mark" />
                    <span>
                      <h2 id="recent-photos-title">Recent Jobsite Photos</h2>
                      <p>Newest Daily Log Pictures From {projectProfile.name}</p>
                    </span>
                  </div>
                  {projectPhotos.length ? (
                    <button onClick={() => setPhotoGalleryOpen(true)}>
                      View All {projectPhotos.length} Photo{projectPhotos.length === 1 ? "" : "s"} <span>→</span>
                    </button>
                  ) : null}
                </div>
                {recentProjectPhotos.length ? (
                  <div className="recent-photo-grid">
                    {recentProjectPhotos.map((photo, index) => (
                      <button
                        className={index === 0 ? "recent-photo-card featured" : "recent-photo-card"}
                        key={photo.id}
                        onClick={() => setSelectedProjectPhoto(photo)}
                        aria-label={`Open ${photo.name} From ${dailyLogIdForPhoto(photo) || "Daily Log"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/files?id=${photo.id}`}
                          alt={`${projectProfile.name} Jobsite Photo`}
                          loading={index === 0 ? "eager" : "lazy"}
                        />
                        <span>
                          <strong>{dailyLogIdForPhoto(photo) || "Daily Log Photo"}</strong>
                          <small>{photo.date} · {photo.uploadedBy}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="recent-photos-empty">
                    <span aria-hidden="true">▣</span>
                    <div>
                      <strong>No Daily Log Photos Yet</strong>
                      <small>Pictures Added To A Daily Log Will Appear Here Automatically.</small>
                    </div>
                    <button onClick={() => chooseNav("Daily Logs")}>Open Daily Logs</button>
                  </div>
                )}
              </section>

              <div className="dashboard-grid">
                <section className="panel attention-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="heading-mark" />{" "}
                      <h2>Needs Your Attention</h2>
                    </div>
                    <button
                      onClick={() =>
                        chooseNav(
                          projectAttention[0]?.type === "SUBMITTAL"
                            ? "Submittals"
                            : projectAttention[0]?.type === "SELECTION"
                              ? "Selections"
                            : projectAttention[0]?.type === "CHANGE"
                              ? "Change Orders"
                              : "RFIs",
                        )
                      }
                    >
                      View all <span>→</span>
                    </button>
                  </div>
                  <div className="attention-list">
                    {projectAttention.length ? projectAttention.map((item) => (
                      <button
                        className="attention-item"
                        key={item.number}
                        onClick={() => openAttentionItem(item)}
                      >
                        <span
                          className={`type-badge ${item.type.toLowerCase()}`}
                        >
                          {item.type}
                        </span>
                        <span className="attention-copy">
                          <strong>
                            {item.number} · {item.title}
                          </strong>
                          <small>Assigned to {item.owner}</small>
                        </span>
                        <span className={item.urgent ? "due urgent" : "due"}>
                          {item.due}
                        </span>
                        <span className="row-arrow">›</span>
                      </button>
                    )) : (
                      <div className="empty-attention-state">
                        <strong>No Project Items Need Attention</strong>
                        <span>New RFIs, submittals, and change orders will appear here.</span>
                      </div>
                    )}
                  </div>
                </section>

                <aside className="panel site-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="heading-mark green-mark" />{" "}
                      <h2>Jobsite Cameras</h2>
                    </div>
                    <span className="live-pill camera-offline-pill">
                      <i /> NOT CONNECTED
                    </span>
                  </div>
                  <button
                    className="camera-view camera-disconnected"
                    onClick={() => setCameraViewOpen(true)}
                  >
                    <span className="camera-connection-mark">UC</span>
                    <span className="camera-label">
                      <i /> UniFi Protect Connection Required
                    </span>
                    <span className="play-button">SETUP</span>
                  </button>
                  <div className="site-meta">
                    <div>
                      <span className="meta-icon">◉</span>
                      <span>
                        <strong>No Live Camera Status</strong>
                        <small>
                          {projectProfile.cameraCount} of 16 camera slots planned ·
                          no access points reported
                        </small>
                      </span>
                    </div>
                    <button onClick={() => setCameraViewOpen(true)}>
                      Camera Readiness
                    </button>
                  </div>
                </aside>
              </div>

              <section className="module-section">
                <div className="section-title">
                  <div>
                    <h2>Project Tools</h2>
                    <p>Open the project tools available for {projectProfile.name}.</p>
                  </div>
                  <button
                    onClick={openDashboardCustomizer}
                  >
                    Customize
                  </button>
                </div>
                <div className="module-grid">
                  {visibleDashboardModules.map((item) => (
                    <button
                      className="module-card"
                      key={item.title}
                      onClick={() =>
                        chooseNav(
                          item.title === "Project Files"
                            ? "Documents"
                            : item.title === "Daily Log"
                              ? "Daily Logs"
                              : item.title === "Toolbox Talk"
                                ? "Safety"
                                : item.title,
                        )
                      }
                    >
                      <span className={`module-icon ${item.tone}`}>
                        {item.icon}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.title === "Budget" && !canViewProjectFinancials ? "Financial Access Required" : projectModuleDetail(item.title, item.detail)}</small>
                      </span>
                      <span className="module-arrow">→</span>
                    </button>
                  ))}
                </div>
              </section>

              {dashboardCustomizeOpen ? <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDashboardCustomizeOpen(false)}><section className="record-modal dashboard-customize-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-customize-title"><div className="modal-heading"><div><h2 id="dashboard-customize-title">Customize Project Tools</h2></div><button aria-label="Close Project Tool Customizer" onClick={() => setDashboardCustomizeOpen(false)}>×</button></div><p className="modal-intro">Choose visible tools and arrange their order for this project. This preference is personal to your signed-in identity and does not change anyone else’s dashboard.</p><div className="dashboard-tool-editor">{dashboardToolDraft.map((title, index) => { const item = modules.find((candidate) => candidate.title === title); if (!item) return null; const visible = dashboardVisibleDraft.includes(title); return <article key={title}><label><input type="checkbox" checked={visible} onChange={() => setDashboardVisibleDraft((current) => current.includes(title) ? current.filter((value) => value !== title) : [...current, title])} /><span className={`module-icon ${item.tone}`}>{item.icon}</span><strong>{title}</strong></label><div><button aria-label={`Move ${title} Up`} disabled={index === 0} onClick={() => moveDashboardTool(title, -1)}>↑</button><button aria-label={`Move ${title} Down`} disabled={index === dashboardToolDraft.length - 1} onClick={() => moveDashboardTool(title, 1)}>↓</button></div></article>; })}</div><div className="modal-actions"><button className="secondary-action" onClick={() => setDashboardCustomizeOpen(false)}>Cancel</button><button className="primary-action large" disabled={dashboardPreferencesSaving || !dashboardVisibleDraft.length} onClick={() => void saveDashboardPreferences()}>{dashboardPreferencesSaving ? "Saving Layout..." : "Save My Project Tools"}</button></div></section></div> : null}

              <footer className="project-footer">
                <span>{projectProfile.name}</span>
                <span>Project #{projectProfile.number}</span>
                <span>Dates And Times Use The Project Timezone</span>
              </footer>

              {photoGalleryOpen ? (
                <div
                  className="modal-layer"
                  role="presentation"
                  onMouseDown={(event) =>
                    event.target === event.currentTarget && setPhotoGalleryOpen(false)
                  }
                >
                  <section
                    className="record-modal wide project-photo-gallery-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="project-photo-gallery-title"
                  >
                    <div className="modal-heading">
                      <div>
                        <p className="eyebrow orange-text">{projectProfile.name.toUpperCase()}</p>
                        <h2 id="project-photo-gallery-title">All Daily Log Photos</h2>
                        <span>{projectPhotos.length} Stored Jobsite Photo{projectPhotos.length === 1 ? "" : "s"} · Newest First</span>
                      </div>
                      <button aria-label="Close Photo Gallery" onClick={() => setPhotoGalleryOpen(false)}>×</button>
                    </div>
                    <div className="all-project-photo-grid">
                      {projectPhotos.map((photo) => (
                        <button
                          key={photo.id}
                          onClick={() => {
                            setPhotoGalleryOpen(false);
                            setSelectedProjectPhoto(photo);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/files?id=${photo.id}`} alt={`${projectProfile.name} Jobsite Photo`} loading="lazy" />
                          <span>
                            <strong>{dailyLogIdForPhoto(photo) || "Daily Log Photo"}</strong>
                            <small>{photo.date} · {photo.uploadedBy}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {selectedProjectPhoto ? (
                <div
                  className="modal-layer photo-viewer-layer"
                  role="presentation"
                  onMouseDown={(event) =>
                    event.target === event.currentTarget && setSelectedProjectPhoto(null)
                  }
                >
                  <section
                    className="record-modal wide project-photo-viewer"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="project-photo-viewer-title"
                  >
                    <div className="modal-heading">
                      <div>
                        <p className="eyebrow orange-text">
                          {dailyLogIdForPhoto(selectedProjectPhoto) || "DAILY LOG PHOTO"}
                        </p>
                        <h2 id="project-photo-viewer-title">{selectedProjectPhoto.name}</h2>
                        <span>{selectedProjectPhoto.date} · Uploaded By {selectedProjectPhoto.uploadedBy}</span>
                      </div>
                      <button aria-label="Close Photo" onClick={() => setSelectedProjectPhoto(null)}>×</button>
                    </div>
                    <div className="project-photo-stage">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files?id=${selectedProjectPhoto.id}`} alt={`${projectProfile.name} Jobsite Photo`} />
                    </div>
                    <div className="project-photo-actions">
                      <button className="secondary-action" onClick={() => setSelectedProjectPhoto(null)}>Close</button>
                      <button
                        className="secondary-action"
                        onClick={() => window.open(`/api/files?id=${selectedProjectPhoto.id}`, "_blank", "noopener,noreferrer")}
                      >
                        Open Full Image
                      </button>
                      <button className="primary-action large" onClick={() => openPhotoDailyLog(selectedProjectPhoto)}>
                        Open Source Daily Log
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
              </>
            )
          ) : active === "Contracts" ? (
            <OwnerContractWorkspace
              key={`${projectProfile.number}-${records.Contracts?.[0]?.status || "new"}-${records.Contracts?.[0]?.meta || ""}`}
              project={projectProfile}
              actor={sessionActor}
              records={records.Contracts ?? []}
              onRecordsChange={(next) =>
                setRecords((current) => ({ ...current, Contracts: next }))
              }
              onProjectChange={(changes) => updateActiveProject(changes)}
              onClose={() => setActive("Project Overview")}
            />
          ) : active === "Schedule" ? (
            <ScheduleWorkspace
              key={projectProfile.number}
              project={projectProfile}
              changeOrders={records["Change Orders"] ?? []}
              subcontractRecords={records.Subcontracts ?? []}
              onChangeOrdersChange={(next) =>
                setRecords((current) => ({ ...current, "Change Orders": next }))
              }
              scheduleRecords={records.Schedule ?? []}
              onScheduleRecordsChange={(next) =>
                setRecords((current) => ({ ...current, Schedule: next }))
              }
            />
          ) : active === "Documents" ? (
            <DocumentsWorkspace
              key={projectProfile.number}
              project={projectProfile}
              changeOrders={records["Change Orders"] ?? []}
              awardedEstimates={records["Awarded Estimates"] ?? []}
              actor={sessionActor}
            />
          ) : active === "Design & Drawings" ? (
            <DesignLifecycleWorkspace
              key={projectProfile.number}
              scope="Project"
              project={projectProfile}
              actor={sessionActor}
              onNavigate={(target) => setActive(target)}
            />
          ) : active === "Procurement" ? (
            <ProcurementWorkspace
              key={projectProfile.number}
              scope="Project"
              project={projectProfile}
              actor={sessionActor}
              onNavigate={(target) => setActive(target)}
            />
          ) : active === "Budget" ? (
            <BudgetWorkspace
              key={projectProfile.number}
              project={projectProfile}
              records={records.Budget ?? []}
              controlRecord={projectBudgetControl}
              currentActorName={sessionActor.name}
              accessLevel={sessionActor.accessLevel}
              canViewFinancials={canViewProjectFinancials}
              onRecordsChange={(next) =>
                setRecords((current) => ({ ...current, Budget: next }))
              }
              onControlChange={(next) =>
                setRecords((current) => ({
                  ...current,
                  "Budget Control": [next],
                }))
              }
            />
          ) : active === "Closeout" ? (
            <CloseoutAutomationWorkspace
              key={projectProfile.number}
              project={projectProfile}
              actor={sessionActor}
            />
          ) : active === "Safety" ? (
            <SafetyCommandWorkspace
              key={projectProfile.number}
              project={projectProfile}
              actor={sessionActor}
              talks={records["Toolbox Talks"] ?? []}
              onNewTalk={() => openNew("Toolbox Talks")}
              onOpenTalk={(talk) => openRecordDetails(talk, "Toolbox Talks")}
            />
          ) : active === "Change Orders" ? (
            <ChangeOrdersWorkspace
              project={projectProfile}
              records={records["Change Orders"] ?? []}
              onRecordsChange={(next) =>
                setRecords((current) => ({
                  ...current,
                  "Change Orders": next,
                }))
              }
              onProjectUpdate={(changes) =>
                updateActiveProject(changes, false)
              }
              budgetCodes={records.Budget ?? []}
              onBudgetCodesChange={(next) =>
                setRecords((current) => ({ ...current, Budget: next }))
              }
              budgetReady={projectBudgetReady}
              onOpenBudget={() => setActive("Budget")}
            />
          ) : active === "Subcontracts" ? (
            <SubcontractWorkspace
              key={projectProfile.number}
              project={projectProfile}
              budgetCodes={records.Budget ?? []}
              onBudgetCodesChange={(next) =>
                setRecords((current) => ({ ...current, Budget: next }))
              }
              records={records.Subcontracts ?? []}
              onRecordsChange={(next) =>
                setRecords((current) => ({ ...current, Subcontracts: next }))
              }
              budgetReady={projectBudgetReady}
              onOpenBudget={() => setActive("Budget")}
              onOpenRecord={(record) =>
                openRecordDetails(record, "Subcontracts")
              }
            />
          ) : active === "Purchase Orders" ? (
            <PurchaseOrderWorkspace
              key={projectProfile.number}
              project={projectProfile}
              actor={sessionActor}
            />
          ) : active === "Selections" ? (
            <SelectionsWorkspace
              key={projectProfile.number}
              project={projectProfile}
              actor={sessionActor}
              onNavigate={(target) => setActive(target)}
            />
          ) : active === "RFIs" || active === "Submittals" ? (
            <ProjectCorrespondenceWorkspace
              key={`${projectProfile.number}-${active}`}
              mode={active}
              project={projectProfile}
              actor={sessionActor}
              records={records[active] ?? []}
              onRecordsChange={(next) =>
                setRecords((current) => ({ ...current, [active]: next }))
              }
            />
          ) : ["Project Owner Meetings", "Project Design Meetings", "Project Subcontractor Meetings"].includes(active) ? (
            <MeetingsCenter
              key={`${projectProfile.number}-${active}`}
              meetingType={MEETING_TYPE_BY_TARGET[active]}
              project={projectProfile}
              actor={sessionActor}
            />
          ) : active === "Quality" ? (
            <QualityControlWorkspace
              key={projectProfile.number}
              project={projectProfile}
              actor={sessionActor}
            />
          ) : active === "Review" ? (
            <ReviewWorkspace actor={sessionActor} />
          ) : active === "Team" ? (
            <TeamAccessWorkspace
              key={projectProfile.number}
              projectId={projectProfile.number}
              projectName={projectProfile.name}
              actor={sessionActor}
            />
          ) : (
            <ModuleWorkspace
              name={active === "Contracts" ? "Project Owner Contract" : active}
              projectName={projectProfile.name}
              records={records[active] ?? []}
              onAdd={() => openNew(active)}
              onOpen={openRecordDetails}
              onUseTopic={(title) => {
                openNew("Toolbox Talks");
                setRecordTitle(title);
              }}
            />
          )}
          </Suspense>
        </main>
      </section>

      {formOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && void closeRecordForm()
          }
        >
          <section
            className={`record-modal ${formType === "Daily Logs" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-record-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">{projectProfile.name}</p>
                <h2 id="new-record-title">{workspaceCopy[formType].button}</h2>
              </div>
              <button
                aria-label="Close form"
                onClick={() => void closeRecordForm()}
              >
                ×
              </button>
            </div>
            <div className="form-context"><WorkIcon name="project" /><strong>{projectProfile.name}</strong><span>{projectProfile.number}</span></div>
            {recordFormError ? <div className="form-error" role="alert">{recordFormError}</div> : null}
            {formType === "Daily Logs" ? <div className="draft-state" role="status"><span>{dailyDraft.status}</span>{dailyDraft.candidate ? <><button onClick={restoreDailyDraft}>Resume Saved Draft</button><button onClick={() => void dailyDraft.discard()}>Start Fresh</button></> : null}</div> : null}
            {formType === "Daily Logs" ? (
              <>
                <div className="field-grid">
                  <label className="field-label">
                    Log Date
                    <input
                      type="date"
                      value={dailyDate}
                      onChange={(event) => {
                        setDailyDate(event.target.value);
                        setDailyWeatherMetrics(blankDailyWeatherMetrics());
                        const automaticWeatherAvailable = Boolean(projectWeatherAddress);
                        setDailyWeather(
                          automaticWeatherAvailable
                            ? "Loading Project Weather..."
                            : "Enter Weather Manually",
                        );
                        setDailyWeatherLoading(automaticWeatherAvailable);
                        setDailyWeatherSource(
                          automaticWeatherAvailable
                            ? "Checking Project Location..."
                            : "Project Address Required For Automatic Weather",
                        );
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Log Time
                    <input
                      type="time"
                      value={recordTime}
                      onChange={(event) => setRecordTime(event.target.value)}
                    />
                    <small className="field-source">
                      Defaults To Current {projectTimeZoneLabel(projectProfile.timeZone)}
                    </small>
                  </label>
                </div>
                <label className="field-label">
                  Work Completed (Required)
                  <textarea
                    id="record-description"
                    required
                    autoFocus
                    value={recordTitle}
                    onChange={(event) => setRecordTitle(event.target.value)}
                    rows={4}
                    placeholder="Describe the work completed, areas worked in, deliveries, delays, and important observations"
                  />
                </label>
                <details className="optional-fields" id="daily-weather-section"><summary>Daily Weather · Review Before Finalizing</summary>
                <fieldset className="people-fieldset weather-field">
                  <legend>Daily Weather</legend>
                  <div className="field-grid">
                    <label className="field-label">
                      Daily Rainfall (in)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={dailyWeatherMetrics.rainfallInches}
                        onChange={(event) =>
                          updateDailyWeatherMetric("rainfallInches", event.target.value)
                        }
                        aria-label="Daily Rainfall In Inches"
                      />
                    </label>
                    <label className="field-label">
                      Average Temperature (°F)
                      <input
                        type="number"
                        step="1"
                        value={dailyWeatherMetrics.averageTemperatureF}
                        onChange={(event) =>
                          updateDailyWeatherMetric("averageTemperatureF", event.target.value)
                        }
                        aria-label="Average Daily Temperature In Fahrenheit"
                      />
                    </label>
                    <label className="field-label">
                      Average Wind Speed (mph)
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={dailyWeatherMetrics.averageWindSpeedMph}
                        onChange={(event) =>
                          updateDailyWeatherMetric("averageWindSpeedMph", event.target.value)
                        }
                        aria-label="Average Daily Wind Speed In Miles Per Hour"
                      />
                    </label>
                    <label className="field-label">
                      Average Conditions
                      <input
                        value={dailyWeatherMetrics.averageConditions}
                        onChange={(event) =>
                          updateDailyWeatherMetric("averageConditions", event.target.value)
                        }
                        aria-label="Average Daily Conditions"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="weather-refresh"
                    disabled={dailyWeatherLoading || !projectWeatherAddress}
                    onClick={() => {
                      setDailyWeatherLoading(true);
                      setDailyWeatherSource("Weather Refresh Requested");
                      setWeatherRefreshKey((current) => current + 1);
                    }}
                  >
                    {!projectWeatherAddress
                      ? "Project Address Required"
                      : dailyWeatherLoading
                        ? "Loading Weather..."
                        : "Refresh Weather"}
                  </button>
                  <strong className="field-source">
                    These values save with this Daily Log.
                  </strong>
                </fieldset>
                </details>
                <fieldset className="people-fieldset">
                  <legend>Mefford Employees On Site</legend>
                  <div className="check-grid">
                    {MEFFORD_COMPANY_DIRECTORY.map((member) => member.name).map((name) => (
                      <label key={name}>
                        <input
                          type="checkbox"
                          checked={employeesOnSite.includes(name)}
                          onChange={() =>
                            toggleValue(
                              name,
                              employeesOnSite,
                              setEmployeesOnSite,
                            )
                          }
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="people-fieldset">
                  <legend>Subcontractors On Site</legend>
                  <div className="check-grid">
                    {[
                      "Bluegrass Electric",
                      "Commonwealth Plumbing",
                      "Central Kentucky Concrete",
                      "FenceCo",
                      "HVAC Solutions",
                      "Sitework Partners",
                    ].map((name) => (
                      <label key={name}>
                        <input
                          type="checkbox"
                          checked={subsOnSite.includes(name)}
                          onChange={() =>
                            toggleValue(name, subsOnSite, setSubsOnSite)
                          }
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="photo-upload">
                  <input
                    aria-label="Upload jobsite photos"
                    type="file"
                    accept={PHOTO_UPLOAD_ACCEPT}
                    capture="environment"
                    multiple
                    onChange={(event) => {
                      const selected = Array.from(event.target.files ?? []);
                      setPhotoFiles(selected);
                      setPhotoNames(selected.map((file) => file.name));
                      setPhotoMarkups({});
                    }}
                  />
                  <span className="upload-icon">＋</span>
                  <span>
                    <strong>Add Jobsite Pictures</strong>
                    <small>Take photos or choose several from the phone</small>
                  </span>
                </label>
                {photoNames.length ? (
                  <div className="photo-list">
                    {photoFiles.map((file) => {
                      const markup = photoMarkups[file.name];
                      return <span key={file.name}><b>PHOTO · {file.name}</b><small>{markup?.annotatedFile ? `${markup.operationCount} marks · ${markup.pairRole}${markup.pairReference ? ` · ${markup.pairReference}` : ""}` : "Original preserved"}</small><button type="button" onClick={() => setPhotoEditorFile(file)}>{markup?.annotatedFile ? "Edit Markup" : "Markup / Pair"}</button></span>;
                    })}
                  </div>
                ) : null}
                {photoEditorFile ? <Suspense fallback={<section className="panel empty-attention-state"><strong>Opening Photo Editor</strong><span>Loading markup tools…</span></section>}><MobileMediaEditor file={photoEditorFile} initial={photoMarkups[photoEditorFile.name]} onCancel={() => setPhotoEditorFile(null)} onSave={(markup) => { setPhotoMarkups((current) => ({ ...current, [markup.originalName]: markup })); setPhotoEditorFile(null); }} /></Suspense> : null}
                <fieldset className="incident-fieldset">
                  <legend>Any Incidents To Report?</legend>
                  <div className="choice-row">
                    <label className={!incidentReported ? "selected" : ""}>
                      <input
                        type="radio"
                        name="incident"
                        checked={!incidentReported}
                        onChange={() => setIncidentReported(false)}
                      />
                      No incidents
                    </label>
                    <label
                      className={incidentReported ? "selected danger" : ""}
                    >
                      <input
                        type="radio"
                        name="incident"
                        checked={incidentReported}
                        onChange={() => setIncidentReported(true)}
                      />
                      Yes — incident occurred
                    </label>
                  </div>
                </fieldset>
                {incidentReported ? (
                  <label className="field-label">
                    Incident Description
                    <textarea
                      value={incidentDetails}
                      onChange={(event) =>
                        setIncidentDetails(event.target.value)
                      }
                      rows={3}
                      placeholder="Describe what occurred. A separate incident report will also be required."
                    />
                  </label>
                ) : null}
                <label className="field-label">
                  Prepared By
                  <select
                    value={recordOwner}
                    onChange={(event) => setRecordOwner(event.target.value)}
                  >
                    {MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}
                  </select>
                </label>
                <div className="form-rule">
                  <strong>Superintendent Permission:</strong> Saving will
                  finalize this daily log and lock its date and time. An
                  Administrator Or Company Owner Can Make An Audited Correction
                  Later.
                </div>
              </>
            ) : formType === "Toolbox Talks" ? (
              <>
                <label className="field-label">
                  Toolbox Talk Topic
                  <input
                    autoFocus
                    value={recordTitle}
                    onChange={(event) => setRecordTitle(event.target.value)}
                    placeholder="Enter the safety topic"
                  />
                </label>
                <div className="field-grid">
                  <label className="field-label">
                    Talk Leader
                    <select
                      value={recordOwner}
                      onChange={(event) => setRecordOwner(event.target.value)}
                    >
                      {MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}
                    </select>
                  </label>
                  <label className="field-label">
                    Date
                    <input
                      type="date"
                      value={recordDate}
                      onChange={(event) => setRecordDate(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Time
                    <input
                      type="time"
                      value={recordTime}
                      onChange={(event) => setRecordTime(event.target.value)}
                    />
                  </label>
                </div>
                <fieldset className="people-fieldset">
                  <legend>People Who Attended</legend>
                  <div className="check-grid">
                    {MEFFORD_COMPANY_DIRECTORY.map((member) => member.name).map((name) => (
                      <label key={name}>
                        <input
                          type="checkbox"
                          checked={toolboxAttendees.includes(name)}
                          onChange={() => {
                            const removing = toolboxAttendees.includes(name);
                            toggleValue(
                              name,
                              toolboxAttendees,
                              setToolboxAttendees,
                            );
                            if (removing)
                              setSignedAttendees((current) =>
                                current.filter((person) => person !== name),
                              );
                          }}
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="field-label">
                  Talk Notes
                  <textarea
                    value={recordNotes}
                    onChange={(event) => setRecordNotes(event.target.value)}
                    rows={4}
                    placeholder="Main discussion points and job-specific hazards"
                  />
                </label>
                <section className="signature-roster">
                  <div>
                    <strong>Attendee Signatures</strong>
                    <span>
                      Pass the superintendent’s device to each attendee.
                    </span>
                  </div>
                  {toolboxAttendees.map((name) => (
                    <div className="signature-person" key={name}>
                      <span>
                        <i
                          className={
                            signedAttendees.includes(name) ? "signed" : ""
                          }
                        >
                          {signedAttendees.includes(name) ? "✓" : "—"}
                        </i>
                        <strong>{name}</strong>
                      </span>
                      <button
                        className={
                          signedAttendees.includes(name) ? "signed-button" : ""
                        }
                        onClick={() => {
                          if (!signedAttendees.includes(name)) {
                            setSignaturePerson(name);
                            setHasSignatureInk(false);
                          }
                        }}
                      >
                        {signedAttendees.includes(name) ? "Signed" : "Sign Now"}
                      </button>
                    </div>
                  ))}
                </section>
                <div className="form-rule">
                  <strong>Digital signatures required:</strong>{" "}
                  {signedAttendees.length} of {toolboxAttendees.length}{" "}
                  attendees have signed. The talk cannot be completed until all
                  signatures are present.
                </div>
              </>
            ) : (
              <>
                <label className="field-label">
                  {workspaceCopy[formType].noun}
                  <input
                    autoFocus
                    value={recordTitle}
                    onChange={(event) => setRecordTitle(event.target.value)}
                    placeholder={`Enter ${workspaceCopy[formType].noun.toLowerCase()}`}
                  />
                </label>
                <div className="field-grid">
                  <label className="field-label">
                    Responsible Person
                    <select
                      value={recordOwner}
                      onChange={(event) => setRecordOwner(event.target.value)}
                    >
                      {MEFFORD_COMPANY_DIRECTORY.map((member) => <option key={member.email}>{member.name}</option>)}
                      <option>Office</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Date
                    <input
                      type="date"
                      value={recordDate}
                      onChange={(event) => setRecordDate(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    Time
                    <input
                      type="time"
                      value={recordTime}
                      onChange={(event) => setRecordTime(event.target.value)}
                    />
                  </label>
                </div>
                <label className="field-label">
                  Notes / Details
                  <textarea
                    value={recordNotes}
                    onChange={(event) => setRecordNotes(event.target.value)}
                    rows={5}
                    placeholder="Add scope, field notes, recipients, or other important details"
                  />
                </label>
                {formType === "Change Orders" ? (
                  <div className="form-rule">
                    <strong>Approval workflow:</strong> Superintendents can
                    submit this request. Only project managers and above can
                    approve it. Financial details remain restricted.
                  </div>
                ) : null}
                {formType === "Contracts" || formType === "Subcontracts" ? (
                  <div className="form-rule">
                    <strong>Financial information:</strong> Visible only to
                    office staff, project managers, and administrators.
                  </div>
                ) : null}
                {formType === "RFIs" ? (
                  <div className="form-rule">
                    <strong>Overdue alerts:</strong> Project managers will be
                    notified automatically if this RFI becomes overdue.
                  </div>
                ) : null}
              </>
            )}
            <div className="modal-actions">
              <span className="form-submit-context">{projectProfile.number}{formType === "Change Orders" ? " · Next: Project Manager Review" : formType === "Daily Logs" ? " · Finalize To Share With The Project Team" : ` · ${projectProfile.name}`}</span>
              {formType === "Daily Logs" ? <button className="secondary-action" disabled={recordSaving || Boolean(dailyDraft.candidate)} onClick={() => void dailyDraft.save()}>Save Draft On Device</button> : null}
              <button
                className="secondary-action"
                onClick={() => void closeRecordForm()}
              >
                {formType === "Daily Logs" ? "Save & Close" : "Cancel"}
              </button>
              <button
                className="primary-action large"
                disabled={
                  recordSaving || Boolean(formType === "Daily Logs" && dailyDraft.candidate) ||
                  (formType === "Toolbox Talks" &&
                    (toolboxAttendees.length === 0 ||
                      !toolboxAttendees.every((name) =>
                        signedAttendees.includes(name),
                      )))
                }
                onClick={saveRecord}
              >
                {recordSaving
                  ? "Saving Permanently..."
                  : formType === "Daily Logs"
                  ? "Finalize Daily Log"
                  : formType === "Change Orders"
                    ? "Submit Request"
                    : formType === "Toolbox Talks"
                      ? `Complete Talk · ${signedAttendees.length}/${toolboxAttendees.length} Signed`
                      : "Save Draft"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {selectedRecordItem ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedRecord(null);
              setCorrectingRecordDate(false);
            }
          }}
        >
          <section
            className="record-modal record-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-detail-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">
                  {selectedRecordItem.id} · {selectedRecordItem.status.toUpperCase()}
                </p>
                <h2 id="record-detail-title">{selectedRecordItem.title}</h2>
              </div>
              <button
                aria-label="Close record details"
                onClick={() => {
                  setSelectedRecord(null);
                  setCorrectingRecordDate(false);
                }}
              >
                ×
              </button>
            </div>

            <section className="record-detail-summary">
              <div>
                <span>Responsible</span>
                <strong>{selectedRecordItem.owner}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selectedRecordItem.status}</strong>
              </div>
            </section>

            {selectedRecordItem.data &&
            Object.keys(selectedRecordItem.data).length ? (
              <section className="stored-record-details">
                <div>

                  <h3>Saved Field Information</h3>
                </div>
                <dl>
                  {Object.entries(selectedRecordItem.data).filter(([key]) => key !== "weatherSource").map(([key, value]) => (
                    <div key={key}>
                      <dt>{storedRecordLabels[key] ?? key}</dt>
                      <dd>{storedRecordValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {selectedRecordSupportsLegalLifecycle ? (
              <section className="legal-record-controls">
                <div className="legal-record-controls-heading">
                  <div>

                    <h3>Contract And Subcontract Record Control</h3>

                  </div>
                  <span>🔒 AUDITED</span>
                </div>
                {canAdministerLegalRecords ? (
                  <div className="legal-record-action-buttons">
                    {selectedRecordItem.status !== "Draft" &&
                    !["Executed", "Voided & Archived"].includes(
                      selectedRecordItem.status,
                    ) ? (
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setLegalLifecycleAction("return_to_draft");
                          setLegalLifecycleReason("");
                        }}
                      >
                        Return To Draft
                      </button>
                    ) : null}
                    {selectedRecordItem.status === "Executed" ? (
                      <>
                        <button
                          className="secondary-action"
                          onClick={() => {
                            setLegalLifecycleAction("create_amendment");
                            setLegalLifecycleReason("");
                          }}
                        >
                          Create Numbered Amendment
                        </button>
                        <button
                          className="secondary-action danger-outline"
                          onClick={() => {
                            setLegalLifecycleAction("void_archive");
                            setLegalLifecycleReason("");
                          }}
                        >
                          Void And Archive
                        </button>
                      </>
                    ) : null}
                    {selectedRecordItem.status === "Draft" &&
                    canPermanentlyDeleteRecords ? (
                      <button
                        className="secondary-action danger-outline"
                        onClick={() => {
                          setLegalLifecycleAction("permanent_delete");
                          setLegalLifecycleReason("");
                        }}
                      >
                        Permanently Delete Draft
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="legal-record-role-note">
                    A Company Owner Or Administrator Is Required For Controlled
                    Legal Record Actions.
                  </div>
                )}
                {legalLifecycleAction ? (
                  <div className={`legal-lifecycle-confirmation ${legalLifecycleAction === "permanent_delete" || legalLifecycleAction === "void_archive" ? "danger" : ""}`}>
                    <div>
                      <strong>
                        {{
                          return_to_draft: "Return Approved Record To Draft",
                          void_archive: "Void And Archive Executed Record",
                          create_amendment: "Create Attached Numbered Amendment",
                          permanent_delete: "Permanently Delete Draft",
                        }[legalLifecycleAction]}
                      </strong>
                      <small>
                        {legalLifecycleAction === "void_archive"
                          ? "The signed original remains preserved. Subcontract commitments are reversed from the Budget."
                          : legalLifecycleAction === "create_amendment"
                            ? `The next amendment number will remain attached to ${selectedRecordItem.id}.`
                            : legalLifecycleAction === "permanent_delete"
                              ? "Only this unexecuted Draft can be permanently deleted by a Company Owner."
                              : "Approval is withdrawn and the record becomes editable again."}
                      </small>
                    </div>
                    <label className="field-label">
                      Required Explanation
                      <textarea
                        rows={3}
                        value={legalLifecycleReason}
                        onChange={(event) =>
                          setLegalLifecycleReason(event.target.value)
                        }
                        placeholder="Explain exactly why this action is required"
                      />
                    </label>
                    <div className="modal-actions">
                      <button
                        className="secondary-action"
                        onClick={() => {
                          setLegalLifecycleAction(null);
                          setLegalLifecycleReason("");
                        }}
                      >
                        Cancel Action
                      </button>
                      <button
                        className="primary-action large"
                        disabled={
                          legalLifecycleSaving ||
                          !legalLifecycleReason.trim()
                        }
                        onClick={completeLegalLifecycleAction}
                      >
                        {legalLifecycleSaving
                          ? "Saving Permanent History..."
                          : "Confirm Controlled Action"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {selectedRecordDateLocked ? (
              <>
                <div className="date-lock-banner">
                  <span>🔒</span>
                  <div>
                    <strong>Finalized Record Locked</strong>
                    <small>
                      Only an Administrator or Company Owner can correct a
                      finalized field. Every correction keeps the original value
                      in permanent audit history.
                    </small>
                  </div>
                </div>
                <section className="record-date-display">
                  <div>
                    <span>Record Date</span>
                    <strong>
                      {selectedRecordItem.recordDate
                        ? numericDateFromInput(selectedRecordItem.recordDate)
                        : selectedRecordItem.due}
                    </strong>
                  </div>
                  <div>
                    <span>Record Time</span>
                    <strong>{displayTimeInput(selectedRecordItem.recordTime || "")}</strong>
                  </div>
                  <div>
                    <span>Project Timezone</span>
                    <strong>{projectTimeZoneLabel(projectProfile.timeZone)}</strong>
                  </div>
                </section>

                {lastCorrectionRecipient ? (
                  <div className="correction-notification-success">
                    <span>✓</span>
                    <div>
                      <strong>Correction Notification Created</strong>
                      <small>
                        {lastCorrectionRecipient} Was Notified And The Correction
                        Was Added To Permanent History.
                      </small>
                    </div>
                  </div>
                ) : null}

                {!selectedRecordSupportsLegalLifecycle && !correctingRecordDate ? (
                  <button
                    className="primary-action large correction-button"
                    onClick={() => {
                      chooseCorrectionField("Date And Time");
                      setCorrectingRecordDate(true);
                    }}
                  >
                    Correct Finalized Record
                  </button>
                ) : !selectedRecordSupportsLegalLifecycle ? (
                  <section className="admin-correction-panel">
                    <div>

                      <h3>Correct A Finalized Field</h3>
                    </div>
                    <label className="field-label">
                      Field To Correct
                      <select
                        value={correctionField}
                        onChange={(event) =>
                          chooseCorrectionField(
                            event.target.value as CorrectionField,
                          )
                        }
                      >
                        <option>Date And Time</option>
                        <option>Title Or Description</option>
                        <option>Responsible Person</option>
                        <option>Details</option>
                      </select>
                    </label>
                    {correctionField === "Date And Time" ? (
                      <div className="field-grid">
                        <label className="field-label">
                          Corrected Date
                          <input
                            ref={correctionDateInput}
                            type="date"
                            defaultValue={correctionDate}
                          />
                        </label>
                        <label className="field-label">
                          Corrected Time
                          <input
                            ref={correctionTimeInput}
                            type="time"
                            defaultValue={correctionTime}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="field-label">
                        Corrected Value
                        <textarea
                          rows={correctionField === "Details" ? 4 : 2}
                          value={correctionValue}
                          onChange={(event) => setCorrectionValue(event.target.value)}
                          placeholder={`Enter Corrected ${correctionField}`}
                        />
                      </label>
                    )}
                    <label className="field-label">
                      Required Correction Reason
                      <textarea
                        rows={3}
                        value={correctionReason}
                        onChange={(event) => setCorrectionReason(event.target.value)}
                        placeholder="Explain why this finalized record needs correction"
                      />
                    </label>
                    <div className="modal-actions">
                      <button
                        className="secondary-action"
                        onClick={() => setCorrectingRecordDate(false)}
                      >
                        Cancel Correction
                      </button>
                      <button
                        className="primary-action large"
                        disabled={correctionSaving}
                        onClick={saveAdminCorrection}
                      >
                        {correctionSaving
                          ? "Saving Permanently..."
                          : "Save Audited Correction"}
                      </button>
                    </div>
                  </section>
                ) : null}

                <section className="date-audit-list">
                  <div>

                    <h3>Complete Record History</h3>
                  </div>
                  {selectedRecordAuditHistory.length ? (
                    <ol>
                      {selectedRecordAuditHistory.map((entry, index) => (
                        <li key={`${entry}-${index}`}>{entry}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>No Prior Corrections Recorded</p>
                  )}
                </section>
              </>
            ) : (
              <>
                {selectedRecordSupportsLegalLifecycle ? (
                  !correctingRecordDate ? (
                    <div className="draft-legal-edit-banner">
                      <div>
                        <strong>Draft Record Is Editable</strong>
                        <span>
                          Select one field at a time. Every edit requires an
                          explanation and remains in permanent history.
                        </span>
                      </div>
                      <button
                        className="primary-action"
                        onClick={() => {
                          chooseCorrectionField("Title Or Description");
                          setCorrectingRecordDate(true);
                        }}
                      >
                        Edit Draft Record
                      </button>
                    </div>
                  ) : (
                    <section className="admin-correction-panel">
                      <div>

                        <h3>Edit A Draft Field</h3>
                      </div>
                      <label className="field-label">
                        Field To Edit
                        <select
                          value={correctionField}
                          onChange={(event) =>
                            chooseCorrectionField(
                              event.target.value as CorrectionField,
                            )
                          }
                        >
                          <option>Date And Time</option>
                          <option>Title Or Description</option>
                          <option>Responsible Person</option>
                          <option>Details</option>
                        </select>
                      </label>
                      {correctionField === "Date And Time" ? (
                        <div className="field-grid">
                          <label className="field-label">
                            Corrected Date
                            <input
                              ref={correctionDateInput}
                              type="date"
                              defaultValue={correctionDate}
                            />
                          </label>
                          <label className="field-label">
                            Corrected Time
                            <input
                              ref={correctionTimeInput}
                              type="time"
                              defaultValue={correctionTime}
                            />
                          </label>
                        </div>
                      ) : (
                        <label className="field-label">
                          Corrected Value
                          <textarea
                            rows={correctionField === "Details" ? 4 : 2}
                            value={correctionValue}
                            onChange={(event) =>
                              setCorrectionValue(event.target.value)
                            }
                            placeholder={`Enter Corrected ${correctionField}`}
                          />
                        </label>
                      )}
                      <label className="field-label">
                        Required Edit Explanation
                        <textarea
                          rows={3}
                          value={correctionReason}
                          onChange={(event) =>
                            setCorrectionReason(event.target.value)
                          }
                          placeholder="Explain why this Draft needs to change"
                        />
                      </label>
                      <div className="modal-actions">
                        <button
                          className="secondary-action"
                          onClick={() => setCorrectingRecordDate(false)}
                        >
                          Cancel Edit
                        </button>
                        <button
                          className="primary-action large"
                          disabled={correctionSaving}
                          onClick={saveAdminCorrection}
                        >
                          {correctionSaving
                            ? "Saving Permanent History..."
                            : "Save Audited Draft Edit"}
                        </button>
                      </div>
                    </section>
                  )
                ) : (
                  <>

                    <div className="field-grid">
                      <label className="field-label">
                        Record Date
                        <input
                          type="date"
                          value={correctionDate}
                          onChange={(event) => setCorrectionDate(event.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        Record Time
                        <input
                          type="time"
                          value={correctionTime}
                          onChange={(event) => setCorrectionTime(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="modal-actions">
                      <button
                        className="secondary-action"
                        onClick={() => setSelectedRecord(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="primary-action large"
                        onClick={saveDraftRecordDate}
                      >
                        Save Date And Time
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
      {projectSetupOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setProjectSetupOpen(false)
          }
        >
          <section
            className="record-modal wide project-setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-setup-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow orange-text">
                  {projectSetupMode === "new"
                    ? "NEW MEFFORD PROJECT"
                    : `${projectProfile.number} · PROJECT SETTINGS`}
                </p>
                <h2 id="project-setup-title">
                  {projectSetupMode === "new"
                    ? "Start A New Job"
                    : "Edit Project Information"}
                </h2>
              </div>
              <button
                aria-label="Close project setup"
                onClick={() => setProjectSetupOpen(false)}
              >
                ×
              </button>
            </div>
            <section className="project-source-choice">
              <div>
                <strong>Project Source</strong>

              </div>
              <button className="active">Manual Setup</button>
              <button disabled>Awarded Estimate · Sales Phase</button>
            </section>
            <fieldset className="project-setup-section">
              <legend>Project Identity</legend>
              <div className="field-grid">
                <label className="field-label">
                  Project Name
                  <input
                    autoFocus
                    value={projectDraft.name}
                    onChange={(event) =>
                      updateProjectDraft("name", event.target.value)
                    }
                    placeholder="Example: Dog Pound"
                  />
                </label>
                <div className="field-label">
                  <span>Project Number</span>
                  <div className="automatic-project-number">
                    <strong>{projectDraft.number}</strong>
                    <small>Automatically Assigned · Cannot Be Edited</small>
                  </div>
                  <small className="project-number-rule">
                    Format: YY-### · Resets To 001 Each January · Duplicate Numbers Blocked · Issued Numbers Never Reused
                  </small>
                </div>
              </div>
              <div className="field-grid">
                <label className="field-label">
                  Project Status
                  <select
                    value={projectDraft.status}
                    onChange={(event) =>
                      updateProjectDraft(
                        "status",
                        event.target.value as ProjectProfile["status"],
                      )
                    }
                  >
                    <option>Preconstruction</option>
                    <option>Active</option>
                    <option>On Hold</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                  </select>
                  <small className="field-source">
                    Completed And Cancelled Projects Keep Their Permanent Number
                  </small>
                </label>
                <label className="field-label">
                  Project Type
                  <select
                    value={projectDraft.projectType}
                    onChange={(event) =>
                      updateProjectDraft("projectType", event.target.value)
                    }
                  >
                    <option>Commercial New Build</option>
                    <option>Commercial Renovation</option>
                    <option>Tenant Improvement</option>
                    <option>Industrial</option>
                    <option>Public Project</option>
                    <option>Service / Small Project</option>
                  </select>
                </label>
                <label className="field-label">
                  Construction Site
                  <input
                    value={projectDraft.site}
                    onChange={(event) =>
                      updateProjectDraft("site", event.target.value)
                    }
                    placeholder="Street address or city and state"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="project-setup-section">
              <legend>Project Owner And Contract</legend>
              <div className="field-grid">
                <label className="field-label">
                  Project Owner Legal Name
                  <input
                    value={projectDraft.ownerName}
                    onChange={(event) =>
                      updateProjectDraft("ownerName", event.target.value)
                    }
                    placeholder="Legal Company Name"
                  />
                </label>
                <label className="field-label">
                  Project Owner Contract Date
                  <input
                    type="date"
                    value={projectDraft.ownerContractDate}
                    onChange={(event) =>
                      updateProjectDraft(
                        "ownerContractDate",
                        event.target.value,
                      )
                    }
                  />
                </label>
              </div>
              <div className="field-grid">
                <label className="field-label">
                  Architect / Engineer
                  <input
                    value={projectDraft.architect}
                    onChange={(event) =>
                      updateProjectDraft("architect", event.target.value)
                    }
                    placeholder="Name or N/A"
                  />
                </label>
                <label className="field-label">
                  Original Project Owner Contract Amount
                  <input
                    inputMode="decimal"
                    value={projectDraft.contractAmount}
                    onChange={(event) =>
                      updateProjectDraft("contractAmount", event.target.value)
                    }
                    placeholder="0.00"
                  />
                </label>
              </div>
              <div className="project-current-contract">
                <span>Current Contract Value</span>
                <strong>{formatCurrency(Number(projectDraft.currentContractAmount || projectDraft.contractAmount) || 0)}</strong>
                <small>Updates Automatically After A Project Owner-Signed Change Order Is Executed</small>
              </div>
            </fieldset>
            <fieldset className="project-setup-section">
              <legend>Project Schedule</legend>
              <div className="project-date-grid">
                <label className="field-label">
                  Start Date
                  <input
                    type="date"
                    value={projectDraft.startDate}
                    onChange={(event) =>
                      updateProjectDraft("startDate", event.target.value)
                    }
                  />
                </label>
                <label className="field-label">
                  Substantial Completion
                  <input
                    type="date"
                    value={projectDraft.substantialDate}
                    onChange={(event) =>
                      updateProjectDraft("substantialDate", event.target.value)
                    }
                  />
                </label>
                <label className="field-label">
                  Final Completion
                  <input
                    type="date"
                    value={projectDraft.finalDate}
                    onChange={(event) =>
                      updateProjectDraft("finalDate", event.target.value)
                    }
                  />
                </label>
              </div>
            </fieldset>
            {projectSetupMode === "new" ? (
              <fieldset className="project-setup-section project-meeting-setup" data-reflow-table="">
                <legend>Required Project Meeting Schedule</legend>
                <div className="project-meeting-plan-head" data-reflow-head="medium">
                  <span>Meeting Type</span><span>Requirement</span><span>First Meeting</span><span>Cadence</span><span>Permanent Reason</span>
                </div>
                {(Object.keys(projectMeetingPlan) as Array<keyof ProjectMeetingPlan>).map((meetingType) => {
                  const plan = projectMeetingPlan[meetingType];
                  return <div className="project-meeting-plan-row" key={meetingType} data-reflow-row="medium">
                    <strong data-label="Meeting Type">{meetingType}</strong>
                    <label className="reflow-field" data-label="Requirement"><select value={plan.requirement} disabled={sessionActor.accessLevel !== "Company Owner"} onChange={(event) => setProjectMeetingPlan((current) => ({ ...current, [meetingType]: { ...current[meetingType], requirement: event.target.value as "Required" | "Not Required" } }))}><option>Required</option><option>Not Required</option></select></label>
                    <label className="reflow-field" data-label="First Meeting"><input aria-label={`${meetingType} first meeting`} type="datetime-local" value={plan.startAt} disabled={plan.requirement === "Not Required"} onChange={(event) => setProjectMeetingPlan((current) => ({ ...current, [meetingType]: { ...current[meetingType], startAt: event.target.value } }))} /></label>
                    <label className="reflow-field" data-label="Cadence"><select value={plan.cadence} disabled={plan.requirement === "Not Required"} onChange={(event) => setProjectMeetingPlan((current) => ({ ...current, [meetingType]: { ...current[meetingType], cadence: event.target.value } }))}><option>Weekly</option><option>Biweekly</option><option>Monthly</option><option>Quarterly</option><option>As Needed</option></select></label>
                    <label className="reflow-field" data-label="Permanent Reason"><input aria-label={`${meetingType} not required reason`} placeholder={plan.requirement === "Not Required" ? "Owner reason required" : "Not applicable"} value={plan.reason} disabled={plan.requirement !== "Not Required"} onChange={(event) => setProjectMeetingPlan((current) => ({ ...current, [meetingType]: { ...current[meetingType], reason: event.target.value } }))} /></label>
                  </div>;
                })}
                <small className="field-source">All three project meeting types are configured when the project is created. Only a Company Owner can mark a type Not Required, and that decision remains in the permanent audit trail.</small>
              </fieldset>
            ) : null}
            <fieldset className="project-setup-section closeout-phase-setup">
              <legend>Closeout Structure</legend>
              <label className="setting-toggle">
                <span>
                  <strong>Does This Project Have Separate Phases, Buildings, Floors, Or Turnover Areas?</strong>
                  <small>
                    Individual subcontractors can upload closeout materials from the beginning either way. This setting controls whether Mefford also tracks separate partial-turnover packages.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={projectDraft.hasCloseoutPhases === true}
                  onChange={(event) =>
                    setProjectDraft((current) => ({
                      ...current,
                      hasCloseoutPhases: event.target.checked,
                      closeoutPhases: event.target.checked
                        ? current.closeoutPhases || []
                        : [],
                    }))
                  }
                />
              </label>
              {projectDraft.hasCloseoutPhases ? (
                <label className="field-label">
                  Phase / Area Names
                  <input
                    value={(projectDraft.closeoutPhases || []).join(", ")}
                    onChange={(event) =>
                      setProjectDraft((current) => ({
                        ...current,
                        closeoutPhases: Array.from(
                          new Set(
                            event.target.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          ),
                        ),
                      }))
                    }
                    placeholder="Example: Building A, Building B, Tenant Area"
                  />
                  <small className="field-source">
                    Separate names with commas. The master project remains open until every required phase is accepted.
                  </small>
                </label>
              ) : null}
            </fieldset>
            <fieldset className="project-setup-section">
              <legend>Team And Jobsite Systems</legend>
              <div className="project-date-grid">
                <label className="field-label">
                  Project Manager
                  <select
                    value={projectDraft.projectManager}
                    onChange={(event) =>
                      updateProjectDraft("projectManager", event.target.value)
                    }
                  >
                    <option value="" disabled>Select Project Manager</option>
                    {Array.from(new Set([
                      projectDraft.projectManager,
                      ...projectManagerDirectory.map((member) => member.name),
                    ].filter(Boolean))).map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  Site Superintendent
                  <select
                    value={projectDraft.superintendent}
                    onChange={(event) =>
                      updateProjectDraft("superintendent", event.target.value)
                    }
                  >
                    <option value="" disabled>Select Site Superintendent</option>
                    {Array.from(new Set([
                      projectDraft.superintendent,
                      ...superintendentDirectory.map((member) => member.name),
                    ].filter(Boolean))).map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  Planned Camera Slots
                  <input
                    type="number"
                    min="0"
                    max="16"
                    value={projectDraft.cameraCount}
                    onChange={(event) =>
                      updateProjectDraft(
                        "cameraCount",
                        Math.min(16, Math.max(0, Number(event.target.value))),
                      )
                    }
                  />
                  <small className="field-source">
                    Up to 16 planned UniFi locations. No feed is live until the approved connection is completed.
                  </small>
                </label>
                <label className="field-label">
                  Project Timezone
                  <select
                    value={projectDraft.timeZone}
                    onChange={(event) =>
                      updateProjectDraft("timeZone", event.target.value)
                    }
                  >
                    <option value="America/New_York">Eastern Time</option>
                    <option value="America/Chicago">Central Time</option>
                    <option value="America/Denver">Mountain Time</option>
                    <option value="America/Los_Angeles">Pacific Time</option>
                  </select>
                  <small className="field-source">
                    Controls Default Dates And Times For This Project
                  </small>
                </label>
              </div>
            </fieldset>
            {projectSetupMode === "edit" &&
            sessionActor.accessLevel === "Company Owner" ? (
              <section className="project-reset-card">
                <div>

                  <h3>Remove Project And All Related Data</h3>

                </div>
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => void openProjectDeletion()}
                >
                  Move To Deletion Quarantine
                </button>
              </section>
            ) : null}
            <div className="project-autofill-rule">
              <span>✓</span>
              <div>
                <strong>Project Information Reuse</strong>

              </div>
            </div>
            {projectError ? (
              <div className="form-error">{projectError}</div>
            ) : null}
            <div className="modal-actions">
              <small className="project-permission-note">
                Project Managers, Administrators, and Company Owners can create
                projects.
              </small>
              <button
                className="secondary-action"
                onClick={() => setProjectSetupOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-action large"
                disabled={projectSaving}
                onClick={saveProjectProfile}
              >
                {projectSaving
                  ? "Saving Project..."
                  : projectSetupMode === "new"
                    ? "Create Project And Open"
                    : "Save Project Information"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {resetOpen && sessionActor.accessLevel === "Company Owner" ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setResetOpen(false)
          }
        >
          <section
            className="record-modal project-reset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-reset-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="project-reset-title">Remove {projectProfile.name}</h2>
              </div>
              <button aria-label="Close project reset" onClick={() => setResetOpen(false)}>
                ×
              </button>
            </div>
            <div className="project-reset-warning">
              <strong>30-Day Recovery Protection</strong>
              <p>
                Command Center first creates and verifies an immutable recovery manifest. The project and every connected record are then hidden in Owner-controlled quarantine. No uploaded file is deleted during the 30-day cooling period. Restore or final purge is managed under Admin → Company Operations. Company master libraries remain untouched.
              </p>
              {resetPreview ? <small>{resetPreview.records.toLocaleString()} Project Records · {resetPreview.files.toLocaleString()} Files · {resetPreview.linkedRows.toLocaleString()} Total Linked Rows Identified</small> : <small>Calculating the complete deletion impact…</small>}
            </div>
            <label className="field-label">
              Type {projectProfile.name} To Confirm
              <input
                autoFocus
                value={resetConfirmation}
                onChange={(event) => setResetConfirmation(event.target.value)}
                placeholder={projectProfile.name}
              />
            </label>
            {resetError ? <div className="form-error">{resetError}</div> : null}
            <div className="modal-actions">
              <button className="secondary-action" onClick={() => setResetOpen(false)}>
                Keep Project
              </button>
              <button
                className="danger-action"
                disabled={resetSaving || !resetPreview || resetConfirmation !== projectProfile.name}
                onClick={deleteActiveProject}
              >
                {resetSaving ? "Creating Recovery Snapshot..." : "Move Project To Quarantine"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {cameraViewOpen ? (
        <div
          className="modal-layer camera-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setCameraViewOpen(false)
          }
        >
          <section
            className="camera-wall"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-wall-title"
          >
            <header>
              <div>
                <p className="eyebrow">
                  {projectProfile.number} · CAMERA READINESS
                </p>
                <h2 id="camera-wall-title">
                  {projectProfile.name} Camera Plan
                </h2>
                <span>{projectProfile.cameraCount} Of 16 Slots Planned · Zero Feeds Assumed</span>
              </div>
              <div>
                <b className="camera-connection-required">
                  <i /> UniFi Connection Required
                </b>
                <button
                  aria-label="Close camera view"
                  onClick={() => setCameraViewOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>
            <div className="camera-wall-grid">
              {cameraNames.map((name, index) =>
                index < projectProfile.cameraCount ? (
                  <article
                    className="camera-tile planned"
                    key={name}
                  >
                    <span className="camera-plan-mark">PLAN</span>
                    <span className="camera-tile-label">
                      <i /> {name}
                    </span>
                    <small>
                      CAM {String(index + 1).padStart(2, "0")} · NO DEVICE OR FEED
                    </small>
                  </article>
                ) : (
                  <button
                    className="camera-tile available"
                    key={name}
                    disabled={index > projectProfile.cameraCount}
                    onClick={reserveProjectCameraSlot}
                    aria-label={
                      index === projectProfile.cameraCount
                        ? `Reserve Camera Slot ${String(index + 1).padStart(2, "0")}`
                        : `Camera Slot ${String(index + 1).padStart(2, "0")} Available`
                    }
                  >
                    <span>＋</span>
                    <strong>
                      {index === projectProfile.cameraCount
                        ? "Reserve Planned Slot"
                        : "Available Slot"}
                    </strong>
                    <small>CAM {String(index + 1).padStart(2, "0")}</small>
                  </button>
                ),
              )}
            </div>
            <footer>
              <span>Connection-ready plan only · no credentials device IDs snapshots or streams stored</span>
              <strong>
                {16 - projectProfile.cameraCount} Camera Slot
                {16 - projectProfile.cameraCount === 1 ? "" : "s"} Available
              </strong>
            </footer>
          </section>
        </div>
      ) : null}
      {signaturePerson ? (
        <div className="signature-layer" role="presentation">
          <section
            className="signature-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signature-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="signature-title">{signaturePerson}</h2>
              </div>
              <button
                aria-label="Cancel signature"
                onClick={() => setSignaturePerson(null)}
              >
                ×
              </button>
            </div>
            <p>
              By signing below, the attendee confirms participation in this
              toolbox talk.
            </p>
            <canvas
              ref={signatureCanvas}
              width="640"
              height="190"
              aria-label={`Signature pad for ${signaturePerson}`}
              onPointerDown={beginSignature}
              onPointerMove={drawSignature}
              onPointerUp={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              onPointerCancel={(event) =>
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            />
            <div className="signature-line">Sign with finger or stylus</div>
            <div className="modal-actions">
              <button className="secondary-action" onClick={clearSignature}>
                Clear
              </button>
              <button
                className="primary-action large"
                disabled={!hasSignatureInk}
                onClick={acceptSignature}
              >
                Accept Signature
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {notificationsOpen ? (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setNotificationsOpen(false)
          }
        >
          <section
            className="record-modal notification-center-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-center-title"
          >
            <div className="modal-heading">
              <div>

                <h2 id="notification-center-title">My Notifications</h2>
              </div>
              <button
                aria-label="Close notifications"
                onClick={() => setNotificationsOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="notification-center-list">
              {notifications.filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).slice(0, 20).map((item) => (
                <article key={item.id} className={item.isRead ? "" : "unread"}>
                  <span>{item.isRead ? "✓" : "!"}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                    <small>
                      {item.kind} · {item.priority} · {item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString("en-US")}` : new Date(item.createdAt).toLocaleString("en-US")}
                    </small>
                  </div>
                  <button className="secondary-action" onClick={() => void openNotification(item)}>Open</button>
                </article>
              ))}
              {!notifications.filter((item) => item.status !== "Completed" && !item.hiddenBySnooze).length ? <div className="empty-attention-state"><strong>No Active Notifications</strong><span>Your personal queue is current.</span></div> : null}
            </div>
            <div className="form-rule">
              <strong>Delivery Policy:</strong> In-App + Email For Operational Notices. Reminder At Due Time; Escalation At 48, 72, And 96 Hours. No Invoice Is Automatically Sent Or Posted.
            </div>
          </section>
        </div>
      ) : null}
      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
