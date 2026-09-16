import type { MicrosoftDirectoryPerson } from "./microsoft-access";

type GraphAuthConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

type GraphMeetingConfig = GraphAuthConfig & {
  mailbox: string;
};

function authConfigFromEnv(env: Record<string, unknown>): GraphAuthConfig | null {
  const config = {
    tenantId: String(env.MICROSOFT_GRAPH_TENANT_ID || ""),
    clientId: String(env.MICROSOFT_GRAPH_CLIENT_ID || ""),
    clientSecret: String(env.MICROSOFT_GRAPH_CLIENT_SECRET || ""),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

function meetingConfigFromEnv(env: Record<string, unknown>): GraphMeetingConfig | null {
  const auth = authConfigFromEnv(env);
  const mailbox = String(env.MICROSOFT_MEETINGS_MAILBOX || "").trim().toLowerCase();
  return auth ? { ...auth, mailbox } : null;
}

export async function microsoftDirectoryConnection() {
  const { env } = await import("cloudflare:workers");
  const config = authConfigFromEnv(env as unknown as Record<string, unknown>);
  return {
    configured: Boolean(config),
    requiredPermissions: ["User.Read.All"],
    requiredSettings: config
      ? []
      : [
          "MICROSOFT_GRAPH_TENANT_ID",
          "MICROSOFT_GRAPH_CLIENT_ID",
          "MICROSOFT_GRAPH_CLIENT_SECRET",
        ],
  };
}

export async function microsoftMeetingConnection() {
  const { env } = await import("cloudflare:workers");
  const config = meetingConfigFromEnv(env as unknown as Record<string, unknown>);
  return {
    configured: Boolean(config),
    mailbox: config?.mailbox || "",
    requiredSettings: config
      ? []
      : [
          "MICROSOFT_GRAPH_TENANT_ID",
          "MICROSOFT_GRAPH_CLIENT_ID",
          "MICROSOFT_GRAPH_CLIENT_SECRET",
        ],
    organizerRule: "Each Command Center user must have an owner-approved Microsoft identity grant. MICROSOFT_MEETINGS_MAILBOX is fallback-only.",
  };
}

async function accessToken() {
  const { env } = await import("cloudflare:workers");
  const config = authConfigFromEnv(env as unknown as Record<string, unknown>);
  if (!config) throw new Error("Microsoft 365 Graph Connection Is Not Configured");
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000) },
  );
  const result = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "Microsoft 365 Authentication Failed");
  }
  return { token: result.access_token, config };
}

async function meetingConfig(organizerEmail = "") {
  const { env } = await import("cloudflare:workers");
  const config = meetingConfigFromEnv(env as unknown as Record<string, unknown>);
  if (!config) throw new Error("Microsoft 365 Graph Connection Is Not Configured");
  const mailbox = organizerEmail.trim().toLowerCase() || config.mailbox;
  if (!mailbox) throw new Error("An Owner-Approved Microsoft Organizer Is Required");
  return { ...config, mailbox };
}

async function graph<T>(pathOrUrl: string, init: RequestInit = {}) {
  const { token } = await accessToken();
  const url = pathOrUrl.startsWith("https://graph.microsoft.com/")
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  if (!url.startsWith("https://graph.microsoft.com/")) throw new Error("Microsoft Graph Paging URL Was Rejected");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  const result = raw ? JSON.parse(raw) as T & { error?: { message?: string } } : {} as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Microsoft Graph Returned ${response.status}`);
  return result;
}

export class MicrosoftGraphRequestError extends Error {
  status: number;
  requestId: string;
  retryAfterSeconds: number;

  constructor(message: string, response: Response) {
    super(message);
    this.name = "MicrosoftGraphRequestError";
    this.status = response.status;
    this.requestId = response.headers.get("request-id") || "";
    this.retryAfterSeconds = retryAfterSeconds(response.headers.get("retry-after"));
  }
}

export async function sendMicrosoftMailAccepted(senderEmail: string, input: { subject: string; bodyText: string; recipients: string[]; clientRequestId: string; attachments?: Array<{ name: string; contentType: string; base64: string }> }) {
  return sendMicrosoftMailPayloadAccepted(senderEmail, {
    message: {
      subject: input.subject,
      body: { contentType: "Text", content: input.bodyText },
      toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
      ...(input.attachments?.length ? { attachments: input.attachments.map(attachment => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: attachment.name, contentType: attachment.contentType, contentBytes: attachment.base64 })) } : {}),
    },
    saveToSentItems: true,
  }, input.clientRequestId);
}

async function sendMicrosoftMailPayloadAccepted(senderEmail: string, payload: Record<string, unknown>, clientRequestId: string) {
  const { token } = await accessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "client-request-id": clientRequestId,
      "return-client-request-id": "true",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new MicrosoftGraphRequestError(result.error?.message || `Microsoft Graph Returned ${response.status}`, response);
  }
  return {
    status: response.status,
    requestId: response.headers.get("request-id") || "",
    clientRequestId: response.headers.get("client-request-id") || clientRequestId,
    acceptedAt: new Date().toISOString(),
    evidence: "Provider Accepted; downstream mailbox delivery is not yet proven",
  };
}

export async function microsoftGraphRequest<T>(pathOrUrl: string, init: RequestInit = {}) {
  return graph<T>(pathOrUrl, init);
}

export async function microsoftGraphUploadContent<T>(path: string, body: BodyInit, contentType: string) {
  const { token } = await accessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType || "application/octet-stream" },
    body,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Microsoft Graph File Upload Returned ${response.status}`);
  return result;
}

export async function listMicrosoftDirectoryUsers() {
  const users: MicrosoftDirectoryPerson[] = [];
  let next = "/users?$top=999&$select=id,displayName,userPrincipalName,mail,jobTitle,department,userType,accountEnabled";
  for (let page = 0; next && page < 25; page += 1) {
    const result: { value?: MicrosoftDirectoryPerson[]; "@odata.nextLink"?: string } = await graph(next);
    users.push(...(result.value || []));
    next = result["@odata.nextLink"] || "";
  }
  return users;
}

function recurrence(cadence: string, startAt: string) {
  const start = new Date(startAt);
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][start.getUTCDay()];
  if (cadence === "Weekly" || cadence === "Biweekly") {
    return {
      pattern: { type: "weekly", interval: cadence === "Weekly" ? 1 : 2, daysOfWeek: [day] },
      range: { type: "noEnd", startDate: start.toISOString().slice(0, 10) },
    };
  }
  if (cadence === "Monthly") {
    return {
      pattern: { type: "absoluteMonthly", interval: 1, dayOfMonth: start.getUTCDate() },
      range: { type: "noEnd", startDate: start.toISOString().slice(0, 10) },
    };
  }
  if (cadence === "Quarterly") {
    return {
      pattern: { type: "absoluteMonthly", interval: 3, dayOfMonth: start.getUTCDate() },
      range: { type: "noEnd", startDate: start.toISOString().slice(0, 10) },
    };
  }
  return undefined;
}

export async function createMicrosoftMeeting(input: {
  subject: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  cadence: string;
  location: string;
  transactionId: string;
  attendees: Array<{ email: string; name: string; required: boolean }>;
  bodyHtml: string;
  organizerEmail?: string;
}) {
  const config = await meetingConfig(input.organizerEmail);
  return graph<{
    id: string;
    changeKey?: string;
    webLink?: string;
    onlineMeeting?: { joinUrl?: string };
  }>(`/users/${encodeURIComponent(config.mailbox)}/calendar/events`, {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "HTML", content: input.bodyHtml },
      start: { dateTime: input.startAt, timeZone: input.timeZone },
      end: { dateTime: input.endAt, timeZone: input.timeZone },
      location: { displayName: input.location || "Microsoft Teams" },
      attendees: input.attendees.map((item) => ({
        emailAddress: { address: item.email, name: item.name },
        type: item.required ? "required" : "optional",
      })),
      recurrence: recurrence(input.cadence, input.startAt),
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      allowNewTimeProposals: true,
      transactionId: input.transactionId,
    }),
  });
}

export async function microsoftEmployeeConnection(employeeEmail: string) {
  const connection = await microsoftDirectoryConnection();
  return {
    configured: connection.configured,
    employeeEmail,
    requiredPermissions: ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"],
    requiredSettings: connection.requiredSettings,
  };
}

export async function listEmployeeMailFolders(employeeEmail: string) {
  const result = await graph<{ value?: Array<{ id: string; displayName: string; totalItemCount: number; unreadItemCount: number; parentFolderId?: string; childFolderCount?: number }> }>(
    `/users/${encodeURIComponent(employeeEmail)}/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount,parentFolderId,childFolderCount`,
  );
  return result.value || [];
}

export async function listEmployeeMessages(employeeEmail: string, folderId = "inbox") {
  const result = await graph<{ value?: Array<{ id: string; subject?: string; bodyPreview?: string; receivedDateTime?: string; isRead?: boolean; hasAttachments?: boolean; importance?: string; webLink?: string; flag?: { flagStatus?: string }; from?: { emailAddress?: { name?: string; address?: string } } }> }>(
    `/users/${encodeURIComponent(employeeEmail)}/mailFolders/${encodeURIComponent(folderId)}/messages?$top=50&$orderby=receivedDateTime%20desc&$select=id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,importance,webLink,flag,from`,
  );
  return result.value || [];
}

export async function getEmployeeMessage(employeeEmail: string, messageId: string) {
  return graph<{
    id: string;
    subject?: string;
    bodyPreview?: string;
    body?: { contentType?: string; content?: string };
    receivedDateTime?: string;
    sentDateTime?: string;
    isRead?: boolean;
    hasAttachments?: boolean;
    importance?: string;
    webLink?: string;
    flag?: { flagStatus?: string };
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
    ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  }>(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}?$select=id,subject,bodyPreview,body,receivedDateTime,sentDateTime,isRead,hasAttachments,importance,webLink,flag,from,toRecipients,ccRecipients`, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
}

export async function createEmployeeMailFolder(employeeEmail: string, displayName: string) {
  return graph<{ id: string; displayName: string }>(`/users/${encodeURIComponent(employeeEmail)}/mailFolders`, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export async function updateEmployeeMessage(employeeEmail: string, messageId: string, input: { isRead?: boolean; flag?: { flagStatus: "flagged" | "notFlagged" | "complete" }; importance?: "low" | "normal" | "high" }) {
  return graph<Record<string, unknown>>(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteEmployeeMessage(employeeEmail: string, messageId: string) {
  await graph(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
}

export async function replyEmployeeMessage(employeeEmail: string, messageId: string, comment: string, replyAll = false) {
  return graph<Record<string, unknown>>(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}/${replyAll ? "replyAll" : "reply"}`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function forwardEmployeeMessage(employeeEmail: string, messageId: string, recipients: string[], comment: string) {
  return graph<Record<string, unknown>>(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}/forward`, {
    method: "POST",
    body: JSON.stringify({
      comment,
      toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
    }),
  });
}

export async function moveEmployeeMessage(employeeEmail: string, messageId: string, destinationId: string) {
  return graph<Record<string, unknown>>(`/users/${encodeURIComponent(employeeEmail)}/messages/${encodeURIComponent(messageId)}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId }),
  });
}

export async function sendEmployeeMail(employeeEmail: string, input: { subject: string; bodyText: string; recipients: string[]; attachments?: Array<{ name: string; contentType: string; base64: string }> }) {
  const clientRequestId = crypto.randomUUID();
  if (!input.attachments?.length) return sendMicrosoftMailAccepted(employeeEmail, { ...input, clientRequestId });
  return sendMicrosoftMailPayloadAccepted(employeeEmail, {
    message: {
      subject: input.subject,
      body: { contentType: "Text", content: input.bodyText },
      toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
      attachments: input.attachments.map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: attachment.contentType,
        contentBytes: attachment.base64,
      })),
    },
    saveToSentItems: true,
  }, clientRequestId);
}

export async function listEmployeeCalendar(employeeEmail: string, startAt: string, endAt: string) {
  const result = await graph<{ value?: Array<{ id: string; subject?: string; bodyPreview?: string; start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string }; location?: { displayName?: string }; organizer?: { emailAddress?: { name?: string; address?: string } }; attendees?: Array<{ type?: string; status?: { response?: string }; emailAddress?: { name?: string; address?: string } }>; webLink?: string; isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string } }> }>(
    `/users/${encodeURIComponent(employeeEmail)}/calendarView?startDateTime=${encodeURIComponent(startAt)}&endDateTime=${encodeURIComponent(endAt)}&$top=100&$orderby=start/dateTime&$select=id,subject,bodyPreview,start,end,location,organizer,attendees,webLink,isOnlineMeeting,onlineMeeting`,
  );
  return result.value || [];
}

export async function createEmployeeCalendarEvent(employeeEmail: string, input: { subject: string; startAt: string; endAt: string; timeZone: string; bodyText?: string; location?: string; isAllDay?: boolean; attendees?: string[] }) {
  return graph<{ id: string; webLink?: string }>(`/users/${encodeURIComponent(employeeEmail)}/calendar/events`, {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "Text", content: input.bodyText || "" },
      start: { dateTime: input.startAt, timeZone: input.timeZone },
      end: { dateTime: input.endAt, timeZone: input.timeZone },
      location: { displayName: input.location || "" },
      isAllDay: Boolean(input.isAllDay),
      attendees: (input.attendees || []).map((address) => ({ emailAddress: { address }, type: "required" })),
    }),
  });
}

export async function deleteEmployeeCalendarEvent(employeeEmail: string, eventId: string) {
  await graph(`/users/${encodeURIComponent(employeeEmail)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

export async function updateEmployeeCalendarEvent(employeeEmail: string, eventId: string, input: { subject: string; startAt: string; endAt: string; timeZone: string; bodyText?: string; location?: string; attendees?: string[] }) {
  return graph<Record<string, unknown>>(`/users/${encodeURIComponent(employeeEmail)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "Text", content: input.bodyText || "" },
      start: { dateTime: input.startAt, timeZone: input.timeZone },
      end: { dateTime: input.endAt, timeZone: input.timeZone },
      location: { displayName: input.location || "" },
      attendees: (input.attendees || []).map((address) => ({ emailAddress: { address }, type: "required" })),
    }),
  });
}

export async function updateMicrosoftMeeting(eventId: string, input: Record<string, unknown>, organizerEmail = "") {
  const config = await meetingConfig(organizerEmail);
  return graph<Record<string, unknown>>(
    `/users/${encodeURIComponent(config.mailbox)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function sendMeetingMinutesMail(input: {
  subject: string;
  recipients: Array<{ email: string; name: string }>;
  html: string;
  attachments?: Array<{ name: string; contentType: string; base64: string }>;
  senderEmail?: string;
}) {
  const config = await meetingConfig(input.senderEmail);
  return sendMicrosoftMailPayloadAccepted(config.mailbox, {
    message: {
      subject: input.subject,
      body: { contentType: "HTML", content: input.html },
      toRecipients: input.recipients.map((recipient) => ({
        emailAddress: { address: recipient.email, name: recipient.name },
      })),
      attachments: (input.attachments || []).map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: attachment.contentType,
        contentBytes: attachment.base64,
      })),
    },
    saveToSentItems: true,
  }, crypto.randomUUID());
}

function retryAfterSeconds(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1_000));
}

export async function getMeetingAttendance(onlineMeetingId: string, organizerEmail = "") {
  const config = await meetingConfig(organizerEmail);
  return graph<{ value?: Array<Record<string, unknown>> }>(
    `/users/${encodeURIComponent(config.mailbox)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/attendanceReports?$expand=attendanceRecords`,
  );
}

export async function getMeetingTranscripts(onlineMeetingId: string, organizerEmail = "") {
  const config = await meetingConfig(organizerEmail);
  return graph<{ value?: Array<{ id: string; createdDateTime?: string }> }>(
    `/users/${encodeURIComponent(config.mailbox)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`,
  );
}

export async function findOnlineMeetingByJoinUrl(joinUrl: string, organizerEmail = "") {
  const config = await meetingConfig(organizerEmail);
  const filter = `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`;
  const result = await graph<{ value?: Array<{ id: string; joinWebUrl?: string }> }>(
    `/users/${encodeURIComponent(config.mailbox)}/onlineMeetings?$filter=${encodeURIComponent(filter)}`,
  );
  return result.value?.[0] || null;
}

export async function configureOnlineMeetingEvidence(onlineMeetingId: string, recordingEnabled = true, organizerEmail = "") {
  const config = await meetingConfig(organizerEmail);
  return graph<Record<string, unknown>>(
    `/users/${encodeURIComponent(config.mailbox)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
    { method: "PATCH", body: JSON.stringify({ allowTranscription: true, recordAutomatically: recordingEnabled }) },
  );
}
