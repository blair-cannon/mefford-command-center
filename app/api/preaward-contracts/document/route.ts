import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import {
  PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
  normalizePreAwardOwnerContractData,
  preAwardOwnerContractRecordId,
} from "../../../../lib/preaward-owner-contract";
import { contractAmountField, contractTemplate, normalizeSmallProjectPricingMethod, withOwnerContractComputedFields } from "../../../../lib/owner-contracts";
import { formatOwnerContractFieldValue, OWNER_CONTRACT_DOCUMENT_CSS, renderOwnerContractTemplate } from "../../../../lib/owner-contract-document";
import { createEditableOwnerContractDocx } from "../../../../lib/owner-contract-docx";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { renderOwnerContractBasisSchedule, renderOwnerContractBasisToolbarLinks } from "../../../../lib/owner-contract-basis-document";
import { ownerContractBasisAttachments } from "../../../../lib/owner-contract-basis";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const CONTRACT_DESIGNATIONS = new Set(["Estimator", "Estimating Manager", "Sales Representative", "Sales Manager", "Project Manager"]);

type ContractRow = {
  id: string;
  title: string;
  status: string;
  meta: string;
  data_json: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const search = new URL(request.url).searchParams;
    const opportunityId = search.get("opportunityId")?.trim() || "";
    const wantsWord = search.get("format") === "docx";
    if (!opportunityId) return Response.json({ error: "Opportunity Is Required" }, { status: 400 });
    const { env } = await import("cloudflare:workers");
    if (!(await canManagePreAwardContract(env.DB, actor.email, actor.accessLevel))) {
      return Response.json({ error: "Sales, Estimating, Project Management, Or Company Leadership Access Is Required" }, { status: 403 });
    }
    const row = await env.DB.prepare(
      `SELECT id, title, status, meta, data_json, updated_at FROM command_records
       WHERE project_id = ? AND id = ? AND record_type = ? LIMIT 1`,
    ).bind(SALES_PROJECT_ID, preAwardOwnerContractRecordId(opportunityId), PREAWARD_OWNER_CONTRACT_RECORD_TYPE).first<ContractRow>();
    if (!row) return Response.json({ error: "Save The Pre-Award Owner Contract Draft Before Previewing It" }, { status: 404 });
    const data = normalizePreAwardOwnerContractData(parseObject(row.data_json));
    if (!data) return Response.json({ error: "The Pre-Award Owner Contract Draft Is Invalid" }, { status: 409 });
    const template = contractTemplate(data.contractType, data.activeInstrument);
    const asset = await env.ASSETS.fetch(new Request(new URL(template.htmlPath, request.url)));
    if (!asset.ok) return Response.json({ error: "Controlled Contract Template Is Unavailable" }, { status: 503 });
    const templateHtml = await asset.text();
    const templateStyle = templateHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || "";
    const body = templateHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || templateHtml;
    const fields = withOwnerContractComputedFields(data.contractType, data.fields);
    const renderedBody = renderOwnerContractTemplate(body, fields, {
      missingValue: (field) => field.endsWith("_SIGNATURE") ? "Not Available Before Formal Award" : "Not Completed / Not Applicable",
      adaptiveValues: !wantsWord && data.contractType === "Time & Materials",
    });
    if (wantsWord) {
      const docx = createEditableOwnerContractDocx({
        title: row.title,
        projectNumber: `Pre-Award ${opportunityId}`,
        contractType: template.label,
        instrument: data.contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : data.activeInstrument,
        recordId: row.id,
        revisionLabel: `R${data.revisionNumber}`,
        status: "Internal Pre-Award Draft",
        templateId: template.id,
        templateVersion: template.version,
        renderedHtml: renderedBody,
        basisAttachments: ownerContractBasisAttachments(fields),
      });
      const file = new ArrayBuffer(docx.byteLength);
      new Uint8Array(file).set(docx);
      return new Response(file, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="${safeFileName(`${opportunityId}-Pre-Award-Owner-Contract-R${data.revisionNumber}-Editable-Review.docx`)}"`,
        },
      });
    }
    const amountField = contractAmountField(data.contractType, data.activeInstrument);
    const formattedAmount = formatOwnerContractFieldValue(amountField, fields[amountField] || "") || "Not Completed";
    const pricingMethod = data.contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : "";
    const amount = pricingMethod === "Time & Materials" ? "Time & Materials · No Maximum Price" : [pricingMethod, formattedAmount].filter(Boolean).join(" · ");
    const sourceFileId = fields.EXTERNAL_CONTRACT_FILE_ID || "";
    const controllingSource = data.contractType === "External Contract" && /^\d+$/.test(sourceFileId)
      ? `<a href="/api/files?id=${encodeURIComponent(sourceFileId)}" target="_blank" rel="noreferrer">Open Internal Source Draft</a>`
      : "";
    const basisSchedule = renderOwnerContractBasisSchedule(fields, (fileId) => `/api/files?id=${encodeURIComponent(String(fileId))}`);
    const basisToolbarLinks = renderOwnerContractBasisToolbarLinks(fields);
    const editableWord = `<a href="/api/preaward-contracts/document?opportunityId=${encodeURIComponent(opportunityId)}&amp;format=docx" download>Download Editable Word Copy</a>`;
    const blankMaster = template.docxPath ? `<a href="${template.docxPath}" download>Download Blank Word Master</a>` : "";
    const arrangementLabel = data.contractType === "Time & Materials" ? "Price Arrangement" : "Active Instrument";
    const arrangementValue = pricingMethod || data.activeInstrument;
    const contractBodyClass = data.contractType === "Time & Materials" ? "contract-body contract-body-small-project" : "contract-body";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(row.title)}</title><style>${templateStyle}${OWNER_CONTRACT_DOCUMENT_CSS}</style></head><body><div class="contract-toolbar draft-toolbar"><button onclick="window.print()">Print / Save PDF</button>${editableWord}${blankMaster}${controllingSource}${basisToolbarLinks}<span>${escapeHtml(template.id)} · Internal Pre-Award Revision ${data.revisionNumber}</span></div><div class="contract-document-watermark">PRE-AWARD DRAFT · NOT ISSUED</div><section class="contract-document-cover draft-cover"><header><div><p>MEFFORD CONTRACTING · COMMAND CENTER</p><h1>${escapeHtml(row.title)}</h1><p>Sales Opportunity ${escapeHtml(opportunityId)} · ${escapeHtml(row.id)}</p></div><span class="status">Internal Pre-Award Draft</span></header><dl><div><dt>Contract Type</dt><dd>${escapeHtml(template.label)}</dd></div><div><dt>${arrangementLabel}</dt><dd>${escapeHtml(arrangementValue)}</dd></div><div><dt>Template</dt><dd>${escapeHtml(template.id)} · ${escapeHtml(template.version)}</dd></div><div><dt>Revision</dt><dd>R${data.revisionNumber} · ${escapeHtml(data.savedBy)}</dd></div><div><dt>Project Owner</dt><dd>${escapeHtml(fields.OWNER_LEGAL_NAME || fields.OWNER_LEGAL_NAME_AND_STATUS || "Not Completed")}</dd></div><div><dt>Draft Amount / Control</dt><dd>${escapeHtml(amount)}</dd></div><div><dt>Payment Terms</dt><dd>${escapeHtml(data.paymentTerms || "Not Completed")}</dd></div><div><dt>Required Fields Open</dt><dd>${data.missingRequiredFields.length}</dd></div></dl><div class="draft-warning">INTERNAL ONLY. This document does not award the project, authorize work, create an accounting commitment, permit billing, release project-owner access, or accept signatures. Formal award is required before any external contract workflow begins.</div></section>${basisSchedule}<main class="${contractBodyClass}">${renderedBody}</main></body></html>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${safeFileName(`${opportunityId}-Pre-Award-Owner-Contract-R${data.revisionNumber}.html`)}"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pre-Award Owner Contract Preview Is Unavailable" }, { status: 500 });
  }
}

async function canManagePreAwardContract(database: D1Database, email: string, accessLevel: string) {
  if (["Company Owner", "Administrator"].includes(accessLevel)) return true;
  const member = await database.prepare(
    `SELECT company_access_level, designations_json FROM company_members WHERE lower(email) = ? AND is_active = 1 LIMIT 1`,
  ).bind(email.toLowerCase()).first<{ company_access_level: string; designations_json: string }>();
  if (!member) return false;
  if (["Company Owner", "Administrator"].includes(member.company_access_level)) return true;
  return parseStringArray(member.designations_json).some((designation) => CONTRACT_DESIGNATIONS.has(designation));
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
