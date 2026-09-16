import { isTurnover } from "../../../lib/turnovers";
import { bonusTurnoverBlockers } from "../../../lib/bonus-server";
import { changeTurnover, TurnoverError, turnoverView, reconcileTurnovers } from "../../../lib/turnover-server";
import { and, eq } from "drizzle-orm";
import { createMeetingMinutesPdf } from "../../../lib/meeting-pdf";
import {
  commandWorkItems,
  companyMembers,
  meetingActionItems,
  meetingAttendees,
  meetingDecisions,
  projects,
} from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  auditMeeting,
  automatedAgendaItems,
  canFinalizeMeeting,
  canCreateMeeting,
  canEditMeeting,
  canAccessMeeting,
  MeetingAccessError,
  closeMeetingWorkItem,
  ensureMeetingTables,
  getMeetingContext,
  meetingBundle,
  ownerFinancialSnapshot,
  runDeterministicMeetingRules,
  type MeetingActor,
} from "../../../lib/meeting-server";
import {
  DEPARTMENT_MEETING_ROLES,
  MEETING_DEFAULTS,
  MEETING_SECTIONS,
  MEETING_TARGET_BY_TYPE,
  MEETING_TYPES,
  isCompanyMeeting,
  meetingNumber,
  type MeetingType,
} from "../../../lib/meetings";
import { changeAgendaTopic, saveAgendaSettings, MeetingAgendaError } from "../../../lib/meeting-agenda-control";
import { agendaSettings, canManageAgenda, DEPARTMENT_METRICS, isDepartmentMeeting, isSelectableScorecard, scorecardKey, selectedAgendaSources, type AgendaSelection } from "../../../lib/meeting-agenda-settings";
import { buildMeetingAgenda } from "../../../lib/meeting-agenda";
import { loadMeetingSources } from "../../../lib/meeting-agenda-server";
import { recordCompletedWorkflowHandoff } from "../../../lib/domain-outbox";
import {
  createMicrosoftMeeting,
  configureOnlineMeetingEvidence,
  findOnlineMeetingByJoinUrl,
  getMeetingAttendance,
  getMeetingTranscripts,
  microsoftMeetingConnection,
  sendMeetingMinutesMail,
} from "../../../lib/microsoft-graph";
import { effectiveActor, ensureMyWorkTables, upsertWorkItem } from "../../../lib/my-work";
import { resolveCommandActor } from "../../../lib/server-actor";
import { AccessControlError, authorizedMicrosoftIdentityForActor } from "../../../lib/microsoft-access-server";

type AttendeeInput = {
  name: string;
  email: string;
  attendanceRequirement?: "Required" | "Optional";
  attendeeRole?: string;
  external?: boolean;
};

type MeetingPayload = {
  action: string;
  expectedRevision?: number;
  projectId?: string;
  meetingType?: MeetingType;
  seriesId?: string;
  occurrenceId?: string;
  entityId?: string;
  title?: string;
  cadence?: string;
  startAt?: string;
  durationMinutes?: number;
  timeZone?: string;
  meetingMode?: string;
  location?: string;
  leaderName?: string;
  leaderEmail?: string;
  organizerEmail?: string;
  attendees?: AttendeeInput[];
  syncMicrosoft?: boolean;
  useSuggestedAttendees?: boolean;
  reason?: string;
  value?: string | number | boolean;
  notes?: string;
  status?: string;
  timeboxMinutes?: number;
  sectionKey?: string;
  assigneeName?: string;
  assigneeEmail?: string;
  dueAt?: string;
  priority?: "Normal" | "High" | "Critical";
  itemKind?: "To-Do" | "Rock";
  definitionOfDone?: string;
  blocker?: string;
  evidence?: string;
  statement?: string;
  decisionMakerName?: string;
  decisionMakerEmail?: string;
  attendanceStatus?: string;
  attendanceSource?: string;
  rating?: number;
  minutesSummary?: string;
  expectedVersion?: string;
  expectedAccess?: string;
  selection?: AgendaSelection;
  managerEmails?: string[];
};

const FINAL_STATUSES = new Set(["Finalized/Distributed", "Superseded"]);

function validType(value: unknown): value is MeetingType {
  return MEETING_TYPES.includes(String(value) as MeetingType);
}

function normalizedStart(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("A Valid Meeting Start Date And Time Is Required");
  return parsed.toISOString();
}

function actorCanEdit(actor: MeetingActor, context: Record<string, string | number | null>) {
  return canEditMeeting(actor, context);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

async function writeSyncEvent(input: { seriesId: string; occurrenceId: string; eventType: string; status: string; providerId?: string; detail?: string }) {
  const { env } = await import("cloudflare:workers");
  await env.DB.prepare(`INSERT INTO meeting_sync_events (id, series_id, occurrence_id, direction, event_type, status, provider_id, detail) VALUES (?, ?, ?, 'Outbound', ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), input.seriesId, input.occurrenceId, input.eventType, input.status, input.providerId || "", input.detail || "",
  ).run();
}

async function createQuarterlyLinkedL10(context: Record<string, string | number | null>, actor: MeetingActor) {
  if (String(context.meeting_type) !== "Quarterly Rock/Review") return null;
  const { env } = await import("cloudflare:workers");
  const base = new Date(String(context.scheduled_start));
  const daysUntilMonday = ((8 - base.getUTCDay()) % 7) || 7;
  const start = new Date(base.getTime() + daysUntilMonday * 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  const startAt = start.toISOString();
  const number = meetingNumber("Weekly L10", "MEFFORD-COMPANY", startAt, 1);
  const existing = await env.DB.prepare(`SELECT id FROM meeting_occurrences WHERE meeting_number = ?`).bind(number).first<{ id: string }>();
  if (existing) return { occurrenceId: existing.id, created: false };
  const attendees = await env.DB.prepare(`SELECT * FROM meeting_attendees WHERE occurrence_id = ?`).bind(context.id).all<Record<string, string | number | null>>();
  const seriesId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  const endAt = new Date(start.getTime() + MEETING_DEFAULTS["Weekly L10"].durationMinutes * 60_000).toISOString();
  const quarter = Math.floor(base.getUTCMonth() / 3) + 1;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO meeting_series (id, meeting_type, project_id, title, cadence, start_at, duration_minutes, time_zone, meeting_mode, location, leader_name, leader_email, organizer_email, recording_default, auto_publish_hours, access_json, created_by) VALUES (?, 'Weekly L10', 'MEFFORD-COMPANY', ?, 'Weekly', ?, ?, ?, ?, ?, ?, ?, ?, 1, 24, ?, ?)`).bind(
      seriesId, `Weekly L10 · Q${quarter} ${base.getUTCFullYear()}`, startAt, MEETING_DEFAULTS["Weekly L10"].durationMinutes, context.time_zone, context.meeting_mode, context.location, context.leader_name, context.leader_email, context.organizer_email, JSON.stringify({ quarterlySourceOccurrenceId: context.id }), actor.name,
    ),
    env.DB.prepare(`INSERT INTO meeting_occurrences (id, series_id, meeting_number, scheduled_start, scheduled_end) VALUES (?, ?, ?, ?, ?)`).bind(occurrenceId, seriesId, number, startAt, endAt),
    ...attendees.results.map((item) => env.DB.prepare(`INSERT INTO meeting_attendees (id, occurrence_id, name, email, attendee_role, attendance_requirement, external) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), occurrenceId, item.name, item.email, item.attendee_role, item.attendance_requirement, item.external)),
  ]);
  const generated = await automatedAgendaItems({ type: "Weekly L10", projectId: "MEFFORD-COMPANY", occurrenceId, seriesId, actor });
  let microsoft = "Connection Required";
  if ((await microsoftMeetingConnection()).configured) {
    try {
      const event = await createMicrosoftMeeting({ subject: `Weekly L10 · Q${quarter} ${base.getUTCFullYear()}`, startAt, endAt, timeZone: String(context.time_zone), cadence: "Weekly", location: String(context.location), transactionId: seriesId, attendees: attendees.results.map((item) => ({ email: String(item.email), name: String(item.name), required: String(item.attendance_requirement) !== "Optional" })), bodyHtml: `<p>Automatically established from ${context.meeting_number}.</p>`, organizerEmail: String(context.organizer_email) });
      await env.DB.batch([
        env.DB.prepare(`UPDATE meeting_series SET graph_event_id = ?, graph_change_key = ?, teams_join_url = ? WHERE id = ?`).bind(event.id, event.changeKey || "", event.onlineMeeting?.joinUrl || "", seriesId),
        env.DB.prepare(`UPDATE meeting_occurrences SET graph_event_id = ? WHERE id = ?`).bind(event.id, occurrenceId),
      ]);
      microsoft = "Succeeded";
    } catch (error) {
      microsoft = error instanceof Error ? error.message : "Microsoft Sync Failed";
    }
  }
  await auditMeeting({ actor, seriesId, occurrenceId, entityType: "Meeting Series", entityId: seriesId, action: "Weekly L10 Series Established From Quarterly", reason: String(context.meeting_number), after: { generated, microsoft } });
  return { seriesId, occurrenceId, created: true, microsoft };
}

async function ownerSnapshotWithDelta(projectId: string, seriesId?: string) {
  const current = await ownerFinancialSnapshot(projectId) as Record<string, unknown>;
  if (!seriesId) return { ...current, changeSincePreviousMeeting: 0, priorMeetingNumber: "First Owner Meeting" };
  const { env } = await import("cloudflare:workers");
  const prior = await env.DB.prepare(`SELECT meeting_number, financial_snapshot_json FROM meeting_occurrences WHERE series_id = ? ORDER BY scheduled_start DESC LIMIT 1`).bind(seriesId).first<{ meeting_number: string; financial_snapshot_json: string }>();
  const previous = prior ? JSON.parse(prior.financial_snapshot_json || "{}") as Record<string, unknown> : {};
  return {
    ...current,
    changeSincePreviousMeeting: Number(current.currentOwnerContract || 0) - Number(previous.currentOwnerContract || 0),
    priorMeetingNumber: prior?.meeting_number || "First Owner Meeting",
  };
}

async function loadActor(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return null;
  await ensureMyWorkTables();
  return effectiveActor(actor) as Promise<MeetingActor>;
}

async function suggestedMeetingPeople(type: MeetingType, projectId: string, actor: MeetingActor) {
  const { getDb } = await import("../../../db");
  const db = getDb();
  const members = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
  const project = isCompanyMeeting(type) ? null : (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  const roleNames = DEPARTMENT_MEETING_ROLES[type] || [];
  const names = project ? [project.projectManager, project.superintendent] : [];
  const recommended = members.filter(member => {
    const roles: string[] = JSON.parse(member.designationsJson || "[]");
    return isCompanyMeeting(type) ? member.companyAccessLevel === "Company Owner" || roles.some(role => roleNames.includes(role)) : names.some(name => name.toLowerCase() === member.displayName.toLowerCase());
  }).map(member => ({ name: member.displayName, email: member.email, attendanceRequirement: "Required" as const, attendeeRole: member.companyAccessLevel === "Company Owner" ? "Company Owner" : type.includes("Department") ? "Department Participant" : "Project Team", external: false }));
  const preferredLeader = project ? type === "Project Subcontractor" ? project.superintendent : project.projectManager : actor.name;
  const leader = members.find(member => member.displayName.toLowerCase() === preferredLeader.toLowerCase());
  return { attendees: recommended, leaderName: leader?.displayName || actor.name, leaderEmail: leader?.email || actor.email };
}

export async function GET(request: Request) {
  const actor = await loadActor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMeetingTables();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || "MEFFORD-COMPANY";
    const meetingType = url.searchParams.get("meetingType") || undefined;
    if (meetingType && !validType(meetingType)) return Response.json({ error: "Unknown Meeting Type" }, { status: 400 });
    if (meetingType && isCompanyMeeting(meetingType as MeetingType) !== (projectId === "MEFFORD-COMPANY")) return Response.json({ error: "The Meeting Type Does Not Match This Project Scope" }, { status: 400 });
    const turnoverRecovery = isTurnover(meetingType) ? await reconcileTurnovers(2) : null;
    let bundle = await meetingBundle({ projectId, meetingType, occurrenceId: url.searchParams.get("occurrenceId") || undefined }, actor);
    const microsoft = await microsoftMeetingConnection();
    let refresh: Record<string, unknown> = {}, agendaPreview: ReturnType<typeof buildMeetingAgenda> = [];
    const setupDefaults = meetingType && bundle.permissions.canCreate ? await suggestedMeetingPeople(meetingType as MeetingType, projectId, actor) : null;
    if (bundle.selectedOccurrenceId) {
      const context = await getMeetingContext(bundle.selectedOccurrenceId);
      try {
        if (context) refresh = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId, occurrenceId: bundle.selectedOccurrenceId, seriesId: String(context.series_id), actor });
        bundle = await meetingBundle({ projectId, meetingType, occurrenceId: bundle.selectedOccurrenceId }, actor);
      } catch (error) { refresh = { error: error instanceof Error ? error.message : "Agenda Sources Could Not Be Refreshed" }; }
    } else if (!bundle.series.length && meetingType && bundle.permissions.canCreate) {
      try { const sources = await loadMeetingSources(); agendaPreview = buildMeetingAgenda({ ...sources, type: meetingType as MeetingType, projectId }); refresh = { refreshedAt: sources.loadedAt, preview: true }; }
      catch (error) { refresh = { error: error instanceof Error ? error.message : "Agenda Sources Could Not Be Loaded" }; }
    }
    let agendaConfiguration = null;
    if (meetingType && isDepartmentMeeting(meetingType) && !isTurnover(meetingType) && bundle.selectedOccurrenceId) {
      const context = await getMeetingContext(bundle.selectedOccurrenceId);
      const { env } = await import("cloudflare:workers");
      const rows = await env.DB.prepare(`SELECT project_id, record_type, id, title FROM command_records WHERE project_id = 'MEFFORD-COMPANY' AND record_type IN ('Scorecard','Company Scorecard','Scorecard Metrics','Metrics') ORDER BY title`).all<Record<string, string>>();
      const selection = selectedAgendaSources(meetingType as MeetingType, context?.access_json);
      agendaConfiguration = {
        selection, managerEmails: agendaSettings(context?.access_json).agendaManagerEmails || [], expectedAccess: String(context?.access_json || "{}"),
        sections: MEETING_SECTIONS[meetingType as MeetingType].filter(section => !["previous-todos", "conclusion"].includes(section.key)).map(section => ({ id: section.key, title: section.title })),
        metrics: DEPARTMENT_METRICS[meetingType],
        scorecards: rows.results.map(row => ({ projectId: row.project_id, recordType: row.record_type, id: row.id, title: row.title })).filter(isSelectableScorecard)
          .map(row => ({ id: scorecardKey(row), title: row.title })).filter(row => actor.accessLevel === "Company Owner" || selection.scorecards.includes(row.id)),
      };
    }
    const turnover = bundle.selectedOccurrenceId && isTurnover(meetingType) ? await turnoverView(bundle.selectedOccurrenceId, actor) : null;
    const bonusMeeting = !turnover && bundle.selectedOccurrenceId ? await (await import("cloudflare:workers")).env.DB.prepare("SELECT project_id FROM project_bonus_controls WHERE occurrence_id=?").bind(bundle.selectedOccurrenceId).first<{project_id:string}>() : null;
    return Response.json({ ...bundle, turnover, bonusProjectId:bonusMeeting?.project_id || "", turnoverRecovery: ["Company Owner", "Administrator"].includes(actor.accessLevel) ? turnoverRecovery : null, microsoft, refresh, agendaPreview, setupDefaults, agendaConfiguration, actor: { name: actor.name, email: actor.email, accessLevel: actor.accessLevel }, policy: {
      meetingTypes: MEETING_TYPES, recordingDefault: true,
      aiBoundary: "Draft, summarize, suggest and cite only. Never approve, publish by judgment, confirm, finalize, distribute, change permissions or complete work.",
      lifecycle: ["Draft Agenda", "Published Agenda", "Meeting In Progress", "Draft Minutes", "Finalized/Distributed"],
    } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Meetings Are Unavailable" }, { status: error instanceof MeetingAccessError || error instanceof MeetingAgendaError || error instanceof TurnoverError ? error.status : 500 });
  }
}

export async function POST(request: Request) {
  const actor = await loadActor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    await ensureMeetingTables();
    const payload = (await request.json()) as MeetingPayload;
    const { env } = await import("cloudflare:workers");
    const { getDb } = await import("../../../db");
    const db = getDb();

    if (payload.action === "create_series") {
      if (!validType(payload.meetingType)) return Response.json({ error: "A Valid Meeting Type Is Required" }, { status: 400 });
      const type = payload.meetingType;
      if (isTurnover(type)) return Response.json({ error: "Turnover Meetings Are Created Automatically From Estimating Requests And Awards" }, { status: 409 });
      const projectId = isCompanyMeeting(type) ? "MEFFORD-COMPANY" : String(payload.projectId || "");
      if (!projectId) return Response.json({ error: "A Project Is Required For This Meeting Type" }, { status: 400 });
      if (!await canCreateMeeting(actor, type, projectId)) return Response.json({ error: "Meeting Leader Or Department Permission Required" }, { status: 403 });
      if (!isCompanyMeeting(type)) {
        const project = await db.select().from(projects).where(eq(projects.number, projectId)).limit(1);
        if (!project.length) return Response.json({ error: "The Selected Project Does Not Exist" }, { status: 404 });
      }
      const startAt = normalizedStart(String(payload.startAt || ""));
      const defaults = MEETING_DEFAULTS[type];
      const duration = Math.max(15, Math.min(480, Number(payload.durationMinutes || defaults.durationMinutes)));
      const endAt = new Date(new Date(startAt).getTime() + duration * 60_000).toISOString();
      const seriesId = crypto.randomUUID();
      const occurrenceId = crypto.randomUUID();
      const existing = await env.DB.prepare(`SELECT COUNT(*) AS total FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE s.project_id = ? AND s.meeting_type = ?`).bind(projectId, type).first<{ total: number }>();
      const number = meetingNumber(type, projectId, startAt, Number(existing?.total || 0) + 1);
      const leaderName = String(payload.leaderName || actor.name);
      const leaderEmail = String(payload.leaderEmail || actor.email).toLowerCase();
      const microsoftIdentity = payload.syncMicrosoft ? await authorizedMicrosoftIdentityForActor(actor) : null;
      const organizerEmail = microsoftIdentity?.microsoftEmail || actor.email.toLowerCase();
      const title = String(payload.title || `${type}${isCompanyMeeting(type) ? "" : ` · ${projectId}`}`);
      const attendees = (payload.attendees || []).filter((item) => item.name && item.email);
      if (payload.useSuggestedAttendees !== false) {
        const suggested = await suggestedMeetingPeople(type, projectId, actor);
        for (const person of suggested.attendees) if (!attendees.some(item => item.email.toLowerCase() === person.email.toLowerCase())) attendees.push(person);
      }
      if (isCompanyMeeting(type)) {
        const active = await db.select().from(companyMembers).where(eq(companyMembers.isActive, true));
        if ([...attendees, { email: leaderEmail }].some(person => !active.some(member => member.email.toLowerCase() === person.email.toLowerCase()))) return Response.json({ error: "Company And Department Meetings Require Active Company Participants" }, { status: 400 });
        if (type === "Accounting Department" && attendees.some(person => !active.some(member => member.email.toLowerCase() === person.email.toLowerCase() && (member.companyAccessLevel === "Company Owner" || JSON.parse(member.designationsJson || "[]").some((role: string) => DEPARTMENT_MEETING_ROLES[type]!.includes(role)))))) return Response.json({ error: "Accounting Meetings Require Company Owner Or Accounting Roles" }, { status: 400 });
      }
      if (attendees.some(person => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))) return Response.json({ error: "Every Attendee Needs A Valid Email Address" }, { status: 400 });
      if (isCompanyMeeting(type)) {
        const owners = await db.select().from(companyMembers).where(and(eq(companyMembers.companyAccessLevel, "Company Owner"), eq(companyMembers.isActive, true)));
        for (const owner of owners) if (!attendees.some((item) => item.email.toLowerCase() === owner.email.toLowerCase())) attendees.push({ name: owner.displayName, email: owner.email, attendanceRequirement: "Required", attendeeRole: "Company Owner" });
      }
      if (!attendees.some((item) => item.email.toLowerCase() === leaderEmail)) attendees.push({ name: leaderName, email: leaderEmail, attendanceRequirement: "Required", attendeeRole: "Meeting Leader" });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO meeting_series (id, meeting_type, project_id, title, cadence, start_at, duration_minutes, time_zone, meeting_mode, location, leader_name, leader_email, organizer_email, recording_default, auto_publish_hours, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
          seriesId, type, projectId, title, payload.cadence || defaults.cadence, startAt, duration, payload.timeZone || "America/New_York", payload.meetingMode || "Teams Remote", payload.location || "Microsoft Teams", leaderName, leaderEmail, organizerEmail, defaults.publishHours, actor.name,
        ),
        env.DB.prepare(`INSERT INTO meeting_occurrences (id, series_id, meeting_number, scheduled_start, scheduled_end, financial_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`).bind(
          occurrenceId, seriesId, number, startAt, endAt, JSON.stringify(type === "Project Owner" ? await ownerSnapshotWithDelta(projectId) : {}),
        ),
        ...attendees.map((attendee) => env.DB.prepare(`INSERT INTO meeting_attendees (id, occurrence_id, name, email, attendee_role, attendance_requirement, external) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
          crypto.randomUUID(), occurrenceId, attendee.name, attendee.email.toLowerCase(), attendee.attendeeRole || "Participant", attendee.attendanceRequirement || "Required", attendee.external ? 1 : 0,
        )),
      ]);
      const generated = await automatedAgendaItems({ type, projectId, occurrenceId, seriesId, actor });
      await auditMeeting({ actor, seriesId, occurrenceId, entityType: "Meeting Series", entityId: seriesId, action: "Created", after: { type, projectId, title, cadence: payload.cadence || defaults.cadence, attendees, generated } });
      let microsoft = { status: "Not Requested", detail: "Calendar synchronization was not requested." };
      if (payload.syncMicrosoft) {
        try {
          const event = await createMicrosoftMeeting({
            subject: title, startAt, endAt, timeZone: payload.timeZone || "America/New_York", cadence: payload.cadence || defaults.cadence,
            location: payload.location || "Microsoft Teams", transactionId: seriesId,
            attendees: attendees.map((item) => ({ email: item.email, name: item.name, required: item.attendanceRequirement !== "Optional" })),
            bodyHtml: `<p>This meeting is controlled by Mefford Command Center.</p><p>Meeting ${number}</p>`,
            organizerEmail,
          });
          const joinUrl = String(event.onlineMeeting?.joinUrl || "");
          const onlineMeeting = joinUrl ? await findOnlineMeetingByJoinUrl(joinUrl, organizerEmail).catch(() => null) : null;
          if (onlineMeeting?.id) await configureOnlineMeetingEvidence(onlineMeeting.id, true, organizerEmail).catch(() => undefined);
          await env.DB.batch([
            env.DB.prepare(`UPDATE meeting_series SET graph_event_id = ?, graph_change_key = ?, teams_join_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(event.id, event.changeKey || "", joinUrl, seriesId),
            env.DB.prepare(`UPDATE meeting_occurrences SET graph_event_id = ?, teams_meeting_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(event.id, onlineMeeting?.id || "", occurrenceId),
          ]);
          await writeSyncEvent({ seriesId, occurrenceId, eventType: "Calendar Series Created", status: "Succeeded", providerId: event.id, detail: joinUrl ? "Teams join link received." : "Event created; Teams join link pending." });
          microsoft = { status: "Succeeded", detail: "Outlook series and Teams meeting created." };
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Microsoft Calendar Sync Failed";
          await writeSyncEvent({ seriesId, occurrenceId, eventType: "Calendar Series Created", status: "Failed", detail });
          microsoft = { status: "Failed", detail };
        }
      }
      return Response.json({ saved: true, seriesId, occurrenceId, meetingNumber: number, generated, microsoft });
    }

    if (payload.action === "mark_not_required") {
      if (actor.accessLevel !== "Company Owner") return Response.json({ error: "Only A Company Owner May Mark A Project Meeting Not Required" }, { status: 403 });
      if (!validType(payload.meetingType) || isCompanyMeeting(payload.meetingType)) return Response.json({ error: "A Project Meeting Type Is Required" }, { status: 400 });
      if (!payload.projectId || !payload.reason?.trim()) return Response.json({ error: "Project And Permanent Audit Reason Are Required" }, { status: 400 });
      const id = payload.seriesId || crypto.randomUUID();
      const now = new Date().toISOString();
      if (payload.seriesId) {
        await env.DB.prepare(`UPDATE meeting_series SET status = 'Not Required', not_required_reason = ?, not_required_by = ?, not_required_at = ?, updated_at = ? WHERE id = ?`).bind(payload.reason.trim(), actor.name, now, now, id).run();
      } else {
        const defaults = MEETING_DEFAULTS[payload.meetingType];
        await env.DB.prepare(`INSERT INTO meeting_series (id, meeting_type, project_id, title, status, cadence, start_at, duration_minutes, time_zone, meeting_mode, location, leader_name, leader_email, organizer_email, not_required_reason, not_required_by, not_required_at, created_by) VALUES (?, ?, ?, ?, 'Not Required', ?, ?, ?, 'America/New_York', 'Teams Remote', 'Microsoft Teams', ?, ?, ?, ?, ?, ?, ?)`).bind(
          id, payload.meetingType, payload.projectId, `${payload.meetingType} · Not Required`, defaults.cadence, now, defaults.durationMinutes, actor.name, actor.email, actor.email, payload.reason.trim(), actor.name, now, actor.name,
        ).run();
      }
      await auditMeeting({ actor, seriesId: id, entityType: "Meeting Requirement", entityId: id, action: "Marked Not Required", reason: payload.reason, after: { projectId: payload.projectId, meetingType: payload.meetingType, status: "Not Required" } });
      return Response.json({ saved: true, seriesId: id });
    }

    if (payload.action === "create_occurrence") {
      if (!payload.seriesId) return Response.json({ error: "Meeting Series Is Required" }, { status: 400 });
      const series = await env.DB.prepare(`SELECT * FROM meeting_series WHERE id = ?`).bind(payload.seriesId).first<Record<string, string | number | null>>();
      if (series && isTurnover(series.meeting_type)) return Response.json({ error: "Use The Existing Turnover Packet For This Handoff" }, { status: 409 });
      if (!series || series.status !== "Active" || !actorCanEdit(actor, series)) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      const startAt = normalizedStart(String(payload.startAt || ""));
      const duration = Number(payload.durationMinutes || series.duration_minutes || 60);
      const endAt = new Date(new Date(startAt).getTime() + duration * 60_000).toISOString();
      const occurrenceId = crypto.randomUUID();
      const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM meeting_occurrences o JOIN meeting_series s ON s.id = o.series_id WHERE s.project_id = ? AND s.meeting_type = ?`).bind(series.project_id, series.meeting_type).first<{ total: number }>();
      const type = String(series.meeting_type) as MeetingType;
      const number = meetingNumber(type, String(series.project_id), startAt, Number(count?.total || 0) + 1);
      const priorAttendees = await env.DB.prepare(`SELECT * FROM meeting_attendees WHERE occurrence_id IN (SELECT id FROM meeting_occurrences WHERE series_id = ? ORDER BY scheduled_start DESC LIMIT 1)`).bind(payload.seriesId).all<Record<string, string | number | null>>();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO meeting_occurrences (id, series_id, meeting_number, scheduled_start, scheduled_end, financial_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)`).bind(occurrenceId, payload.seriesId, number, startAt, endAt, JSON.stringify(type === "Project Owner" ? await ownerSnapshotWithDelta(String(series.project_id), payload.seriesId) : {})),
        ...priorAttendees.results.map((attendee) => env.DB.prepare(`INSERT INTO meeting_attendees (id, occurrence_id, name, email, attendee_role, attendance_requirement, external) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), occurrenceId, attendee.name, attendee.email, attendee.attendee_role, attendee.attendance_requirement, attendee.external)),
      ]);
      const generated = await automatedAgendaItems({ type, projectId: String(series.project_id), occurrenceId, seriesId: payload.seriesId, actor });
      await auditMeeting({ actor, seriesId: payload.seriesId, occurrenceId, entityType: "Meeting Occurrence", entityId: occurrenceId, action: "Created", after: { number, startAt, generated } });
      return Response.json({ saved: true, occurrenceId, meetingNumber: number, generated });
    }

    if (!payload.occurrenceId) return Response.json({ error: "Meeting Occurrence Is Required" }, { status: 400 });
    const context = await getMeetingContext(payload.occurrenceId);
    if (!context) return Response.json({ error: "Meeting Occurrence Not Found" }, { status: 404 });
    const editable = actorCanEdit(actor, context);
    const canFinalize = canFinalizeMeeting(actor, context);
    if (!await canAccessMeeting(actor, context, payload.occurrenceId)) return Response.json({ error: "You Do Not Have Access To This Meeting" }, { status: 403 });
    if (payload.action.startsWith("turnover_")) return Response.json(await changeTurnover(context, actor, payload));
    if (FINAL_STATUSES.has(String(context.status)) && !["revise_minutes", "download"].includes(payload.action)) return Response.json({ error: "Finalized Meeting Records Are Locked. Create A Numbered Revision." }, { status: 409 });

    if (payload.action === "refresh_agenda") {
      if (!editable && !canManageAgenda(actor, context)) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      if (!["Draft Agenda", "Published Agenda", ...(isDepartmentMeeting(context.meeting_type) ? ["Meeting In Progress"] : [])].includes(String(context.status))) return Response.json({ error: "The Source Snapshot Is Locked For This Meeting" }, { status: 409 });
      const generated = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId: String(context.project_id), occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), actor });
      if (generated.busy) return Response.json({ error: "This Agenda Is Being Refreshed. Try Again In A Moment." }, { status: 409 });
      return Response.json({ saved: true, generated });
    }

    if (payload.action === "revise_minutes") {
      if (!canFinalize || !payload.reason?.trim() || !payload.minutesSummary?.trim()) return Response.json({ error: "Authorized Leader, Revised Minutes And A Permanent Revision Reason Are Required" }, { status: 403 });
      const now = new Date().toISOString();
      const revision = Number(context.minutes_revision || 0) + 1;
      const priorDistribution = { ...(JSON.parse(String(context.distribution_json || "{}")) as Record<string, unknown>), revisionStatus: "Revised Record", revisionReason: payload.reason.trim(), revisedAt: now };
      await env.DB.prepare(`UPDATE meeting_occurrences SET minutes_summary = ?, minutes_revision = ?, minutes_pdf_key = '', finalized_at = ?, finalized_by = ?, distribution_json = ?, updated_at = ? WHERE id = ?`).bind(payload.minutesSummary.trim(), revision, now, actor.name, JSON.stringify(priorDistribution), now, payload.occurrenceId).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Minutes", entityId: payload.occurrenceId, action: `Revised Minutes R${revision}`, before: { revision: context.minutes_revision, summary: context.minutes_summary, permanentPdfKey: context.minutes_pdf_key }, after: { revision, summary: payload.minutesSummary }, reason: payload.reason });
      return Response.json({ saved: true, revision });
    }

    if (payload.action === "add_attendee") {
      if (!editable || !payload.assigneeName || !payload.assigneeEmail) return Response.json({ error: "Leader Permission, Name And Email Are Required" }, { status: 403 });
      if (isCompanyMeeting(String(context.meeting_type) as MeetingType)) {
        const person = (await db.select().from(companyMembers).where(and(eq(companyMembers.email, payload.assigneeEmail.toLowerCase()), eq(companyMembers.isActive, true))).limit(1))[0];
        if (!person || payload.reason === "external") return Response.json({ error: "Company Meetings Require Active Company Participants" }, { status: 400 });
        payload.assigneeName = person.displayName;
        if (context.meeting_type === "Accounting Department" && person.companyAccessLevel !== "Company Owner" && !JSON.parse(person.designationsJson || "[]").some((role: string) => DEPARTMENT_MEETING_ROLES["Accounting Department"]!.includes(role))) return Response.json({ error: "Accounting Role Required For This Meeting" }, { status: 400 });
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO meeting_attendees (id, occurrence_id, name, email, attendee_role, attendance_requirement, external) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        id, payload.occurrenceId, payload.assigneeName, payload.assigneeEmail.toLowerCase(), payload.value || "Participant", payload.status || "Required", payload.reason === "external" ? 1 : 0,
      ).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Attendee", entityId: id, action: "Added", after: payload });
      return Response.json({ saved: true, id });
    }

    if (["add_agenda", "update_agenda", "remove_agenda", "restore_agenda"].includes(payload.action)) {
      return Response.json(await changeAgendaTopic(env.DB, actor, context, payload, editable));
    }
    if (payload.action === "agenda_settings") {
      const result = await saveAgendaSettings(env.DB, actor, context, payload);
      const generated = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId: String(context.project_id), occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), actor });
      return Response.json({ ...result, generated });
    }

    if (payload.action === "add_action") {
      if (!payload.title?.trim() || !payload.assigneeName || !payload.assigneeEmail || !payload.dueAt) return Response.json({ error: "Title, Assignee And Due Date Are Required" }, { status: 400 });
      const id = crypto.randomUUID();
      const dueAt = normalizedStart(payload.dueAt);
      await db.insert(meetingActionItems).values({
        id, occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), projectId: String(context.project_id), title: payload.title.trim(), definitionOfDone: payload.definitionOfDone || payload.title.trim(), assigneeName: payload.assigneeName, assigneeEmail: payload.assigneeEmail.toLowerCase(), dueAt, priority: payload.priority || "Normal", itemKind: payload.itemKind === "Rock" ? "Rock" : "To-Do", status: "Assignment Not Confirmed", sourceType: "Meeting", sourceId: payload.occurrenceId, createdBy: actor.name,
      });
      await upsertWorkItem(db, {
        dedupeKey: `meeting-action:${id}`, projectId: String(context.project_id), recipientName: payload.assigneeName, recipientEmail: payload.assigneeEmail.toLowerCase(), kind: "Meeting Action", title: payload.title.trim(), message: `Assignment from ${context.meeting_number}. Accept it or request clarification, then keep it current until complete.`, priority: payload.priority || "Normal", sourceType: "Meeting Action", sourceRecordId: id, actionTarget: MEETING_TARGET_BY_TYPE[String(context.meeting_type) as MeetingType], dueAt, createdBy: actor.name,
      });
      const workItem = await db.select({ id: commandWorkItems.id }).from(commandWorkItems).where(eq(commandWorkItems.dedupeKey, `meeting-action:${id}`)).limit(1);
      if (workItem[0]) await db.update(meetingActionItems).set({ workItemId: workItem[0].id }).where(eq(meetingActionItems.id, id));
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Action Item", entityId: id, action: "Assigned Pending Acceptance", after: payload });
      return Response.json({ saved: true, id });
    }

    if (payload.action === "action_status") {
      if (!payload.entityId || !payload.status) return Response.json({ error: "Action Item And Status Are Required" }, { status: 400 });
      const action = await db.select().from(meetingActionItems).where(and(eq(meetingActionItems.id, payload.entityId), eq(meetingActionItems.seriesId, String(context.series_id)))).limit(1);
      if (!action[0]) return Response.json({ error: "Action Item Not Found" }, { status: 404 });
      const ownsAction = action[0].assigneeEmail.toLowerCase() === actor.email.toLowerCase();
      if (!ownsAction && !editable) return Response.json({ error: "Only The Assignee Or Meeting Leader May Update This Action" }, { status: 403 });
      const allowed = ["Accepted", "Needs Clarification", "In Progress", "Blocked", "Complete", "Cancelled With Reason"];
      if (!allowed.includes(payload.status)) return Response.json({ error: "Unknown Action Status" }, { status: 400 });
      if (["Blocked", "Cancelled With Reason"].includes(payload.status) && !payload.reason?.trim()) return Response.json({ error: "A Reason Is Required For This Status" }, { status: 400 });
      await db.update(meetingActionItems).set({ status: payload.status, blocker: payload.status === "Blocked" ? payload.reason || "" : action[0].blocker, cancelledReason: payload.status === "Cancelled With Reason" ? payload.reason || "" : action[0].cancelledReason, evidence: payload.evidence || action[0].evidence, completedAt: payload.status === "Complete" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(meetingActionItems.id, payload.entityId));
      if (["Complete", "Cancelled With Reason"].includes(payload.status)) await closeMeetingWorkItem(payload.entityId);
      else if (action[0].workItemId) await db.update(commandWorkItems).set({ status: payload.status === "Accepted" ? "Acknowledged" : "Open", acknowledgedAt: payload.status === "Accepted" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(eq(commandWorkItems.id, action[0].workItemId));
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Action Item", entityId: payload.entityId, action: `Status · ${payload.status}`, before: action[0], after: payload, reason: payload.reason });
      return Response.json({ saved: true });
    }

    if (payload.action === "add_decision") {
      if (!payload.statement?.trim() || !payload.decisionMakerName || !payload.decisionMakerEmail) return Response.json({ error: "Decision Statement And Named Decision-Maker Are Required" }, { status: 400 });
      const id = crypto.randomUUID();
      await db.insert(meetingDecisions).values({ id, occurrenceId: payload.occurrenceId, statement: payload.statement.trim(), decisionMakerName: payload.decisionMakerName, decisionMakerEmail: payload.decisionMakerEmail.toLowerCase(), status: "Proposed", implementationOwner: payload.assigneeName || "", evidence: payload.evidence || "", proposedBy: actor.name });
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Decision", entityId: id, action: "Proposed", after: payload });
      return Response.json({ saved: true, id });
    }

    if (payload.action === "confirm_decision") {
      if (!payload.entityId) return Response.json({ error: "Decision Is Required" }, { status: 400 });
      const decision = await db.select().from(meetingDecisions).where(and(eq(meetingDecisions.id, payload.entityId), eq(meetingDecisions.occurrenceId, payload.occurrenceId))).limit(1);
      if (!decision[0]) return Response.json({ error: "Decision Not Found" }, { status: 404 });
      if (decision[0].decisionMakerEmail.toLowerCase() !== actor.email.toLowerCase() && actor.accessLevel !== "Company Owner") return Response.json({ error: "Only The Named Decision-Maker May Confirm This Decision" }, { status: 403 });
      await db.update(meetingDecisions).set({ status: "Confirmed in Meeting", confirmedBy: actor.name, confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(meetingDecisions.id, payload.entityId));
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Decision", entityId: payload.entityId, action: "Confirmed By Named Decision-Maker", before: decision[0], after: { status: "Confirmed in Meeting" } });
      return Response.json({ saved: true });
    }

    if (payload.action === "attendance") {
      const attendee = await db.select().from(meetingAttendees).where(and(eq(meetingAttendees.occurrenceId, payload.occurrenceId), eq(meetingAttendees.email, actor.email.toLowerCase()))).limit(1);
      if (!attendee[0] && !editable) return Response.json({ error: "Attendee Record Not Found" }, { status: 404 });
      const targetEmail = editable && payload.assigneeEmail ? payload.assigneeEmail.toLowerCase() : actor.email.toLowerCase();
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE meeting_attendees SET attendance_status = ?, attendance_source = ?, check_in_at = CASE WHEN ? = 'Present' THEN COALESCE(check_in_at, ?) ELSE check_in_at END, check_out_at = CASE WHEN ? = 'Ended' THEN ? ELSE check_out_at END, end_confirmed_at = CASE WHEN ? = 'Ended' THEN ? ELSE end_confirmed_at END, rating = COALESCE(?, rating), exception_reason = COALESCE(?, exception_reason), updated_at = ? WHERE occurrence_id = ? AND lower(email) = lower(?)`).bind(
        payload.attendanceStatus || "Present", payload.attendanceSource || "Command Center Check-In", payload.attendanceStatus || "Present", now, payload.attendanceStatus, now, payload.attendanceStatus, now, payload.rating ?? null, payload.reason ?? null, now, payload.occurrenceId, targetEmail,
      ).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Attendance", entityId: targetEmail, action: payload.attendanceStatus || "Present", reason: payload.reason, after: { source: payload.attendanceSource, rating: payload.rating } });
      return Response.json({ saved: true });
    }

    if (payload.action === "recording_override") {
      if (!canFinalize || !payload.reason?.trim() || typeof payload.value !== "boolean") return Response.json({ error: "Authorized Leader, Recording Selection And Audit Reason Are Required" }, { status: 403 });
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE meeting_occurrences SET recording_enabled = ?, recording_override_reason = ?, recording_override_by = ?, recording_override_at = ?, updated_at = ? WHERE id = ?`).bind(payload.value ? 1 : 0, payload.reason.trim(), actor.name, now, now, payload.occurrenceId).run();
      if ((await microsoftMeetingConnection()).configured && (context.teams_meeting_id || context.teams_join_url)) {
        try {
          const onlineId = String(context.teams_meeting_id || (await findOnlineMeetingByJoinUrl(String(context.teams_join_url), String(context.organizer_email)))?.id || "");
          if (onlineId) await configureOnlineMeetingEvidence(onlineId, payload.value, String(context.organizer_email));
          await writeSyncEvent({ seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, eventType: "Teams Recording Control", status: onlineId ? "Succeeded" : "Failed", providerId: onlineId, detail: onlineId ? `recordAutomatically set to ${payload.value}.` : "Online meeting ID was not resolved." });
        } catch (error) {
          await writeSyncEvent({ seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, eventType: "Teams Recording Control", status: "Failed", detail: error instanceof Error ? error.message : "Teams Recording Update Failed" });
        }
      }
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Recording Control", entityId: payload.occurrenceId, action: payload.value ? "Recording Enabled By Override" : "Recording Disabled By Override", reason: payload.reason, before: { enabled: context.recording_enabled }, after: { enabled: payload.value } });
      return Response.json({ saved: true });
    }

    if (payload.action === "publication_hold") {
      if (!editable || typeof payload.value !== "boolean" || (payload.value && !payload.reason?.trim())) return Response.json({ error: "Meeting Leader Permission And A Hold Reason Are Required" }, { status: 403 });
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE meeting_occurrences SET publication_hold = ?, publication_hold_reason = ?, publication_hold_by = ?, publication_hold_at = ?, updated_at = ? WHERE id = ?`).bind(payload.value ? 1 : 0, payload.value ? payload.reason!.trim() : "", actor.name, now, now, payload.occurrenceId).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Publication Control", entityId: payload.occurrenceId, action: payload.value ? "Auto-Publication Held" : "Auto-Publication Hold Released", reason: payload.reason, before: { held: context.publication_hold }, after: { held: payload.value } });
      if (!payload.value) await runDeterministicMeetingRules(String(context.project_id));
      return Response.json({ saved: true });
    }

    if (payload.action === "sync_teams_evidence") {
      if (!editable) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      if (!context.teams_join_url) return Response.json({ error: "This Occurrence Does Not Yet Have A Teams Meeting Link" }, { status: 409 });
      const online = context.teams_meeting_id
        ? { id: String(context.teams_meeting_id) }
        : await findOnlineMeetingByJoinUrl(String(context.teams_join_url), String(context.organizer_email));
      if (!online?.id) return Response.json({ error: "The Teams Online Meeting Could Not Be Resolved From Its Join Link" }, { status: 404 });
      const [attendanceReports, transcripts] = await Promise.all([getMeetingAttendance(online.id, String(context.organizer_email)), getMeetingTranscripts(online.id, String(context.organizer_email))]);
      const report = (attendanceReports.value || []).at(-1) as { attendanceRecords?: Array<{ emailAddress?: string; identity?: { displayName?: string }; attendanceIntervals?: Array<{ joinDateTime?: string; leaveDateTime?: string }> }> } | undefined;
      let imported = 0;
      for (const record of report?.attendanceRecords || []) {
        const email = String(record.emailAddress || "").toLowerCase();
        if (!email) continue;
        const intervals = record.attendanceIntervals || [];
        const first = intervals[0];
        const last = intervals[intervals.length - 1];
        const result = await env.DB.prepare(`UPDATE meeting_attendees SET attendance_status = 'Present', attendance_source = 'Microsoft Teams Attendance Report', check_in_at = COALESCE(?, check_in_at), check_out_at = COALESCE(?, check_out_at), updated_at = CURRENT_TIMESTAMP WHERE occurrence_id = ? AND lower(email) = lower(?)`).bind(first?.joinDateTime || null, last?.leaveDateTime || null, payload.occurrenceId, email).run();
        imported += Number(result.meta.changes || 0);
      }
      await env.DB.prepare(`UPDATE meeting_occurrences SET teams_meeting_id = ?, transcript_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(online.id, (transcripts.value || []).length ? `${transcripts.value!.length} Transcript File(s) Available For Drafting` : "No Transcript Available Yet", payload.occurrenceId).run();
      await writeSyncEvent({ seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, eventType: "Teams Evidence Import", status: "Succeeded", providerId: online.id, detail: `${imported} attendance records matched · ${(transcripts.value || []).length} transcript files found.` });
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Teams Evidence", entityId: online.id, action: "Attendance And Transcript Evidence Imported", after: { imported, transcripts: (transcripts.value || []).length } });
      return Response.json({ saved: true, imported, transcripts: (transcripts.value || []).length });
    }

    if (["publish", "start"].includes(payload.action) && isTurnover(context.meeting_type) && !(await turnoverView(payload.occurrenceId, actor))?.scheduled) return Response.json({ error: "Confirm The Turnover Date And Location First" }, { status: 409 });

    if (payload.action === "publish") {
      if (!editable) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      if (context.status !== "Draft Agenda") return Response.json({ error: "Only A Draft Agenda Can Be Published" }, { status: 409 });
      const refreshed = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId: String(context.project_id), occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), actor });
      if (refreshed.busy) return Response.json({ error: "Wait For The Agenda Refresh Before Publishing" }, { status: 409 });
      const now = new Date().toISOString();
      const publication = await env.DB.batch([
        env.DB.prepare(`UPDATE meeting_occurrences SET status = 'Published Agenda', published_at = ?, updated_at = ? WHERE id = ? AND status = 'Draft Agenda' AND NOT EXISTS (SELECT 1 FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND expires_at > ?)`).bind(now, now, payload.occurrenceId, payload.occurrenceId, now),
        env.DB.prepare(`UPDATE meeting_agenda_items SET published_at = COALESCE(published_at, ?), updated_at = ? WHERE occurrence_id = ? AND visibility = 'Attendees' AND EXISTS (SELECT 1 FROM meeting_occurrences WHERE id = ? AND status = 'Published Agenda' AND published_at = ?)`).bind(now, now, payload.occurrenceId, payload.occurrenceId, now),
      ]);
      if (!Number(publication[0].meta.changes || 0)) return Response.json({ error: "Meeting Changed Or Its Agenda Is Refreshing. Reload And Try Again." }, { status: 409 });
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Occurrence", entityId: payload.occurrenceId, action: "Agenda Published", before: { status: context.status }, after: { status: "Published Agenda" } });
      return Response.json({ saved: true });
    }

    if (payload.action === "start") {
      if (context.status !== "Published Agenda") return Response.json({ error: "Publish The Agenda Before Starting The Meeting" }, { status: 409 });
      if (!editable) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      const refreshed = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId: String(context.project_id), occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), actor });
      if (refreshed.busy) return Response.json({ error: "Wait For The Agenda Refresh Before Starting" }, { status: 409 });
      const now = new Date().toISOString();
      const started = await env.DB.prepare(`UPDATE meeting_occurrences SET status = 'Meeting In Progress', started_at = ?, updated_at = ? WHERE id = ? AND status = 'Published Agenda' AND NOT EXISTS (SELECT 1 FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND expires_at > ?)`).bind(now, now, payload.occurrenceId, payload.occurrenceId, now).run();
      if (!Number(started.meta.changes || 0)) return Response.json({ error: "Meeting Changed Or Its Agenda Is Refreshing. Reload And Try Again." }, { status: 409 });
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Occurrence", entityId: payload.occurrenceId, action: "Meeting Started", after: { recordingEnabled: Boolean(context.recording_enabled) } });
      return Response.json({ saved: true });
    }

    if (payload.action === "finish") {
      const refreshing = await env.DB.prepare(`SELECT occurrence_id FROM meeting_agenda_refresh_guards WHERE occurrence_id = ? AND expires_at > ?`).bind(payload.occurrenceId, new Date().toISOString()).first();
      if (refreshing) return Response.json({ error: "Wait For The Agenda Refresh Before Ending The Meeting." }, { status: 409 });
      if (context.status !== "Meeting In Progress") return Response.json({ error: "Start The Meeting Before Drafting Its Minutes" }, { status: 409 });
      if (!editable) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      const [agenda, decisions, actions] = await Promise.all([
        env.DB.prepare(`SELECT title, notes, status, source_reason FROM meeting_agenda_items WHERE occurrence_id = ? AND visibility = 'Attendees' AND status <> 'Superseded' ORDER BY position`).bind(payload.occurrenceId).all<Record<string, string>>(),
        env.DB.prepare(`SELECT statement, status, decision_maker_name FROM meeting_decisions WHERE occurrence_id = ? ORDER BY created_at`).bind(payload.occurrenceId).all<Record<string, string>>(),
        env.DB.prepare(`SELECT title, status, assignee_name, due_at FROM meeting_action_items WHERE occurrence_id = ? ORDER BY created_at`).bind(payload.occurrenceId).all<Record<string, string>>(),
      ]);
      const summary = payload.minutesSummary?.trim() || [
        `Meeting ${context.meeting_number} was held.`,
        `Agenda: ${agenda.results.map((item) => `${item.title} — ${item.status}: ${item.notes || "No Discussion Notes Recorded"}${item.source_reason ? ` (${item.source_reason})` : ""}`).join(" | ")}`,
        decisions.results.length ? `Decisions: ${decisions.results.map((item) => `${item.statement} (${item.status}; ${item.decision_maker_name})`).join(" | ")}` : "Decisions: None recorded.",
        actions.results.length ? `Actions: ${actions.results.map((item) => `${item.title} — ${item.assignee_name}, ${item.status}, due ${item.due_at}`).join(" | ")}` : "Actions: None recorded.",
      ].join("\n\n");
      const now = new Date().toISOString();
      await env.DB.prepare(`UPDATE meeting_occurrences SET status = 'Draft Minutes', held_at = COALESCE(held_at, ?), draft_minutes_at = ?, minutes_summary = ?, transcript_status = CASE WHEN recording_enabled = 1 THEN 'Transcript Import Pending' ELSE 'Recording Disabled By Audited Override' END, updated_at = ? WHERE id = ?`).bind(now, now, summary, now, payload.occurrenceId).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Occurrence", entityId: payload.occurrenceId, action: "Draft Minutes Generated", after: { summaryLength: summary.length } });
      return Response.json({ saved: true, summary });
    }

    if (payload.action === "save_minutes") {
      if (!editable) return Response.json({ error: "Meeting Leader Permission Required" }, { status: 403 });
      if (context.status !== "Draft Minutes") return Response.json({ error: "Only Draft Minutes Can Be Edited" }, { status: 409 });
      if (!payload.minutesSummary?.trim()) return Response.json({ error: "Enter The Draft Minutes" }, { status: 400 });
      await env.DB.prepare(`UPDATE meeting_occurrences SET minutes_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'Draft Minutes'`).bind(payload.minutesSummary.trim(), payload.occurrenceId).run();
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Minutes", entityId: payload.occurrenceId, action: "Draft Minutes Saved", before: { summary: context.minutes_summary }, after: { summary: payload.minutesSummary.trim() } });
      return Response.json({ saved: true });
    }

    if (payload.action === "finalize") {
      if (isTurnover(context.meeting_type)) await automatedAgendaItems({ type: context.meeting_type, projectId: String(context.project_id), occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), actor });
      if (isTurnover(context.meeting_type)) {
        const turnover = await turnoverView(payload.occurrenceId, actor);
        const bonusMeeting = !turnover ? await env.DB.prepare("SELECT project_id FROM project_bonus_controls WHERE occurrence_id=?").bind(payload.occurrenceId).first<{project_id:string}>() : null;
        if (!bonusMeeting && turnover?.status !== "Accepted") return Response.json({ error: "The Receiving Lead Must Accept The Current Turnover Before Finalizing Minutes" }, { status: 409 });
        if (bonusMeeting || turnover?.type === "Estimating To Operations Turnover") {
          const blockers = await bonusTurnoverBlockers(bonusMeeting?.project_id || turnover!.packet.projectId);
          if (blockers.length) return Response.json({error:`Bonus Agreement: ${blockers.join("; ")}`},{status:409});
        }
      }
      if (!canFinalize) return Response.json({ error: "Authorized Mefford Leader Permission Required" }, { status: 403 });
      if (String(context.status) !== "Draft Minutes") return Response.json({ error: "Draft Minutes Must Be Reviewed Before Finalization" }, { status: 409 });
      const unconfirmed = await env.DB.prepare(`SELECT COUNT(*) AS total FROM meeting_action_items WHERE series_id = ? AND status = 'Assignment Not Confirmed'`).bind(context.series_id).first<{ total: number }>();
      if (Number(unconfirmed?.total || 0) > 0) return Response.json({ error: "Every Action Requires Assignee Acceptance Or A Leader Disposition Before Minutes Can Be Finalized" }, { status: 409 });
      const attendees = await env.DB.prepare(`SELECT name, email FROM meeting_attendees WHERE occurrence_id = ?`).bind(payload.occurrenceId).all<{ name: string; email: string }>();
      const recipients = attendees.results.filter((item, index, items) => item.email && items.findIndex((candidate) => candidate.email.toLowerCase() === item.email.toLowerCase()) === index);
      const now = new Date().toISOString();
      if (payload.minutesSummary?.trim() && payload.minutesSummary.trim() !== context.minutes_summary) {
        await env.DB.prepare(`UPDATE meeting_occurrences SET minutes_summary = ? WHERE id = ? AND status = 'Draft Minutes'`).bind(payload.minutesSummary.trim(), payload.occurrenceId).run();
        await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Minutes", entityId: payload.occurrenceId, action: "Reviewed Draft Minutes Saved", before: { summary: context.minutes_summary }, after: { summary: payload.minutesSummary.trim() } });
        context.minutes_summary = payload.minutesSummary.trim();
      }
      const minutesBytes = await createMeetingMinutesPdf(context, actor.name);
      const minutesKey = `meetings/${context.project_id}/${payload.occurrenceId}/${context.meeting_number}-minutes-R1.pdf`;
      await env.BUCKET.put(minutesKey, minutesBytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { occurrenceId: payload.occurrenceId, kind: "minutes", revision: "1" } });
      const emailAttachments: Array<{ name: string; contentType: string; base64: string }> = [{ name: `${context.meeting_number}-Final-Minutes-R1.pdf`, contentType: "application/pdf", base64: bytesToBase64(minutesBytes) }];
      const includedFiles = await env.DB.prepare(`SELECT name, storage_key, content_type, size_bytes FROM meeting_attachments WHERE occurrence_id = ? AND include_with_minutes = 1 ORDER BY created_at`).bind(payload.occurrenceId).all<{ name: string; storage_key: string; content_type: string; size_bytes: number }>();
      let attachmentBytes = minutesBytes.length;
      for (const item of includedFiles.results) {
        if (attachmentBytes + Number(item.size_bytes || 0) > 3_500_000) continue;
        const object = await env.BUCKET.get(item.storage_key);
        if (!object) continue;
        const bytes = new Uint8Array(await object.arrayBuffer());
        emailAttachments.push({ name: item.name, contentType: item.content_type, base64: bytesToBase64(bytes) });
        attachmentBytes += bytes.length;
      }
      let distribution: { status: string; detail: string; providerReceipt?: Record<string, unknown> } = { status: "Deferred · Connection Required", detail: "Microsoft 365 meeting email is not configured." };
      const connection = await microsoftMeetingConnection();
      if (connection.configured && recipients.length) {
        try {
          const providerReceipt = await sendMeetingMinutesMail({ subject: `${context.meeting_number} · Final Meeting Minutes`, recipients, html: `<h1>${context.series_title}</h1><p><strong>${context.meeting_number}</strong></p><p>${String(context.minutes_summary || "").replace(/\n/g, "<br>")}</p><p>The branded minutes PDF and files explicitly marked Include With Minutes are attached. Oversized or controlled source files remain secure links in Mefford Command Center.</p>`, attachments: emailAttachments, senderEmail: String(context.organizer_email) });
          distribution = { status: "Provider Accepted", detail: `Microsoft Graph accepted the minutes PDF and ${emailAttachments.length - 1} approved attachment${emailAttachments.length === 2 ? "" : "s"} for ${recipients.length} designated attendee${recipients.length === 1 ? "" : "s"}; inbox delivery is not yet proven.`, providerReceipt };
        } catch (error) {
          distribution = { status: "Failed", detail: error instanceof Error ? error.message : "Meeting Email Failed" };
        }
      }
      await env.DB.prepare(`UPDATE meeting_occurrences SET status = 'Finalized/Distributed', finalized_at = ?, distributed_at = ?, finalized_by = ?, minutes_revision = CASE WHEN minutes_revision < 1 THEN 1 ELSE minutes_revision END, minutes_pdf_key = ?, distribution_json = ?, updated_at = ? WHERE id = ?`).bind(now, distribution.status === "Provider Accepted" ? now : null, actor.name, minutesKey, JSON.stringify({ ...distribution, recipients, attachedFiles: emailAttachments.map((item) => item.name), secureLinkFiles: includedFiles.results.filter((item) => !emailAttachments.some((attachment) => attachment.name === item.name)).map((item) => item.name) }), now, payload.occurrenceId).run();
      const linkedL10 = await createQuarterlyLinkedL10(context, actor);
      await writeSyncEvent({ seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, eventType: "Minutes Distribution", status: distribution.status, detail: distribution.detail });
      await auditMeeting({ actor, seriesId: String(context.series_id), occurrenceId: payload.occurrenceId, entityType: "Meeting Occurrence", entityId: payload.occurrenceId, action: "Minutes Finalized And Locked", after: { distribution, recipients } });
      const handoff = await recordCompletedWorkflowHandoff(env.DB, { workflowId: "meeting-accountability", eventId: `meeting-finalized:${payload.occurrenceId}:R1`, aggregateType: "Meeting Occurrence", aggregateId: payload.occurrenceId, projectId: String(context.project_id), actorName: actor.name, actorEmail: actor.email, occurredAt: now, payload: { occurrenceId: payload.occurrenceId, seriesId: String(context.series_id), minutesKey, distributionStatus: distribution.status, recipientCount: recipients.length } });
      return Response.json({ saved: true, distribution, linkedL10, handoff });
    }

    return Response.json({ error: "Unknown Meeting Action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Meeting Could Not Be Updated" }, { status: error instanceof AccessControlError || error instanceof MeetingAccessError || error instanceof MeetingAgendaError || error instanceof TurnoverError ? error.status : 500 });
  }
}
