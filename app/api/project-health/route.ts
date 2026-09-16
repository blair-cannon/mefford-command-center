import { and, desc, eq, inArray } from "drizzle-orm";
import {
  accountingWipForecasts,
  commandRecords,
  commandWorkItems,
  companyMembers,
  projects,
  recordAudits,
  workItemAudits,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import {
  PROJECT_HEALTH_WEIGHTS,
  PROTECTED_HEALTH_RULES,
  calculateProjectHealth,
} from "../../../lib/project-health-core.js";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import { ensureVendorSchema } from "../../../lib/vendor-portal";

const COMPANY_ID = "MEFFORD-COMPANY";
const RULE_TYPE = "Project Health Rules";
const EXCEPTION_TYPE = "Project Health Rule Exceptions";
const SNAPSHOT_TYPE = "Project Health Daily Snapshots";
const EVENT_TYPE = "Project Health Events";
const INTERNAL_TYPES = [RULE_TYPE, EXCEPTION_TYPE, SNAPSHOT_TYPE, EVENT_TYPE];

type HealthRole = "Owner/Admin" | "Project Manager" | "Superintendent";
type HealthContext = {
  name: string;
  email: string;
  accessLevel: string;
  designations: string[];
  role: HealthRole;
  canManageRules: boolean;
};

type ProjectRow = typeof projects.$inferSelect;
type RecordRow = typeof commandRecords.$inferSelect;

type HealthPayload = {
  action?: "create-rule" | "set-rule-enabled" | "request-exception" | "decide-exception" | "recalculate";
  projectId?: string;
  ruleId?: string;
  enabled?: boolean;
  name?: string;
  description?: string;
  category?: string;
  deduction?: number;
  recordType?: string;
  statusIncludes?: string;
  overdueOnly?: boolean;
  targetRole?: "Project Manager" | "Superintendent";
  recommendedAction?: string;
  reason?: string;
  mitigation?: string;
  expiresAt?: string;
  decision?: "Approved" | "Rejected";
  decisionNote?: string;
};

export async function reconcileProjectHealthAfterUpdate(
  projectId: string,
  actor: { name: string; email: string },
) {
  if (!projectId || projectId.startsWith("MEFFORD-")) return;
  const db = await healthDb();
  const projectRows = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
  const project = projectRows[0];
  if (!project) return;
  const [recordRows, memberRows, forecastRows] = await Promise.all([
    db.select().from(commandRecords).where(inArray(commandRecords.projectId, [projectId, COMPANY_ID])),
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    db.select().from(accountingWipForecasts).where(eq(accountingWipForecasts.projectId, projectId)).orderBy(desc(accountingWipForecasts.periodId), desc(accountingWipForecasts.updatedAt)).limit(1),
  ]);
  const customRules = recordRows.filter((row) => row.projectId === COMPANY_ID && row.recordType === RULE_TYPE).map((row) => ({ id: row.id, ...parseData(row.dataJson) }));
  const exceptions = recordRows.filter((row) => row.projectId === projectId && row.recordType === EXCEPTION_TYPE).map((row) => ({ id: row.id, ...parseData(row.dataJson) }));
  const today = new Date().toISOString().slice(0, 10);
  const health = calculateProjectHealth({
    today,
    calculatedAt: new Date().toISOString(),
    project,
    records: recordRows.filter((row) => row.projectId === projectId && !INTERNAL_TYPES.includes(row.recordType)).map(publicRecord),
    customRules,
    exceptions,
    vendorCompliance: [],
    financialForecast: forecastRows[0],
  });
  const systemContext: HealthContext = { name: actor.name || "Command Center", email: actor.email || "system@meffcon.com", accessLevel: "System", designations: [], role: "Owner/Admin", canManageRules: false };
  await persistHealthState(project, health, systemContext, today);
  await syncHealthWork(project, health, memberRows);
}

export async function reconcileAllProjectHealthNightly() {
  const db = await healthDb();
  const projectRows = await db.select({ number: projects.number }).from(projects);
  for (const project of projectRows) {
    await reconcileProjectHealthAfterUpdate(project.number, {
      name: "Nightly Health Reconciliation",
      email: "system@meffcon.com",
    });
  }
}

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMyWorkTables();
    await ensureVendorSchema();
    const context = await healthContext(actor);
    if ("error" in context) return Response.json({ error: context.error }, { status: context.status });
    const requestedProjectId = new URL(request.url).searchParams.get("projectId")?.trim() || "";
    return Response.json(await buildHealthResponse(context, requestedProjectId, true));
  } catch (error) {
    return healthError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMyWorkTables();
    await ensureVendorSchema();
    const context = await healthContext(actor);
    if ("error" in context) return Response.json({ error: context.error }, { status: context.status });
    const payload = (await request.json()) as HealthPayload;
    if (payload.action === "create-rule") return createRule(context, payload);
    if (payload.action === "set-rule-enabled") return setRuleEnabled(context, payload);
    if (payload.action === "request-exception") return requestException(context, payload);
    if (payload.action === "decide-exception") return decideException(context, payload);
    if (payload.action === "recalculate") {
      return Response.json(await buildHealthResponse(context, payload.projectId?.trim() || "", true));
    }
    return Response.json({ error: "A Valid Project Health Action Is Required" }, { status: 400 });
  } catch (error) {
    return healthError(error);
  }
}

async function healthContext(actor: ReturnType<typeof getCommandActor>) {
  const db = await healthDb();
  const member = await db
    .select()
    .from(companyMembers)
    .where(eq(companyMembers.email, actor.email))
    .limit(1);
  if (member[0]?.isActive === false) return { error: "Company Access Is Inactive", status: 403 } as const;
  const accessLevel = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  const isOwnerAdmin = ["Company Owner", "Administrator"].includes(accessLevel);
  const role: HealthRole | null = isOwnerAdmin
    ? "Owner/Admin"
    : designations.includes("Project Manager")
      ? "Project Manager"
      : designations.includes("Superintendent")
        ? "Superintendent"
        : null;
  if (!role) return { error: "Project Health Requires Owner Administrator Project Manager Or Superintendent Access", status: 403 } as const;
  return {
    name: member[0]?.displayName || actor.name,
    email: actor.email,
    accessLevel,
    designations,
    role,
    canManageRules: isOwnerAdmin,
  } satisfies HealthContext;
}

async function visibleProjects(context: HealthContext) {
  const db = await healthDb();
  const rows = await db.select().from(projects).orderBy(projects.number);
  if (context.role === "Owner/Admin") return rows;
  const actorName = context.name.trim().toLowerCase();
  return rows.filter((project) =>
    context.role === "Project Manager"
      ? project.projectManager.trim().toLowerCase() === actorName
      : project.superintendent.trim().toLowerCase() === actorName,
  );
}

async function buildHealthResponse(context: HealthContext, requestedProjectId: string, persist: boolean) {
  const db = await healthDb();
  const projectRows = await visibleProjects(context);
  if (requestedProjectId && !projectRows.some((project) => project.number === requestedProjectId)) {
    throw new HealthHttpError("This Project Is Not Assigned To The Current User", 403);
  }
  const selectedProjects = requestedProjectId ? projectRows.filter((project) => project.number === requestedProjectId) : projectRows;
  const projectIds = selectedProjects.map((project) => project.number);
  const allProjectIds = [...projectIds, COMPANY_ID];
  const [recordRows, memberRows, forecastRows] = await Promise.all([
    allProjectIds.length
      ? db.select().from(commandRecords).where(inArray(commandRecords.projectId, allProjectIds))
      : Promise.resolve([] as RecordRow[]),
    db.select().from(companyMembers).where(eq(companyMembers.isActive, true)),
    projectIds.length
      ? db.select().from(accountingWipForecasts).where(inArray(accountingWipForecasts.projectId, projectIds)).orderBy(desc(accountingWipForecasts.periodId), desc(accountingWipForecasts.updatedAt))
      : Promise.resolve([] as Array<typeof accountingWipForecasts.$inferSelect>),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const customRules: Array<Record<string, unknown> & { id: string }> = recordRows
    .filter((row) => row.projectId === COMPANY_ID && row.recordType === RULE_TYPE)
    .map((row) => ({ id: row.id, ...parseData(row.dataJson) }));
  const ruleLibrary: Array<Record<string, unknown>> = [
    ...PROTECTED_HEALTH_RULES.map((rule) => ({ ...rule, enabled: true, source: "Mefford Standard" })),
    ...customRules.map((rule) => ({ ...rule, protected: false, source: "Owner/Admin Custom" })),
  ];
  const results = [];
  for (const project of selectedProjects) {
    const projectRecords = recordRows.filter((row) => row.projectId === project.number && !INTERNAL_TYPES.includes(row.recordType));
    const exceptionRows = recordRows.filter((row) => row.projectId === project.number && row.recordType === EXCEPTION_TYPE);
    const exceptions: Array<Record<string, unknown> & { id: string }> = exceptionRows.map((row) => ({ id: row.id, ...parseData(row.dataJson) }));
    const health = calculateProjectHealth({
      today,
      calculatedAt: new Date().toISOString(),
      project,
      records: projectRecords.map(publicRecord),
      customRules,
      exceptions,
      vendorCompliance: [],
      financialForecast: forecastRows.find((row) => row.projectId === project.number),
    });
    if (persist) {
      await persistHealthState(project, health, context, today);
      await syncHealthWork(project, health, memberRows);
    }
    const refreshedHistory = persist
      ? await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), inArray(commandRecords.recordType, [SNAPSHOT_TYPE, EVENT_TYPE]))).orderBy(desc(commandRecords.updatedAt))
      : recordRows.filter((row) => row.projectId === project.number && [SNAPSHOT_TYPE, EVENT_TYPE].includes(row.recordType));
    results.push({
      project: publicProject(project),
      health: redactHealth(health, context.role === "Superintendent"),
      exceptions: exceptions
        .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))
        .map((item) => redactException(item, context.role === "Superintendent")),
      history: refreshedHistory.map((row) => ({ id: row.id, kind: row.recordType === SNAPSHOT_TYPE ? "Daily Snapshot" : "Health Change", at: row.updatedAt, ...redactHistory(parseData(row.dataJson), context.role === "Superintendent") })),
    });
  }
  const counts = { Green: 0, Yellow: 0, Red: 0 };
  for (const result of results) counts[result.health.color as keyof typeof counts] += 1;
  const average = results.length ? Math.round(results.reduce((sum, result) => sum + result.health.score, 0) / results.length) : 0;
  const visibleRules = ruleLibrary.filter((rule) => context.role !== "Superintendent" || String(rule.category) !== "Financial");
  return {
    actor: { name: context.name, role: context.role, canManageRules: context.canManageRules, canRequestException: context.role === "Project Manager" },
    policy: {
      weights: PROJECT_HEALTH_WEIGHTS,
      bands: { Green: "90–100", Yellow: "75–89", Red: "Below 75" },
      recalculation: "After Every Relevant Update + Nightly Reconciliation",
      permittedAutomation: ["Create My Work Tasks", "Send Operational Notices", "Escalate At 48, 72, And 96 Hours"],
      prohibitedAutomation: ["Approve Or Change Financials", "Change Contracts", "Post Payments", "Send Invoices"],
      exceptionMaximumDays: 30,
      criticalOverrides: ["Safety", "Projected Project Loss", "Projected Budget Overrun", "Overdue Final Completion"],
    },
    portfolio: { average, counts, visibleProjects: results.length, criticalTriggers: results.reduce((sum, result) => sum + result.health.criticalTriggers.length, 0) },
    rules: visibleRules,
    projects: results,
  };
}

async function persistHealthState(project: ProjectRow, health: ReturnType<typeof calculateProjectHealth>, context: HealthContext, today: string) {
  const db = await healthDb();
  const now = new Date().toISOString();
  const snapshotId = `HEALTH-SNAPSHOT-${today}`;
  const snapshotData = {
    score: health.score,
    color: health.color,
    categoryScores: health.categories.map((item: { category: string; earned: number; weight: number }) => ({ category: item.category, earned: item.earned, weight: item.weight })),
    criticalRuleIds: health.criticalTriggers.map((item: { ruleId: string }) => item.ruleId).sort(),
    calculatedAt: health.calculatedAt,
  };
  const existingSnapshot = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.id, snapshotId))).limit(1);
  await db.insert(commandRecords).values({
    projectId: project.number,
    id: snapshotId,
    recordType: SNAPSHOT_TYPE,
    title: `${project.name} Health · ${today}`,
    owner: "Command Center",
    due: today,
    status: health.color,
    meta: `${health.score}/100 · Daily Reconciliation`,
    recordDate: today,
    dateLocked: true,
    dataJson: JSON.stringify(snapshotData),
    updatedAt: now,
  }).onConflictDoUpdate({ target: [commandRecords.projectId, commandRecords.id], set: { status: health.color, meta: `${health.score}/100 · Daily Reconciliation`, dataJson: JSON.stringify(snapshotData), updatedAt: now } });
  if (!existingSnapshot.length) await audit(project.number, snapshotId, context, "Daily Health Snapshot", "Not Recorded", `${health.color} ${health.score}`, "Permanent daily health snapshot created");

  const latestEvent = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, project.number), eq(commandRecords.recordType, EVENT_TYPE))).orderBy(desc(commandRecords.updatedAt)).limit(1);
  const previous = latestEvent[0] ? parseData(latestEvent[0].dataJson) : {};
  const criticalSignature = snapshotData.criticalRuleIds.join("|");
  const priorSignature = Array.isArray(previous.criticalRuleIds) ? previous.criticalRuleIds.map(String).sort().join("|") : "";
  if (!latestEvent.length || previous.color !== health.color || priorSignature !== criticalSignature) {
    const eventId = `HEALTH-EVENT-${crypto.randomUUID()}`;
    const summary = !latestEvent.length
      ? `Initial health state recorded at ${health.color} ${health.score}`
      : `Health changed from ${previous.color || "Unrated"} to ${health.color}; critical triggers ${priorSignature || "None"} → ${criticalSignature || "None"}`;
    await db.insert(commandRecords).values({ projectId: project.number, id: eventId, recordType: EVENT_TYPE, title: `${project.name} Health Change`, owner: "Command Center", due: today, status: health.color, meta: summary, recordDate: today, dateLocked: true, dataJson: JSON.stringify({ ...snapshotData, event: "Color Or Critical Trigger Change", summary }), updatedAt: now });
    await audit(project.number, eventId, context, "Health State", String(previous.color || "Unrated"), health.color, summary);
  }
}

async function syncHealthWork(project: ProjectRow, health: ReturnType<typeof calculateProjectHealth>, members: Array<typeof companyMembers.$inferSelect>) {
  const db = await healthDb();
  const activeKeys = new Set<string>();
  for (const item of health.recommendations as Array<{ id: string; title: string; explanation: string; category: string; action: string; owner: string; due: string; priority: "Normal" | "High" | "Critical" }>) {
    const member = members.find((candidate) => candidate.displayName.trim().toLowerCase() === item.owner.trim().toLowerCase());
    if (!member) continue;
    const dedupeKey = `health:${project.number}:${item.id}:${member.email}`;
    activeKeys.add(dedupeKey);
    await upsertWorkItem(db, {
      dedupeKey,
      projectId: project.number,
      recipientName: member.displayName,
      recipientEmail: member.email,
      kind: "Project Health",
      title: `${project.name} · ${item.title}`,
      message: `${item.explanation} Required action: ${item.action}`,
      priority: item.priority,
      sourceType: "Project Health",
      sourceRecordId: item.id,
      actionTarget: "Project Health",
      dueAt: `${item.due}T17:00:00-04:00`,
      createdBy: "Project Health Automation",
    });
    if (item.priority === "Critical") {
      const owners = members.filter((candidate) => candidate.companyAccessLevel === "Company Owner");
      const leadership = owners.length ? owners : members.filter((candidate) => candidate.companyAccessLevel === "Administrator");
      for (const leader of leadership) {
        const ownerKey = `health-owner:${project.number}:${item.id}:${leader.email}`;
        activeKeys.add(ownerKey);
        await upsertWorkItem(db, {
          dedupeKey: ownerKey,
          projectId: project.number,
          recipientName: leader.displayName,
          recipientEmail: leader.email,
          kind: "Ownership Red Flag",
          title: `Ownership Red Flag · ${project.name} · ${item.title}`,
          message: `${item.explanation} ${item.owner} remains accountable for recovery. Leadership must remove barriers, verify a dated recovery plan, and preserve the decision—not take over routine execution. Required action: ${item.action}`,
          priority: "Critical",
          sourceType: "Project Health",
          sourceRecordId: item.id,
          actionTarget: "Project Health",
          dueAt: `${item.due}T17:00:00-04:00`,
          createdBy: "Project Health Automation",
        });
      }
    }
  }
  const current = await db.select().from(commandWorkItems).where(and(eq(commandWorkItems.projectId, project.number), eq(commandWorkItems.sourceType, "Project Health")));
  const resolved = current.filter((item) => !activeKeys.has(item.dedupeKey) && !["Completed"].includes(item.status));
  if (resolved.length) {
    const now = new Date().toISOString();
    await db.update(commandWorkItems).set({ status: "Completed", completedAt: now, updatedAt: now }).where(inArray(commandWorkItems.id, resolved.map((item) => item.id)));
    await db.insert(workItemAudits).values(resolved.map((item) => ({ workItemId: item.id, action: "Automatically Resolved", actorName: "Project Health Automation", actorEmail: "system@meffcon.com", detail: "The triggering health condition is no longer active." })));
  }
}

async function createRule(context: HealthContext, payload: HealthPayload) {
  if (!context.canManageRules) return Response.json({ error: "Only A Company Owner Or Administrator Can Create Company Health Rules" }, { status: 403 });
  const category = String(payload.category || "");
  const weight = Number(PROJECT_HEALTH_WEIGHTS[category as keyof typeof PROJECT_HEALTH_WEIGHTS] || 0);
  const deduction = Number(payload.deduction || 0);
  const name = payload.name?.trim() || "";
  const description = payload.description?.trim() || "";
  const recordType = payload.recordType?.trim() || "";
  const recommendedAction = payload.recommendedAction?.trim() || "";
  if (!name || description.length < 15 || !weight || deduction <= 0 || deduction > weight || !recordType || !recommendedAction) {
    return Response.json({ error: "Complete The Rule Name Description Category Deduction Trigger Record Type And Recommended Action" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const id = `HEALTH-RULE-${crypto.randomUUID()}`;
  const rule = { id, name, description, category, deduction, recordType, statusIncludes: payload.statusIncludes?.trim() || "", overdueOnly: payload.overdueOnly === true, targetRole: payload.targetRole === "Superintendent" ? "Superintendent" : "Project Manager", action: recommendedAction, enabled: true, createdBy: context.name, createdByEmail: context.email, createdAt: now };
  const db = await healthDb();
  await db.insert(commandRecords).values({ projectId: COMPANY_ID, id, recordType: RULE_TYPE, title: rule.name, owner: context.name, due: "Annual Review", status: "Active", meta: `${category} · ${deduction} Point Deduction · Owner/Admin Custom`, dateLocked: true, dataJson: JSON.stringify(rule), updatedAt: now });
  await audit(COMPANY_ID, id, context, "Company Health Rule", "Not Created", "Active", `Owner/Admin custom rule created: ${rule.name}`);
  return Response.json({ saved: true, id });
}

async function setRuleEnabled(context: HealthContext, payload: HealthPayload) {
  if (!context.canManageRules) return Response.json({ error: "Only A Company Owner Or Administrator Can Change Company Health Rules" }, { status: 403 });
  if (PROTECTED_HEALTH_RULES.some((rule) => rule.id === payload.ruleId)) return Response.json({ error: "Protected Mefford Standard Rules Cannot Be Disabled Or Edited" }, { status: 409 });
  const db = await healthDb();
  const row = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, COMPANY_ID), eq(commandRecords.id, payload.ruleId || ""), eq(commandRecords.recordType, RULE_TYPE))).limit(1);
  if (!row[0]) return Response.json({ error: "Custom Health Rule Was Not Found" }, { status: 404 });
  const current = parseData(row[0].dataJson);
  const enabled = payload.enabled === true;
  await db.update(commandRecords).set({ status: enabled ? "Active" : "Inactive", dataJson: JSON.stringify({ ...current, enabled, updatedBy: context.name, updatedAt: new Date().toISOString() }), updatedAt: new Date().toISOString() }).where(and(eq(commandRecords.projectId, COMPANY_ID), eq(commandRecords.id, row[0].id)));
  await audit(COMPANY_ID, row[0].id, context, "Rule Status", String(current.enabled !== false ? "Active" : "Inactive"), enabled ? "Active" : "Inactive", `Custom health rule ${enabled ? "activated" : "deactivated"}`);
  return Response.json({ saved: true });
}

async function requestException(context: HealthContext, payload: HealthPayload) {
  if (context.role !== "Project Manager") return Response.json({ error: "Only The Assigned Project Manager Can Request A Project Rule Exception" }, { status: 403 });
  const projectId = payload.projectId?.trim() || "";
  const assigned = (await visibleProjects(context)).find((project) => project.number === projectId);
  if (!assigned) return Response.json({ error: "This Project Is Not Assigned To The Current Project Manager" }, { status: 403 });
  const ruleId = payload.ruleId?.trim() || "";
  const protectedRule = PROTECTED_HEALTH_RULES.find((rule) => rule.id === ruleId);
  const db = await healthDb();
  const customRule = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, COMPANY_ID), eq(commandRecords.id, ruleId), eq(commandRecords.recordType, RULE_TYPE))).limit(1);
  if (!protectedRule && !customRule[0]) return Response.json({ error: "Select A Valid Company Health Rule" }, { status: 400 });
  if (protectedRule?.critical) return Response.json({ error: "Critical Safety Compliance Budget-Overrun And Final-Completion Guardrails Cannot Be Suspended; Project-Loss Guardrails Are Protected Too" }, { status: 409 });
  const reason = payload.reason?.trim() || "";
  const mitigation = payload.mitigation?.trim() || "";
  const expiresAt = payload.expiresAt?.trim() || "";
  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(`${today}T12:00:00Z`); max.setUTCDate(max.getUTCDate() + 30);
  if (reason.length < 20 || mitigation.length < 20 || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || expiresAt < today || expiresAt > max.toISOString().slice(0, 10)) return Response.json({ error: "A Specific Reason Mitigation Plan And Expiration Within 30 Days Are Required" }, { status: 400 });
  const now = new Date().toISOString();
  const id = `HEALTH-EXCEPTION-${crypto.randomUUID()}`;
  const ruleName = protectedRule?.name || String(parseData(customRule[0].dataJson).name || customRule[0].title);
  const exception = { id, projectId, ruleId, ruleName, status: "Owner/Admin Review", reason, mitigation, startsAt: today, expiresAt, requestedBy: context.name, requestedByEmail: context.email, requestedAt: now, renewalOf: "" };
  await db.insert(commandRecords).values({ projectId, id, recordType: EXCEPTION_TYPE, title: `${ruleName} Exception Request`, owner: "Company Owner / Administrator", due: today, status: "Owner/Admin Review", meta: `${context.name} · Expires ${expiresAt}`, recordDate: today, dateLocked: true, dataJson: JSON.stringify(exception), updatedAt: now });
  await audit(projectId, id, context, "Rule Exception", "Not Requested", "Owner/Admin Review", `PM requested ${ruleName} exception through ${expiresAt}; new reason required for any renewal`);
  await insertExceptionEvent(projectId, assigned.name, context, exception, "Exception Requested");
  const leaders = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  for (const leader of leaders.filter((member) => ["Company Owner", "Administrator"].includes(member.companyAccessLevel))) await upsertWorkItem(db, { dedupeKey: `health-exception:${id}:${leader.email}`, projectId, recipientName: leader.displayName, recipientEmail: leader.email, kind: "Project Health Exception", title: `${assigned.name} · Review ${ruleName} Exception`, message: `${context.name} requests a temporary exception through ${expiresAt}. Reason: ${reason}`, priority: "High", sourceType: "Project Health Exception", sourceRecordId: id, actionTarget: "Project Health", dueAt: `${today}T17:00:00-04:00`, createdBy: context.name });
  return Response.json({ saved: true, id });
}

async function decideException(context: HealthContext, payload: HealthPayload) {
  if (!context.canManageRules) return Response.json({ error: "Only A Company Owner Or Administrator Can Decide Rule Exceptions" }, { status: 403 });
  if (!payload.projectId || !payload.ruleId || !["Approved", "Rejected"].includes(payload.decision || "") || (payload.decisionNote?.trim().length || 0) < 10) return Response.json({ error: "Select A Decision And Enter A Specific Owner/Admin Decision Note" }, { status: 400 });
  const db = await healthDb();
  const row = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, payload.projectId), eq(commandRecords.id, payload.ruleId), eq(commandRecords.recordType, EXCEPTION_TYPE))).limit(1);
  if (!row[0]) return Response.json({ error: "Rule Exception Request Was Not Found" }, { status: 404 });
  if (row[0].status !== "Owner/Admin Review") return Response.json({ error: "This Rule Exception Has Already Been Decided; Renewal Requires A New Request And Reason" }, { status: 409 });
  const current = parseData(row[0].dataJson);
  const now = new Date().toISOString();
  const decision = payload.decision!;
  const next = { ...current, status: decision, decidedBy: context.name, decidedByEmail: context.email, decidedAt: now, decisionNote: payload.decisionNote!.trim() };
  await db.update(commandRecords).set({ status: decision, owner: String(current.requestedBy || "Project Manager"), meta: `${decision} By ${context.name} · ${current.expiresAt || "No Expiration"}`, dataJson: JSON.stringify(next), updatedAt: now }).where(and(eq(commandRecords.projectId, payload.projectId), eq(commandRecords.id, payload.ruleId)));
  await audit(payload.projectId, payload.ruleId, context, "Owner/Admin Decision", "Owner/Admin Review", decision, `${decision}: ${payload.decisionNote!.trim()}`);
  const project = await db.select().from(projects).where(eq(projects.number, payload.projectId)).limit(1);
  await insertExceptionEvent(payload.projectId, project[0]?.name || payload.projectId, context, next, `Exception ${decision}`);
  const requester = await db.select().from(companyMembers).where(eq(companyMembers.email, String(current.requestedByEmail || ""))).limit(1);
  if (requester[0]) await upsertWorkItem(db, { dedupeKey: `health-exception-decision:${payload.ruleId}:${requester[0].email}`, projectId: payload.projectId, recipientName: requester[0].displayName, recipientEmail: requester[0].email, kind: "Project Health Exception", title: `${String(current.ruleName || "Health Rule")} Exception ${decision}`, message: payload.decisionNote!.trim(), priority: decision === "Rejected" ? "High" : "Normal", sourceType: "Project Health Exception", sourceRecordId: payload.ruleId, actionTarget: "Project Health", dueAt: decision === "Rejected" ? `${new Date().toISOString().slice(0, 10)}T17:00:00-04:00` : null, createdBy: context.name });
  return Response.json({ saved: true });
}

async function insertExceptionEvent(projectId: string, projectName: string, context: HealthContext, exception: Record<string, unknown>, event: string) {
  const now = new Date().toISOString();
  const id = `HEALTH-EVENT-${crypto.randomUUID()}`;
  const db = await healthDb();
  await db.insert(commandRecords).values({ projectId, id, recordType: EVENT_TYPE, title: `${projectName} · ${event}`, owner: context.name, due: now.slice(0, 10), status: String(exception.status || event), meta: `${exception.ruleName || "Health Rule"} · ${event}`, recordDate: now.slice(0, 10), dateLocked: true, dataJson: JSON.stringify({ event: "Rule Exception Change", summary: `${event} · ${exception.ruleName || "Health Rule"}`, exceptionId: exception.id, ruleId: exception.ruleId, status: exception.status, requestedBy: exception.requestedBy, expiresAt: exception.expiresAt, at: now }), updatedAt: now });
  await audit(projectId, id, context, "Rule Exception History", "", event, `${event} permanently recorded`);
}

async function audit(projectId: string, recordId: string, context: Pick<HealthContext, "name" | "email">, fieldName: string, oldValue: string, newValue: string, summary: string) {
  const db = await healthDb();
  await db.insert(recordAudits).values({ projectId, recordId, fieldName, oldValue, newValue, reason: summary, actorName: context.name, actorEmail: context.email, summary });
}

function redactHealth(health: ReturnType<typeof calculateProjectHealth>, superintendent: boolean) {
  if (!superintendent) return health;
  return {
    ...health,
    categories: health.categories.filter((item: { category: string }) => item.category !== "Financial"),
    factors: health.factors.filter((item: { category: string }) => item.category !== "Financial"),
    criticalTriggers: health.criticalTriggers.filter((item: { category: string }) => item.category !== "Financial"),
    recommendations: health.recommendations.filter((item: { id: string }) => !String(item.id).startsWith("financial-")),
    financial: undefined,
    financialVisibility: "Restricted To Owner/Admin And Assigned Project Manager",
  };
}

function redactHistory(history: Record<string, unknown>, superintendent: boolean) {
  if (!superintendent) return history;
  const categoryScores = Array.isArray(history.categoryScores) ? history.categoryScores.filter((item) => String((item as Record<string, unknown>).category) !== "Financial") : history.categoryScores;
  const criticalRuleIds = Array.isArray(history.criticalRuleIds) ? history.criticalRuleIds.filter((id) => !String(id).startsWith("financial-")) : history.criticalRuleIds;
  return { ...history, categoryScores, criticalRuleIds };
}

function redactException(exception: Record<string, unknown>, superintendent: boolean) {
  if (!superintendent) return exception;
  return { id: exception.id, ruleId: exception.ruleId, ruleName: exception.ruleName, status: exception.status, startsAt: exception.startsAt, expiresAt: exception.expiresAt };
}

function publicRecord(row: RecordRow) {
  return { id: row.id, type: row.recordType, title: row.title, owner: row.owner, due: row.due, status: row.status, recordDate: row.recordDate, data: parseData(row.dataJson) };
}

function publicProject(project: ProjectRow) {
  return { number: project.number, name: project.name, status: project.status, site: project.site, startDate: project.startDate, substantialDate: project.substantialDate, finalDate: project.finalDate, projectManager: project.projectManager, superintendent: project.superintendent };
}

function parseData(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function parseStringArray(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

async function healthDb() {
  const { getDb } = await import("../../../db");
  return getDb();
}

class HealthHttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function healthError(error: unknown) {
  const status = error instanceof HealthHttpError ? error.status : 500;
  return Response.json({ error: error instanceof Error ? error.message : "Project Health Is Unavailable" }, { status });
}
