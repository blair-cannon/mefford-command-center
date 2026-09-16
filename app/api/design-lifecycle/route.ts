import { projectDesignationsFor } from "../../../lib/project-access";
import { and, desc, eq } from "drizzle-orm";
import {
  commandRecords,
  companyMembers,
  projectFiles,
  projects,
  recordAudits,
  vendorAudits,
  vendorInvites,
  vendorProfiles,
  vendorProjectAccess,
} from "../../../db/schema";
import {
  DESIGN_ENGAGEMENT_STATUSES,
  DESIGN_TEAM_DISCIPLINES,
  normalizeDesignChecklist,
  type DesignTeamAssignment,
} from "../../../lib/design-lifecycle";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { sendOperationalEmail } from "../../../lib/operational-email";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { complianceState, ensureVendorSchema, parseStringArray } from "../../../lib/vendor-portal";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const DESIGN_RECORD_TYPE = "Design Packages";
const DESIGN_TEAM_RECORD_TYPE = "Design Team";
const SALES_DESIGN_TYPES = ["Floor Plan", "Rendering"] as const;

type Scope = "Sales" | "Project";
type DesignAction = {
  action?: "create-package" | "add-revision" | "mark-pricing-basis" | "send-consultant-review" | "release-current-set" | "assign-designer" | "assign-package-designer" | "update-checklist" | "initiate-designer-subcontract";
  scope?: Scope;
  projectId?: string;
  opportunityId?: string;
  recordId?: string;
  title?: string;
  discipline?: string;
  phase?: string;
  deliverableType?: string;
  description?: string;
  due?: string;
  designLead?: string;
  consultantVendorId?: string;
  reviewDue?: string;
  reviewInstructions?: string;
  revision?: {
    label?: string;
    description?: string;
    fileId?: number;
    fileName?: string;
    uploadedBy?: string;
    uploadedAt?: string;
  };
  issuedPurpose?: string;
  distributionList?: string[];
  releaseNote?: string;
  assignmentId?: string;
  vendorId?: string;
  engagementStatus?: string;
  contractReference?: string;
  checklistItemId?: string;
  completed?: boolean;
  note?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const search = new URL(request.url).searchParams;
  const scope = search.get("scope") === "Sales" ? "Sales" : "Project";
  const projectId = scope === "Sales" ? SALES_PROJECT_ID : search.get("projectId")?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const project = scope === "Project" ? await db.select().from(projects).where(eq(projects.number, projectId)).limit(1) : [];
  if (scope === "Project" && !project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const permissions = await designPermissions(db, actor, project[0]);
  if (scope === "Sales" && !permissions.canManageSales) return Response.json({ error: "Sales Design Requires Sales Or Estimating Access" }, { status: 403 });
  if (scope === "Project" && !permissions.canViewProject) return Response.json({ error: "Project Design Access Is Required" }, { status: 403 });
  const [packages, opportunities, teamRows, accessRows, vendors, invites] = await Promise.all([
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, DESIGN_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    scope === "Sales"
      ? db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.recordType, "Sales Opportunities"))).orderBy(desc(commandRecords.updatedAt))
      : Promise.resolve([]),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    scope === "Project" ? db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.projectId, projectId)) : Promise.resolve([]),
    db.select().from(vendorProfiles).orderBy(vendorProfiles.legalName),
    db.select().from(vendorInvites).orderBy(desc(vendorInvites.createdAt)),
  ]);
  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const vendorOptions = await Promise.all(vendors.map(async (vendor) => {
    const compliance = await complianceState(db, vendor.id, scope === "Project" ? projectId : undefined);
    return {
      id: vendor.id,
      name: vendor.legalName,
      type: vendor.vendorType,
      contactName: vendor.contactName,
      contactEmail: vendor.contactEmail,
      trades: parseStringArray(vendor.tradesJson),
      status: vendor.status,
      paymentHold: compliance.paymentBlocked,
      temporaryApproval: Boolean(compliance.activeOverride),
      portalStatus: portalStatus(vendor.id),
    };
  }));
  const portalStatus = (vendorId: string) => {
    const invite = invites.find((item) => item.vendorId === vendorId && !item.revokedAt && new Date(item.expiresAt) > new Date());
    return invite?.verifiedAt ? "Portal Verified" : invite ? "Invite Active" : "Invite Required";
  };
  return Response.json({
    scope,
    safeguards: {
      awardLocksBasisOfSale: true,
      workingCopyNeverOverwritesSnapshot: true,
      currentSetRelease: "PM After Designer Approval",
      automaticContractChange: false,
    },
    permissions,
    project: project[0] || null,
    vendorOptions,
    designTeams: teamRows.map((row) => {
      const data = parseData(row.dataJson);
      const assignments = Array.isArray(data.assignments) ? data.assignments as DesignTeamAssignment[] : [];
      return {
        id: row.id,
        opportunityId: String(data.opportunityId || ""),
        status: row.status,
        locked: data.basisOfSaleLocked === true,
        assignments: assignments.map((assignment) => ({ ...assignment, portalStatus: portalStatus(assignment.vendorId) })),
        checklist: normalizeDesignChecklist(data.checklist),
        timeline: Array.isArray(data.timeline) ? data.timeline : [],
      };
    }),
    opportunities: opportunities.map((row) => {
      const data = parseData(row.dataJson);
      return {
        id: row.id,
        title: row.title,
        stage: String(data.stage || row.status),
        company: String(data.company || ""),
        assignedRep: String(data.assignedRep || row.owner),
        awardedProjectNumber: String(data.awardedProjectNumber || ""),
        deliveryMethod: String(data.deliveryMethod || "Unknown"),
        salesDesignTrackId: String(data.salesDesignTrackId || ""),
        salesDesignTrackStatus: String(data.salesDesignTrackStatus || ""),
      };
    }),
    consultants: accessRows.flatMap((access) => {
      const sharedRecords = parseStringArray(access.sharedRecordsJson);
      const permissionsList = parseStringArray(access.permissionsJson);
      if (!sharedRecords.includes(DESIGN_RECORD_TYPE) && !permissionsList.includes("Design Review")) return [];
      const vendor = vendorMap.get(access.vendorId);
      return [{
        id: access.vendorId,
        name: vendor?.legalName || access.vendorId,
        contactName: vendor?.contactName || "",
        contactEmail: vendor?.contactEmail || "",
        discipline: access.trade,
        status: access.status,
      }];
    }),
    packages: packages.map(toClientPackage),
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const input = (await request.json()) as DesignAction;
  const scope: Scope = input.scope === "Sales" ? "Sales" : "Project";
  const projectId = scope === "Sales" ? SALES_PROJECT_ID : input.projectId?.trim() || "";
  if (!projectId) return Response.json({ error: "Project Is Required" }, { status: 400 });
  const { getDb } = await import("../../../db");
  const db = getDb();
  const project = scope === "Project" ? await db.select().from(projects).where(eq(projects.number, projectId)).limit(1) : [];
  if (scope === "Project" && !project[0]) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const permissions = await designPermissions(db, actor, project[0]);
  const canManage = scope === "Sales" ? permissions.canManageSales : permissions.canManageProject;

  if (input.action === "assign-designer") {
    if (!canManage) return Response.json({ error: "Design Team Management Permission Is Required" }, { status: 403 });
    const discipline = input.discipline?.trim() || "";
    const vendorId = input.vendorId?.trim() || "";
    const engagementStatus = input.engagementStatus?.trim() || "Selected";
    const opportunityId = input.opportunityId?.trim() || "";
    if (!DESIGN_TEAM_DISCIPLINES.includes(discipline as typeof DESIGN_TEAM_DISCIPLINES[number]) || !vendorId || !DESIGN_ENGAGEMENT_STATUSES.includes(engagementStatus as typeof DESIGN_ENGAGEMENT_STATUSES[number]) || (scope === "Sales" && !opportunityId)) {
      return Response.json({ error: "Opportunity Discipline Vendor And Engagement Status Are Required" }, { status: 400 });
    }
    if (scope === "Sales" && discipline !== "Architecture") {
      return Response.json({ error: "Sales Design Is Limited To One Default Architect. Full Design Disciplines Begin After Award." }, { status: 409 });
    }
    const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, vendorId)).limit(1);
    if (!vendor[0]) return Response.json({ error: "Select A Vendor From The Company Vendor Directory" }, { status: 404 });
    let contextTitle = project[0]?.name || "Mefford Sales Design";
    if (scope === "Sales") {
      const opportunity = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, SALES_PROJECT_ID), eq(commandRecords.id, opportunityId), eq(commandRecords.recordType, "Sales Opportunities"))).limit(1);
      if (!opportunity[0]) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
      contextTitle = opportunity[0].title;
    }
    const teamId = scope === "Sales" ? `DESIGN-TEAM-${opportunityId}` : "DESIGN-TEAM";
    const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).limit(1);
    const teamRow = teamRows[0];
    const teamData = teamRow ? parseData(teamRow.dataJson) : {};
    if (scope === "Sales" && teamData.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Sales Design Team Is Locked. Manage The Team In The Project Working Copy." }, { status: 423 });
    const assignments = Array.isArray(teamData.assignments) ? teamData.assignments as DesignTeamAssignment[] : [];
    const assignmentId = input.assignmentId?.trim() || `DTA-${discipline.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
    const previous = assignments.find((item) => item.id === assignmentId);
    const now = new Date().toISOString();
    const assignment: DesignTeamAssignment = {
      id: assignmentId,
      discipline,
      vendorId,
      vendorName: vendor[0].legalName,
      contactName: vendor[0].contactName,
      contactEmail: vendor[0].contactEmail,
      engagementStatus,
      contractReference: input.contractReference?.trim() || previous?.contractReference || "",
      linkedSubcontractId: previous?.linkedSubcontractId || "",
      notificationsEnabled: true,
      portalStatus: "Enabled",
      assignedBy: previous?.assignedBy || actor.name,
      assignedAt: previous?.assignedAt || now,
      updatedAt: now,
    };
    const nextAssignments = [...assignments.filter((item) => item.id !== assignmentId), assignment];
    const nextTeamData = {
      ...teamData,
      lifecycleScope: scope,
      opportunityId: scope === "Sales" ? opportunityId : String(teamData.opportunityId || ""),
      projectId: scope === "Project" ? projectId : "",
      assignments: nextAssignments,
      checklist: normalizeDesignChecklist(teamData.checklist),
      timeline: [...(Array.isArray(teamData.timeline) ? teamData.timeline : []), { action: previous ? "Designer Assignment Updated" : "Designer Added", actor: actor.name, at: now, detail: `${discipline} · ${vendor[0].legalName} · ${engagementStatus}` }],
    };
    if (teamRow) {
      await db.update(commandRecords).set({
        title: `${contextTitle} Design Team`,
        owner: project[0]?.projectManager || actor.name,
        status: nextAssignments.some((item) => item.engagementStatus === "Under Contract") ? "Active Design Team" : "Design Team Formation",
        meta: `${nextAssignments.length} Designer${nextAssignments.length === 1 ? "" : "s"} · ${nextAssignments.filter((item) => item.engagementStatus === "Under Contract").length} Under Contract`,
        dataJson: JSON.stringify(nextTeamData),
        updatedAt: now,
      }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId)));
    } else {
      await db.insert(commandRecords).values({
        projectId,
        id: teamId,
        recordType: DESIGN_TEAM_RECORD_TYPE,
        title: `${contextTitle} Design Team`,
        owner: project[0]?.projectManager || actor.name,
        due: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        status: engagementStatus === "Under Contract" ? "Active Design Team" : "Design Team Formation",
        meta: `1 Designer · ${engagementStatus}`,
        recordDate: now.slice(0, 10),
        recordTime: now.slice(11, 16),
        dataJson: JSON.stringify(nextTeamData),
        updatedAt: now,
      });
    }
    const packageRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, DESIGN_RECORD_TYPE)));
    for (const designPackage of packageRows) {
      const packageData = parseData(designPackage.dataJson);
      if (scope === "Sales" && String(packageData.opportunityId || "") !== opportunityId) continue;
      if (designTeamDisciplineForPackage(String(packageData.discipline || "")) !== discipline) continue;
      const packageTimeline = Array.isArray(packageData.timeline) ? packageData.timeline : [];
      await db.update(commandRecords).set({
        dataJson: JSON.stringify({ ...packageData, consultantVendorId: vendorId, timeline: [...packageTimeline, { action: "Design Team Assignment Applied", actor: actor.name, at: now, detail: `${discipline} · ${vendor[0].legalName}` }] }),
        updatedAt: now,
      }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, designPackage.id)));
    }
    const existingAccess = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1);
    const permissionsList = Array.from(new Set([...(existingAccess[0] ? parseStringArray(existingAccess[0].permissionsJson) : []), "Design Review", "Design Upload"]));
    const sharedRecords = Array.from(new Set([...(existingAccess[0] ? parseStringArray(existingAccess[0].sharedRecordsJson) : []), DESIGN_RECORD_TYPE]));
    await db.insert(vendorProjectAccess).values({
      id: `${vendorId}:${projectId}`,
      vendorId,
      projectId,
      projectName: scope === "Sales" ? "Mefford Sales Design" : contextTitle,
      status: existingAccess[0]?.status || "Active",
      trade: discipline,
      contractReference: assignment.contractReference,
      costCode: existingAccess[0]?.costCode || "Unassigned",
      committedAmount: existingAccess[0]?.committedAmount || "0",
      permissionsJson: JSON.stringify(permissionsList),
      sharedRecordsJson: JSON.stringify(sharedRecords),
      grantedBy: actor.email,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: vendorProjectAccess.id,
      set: { projectName: scope === "Sales" ? "Mefford Sales Design" : contextTitle, trade: discipline, contractReference: assignment.contractReference, permissionsJson: JSON.stringify(permissionsList), sharedRecordsJson: JSON.stringify(sharedRecords), updatedAt: now },
    });
    await audit(db, projectId, teamId, actor, "Design Team", previous?.vendorName || "Unassigned", vendor[0].legalName, `${discipline} designer set to ${vendor[0].legalName}.`);
    await db.insert(vendorAudits).values({ vendorId, actorName: actor.name, actorEmail: actor.email, action: "Design Team Assignment", detail: `${contextTitle} · ${discipline} · ${engagementStatus}. Controlled Design Review and Design Upload portal access enabled.` });
    const invite = await db.select().from(vendorInvites).where(eq(vendorInvites.vendorId, vendorId)).orderBy(desc(vendorInvites.createdAt)).limit(1);
    const emailDelivery = await sendDesignOperationalEmail(request, {
      senderEmail: actor.email,
      to: vendor[0].contactEmail,
      subject: `Mefford Design Team Update · ${contextTitle}`,
      text: `${vendor[0].contactName},\n\n${vendor[0].legalName} is listed as the ${discipline} designer for ${contextTitle}. Engagement status: ${engagementStatus}.\n\nControlled design updates and assigned file actions will be available through the secure Mefford vendor portal.${invite[0] && !invite[0].revokedAt ? `\nPortal: ${new URL(request.url).origin}/?vendorPortal=${invite[0].id}` : "\nA secure portal invitation must be prepared by Mefford before first access."}\n\nThis operational notice does not execute a contract or approve cost.`,
    });
    return Response.json({ saved: true, designTeam: { id: teamId, assignments: nextAssignments, checklist: normalizeDesignChecklist(nextTeamData.checklist) }, emailDelivery }, { status: 201 });
  }

  if (input.action === "update-checklist") {
    if (!canManage) return Response.json({ error: "Design Checklist Management Permission Is Required" }, { status: 403 });
    const opportunityId = input.opportunityId?.trim() || "";
    const teamId = scope === "Sales" ? `DESIGN-TEAM-${opportunityId}` : "DESIGN-TEAM";
    const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).limit(1);
    const teamRow = teamRows[0];
    if (!teamRow) return Response.json({ error: "Create The Design Team Before Updating Its Checklist" }, { status: 404 });
    const data = parseData(teamRow.dataJson);
    if (scope === "Sales" && data.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Sales Checklist Is Immutable. Continue In The Project Working Copy." }, { status: 423 });
    const checklist = normalizeDesignChecklist(data.checklist);
    const itemId = input.checklistItemId?.trim() || "";
    if (!checklist.some((item) => item.id === itemId)) return Response.json({ error: "Design Checklist Item Not Found" }, { status: 404 });
    const now = new Date().toISOString();
    const nextChecklist = checklist.map((item) => item.id === itemId ? { ...item, completed: input.completed === true, completedBy: input.completed === true ? actor.name : "", completedAt: input.completed === true ? now : "", note: input.note?.trim() || item.note } : item);
    const completedCount = nextChecklist.filter((item) => item.completed).length;
    const nextData = { ...data, checklist: nextChecklist, timeline: [...(Array.isArray(data.timeline) ? data.timeline : []), { action: input.completed ? "Design Expectation Completed" : "Design Expectation Reopened", actor: actor.name, at: now, detail: nextChecklist.find((item) => item.id === itemId)?.label || itemId }] };
    await db.update(commandRecords).set({ meta: `${completedCount} Of ${nextChecklist.length} Standard Expectations Complete`, dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId)));
    await audit(db, projectId, teamId, actor, "Design Checklist", input.completed ? "Open" : "Complete", input.completed ? "Complete" : "Open", nextChecklist.find((item) => item.id === itemId)?.label || itemId);
    return Response.json({ saved: true, checklist: nextChecklist });
  }

  if (input.action === "initiate-designer-subcontract") {
    if (scope !== "Project" || !canManage) return Response.json({ error: "A Project Manager Or Administrator Must Initiate The Designer Subcontract" }, { status: 403 });
    const teamId = "DESIGN-TEAM";
    const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).limit(1);
    const teamRow = teamRows[0];
    const data = teamRow ? parseData(teamRow.dataJson) : {};
    const assignments = Array.isArray(data.assignments) ? data.assignments as DesignTeamAssignment[] : [];
    const assignment = assignments.find((item) => item.id === input.assignmentId);
    if (!teamRow || !assignment) return Response.json({ error: "Design Team Assignment Not Found" }, { status: 404 });
    if (assignment.linkedSubcontractId) return Response.json({ saved: true, subcontractId: assignment.linkedSubcontractId, idempotent: true });
    const subcontractRows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, "Subcontracts")));
    const nextNumber = subcontractRows.reduce((largest, item) => Math.max(largest, Number(item.id.match(/^SC-(\d+)$/)?.[1] || 0)), 0) + 1;
    const subcontractId = `SC-${String(nextNumber).padStart(3, "0")}`;
    const now = new Date().toISOString();
    await db.insert(commandRecords).values({
      projectId,
      id: subcontractId,
      recordType: "Subcontracts",
      title: assignment.vendorName,
      owner: project[0]?.projectManager || actor.name,
      due: now.slice(0, 10),
      status: "Draft",
      meta: `${assignment.discipline} Designer · Initiated From Design Team`,
      recordDate: now.slice(0, 10),
      recordTime: now.slice(11, 16),
      dataJson: JSON.stringify({
        subcontractor: assignment.vendorName,
        signerName: assignment.contactName,
        signerEmail: assignment.contactEmail,
        signerTitle: "Authorized Representative",
        vendorId: assignment.vendorId,
        linkedDesignTeamAssignmentId: assignment.id,
        designDiscipline: assignment.discipline,
        designTeamSource: true,
        price: 0,
        retainage: 0,
        scope: `${assignment.discipline} design services. Complete scope, fee, cost allocation, insurance, and release review before execution.`,
        proposalName: assignment.contractReference,
        costAllocations: [],
        workflowStatus: "Draft",
      }),
      updatedAt: now,
    });
    const nextAssignments = assignments.map((item) => item.id === assignment.id ? { ...item, linkedSubcontractId: subcontractId, updatedAt: now } : item);
    const nextData = { ...data, assignments: nextAssignments, timeline: [...(Array.isArray(data.timeline) ? data.timeline : []), { action: "Designer Subcontract Initiated", actor: actor.name, at: now, detail: `${assignment.vendorName} · ${subcontractId}` }] };
    await db.update(commandRecords).set({ dataJson: JSON.stringify(nextData), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId)));
    await audit(db, projectId, teamId, actor, "Designer Subcontract", "Not Linked", subcontractId, `${assignment.discipline} designer linked to draft ${subcontractId}.`);
    await audit(db, projectId, subcontractId, actor, "Subcontract Source", "None", teamId, `${subcontractId} initiated from ${assignment.id}; no contract was executed or cost approved.`);
    return Response.json({ saved: true, subcontractId }, { status: 201 });
  }

  if (input.action === "create-package") {
    if (!canManage) return Response.json({ error: "You Do Not Have Permission To Create This Design Package" }, { status: 403 });
    const title = input.title?.trim() || "";
    const requestedDiscipline = input.discipline?.trim() || "";
    const requestedPhase = input.phase?.trim() || "";
    const requestedDeliverableType = input.deliverableType?.trim() || "Drawing Package";
    const discipline = scope === "Sales" ? "Architecture" : requestedDiscipline;
    const phase = scope === "Sales" ? requestedDeliverableType : requestedPhase;
    const deliverableType = requestedDeliverableType;
    const due = input.due?.trim() || "";
    if (!title || !discipline || !phase || !due || (scope === "Sales" && !input.opportunityId)) {
      return Response.json({ error: "Opportunity Title Discipline Phase And Due Date Are Required" }, { status: 400 });
    }
    if (scope === "Sales") {
      if (!SALES_DESIGN_TYPES.includes(deliverableType as typeof SALES_DESIGN_TYPES[number])) {
        return Response.json({ error: "Before Award Sales Design Is Limited To Floor Plans And Renderings" }, { status: 409 });
      }
      const opportunity = await db.select().from(commandRecords).where(and(
        eq(commandRecords.projectId, SALES_PROJECT_ID),
        eq(commandRecords.id, input.opportunityId!),
        eq(commandRecords.recordType, "Sales Opportunities"),
      )).limit(1);
      if (!opportunity[0]) return Response.json({ error: "Sales Opportunity Not Found" }, { status: 404 });
    }
    let consultantVendorId = input.consultantVendorId?.trim() || "";
    if (!consultantVendorId) {
      const teamId = scope === "Sales" ? `DESIGN-TEAM-${input.opportunityId}` : "DESIGN-TEAM";
      const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, teamId), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).limit(1);
      const teamData = teamRows[0] ? parseData(teamRows[0].dataJson) : {};
      const assignments = Array.isArray(teamData.assignments) ? teamData.assignments as DesignTeamAssignment[] : [];
      consultantVendorId = assignments.find((item) => item.discipline === designTeamDisciplineForPackage(discipline))?.vendorId || "";
    }
    if (consultantVendorId) {
      const assignedVendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, consultantVendorId)).limit(1);
      if (!assignedVendor[0]) return Response.json({ error: "Select An Assigned Architect Or Designer From The Company Vendor Directory" }, { status: 404 });
    }
    const id = await nextDesignId(db, projectId);
    const now = new Date().toISOString();
    const status = scope === "Sales" ? "Working Concept" : "Working Design";
    const data = {
      lifecycleScope: scope,
      opportunityId: input.opportunityId?.trim() || "",
      projectId: scope === "Project" ? projectId : "",
      discipline,
      phase,
      deliverableType,
      description: input.description?.trim() || "",
      designLead: input.designLead?.trim() || actor.name,
      consultantVendorId,
      versions: [],
      basisOfSaleLocked: false,
      immutableSnapshot: null,
      createdBy: actor.name,
      createdAt: now,
      timeline: [{ action: "Design Package Created", actor: actor.name, at: now, detail: `${discipline} · ${phase}` }],
    };
    await db.insert(commandRecords).values({
      projectId,
      id,
      recordType: DESIGN_RECORD_TYPE,
      title,
      owner: input.designLead?.trim() || actor.name,
      due,
      status,
      meta: `${discipline} · ${phase} · ${scope === "Sales" ? "Sales Design" : "Project Design"}`,
      recordDate: now.slice(0, 10),
      recordTime: now.slice(11, 16),
      dateLocked: false,
      dataJson: JSON.stringify(data),
      updatedAt: now,
    });
    if (consultantVendorId) {
      await grantDesignAccess(db, consultantVendorId, projectId, scope === "Sales" ? "Mefford Sales Design" : project[0]?.name || projectId, discipline, actor.email, now);
    }
    await audit(db, projectId, id, actor, "Design Package", "None", status, `${id} created for ${discipline} ${phase}.`);
    return Response.json({ saved: true, package: toClientPackage({
      projectId, id, recordType: DESIGN_RECORD_TYPE, title, owner: input.designLead?.trim() || actor.name,
      due, status, meta: `${discipline} · ${phase} · ${scope === "Sales" ? "Sales Design" : "Project Design"}`,
      recordDate: now.slice(0, 10), recordTime: now.slice(11, 16), dateLocked: false,
      dataJson: JSON.stringify(data), createdAt: now, updatedAt: now,
    }) }, { status: 201 });
  }

  const recordId = input.recordId?.trim() || "";
  const rows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, projectId),
    eq(commandRecords.id, recordId),
    eq(commandRecords.recordType, DESIGN_RECORD_TYPE),
  )).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Design Package Not Found" }, { status: 404 });
  const data = parseData(row.dataJson);
  const versions = Array.isArray(data.versions) ? data.versions as Array<Record<string, unknown>> : [];
  const timeline = Array.isArray(data.timeline) ? data.timeline as Array<Record<string, unknown>> : [];
  const now = new Date().toISOString();

  if (input.action === "assign-package-designer") {
    if (!canManage) return Response.json({ error: "Design Package Assignment Permission Is Required" }, { status: 403 });
    if (scope === "Sales" && data.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Basis Of Sale Is Immutable. Continue In The Project Working Copy." }, { status: 423 });
    const consultantVendorId = input.consultantVendorId?.trim() || "";
    let consultantName = "Unassigned";
    if (consultantVendorId) {
      const vendor = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, consultantVendorId)).limit(1);
      if (!vendor[0]) return Response.json({ error: "Select An Architect Or Designer From The Company Vendor Directory" }, { status: 404 });
      consultantName = vendor[0].legalName;
      await grantDesignAccess(db, consultantVendorId, projectId, scope === "Sales" ? "Mefford Sales Design" : project[0]?.name || projectId, String(data.discipline || "Design"), actor.email, now);
    }
    const previousVendorId = String(data.consultantVendorId || "");
    const nextData = {
      ...data,
      consultantVendorId,
      timeline: [...timeline, { action: consultantVendorId ? "Package Designer Assigned" : "Package Designer Cleared", actor: actor.name, at: now, detail: `${scope === "Sales" ? "Architect" : "Designer"} · ${consultantName}` }],
    };
    await updatePackage(db, row, row.status, nextData, actor, `${scope === "Sales" ? "Architect" : "Designer"} assignment changed from ${previousVendorId || "Unassigned"} to ${consultantName}`);
    return Response.json({ saved: true, package: toClientPackage({ ...row, dataJson: JSON.stringify(nextData), updatedAt: now }) });
  }

  if (input.action === "add-revision") {
    if (!canManage) return Response.json({ error: "Design Management Permission Is Required" }, { status: 403 });
    if (scope === "Sales" && data.basisOfSaleLocked === true) return Response.json({ error: "The Awarded Basis Of Sale Is Immutable. Continue In The Project Working Copy." }, { status: 423 });
    const revision = input.revision;
    if (!revision?.label?.trim() || !revision.fileId || !revision.fileName) return Response.json({ error: "Revision Label And Stored File Are Required" }, { status: 400 });
    if (versions.some((item) => String(item.label || "").toLowerCase() === revision.label!.trim().toLowerCase())) return Response.json({ error: "That Revision Label Already Exists In This Package" }, { status: 409 });
    const storedFiles = await db.select().from(projectFiles).where(eq(projectFiles.id, revision.fileId)).limit(1);
    const opportunityId = String(data.opportunityId || input.opportunityId || "");
    const allowedFileProjects = scope === "Sales"
      ? new Set([`ESTIMATE-${opportunityId}`, `DESIGN-${opportunityId}`, SALES_PROJECT_ID])
      : new Set([projectId]);
    if (!storedFiles[0] || !allowedFileProjects.has(storedFiles[0].projectId)) {
      return Response.json({ error: "The Stored Revision File Does Not Belong To This Design Context" }, { status: 403 });
    }
    const nextVersion = {
      id: `REV-${crypto.randomUUID()}`,
      label: revision.label.trim(),
      description: revision.description?.trim() || "",
      fileId: revision.fileId,
      fileName: revision.fileName,
      uploadedBy: revision.uploadedBy || actor.name,
      uploadedAt: revision.uploadedAt || now,
      designerDecision: "Pending",
      isCurrent: false,
      isBasisOfSale: false,
    };
    const nextStatus = scope === "Sales" ? "Working Concept" : row.status === "Current Set" ? "Working Revision" : "Working Design";
    const nextData = {
      ...data,
      phase: input.phase?.trim() || data.phase,
      versions: [...versions, nextVersion],
      timeline: [...timeline, { action: "Revision Uploaded", actor: actor.name, at: now, detail: `${nextVersion.label} · ${nextVersion.fileName}` }],
    };
    if (scope === "Sales") {
      if (!opportunityId) return Response.json({ error: "The Sales Design Is Missing Its Estimate Connection" }, { status: 409 });
      await db.update(projectFiles).set({
        projectId: `ESTIMATE-${opportunityId}`,
        category: "02-Design & Drawings",
        revision: `${row.id} · ${nextVersion.label} · Sales Design`,
        access: "Controlled Design Team",
      }).where(eq(projectFiles.id, revision.fileId));
    }
    await updatePackage(db, row, nextStatus, nextData, actor, `Revision ${nextVersion.label} uploaded`);
    return Response.json({ saved: true, package: toClientPackage({ ...row, status: nextStatus, dataJson: JSON.stringify(nextData), updatedAt: now }) });
  }

  if (input.action === "mark-pricing-basis") {
    if (scope !== "Sales" || !permissions.canManageSales) return Response.json({ error: "Sales Design Access Is Required" }, { status: 403 });
    if (!versions.length) return Response.json({ error: "Upload At Least One Design Revision Before Marking The Pricing Basis" }, { status: 409 });
    const nextData = { ...data, pricingBasisVersionId: versions.at(-1)?.id || "", pricingBasisMarkedBy: actor.name, pricingBasisMarkedAt: now, timeline: [...timeline, { action: "Pricing Basis Marked", actor: actor.name, at: now, detail: String(versions.at(-1)?.label || "Latest Revision") }] };
    await updatePackage(db, row, "Pricing Basis", nextData, actor, "Latest revision marked as proposal and pricing basis");
    return Response.json({ saved: true, package: toClientPackage({ ...row, status: "Pricing Basis", dataJson: JSON.stringify(nextData), updatedAt: now }) });
  }

  if (input.action === "send-consultant-review") {
    if (scope !== "Project" || !permissions.canReleaseCurrentSet) return Response.json({ error: "Only A Project Manager May Send A Controlled Design Review" }, { status: 403 });
    if (!versions.length) return Response.json({ error: "Upload A Design Revision Before Consultant Review" }, { status: 409 });
    const consultantVendorId = input.consultantVendorId?.trim() || String(data.consultantVendorId || "");
    const reviewDue = input.reviewDue?.trim() || "";
    const access = await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.projectId, projectId), eq(vendorProjectAccess.vendorId, consultantVendorId))).limit(1);
    if (!access[0] || (!parseStringArray(access[0].sharedRecordsJson).includes(DESIGN_RECORD_TYPE) && !parseStringArray(access[0].permissionsJson).includes("Design Review"))) {
      return Response.json({ error: "Grant This Consultant Controlled Design Review Access In Vendor Management First" }, { status: 403 });
    }
    if (!reviewDue) return Response.json({ error: "Consultant And Review Due Date Are Required" }, { status: 400 });
    const latest = versions.at(-1)!;
    const nextVersions = versions.map((version) => version.id === latest.id ? { ...version, designerDecision: "Pending", reviewRequestedAt: now } : version);
    const nextData = {
      ...data,
      consultantVendorId,
      reviewDue,
      reviewInstructions: input.reviewInstructions?.trim() || "",
      versions: nextVersions,
      timeline: [...timeline, { action: "Consultant Review Requested", actor: actor.name, at: now, detail: `${String(latest.label || "Latest Revision")} · Due ${reviewDue}` }],
    };
    await updatePackage(db, row, "Consultant Review", nextData, actor, "PM sent latest revision for controlled designer review");
    const consultant = await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, consultantVendorId)).limit(1);
    const invite = await db.select().from(vendorInvites).where(eq(vendorInvites.vendorId, consultantVendorId)).orderBy(desc(vendorInvites.createdAt)).limit(1);
    const emailDelivery = consultant[0] ? await sendDesignOperationalEmail(request, {
      senderEmail: actor.email,
      to: consultant[0].contactEmail,
      subject: `Mefford Design Review · ${row.title}`,
      text: `${consultant[0].contactName},\n\n${actor.name} sent ${String(latest.label || "the latest revision")} of ${row.title} for your controlled review. Review due: ${reviewDue}.\n\n${input.reviewInstructions?.trim() || "Review the revision and answer cost and schedule impact."}${invite[0] && !invite[0].revokedAt ? `\n\nSecure portal: ${new URL(request.url).origin}/?vendorPortal=${invite[0].id}` : "\n\nContact Mefford for a secure portal invitation before first access."}\n\nYour disposition does not make this the Current Set; Mefford PM release remains required.`,
    }) : "Contact Missing";
    return Response.json({ saved: true, package: toClientPackage({ ...row, status: "Consultant Review", dataJson: JSON.stringify(nextData), updatedAt: now }), emailDelivery });
  }

  if (input.action === "release-current-set") {
    if (scope !== "Project" || !permissions.canReleaseCurrentSet) return Response.json({ error: "Only A Project Manager May Release The Official Current Set" }, { status: 403 });
    if (row.status !== "Designer Approved" || !versions.length) return Response.json({ error: "Designer Approval Is Required Before PM Release" }, { status: 409 });
    const latest = versions.at(-1)!;
    if (!["Approved", "Approved As Noted"].includes(String(latest.designerDecision || ""))) return Response.json({ error: "The Latest Revision Does Not Have An Approved Designer Disposition" }, { status: 409 });
    const issuedPurpose = input.issuedPurpose?.trim() || "";
    if (!issuedPurpose) return Response.json({ error: "Choose The Official Issue Purpose" }, { status: 400 });
    const nextVersions = versions.map((version) => ({
      ...version,
      isCurrent: version.id === latest.id,
      releasedBy: version.id === latest.id ? actor.name : version.releasedBy,
      releasedAt: version.id === latest.id ? now : version.releasedAt,
      issuedPurpose: version.id === latest.id ? issuedPurpose : version.issuedPurpose,
    }));
    const nextData = {
      ...data,
      phase: issuedPurpose === "Record / As-Built" ? "Record / As-Built" : data.phase,
      versions: nextVersions,
      currentVersionId: latest.id,
      currentSetReleasedBy: actor.name,
      currentSetReleasedAt: now,
      issuedPurpose,
      distributionList: input.distributionList || [],
      releaseNote: input.releaseNote?.trim() || "",
      timeline: [...timeline, { action: "Official Current Set Released", actor: actor.name, at: now, detail: `${String(latest.label || "Latest Revision")} · ${issuedPurpose}` }],
    };
    const nextStatus = issuedPurpose === "Record / As-Built" ? "Record Set" : "Current Set";
    await updatePackage(db, row, nextStatus, nextData, actor, `PM released ${String(latest.label || "latest revision")} as ${issuedPurpose}`);
    const teamRows = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "DESIGN-TEAM"), eq(commandRecords.recordType, DESIGN_TEAM_RECORD_TYPE))).limit(1);
    if (teamRows[0]) {
      const teamData = parseData(teamRows[0].dataJson);
      const autoCompleteIds = new Set(["designer-approval", "pm-current-set", ...(issuedPurpose === "Record / As-Built" ? ["record-closeout"] : [])]);
      const checklist = normalizeDesignChecklist(teamData.checklist).map((item) => autoCompleteIds.has(item.id) ? { ...item, completed: true, completedBy: actor.name, completedAt: now, note: `${String(latest.label || "Latest revision")} · ${issuedPurpose}` } : item);
      await db.update(commandRecords).set({ dataJson: JSON.stringify({ ...teamData, checklist }), updatedAt: now }).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, "DESIGN-TEAM")));
    }
    const consultantVendorId = String(data.consultantVendorId || "");
    const consultant = consultantVendorId ? await db.select().from(vendorProfiles).where(eq(vendorProfiles.id, consultantVendorId)).limit(1) : [];
    const emailDelivery = consultant[0] ? await sendDesignOperationalEmail(request, {
      senderEmail: actor.email,
      to: consultant[0].contactEmail,
      subject: `Mefford Official ${nextStatus} · ${row.title}`,
      text: `${consultant[0].contactName},\n\n${actor.name} released ${String(latest.label || "the approved revision")} as ${issuedPurpose} for ${row.title}. It is now the official ${nextStatus}.\n\nThis operational notice does not change the contract amount or schedule dates.`,
    }) : "Not Required";
    return Response.json({ saved: true, package: toClientPackage({ ...row, status: nextStatus, dataJson: JSON.stringify(nextData), updatedAt: now }), emailDelivery });
  }

  return Response.json({ error: "A Valid Design Lifecycle Action Is Required" }, { status: 400 });
}

async function designPermissions(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  actor: ReturnType<typeof getCommandActor>,
  project?: typeof projects.$inferSelect,
) {
  const members = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  let designations: string[] = [];
  try { designations = JSON.parse(members[0]?.designationsJson || "[]") as string[]; } catch { designations = []; }
  const accessLevel = members[0]?.companyAccessLevel || actor.accessLevel;
  const elevated = ["Company Owner", "Administrator"].includes(accessLevel);
  const projectRoles = project ? await projectDesignationsFor(db, actor, project, designations) : [];
  const isPm = projectRoles.includes("Project Manager");
  const isSuper = projectRoles.includes("Superintendent");
  return {
    canManageSales: elevated || designations.includes("Estimator") || designations.includes("Sales Representative"),
    canViewProject: elevated || isPm || isSuper || designations.includes("Office Staff"),
    canManageProject: elevated || isPm,
    canReleaseCurrentSet: isPm,
  };
}

async function nextDesignId(db: ReturnType<(typeof import("../../../db"))["getDb"]>, projectId: string) {
  const rows = await db.select({ id: commandRecords.id }).from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, DESIGN_RECORD_TYPE)));
  const next = rows.reduce((maximum, row) => Math.max(maximum, Number(row.id.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
  return `DSN-${String(next).padStart(3, "0")}`;
}

async function updatePackage(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  row: typeof commandRecords.$inferSelect,
  status: string,
  data: Record<string, unknown>,
  actor: ReturnType<typeof getCommandActor>,
  summary: string,
) {
  const now = new Date().toISOString();
  await db.update(commandRecords).set({ status, dataJson: JSON.stringify(data), updatedAt: now }).where(and(eq(commandRecords.projectId, row.projectId), eq(commandRecords.id, row.id)));
  await audit(db, row.projectId, row.id, actor, "Design Status", row.status, status, summary);
}

async function audit(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  projectId: string,
  recordId: string,
  actor: { name: string; email: string },
  fieldName: string,
  oldValue: string,
  newValue: string,
  summary: string,
) {
  await db.insert(recordAudits).values({
    projectId, recordId, fieldName, oldValue, newValue,
    reason: summary, actorName: actor.name, actorEmail: actor.email,
    summary: `${recordId} · ${summary}`,
  });
}

function toClientPackage(row: typeof commandRecords.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    due: row.due,
    status: row.status,
    meta: row.meta,
    data: parseData(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function designTeamDisciplineForPackage(discipline: string) {
  if (["Mechanical", "Electrical", "Plumbing"].includes(discipline)) return "MEP";
  if (["Architecture", "Structural", "Civil"].includes(discipline)) return discipline;
  return "Miscellaneous";
}

async function grantDesignAccess(
  db: ReturnType<(typeof import("../../../db"))["getDb"]>,
  vendorId: string,
  projectId: string,
  projectName: string,
  discipline: string,
  grantedBy: string,
  now: string,
) {
  const id = `${vendorId}:${projectId}`;
  const existing = await db.select().from(vendorProjectAccess).where(eq(vendorProjectAccess.id, id)).limit(1);
  const permissions = new Set(parseStringArray(existing[0]?.permissionsJson || "[]"));
  const sharedRecords = new Set(parseStringArray(existing[0]?.sharedRecordsJson || "[]"));
  permissions.add("Design Review");
  permissions.add("Design Upload");
  sharedRecords.add(DESIGN_RECORD_TYPE);
  await db.insert(vendorProjectAccess).values({
    id,
    vendorId,
    projectId,
    projectName,
    status: existing[0]?.status || "Active",
    trade: discipline,
    contractReference: existing[0]?.contractReference || "",
    costCode: existing[0]?.costCode || "Unassigned",
    committedAmount: existing[0]?.committedAmount || "0",
    permissionsJson: JSON.stringify([...permissions]),
    sharedRecordsJson: JSON.stringify([...sharedRecords]),
    grantedBy,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: vendorProjectAccess.id,
    set: {
      projectName,
      trade: discipline,
      permissionsJson: JSON.stringify([...permissions]),
      sharedRecordsJson: JSON.stringify([...sharedRecords]),
      updatedAt: now,
    },
  });
}

async function sendDesignOperationalEmail(
  request: Request,
  input: { to: string; subject: string; text: string; senderEmail?: string },
) {
  const delivery = await sendOperationalEmail({ to: input.to, senderEmail: input.senderEmail, subject: input.subject, text: `${input.text}\n\nOpen Mefford Project Command: ${new URL(request.url).origin}`, idempotencyKey: `design:${input.to}:${input.subject}`, safeguards: { sendInvoice: false, postInvoice: false, executeContract: false, approveCost: false } });
  return delivery.outcome === "Provider Accepted" ? `Provider Accepted · ${delivery.providerReceiptId}` : delivery.outcome === "Deferred" ? "Delivery Deferred · Connection Required" : `${delivery.outcome} · ${delivery.error}`;
}
