import { PDFDocument, rgb } from "pdf-lib";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { automatedAgendaItems, canAccessMeeting, ensureMeetingTables, getMeetingContext, type MeetingActor } from "../../../../lib/meeting-server";
import { effectiveActor, ensureMyWorkTables } from "../../../../lib/my-work";
import { resolveCommandActor } from "../../../../lib/server-actor";

import { isDepartmentMeeting } from "../../../../lib/meeting-agenda-settings";
import type { MeetingType } from "../../../../lib/meetings";
import { meetingPdfFonts, wrapMeetingPdfText } from "../../../../lib/meeting-pdf";

type Row = Record<string, string | number | null>;

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

async function actorFor(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return null;
  await ensureMyWorkTables();
  return effectiveActor(actor) as Promise<MeetingActor>;
}

export async function GET(request: Request) {
  try { return await meetingDocument(request); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Meeting PDF Is Unavailable. Try Again." }, { status: 500 }); }
}

async function meetingDocument(request: Request) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureMeetingTables();
  const url = new URL(request.url);
  const occurrenceId = url.searchParams.get("occurrenceId") || "";
  const kind = url.searchParams.get("kind") === "agenda" ? "agenda" : "minutes";
  let context = await getMeetingContext(occurrenceId);
  if (!context) return Response.json({ error: "Meeting Not Found" }, { status: 404 });
  const { env } = await import("cloudflare:workers");
  if (!await canAccessMeeting(actor, context, occurrenceId)) return Response.json({ error: "Meeting Document Access Denied" }, { status: 403 });
  if (kind === "agenda" && ["Draft Agenda", "Published Agenda", ...(isDepartmentMeeting(context.meeting_type) ? ["Meeting In Progress"] : [])].includes(String(context.status))) {
    const refreshed = await automatedAgendaItems({ type: String(context.meeting_type) as MeetingType, projectId: String(context.project_id), occurrenceId, seriesId: String(context.series_id), actor });
    if (refreshed.busy) return Response.json({ error: "The Agenda Is Refreshing. Open Print Agenda Again In A Moment." }, { status: 409 });
    context = (await getMeetingContext(occurrenceId))!;
  }
  const meeting = context;
  const permanentKey = kind === "minutes" ? String(context.minutes_pdf_key || "") : "";
  if (permanentKey) {
    const existing = await env.BUCKET.get(permanentKey);
    if (existing) return new Response(existing.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${context.meeting_number}-${kind}.pdf"`, "Cache-Control": "private, no-store" } });
  }
  const [agenda, decisions, actions, attendees, attachments] = await Promise.all([
    env.DB.prepare(`SELECT * FROM meeting_agenda_items WHERE occurrence_id = ? AND visibility = 'Attendees' AND status NOT IN ('Removed','Superseded') ORDER BY position, created_at`).bind(occurrenceId).all<Row>(),
    env.DB.prepare(`SELECT * FROM meeting_decisions WHERE occurrence_id = ? ORDER BY created_at`).bind(occurrenceId).all<Row>(),
    env.DB.prepare(`SELECT * FROM meeting_action_items WHERE occurrence_id = ? ORDER BY due_at, created_at`).bind(occurrenceId).all<Row>(),
    env.DB.prepare(`SELECT * FROM meeting_attendees WHERE occurrence_id = ? ORDER BY attendance_requirement DESC, name`).bind(occurrenceId).all<Row>(),
    env.DB.prepare(`SELECT * FROM meeting_attachments WHERE occurrence_id = ? ORDER BY created_at`).bind(occurrenceId).all<Row>(),
  ]);
  const document = await PDFDocument.create();
  document.setTitle(`${context.meeting_number} ${kind === "agenda" ? "Agenda" : "Meeting Minutes"}`);
  document.setAuthor("Mefford Contracting Command Center");
  document.setSubject(`${context.meeting_type} · Permanent controlled meeting record`);
  const { regular, bold } = await meetingPdfFonts(document);
  const pageSize: [number, number] = [612, 792];
  const margin = 52;
  let page = document.addPage(pageSize);
  let y = 738;
  const orange = rgb(0.65, 0.10, 0.12);
  function header() {
    page.drawRectangle({ x: 0, y: 760, width: 612, height: 32, color: rgb(0.07, 0.09, 0.12) });
    page.drawText("MEFFORD CONTRACTING", { x: margin, y: 771, size: 10, font: bold, color: rgb(1, 1, 1) });
    page.drawText(String(meeting.meeting_number), { x: 612 - margin - regular.widthOfTextAtSize(String(meeting.meeting_number), 8), y: 771, size: 8, font: regular, color: rgb(1, 1, 1) });
  }
  function nextPage() { page = document.addPage(pageSize); y = 738; header(); }
  function line(text: string, options: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = options.size || 9;
    const lines = wrapMeetingPdfText(text, options.bold ? bold : regular, size, 612 - margin * 2 - (options.indent || 0));
    for (const part of lines) {
      if (y < 62) nextPage();
      page.drawText(part, { x: margin + (options.indent || 0), y, size, font: options.bold ? bold : regular, color: options.color || rgb(0.12, 0.14, 0.17) });
      y -= size + 4;
    }
    y -= options.gap || 2;
  }
  function section(title: string) { if (y < 110) nextPage(); y -= 7; line(title.toUpperCase(), { bold: true, size: 10, color: orange, gap: 5 }); }
  header();
  line(kind === "agenda" ? (context.published_at ? "MEETING AGENDA" : "DRAFT MEETING AGENDA") : (context.status === "Finalized/Distributed" ? "FINAL MEETING MINUTES" : "DRAFT MEETING MINUTES"), { bold: true, size: 20, color: orange, gap: 7 });
  line(String(context.series_title), { bold: true, size: 15, gap: 4 });
  line(`${context.meeting_type} · ${new Date(String(context.scheduled_start)).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: String(context.time_zone || "America/New_York") })}`);
  line(`${context.meeting_mode} · ${context.location}${context.teams_join_url ? " · Microsoft Teams Enabled" : ""}`);
  line(`Leader: ${context.leader_name} · Recording: ${Number(context.recording_enabled) ? "Enabled" : `Disabled by audited override (${context.recording_override_reason})`}`);
  const distributionControl = JSON.parse(String(context.distribution_json || "{}")) as Record<string, unknown>;
  if (kind === "minutes" && Number(context.minutes_revision || 0) > 1) {
    line(`REVISED MINUTES R${context.minutes_revision}`, { bold: true, size: 12, color: orange });
    line(`Change Summary: ${String(distributionControl.revisionReason || "See permanent audit history.")}`);
  }
  line(`Agenda As Of ${new Date().toLocaleString("en-US", { timeZone: String(context.time_zone || "America/New_York") })} · ${context.status}`, { size: 8 });
  section("Attendance");
  for (const item of attendees.results) line(`${item.attendance_requirement} · ${item.name} · ${item.attendance_status}${item.attendance_source ? ` · ${item.attendance_source}` : ""}`, { indent: 8 });
  if (String(context.meeting_type) === "Project Owner") {
    const snapshot = JSON.parse(String(context.financial_snapshot_json || "{}")) as Record<string, unknown>;
    section("Owner Contract Value Snapshot");
    line(`Original Executed Contract: ${money(snapshot.originalExecutedContract)}`);
    line(`Net Approved Changes: ${money(snapshot.approvedChanges)}`);
    line(`Current Owner Contract: ${money(snapshot.currentOwnerContract)}`, { bold: true });
    line(`Change Since ${String(snapshot.priorMeetingNumber || "Previous Meeting")}: ${money(snapshot.changeSincePreviousMeeting)}`);
    line(`Pending Change Exposure (Not In Contract Value): ${money(snapshot.pendingChangeExposure)}`);
    line(`Billed To Date: ${money(snapshot.billedToDate)}`);
    line(`Formula: ${String(snapshot.formula || "")}`);
    if (snapshot.reconciliationWarning) line("RECONCILIATION WARNING · Project, accounting or billing records do not agree with the controlled contract formula.", { bold: true, color: rgb(0.75, 0.08, 0.08) });
    line(`Immutable Snapshot Captured: ${String(snapshot.capturedAt || context.created_at)}`);
  }
  section("Agenda And Discussion Record");
  for (const item of agenda.results) {
    if (y < (item.source_type === "Standard Section" ? 175 : 120)) nextPage();
    line(`${item.title} · ${item.timebox_minutes} min · ${item.status}${Number(item.addendum_number) ? ` · Addendum ${item.addendum_number}` : ""}`, { bold: true });
    if (item.source_type === "User Submitted") {
      line(String(item.source_reason || `Requested By ${item.created_by}`), { indent: 8, size: 8, color: rgb(.35,.38,.42) });
    }
    if (item.notes) line(String(item.notes), { indent: 8 });
    if (item.source_type !== "User Submitted" && item.source_id) {
      const signal = item.source_type === "Automatic Agenda" ? JSON.parse(String(item.source_version || "{}")) as { source?: { recordType?: string; id?: string; updatedAt?: string }; nextStep?: string; metric?: { value: number; unit: string } } : null;
      if (signal?.metric) line(`Current Value: ${signal.metric.unit === "currency" ? money(signal.metric.value) : signal.metric.value}`, { bold: true, indent: 8 });
      line(`Source: ${signal?.source?.recordType || item.source_type} ${signal?.source?.id || item.source_id} · Updated ${signal?.source?.updatedAt || item.updated_at || "Captured"}`, { indent: 8, size: 8, color: rgb(0.35, 0.38, 0.42) });
      if (!signal?.metric) line(String(item.source_reason || ""), { indent: 8, size: 9 });
      if (signal?.nextStep && !signal.metric) line(`Discussion: ${signal.nextStep}`, { indent: 8, size: 9 });
    }
  }
  if (kind === "minutes") {
    section("Decision Log");
    if (!decisions.results.length) line("No decisions were recorded.");
    for (const item of decisions.results) line(`${item.id} · ${item.statement} · ${item.status} · Decision-maker: ${item.decision_maker_name}`);
    section("Action And Carryforward Log");
    if (!actions.results.length) line("No action items were recorded.");
    for (const item of actions.results) line(`${item.id} · ${item.item_kind} · ${item.title} · ${item.assignee_name} · Due ${item.due_at} · ${item.status} · Carry ${item.carry_count}`);
    section("Minutes Summary");
    for (const paragraph of String(context.minutes_summary || "").split(/\n+/)) line(paragraph);
    section("Attachments And Distribution");
    for (const item of attachments.results) line(`${Number(item.include_with_minutes) ? "Included" : "Secure Link"} · ${item.name} · ${item.source_version} · ${item.access}`);
    line(`Finalized By: ${context.finalized_by || "Pending"} · ${context.finalized_at || "Not finalized"}`);
    line(`Revision: R${context.minutes_revision || 0} · Distribution: ${String(distributionControl.status || "Pending")}`);
  }
  for (const [index, sheet] of document.getPages().entries()) {
    sheet.drawText(`${context.meeting_number} · ${kind === "agenda" ? "Agenda" : "Minutes"}`, { x: margin, y: 36, size: 8, font: regular, color: rgb(.35,.38,.42) });
    sheet.drawText(`${index + 1} / ${document.getPageCount()}`, { x: 526, y: 36, size: 8, font: regular });
  }
  const bytes = await document.save();
  const finalized = kind === "minutes" ? String(context.status) === "Finalized/Distributed" : Boolean(context.published_at);
  if (finalized) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const key = `meetings/${context.project_id}/${occurrenceId}/${context.meeting_number}-${kind}-R${context.minutes_revision || 0}-${digest}.pdf`;
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { occurrenceId, kind, revision: String(context.minutes_revision || 0) } });
    const saved = await env.DB.prepare(`UPDATE meeting_occurrences SET ${kind === "agenda" ? "agenda_pdf_key" : "minutes_pdf_key"} = ? WHERE id = ? AND updated_at = ? AND status = ?`).bind(key, occurrenceId, context.updated_at, context.status).run();
    if (!Number(saved.meta.changes || 0)) return Response.json({ error: "The Meeting Changed While Preparing This Copy. Print Again For The Latest Agenda." }, { status: 409 });
  }
  const responseBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(responseBuffer).set(bytes);
  return new Response(responseBuffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${context.meeting_number}-${kind}.pdf"`, "Cache-Control": "private, no-store" } });
}
