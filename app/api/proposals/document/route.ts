import { and, eq } from "drizzle-orm";
import { commandRecords, companyMembers, projectFiles } from "../../../../db/schema";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { loadProposalTeamAssets, loadProposalVisualAssets } from "../../../../lib/proposal-assets-server";
import { createProposalPdf } from "../../../../lib/proposal-pdf";
import { createProposalWord, PROPOSAL_WORD_MIME } from "../../../../lib/proposal-word";
import {
  OWNER_PROPOSAL_RECORD_TYPE,
  normalizeProposalData,
} from "../../../../lib/proposals";
import { SALES_PROJECT_ID } from "../../../../lib/procurement";
import { resolveCommandActor } from "../../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const search = new URL(request.url).searchParams;
  const opportunityId = search.get("opportunityId")?.trim() || "";
  const recordId = search.get("recordId")?.trim() || "";
  if (!opportunityId || !recordId) return Response.json({ error: "Opportunity And Proposal Are Required" }, { status: 400 });
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const member = actor.email ? await db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1) : [];
  const level = member[0]?.companyAccessLevel || actor.accessLevel;
  const designations = parseStringArray(member[0]?.designationsJson || "[]");
  if (!["Company Owner", "Administrator"].includes(level) && !designations.some((item) => ["Estimator", "Sales Representative"].includes(item))) {
    return Response.json({ error: "Sales Or Estimating Access Is Required" }, { status: 403 });
  }
  const rows = await db.select().from(commandRecords).where(and(
    eq(commandRecords.projectId, SALES_PROJECT_ID),
    eq(commandRecords.id, recordId),
    eq(commandRecords.recordType, OWNER_PROPOSAL_RECORD_TYPE),
  )).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Owner Proposal Not Found" }, { status: 404 });
  const data = normalizeProposalData(parseData(row.dataJson));
  if (data.opportunityId !== opportunityId) return Response.json({ error: "Proposal Source Does Not Match This Opportunity" }, { status: 409 });
  if (search.get("format") === "docx") {
    if (row.status !== "Draft") return Response.json({ error: "Return This Proposal To Draft Or Start A New Revision Before Editing In Word." }, { status: 423 });
    const bytes = await createProposalWord(data, recordId);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: {
      "Content-Type": PROPOSAL_WORD_MIME,
      "Content-Disposition": `attachment; filename="${safeName(`${data.projectName}-R${data.revision}-Editable.docx`)}"`,
      "Cache-Control": "private, no-store",
    } });
  }
  const { env } = await import("cloudflare:workers");
  if (row.status === "Issued" && data.issuedPdfKey) {
    const frozen = await env.BUCKET.get(data.issuedPdfKey);
    if (frozen) return new Response(frozen.body, { headers: documentHeaders(data.projectName, data.packetType, data.revision, true) });
  }
  let logoBytes: Uint8Array | undefined;
  try {
    const response = await env.ASSETS.fetch(new Request(new URL("/mefford-logo.png", request.url)));
    if (response.ok) logoBytes = new Uint8Array(await response.arrayBuffer());
  } catch { logoBytes = undefined; }
  let visualAssets;
  let teamAssets;
  try {
    [visualAssets, teamAssets] = await Promise.all([
      loadProposalVisualAssets({ db, bucket: env.BUCKET, opportunityId, data }),
      loadProposalTeamAssets({ db, bucket: env.BUCKET, data }),
    ]);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The selected proposal visuals could not be loaded." }, { status: 422 });
  }
  let bytes: Uint8Array;
  try {
    let customerLogoBytes: Uint8Array | undefined;
    if (data.customerLogoFileId > 0) {
      const logoRows = await db.select().from(projectFiles).where(eq(projectFiles.id, data.customerLogoFileId)).limit(1);
      const object = logoRows[0] ? await env.BUCKET.get(logoRows[0].storageKey) : null;
      if (object) customerLogoBytes = new Uint8Array(await object.arrayBuffer());
    }
    bytes = await createProposalPdf({ data, recordId, status: row.status, logoBytes, customerLogoBytes, visualAssets, teamAssets });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The proposal PDF could not be built with the selected visuals." }, { status: 422 });
  }
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: documentHeaders(data.projectName, data.packetType, data.revision, false) });
}

function documentHeaders(projectName: string, packetType: string, revision: number, immutable: boolean) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safeName(`${projectName}-${packetType}-R${revision}.pdf`)}"`,
    "Cache-Control": "private, no-store",
    "X-Mefford-Document-Control": immutable ? "Immutable-Issued-Copy" : "Live-Controlled-Draft",
  };
}

function parseData(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
