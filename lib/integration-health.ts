export const INTEGRATION_COMPANY_ID = "MEFFORD-COMPANY";
export const INTEGRATION_RECORD_TYPE = "Integration Health Connections";
export const INTEGRATION_EVENT_TYPE = "Integration Health Events";
export const INTEGRATION_CONFLICT_TYPE = "Integration Sync Conflicts";
export const INTEGRATION_MAINTENANCE_TYPE = "Integration Maintenance Windows";
export const INTEGRATION_REPLAY_TYPE = "Integration Replay Requests";
export const INTEGRATION_INCIDENT_TYPE = "Integration Provider Incidents";

export const INTEGRATION_HEALTH_STATUSES = [
  "Connected",
  "Degraded",
  "Failed",
  "Reauthorization Required",
  "Maintenance",
  "Not Configured",
] as const;

export type IntegrationHealthStatus = (typeof INTEGRATION_HEALTH_STATUSES)[number];

export type IntegrationDefinition = {
  key: string;
  name: string;
  shortName: string;
  category: "Core Platform" | "AI & Automation" | "Identity & Files" | "Communications" | "Field Systems" | "Financial" | "Payroll" | "Benefits" | "Marketing";
  sensitive: boolean;
  providerStatusUrl: string;
  purpose: string;
  defaultOwnerRole: string;
  projectImpact: boolean;
};

export const MEFFORD_INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: "command-center-platform",
    name: "Command Center Platform",
    shortName: "CC",
    category: "Core Platform",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Application availability, database, files, scheduled work and deployment health",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "openai-command-ai",
    name: "OpenAI Command Intelligence",
    shortName: "AI",
    category: "AI & Automation",
    sensitive: false,
    providerStatusUrl: "https://status.openai.com/",
    purpose: "Governed assistant help and owner-only evidence narratives; never an autonomous employment or financial decision",
    defaultOwnerRole: "IT Administrator",
    projectImpact: false,
  },
  {
    key: "microsoft-identity",
    name: "Microsoft Identity",
    shortName: "MS",
    category: "Identity & Files",
    sensitive: false,
    providerStatusUrl: "https://status.cloud.microsoft/",
    purpose: "Employee sign-in, identity verification and access lifecycle",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "microsoft-onedrive",
    name: "Microsoft SharePoint & Files",
    shortName: "SP",
    category: "Identity & Files",
    sensitive: false,
    providerStatusUrl: "https://status.cloud.microsoft/",
    purpose: "Automatic estimate, project, employee and controlled-template folder provisioning with copy verification and a permanent no-delete guard",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "microsoft-meetings",
    name: "Microsoft Outlook, Teams & Meeting Evidence",
    shortName: "MT",
    category: "Communications",
    sensitive: false,
    providerStatusUrl: "https://status.cloud.microsoft/",
    purpose: "Owner-approved individual Outlook organizers, Teams links, recording defaults, attendance, transcripts and finalized minutes email",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "operational-email",
    name: "Operational Email",
    shortName: "EM",
    category: "Communications",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Assignments, due notices, escalations, invites and maintenance warnings through individualized Microsoft senders or the approved adapter, with provider receipts",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "web-push-notifications",
    name: "Mobile Web Push Notifications",
    shortName: "PN",
    category: "Communications",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Mobile assignments, due notices, critical safety notices and recovery alerts",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "project-weather-geocoding",
    name: "Project Address Weather & Geocoding",
    shortName: "WX",
    category: "Field Systems",
    sensitive: false,
    providerStatusUrl: "https://www.weather.gov/",
    purpose: "Resolve project street addresses and retrieve National Weather Service or archived Open-Meteo conditions for controlled daily logs",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "ubiquiti-unifi",
    name: "Ubiquiti Cameras & Access",
    shortName: "UI",
    category: "Field Systems",
    sensitive: false,
    providerStatusUrl: "https://status.ui.com/",
    purpose: "Project camera and access-control health",
    defaultOwnerRole: "IT Administrator",
    projectImpact: true,
  },
  {
    key: "fleet-gps-telematics",
    name: "Fleet GPS & Equipment Telematics",
    shortName: "GPS",
    category: "Field Systems",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Provider-confirmed vehicle and equipment positions, tracker timestamps and geofence events; manual custody and location remain operational when disconnected",
    defaultOwnerRole: "Fleet Manager / IT Administrator",
    projectImpact: true,
  },
  {
    key: "ramp",
    name: "Ramp",
    shortName: "RA",
    category: "Financial",
    sensitive: true,
    providerStatusUrl: "https://status.ramp.com/",
    purpose: "Approved card and expense information; never automatic posting or payment",
    defaultOwnerRole: "Accounting",
    projectImpact: true,
  },
  {
    key: "chase-banking",
    name: "Chase & Banking",
    shortName: "CH",
    category: "Financial",
    sensitive: true,
    providerStatusUrl: "https://www.chase.com/digital/resources/privacy-security/security/system-requirements",
    purpose: "Banking reconciliation visibility; never automatic transfer or payment",
    defaultOwnerRole: "Accounting",
    projectImpact: false,
  },
  {
    key: "paylocity-payroll",
    name: "Paylocity Payroll Exchange",
    shortName: "PY",
    category: "Payroll",
    sensitive: true,
    providerStatusUrl: "",
    purpose: "Controlled payroll export to Paylocity and accountant-imported payroll result reports; employee access remains a direct Paylocity login link",
    defaultOwnerRole: "Accounting / IT Administrator",
    projectImpact: false,
  },
  {
    key: "united-healthcare-benefits",
    name: "UnitedHealthcare Benefits Resources",
    shortName: "UH",
    category: "Benefits",
    sensitive: true,
    providerStatusUrl: "",
    purpose: "Employee health insurance enrollment resources and access links; private medical information is excluded from performance evidence",
    defaultOwnerRole: "Benefits Administrator / IT Administrator",
    projectImpact: false,
  },
  {
    key: "northwestern-mutual-life",
    name: "Northwestern Mutual Life Insurance",
    shortName: "NW",
    category: "Benefits",
    sensitive: true,
    providerStatusUrl: "",
    purpose: "Employee life-insurance plan resources only; never presented as the health-insurance provider",
    defaultOwnerRole: "Benefits Administrator / IT Administrator",
    projectImpact: false,
  },
  {
    key: "dental-vision-benefits",
    name: "Dental & Vision Benefits Resources",
    shortName: "DV",
    category: "Benefits",
    sensitive: true,
    providerStatusUrl: "",
    purpose: "Current employee dental and vision plan resources, provider links and carrier-change readiness",
    defaultOwnerRole: "Benefits Administrator / IT Administrator",
    projectImpact: false,
  },
  {
    key: "linkedin-company",
    name: "LinkedIn Company Page",
    shortName: "LI",
    category: "Marketing",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Approved company-page posts, media publication and provider-confirmed post analytics",
    defaultOwnerRole: "Marketing / IT Administrator",
    projectImpact: false,
  },
  {
    key: "facebook-company",
    name: "Facebook Company Page",
    shortName: "FB",
    category: "Marketing",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Approved company-page posts, media publication and provider-confirmed post analytics",
    defaultOwnerRole: "Marketing / IT Administrator",
    projectImpact: false,
  },
  {
    key: "google-analytics",
    name: "Google Analytics 4",
    shortName: "GA",
    category: "Marketing",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Website sessions, acquisition, engagement, key events and campaign attribution",
    defaultOwnerRole: "Marketing / IT Administrator",
    projectImpact: false,
  },
  {
    key: "marketing-email",
    name: "Marketing Newsletter Mailbox",
    shortName: "NM",
    category: "Marketing",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Approved external newsletters from marketing@meffcon.com and internal employee newsletters",
    defaultOwnerRole: "Marketing / IT Administrator",
    projectImpact: false,
  },
  {
    key: "customer-survey-delivery",
    name: "Secure Customer Survey Delivery",
    shortName: "SV",
    category: "Marketing",
    sensitive: false,
    providerStatusUrl: "",
    purpose: "Secure milestone survey links, verified delivery events, customer responses and consent-separated video testimonials",
    defaultOwnerRole: "Marketing / IT Administrator",
    projectImpact: true,
  },
];

export const INTEGRATION_GO_LIVE_CHECKLIST = [
  "Connection checklist completed",
  "Field mapping validated",
  "Permissions reviewed",
  "Test synchronization passed",
  "Source and target reconciliation passed",
  "Rollback test passed",
  "Responsible department approved",
  "Owner/Admin approved",
] as const;

export const INTEGRATION_SAFEGUARDS = {
  automatic: ["Health checks", "Safe retries", "My Work tasks", "Operational notices", "24-hour escalation"],
  prohibited: ["Duplicate records", "Silent overwrite", "Contract execution", "Financial posting", "Invoice sending", "Payment", "Payroll approval"],
  cadence: "Webhooks when supported · five-minute scheduled checks · nightly full reconciliation",
  maintenance: "Saturday 12:00–6:00 AM Eastern only when scheduled; restore immediately when complete",
  secretStorage: "Active secrets remain in encrypted platform storage. SharePoint stores restricted recovery and rotation records only.",
} as const;

export function parseIntegrationData(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function integrationSystemColor(statuses: IntegrationHealthStatus[], criticalIncident = false) {
  if (criticalIncident || statuses.some((status) => ["Failed", "Reauthorization Required"].includes(status))) return "Red";
  if (statuses.some((status) => ["Degraded", "Maintenance", "Not Configured"].includes(status))) return "Yellow";
  return "Green";
}

export function validIntegrationStatus(value: unknown): value is IntegrationHealthStatus {
  return INTEGRATION_HEALTH_STATUSES.includes(value as IntegrationHealthStatus);
}

export function safeIntegrationText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

export function addHours(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}
