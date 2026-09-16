import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles, projects, proposalProfiles, proposalProjectExperience } from "../db/schema";
import { PROJECT_TEAM_ASSIGNMENT_TYPE, normalizeDesignations, parseRecordData, parseStringArray } from "./team-access";
import type { ProposalExperienceSnapshot, ProposalTeamMember } from "./proposals";
import { isPhotoUpload } from "./photo-uploads";

type Db = ReturnType<(typeof import("../db"))["getDb"]>;
type Project = typeof projects.$inferSelect;

export type ProposalProfileInput = {
  displayName?: unknown; companyTitle?: unknown; proposalRoleLabel?: unknown; professionalSummary?: unknown;
  credentials?: unknown; sectors?: unknown; deliveryMethods?: unknown; priorExperience?: unknown;
  headshotFileId?: unknown; leadershipProfile?: unknown; includeByDefault?: unknown;
};

export function customerCompanyKey(value: unknown) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "customer";
}

export function sanitizeProposalProfile(value: ProposalProfileInput, employeeEmail: string, fallbackName: string) {
  return {
    employeeEmail: clean(employeeEmail, 200).toLowerCase(), displayName: clean(value.displayName || fallbackName, 120),
    companyTitle: clean(value.companyTitle, 120), proposalRoleLabel: clean(value.proposalRoleLabel, 120),
    professionalSummary: clean(value.professionalSummary, 2_500), credentialsJson: JSON.stringify(list(value.credentials, 16, 160)),
    sectorsJson: JSON.stringify(list(value.sectors, 16, 120)), deliveryMethodsJson: JSON.stringify(list(value.deliveryMethods, 12, 120)),
    priorExperienceJson: JSON.stringify(list(value.priorExperience, 20, 500)), headshotFileId: fileId(value.headshotFileId) || null,
    leadershipProfile: value.leadershipProfile === true, includeByDefault: value.includeByDefault === true,
  };
}

export async function proposalTeamOptions(db: Db) {
  const [members, profiles, experience] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(proposalProfiles),
    db.select().from(proposalProjectExperience).where(and(eq(proposalProjectExperience.status, "Approved"), eq(proposalProjectExperience.customerPermission, "Approved"))),
  ]);
  const profileByEmail = new Map(profiles.map((profile) => [profile.employeeEmail.toLowerCase(), profile]));
  return members.map((member) => {
    const profile = profileByEmail.get(member.email.toLowerCase());
    const approved = profile?.status === "Approved";
    return {
      employeeEmail: member.email, displayName: profile?.displayName || member.displayName,
      companyTitle: approved ? profile.companyTitle : "", proposalRoleLabel: approved ? profile.proposalRoleLabel : "",
      professionalSummary: approved ? profile.professionalSummary : "", credentials: approved ? parseStringArray(profile.credentialsJson) : [],
      sectors: approved ? parseStringArray(profile.sectorsJson) : [], deliveryMethods: approved ? parseStringArray(profile.deliveryMethodsJson) : [],
      priorExperience: approved ? parseStringArray(profile.priorExperienceJson) : [], headshotFileId: approved ? Number(profile.headshotFileId || 0) : 0,
      leadershipProfile: approved ? profile.leadershipProfile : member.companyAccessLevel === "Company Owner",
      includeByDefault: approved ? profile.includeByDefault : member.companyAccessLevel === "Company Owner",
      profileStatus: profile?.status || "Not Started", designations: normalizeDesignations(parseStringArray(member.designationsJson)),
      experience: approved ? experience.filter((item) => item.employeeEmail.toLowerCase() === member.email.toLowerCase()).map(experienceSnapshot) : [],
    };
  });
}

export async function hydrateApprovedProposalTeam(db: Db, requested: ProposalTeamMember[]) {
  const options = await proposalTeamOptions(db);
  const requestedByEmail = new Map(requested.map((member) => [member.employeeEmail.toLowerCase(), member]));
  return options.flatMap((option): ProposalTeamMember[] => {
    const requestedMember = requestedByEmail.get(option.employeeEmail.toLowerCase());
    const includeInProposal = requestedMember?.includeInProposal === true || option.includeByDefault;
    if (!includeInProposal || option.profileStatus !== "Approved") return [];
    const chosenExperienceIds = new Set((requestedMember?.experience || []).map((item) => item.id));
    const chosenExperience = chosenExperienceIds.size ? option.experience.filter((item) => chosenExperienceIds.has(item.id)) : option.experience.slice(0, 3);
    return [{ employeeEmail: option.employeeEmail, displayName: option.displayName, companyTitle: option.companyTitle,
      proposalRoleLabel: requestedMember?.proposalRoleLabel || option.proposalRoleLabel || option.companyTitle,
      professionalSummary: option.professionalSummary, credentials: option.credentials, priorExperience: option.priorExperience,
      headshotFileId: option.headshotFileId, leadershipProfile: option.leadershipProfile, includeInProposal: true, experience: chosenExperience }];
  });
}

export async function seedProposalExperienceAtCloseout(db: Db, project: Project) {
  const [members, assignments, photos] = await Promise.all([
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))),
    db.select({ id: projectFiles.id, name: projectFiles.name, category: projectFiles.category, contentType: projectFiles.contentType }).from(projectFiles).where(eq(projectFiles.projectId, project.number)),
  ]);
  const roleByEmail = new Map<string, Set<string>>();
  const addRole = (email: string, role: string) => { if (!email || !role) return; const current = roleByEmail.get(email) || new Set<string>(); current.add(role); roleByEmail.set(email, current); };
  for (const member of members) { if (member.displayName === project.projectManager) addRole(member.email, "Project Manager"); if (member.displayName === project.superintendent) addRole(member.email, "Superintendent"); }
  for (const assignment of assignments) { const data = parseRecordData(assignment.dataJson); const email = String(data.employeeEmail || assignment.id.replace(/^PROJECT-TEAM-/, "")).toLowerCase(); for (const role of normalizeDesignations(data.projectDesignations)) addRole(email, role); }
  const candidatePhotoFileIds = photos.filter((file) => isPhotoUpload({ name: file.name, type: file.contentType }) && /photo|field|closeout|progress/i.test(file.category)).map((file) => file.id).slice(0, 30);
  const now = new Date().toISOString(); let created = 0;
  for (const [employeeEmail, roles] of roleByEmail) for (const role of roles) {
    const id = `PX-${project.number}-${customerCompanyKey(employeeEmail)}-${customerCompanyKey(role)}`.slice(0, 220);
    const result = await db.insert(proposalProjectExperience).values({ id, projectId: project.number, employeeEmail, role, projectName: project.name,
      projectLocation: project.site, projectType: project.projectType, deliveryMethod: project.ownerContractType,
      completionDate: project.finalDate || project.substantialDate, summary: "", metricsJson: JSON.stringify({ candidatePhotoFileIds }),
      photoFileIdsJson: "[]", source: "Project Closeout Assignment", customerPermission: "Review Required", status: "Draft", updatedAt: now }).onConflictDoNothing();
    if (Number(result.meta.changes || 0) > 0) created += 1;
  }
  return { created, candidatePhotoFileIds };
}

function experienceSnapshot(value: typeof proposalProjectExperience.$inferSelect): ProposalExperienceSnapshot {
  return { id: value.id, projectId: value.projectId, projectName: value.projectName, projectLocation: value.projectLocation, role: value.role,
    projectType: value.projectType, completionDate: value.completionDate, summary: value.summary,
    photoFileIds: parseStringArray(value.photoFileIdsJson).map(Number).filter((item) => Number.isInteger(item) && item > 0) };
}
function list(value: unknown, maxItems: number, maxLength: number) { const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/); return [...new Set(source.map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems); }
function clean(value: unknown, maxLength: number) { return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength); }
function fileId(value: unknown) { const parsed = Number(value || 0); return Number.isInteger(parsed) && parsed > 0 ? parsed : 0; }
