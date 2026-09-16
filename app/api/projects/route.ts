import { canReadProject } from "../../../lib/project-access";
import { desc, eq, like } from "drizzle-orm";
import { companyMembers, projects } from "../../../db/schema";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { normalizeOwnerContractType, type OwnerContractType } from "../../../lib/owner-contracts";
import { activateOwnerContractWorkflow } from "../../../lib/owner-contract-activation";
import { loadSalesContracts } from "../../../lib/sales-contract-server";

type ProjectPayload = {
  mode?: "create" | "edit";
  project?: {
    name?: string;
    number?: string;
    status?: string;
    site?: string;
    ownerName?: string;
    ownerContractDate?: string;
    ownerContractType?: OwnerContractType;
    ownerContractStatus?: string;
    ownerContractRecordId?: string;
    paymentTerms?: string;
    retainageInitialPercent?: string;
    retainageAfterHalfPercent?: string;
    architect?: string;
    projectType?: string;
    contractAmount?: string;
    currentContractAmount?: string;
    startDate?: string;
    substantialDate?: string;
    finalDate?: string;
    timeZone?: string;
    latitude?: number | null;
    longitude?: number | null;
    projectManager?: string;
    superintendent?: string;
    cameraCount?: number;
  };
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureProjectsTable();
    const { getDb } = await import("../../../db");
    const db = getDb();
    const rows = (await db.select().from(projects).orderBy(desc(projects.number)))
      .filter((project) => project.status !== "Deletion Quarantine");
    const member = actor.email ? await db.select({
      accessLevel: companyMembers.companyAccessLevel,
      designationsJson: companyMembers.designationsJson,
    }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
    const accessLevel = member[0]?.accessLevel || actor.accessLevel;
    const designations = parseDesignations(member[0]?.designationsJson);
    const departmentWide = designations.some((designation) => ["Sales Representative", "Estimator", "Accountant", "Financial Administrator"].includes(designation));
    const visibility = await Promise.all(rows.map(project => canReadProject(db, actor, project)));
    const visibleRows = rows.filter((_, index) => visibility[index]);
    const { env } = await import("cloudflare:workers");
    const contracts = await loadSalesContracts(env.DB, visibleRows.map(project => project.number));
    return Response.json({
      projects: visibleRows.map(project => ({ ...toClientProject(contracts.has(project.number) && (project.currentContractAmount || project.contractAmount)
        ? { ...project, currentContractAmount: contracts.get(project.number)!.contractValue.toFixed(2) } : project),
        contractAuthorized: contracts.get(project.number)?.signed === true,
      })),
      visibility: departmentWide ? "Department Wide" : ["Company Owner", "Administrator"].includes(accessLevel) ? "Company Wide" : "Assigned Projects Only",
    });
  } catch {
    return Response.json(
      { error: "Command Center could not load the project list." },
      { status: 500 },
    );
  }
}

function parseDesignations(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const payload = (await request.json()) as ProjectPayload;
    const draft = payload.project;
    if (!draft || !completeProject(draft)) {
      return Response.json(
        { error: "Complete project information is required." },
        { status: 400 },
      );
    }
    await ensureProjectsTable();
    const { getDb } = await import("../../../db");
    const db = getDb();
    const managementAccess = await projectManagementAccess(db, actor);
    if (!managementAccess.canManageAll && !managementAccess.isProjectManager) {
      return Response.json(
        { error: "Project Manager Administrator Or Company Owner access is required." },
        { status: 403 },
      );
    }

    const mode = payload.mode === "edit" ? "edit" : "create";
    const number =
      mode === "edit" ? String(draft.number || "").trim() : await nextProjectNumber(db);
    if (!number) {
      return Response.json({ error: "Project number is required." }, { status: 400 });
    }
    if (mode === "create" && !managementAccess.canManageAll && !samePerson(draft.projectManager, actor.name)) {
      return Response.json(
        { error: "Project Managers Can Only Create Projects Where They Are The Primary Project Manager." },
        { status: 403 },
      );
    }
    if (mode === "edit") {
      const existing = await db
        .select({ number: projects.number, projectManager: projects.projectManager })
        .from(projects)
        .where(eq(projects.number, number))
        .limit(1);
      if (!existing.length) {
        return Response.json({ error: "Project not found." }, { status: 404 });
      }
      if (!managementAccess.canManageAll && !samePerson(existing[0].projectManager, actor.name)) {
        return Response.json(
          { error: "This Project Is Restricted To Its Primary Project Manager Administrator Or Company Owner." },
          { status: 403 },
        );
      }
    }

    const contractRecordId = draft.ownerContractRecordId?.trim() || `OWNER-CONTRACT-${number}`;
    const ownerContractType = normalizeOwnerContractType(draft.ownerContractType) || "Plan & Spec Lump Sum";
    const values = {
      number,
      name: draft.name!.trim(),
      status: draft.status!.trim(),
      site: draft.site!.trim(),
      ownerName: draft.ownerName!.trim(),
      ownerContractDate: draft.ownerContractDate!,
      ownerContractType,
      ownerContractStatus: draft.ownerContractStatus?.trim() || "Draft",
      ownerContractRecordId: contractRecordId,
      paymentTerms: draft.paymentTerms?.trim() || "",
      retainageInitialPercent: draft.retainageInitialPercent?.trim() || "10",
      retainageAfterHalfPercent: draft.retainageAfterHalfPercent?.trim() || "5",
      architect: draft.architect?.trim() || "",
      projectType: draft.projectType!.trim(),
      contractAmount: draft.contractAmount?.trim() || "",
      currentContractAmount:
        draft.currentContractAmount?.trim() || draft.contractAmount?.trim() || "",
      startDate: draft.startDate!,
      substantialDate: draft.substantialDate!,
      finalDate: draft.finalDate!,
      timeZone: draft.timeZone || "America/New_York",
      latitude:
        draft.latitude === null || draft.latitude === undefined
          ? null
          : Math.round(draft.latitude * 1_000_000),
      longitude:
        draft.longitude === null || draft.longitude === undefined
          ? null
          : Math.round(draft.longitude * 1_000_000),
      projectManager: draft.projectManager!.trim(),
      superintendent: draft.superintendent!.trim(),
      cameraCount: Math.min(16, Math.max(0, Number(draft.cameraCount) || 0)),
      updatedAt: new Date().toISOString(),
    };

    if (mode === "create") {
      await db.insert(projects).values(values);
      try {
        const { env } = await import("cloudflare:workers");
        await activateOwnerContractWorkflow(env.DB, {
          number,
          name: values.name,
          site: values.site,
          ownerName: values.ownerName,
          ownerContractDate: values.ownerContractDate,
          architect: values.architect,
          projectType: values.projectType,
          contractAmount: values.contractAmount,
          startDate: values.startDate,
          substantialDate: values.substantialDate,
          finalDate: values.finalDate,
          projectManager: values.projectManager,
          superintendent: values.superintendent,
          ownerContractType,
          paymentTerms: values.paymentTerms,
          retainageInitialPercent: values.retainageInitialPercent,
          retainageAfterHalfPercent: values.retainageAfterHalfPercent,
        }, { name: actor.name, email: actor.email });
      } catch (error) {
        await db.delete(projects).where(eq(projects.number, number));
        throw error;
      }
    } else {
      await db.update(projects).set(values).where(eq(projects.number, number));
    }
    const [saved] = await db
      .select()
      .from(projects)
      .where(eq(projects.number, number))
      .limit(1);
    let microsoftFileWorkspace: Awaited<ReturnType<(typeof import("../../../lib/sharepoint-storage"))["registerSharePointWorkspace"]>> | null = null;
    let microsoftFileWarning = "";
    try {
      const { registerSharePointWorkspace } = await import("../../../lib/sharepoint-storage");
      microsoftFileWorkspace = await registerSharePointWorkspace({
        entityType: "Project",
        entityId: saved.number,
        displayName: saved.name,
        sourceProjectId: saved.number,
        sourceRecordId: saved.number,
        actorName: actor.name,
        actorEmail: actor.email,
      });
    } catch (error) {
      microsoftFileWarning = error instanceof Error ? error.message : "Microsoft File Mapping Could Not Be Registered";
    }
    return Response.json({
      project: toClientProject(saved),
      contractWorkflow: mode === "create" ? { contractRecordId, portalStatus: "Dormant", revision: 1 } : null,
      microsoftFileWorkspace,
      microsoftFileWarning,
    }, { status: mode === "create" ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unique")) {
      return Response.json(
        { error: "That project number already exists. Command Center blocked the duplicate." },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          new URL(request.url).hostname === "terminal.local" && message
            ? `Command Center could not save the project. ${message}`
            : "Command Center could not save the project.",
      },
      { status: 500 },
    );
  }
}

async function nextProjectNumber(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
) {
  const year = String(new Date().getUTCFullYear()).slice(-2);
  const rows = await db
    .select({ number: projects.number })
    .from(projects)
    .where(like(projects.number, `${year}-%`));
  const largest = rows.reduce((current, row) => {
    const match = row.number.match(new RegExp(`^${year}-(\\d{3})$`));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${year}-${String(largest + 1).padStart(3, "0")}`;
}

async function projectManagementAccess(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
) {
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) {
    return { canManageAll: true, isProjectManager: false };
  }
  const member = actor.email
    ? await db
        .select({
          accessLevel: companyMembers.companyAccessLevel,
          designationsJson: companyMembers.designationsJson,
        })
        .from(companyMembers)
        .where(eq(companyMembers.email, actor.email))
        .limit(1)
    : [];
  if (["Company Owner", "Administrator"].includes(member[0]?.accessLevel || "")) {
    return { canManageAll: true, isProjectManager: false };
  }
  try {
    const designations = JSON.parse(member[0]?.designationsJson || "[]") as unknown;
    return {
      canManageAll: false,
      isProjectManager: Array.isArray(designations) && designations.includes("Project Manager"),
    };
  } catch {
    return { canManageAll: false, isProjectManager: false };
  }
}

function samePerson(left?: string, right?: string) {
  return Boolean(left?.trim() && right?.trim() && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function completeProject(project: NonNullable<ProjectPayload["project"]>) {
  return Boolean(
    project.name?.trim() &&
      project.status?.trim() &&
      project.site?.trim() &&
      project.ownerName?.trim() &&
      project.ownerContractDate &&
      project.projectType?.trim() &&
      project.startDate &&
      project.substantialDate &&
      project.finalDate &&
      project.projectManager?.trim() &&
      project.superintendent?.trim(),
  );
}

function toClientProject(project: typeof projects.$inferSelect) {
  return {
    ...project,
    latitude: project.latitude === null ? null : project.latitude / 1_000_000,
    longitude: project.longitude === null ? null : project.longitude / 1_000_000,
  };
}

async function ensureProjectsTable() {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS projects (
    number text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    site text NOT NULL,
    owner_name text NOT NULL,
    owner_contract_date text NOT NULL,
    owner_contract_type text DEFAULT 'Plan & Spec Lump Sum' NOT NULL,
    owner_contract_status text DEFAULT 'Draft' NOT NULL,
    owner_contract_record_id text DEFAULT '' NOT NULL,
    payment_terms text DEFAULT '' NOT NULL,
    retainage_initial_percent text DEFAULT '10' NOT NULL,
    retainage_after_half_percent text DEFAULT '5' NOT NULL,
    architect text DEFAULT '' NOT NULL,
    project_type text NOT NULL,
    contract_amount text DEFAULT '' NOT NULL,
    current_contract_amount text DEFAULT '' NOT NULL,
    start_date text NOT NULL,
    substantial_date text NOT NULL,
    final_date text NOT NULL,
    time_zone text DEFAULT 'America/New_York' NOT NULL,
    latitude_millionths integer,
    longitude_millionths integer,
    project_manager text NOT NULL,
    superintendent text NOT NULL,
    camera_count integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  const columns = await env.DB.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["owner_contract_type", "TEXT NOT NULL DEFAULT 'Plan & Spec Lump Sum'"],
    ["owner_contract_status", "TEXT NOT NULL DEFAULT 'Draft'"],
    ["owner_contract_record_id", "TEXT NOT NULL DEFAULT ''"],
    ["payment_terms", "TEXT NOT NULL DEFAULT ''"],
    ["retainage_initial_percent", "TEXT NOT NULL DEFAULT '10'"],
    ["retainage_after_half_percent", "TEXT NOT NULL DEFAULT '5'"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) await env.DB.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`).run();
  }
}
