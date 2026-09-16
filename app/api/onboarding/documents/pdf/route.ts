import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { commandRecords, companyMembers } from "../../../../../db/schema";
import { PEOPLE_PROJECT_ID } from "../../../../../lib/onboarding";
import { onboardingDocumentById, onboardingDocumentRecordId } from "../../../../../lib/onboarding-documents";
import { resolveCommandActor } from "../../../../../lib/server-actor";

type Signature = { name?: string; email?: string; role?: string; method?: string; signedAt?: string };
type Submission = {
  documentId?: string;
  documentVersion?: string;
  employeeEmail?: string;
  employeeName?: string;
  answers?: Record<string, string | boolean>;
  status?: string;
  employeeSignature?: Signature;
  employerSignature?: Signature;
  contentHash?: string;
  revisions?: unknown[];
  updatedAt?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const search = new URL(request.url).searchParams;
  const employeeEmail = (search.get("employeeEmail") || actor.email).trim().toLowerCase();
  const document = onboardingDocumentById(search.get("documentId")?.trim() || "");
  if (!document) return Response.json({ error: "Onboarding Document Was Not Found" }, { status: 404 });
  const { getDb } = await import("../../../../../db");
  const db = getDb();
  if (employeeEmail !== actor.email && !(await canAdminister(db, actor.email, actor.accessLevel))) {
    return Response.json({ error: "Employee Document Access Is Required" }, { status: 403 });
  }
  const rows = await db.select({ dataJson: commandRecords.dataJson }).from(commandRecords).where(and(
    eq(commandRecords.projectId, PEOPLE_PROJECT_ID),
    eq(commandRecords.id, onboardingDocumentRecordId(employeeEmail, document.id)),
    eq(commandRecords.recordType, "Onboarding Document Submission"),
  )).limit(1);
  if (!rows[0]) return Response.json({ error: "Signed Submission Was Not Found" }, { status: 404 });
  const submission = parseSubmission(rows[0].dataJson);
  if (!submission || !["Employee Signed", "Employer Review Required", "Complete"].includes(submission.status || "")) {
    return Response.json({ error: "A Signed Submission Is Required" }, { status: 409 });
  }
  const bytes = await submissionPdf(document, submission);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName(`${submission.employeeName || "Employee"}-${document.title}-Electronic-Record.pdf`)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function canAdminister(db: ReturnType<(typeof import("../../../../../db"))["getDb"]>, email: string, level: string) {
  if (["Company Owner", "Administrator"].includes(level)) return true;
  const row = await db.select({ level: companyMembers.companyAccessLevel }).from(companyMembers).where(eq(companyMembers.email, email)).limit(1);
  return ["Company Owner", "Administrator"].includes(row[0]?.level || "");
}

async function submissionPdf(document: NonNullable<ReturnType<typeof onboardingDocumentById>>, submission: Submission) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${document.title} · Electronic Submission Record`);
  pdf.setAuthor("Mefford Contracting Command Center");
  pdf.setSubject("Authenticated onboarding submission and signature audit record");
  pdf.setKeywords([document.id, document.version, submission.status || "Signed", "electronic signature"]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = drawHeader(page, regular, bold, document.title, document.version, submission.status || "Signed");
  const write = (label: string, value: string, sensitive = false) => {
    const display = sensitive ? mask(value) : value;
    const result = drawField(pdf, page, regular, bold, label, display || "Not Provided", y);
    page = result.page;
    y = result.y;
  };

  write("Employee", `${submission.employeeName || "Not Recorded"} · ${submission.employeeEmail || ""}`);
  write("Document Source", `${document.sourceAuthority} · ${document.sourceUrl || "Native Command Center Form"}`);
  write("Version And Applicability", `${document.version} · ${document.applicability}`);
  write("Submission Status", submission.status || "Signed");
  y -= 4;

  for (const field of document.fields) {
    const value = submission.answers?.[field.id];
    const rendered = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "");
    write(`${field.role || "Employee"} · ${field.label}`, rendered, Boolean(field.sensitive));
  }

  y -= 5;
  for (const [label, signature] of [["Employee Signature", submission.employeeSignature], ["Employer Signature", submission.employerSignature]] as const) {
    if (!signature) continue;
    write(label, `${signature.name || ""} · ${signature.email || ""} · ${signature.method || "Authenticated Typed Signature"} · ${signature.signedAt || ""}`);
  }
  write("SHA-256 Submission Hash", submission.contentHash || "Pending Employer Countersign");
  write("Superseded Signed Revisions Retained", String(submission.revisions?.length || 0));
  write("Generated", new Date().toISOString());

  drawFooter(page, regular, bold, document.restricted);
  return new Uint8Array(await pdf.save());
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, title: string, version: string, status: string) {
  page.drawRectangle({ x: 0, y: 666, width: 612, height: 126, color: rgb(0.105, 0.12, 0.125) });
  page.drawRectangle({ x: 0, y: 666, width: 10, height: 126, color: rgb(0.55, 0.18, 0.15) });
  page.drawText("MEFFORD CONTRACTING", { x: 34, y: 754, size: 10, font: bold, color: rgb(0.88, 0.31, 0.25) });
  page.drawText("ELECTRONIC SUBMISSION RECORD", { x: 34, y: 726, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(fit(title, 72), { x: 34, y: 701, size: 11, font: bold, color: rgb(0.91, 0.92, 0.91) });
  page.drawText(`${version}  ·  ${status.toUpperCase()}`, { x: 34, y: 681, size: 8, font: regular, color: rgb(0.72, 0.75, 0.73) });
  page.drawText("NOT A SCANNED DOCUMENT", { x: 438, y: 754, size: 7, font: bold, color: rgb(0.94, 0.74, 0.69) });
  return 638;
}

function drawField(pdf: PDFDocument, page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, y: number) {
  const lines = wrap(value, regular, 8.5, 520);
  const height = 18 + lines.length * 11;
  if (y - height < 57) {
    drawFooter(page, regular, bold, true);
    page = pdf.addPage([612, 792]);
    page.drawText("MEFFORD CONTRACTING · CONTINUED", { x: 34, y: 758, size: 8, font: bold, color: rgb(0.55, 0.18, 0.15) });
    y = 732;
  }
  page.drawText(label.toUpperCase(), { x: 34, y, size: 6.5, font: bold, color: rgb(0.41, 0.45, 0.43) });
  y -= 12;
  for (const line of lines) {
    page.drawText(line, { x: 34, y, size: 8.5, font: regular, color: rgb(0.14, 0.16, 0.15) });
    y -= 11;
  }
  page.drawLine({ start: { x: 34, y: y - 3 }, end: { x: 578, y: y - 3 }, thickness: 0.45, color: rgb(0.87, 0.88, 0.87) });
  return { page, y: y - 13 };
}

function drawFooter(page: PDFPage, regular: PDFFont, bold: PDFFont, restricted: boolean) {
  page.drawRectangle({ x: 28, y: 22, width: 556, height: 28, color: rgb(0.955, 0.962, 0.956) });
  page.drawText(restricted ? "RESTRICTED EMPLOYEE RECORD" : "CONTROLLED EMPLOYEE RECORD", { x: 38, y: 38, size: 6.5, font: bold, color: rgb(0.55, 0.18, 0.15) });
  page.drawText("Generated from authenticated web entry. The permanent audit record remains in Command Center.", { x: 38, y: 28, size: 6.4, font: regular, color: rgb(0.36, 0.39, 0.37) });
}

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const output: string[] = [];
  for (const paragraph of value.replace(/[\r\n]+/g, " \n ").split(" \n ")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) output.push(line); line = word; }
    }
    if (line) output.push(line);
  }
  return output.length ? output : ["Not Provided"];
}

function mask(value: string) {
  if (!value) return "Not Provided";
  const visible = value.replace(/\s/g, "").slice(-4);
  return visible ? `Restricted · Ending ${visible}` : "Restricted";
}

function parseSubmission(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Submission : null;
  } catch { return null; }
}

function fit(value: string, length: number) { return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`; }
function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, "-"); }
