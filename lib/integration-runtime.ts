export type IntegrationRuntime = {
  key: string;
  mode: "Native" | "Credential-Free" | "Managed Link" | "Manual Exchange" | "External Adapter";
  activationState: "Implemented" | "Prepared" | "Manual Workflow" | "Managed Resource" | "Not Implemented";
  ready: boolean;
  detail: string;
  missing: string[];
};

type RuntimeRule = {
  key: string;
  mode: IntegrationRuntime["mode"];
  all?: string[];
  any?: string[];
  anySets?: string[][];
  equals?: Record<string, string>;
  ready?: boolean;
  activationState?: IntegrationRuntime["activationState"];
  readyDetail: string;
  missingDetail: string;
};

const rules: RuntimeRule[] = [
  { key: "command-center-platform", mode: "Native", ready: true, readyDetail: "Application, D1 database, R2 files, and internal workflow APIs are bound in production", missingDetail: "Native platform bindings are unavailable" },
  { key: "openai-command-ai", mode: "External Adapter", all: ["OPENAI_API_KEY"], readyDetail: "Production OpenAI credential is present; provider validation still requires a successful audited request", missingDetail: "OPENAI_API_KEY is not configured in production" },
  { key: "microsoft-identity", mode: "External Adapter", all: ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "MICROSOFT_GRAPH_REDIRECT_URI", "MICROSOFT_GRAPH_AUTH_STATE_KEY"], readyDetail: "Single-tenant Microsoft credentials, the exact server callback, and encrypted PKCE state protection are present; Jordan and Blain linking plus enforcement validation still remain", missingDetail: "Microsoft tenant application credentials, exact redirect URI, or server-only authentication-state key are incomplete" },
  { key: "microsoft-onedrive", mode: "External Adapter", all: ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "MICROSOFT_SHAREPOINT_SITE_ID", "MICROSOFT_SHAREPOINT_MODE"], equals: { MICROSOFT_SHAREPOINT_PERMISSION_POLICY_VERIFIED: "true" }, anySets: [["MICROSOFT_SHAREPOINT_DRIVE_ID", "MICROSOFT_SHAREPOINT_ROOT_ITEM_ID"], ["MICROSOFT_SHAREPOINT_ESTIMATES_DRIVE_ID", "MICROSOFT_SHAREPOINT_ESTIMATES_ROOT_ITEM_ID", "MICROSOFT_SHAREPOINT_PROJECTS_DRIVE_ID", "MICROSOFT_SHAREPOINT_PROJECTS_ROOT_ITEM_ID", "MICROSOFT_SHAREPOINT_PEOPLE_DRIVE_ID", "MICROSOFT_SHAREPOINT_PEOPLE_ROOT_ITEM_ID", "MICROSOFT_SHAREPOINT_TEMPLATES_DRIVE_ID", "MICROSOFT_SHAREPOINT_TEMPLATES_ROOT_ITEM_ID"]], readyDetail: "Microsoft Graph, SharePoint site, all controlled roots, owner-approved storage mode, and tested library permission policy are present; controlled folder and copy verification still govern go-live", missingDetail: "SharePoint site, storage mode, approved drive/root mappings, or tested library permissions are incomplete; Command Center remains the file source of truth" },
  { key: "microsoft-meetings", mode: "External Adapter", all: ["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "MICROSOFT_GRAPH_WEBHOOK_URL", "MICROSOFT_GRAPH_WEBHOOK_CLIENT_STATE"], readyDetail: "Microsoft Graph and the fail-closed, subscription-bound, rate-limited webhook receiver are configured; provider notification evidence and every organizer still require audited smoke testing", missingDetail: "Microsoft Graph or protected webhook validation is incomplete" },
  { key: "operational-email", mode: "External Adapter", anySets: [["MICROSOFT_GRAPH_TENANT_ID", "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET", "MICROSOFT_OPERATIONAL_MAILBOX"], ["OPERATIONAL_EMAIL_WEBHOOK_URL"]], readyDetail: "Operational email has a Microsoft 365 mailbox or approved adapter; provider-receipt testing still controls certification", missingDetail: "Configure Microsoft Graph plus MICROSOFT_OPERATIONAL_MAILBOX, or OPERATIONAL_EMAIL_WEBHOOK_URL" },
  { key: "web-push-notifications", mode: "External Adapter", all: ["WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_SUBJECT"], readyDetail: "Web-push signing credentials are configured", missingDetail: "Web-push signing credentials are incomplete" },
  { key: "project-weather-geocoding", mode: "Credential-Free", ready: true, readyDetail: "Address geocoding, National Weather Service, and archived weather clients require no private credential", missingDetail: "Credential-free weather client is unavailable" },
  { key: "ubiquiti-unifi", mode: "External Adapter", activationState: "Not Implemented", readyDetail: "Ubiquiti adapter is configured", missingDetail: "Inventory only: the Ubiquiti provider adapter has not been implemented or authorized" },
  { key: "fleet-gps-telematics", mode: "External Adapter", activationState: "Not Implemented", readyDetail: "Fleet telematics adapter is configured", missingDetail: "Inventory only: a fleet telematics provider and adapter have not been selected or implemented" },
  { key: "ramp", mode: "External Adapter", activationState: "Not Implemented", readyDetail: "Ramp adapter is configured", missingDetail: "Inventory only: the Ramp provider adapter has not been implemented or authorized" },
  { key: "chase-banking", mode: "External Adapter", activationState: "Not Implemented", readyDetail: "Bank reconciliation adapter is configured", missingDetail: "Inventory only: the Chase/banking provider adapter has not been implemented or authorized" },
  { key: "paylocity-payroll", mode: "Manual Exchange", activationState: "Manual Workflow", ready: true, readyDetail: "The approved manual payroll packet and returned-report reconciliation workflow is operational; no payroll API is intended", missingDetail: "Manual payroll exchange is unavailable" },
  { key: "united-healthcare-benefits", mode: "Managed Link", activationState: "Managed Resource", ready: true, readyDetail: "Benefits resources are controlled by the Review Center and published into My Employee Home", missingDetail: "The controlled benefits-resource library is unavailable" },
  { key: "northwestern-mutual-life", mode: "Managed Link", activationState: "Managed Resource", ready: true, readyDetail: "Life-insurance resources are controlled by the Review Center and published into My Employee Home", missingDetail: "The controlled life-insurance resource library is unavailable" },
  { key: "dental-vision-benefits", mode: "Managed Link", activationState: "Managed Resource", ready: true, readyDetail: "Dental and vision resources are controlled by the Review Center and published into My Employee Home", missingDetail: "The controlled dental/vision resource library is unavailable" },
  { key: "linkedin-company", mode: "External Adapter", all: ["MARKETING_SOCIAL_WEBHOOK_URL"], readyDetail: "Approved social-publishing adapter is configured", missingDetail: "MARKETING_SOCIAL_WEBHOOK_URL is not configured" },
  { key: "facebook-company", mode: "External Adapter", all: ["MARKETING_SOCIAL_WEBHOOK_URL"], readyDetail: "Approved social-publishing adapter is configured", missingDetail: "MARKETING_SOCIAL_WEBHOOK_URL is not configured" },
  { key: "google-analytics", mode: "External Adapter", all: ["MARKETING_ANALYTICS_WEBHOOK_URL"], readyDetail: "Marketing analytics adapter is configured", missingDetail: "MARKETING_ANALYTICS_WEBHOOK_URL is not configured" },
  { key: "marketing-email", mode: "External Adapter", all: ["MARKETING_EMAIL_WEBHOOK_URL"], readyDetail: "Marketing email adapter is configured", missingDetail: "MARKETING_EMAIL_WEBHOOK_URL is not configured" },
  { key: "customer-survey-delivery", mode: "External Adapter", all: ["MARKETING_EMAIL_WEBHOOK_URL", "CUSTOMER_SURVEY_PUBLIC_ORIGIN"], readyDetail: "Secure survey origin and delivery adapter are configured", missingDetail: "Survey origin or marketing email adapter is incomplete" },
];

export async function integrationRuntimeSnapshot(): Promise<Record<string, IntegrationRuntime>> {
  const { env } = await import("cloudflare:workers");
  const values = env as unknown as Record<string, unknown>;
  return Object.fromEntries(rules.map((rule) => {
    const all = rule.all || [];
    const any = rule.any || [];
    const anySets = rule.anySets || [];
    const equals = rule.equals || {};
    const missing = all.filter((name) => !present(values[name]));
    const anyReady = !any.length || any.some((name) => present(values[name]));
    const anySetReady = !anySets.length || anySets.some((set) => set.every((name) => present(values[name])));
    const equalMissing = Object.entries(equals).filter(([name, expected]) => String(values[name] || "").trim().toLowerCase() !== expected.toLowerCase()).map(([name, expected]) => `${name}=${expected}`);
    const ready = rule.ready === true || (Boolean(all.length || any.length || anySets.length || Object.keys(equals).length) && missing.length === 0 && anyReady && anySetReady && equalMissing.length === 0);
    const anyMissing = any.length && !anyReady ? [`One Of: ${any.join(" Or ")}`] : [];
    const anySetMissing = anySets.length && !anySetReady ? [`One Complete Set: ${anySets.map((set) => set.join(" + ")).join(" Or ")}`] : [];
    const runtime: IntegrationRuntime = {
      key: rule.key,
      mode: rule.mode,
      activationState: rule.activationState || (rule.mode === "External Adapter" ? "Implemented" : rule.mode === "Manual Exchange" ? "Manual Workflow" : rule.mode === "Managed Link" ? "Managed Resource" : "Implemented"),
      ready,
      detail: ready ? rule.readyDetail : rule.missingDetail,
      missing: [...missing, ...anyMissing, ...anySetMissing, ...equalMissing],
    };
    return [rule.key, runtime];
  }));
}

function present(value: unknown) {
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}
