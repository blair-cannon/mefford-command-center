import { inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { projectFiles } from "../db/schema";
import type { ProposalData } from "./proposals";
import type { ProposalVisualAsset } from "./proposal-visuals";
import { isPhotoUpload, normalizeUploadContentType } from "./photo-uploads";

const MAX_VISUAL_BYTES = 60 * 1024 * 1024;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export type ProposalTeamAsset = { fileId: number; contentType: string; bytes: Uint8Array };

export async function loadProposalVisualAssets(input: {
  db: ReturnType<typeof getDb>;
  bucket: R2Bucket;
  opportunityId: string;
  data: ProposalData;
}) {
  const visuals = input.data.visuals.filter((item) => item.included).slice(0, 20);
  if (!visuals.length) return [];
  const rows = await input.db.select().from(projectFiles).where(inArray(projectFiles.id, visuals.map((item) => item.fileId)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const permittedProjects = new Set([`ESTIMATE-${input.opportunityId}`, `DESIGN-${input.opportunityId}`]);
  const assets: ProposalVisualAsset[] = [];
  let totalBytes = 0;
  for (const visual of visuals) {
    const row = byId.get(visual.fileId);
    if (!row || !permittedProjects.has(row.projectId)) throw new Error(`${visual.name} is no longer available in this estimate's files.`);
    const isDrawingFolder = row.projectId === `DESIGN-${input.opportunityId}` || /design|drawing/i.test(row.category);
    if (visual.kind === "Drawing PDF" && (row.contentType !== "application/pdf" || !isDrawingFolder)) {
      throw new Error(`${visual.name} must be a PDF from Design & Drawings.`);
    }
    if (visual.kind === "Photo" && !isPhotoUpload({ name: row.name, type: row.contentType })) throw new Error(`${visual.name} is not recognized as an image file.`);
    if (visual.kind === "Photo" && row.sizeBytes > MAX_PHOTO_BYTES) throw new Error(`${visual.name} is too large for the proposal packet. Use a photo under 15 MB.`);
    const documentContentType = normalizeUploadContentType(row.name, row.contentType);
    if (visual.kind === "Photo" && !["image/jpeg", "image/png"].includes(documentContentType)) {
      throw new Error(`${visual.name} needs a PDF-ready image copy. Remove it and add it again from Proposal Studio.`);
    }
    totalBytes += row.sizeBytes;
    if (totalBytes > MAX_VISUAL_BYTES) throw new Error("Selected proposal visuals exceed the 60 MB packet limit.");
    const object = await input.bucket.get(row.storageKey);
    if (!object) throw new Error(`${visual.name} could not be read from the estimate files.`);
    assets.push({ ...visual, name: row.name, contentType: row.contentType, bytes: new Uint8Array(await object.arrayBuffer()) });
  }
  return assets;
}

export async function loadProposalTeamAssets(input: { db: ReturnType<typeof getDb>; bucket: R2Bucket; data: ProposalData }) {
  const expectedProjectByFile = new Map<number, string>();
  for (const member of input.data.teamMembers.filter((item) => item.includeInProposal)) {
    if (member.headshotFileId > 0) expectedProjectByFile.set(member.headshotFileId, "MEFFORD-PEOPLE");
    for (const experience of member.experience) for (const fileId of experience.photoFileIds) expectedProjectByFile.set(fileId, experience.projectId);
  }
  const ids = [...expectedProjectByFile.keys()].slice(0, 80);
  if (!ids.length) return [];
  const rows = await input.db.select().from(projectFiles).where(inArray(projectFiles.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const assets: ProposalTeamAsset[] = [];
  let totalBytes = 0;
  for (const id of ids) {
    const row = byId.get(id); const expectedProject = expectedProjectByFile.get(id);
    if (!row || row.projectId !== expectedProject || !isPhotoUpload({ name: row.name, type: row.contentType })) continue;
    const documentContentType = normalizeUploadContentType(row.name, row.contentType);
    if (!["image/jpeg", "image/png"].includes(documentContentType)) continue;
    if (expectedProject === "MEFFORD-PEOPLE" && !row.category.startsWith("Proposal Headshots /")) continue;
    if (row.sizeBytes > MAX_PHOTO_BYTES) continue;
    totalBytes += row.sizeBytes; if (totalBytes > MAX_VISUAL_BYTES) break;
    const object = await input.bucket.get(row.storageKey); if (!object) continue;
    assets.push({ fileId: id, contentType: row.contentType, bytes: new Uint8Array(await object.arrayBuffer()) });
  }
  return assets;
}
