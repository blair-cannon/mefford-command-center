import { and, desc, eq } from "drizzle-orm";
import {
  commandNotifications,
  companyMembers,
  employeeFeedback,
  employeeLeaveBalances,
  employeeLeaveRequests,
  employeeProfiles,
  employeeServiceRequests,
  proposalProfiles,
  proposalProjectExperience,
  recordAudits,
} from "../../../db/schema";
import { enforceOnboardingAccess, PEOPLE_PROJECT_ID } from "../../../lib/onboarding";
import { createEmployeeCalendarEvent } from "../../../lib/microsoft-graph";
import { resolveCommandActor } from "../../../lib/server-actor";
import { sanitizeProposalProfile } from "../../../lib/proposal-team";

const REQUEST_ROUTES: Record<string, { primary: string; secondary?: string; confidential?: boolean }> = {
  "IT Issue": { primary: "IT Administrator" },
  "Benefits Question": { primary: "Human Resources", confidential: true },
  "Clothing / Business Cards": { primary: "Marketing / Administrator" },
  "Vacation / Leave": { primary: "Company Owner / Administrator" },
  "Training Request": { primary: "Company Owner" },
  "Access / Permission": { primary: "Company Owner", secondary: "Administrator", confidential: true },
  "Payroll Question": { primary: "Accountant", confidential: true },
  "Equipment / Supplies": { primary: "Administrator" },
  "HR Concern": { primary: "Human Resources", confidential: true },
};

type LifecyclePayload = {
  action?: string;
  id?: string;
  category?: string;
  subject?: string;
  details?: string;
  priority?: string;
  resolution?: string;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  requestedHours?: number;
  note?: string;
  decision?: "Approved" | "Declined";
  decisionNote?: string;
  profile?: Record<string, unknown>;
  proposalProfile?: Record<string, unknown>;
  feedbackType?: string;
  recipientEmail?: string;
  rating?: number;
  anonymous?: boolean;
  employeeEmail?: string;
  planYear?: number;
  availableHours?: number;
  status?: string;
  customerPermission?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const db = await lifecycleDatabase();
    const members = await activeMembers(db);
    const actorMember = members.find((member) => member.email === actor.email);
    const roles = actorRoles(actor.accessLevel, actorMember);
    const canManage = roles.some((role) => ["Company Owner", "Administrator", "Human Resources"].includes(role));
    const ownerCanApproveProposals = roles.includes("Company Owner");
    const [requestRows, leaveRows, balanceRows, profileRows, feedbackRows, proposalProfileRows, proposalExperienceRows, proposalProfileQueue] = await Promise.all([
      db.select().from(employeeServiceRequests).orderBy(desc(employeeServiceRequests.createdAt)),
      db.select().from(employeeLeaveRequests).orderBy(desc(employeeLeaveRequests.createdAt)),
      db.select().from(employeeLeaveBalances).where(and(eq(employeeLeaveBalances.employeeEmail, actor.email), eq(employeeLeaveBalances.planYear, new Date().getFullYear()))).limit(1),
      db.select().from(employeeProfiles).where(eq(employeeProfiles.employeeEmail, actor.email)).limit(1),
      db.select().from(employeeFeedback).orderBy(desc(employeeFeedback.createdAt)).limit(100),
      db.select().from(proposalProfiles).where(eq(proposalProfiles.employeeEmail, actor.email)).limit(1),
      db.select().from(proposalProjectExperience).where(eq(proposalProjectExperience.employeeEmail, actor.email)).orderBy(desc(proposalProjectExperience.completionDate)),
      ownerCanApproveProposals ? db.select().from(proposalProfiles).orderBy(desc(proposalProfiles.updatedAt)) : Promise.resolve([]),
    ]);
    const myRequests = requestRows.filter((item) => item.employeeEmail === actor.email);
    const queue = requestRows.filter((item) => canReviewRequest(item, actor.email, roles));
    const myLeave = leaveRows.filter((item) => item.employeeEmail === actor.email);
    const leaveQueue = roles.some((role) => ["Company Owner", "Administrator"].includes(role)) ? leaveRows : [];
    const visibleFeedback = feedbackRows.filter((item) => {
      if (item.recipientEmail === actor.email) return true;
      if (item.employeeEmail === actor.email && item.employeeEmail) return true;
      if (item.confidential) return roles.includes("Human Resources") || roles.includes("Company Owner");
      return canManage;
    });
    return Response.json({
      myRequests,
      queue,
      myLeave,
      leaveQueue,
      balance: balanceRows[0] || null,
      profile: profileRows[0] || emptyProfile(actor.email),
      proposalProfile: proposalProfileRows[0] || emptyProposalProfile(actor.email, actor.name),
      proposalExperience: proposalExperienceRows,
      proposalProfileQueue,
      proposalExperienceQueue: ownerCanApproveProposals ? await db.select().from(proposalProjectExperience).orderBy(desc(proposalProjectExperience.updatedAt)) : [],
      canApproveProposalProfiles: ownerCanApproveProposals,
      feedback: visibleFeedback,
      canManage,
      roles,
      routes: Object.entries(REQUEST_ROUTES).map(([category, route]) => ({ category, ...route })),
      policies: {
        access: "Employees enter only after a Mefford company login is issued; onboarding approval controls full Command Center access.",
        balances: "A leave balance is shown only after Administration enters or connects the authoritative balance.",
        routing: "Every request follows the current live role assignment; employee names are never hard-coded.",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Employee Services Are Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const input = await request.json() as LifecyclePayload;
    const db = await lifecycleDatabase();
    const members = await activeMembers(db);
    const actorMember = members.find((member) => member.email === actor.email);
    const roles = actorRoles(actor.accessLevel, actorMember);
    const now = new Date().toISOString();

    if (input.action === "create_request") {
      const route = REQUEST_ROUTES[String(input.category || "")];
      const subject = clean(input.subject, 140);
      const details = clean(input.details, 4_000);
      if (!route || subject.length < 3 || details.length < 8) return Response.json({ error: "Choose A Request Type And Add A Clear Subject And Description" }, { status: 400 });
      const assignee = resolveAssignee(members, route.primary);
      const id = `EMP-REQ-${crypto.randomUUID()}`;
      await db.insert(employeeServiceRequests).values({
        id,
        employeeEmail: actor.email,
        employeeName: actor.name,
        category: String(input.category),
        subject,
        details,
        priority: ["Normal", "Urgent"].includes(String(input.priority)) ? String(input.priority) : "Normal",
        status: route.secondary ? "Pending Owner Approval" : "Open",
        routedRole: route.primary,
        assignedToEmail: assignee?.email || "",
        assignedToName: assignee?.name || "",
        secondaryApprovalRole: route.secondary || "",
        confidential: Boolean(route.confidential),
        dueAt: dueFromPriority(String(input.priority), now),
        createdAt: now,
        updatedAt: now,
      });
      await Promise.all([
        notify(db, assignee, "Employee Request", `${actor.name}: ${subject}`, `${input.category} was routed to your live role queue.`),
        audit(db, id, actor.name, actor.email, "Employee Request", "New", "Open", `${input.category} routed to ${route.primary}${route.secondary ? ` then ${route.secondary}` : ""}`),
      ]);
      return Response.json({ saved: true, id, notice: assignee ? `Request Sent To ${assignee.name}'s ${route.primary} Queue.` : `Request Saved In The ${route.primary} Queue. Administration Must Assign That Live Role.` }, { status: 201 });
    }

    if (input.action === "approve_request") {
      const rows = await db.select().from(employeeServiceRequests).where(eq(employeeServiceRequests.id, String(input.id || ""))).limit(1);
      const item = rows[0];
      if (!item) return Response.json({ error: "Employee Request Was Not Found" }, { status: 404 });
      const isPrimary = roleMatches(item.routedRole, roles);
      const isSecondary = Boolean(item.secondaryApprovalRole) && roleMatches(item.secondaryApprovalRole, roles);
      if (!isPrimary && !isSecondary) return Response.json({ error: "This Request Is Not Assigned To Your Current Role" }, { status: 403 });
      if (isPrimary && !item.primaryApprovedAt) {
        const status = item.secondaryApprovalRole ? "Pending Administrator Approval" : "Approved";
        await db.update(employeeServiceRequests).set({ primaryApprovedByEmail: actor.email, primaryApprovedByName: actor.name, primaryApprovedAt: now, status, updatedAt: now }).where(eq(employeeServiceRequests.id, item.id));
        await audit(db, item.id, actor.name, actor.email, "Employee Request Approval", item.status, status, `${item.routedRole} approval recorded`);
        return Response.json({ saved: true, notice: item.secondaryApprovalRole ? "First Approval Recorded. A Different Administrator Must Give The Second Approval." : "Request Approved." });
      }
      if (isSecondary && item.primaryApprovedAt) {
        if (item.primaryApprovedByEmail === actor.email) return Response.json({ error: "Access And Permission Requests Require Two Different Approvers" }, { status: 409 });
        await db.update(employeeServiceRequests).set({ secondaryApprovedByEmail: actor.email, secondaryApprovedByName: actor.name, secondaryApprovedAt: now, status: "Approved", updatedAt: now }).where(eq(employeeServiceRequests.id, item.id));
        await audit(db, item.id, actor.name, actor.email, "Employee Request Approval", item.status, "Approved", `${item.secondaryApprovalRole} second approval recorded`);
        return Response.json({ saved: true, notice: "Second Approval Recorded. The Request Is Approved." });
      }
      return Response.json({ error: "The Required Earlier Approval Has Not Been Recorded Yet" }, { status: 409 });
    }

    if (input.action === "close_request") {
      const rows = await db.select().from(employeeServiceRequests).where(eq(employeeServiceRequests.id, String(input.id || ""))).limit(1);
      const item = rows[0];
      if (!item) return Response.json({ error: "Employee Request Was Not Found" }, { status: 404 });
      if (!canReviewRequest(item, actor.email, roles)) return Response.json({ error: "This Request Is Not Assigned To Your Current Role" }, { status: 403 });
      const resolution = clean(input.resolution, 2_000);
      if (resolution.length < 5) return Response.json({ error: "Add A Short Resolution Before Closing The Request" }, { status: 400 });
      await db.update(employeeServiceRequests).set({ status: "Closed", resolution, updatedAt: now }).where(eq(employeeServiceRequests.id, item.id));
      await audit(db, item.id, actor.name, actor.email, "Employee Request", item.status, "Closed", resolution);
      return Response.json({ saved: true, notice: "Request Closed With A Permanent Resolution Record." });
    }

    if (input.action === "create_leave") {
      const startDate = dateOnly(input.startDate);
      const endDate = dateOnly(input.endDate);
      const requestedHours = Math.round(Number(input.requestedHours || 0));
      if (!startDate || !endDate || endDate < startDate || requestedHours < 1 || requestedHours > 400) return Response.json({ error: "Valid Start Date End Date And Requested Hours Are Required" }, { status: 400 });
      const id = `EMP-LEAVE-${crypto.randomUUID()}`;
      await db.insert(employeeLeaveRequests).values({ id, employeeEmail: actor.email, employeeName: actor.name, leaveType: clean(input.leaveType || "Vacation", 60), startDate, endDate, requestedHours, note: clean(input.note, 2_000), status: "Pending Review", createdAt: now, updatedAt: now });
      const approver = resolveAssignee(members, "Company Owner / Administrator");
      await Promise.all([
        notify(db, approver, "Leave Request", `${actor.name} Requested Time Off`, `${requestedHours} hours from ${startDate} through ${endDate}.`),
        audit(db, id, actor.name, actor.email, "Leave Request", "New", "Pending Review", `${requestedHours} hours from ${startDate} through ${endDate}`),
      ]);
      return Response.json({ saved: true, id, notice: "Time-Off Request Sent To The Owner / Administrator Queue." }, { status: 201 });
    }

    if (input.action === "decide_leave") {
      if (!roles.some((role) => ["Company Owner", "Administrator"].includes(role))) return Response.json({ error: "Owner Or Administrator Approval Is Required" }, { status: 403 });
      const rows = await db.select().from(employeeLeaveRequests).where(eq(employeeLeaveRequests.id, String(input.id || ""))).limit(1);
      const item = rows[0];
      if (!item) return Response.json({ error: "Leave Request Was Not Found" }, { status: 404 });
      if (item.status !== "Pending Review") return Response.json({ error: "This Leave Request Has Already Been Decided" }, { status: 409 });
      const decision = input.decision === "Approved" ? "Approved" : "Declined";
      let calendarEventId = "";
      let calendarWarning = "";
      if (decision === "Approved") {
        try {
          const event = await createEmployeeCalendarEvent(item.employeeEmail, { subject: `${item.employeeName} · ${item.leaveType}`, startAt: `${item.startDate}T00:00:00`, endAt: `${addDay(item.endDate)}T00:00:00`, timeZone: "America/New_York", bodyText: "Approved employee leave recorded by Mefford Command Center.", isAllDay: true });
          calendarEventId = event.id;
        } catch {
          calendarWarning = " Microsoft Calendar Sync Is Pending IT Connection Or Permission.";
        }
      }
      await db.update(employeeLeaveRequests).set({ status: decision, approverEmail: actor.email, approverName: actor.name, decidedAt: now, decisionNote: clean(input.decisionNote, 1_000), calendarEventId, updatedAt: now }).where(eq(employeeLeaveRequests.id, item.id));
      if (decision === "Approved") {
        const year = Number(item.startDate.slice(0, 4));
        const balanceRows = await db.select().from(employeeLeaveBalances).where(and(eq(employeeLeaveBalances.employeeEmail, item.employeeEmail), eq(employeeLeaveBalances.planYear, year))).limit(1);
        if (balanceRows[0]) await db.update(employeeLeaveBalances).set({ usedHours: balanceRows[0].usedHours + item.requestedHours, updatedByEmail: actor.email, updatedByName: actor.name, updatedAt: now }).where(and(eq(employeeLeaveBalances.employeeEmail, item.employeeEmail), eq(employeeLeaveBalances.planYear, year)));
      }
      await audit(db, item.id, actor.name, actor.email, "Leave Request", item.status, decision, clean(input.decisionNote, 1_000) || `${decision} by live Owner / Administrator role`);
      return Response.json({ saved: true, notice: `${decision} Recorded.${calendarWarning}` });
    }

    if (input.action === "save_profile") {
      const profile = sanitizeProfile(input.profile || {}, actor.email);
      await db.insert(employeeProfiles).values({ ...profile, updatedByEmail: actor.email, updatedAt: now }).onConflictDoUpdate({ target: employeeProfiles.employeeEmail, set: { ...profile, updatedByEmail: actor.email, updatedAt: now } });
      await audit(db, `EMP-PROFILE-${actor.email}`, actor.name, actor.email, "Employee Profile", "Prior Profile", "Updated", "Employee updated contact, emergency, sizing, and preference information");
      return Response.json({ saved: true, notice: "Your Employee Profile Was Saved." });
    }

    if (input.action === "save_proposal_profile") {
      const current = await db.select().from(proposalProfiles).where(eq(proposalProfiles.employeeEmail, actor.email)).limit(1);
      const sanitized = sanitizeProposalProfile(input.proposalProfile || {}, actor.email, actor.name);
      const isOwner = roles.includes("Company Owner");
      const status = isOwner ? "Approved" : "Pending Owner Approval";
      await db.insert(proposalProfiles).values({ ...sanitized, status, submittedAt: now, approvedByEmail: isOwner ? actor.email : "", approvedAt: isOwner ? now : null, updatedByEmail: actor.email, updatedAt: now }).onConflictDoUpdate({ target: proposalProfiles.employeeEmail, set: { ...sanitized, status, submittedAt: now, approvedByEmail: isOwner ? actor.email : "", approvedAt: isOwner ? now : null, updatedByEmail: actor.email, updatedAt: now } });
      await audit(db, `PROPOSAL-PROFILE-${actor.email}`, actor.name, actor.email, "Customer-Facing Proposal Profile", current[0]?.status || "Not Started", status, "Employee submitted a customer-safe profile; only the Company Owner can approve publication in proposals");
      return Response.json({ saved: true, notice: isOwner ? "Your Customer-Facing Profile Was Saved And Owner Approved." : "Your Customer-Facing Profile Was Sent To The Company Owner For Approval." });
    }

    if (input.action === "approve_proposal_profile") {
      if (!roles.includes("Company Owner")) return Response.json({ error: "Company Owner Approval Is Required" }, { status: 403 });
      const employeeEmail = clean(input.employeeEmail, 200).toLowerCase();
      const item = (await db.select().from(proposalProfiles).where(eq(proposalProfiles.employeeEmail, employeeEmail)).limit(1))[0];
      if (!item) return Response.json({ error: "Proposal Profile Was Not Found" }, { status: 404 });
      const status = input.status === "Declined" ? "Declined" : "Approved";
      await db.update(proposalProfiles).set({ status, approvedByEmail: actor.email, approvedAt: status === "Approved" ? now : null, updatedByEmail: actor.email, updatedAt: now }).where(eq(proposalProfiles.employeeEmail, employeeEmail));
      await audit(db, `PROPOSAL-PROFILE-${employeeEmail}`, actor.name, actor.email, "Customer-Facing Proposal Profile", item.status, status, "Company Owner reviewed customer-facing employee material");
      return Response.json({ saved: true, notice: `Proposal Profile ${status}.` });
    }

    if (input.action === "approve_proposal_experience") {
      if (!roles.includes("Company Owner")) return Response.json({ error: "Company Owner Approval Is Required" }, { status: 403 });
      const item = (await db.select().from(proposalProjectExperience).where(eq(proposalProjectExperience.id, clean(input.id, 220))).limit(1))[0];
      if (!item) return Response.json({ error: "Project Experience Was Not Found" }, { status: 404 });
      const status = input.status === "Declined" ? "Declined" : "Approved";
      const permission = input.customerPermission === "Approved" ? "Approved" : "Review Required";
      await db.update(proposalProjectExperience).set({ status, customerPermission: permission, approvedByEmail: actor.email, approvedAt: status === "Approved" ? now : null, updatedAt: now }).where(eq(proposalProjectExperience.id, item.id));
      await audit(db, item.id, actor.name, actor.email, "Customer-Facing Project Experience", item.status, status, `Customer permission: ${permission}`);
      return Response.json({ saved: true, notice: `Project Experience ${status}.` });
    }

    if (input.action === "submit_feedback") {
      const type = ["Pulse", "Idea", "Recognition", "Concern"].includes(String(input.feedbackType)) ? String(input.feedbackType) : "Idea";
      const note = clean(input.note, 4_000);
      if (note.length < 5) return Response.json({ error: "Add A Little More Detail Before Sending" }, { status: 400 });
      const anonymous = Boolean(input.anonymous) && ["Pulse", "Concern"].includes(type);
      const id = `EMP-FEEDBACK-${crypto.randomUUID()}`;
      await db.insert(employeeFeedback).values({ id, feedbackType: type, employeeEmail: anonymous ? "" : actor.email, employeeName: anonymous ? "Anonymous Employee" : actor.name, recipientEmail: clean(input.recipientEmail, 200).toLowerCase(), rating: Number.isFinite(Number(input.rating)) ? Math.max(1, Math.min(5, Number(input.rating))) : null, note, status: "Received", routedRole: type === "Concern" ? "Human Resources" : type === "Recognition" ? "Recognized Employee" : "Company Owner / Human Resources", confidential: type === "Concern", createdAt: now, updatedAt: now });
      return Response.json({ saved: true, notice: anonymous ? "Anonymous Feedback Was Sent Without Storing Your Identity." : "Feedback Was Sent." }, { status: 201 });
    }

    if (input.action === "update_leave_balance") {
      if (!roles.some((role) => ["Company Owner", "Administrator", "Human Resources"].includes(role))) return Response.json({ error: "Owner Administrator Or Human Resources Access Is Required" }, { status: 403 });
      const employeeEmail = clean(input.employeeEmail, 200).toLowerCase();
      const planYear = Math.max(2020, Math.min(2100, Number(input.planYear || new Date().getFullYear())));
      const availableHours = Math.max(0, Math.min(2_000, Math.round(Number(input.availableHours || 0))));
      if (!members.some((member) => member.email === employeeEmail)) return Response.json({ error: "Choose An Active Employee" }, { status: 400 });
      await db.insert(employeeLeaveBalances).values({ employeeEmail, planYear, availableHours, usedHours: 0, source: "Administrator Entry", updatedByEmail: actor.email, updatedByName: actor.name, updatedAt: now }).onConflictDoUpdate({ target: [employeeLeaveBalances.employeeEmail, employeeLeaveBalances.planYear], set: { availableHours, source: "Administrator Entry", updatedByEmail: actor.email, updatedByName: actor.name, updatedAt: now } });
      return Response.json({ saved: true, notice: "Authoritative Leave Balance Updated." });
    }

    return Response.json({ error: "A Supported Employee Lifecycle Action Is Required" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Employee Update Could Not Be Saved" }, { status: 500 });
  }
}

type Member = { email: string; name: string; level: string; designationsJson: string };

async function activeMembers(db: Awaited<ReturnType<typeof lifecycleDatabase>>): Promise<Member[]> {
  return db.select({ email: companyMembers.email, name: companyMembers.displayName, level: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson }).from(companyMembers).where(eq(companyMembers.isActive, true));
}

function actorRoles(actorLevel: string, member?: Member) {
  return [...new Set([actorLevel, member?.level || "", ...parseList(member?.designationsJson || "[]")].filter(Boolean))];
}

function roleMatches(route: string, roles: string[]) {
  return route.split("/").map((item) => item.trim()).some((role) => roles.includes(role));
}

function resolveAssignee(members: Member[], route: string) {
  const requested = route.split("/").map((item) => item.trim());
  for (const role of requested) {
    const match = members.find((member) => actorRoles(member.level, member).includes(role));
    if (match) return match;
  }
  return null;
}

function canReviewRequest(item: typeof employeeServiceRequests.$inferSelect, email: string, roles: string[]) {
  if (item.assignedToEmail === email) return true;
  if (roleMatches(item.routedRole, roles) || (item.secondaryApprovalRole && roleMatches(item.secondaryApprovalRole, roles))) return true;
  return item.confidential ? roles.includes("Company Owner") || roles.includes("Human Resources") : roles.includes("Company Owner") || roles.includes("Administrator");
}

function sanitizeProfile(value: Record<string, unknown>, employeeEmail: string) {
  return {
    employeeEmail,
    preferredName: clean(value.preferredName, 80), phone: clean(value.phone, 40),
    address1: clean(value.address1, 160), address2: clean(value.address2, 160), city: clean(value.city, 80), state: clean(value.state, 40), postalCode: clean(value.postalCode, 20),
    emergencyContactName: clean(value.emergencyContactName, 120), emergencyContactPhone: clean(value.emergencyContactPhone, 40), emergencyContactRelationship: clean(value.emergencyContactRelationship, 80),
    shirtSize: clean(value.shirtSize, 20), jacketSize: clean(value.jacketSize, 20), vestSize: clean(value.vestSize, 20),
    communicationPreference: clean(value.communicationPreference || "Email", 40), professionalBio: clean(value.professionalBio, 2_000),
  };
}

function emptyProfile(employeeEmail: string) {
  return { ...sanitizeProfile({}, employeeEmail), updatedByEmail: "", updatedAt: "" };
}

function emptyProposalProfile(employeeEmail: string, displayName: string) {
  return { employeeEmail, displayName, companyTitle: "", proposalRoleLabel: "", professionalSummary: "", credentialsJson: "[]", sectorsJson: "[]", deliveryMethodsJson: "[]", priorExperienceJson: "[]", headshotFileId: null, leadershipProfile: false, includeByDefault: false, status: "Not Started", submittedAt: null, approvedByEmail: "", approvedAt: null, updatedByEmail: "", updatedAt: "" };
}

async function notify(db: Awaited<ReturnType<typeof lifecycleDatabase>>, assignee: Member | null, kind: string, title: string, message: string) {
  if (!assignee) return;
  await db.insert(commandNotifications).values({ projectId: PEOPLE_PROJECT_ID, recipientName: assignee.name, recipientEmail: assignee.email, kind, title, message, isRead: false });
}

async function audit(db: Awaited<ReturnType<typeof lifecycleDatabase>>, id: string, actorName: string, actorEmail: string, field: string, before: string, after: string, reason: string) {
  await db.insert(recordAudits).values({ projectId: PEOPLE_PROJECT_ID, recordId: id, fieldName: field, oldValue: before, newValue: after, reason, actorName, actorEmail, summary: `${actorName}: ${field} changed from ${before} to ${after}.` });
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max);
}

function dateOnly(value: unknown) {
  const result = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
}

function addDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dueFromPriority(priority: string, now: string) {
  const date = new Date(now);
  date.setHours(date.getHours() + (priority === "Urgent" ? 4 : 48));
  return date.toISOString();
}

function parseList(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function lifecycleDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_service_requests (id text PRIMARY KEY NOT NULL, employee_email text NOT NULL, employee_name text NOT NULL, category text NOT NULL, subject text NOT NULL, details text NOT NULL, priority text DEFAULT 'Normal' NOT NULL, status text DEFAULT 'Open' NOT NULL, routed_role text NOT NULL, assigned_to_email text DEFAULT '' NOT NULL, assigned_to_name text DEFAULT '' NOT NULL, secondary_approval_role text DEFAULT '' NOT NULL, primary_approved_by_email text DEFAULT '' NOT NULL, primary_approved_by_name text DEFAULT '' NOT NULL, primary_approved_at text, secondary_approved_by_email text DEFAULT '' NOT NULL, secondary_approved_by_name text DEFAULT '' NOT NULL, secondary_approved_at text, resolution text DEFAULT '' NOT NULL, confidential integer DEFAULT false NOT NULL, due_at text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_leave_requests (id text PRIMARY KEY NOT NULL, employee_email text NOT NULL, employee_name text NOT NULL, leave_type text NOT NULL, start_date text NOT NULL, end_date text NOT NULL, requested_hours integer NOT NULL, note text DEFAULT '' NOT NULL, status text DEFAULT 'Pending Review' NOT NULL, routed_role text DEFAULT 'Company Owner / Administrator' NOT NULL, approver_email text DEFAULT '' NOT NULL, approver_name text DEFAULT '' NOT NULL, decided_at text, decision_note text DEFAULT '' NOT NULL, calendar_event_id text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_leave_balances (employee_email text NOT NULL, plan_year integer NOT NULL, available_hours integer DEFAULT 0 NOT NULL, used_hours integer DEFAULT 0 NOT NULL, source text DEFAULT 'Administrator Entry' NOT NULL, updated_by_email text NOT NULL, updated_by_name text NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY(employee_email, plan_year))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_profiles (employee_email text PRIMARY KEY NOT NULL, preferred_name text DEFAULT '' NOT NULL, phone text DEFAULT '' NOT NULL, address_1 text DEFAULT '' NOT NULL, address_2 text DEFAULT '' NOT NULL, city text DEFAULT '' NOT NULL, state text DEFAULT '' NOT NULL, postal_code text DEFAULT '' NOT NULL, emergency_contact_name text DEFAULT '' NOT NULL, emergency_contact_phone text DEFAULT '' NOT NULL, emergency_contact_relationship text DEFAULT '' NOT NULL, shirt_size text DEFAULT '' NOT NULL, jacket_size text DEFAULT '' NOT NULL, vest_size text DEFAULT '' NOT NULL, communication_preference text DEFAULT 'Email' NOT NULL, professional_bio text DEFAULT '' NOT NULL, updated_by_email text NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_feedback (id text PRIMARY KEY NOT NULL, feedback_type text NOT NULL, employee_email text DEFAULT '' NOT NULL, employee_name text DEFAULT 'Anonymous Employee' NOT NULL, recipient_email text DEFAULT '' NOT NULL, rating integer, note text NOT NULL, status text DEFAULT 'Received' NOT NULL, routed_role text DEFAULT 'Human Resources' NOT NULL, confidential integer DEFAULT false NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS proposal_profiles (employee_email text PRIMARY KEY NOT NULL, display_name text DEFAULT '' NOT NULL, company_title text DEFAULT '' NOT NULL, proposal_role_label text DEFAULT '' NOT NULL, professional_summary text DEFAULT '' NOT NULL, credentials_json text DEFAULT '[]' NOT NULL, sectors_json text DEFAULT '[]' NOT NULL, delivery_methods_json text DEFAULT '[]' NOT NULL, prior_experience_json text DEFAULT '[]' NOT NULL, headshot_file_id integer, leadership_profile integer DEFAULT false NOT NULL, include_by_default integer DEFAULT false NOT NULL, status text DEFAULT 'Draft' NOT NULL, submitted_at text, approved_by_email text DEFAULT '' NOT NULL, approved_at text, updated_by_email text NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS proposal_project_experience (id text PRIMARY KEY NOT NULL, project_id text NOT NULL, employee_email text NOT NULL, role text NOT NULL, project_name text NOT NULL, project_location text DEFAULT '' NOT NULL, project_type text DEFAULT '' NOT NULL, delivery_method text DEFAULT '' NOT NULL, completion_date text DEFAULT '' NOT NULL, summary text DEFAULT '' NOT NULL, metrics_json text DEFAULT '{}' NOT NULL, photo_file_ids_json text DEFAULT '[]' NOT NULL, source text DEFAULT 'Project Assignment' NOT NULL, customer_permission text DEFAULT 'Review Required' NOT NULL, status text DEFAULT 'Draft' NOT NULL, approved_by_email text DEFAULT '' NOT NULL, approved_at text, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
  ]);
  const { getDb } = await import("../../../db");
  return getDb();
}
