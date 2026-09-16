import { commandRecords, recordAudits } from "../../../db/schema";
import { enforceOnboardingAccess, PEOPLE_PROJECT_ID } from "../../../lib/onboarding";
import { createMicrosoftMeeting, microsoftMeetingConnection } from "../../../lib/microsoft-graph";
import { resolveCommandActor } from "../../../lib/server-actor";
import { AccessControlError, authorizedMicrosoftIdentityForActor, recordMicrosoftActivity } from "../../../lib/microsoft-access-server";

type InvitePayload = {
  title?: string;
  startAt?: string;
  durationMinutes?: number;
  attendees?: string[];
  message?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const identity = await authorizedMicrosoftIdentityForActor(actor);
    const connection = await microsoftMeetingConnection();
    return Response.json({ configured: connection.configured, organizer: connection.configured ? identity.microsoftEmail : "Connection Required In IT & Integrations", identityApproved: true, directLinks: { teams: "https://teams.microsoft.com/", calendar: "https://outlook.office.com/calendar/" } });
  } catch (error) {
    return Response.json({ configured: false, identityApproved: false, error: error instanceof Error ? error.message : "Microsoft Identity Approval Is Required", directLinks: { teams: "https://teams.microsoft.com/", calendar: "https://outlook.office.com/calendar/" } }, { status: error instanceof AccessControlError ? error.status : 502 });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const input = await request.json() as InvitePayload;
    const identity = await authorizedMicrosoftIdentityForActor(actor);
    const connection = await microsoftMeetingConnection();
    if (!connection.configured) return Response.json({ error: "Automatic Teams Invites Need The Microsoft 365 Connection In IT & Integrations" }, { status: 503 });
    const title = clean(input.title, 160);
    const message = clean(input.message, 2_000);
    const start = new Date(String(input.startAt || ""));
    const duration = Math.max(15, Math.min(480, Number(input.durationMinutes || 30)));
    if (!title || Number.isNaN(start.getTime())) return Response.json({ error: "Meeting Title Start Date And Start Time Are Required" }, { status: 400 });
    const attendeeEmails = [...new Set([identity.microsoftEmail, ...(input.attendees || []).map((email) => email.trim().toLowerCase()).filter(Boolean)])];
    if (attendeeEmails.length > 50 || attendeeEmails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return Response.json({ error: "Use Up To 50 Valid Attendee Email Addresses" }, { status: 400 });
    const id = `EMPLOYEE-MEETING-${crypto.randomUUID()}`;
    const end = new Date(start.getTime() + duration * 60_000);
    const event = await createMicrosoftMeeting({
      subject: title,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timeZone: "America/New_York",
      cadence: "As Needed",
      location: "Microsoft Teams",
      transactionId: id,
      attendees: attendeeEmails.map((email) => ({ email, name: email === identity.microsoftEmail ? actor.name : email.split("@")[0], required: true })),
      bodyHtml: `<p>${escapeHtml(message || "Meeting invitation created from My Employee Home.")}</p><p>Organizer: ${escapeHtml(actor.name)}</p>`,
      organizerEmail: identity.microsoftEmail,
    });
    const joinUrl = String(event.onlineMeeting?.joinUrl || "");
    const now = new Date().toISOString();
    const { getDb } = await import("../../../db");
    const db = getDb();
    await Promise.all([
      db.insert(commandRecords).values({ projectId: PEOPLE_PROJECT_ID, id, recordType: "Employee Teams Invite", title, owner: actor.name, due: start.toISOString(), status: "Sent", meta: `${attendeeEmails.length} Attendee${attendeeEmails.length === 1 ? "" : "s"} · Microsoft Teams`, recordDate: start.toISOString().slice(0, 10), recordTime: start.toISOString().slice(11, 16), dateLocked: true, dataJson: JSON.stringify({ employeeEmail: actor.email, organizerEmail: identity.microsoftEmail, attendees: attendeeEmails, startAt: start.toISOString(), endAt: end.toISOString(), durationMinutes: duration, message, graphEventId: event.id, teamsJoinUrl: joinUrl, outlookWebLink: event.webLink || "", sentAt: now }), updatedAt: now }),
      db.insert(recordAudits).values({ projectId: PEOPLE_PROJECT_ID, recordId: id, fieldName: "Employee Teams Invite", oldValue: "New", newValue: "Sent", reason: "Authenticated employee requested a Microsoft Teams invitation", actorName: actor.name, actorEmail: actor.email, summary: `${actor.name} sent ${title} to ${attendeeEmails.length} attendee(s) through Microsoft 365.`, createdAt: now }),
    ]);
    await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Sent Microsoft Teams Invitation", resourceType: "Teams Meeting", resourceId: event.id, status: "Succeeded", detail: { title, attendeeCount: attendeeEmails.length, startAt: start.toISOString(), attribution: `Organized by ${identity.microsoftEmail}` } });
    return Response.json({ sent: true, joinUrl, webLink: event.webLink || "", organizer: identity.microsoftEmail, notice: `Teams Invite Sent From ${identity.microsoftEmail} And Added To That Calendar.` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Teams Invite Could Not Be Sent" }, { status: error instanceof AccessControlError ? error.status : 500 });
  }
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}
