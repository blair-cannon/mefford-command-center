import { projectDesignationsFor } from "../../../../lib/project-access";
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { commandRecords, companyMembers, projects } from "../../../../db/schema";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { PURCHASE_ORDER_RECORD_TYPE, parsePurchaseOrderData } from "../../../../lib/purchase-orders";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { PROJECT_TEAM_ASSIGNMENT_TYPE, normalizeDesignations, parseRecordData, projectTeamAssignmentId } from "../../../../lib/team-access";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const projectId = search.get("projectId")?.trim() || "";
  const recordId = search.get("recordId")?.trim() || "";
  if (!projectId || !recordId) return Response.json({ error: "Project And Purchase Order Are Required" }, { status: 400 });
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const [project, row, member] = await Promise.all([
    db.select().from(projects).where(eq(projects.number, projectId)).limit(1),
    db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, PURCHASE_ORDER_RECORD_TYPE))).limit(1),
    db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1),
  ]);
  if (!project[0] || !row[0]) return Response.json({ error: "Purchase Order Not Found" }, { status: 404 });
  if (!member[0]?.isActive) return Response.json({ error: "Active Company Access Is Required" }, { status: 403 });
  const level = member[0].companyAccessLevel || actor.accessLevel;
  let designations = normalizeDesignations(JSON.parse(member[0].designationsJson || "[]"));
  const assignment = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, projectTeamAssignmentId(actor.email)), eq(commandRecords.recordType, PROJECT_TEAM_ASSIGNMENT_TYPE))).limit(1);
  if (assignment[0]) designations = normalizeDesignations(parseRecordData(assignment[0].dataJson).projectDesignations);
  designations = await projectDesignationsFor(db, actor, project[0], designations);
  const permitted = ["Company Owner", "Administrator"].includes(level) || designations.includes("Project Manager") || designations.includes("Office Staff") || project[0].projectManager === member[0].displayName;
  if (!permitted) return Response.json({ error: "Purchase Order Access Is Required" }, { status: 403 });

  const bytes = await purchaseOrderPdf(project[0], row[0]);
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${safeName(`${projectId}-${recordId}-Purchase-Order.pdf`)}"`, "Cache-Control": "private, no-store" } });
}

async function purchaseOrderPdf(project: typeof projects.$inferSelect, row: typeof commandRecords.$inferSelect) {
  const data = parsePurchaseOrderData(row.dataJson);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${row.id} Purchase Order · ${project.name}`);
  pdf.setAuthor("Mefford Contracting");
  pdf.setSubject("Controlled Purchase Order");
  pdf.setKeywords([project.number, row.id, data.vendor, data.costCode, row.status]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 665, width: 612, height: 127, color: rgb(0.10, 0.11, 0.11) });
  page.drawRectangle({ x: 0, y: 665, width: 10, height: 127, color: rgb(0.56, 0.18, 0.15) });
  page.drawText("MEFFORD CONTRACTING", { x: 34, y: 752, size: 10, font: bold, color: rgb(0.84, 0.30, 0.24) });
  page.drawText("PURCHASE ORDER", { x: 34, y: 708, size: 27, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`${row.id}  |  ${row.status.toUpperCase()}`, { x: 34, y: 681, size: 10, font: regular, color: rgb(0.80, 0.82, 0.81) });
  page.drawText(money(data.amount), { x: 420, y: 714, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("CONTROLLED COMMITMENT", { x: 420, y: 695, size: 7.5, font: bold, color: rgb(0.79, 0.82, 0.80) });

  let y = 630;
  drawHeading(page, bold, "PROJECT & VENDOR", y); y -= 20;
  drawGrid(page, regular, bold, y, [
    ["Project", `${project.number} · ${project.name}`], ["Project Address", project.site || "Not Set"],
    ["Vendor", data.vendor || "Not Set"], ["Vendor Contact", [data.contactName, data.contactEmail, data.contactPhone].filter(Boolean).join(" · ") || "Not Set"],
    ["Cost Code", data.costCode || "Not Set"], ["Trade / Category", data.trade || "Not Set"],
    ["Required By", data.requiredBy || "Not Set"], ["Payment Terms", data.paymentTerms || "Net 30"],
  ]); y -= 132;

  drawHeading(page, bold, "SCOPE OF PURCHASE", y); y -= 18;
  y = drawWrappedBlock(page, regular, bold, "Scope", data.scope || "Not Completed", 34, y, 544); y -= 9;
  y = drawWrappedBlock(page, regular, bold, "Exclusions / Clarifications", data.exclusions || "None Recorded", 34, y, 544); y -= 9;
  y = drawWrappedBlock(page, regular, bold, "Delivery Location", data.deliveryLocation || "Not Set", 34, y, 544); y -= 18;
  y = drawWrappedBlock(page, regular, bold, "Commercial Terms", `${data.paymentTerms} · ${data.freightTerms} · Sales tax ${data.taxIncluded} · ${data.warranty}`, 34, y, 544); y -= 9;
  if (data.specialInstructions) { y = drawWrappedBlock(page, regular, bold, "Special Delivery Instructions", data.specialInstructions, 34, y, 544); y -= 9; }

  drawHeading(page, bold, "APPROVAL & RELEASE CONTROL", y); y -= 20;
  const owner = data.ownerApproval || {};
  const controls = [
    ["Owner Approval", owner.decision ? `${String(owner.decision)} by ${String(owner.ownerName || "Company Owner")} · ${String(owner.decidedAt || "")}` : data.approvalRequired ? "Required — Decision Pending" : "Not Required At Submission"],
    ["Approval Reason", data.approvalReasons.join(" · ") || "Within delegated threshold and budget at submission"],
    ["Released", data.releasedAt ? `${data.releasedAt} by ${data.releasedBy}` : "Not Released"],
    ["Delivery Evidence", data.distributionReference || "Not Recorded"],
    ["Vendor Acknowledgment", data.acknowledgedAt ? `${data.acknowledgedAt} by ${data.acknowledgedBy} · ${data.acknowledgmentReference}` : "Not Recorded"],
    ["Revision", data.revisionNumber ? `Revision ${data.revisionNumber} · Revises ${data.revisionOf}` : data.supersededBy ? `Original · Superseded by ${data.supersededBy}` : "Original"],
  ];
  for (const [label, value] of controls) { y = drawLine(page, regular, bold, label, value, y); }
  page.drawRectangle({ x: 28, y: 30, width: 556, height: 39, borderColor: rgb(0.66, 0.68, 0.67), borderWidth: 0.7, color: rgb(0.965, 0.968, 0.965) });
  page.drawText("CONTROL NOTICE", { x: 39, y: 54, size: 7, font: bold, color: rgb(0.56, 0.18, 0.15) });
  page.drawText("This generated copy does not replace the permanent record. Original status, approvals, revisions, access,", { x: 39, y: 42, size: 7, font: regular, color: rgb(0.30, 0.32, 0.31) });
  page.drawText("acknowledgments, AP matching, and audit history remain preserved in Mefford Project Command.", { x: 39, y: 33, size: 7, font: regular, color: rgb(0.30, 0.32, 0.31) });
  page.drawText(`Generated ${new Date().toISOString()} · ${row.id} · ${row.status}`, { x: 34, y: 15, size: 6.5, font: regular, color: rgb(0.46, 0.48, 0.47) });
  return new Uint8Array(await pdf.save());
}

function drawHeading(page: PDFPage, bold: PDFFont, value: string, y: number) {
  page.drawText(value, { x: 34, y, size: 8, font: bold, color: rgb(0.56, 0.18, 0.15) });
  page.drawLine({ start: { x: 34, y: y - 5 }, end: { x: 578, y: y - 5 }, thickness: 0.7, color: rgb(0.76, 0.78, 0.77) });
}

function drawGrid(page: PDFPage, regular: PDFFont, bold: PDFFont, y: number, fields: string[][]) {
  fields.forEach(([label, value], index) => {
    const column = index % 2; const row = Math.floor(index / 2); const x = 34 + column * 272; const top = y - row * 29;
    page.drawText(label.toUpperCase(), { x, y: top, size: 6.5, font: bold, color: rgb(0.45, 0.48, 0.46) });
    page.drawText(fit(value, 43), { x, y: top - 12, size: 8.5, font: regular, color: rgb(0.13, 0.15, 0.14) });
  });
}

function drawWrappedBlock(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, x: number, y: number, width: number) {
  page.drawText(label.toUpperCase(), { x, y, size: 6.5, font: bold, color: rgb(0.43, 0.46, 0.44) }); y -= 13;
  const lines = wrap(value, regular, 8.5, width).slice(0, 5);
  for (const line of lines) { page.drawText(line, { x, y, size: 8.5, font: regular, color: rgb(0.16, 0.18, 0.17) }); y -= 11; }
  return y;
}

function drawLine(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, y: number) {
  page.drawText(label.toUpperCase(), { x: 34, y, size: 6.5, font: bold, color: rgb(0.43, 0.46, 0.44) });
  page.drawText(fit(value, 82), { x: 150, y, size: 8, font: regular, color: rgb(0.16, 0.18, 0.17) });
  return y - 18;
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
  return output.length ? output : ["Not Recorded"];
}

function fit(value: string, length: number) { return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, "-"); }
