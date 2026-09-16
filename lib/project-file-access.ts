import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { companyMembers, projects } from "../db/schema";
import { canReadProjectId, projectDesignationsFor } from "./project-access";
import type { CommandActor } from "./server-actor";
import { parseStringArray } from "./team-access";

type FileScope = { projectId: string; category?: string; uploadedBy?: string; contentType?: string; access?: string };

export async function canReadFileScope(db: ReturnType<typeof getDb>, actor: CommandActor, file: FileScope) {
  if (!actor.authenticated) return false;
  const preconstructionFile = file.projectId.startsWith("ESTIMATE-") || file.projectId.startsWith("DESIGN-");
  const jobFile = !file.projectId.startsWith("MEFFORD-") && !preconstructionFile;
  if (jobFile && !(await canReadProjectId(db, actor, file.projectId))) return false;
  const member = (await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1))[0];
  const roles = parseStringArray(member?.designationsJson);
  if (jobFile) {
    if (["Company Owner", "Administrator"].includes(actor.accessLevel)) return true;
    const project = (await db.select().from(projects).where(eq(projects.number, file.projectId)).limit(1))[0];
    const projectRoles = await projectDesignationsFor(db, actor, project, roles);
    if (file.category === "Turnover Bonus Agreement") return projectRoles.some(role => ["Project Manager", "Superintendent", "Accountant", "Accounting Manager", "Financial Administrator"].includes(role));
    if (file.category?.startsWith("Incident")) return projectRoles.some(role => ["Project Manager", "Safety", "Safety Director"].includes(role));
    if (file.access === "Project Manager + Office") return projectRoles.some(role => ["Project Manager", "Office Staff", "Accountant", "Accounting Manager", "Financial Administrator"].includes(role));
    return true;
  }
  if (file.projectId === "MEFFORD-ACCOUNTING") return actor.accessLevel === "Company Owner" || roles.some(role => ["Accountant", "Financial Administrator", "Accounting Manager"].includes(role));
  if (file.projectId === "MEFFORD-PEOPLE") {
    if (!file.category) return true; // Listing still filters every returned file.
    if (file.category.startsWith("Proposal Headshots / ")) return actor.accessLevel === "Company Owner" || file.category.slice("Proposal Headshots / ".length).trim().toLowerCase() === actor.email;
    // Training videos are company resources. Personal employee evidence is not.
    if (file.category.startsWith("Employee Onboarding") && file.contentType?.startsWith("video/")) return true;
    return ["Company Owner", "Administrator"].includes(actor.accessLevel) || file.uploadedBy === actor.name;
  }
  if (preconstructionFile || file.projectId === "MEFFORD-BID-ARCHIVE") return ["Company Owner", "Administrator"].includes(actor.accessLevel) || roles.some(role => ["Estimator", "Estimating Manager", "Sales Representative", "Sales Manager", "Office Staff"].includes(role));
  if (file.projectId === "MEFFORD-SALES" && file.category?.startsWith("Sales Contacts /")) return ["Company Owner", "Administrator"].includes(actor.accessLevel) || roles.some(role => ["Estimator", "Estimating Manager", "Sales Representative", "Sales Manager", "Marketing"].includes(role));
  return true; // Controlled company collections apply their additional category rules.
}

export async function fileUploadScopeError(db: ReturnType<typeof getDb>, actor: CommandActor, file: FileScope) {
  if (file.category === "Turnover Bonus Agreement") return "Bonus agreements are generated and signed through the Operations turnover controls.";
  if (!(await canReadFileScope(db, actor, { ...file, uploadedBy: actor.name }))) return "Assigned Project Or Authorized Company File Access Is Required";
  if (file.projectId === "MEFFORD-REVIEW") return "Controlled Master Files Must Be Uploaded Through Review Center";
  if (file.projectId === "MEFFORD-PEOPLE" && file.category?.startsWith("Employee Onboarding") && !file.contentType?.startsWith("video/")) return "Scanned Or Uploaded Onboarding Documents Are Blocked. Use A Native Command Center Form.";
  return "";
}
