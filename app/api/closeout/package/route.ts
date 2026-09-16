import { canReadProjectId } from "../../../../lib/project-access";
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { commandRecords, projectFiles, projects, vendorProjectAccess } from "../../../../db/schema";
import { CLOSEOUT_REQUIREMENT_TYPE, parseCloseoutData } from "../../../../lib/closeout";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { parseStringArray, vendorPortalSession } from "../../../../lib/vendor-portal";

type CloseoutFile = typeof projectFiles.$inferSelect & { requirementId: string; requirementTitle: string; categoryName: string };

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  const search = new URL(request.url).searchParams;
  const projectId = search.get("projectId")?.trim() || "";
  const exportType = search.get("export") === "thumb-drive" ? "thumb-drive" : "master";
  const { getDb } = await import("../../../../db");
  const db = getDb();
  if (actor.authenticated) {
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
    if (!(await canReadProjectId(db, actor, projectId))) return Response.json({ error: "Assigned Project Closeout Access Is Required" }, { status: 403 });
  } else {
    const portalSession = await vendorPortalSession(request);
    if (!portalSession) return Response.json({ error: "Authenticated Internal Or Owner Portal Access Is Required" }, { status: 401 });
    const access = (await db.select().from(vendorProjectAccess).where(and(eq(vendorProjectAccess.vendorId, portalSession.vendorId), eq(vendorProjectAccess.projectId, projectId))).limit(1))[0];
    if (!access || !parseStringArray(access.permissionsJson).includes("Owner Closeout Read Only")) return Response.json({ error: "Permanent Owner Closeout Access Is Required" }, { status: 403 });
  }
  const project = (await db.select().from(projects).where(eq(projects.number, projectId)).limit(1))[0];
  if (!project) return Response.json({ error: "Project Not Found" }, { status: 404 });
  const requirements = await db.select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.recordType, CLOSEOUT_REQUIREMENT_TYPE)));
  const accepted = requirements.filter((row) => row.status === "Approved");
  const fileReferences = accepted.flatMap((row) => {
    const data = parseCloseoutData(row.dataJson);
    const versions = Array.isArray(data.fileVersions) ? data.fileVersions as Array<Record<string, unknown>> : [];
    const latestByName = new Map<string, Record<string, unknown>>();
    for (const version of versions) latestByName.set(String(version.fileName || version.fileId || ""), version);
    return [...latestByName.values()].map((version) => ({ id: Number(version.fileId || 0), requirementId: row.id, requirementTitle: row.title, categoryName: String(data.category || "Closeout") })).filter((item) => item.id > 0);
  });
  const files: CloseoutFile[] = [];
  const { env } = await import("cloudflare:workers");
  for (const reference of fileReferences) {
    const file = (await db.select().from(projectFiles).where(eq(projectFiles.id, reference.id)).limit(1))[0];
    if (!file || file.projectId !== projectId || !(await env.BUCKET.head(file.storageKey))) return Response.json({ error: reference.requirementId + " references a missing approved file. Restore its document before exporting the closeout package." }, { status: 409 });
    files.push({ ...file, ...reference });
  }
  const master = await buildMasterPacket(project, accepted, files);
  const safeProject = safeName(project.name);
  if (exportType === "master") {
    return new Response(master, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeProject}_Master_Closeout_Packet.pdf"`, "Cache-Control": "private, no-store" } });
  }
  const zipEntries: Array<{ name: string; data: Uint8Array }> = [
    { name: `${safeProject}_Master_Closeout_Packet.pdf`, data: master },
    { name: "README_Closeout_Index.txt", data: new TextEncoder().encode(closeoutIndex(project, accepted, files)) },
  ];
  let totalBytes = master.byteLength;
  for (const file of files) {
    const object = await env.BUCKET.get(file.storageKey);
    if (!object) return Response.json({ error: file.name + " became unavailable while exporting. Retry after restoring the file." }, { status: 409 });
    const bytes = new Uint8Array(await object.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (totalBytes > 250 * 1024 * 1024) return Response.json({ error: "This Package Exceeds The 250 MB Online Bundle Limit. Download The Master Packet And Media Folders Separately For The Thumb Drive." }, { status: 413 });
    const media = /^(image|video)\//i.test(file.contentType);
    zipEntries.push({ name: `${media ? "Media_Photos_Videos" : "Original_Documents"}/${safeName(file.categoryName)}/${safeName(file.requirementId)}/${file.id}-${safeName(file.name)}`, data: bytes });
  }
  const zip = zipStore(zipEntries);
  return new Response(zip, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${safeProject}_Thumb_Drive_Closeout.zip"`, "Cache-Control": "private, no-store" } });
}

async function buildMasterPacket(project: typeof projects.$inferSelect, requirements: Array<typeof commandRecords.$inferSelect>, files: CloseoutFile[]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${project.name} Master Closeout Packet`);
  pdf.setAuthor("Mefford Contracting");
  pdf.setSubject("Accepted Project Closeout Documents");
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const cover = pdf.addPage([612, 792]);
  cover.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.97, 0.97, 0.965) });
  cover.drawRectangle({ x: 0, y: 610, width: 612, height: 182, color: rgb(0.08, 0.08, 0.08) });
  cover.drawRectangle({ x: 0, y: 610, width: 12, height: 182, color: rgb(0.56, 0.18, 0.15) });
  cover.drawText("MEFFORD CONTRACTING", { x: 42, y: 724, size: 12, font: bold, color: rgb(0.85, 0.31, 0.25) });
  cover.drawText("MASTER CLOSEOUT", { x: 42, y: 670, size: 32, font: bold, color: rgb(1, 1, 1) });
  cover.drawText("PACKAGE", { x: 42, y: 632, size: 32, font: bold, color: rgb(1, 1, 1) });
  cover.drawText(project.name, { x: 42, y: 548, size: 25, font: bold, color: rgb(0.08, 0.08, 0.08) });
  cover.drawText(`${project.number}  |  ${project.site}`, { x: 42, y: 520, size: 12, font: regular, color: rgb(0.35, 0.35, 0.35) });
  cover.drawText(`Prepared for ${project.ownerName}`, { x: 42, y: 492, size: 12, font: regular, color: rgb(0.35, 0.35, 0.35) });
  cover.drawText(`Accepted requirements: ${requirements.length}`, { x: 42, y: 426, size: 11, font: bold, color: rgb(0.56, 0.18, 0.15) });
  cover.drawText(`Original files indexed: ${files.length}`, { x: 42, y: 405, size: 11, font: regular, color: rgb(0.2, 0.2, 0.2) });
  cover.drawText("This packet is a generated delivery copy. Original files, videos, photos,", { x: 42, y: 118, size: 9, font: regular, color: rgb(0.38, 0.38, 0.38) });
  cover.drawText("version history, approvals, and audit records remain preserved in Command Center.", { x: 42, y: 103, size: 9, font: regular, color: rgb(0.38, 0.38, 0.38) });

  let page = pdf.addPage([612, 792]);
  let y = 748;
  page.drawText("CLOSEOUT INDEX", { x: 40, y, size: 18, font: bold, color: rgb(0.08, 0.08, 0.08) });
  y -= 28;
  for (const requirement of requirements) {
    if (y < 80) { page = pdf.addPage([612, 792]); y = 748; }
    const data = parseCloseoutData(requirement.dataJson);
    page.drawText(requirement.id, { x: 40, y, size: 8, font: bold, color: rgb(0.56, 0.18, 0.15) });
    page.drawText(fit(requirement.title, 68), { x: 104, y, size: 9, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 15;
    page.drawText(`${String(data.category || "Closeout")}  |  APPROVED  |  ${String(data.phase || "Master Project")}`, { x: 104, y, size: 7.5, font: regular, color: rgb(0.38, 0.38, 0.38) });
    y -= 20;
  }
  const { env } = await import("cloudflare:workers");
  for (const file of files) {
    if (file.contentType !== "application/pdf") continue;
    try {
      const object = await env.BUCKET.get(file.storageKey);
      if (!object) continue;
      const source = await PDFDocument.load(await object.arrayBuffer(), { ignoreEncryption: true });
      const pages = await pdf.copyPages(source, source.getPageIndices());
      for (const copied of pages) pdf.addPage(copied);
    } catch {
      const notice = pdf.addPage([612, 792]);
      notice.drawText("ORIGINAL FILE RETAINED SEPARATELY", { x: 40, y: 735, size: 14, font: bold, color: rgb(0.56, 0.18, 0.15) });
      notice.drawText(fit(file.name, 82), { x: 40, y: 704, size: 11, font: bold, color: rgb(0.1, 0.1, 0.1) });
      notice.drawText(`${file.requirementId} · ${file.requirementTitle}`, { x: 40, y: 680, size: 9, font: regular, color: rgb(0.3, 0.3, 0.3) });
      notice.drawText("The source PDF could not be merged, but remains included in the thumb-drive originals folder.", { x: 40, y: 650, size: 9, font: regular, color: rgb(0.3, 0.3, 0.3) });
    }
  }
  const bytes = await pdf.save();
  return new Uint8Array(bytes);
}

function closeoutIndex(project: typeof projects.$inferSelect, requirements: Array<typeof commandRecords.$inferSelect>, files: CloseoutFile[]) {
  return [
    "MEFFORD CONTRACTING — CLOSEOUT DELIVERY INDEX",
    `${project.number} · ${project.name}`,
    `${project.site} · Owner: ${project.ownerName}`,
    "",
    "PRINTING",
    "Open the master packet to print the entire accepted package. Open any original file to print it individually.",
    "Videos and photographs are stored in Media_Photos_Videos for copying to the Owner thumb drive.",
    "",
    "ACCEPTED REQUIREMENTS",
    ...requirements.map((row) => `${row.id}\t${row.title}\t${String(parseCloseoutData(row.dataJson).category || "Closeout")}`),
    "",
    "ORIGINAL FILES",
    ...files.map((file) => `${file.requirementId}\t${file.name}\t${file.categoryName}`),
    "",
    "Original versions, approvals, signatures, corrected documents, and audit history remain permanently reviewable in Mefford Project Command.",
  ].join("\r\n");
}

function zipStore(entries: Array<{ name: string; data: Uint8Array }>) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name.replace(/^\/+/, ""));
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint16(8, 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, entry.data.length, true); view.setUint32(22, entry.data.length, true); view.setUint16(26, name.length, true);
    local.set(name, 30); local.set(entry.data, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.set(name, 46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "_"); }
function fit(value: string, length: number) { return value.length <= length ? value : `${value.slice(0, length - 1)}…`; }
