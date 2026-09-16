import { and, eq } from "drizzle-orm";
import {
  commandNotifications,
  commandRecords,
  companyMembers,
  recordAudits,
} from "../../../db/schema";
import { MEFFORD_COMPANY_DIRECTORY } from "../../company-directory";
import {
  DEFAULT_ONBOARDING_REQUIREMENTS,
  ONBOARDING_TEMPLATE_ID,
  PEOPLE_PROJECT_ID,
  easternDate,
  employeeRecordId,
  mergeOnboardingRequirements,
  onboardingState,
  parseEmployeeData,
  requirementsForEmployee,
  type EmployeeOnboardingData,
  type OnboardingRequirement,
} from "../../../lib/onboarding";
import { resolveCommandActor } from "../../../lib/server-actor";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";

type OnboardingPayload = {
  action?: "create_employee" | "issue_login" | "update_employee" | "complete_requirement" | "activate" | "grant_extension" | "terminate" | "add_requirement" | "attach_requirement_content" | "publish_requirement_content";
  employeeEmail?: string;
  name?: string;
  hireDate?: string;
  birthDate?: string;
  position?: string;
  department?: "Office" | "Field" | "Leadership";
  supervisor?: string;
  workLocation?: string;
  checklistOwner?: string;
  accessLevel?: "Company Owner" | "Administrator" | "Employee";
  designations?: string[];
  requirementId?: string;
  score?: number;
  attestation?: string;
  extensionReason?: string;
  requirement?: Partial<OnboardingRequirement>;
  contentFile?: { id?: number; name?: string; contentType?: string; uploadedAt?: string; uploadedBy?: string };
  reviewNote?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  try {
    const db = await peopleDatabase();
    await seedPeopleWorkspace(db);
    const admin = await canAdministerOnboarding(db, actor.email, actor.accessLevel);
    const [templateRows, employeeRows, memberRows] = await Promise.all([
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, ONBOARDING_TEMPLATE_ID))).limit(1),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.recordType, "Employee Onboarding"))),
      db.select({ email: companyMembers.email, designationsJson: companyMembers.designationsJson, isActive: companyMembers.isActive, identityProvider: companyMembers.identityProvider }).from(companyMembers),
    ]);
    const templateData = parseData(templateRows[0]?.dataJson || "{}");
    const requirements = mergeOnboardingRequirements(
      Array.isArray(templateData.requirements)
        ? templateData.requirements as OnboardingRequirement[]
        : [],
    );
    const memberByEmail = new Map(memberRows.map((member) => [member.email, member]));
    const liveDesignations = new Map(memberRows.map((member) => [member.email, parseStringList(member.designationsJson)]));
    const allEmployees = employeeRows
      .map((row) => parseEmployeeData(row.dataJson))
      .filter((employee): employee is EmployeeOnboardingData => Boolean(employee))
      .map((employee) => ({ ...employee, designations: liveDesignations.get(employee.email) || employee.designations }))
      .map((employee) => {
        const member = memberByEmail.get(employee.email);
        return {
          ...onboardingState(employee, requirements),
          loginIssued: Boolean(member?.isActive),
          identityProvider: member?.identityProvider || "not_issued",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const currentEmployee = allEmployees.find((employee) => employee.email === actor.email) || null;
    if (currentEmployee && !currentEmployee.loginIssued && !admin) {
      return Response.json({ error: "Your Mefford Company Login Has Not Been Issued Yet", loginRequired: true }, { status: 403 });
    }
    const effectiveAdmin = admin && currentEmployee?.permissionLocked !== true;
    return Response.json({
      canAdminister: effectiveAdmin,
      currentEmployee,
      employees: effectiveAdmin ? allEmployees : currentEmployee ? [currentEmployee] : [],
      template: {
        requirements,
        version: "2026.4 · Legal Review Master",
        annualRenewal: true,
        reminderPolicy: "In-App Reminders And Administrator Escalation",
        annualRenewalReminderPolicy: "In-App At 30 14 And 7 Days Then Daily Through The Deadline",
        extensionPolicy: "Administrator May Grant One Documented Extension Up To Seven Days",
      },
      microsoftEmailStatus: "EMAIL DELIVERY OFF · IN-APP REMINDERS ACTIVE",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Onboarding Is Unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  try {
    const payload = await request.json() as OnboardingPayload;
    const db = await peopleDatabase();
    await seedPeopleWorkspace(db);
    const action = payload.action || "complete_requirement";
    const targetEmail = (payload.employeeEmail || actor.email).trim().toLowerCase();
    const actorMemberRows = await db.select({ isActive: companyMembers.isActive }).from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1);
    const actorAdmin = await canAdministerOnboarding(db, actor.email, actor.accessLevel);
    if (actorMemberRows[0] && !actorMemberRows[0].isActive && !actorAdmin) {
      return Response.json({ error: "Your Mefford Company Login Has Not Been Issued Yet", loginRequired: true }, { status: 403 });
    }
    const actorEmployee = await loadEmployee(db, actor.email);
    const actorLocked = actorEmployee
      ? onboardingState(actorEmployee, await loadRequirements(db)).permissionLocked
      : actor.accessLevel !== "Company Owner";
    if (actorLocked && (targetEmail !== actor.email || action !== "complete_requirement")) {
      return Response.json(
        { error: "Complete Your Own Required Onboarding Items And Wait For Administrator Activation Before Using Company Administration" },
        { status: 423 },
      );
    }
    const admin = !actorLocked && await canAdministerOnboarding(db, actor.email, actor.accessLevel);
    if (targetEmail !== actor.email && !admin) {
      return Response.json({ error: "Administrator Access Is Required" }, { status: 403 });
    }

    if (action === "create_employee") {
      if (!admin) return administratorRequired();
      if (!payload.name?.trim() || !targetEmail.endsWith("@meffcon.com") || !payload.hireDate || !payload.accessLevel) {
        return Response.json({ error: "Name Mefford Email Hire Date And Access Level Are Required" }, { status: 400 });
      }
      const existing = await loadEmployee(db, targetEmail);
      if (existing) return Response.json({ error: "This Employee Already Exists" }, { status: 409 });
      const employee: EmployeeOnboardingData = {
        email: targetEmail,
        name: titleCase(payload.name),
        hireDate: payload.hireDate,
        birthDate: payload.birthDate || "",
        position: payload.position?.trim() || cleanDesignations(payload.designations)[0] || "New Employee",
        department: payload.department || "Office",
        supervisor: payload.supervisor?.trim() || "To Be Assigned",
        workLocation: payload.workLocation?.trim() || "To Be Assigned",
        checklistOwner: payload.checklistOwner?.trim() || actor.name,
        thirtyDayReviewDate: addDays(payload.hireDate, 30),
        accessLevel: payload.accessLevel,
        designations: cleanDesignations(payload.designations),
        lifecycleStatus: "Onboarding Required",
        grandfathered: false,
        completions: {},
      };
      await Promise.all([
        saveEmployee(db, employee, actor.name, "New Employee Record Created With Dormant Permissions"),
        db.insert(companyMembers).values({
          email: targetEmail,
          displayName: employee.name,
          companyAccessLevel: employee.accessLevel,
          designationsJson: JSON.stringify(employee.designations),
          isActive: false,
          identityProvider: "not_issued",
        }).onConflictDoUpdate({
          target: companyMembers.email,
          set: {
            displayName: employee.name,
            companyAccessLevel: employee.accessLevel,
            designationsJson: JSON.stringify(employee.designations),
            isActive: false,
            identityProvider: "not_issued",
            updatedAt: new Date().toISOString(),
          },
        }),
      ]);
      let microsoftFileWorkspace: Awaited<ReturnType<(typeof import("../../../lib/sharepoint-storage"))["registerSharePointWorkspace"]>> | null = null;
      let microsoftFileWarning = "";
      try {
        const { registerSharePointWorkspace } = await import("../../../lib/sharepoint-storage");
        microsoftFileWorkspace = await registerSharePointWorkspace({
          entityType: "Employee",
          entityId: employee.email,
          displayName: employee.name,
          sourceProjectId: PEOPLE_PROJECT_ID,
          sourceRecordId: employeeRecordId(employee.email),
          actorName: actor.name,
          actorEmail: actor.email,
        });
      } catch (error) {
        microsoftFileWarning = error instanceof Error ? error.message : "Microsoft Employee File Mapping Could Not Be Registered";
      }
      return Response.json({ saved: true, employee: { ...onboardingState(employee, DEFAULT_ONBOARDING_REQUIREMENTS), loginIssued: false, identityProvider: "not_issued" }, microsoftFileWorkspace, microsoftFileWarning }, { status: 201 });
    }

    const employee = await loadEmployee(db, targetEmail);
    if (!employee) return Response.json({ error: "Employee Onboarding Record Was Not Found" }, { status: 404 });
    const template = await loadRequirements(db);
    const before = onboardingState(employee, template);

    if (action === "issue_login") {
      if (!admin) return administratorRequired();
      const memberRows = await db.select().from(companyMembers).where(eq(companyMembers.email, targetEmail)).limit(1);
      const member = memberRows[0];
      if (!member) return Response.json({ error: "The Employee Directory Record Was Not Found" }, { status: 404 });
      if (!targetEmail.endsWith("@meffcon.com")) return Response.json({ error: "A Mefford Microsoft Login Is Required" }, { status: 400 });
      const now = new Date().toISOString();
      await Promise.all([
        db.update(companyMembers).set({ isActive: true, identityProvider: "microsoft_entra_issued", updatedAt: now }).where(eq(companyMembers.email, targetEmail)),
        db.insert(recordAudits).values({ projectId: PEOPLE_PROJECT_ID, recordId: `MEMBER-${targetEmail}`, fieldName: "Company Login", oldValue: member.identityProvider || "not_issued", newValue: "microsoft_entra_issued", reason: "Administrator recorded that the employee login was issued through the normal company account process", actorName: actor.name, actorEmail: actor.email, summary: `${actor.name} recorded the company login issued for ${employee.name}.`, createdAt: now }),
      ]);
      await saveEmployee(db, employee, actor.name, "Company Login Issued; Onboarding-Only Portal Access Enabled");
    } else if (action === "update_employee") {
      if (!admin) return administratorRequired();
      if (!payload.hireDate) return Response.json({ error: "Original Hire Date Is Required" }, { status: 400 });
      employee.hireDate = payload.hireDate;
      if (typeof payload.birthDate === "string") employee.birthDate = payload.birthDate;
      if (payload.name?.trim()) employee.name = titleCase(payload.name);
      if (payload.position?.trim()) employee.position = payload.position.trim();
      if (payload.department) employee.department = payload.department;
      if (payload.supervisor?.trim()) employee.supervisor = payload.supervisor.trim();
      if (payload.workLocation?.trim()) employee.workLocation = payload.workLocation.trim();
      if (payload.checklistOwner?.trim()) employee.checklistOwner = payload.checklistOwner.trim();
      employee.thirtyDayReviewDate = addDays(payload.hireDate, 30);
      if (payload.accessLevel) employee.accessLevel = payload.accessLevel;
      if (payload.designations) employee.designations = cleanDesignations(payload.designations);
      await saveEmployee(db, employee, actor.name, "Employee Onboarding Profile Updated");
    } else if (action === "complete_requirement") {
      if (targetEmail !== actor.email && !admin) return administratorRequired();
      const requirement = requirementsForEmployee(template, employee.designations, employee.department).find((item) => item.id === payload.requirementId);
      if (!requirement) return Response.json({ error: "Required Onboarding Item Was Not Found" }, { status: 404 });
      if (requirement.status !== "Ready") {
        return Response.json({ error: "Required Content Must Be Uploaded And Published Before This Item Can Be Completed" }, { status: 409 });
      }
      if (requirement.annual && !employee.hireDate) {
        return Response.json({ error: "The Original Hire Date Is Required Before An Annual Requirement Can Be Completed" }, { status: 409 });
      }
      if (!admin && ["Supervisor Verification", "Guided Review"].includes(requirement.method)) {
        return Response.json({ error: `${requirement.responsible} Must Verify This Checklist Item` }, { status: 403 });
      }
      if (requirement.method === "Quiz" && Number(payload.score || 100) < 80) {
        return Response.json({ error: "A Score Of 80% Is Required Before This Training Is Complete" }, { status: 409 });
      }
      const cycle = requirement.annual ? String(before.cycleYear) : "initial";
      employee.completions = {
        ...(employee.completions || {}),
        [`${cycle}:${requirement.id}`]: {
          completedAt: new Date().toISOString(),
          completedBy: actor.name,
          method: requirement.method,
          score: requirement.method === "Quiz" ? Number(payload.score || 100) : undefined,
          attestation: payload.attestation?.trim() || `${actor.name} Confirmed Completion And Acknowledgement`,
        },
      };
      await saveEmployee(db, employee, actor.name, `${requirement.title} Completed For ${cycle === "initial" ? "Initial Onboarding" : cycle}`);
    } else if (action === "activate") {
      if (!admin) return administratorRequired();
      const loginRows = await db.select({ isActive: companyMembers.isActive, identityProvider: companyMembers.identityProvider }).from(companyMembers).where(eq(companyMembers.email, targetEmail)).limit(1);
      if (!loginRows[0]?.isActive || loginRows[0]?.identityProvider === "not_issued") {
        return Response.json({ error: "Record The Company Login As Issued Before Full Command Center Access Can Be Unlocked" }, { status: 409 });
      }
      if (!["Ready For Activation", "Ready For Reactivation"].includes(before.status)) {
        return Response.json({ error: "Every Assigned Requirement Must Be Complete Before Administrator Verification" }, { status: 409 });
      }
      employee.initialActivatedAt ||= new Date().toISOString();
      employee.lastApprovedCycle = before.cycleYear;
      employee.lastApprovedBy = actor.name;
      employee.extensionUntil = "";
      employee.extensionReason = "";
      employee.lifecycleStatus = "Active";
      await saveEmployee(db, employee, actor.name, `Administrator Verified Onboarding For Cycle ${before.cycleYear}; Company Owner Access Approval Remains Required`);
      const { env } = await import("cloudflare:workers");
      await recordCompletedWorkflowHandoff(env.DB, { workflowId: "employee-lifecycle", eventId: `employee-access-activated:${targetEmail}:${before.cycleYear}`, aggregateType: "Employee Onboarding", aggregateId: employeeRecordId(targetEmail), projectId: PEOPLE_PROJECT_ID, actorName: actor.name, actorEmail: actor.email, payload: { employeeEmail: targetEmail, cycleYear: before.cycleYear, loginIssued: true, lifecycleStatus: "Active" } });
    } else if (action === "grant_extension") {
      if (!admin) return administratorRequired();
      if (!payload.extensionReason?.trim()) return Response.json({ error: "A Written Extension Explanation Is Required" }, { status: 400 });
      const start = before.deadline && before.deadline > easternDate() ? before.deadline : easternDate();
      employee.extensionUntil = addDays(start, 7);
      employee.extensionReason = payload.extensionReason.trim();
      employee.extensionGrantedBy = actor.name;
      employee.lifecycleStatus = "Extension Active";
      await saveEmployee(db, employee, actor.name, `Seven-Day Annual Renewal Extension Granted Through ${employee.extensionUntil}`);
    } else if (action === "terminate") {
      if (!admin) return administratorRequired();
      if (!payload.attestation?.trim()) return Response.json({ error: "A Written Offboarding Reason Is Required" }, { status: 400 });
      employee.terminatedAt = new Date().toISOString();
      employee.lifecycleStatus = "Terminated";
      await Promise.all([
        saveEmployee(db, employee, actor.name, `Access Terminated Immediately. ${payload.attestation.trim()}`),
        db.update(companyMembers).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(companyMembers.email, targetEmail)),
      ]);
    } else if (action === "add_requirement") {
      if (!admin) return administratorRequired();
      const requirement = normalizeRequirement(payload.requirement);
      if (!requirement) return Response.json({ error: "Complete Requirement Information Is Required" }, { status: 400 });
      const next = [...template.filter((item) => item.id !== requirement.id), requirement];
      await saveTemplate(db, next, actor.name);
    } else if (action === "attach_requirement_content") {
      if (!admin) return administratorRequired();
      const requirement = template.find((item) => item.id === payload.requirementId);
      const file = payload.contentFile;
      if (!requirement || !Number.isInteger(Number(file?.id)) || !file?.name?.trim()) {
        return Response.json({ error: "A Stored File And Onboarding Requirement Are Required" }, { status: 400 });
      }
      const next = template.map((item) => item.id === requirement.id ? {
        ...item,
        status: "Pending Review" as const,
        contentReview: undefined,
        contentFiles: [...(item.contentFiles || []), {
          id: Number(file.id),
          name: file.name!.trim(),
          contentType: file.contentType || "application/octet-stream",
          uploadedAt: file.uploadedAt || new Date().toISOString(),
          uploadedBy: file.uploadedBy || actor.name,
        }],
      } : item);
      await saveTemplate(db, next, actor.name);
    } else if (action === "publish_requirement_content") {
      if (!admin) return administratorRequired();
      const requirement = template.find((item) => item.id === payload.requirementId);
      const currentFile = requirement?.contentFiles?.at(-1);
      if (!requirement || !currentFile || requirement.status !== "Pending Review" || (payload.reviewNote?.trim().length || 0) < 10) {
        return Response.json({ error: "The Current File And A Specific Reviewer Approval Note Are Required" }, { status: 400 });
      }
      const next = template.map((item) => item.id === requirement.id ? {
        ...item,
        status: "Ready" as const,
        contentReview: { fileId: currentFile.id, reviewedAt: new Date().toISOString(), reviewedBy: actor.name, reviewNote: payload.reviewNote!.trim() },
      } : item);
      await saveTemplate(db, next, actor.name);
    }

    const templateChanged = ["add_requirement", "attach_requirement_content", "publish_requirement_content"].includes(action);
    const updated = templateChanged ? employee : await loadEmployee(db, targetEmail) || employee;
    const nextTemplate = templateChanged ? await loadRequirements(db) : template;
    const state = onboardingState(updated, nextTemplate);
    if (["Ready For Activation", "Ready For Reactivation"].includes(state.status) && before.status !== state.status) {
      await notifyAdministrators(db, `${state.name} Is Ready For Access Review`, `${state.name} completed every assigned ${state.cycleYear} onboarding requirement. Administrator verification and Company Owner access approval are still required.`);
    }
    return Response.json({ saved: true, employee: state, requirements: nextTemplate });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Onboarding Update Could Not Be Saved" }, { status: 500 });
  }
}

async function peopleDatabase() {
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_records (project_id text NOT NULL, id text NOT NULL, record_type text NOT NULL, title text NOT NULL, owner text NOT NULL, due text NOT NULL, status text NOT NULL, meta text DEFAULT '' NOT NULL, record_date text, record_time text, date_locked integer DEFAULT false NOT NULL, data_json text DEFAULT '{}' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, PRIMARY KEY(project_id, id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_members (email text PRIMARY KEY NOT NULL, display_name text NOT NULL, company_access_level text NOT NULL, designations_json text DEFAULT '[]' NOT NULL, is_active integer DEFAULT true NOT NULL, identity_provider text DEFAULT 'microsoft_entra_pending' NOT NULL, provider_subject text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS record_audits (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, project_id text NOT NULL, record_id text NOT NULL, field_name text NOT NULL, old_value text NOT NULL, new_value text NOT NULL, reason text NOT NULL, actor_name text NOT NULL, actor_email text NOT NULL, summary text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS command_notifications (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, project_id text NOT NULL, recipient_name text NOT NULL, recipient_email text, kind text NOT NULL, title text NOT NULL, message text NOT NULL, is_read integer DEFAULT false NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)`),
  ]);
  const { getDb } = await import("../../../db");
  return getDb();
}

async function seedPeopleWorkspace(db: Awaited<ReturnType<typeof peopleDatabase>>) {
  const now = new Date().toISOString();
  await db.insert(commandRecords).values({
    projectId: PEOPLE_PROJECT_ID,
    id: ONBOARDING_TEMPLATE_ID,
    recordType: "Onboarding Template",
    title: "Mefford Employee Onboarding Master",
    owner: "Company Administration",
    due: easternDate(),
    status: "Content Upload Required",
    meta: "Annual Renewal · Role-Based Requirements · Controlled Review",
    recordDate: easternDate(),
    dateLocked: true,
    dataJson: JSON.stringify({ version: "2026.1", requirements: DEFAULT_ONBOARDING_REQUIREMENTS }),
  }).onConflictDoNothing();

  const storedTemplate = await db
    .select({ dataJson: commandRecords.dataJson })
    .from(commandRecords)
    .where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, ONBOARDING_TEMPLATE_ID)))
    .limit(1);
  const storedData = parseData(storedTemplate[0]?.dataJson || "{}");
  const mergedRequirements = mergeOnboardingRequirements(
    Array.isArray(storedData.requirements)
      ? storedData.requirements as OnboardingRequirement[]
      : [],
  );
  if (String(storedData.version || "") !== "2026.4") {
    await db.update(commandRecords).set({
      status: templateStatus(mergedRequirements),
      meta: `${mergedRequirements.length} Controlled Checklist Requirements`,
      dataJson: JSON.stringify({ version: "2026.4", requirements: mergedRequirements }),
      updatedAt: now,
    }).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, ONBOARDING_TEMPLATE_ID)));
  }

  for (const member of MEFFORD_COMPANY_DIRECTORY) {
    await db.insert(companyMembers).values({
      email: member.email,
      displayName: member.name,
      companyAccessLevel: member.accessLevel,
      designationsJson: JSON.stringify(member.defaultDesignations),
      isActive: true,
      identityProvider: "microsoft_entra_pending",
    }).onConflictDoNothing();
    const employee: EmployeeOnboardingData = {
      email: member.email,
      name: member.name,
      hireDate: "",
      position: member.defaultDesignations[0] || "Company Leadership",
      department: member.defaultDesignations.includes("Superintendent") ? "Field" : "Leadership",
      supervisor: "Company Leadership",
      workLocation: "Mefford Company Operations",
      checklistOwner: "Company Administration",
      accessLevel: member.accessLevel,
      designations: member.defaultDesignations,
      lifecycleStatus: "Active",
      grandfathered: true,
      initialActivatedAt: now,
      completions: {},
    };
    await db.insert(commandRecords).values({
      projectId: PEOPLE_PROJECT_ID,
      id: employeeRecordId(member.email),
      recordType: "Employee Onboarding",
      title: `${member.name} Employee Lifecycle`,
      owner: member.name,
      due: easternDate(),
      status: "Hire Date Required",
      meta: `${member.accessLevel} · Existing Employee`,
      recordDate: easternDate(),
      dataJson: JSON.stringify(employee),
    }).onConflictDoNothing();
  }

}

async function loadEmployee(db: Awaited<ReturnType<typeof peopleDatabase>>, email: string) {
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, employeeRecordId(email)))).limit(1);
  return parseEmployeeData(rows[0]?.dataJson || "");
}

async function loadRequirements(db: Awaited<ReturnType<typeof peopleDatabase>>) {
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, ONBOARDING_TEMPLATE_ID))).limit(1);
  const data = parseData(rows[0]?.dataJson || "{}");
  return mergeOnboardingRequirements(
    Array.isArray(data.requirements) ? data.requirements as OnboardingRequirement[] : [],
  );
}

async function saveEmployee(db: Awaited<ReturnType<typeof peopleDatabase>>, employee: EmployeeOnboardingData, actorName: string, audit: string) {
  const state = onboardingState(employee, await loadRequirements(db));
  const now = new Date().toISOString();
  await db.insert(commandRecords).values({
    projectId: PEOPLE_PROJECT_ID,
    id: employeeRecordId(employee.email),
    recordType: "Employee Onboarding",
    title: `${employee.name} Employee Lifecycle`,
    owner: employee.name,
    due: state.deadline || easternDate(),
    status: state.status,
    meta: `${employee.accessLevel} · ${state.progress}% Complete`,
    recordDate: employee.hireDate || easternDate(),
    dateLocked: state.permissionLocked,
    dataJson: JSON.stringify(employee),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [commandRecords.projectId, commandRecords.id],
    set: { due: state.deadline || easternDate(), status: state.status, meta: `${employee.accessLevel} · ${state.progress}% Complete`, recordDate: employee.hireDate || easternDate(), dateLocked: state.permissionLocked, dataJson: JSON.stringify(employee), updatedAt: now },
  });
  await db.insert(recordAudits).values({
    projectId: PEOPLE_PROJECT_ID,
    recordId: employeeRecordId(employee.email),
    fieldName: "Employee Lifecycle",
    oldValue: "Previous State",
    newValue: state.status,
    reason: audit,
    actorName,
    actorEmail: "Command Center Actor",
    summary: `${actorName}: ${audit}`,
  });
}

async function saveTemplate(db: Awaited<ReturnType<typeof peopleDatabase>>, requirements: OnboardingRequirement[], actorName: string) {
  await db.update(commandRecords).set({
    status: templateStatus(requirements),
    meta: `${requirements.length} Requirements · Updated By ${actorName}`,
    dataJson: JSON.stringify({ version: "2026.4", requirements }),
    updatedAt: new Date().toISOString(),
  }).where(and(eq(commandRecords.projectId, PEOPLE_PROJECT_ID), eq(commandRecords.id, ONBOARDING_TEMPLATE_ID)));
}

async function canAdministerOnboarding(db: Awaited<ReturnType<typeof peopleDatabase>>, email: string, actorLevel: string) {
  if (["Company Owner", "Administrator"].includes(actorLevel)) return true;
  const rows = await db.select({ level: companyMembers.companyAccessLevel }).from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
  return ["Company Owner", "Administrator"].includes(rows[0]?.level || "");
}

async function notifyAdministrators(db: Awaited<ReturnType<typeof peopleDatabase>>, title: string, message: string) {
  const members = await db.select({ name: companyMembers.displayName, email: companyMembers.email, level: companyMembers.companyAccessLevel }).from(companyMembers).where(eq(companyMembers.isActive, true));
  const recipients = members.filter((member) => ["Company Owner", "Administrator"].includes(member.level));
  if (!recipients.length) return;
  await db.insert(commandNotifications).values(recipients.map((recipient) => ({ projectId: PEOPLE_PROJECT_ID, recipientName: recipient.name, recipientEmail: recipient.email, kind: "Employee Onboarding", title, message, isRead: false })));
}

function normalizeRequirement(input?: Partial<OnboardingRequirement>) {
  if (!input?.title?.trim() || !input.category || !input.method || !input.reviewer) return null;
  return {
    id: input.id || `REQ-${Date.now()}`,
    title: titleCase(input.title),
    category: input.category,
    section: input.section || "Company-Added Requirements",
    method: input.method,
    annual: input.annual !== false,
    designations: cleanDesignations(input.designations),
    departments: cleanDesignations(input.departments),
    reviewer: input.reviewer,
    responsible: input.responsible || input.reviewer,
    dueOffsetDays: Number(input.dueOffsetDays || 0),
    blocksActivation: input.blocksActivation !== false,
    status: input.status || "Draft Content",
  } as OnboardingRequirement;
}

function templateStatus(requirements: OnboardingRequirement[]) {
  if (requirements.some((item) => item.status === "Draft Content")) return "Content Upload Required";
  if (requirements.some((item) => item.status === "Pending Review")) return "Reviewer Approval Required";
  return "Published";
}

function cleanDesignations(value?: string[]) {
  return [...new Set((value || []).map((item) => item.trim()).filter(Boolean))];
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringList(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function titleCase(value: string) {
  return value.trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function administratorRequired() {
  return Response.json({ error: "A Company Owner Or Administrator Is Required" }, { status: 403 });
}
