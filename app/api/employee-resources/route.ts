import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, recordAudits } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import { PEOPLE_PROJECT_ID, enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureProjectFileSchema } from "../../../lib/project-file-schema";
import { REVIEW_PROJECT_ID, TEMPLATE_REVIEW_CATALOG, TEMPLATE_REVIEW_RECORD_TYPE, reviewFileCategory } from "../../../lib/template-review";

type EmployeeResource = {
  id: string;
  category: "Work" | "Payroll" | "Benefits";
  title: string;
  provider: string;
  description: string;
  url: string;
  action: string;
  icon: string;
  fixedProvider?: boolean;
};

type ResourcePayload = {
  resources?: Array<Partial<EmployeeResource>>;
};

const RESOURCE_RECORD_ID = "EMPLOYEE-EXPERIENCE-RESOURCES";

const DEFAULT_RESOURCES: EmployeeResource[] = [
  { id: "work-email", category: "Work", title: "Work Email", provider: "Microsoft Outlook", description: "Open your Mefford email inbox.", url: "https://outlook.office.com/mail/", action: "Open Email", icon: "@", fixedProvider: true },
  { id: "work-calendar", category: "Work", title: "Work Calendar", provider: "Microsoft Outlook", description: "See company meetings, project events, and your schedule.", url: "https://outlook.office.com/calendar/", action: "Open Calendar", icon: "CAL", fixedProvider: true },
  { id: "work-teams", category: "Work", title: "Microsoft Teams", provider: "Microsoft 365", description: "Open company chat, calls, and meetings.", url: "https://teams.microsoft.com/", action: "Open Teams", icon: "TM", fixedProvider: true },
  { id: "payroll", category: "Payroll", title: "Pay And Tax Information", provider: "Paylocity", description: "Check paystubs, tax documents, and your Paylocity account.", url: "https://access.paylocity.com/", action: "Open Paylocity", icon: "$", fixedProvider: true },
  { id: "health", category: "Benefits", title: "Health Insurance", provider: "UnitedHealthcare", description: "Open your member account, coverage, claims, and insurance cards.", url: "https://member.uhc.com/", action: "Open UnitedHealthcare", icon: "+", fixedProvider: true },
  { id: "dental", category: "Benefits", title: "Dental Insurance", provider: "Dental Carrier To Be Assigned", description: "Your dental plan, member account, and coverage information.", url: "", action: "Open Dental Plan", icon: "D" },
  { id: "vision", category: "Benefits", title: "Vision Insurance", provider: "Vision Carrier To Be Assigned", description: "Your vision plan, member account, and coverage information.", url: "", action: "Open Vision Plan", icon: "V" },
  { id: "life", category: "Benefits", title: "Life Insurance", provider: "Northwestern Mutual", description: "Open the life-insurance provider account and policy information.", url: "https://www.northwesternmutual.com/log-in/", action: "Open Northwestern Mutual", icon: "L", fixedProvider: true },
  { id: "retirement", category: "Benefits", title: "Retirement Account", provider: "Edward Jones", description: "Open your retirement account and plan information. Company Administration handles plan requests.", url: "https://www.edwardjones.com/us-en/client-login", action: "Open Edward Jones", icon: "401", fixedProvider: true },
];

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  try {
    const db = await employeeResourceDatabase();
    await ensureProjectFileSchema();
    const [storedRows, memberRows, reviewRows, benefitFileRows] = await Promise.all([
      db.select({ dataJson: commandRecords.dataJson, updatedAt: commandRecords.updatedAt }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, RESOURCE_RECORD_ID))).limit(1),
      db.select({ email: companyMembers.email, level: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson }).from(companyMembers).where(eq(companyMembers.isActive, true)),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, REVIEW_PROJECT_ID), eq(commandRecords.recordType, TEMPLATE_REVIEW_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
      db.select().from(projectFiles).where(eq(projectFiles.projectId, REVIEW_PROJECT_ID)).orderBy(desc(projectFiles.id)),
    ]);
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
    const member = memberRows.find((item) => item.email === actor.email);
    const manageCategories = managedResourceCategories(actor.accessLevel, member?.level, parseStringArray(member?.designationsJson || "[]"));
    const stored = parseData(storedRows[0]?.dataJson || "{}");
    const savedResources = Array.isArray(stored.resources) ? stored.resources as Array<Partial<EmployeeResource>> : [];
    const savedById = new Map(savedResources.map((resource) => [resource.id, resource]));
    const resources = DEFAULT_RESOURCES.map((resource) => sanitizeResource({ ...resource, ...(savedById.get(resource.id) || {}), id: resource.id, category: resource.category, title: resource.title, action: resource.action, icon: resource.icon }));
    const benefitDocuments = TEMPLATE_REVIEW_CATALOG.filter((template) => template.area === "Benefits").flatMap((template) => {
      const currentFile = benefitFileRows.find((file) => file.category === reviewFileCategory(template.id));
      if (!currentFile) return [];
      const approval = reviewRows.find((row) => {
        const review = parseData(row.dataJson);
        return row.status === "Owner Signed Off"
          && String(review.templateId || "") === template.id
          && String(review.version || "") === currentFile.revision
          && row.updatedAt >= currentFile.createdAt;
      });
      if (!approval) return [];
      const review = parseData(approval.dataJson);
      return [{ id: currentFile.id, title: template.name, name: currentFile.name, revision: currentFile.revision, date: String(review.reviewDate || currentFile.createdAt.slice(0, 10)) }];
    });
    return Response.json({
      canManage: manageCategories.length > 0,
      manageCategories,
      resources,
      benefitDocuments,
      updatedAt: String(stored.updatedAt || storedRows[0]?.updatedAt || ""),
      updatedBy: String(stored.updatedBy || "Company Administration"),
      boundaries: {
        payroll: "Paylocity opens only for employee self-service. Command Center does not run or transmit payroll.",
        benefits: "Provider links open the employee's provider account. Enrollment and coverage remain governed by the actual plan documents.",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Employee Resources Are Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  try {
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
    const db = await employeeResourceDatabase();
    const manageCategories = await managedResourceCategoriesForActor(db, actor.email, actor.accessLevel);
    if (!manageCategories.length) return Response.json({ error: "Owner Administrator Human Resources Or Benefits Administrator Access Is Required" }, { status: 403 });
    const payload = await request.json() as ResourcePayload;
    const incomingById = new Map((payload.resources || []).map((resource) => [String(resource.id || ""), resource]));
    const storedRows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, RESOURCE_RECORD_ID))).limit(1);
    const stored = parseData(storedRows[0]?.dataJson || "{}");
    const savedResources = Array.isArray(stored.resources) ? stored.resources as Array<Partial<EmployeeResource>> : [];
    const savedById = new Map(savedResources.map((resource) => [String(resource.id || ""), resource]));
    const resources = DEFAULT_RESOURCES.map((resource) => {
      const incoming = manageCategories.includes(resource.category)
        ? incomingById.get(resource.id) || {}
        : savedById.get(resource.id) || {};
      return sanitizeResource({ ...resource, ...incoming, id: resource.id, category: resource.category, title: resource.title, action: resource.action, icon: resource.icon });
    });
    const invalidUrl = resources.find((resource) => resource.url && !isApprovedUrl(resource.url));
    if (invalidUrl) return Response.json({ error: `${invalidUrl.title} Must Use A Secure HTTPS Link` }, { status: 400 });
    const now = new Date().toISOString();
    const data = { resources, updatedAt: now, updatedBy: actor.name, updatedByEmail: actor.email };
    await Promise.all([
      db.insert(commandRecords).values({
        projectId: PEOPLE_PROJECT_ID,
        id: RESOURCE_RECORD_ID,
        recordType: "Employee Experience Settings",
        title: "Mefford Employee Resource Hub",
        owner: actor.name,
        due: "",
        status: resources.every((resource) => Boolean(resource.url)) ? "Complete" : "Setup Required",
        meta: `${resources.filter((resource) => Boolean(resource.url)).length} Of ${resources.length} Links Ready`,
        recordDate: now.slice(0, 10),
        dateLocked: true,
        dataJson: JSON.stringify(data),
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [commandRecords.projectId, commandRecords.id],
        set: { owner: actor.name, status: resources.every((resource) => Boolean(resource.url)) ? "Complete" : "Setup Required", meta: `${resources.filter((resource) => Boolean(resource.url)).length} Of ${resources.length} Links Ready`, dataJson: JSON.stringify(data), updatedAt: now },
      }),
      db.insert(recordAudits).values({ projectId: PEOPLE_PROJECT_ID, recordId: RESOURCE_RECORD_ID, fieldName: "Employee Resource Hub", oldValue: "Prior Configuration Preserved", newValue: "Employee Links Updated", reason: `${resources.filter((resource) => Boolean(resource.url)).length} employee resource links are ready`, actorName: actor.name, actorEmail: actor.email, summary: `${actor.name} updated the Mefford employee resource hub` }),
    ]);
    return Response.json({ saved: true, canManage: true, manageCategories, resources, updatedAt: now, updatedBy: actor.name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Employee Resources Could Not Be Saved" }, { status: 500 });
  }
}

function sanitizeResource(resource: Partial<EmployeeResource>): EmployeeResource {
  return {
    id: String(resource.id || "").slice(0, 40),
    category: resource.category === "Work" || resource.category === "Payroll" ? resource.category : "Benefits",
    title: String(resource.title || "Employee Resource").slice(0, 80),
    provider: String(resource.provider || "Company Plan").trim().slice(0, 100),
    description: String(resource.description || "").trim().slice(0, 240),
    url: String(resource.url || "").trim().slice(0, 600),
    action: String(resource.action || "Open Resource").slice(0, 60),
    icon: String(resource.icon || "↗").slice(0, 4),
    fixedProvider: Boolean(resource.fixedProvider),
  };
}

function isApprovedUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function managedResourceCategories(actorLevel: string, memberLevel: string | undefined, designations: string[]): EmployeeResource["category"][] {
  if (["Company Owner", "Administrator"].includes(actorLevel) || ["Company Owner", "Administrator"].includes(memberLevel || "")) return ["Work", "Payroll", "Benefits"];
  return designations.some((designation) => ["Human Resources", "Benefits Administrator"].includes(designation)) ? ["Benefits"] : [];
}

async function managedResourceCategoriesForActor(db: Awaited<ReturnType<typeof employeeResourceDatabase>>, email: string, accessLevel: string) {
  const rows = await db.select({ level: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson }).from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
  return managedResourceCategories(accessLevel, rows[0]?.level, parseStringArray(rows[0]?.designationsJson || "[]"));
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function employeeResourceDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (project_id text NOT NULL, id text NOT NULL, record_type text NOT NULL, title text NOT NULL, owner text NOT NULL, due text NOT NULL, status text NOT NULL, meta text DEFAULT '' NOT NULL, record_date text, record_time text, date_locked integer DEFAULT false NOT NULL, data_json text DEFAULT '{}' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY(project_id, id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (email text PRIMARY KEY NOT NULL, display_name text NOT NULL, company_access_level text NOT NULL, designations_json text DEFAULT '[]' NOT NULL, is_active integer DEFAULT true NOT NULL, identity_provider text DEFAULT 'microsoft_entra_pending' NOT NULL, provider_subject text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS record_audits (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, project_id text NOT NULL, record_id text NOT NULL, field_name text NOT NULL, old_value text NOT NULL, new_value text NOT NULL, reason text NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL, summary text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
  ]);
  const { getDb } = await import("../../../db");
  return getDb();
}
