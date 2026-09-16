import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers } from "../../../db/schema";
import { resolveCommandActor } from "../../../lib/server-actor";
import {
  PROJECT_TEAM_ASSIGNMENT_TYPE,
  normalizeDesignations,
  parseRecordData,
  projectTeamAssignmentId,
} from "../../../lib/team-access";
import { PEOPLE_PROJECT_ID, employeeRecordId, onboardingAccessForActor } from "../../../lib/onboarding";
import { microsoftAccessGateForActor } from "../../../lib/microsoft-access-server";
import { MEFFORD_COMPANY_DIRECTORY } from "../../company-directory";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
  let accessLevel = actor.accessLevel;
  let designations: string[] = [];
  let onboarding = {
    permissionLocked: true,
    status: "Employee Access Verification Required",
    progress: 0,
    deadline: "",
  };
  let microsoftAccess = {
    allowed: false,
    status: "Verification Required",
    enforced: false,
    microsoftEmail: actor.email,
    providerSubject: "",
  };
  try {
    await ensureSessionTables();
    const { getDb } = await import("../../../db");
    await Promise.all(MEFFORD_COMPANY_DIRECTORY.flatMap((directoryMember) => [
      getDb().insert(companyMembers).values({
        email: directoryMember.email,
        displayName: directoryMember.name,
        companyAccessLevel: directoryMember.accessLevel,
        designationsJson: JSON.stringify(directoryMember.defaultDesignations),
        isActive: true,
        identityProvider: "microsoft_entra_pending",
      }).onConflictDoNothing(),
      getDb().insert(commandRecords).values({
        projectId: PEOPLE_PROJECT_ID,
        id: employeeRecordId(directoryMember.email),
        recordType: "Employee Onboarding",
        title: `${directoryMember.name} Employee Lifecycle`,
        owner: directoryMember.name,
        due: new Date().toISOString().slice(0, 10),
        status: "Hire Date Required",
        meta: `${directoryMember.accessLevel} · Existing Employee`,
        recordDate: new Date().toISOString().slice(0, 10),
        dataJson: JSON.stringify({
          email: directoryMember.email,
          name: directoryMember.name,
          hireDate: "",
          birthDate: "",
          position: directoryMember.defaultDesignations[0] || "Company Leadership",
          department: directoryMember.defaultDesignations.includes("Superintendent") ? "Field" : "Office",
          supervisor: "Company Leadership",
          workLocation: "Mefford Company Operations",
          checklistOwner: "Company Administration",
          accessLevel: directoryMember.accessLevel,
          designations: directoryMember.defaultDesignations,
          lifecycleStatus: "Active",
          grandfathered: true,
          initialActivatedAt: new Date().toISOString(),
          completions: {},
        }),
      }).onConflictDoNothing(),
    ]));
    const member = await getDb()
      .select({
        accessLevel: companyMembers.companyAccessLevel,
        designationsJson: companyMembers.designationsJson,
      })
      .from(companyMembers)
      .where(eq(companyMembers.email, actor.email))
      .limit(1);
    if (member[0]?.accessLevel === "Administrator") {
      accessLevel = "Administrator";
    } else if (member[0]?.accessLevel === "Company Owner") {
      accessLevel = "Company Owner";
    }
    designations = parseDesignations(member[0]?.designationsJson);
    if (projectId && member[0]) {
      const assignment = await getDb()
        .select({ dataJson: commandRecords.dataJson })
        .from(commandRecords)
        .where(and(
          eq(commandRecords.projectId, projectId),
          eq(commandRecords.id, projectTeamAssignmentId(actor.email)),
          eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE),
        ))
        .limit(1);
      if (assignment[0]) {
        designations = normalizeDesignations(
          parseRecordData(assignment[0].dataJson).projectDesignations,
        );
      }
    }
    onboarding = await onboardingAccessForActor({ ...actor, accessLevel });
    microsoftAccess = {
      ...microsoftAccess,
      ...await microsoftAccessGateForActor({ ...actor, accessLevel }),
    };
    if (!microsoftAccess.allowed) {
      onboarding = {
        permissionLocked: true,
        status: microsoftAccess.status,
        progress: 0,
        deadline: "",
      };
    }
    if (onboarding.permissionLocked) designations = [];
  } catch {
    return Response.json(
      {
        error: "Employee Access Status Could Not Be Verified. Company Permissions Remain Locked.",
      },
      { status: 503 },
    );
  }
  return Response.json({
    actor: {
      ...actor,
      accessLevel,
      designations,
      projectId,
      permissionLocked: onboarding.permissionLocked,
      onboardingStatus: onboarding.status,
      onboardingProgress: onboarding.progress,
      onboardingDeadline: onboarding.deadline,
    },
    storage: {
      database: "active",
      projectFiles: "active",
    },
    microsoft: {
      status: microsoftAccess.status,
      accessAllowed: microsoftAccess.allowed,
      accessControlEnforced: microsoftAccess.enforced,
      microsoftEmail: microsoftAccess.microsoftEmail,
      domain: "meffcon.com",
      requirement: "Microsoft Entra tenant connection and administrator consent",
    },
  });
}

async function ensureSessionTables() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (
      email text PRIMARY KEY NOT NULL,
      display_name text NOT NULL,
      company_access_level text NOT NULL,
      designations_json text DEFAULT '[]' NOT NULL,
      is_active integer DEFAULT true NOT NULL,
      identity_provider text DEFAULT 'microsoft_entra_pending' NOT NULL,
      provider_subject text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (
      project_id text NOT NULL,
      id text NOT NULL,
      record_type text NOT NULL,
      title text NOT NULL,
      owner text NOT NULL,
      due text NOT NULL,
      status text NOT NULL,
      meta text DEFAULT '' NOT NULL,
      record_date text,
      record_time text,
      date_locked integer DEFAULT false NOT NULL,
      data_json text DEFAULT '{}' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY(project_id, id)
    )`),
  ]);
}

function parseDesignations(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
