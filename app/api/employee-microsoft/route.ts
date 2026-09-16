import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  createEmployeeCalendarEvent,
  createEmployeeMailFolder,
  deleteEmployeeCalendarEvent,
  deleteEmployeeMessage,
  forwardEmployeeMessage,
  getEmployeeMessage,
  listEmployeeCalendar,
  listEmployeeMailFolders,
  listEmployeeMessages,
  microsoftEmployeeConnection,
  moveEmployeeMessage,
  replyEmployeeMessage,
  sendEmployeeMail,
  updateEmployeeCalendarEvent,
  updateEmployeeMessage,
} from "../../../lib/microsoft-graph";
import { getCommandActor, resolveCommandActor } from "../../../lib/server-actor";
import {
  AccessControlError,
  authorizedMicrosoftIdentityForActor,
  recordMicrosoftActivity,
} from "../../../lib/microsoft-access-server";
import { microsoftEntraProofStatus } from "../../../lib/microsoft-entra-auth";

type MicrosoftPayload = {
  action?: string;
  folderId?: string;
  folderName?: string;
  messageId?: string;
  destinationId?: string;
  isRead?: boolean;
  recipients?: string[];
  subject?: string;
  bodyText?: string;
  attachments?: Array<{ name?: string; contentType?: string; base64?: string; size?: number }>;
  replyAll?: boolean;
  eventId?: string;
  startAt?: string;
  endAt?: string;
  location?: string;
  attendees?: string[];
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "mail";
  let identity: Awaited<ReturnType<typeof authorizedMicrosoftIdentityForActor>> | null = null;
  try {
    identity = await authorizedMicrosoftIdentityForActor(actor);
    const connection = await microsoftEmployeeConnection(identity.microsoftEmail);
    const entra = await microsoftEntraProofStatus(actor, identity);
    if (!connection.configured) return Response.json({ ...connection, entra, folders: [], messages: [], events: [], directLinks: directLinks(), boundary: "IT must connect Microsoft 365 before live Outlook data can appear here." });
    if (view === "calendar") {
      const start = validDate(url.searchParams.get("start")) || new Date().toISOString();
      const defaultEnd = new Date(new Date(start).getTime() + 45 * 24 * 60 * 60_000).toISOString();
      const end = validDate(url.searchParams.get("end")) || defaultEnd;
      const events = await listEmployeeCalendar(identity.microsoftEmail, start, end);
      await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Viewed Outlook Calendar", resourceType: "Calendar", status: "Succeeded", detail: { start, end, resultCount: events.length } });
      return Response.json({ ...connection, entra, events, directLinks: directLinks(), boundary: "Live Outlook calendar for your authenticated Mefford mailbox." });
    }
    if (view === "message") {
      const messageId = cleanId(url.searchParams.get("messageId"));
      if (!messageId) return Response.json({ error: "Message Is Required" }, { status: 400 });
      const message = await getEmployeeMessage(identity.microsoftEmail, messageId);
      await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Opened Outlook Message", resourceType: "Mail Message", resourceId: messageId, status: "Succeeded" });
      return Response.json({ ...connection, entra, message, directLinks: directLinks(), boundary: "Live Outlook message for your authenticated Mefford mailbox." });
    }
    const folderId = cleanId(url.searchParams.get("folderId") || "inbox");
    const [folders, messages] = await Promise.all([listEmployeeMailFolders(identity.microsoftEmail), listEmployeeMessages(identity.microsoftEmail, folderId)]);
    await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Viewed Outlook Mail", resourceType: "Mail", status: "Succeeded", detail: { folderId, resultCount: messages.length } });
    return Response.json({ ...connection, entra, folderId, folders, messages, directLinks: directLinks(), boundary: "Live Outlook mail for your authenticated Mefford mailbox. Folder and spam actions write back to Microsoft 365." });
  } catch (error) {
    if (identity) await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Viewed Microsoft Workspace", resourceType: "Microsoft 365", status: "Failed", error }).catch(() => undefined);
    const status = error instanceof AccessControlError ? error.status : 502;
    return Response.json({ folders: [], messages: [], events: [], directLinks: directLinks(), permissionError: true, error: graphError(error) }, { status });
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  let identity: Awaited<ReturnType<typeof authorizedMicrosoftIdentityForActor>> | null = null;
  try {
    identity = await authorizedMicrosoftIdentityForActor(actor);
    const connection = await microsoftEmployeeConnection(identity.microsoftEmail);
    if (!connection.configured) return Response.json({ error: "Microsoft 365 Must Be Connected In IT & Integrations Before This Action Can Run" }, { status: 503 });
    const input = await request.json() as MicrosoftPayload;
    if (input.action === "create_folder") {
      const folderName = clean(input.folderName, 80);
      if (folderName.length < 2) return Response.json({ error: "Folder Name Is Required" }, { status: 400 });
      const folder = await createEmployeeMailFolder(identity.microsoftEmail, folderName);
      await activity(actor, identity, "Created Outlook Folder", "Mail Folder", folder.id, { folderName });
      return Response.json({ saved: true, folder, notice: `${folderName} Was Added To Your Outlook Mailbox.` }, { status: 201 });
    }
    if (input.action === "set_read") {
      const messageId = cleanId(input.messageId);
      if (!messageId) return Response.json({ error: "Message Is Required" }, { status: 400 });
      await updateEmployeeMessage(identity.microsoftEmail, messageId, { isRead: Boolean(input.isRead) });
      await activity(actor, identity, input.isRead ? "Marked Outlook Message Read" : "Marked Outlook Message Unread", "Mail Message", messageId);
      return Response.json({ saved: true, notice: input.isRead ? "Message Marked Read." : "Message Marked Unread." });
    }
    if (input.action === "set_flag") {
      const messageId = cleanId(input.messageId);
      if (!messageId) return Response.json({ error: "Message Is Required" }, { status: 400 });
      await updateEmployeeMessage(identity.microsoftEmail, messageId, { flag: { flagStatus: input.isRead ? "flagged" : "notFlagged" } });
      await activity(actor, identity, input.isRead ? "Flagged Outlook Message" : "Cleared Outlook Message Flag", "Mail Message", messageId);
      return Response.json({ saved: true, notice: input.isRead ? "Message Flagged." : "Message Flag Cleared." });
    }
    if (input.action === "move_message") {
      const messageId = cleanId(input.messageId);
      const destinationId = cleanId(input.destinationId);
      if (!messageId || !destinationId) return Response.json({ error: "Message And Destination Folder Are Required" }, { status: 400 });
      await moveEmployeeMessage(identity.microsoftEmail, messageId, destinationId);
      await activity(actor, identity, "Moved Outlook Message", "Mail Message", messageId, { destinationId });
      return Response.json({ saved: true, notice: destinationId.toLowerCase().includes("junk") ? "Message Moved To Junk." : "Message Moved." });
    }
    if (input.action === "delete_message") {
      const messageId = cleanId(input.messageId);
      if (!messageId) return Response.json({ error: "Message Is Required" }, { status: 400 });
      await deleteEmployeeMessage(identity.microsoftEmail, messageId);
      await activity(actor, identity, "Deleted Outlook Message", "Mail Message", messageId);
      return Response.json({ saved: true, notice: "Message Deleted From Outlook." });
    }
    if (input.action === "reply_message") {
      const messageId = cleanId(input.messageId);
      const bodyText = clean(input.bodyText, 20_000);
      if (!messageId || !bodyText) return Response.json({ error: "Message And Reply Are Required" }, { status: 400 });
      await replyEmployeeMessage(identity.microsoftEmail, messageId, bodyText, Boolean(input.replyAll));
      await activity(actor, identity, input.replyAll ? "Replied All To Outlook Message" : "Replied To Outlook Message", "Mail Message", messageId);
      return Response.json({ accepted: true, notice: input.replyAll ? "Microsoft 365 Accepted Your Reply To All." : "Microsoft 365 Accepted Your Reply." });
    }
    if (input.action === "forward_message") {
      const messageId = cleanId(input.messageId);
      const recipients = validRecipients(input.recipients);
      const bodyText = clean(input.bodyText, 20_000);
      if (!messageId || !recipients.length) return Response.json({ error: "Message And At Least One Valid Recipient Are Required" }, { status: 400 });
      await forwardEmployeeMessage(identity.microsoftEmail, messageId, recipients, bodyText);
      await activity(actor, identity, "Forwarded Outlook Message", "Mail Message", messageId, { recipientCount: recipients.length });
      return Response.json({ accepted: true, notice: "Microsoft 365 Accepted The Forwarded Message." });
    }
    if (input.action === "send_mail") {
      const recipients = validRecipients(input.recipients);
      const subject = clean(input.subject, 180);
      const bodyText = clean(input.bodyText, 20_000);
      const attachments = validAttachments(input.attachments);
      if (!subject || !bodyText || !recipients.length) return Response.json({ error: "Subject Message And Up To 100 Valid Recipient Emails Are Required" }, { status: 400 });
      if (attachments.error) return Response.json({ error: attachments.error }, { status: 400 });
      const receipt = await sendEmployeeMail(identity.microsoftEmail, { recipients, subject, bodyText, attachments: attachments.files });
      await activity(actor, identity, "Outlook Email Provider Accepted", "Mail Message", receipt.requestId || receipt.clientRequestId, { subject, recipientCount: recipients.length, attachmentCount: attachments.files.length, providerStatus: receipt.status, acceptedAt: receipt.acceptedAt });
      return Response.json({ accepted: true, receipt, notice: "Microsoft 365 Accepted The Email From Your Mefford Outlook Mailbox." });
    }
    if (input.action === "create_event") {
      const subject = clean(input.subject, 180);
      const startAt = validDate(input.startAt);
      const endAt = validDate(input.endAt);
      const attendees = [...new Set((input.attendees || []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))];
      if (!subject || !startAt || !endAt || endAt <= startAt) return Response.json({ error: "Event Title Start And End Are Required" }, { status: 400 });
      if (attendees.length > 100 || attendees.some((email) => !validEmail(email))) return Response.json({ error: "Use Up To 100 Valid Attendee Email Addresses" }, { status: 400 });
      const event = await createEmployeeCalendarEvent(identity.microsoftEmail, { subject, startAt, endAt, timeZone: "America/New_York", bodyText: clean(input.bodyText, 4_000), location: clean(input.location, 200), attendees });
      await activity(actor, identity, attendees.length ? "Sent Outlook Calendar Invitation" : "Created Outlook Calendar Event", "Calendar Event", event.id, { subject, startAt, endAt, attendeeCount: attendees.length });
      return Response.json({ saved: true, event, notice: attendees.length ? `Calendar Invitation Sent From ${identity.microsoftEmail}.` : `Event Added To ${identity.microsoftEmail}.` }, { status: 201 });
    }
    if (input.action === "update_event") {
      const eventId = cleanId(input.eventId);
      const subject = clean(input.subject, 180);
      const startAt = validDate(input.startAt);
      const endAt = validDate(input.endAt);
      const attendees = validRecipients(input.attendees);
      if (!eventId || !subject || !startAt || !endAt || endAt <= startAt) return Response.json({ error: "Event Title Start And End Are Required" }, { status: 400 });
      await updateEmployeeCalendarEvent(identity.microsoftEmail, eventId, { subject, startAt, endAt, timeZone: "America/New_York", bodyText: clean(input.bodyText, 4_000), location: clean(input.location, 200), attendees });
      await activity(actor, identity, "Updated Outlook Calendar Event", "Calendar Event", eventId, { subject, startAt, endAt, attendeeCount: attendees.length });
      return Response.json({ saved: true, notice: "Outlook Calendar Event Updated." });
    }
    if (input.action === "delete_event") {
      const eventId = cleanId(input.eventId);
      if (!eventId) return Response.json({ error: "Calendar Event Is Required" }, { status: 400 });
      await deleteEmployeeCalendarEvent(identity.microsoftEmail, eventId);
      await activity(actor, identity, "Deleted Outlook Calendar Event", "Calendar Event", eventId);
      return Response.json({ saved: true, notice: "Event Removed From Your Outlook Calendar." });
    }
    return Response.json({ error: "A Supported Microsoft Mail Or Calendar Action Is Required" }, { status: 400 });
  } catch (error) {
    if (identity) await recordMicrosoftActivity({ actor, microsoftEmail: identity.microsoftEmail, providerSubject: identity.providerSubject, action: "Microsoft Workspace Action", resourceType: "Microsoft 365", status: "Failed", error }).catch(() => undefined);
    return Response.json({ error: graphError(error) }, { status: error instanceof AccessControlError ? error.status : 502 });
  }
}

function directLinks() {
  return { mail: "https://outlook.office.com/mail/", calendar: "https://outlook.office.com/calendar/", teams: "https://teams.microsoft.com/" };
}

function clean(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max);
}

function cleanId(value: unknown) {
  return String(value || "").trim().slice(0, 1_000);
}

function validDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validRecipients(value: unknown) {
  const recipients = [...new Set((Array.isArray(value) ? value : []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))];
  return recipients.length <= 100 && recipients.every(validEmail) ? recipients : [];
}

function validAttachments(value: unknown) {
  const raw = Array.isArray(value) ? value.slice(0, 6) : [];
  if (Array.isArray(value) && value.length > 6) return { files: [], error: "Use No More Than Six Attachments Per Message" };
  const files = raw.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {}).map((item) => ({
    name: clean(item.name, 160),
    contentType: clean(item.contentType || "application/octet-stream", 120),
    base64: String(item.base64 || ""),
  }));
  if (files.some((file) => !file.name || !file.base64 || !/^[A-Za-z0-9+/=]+$/.test(file.base64))) return { files: [], error: "Every Attachment Must Be A Valid File" };
  const approximateBytes = files.reduce((sum, file) => sum + Math.ceil(file.base64.length * 0.75), 0);
  if (approximateBytes > 8 * 1024 * 1024) return { files: [], error: "Attachments Cannot Exceed Eight Megabytes In One Message" };
  return { files, error: "" };
}

function graphError(error: unknown) {
  const detail = error instanceof Error ? error.message : "Microsoft 365 Request Failed";
  return `Microsoft 365 Could Not Complete This Action: ${detail}. IT should verify application consent for Mail.ReadWrite, Mail.Send, and Calendars.ReadWrite.`;
}

async function activity(
  actor: ReturnType<typeof getCommandActor>,
  identity: Awaited<ReturnType<typeof authorizedMicrosoftIdentityForActor>>,
  action: string,
  resourceType: string,
  resourceId = "",
  detail: Record<string, unknown> = {},
) {
  await recordMicrosoftActivity({
    actor,
    microsoftEmail: identity.microsoftEmail,
    providerSubject: identity.providerSubject,
    action,
    resourceType,
    resourceId,
    status: "Succeeded",
    detail: { ...detail, attribution: `Performed through ${identity.microsoftEmail}` },
  });
}
