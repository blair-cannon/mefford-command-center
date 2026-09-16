import { and, eq } from "drizzle-orm";
import type { getDb } from "../db";
import { commandRecords, companyMembers, projects } from "../db/schema";
import type { CommandActor } from "./server-actor";
import { normalizeDesignations, parseRecordData, parseStringArray, PROJECT_TEAM_ASSIGNMENT_TYPE, projectTeamAssignmentId } from "./team-access";

type Db = ReturnType<typeof getDb>;
type Project = Pick<typeof projects.$inferSelect, "number" | "projectManager" | "superintendent">;
const sameName = (left: string, right: string) => Boolean(left.trim()) && left.trim().toLowerCase() === right.trim().toLowerCase();

export function resolveProjectDesignations(name: string, project: Project, defaults: string[], assigned: string[] | null) {
  const roles = assigned ? [...assigned] : defaults.filter(role => !["Project Manager", "Superintendent"].includes(role));
  if (sameName(name, project.projectManager)) roles.push("Project Manager");
  if (sameName(name, project.superintendent)) roles.push("Superintendent");
  return [...new Set(roles)];
}

// Company PM/superintendent qualifications do not assign someone to every job.
// Primary assignments and explicit project-team assignments are both authoritative.
export async function projectDesignationsFor(db: Db, actor: Pick<CommandActor, "email" | "name">, project: Project, defaults: string[]) {
  const assignment = (await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, project.number), eq(commandRecords.id, projectTeamAssignmentId(actor.email)),
    eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE),
  )).limit(1))[0];
  return resolveProjectDesignations(actor.name, project, defaults,
    assignment ? normalizeDesignations(parseRecordData(assignment.dataJson).projectDesignations) : null);
}

export async function canReadProject(db: Db, actor: CommandActor, project: Project) {
  if (!actor.authenticated) return false;
  if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0];
  if (!member?.isActive) return false;
  const roles = await projectDesignationsFor(db, actor, project, parseStringArray(member.designationsJson));
  return roles.some(role => ["Project Manager", "Superintendent", "Sales Representative", "Sales Manager", "Estimator", "Estimating Manager", "Accountant", "Accounting Manager", "Financial Administrator", "Office Staff", "Safety Director", "Safety"].includes(role));
}

export async function canReadProjectId(db: Db, actor: CommandActor, projectId: string) {
  const project = (await db.select({ number: projects.number, projectManager: projects.projectManager, superintendent: projects.superintendent }).from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  return Boolean(project && await canReadProject(db, actor, project));
}
