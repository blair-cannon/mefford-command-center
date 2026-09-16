import { canReadProjectId } from "../../../../lib/project-access";
import { contractAmountField, contractTemplate, contractTemplateForStoredVersion, defaultContractInstrument, normalizeOwnerContractType, normalizeSmallProjectPricingMethod, withOwnerContractComputedFields, type OwnerContractInstrument } from "../../../../lib/owner-contracts";
import { formatOwnerContractFieldValue, OWNER_CONTRACT_DOCUMENT_CSS, renderOwnerContractTemplate } from "../../../../lib/owner-contract-document";
import { createEditableOwnerContractDocx } from "../../../../lib/owner-contract-docx";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { ensureOwnerPortalSchema, ownerPortalSession } from "../../../../lib/owner-portal";
import { renderOwnerContractBasisSchedule, renderOwnerContractBasisToolbarLinks } from "../../../../lib/owner-contract-basis-document";
import { ownerContractBasisAttachments } from "../../../../lib/owner-contract-basis";

type ContractRow = {
  id: string;
  title: string;
  status: string;
  meta: string;
  data_json: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const actor = await resolveCommandActor(request);
  await ensureOwnerPortalSchema(env.DB);
  const ownerSession = await ownerPortalSession(env.DB, request);
  if (!actor.authenticated && !ownerSession) return Response.json({ error: "Authentication Required" }, { status: 401 });
  if (!ownerSession) {
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
  }

  try {
    const search = new URL(request.url).searchParams;
    const wantsWord = search.get("format") === "docx";
    const projectId = search.get("projectId")?.trim() || "";
    const recordId = search.get("recordId")?.trim() || "";
    if (!projectId || !recordId) return Response.json({ error: "Project And Contract Record Are Required" }, { status: 400 });
    if (!ownerSession) {
      const { getDb } = await import("../../../../db");
      if (!(await canReadProjectId(getDb(), actor, projectId))) return Response.json({ error: "Assigned Project Contract Access Is Required" }, { status: 403 });
    }
    if (ownerSession && (ownerSession.project_id !== projectId || ownerSession.contract_record_id !== recordId)) return Response.json({ error: "This Contract Was Not Released To Your Project Owner Session" }, { status: 403 });
    let ownerAccess: { status: string; revoked_at: string | null; approved_revision_id: string } | null = null;
    if (ownerSession) {
      ownerAccess = await env.DB.prepare(`SELECT status, revoked_at, approved_revision_id FROM owner_portal_access WHERE project_id = ? LIMIT 1`).bind(projectId).first<{ status: string; revoked_at: string | null; approved_revision_id: string }>();
      if (!ownerAccess || ownerAccess.revoked_at || ["Dormant", "Revoked"].includes(ownerAccess.status)) return Response.json({ error: "Mefford Has Not Released This Owner Contract" }, { status: 403 });
    }
    const row = await env.DB.prepare(
      `SELECT id, title, status, meta, data_json, updated_at
       FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Contracts' LIMIT 1`,
    ).bind(projectId, recordId).first<ContractRow>();
    if (!row) return Response.json({ error: "Owner Contract Not Found" }, { status: 404 });
    const data = parseObject(row.data_json);
    const contractType = normalizeOwnerContractType(data.contractType);
    if (!contractType) return Response.json({ error: "Owner Contract Type Is Invalid" }, { status: 409 });
    const activeInstrument = String(data.activeInstrument || defaultContractInstrument(contractType)) as OwnerContractInstrument;
    const editableStatuses = ["Draft", "Draft Preparation", "Mefford Revision", "GMP Exhibit A Draft"];
    const template = editableStatuses.includes(row.status)
      ? contractTemplate(contractType, activeInstrument)
      : contractTemplateForStoredVersion(contractType, activeInstrument, String(data.templateVersion || ""));
    const asset = await env.ASSETS.fetch(new Request(new URL(template.htmlPath, request.url)));
    if (!asset.ok) return Response.json({ error: "Controlled Contract Template Is Unavailable" }, { status: 503 });
    const templateHtml = await asset.text();
    const style = templateHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || "";
    const body = templateHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || templateHtml;
    let sourceFields = normalizeFields(data.fields);
    let revisionLabel = "Current Saved Record";
    if (wantsWord) {
      const requestedRevisionId = search.get("revisionId")?.trim() || "";
      const revisionId = ownerSession ? requestedRevisionId || ownerAccess?.approved_revision_id || "" : requestedRevisionId;
      const revision = revisionId
        ? await env.DB.prepare(
          `SELECT id, revision_number, phase, fields_json FROM owner_contract_revisions
           WHERE id = ? AND project_id = ? AND contract_record_id = ? LIMIT 1`,
        ).bind(revisionId, projectId, recordId).first<{ id: string; revision_number: number; phase: string; fields_json: string }>()
        : await env.DB.prepare(
          `SELECT id, revision_number, phase, fields_json FROM owner_contract_revisions
           WHERE project_id = ? AND contract_record_id = ? ORDER BY revision_number DESC LIMIT 1`,
        ).bind(projectId, recordId).first<{ id: string; revision_number: number; phase: string; fields_json: string }>();
      if (revisionId && !revision) return Response.json({ error: "The Requested Contract Revision Is Not Available" }, { status: ownerSession ? 403 : 404 });
      if (ownerSession && revision && !["Approved for Owner Review", "Final Approval"].includes(revision.phase)) {
        return Response.json({ error: "This Contract Revision Was Not Released To The Project Owner" }, { status: 403 });
      }
      if (revision) {
        sourceFields = normalizeFields(parseObject(revision.fields_json));
        revisionLabel = `R${revision.revision_number}`;
      }
    }
    const fields = withOwnerContractComputedFields(contractType, sourceFields);
    const signatures = parseObject(data.signatures);
    const ownerSignature = parseObject(signatures.owner);
    const meffordSignature = parseObject(signatures.mefford);
    const values: Record<string, string> = {
      ...fields,
      OWNER_SIGNATURE: wantsWord ? editableSignatureText(ownerSignature, "Project Owner") : signatureMarkup(ownerSignature, "Owner Signature"),
      OWNER_SIGNATURE_DATE: String(ownerSignature.signedAt || fields.OWNER_SIGNATURE_DATE || "").slice(0, 10),
      CONTRACTOR_SIGNATURE: wantsWord ? editableSignatureText(meffordSignature, "Mefford Contracting") : signatureMarkup(meffordSignature, "Mefford Contracting Signature"),
      CONTRACTOR_SIGNATURE_DATE: String(meffordSignature.signedAt || fields.CONTRACTOR_SIGNATURE_DATE || "").slice(0, 10),
      DESIGN_BUILDER_SIGNATURE: wantsWord ? editableSignatureText(meffordSignature, "Mefford Contracting") : signatureMarkup(meffordSignature, "Mefford Contracting Design-Builder Signature"),
      DESIGN_BUILDER_SIGNATURE_DATE: String(meffordSignature.signedAt || fields.DESIGN_BUILDER_SIGNATURE_DATE || "").slice(0, 10),
      DB_AMENDMENT_OWNER_SIGNATURE: activeInstrument === "GMP Exhibit A" ? (wantsWord ? editableSignatureText(ownerSignature, "Project Owner") : signatureMarkup(ownerSignature, "GMP Exhibit A Owner Signature")) : fields.DB_AMENDMENT_OWNER_SIGNATURE || "Pending Later GMP Exhibit A",
      DB_AMENDMENT_OWNER_DATE: String(ownerSignature.signedAt || fields.DB_AMENDMENT_OWNER_DATE || "").slice(0, 10),
      DB_AMENDMENT_DESIGN_BUILDER_SIGNATURE: activeInstrument === "GMP Exhibit A" ? (wantsWord ? editableSignatureText(meffordSignature, "Mefford Contracting") : signatureMarkup(meffordSignature, "GMP Exhibit A Mefford Contracting Signature")) : fields.DB_AMENDMENT_DESIGN_BUILDER_SIGNATURE || "Pending Later GMP Exhibit A",
      DB_AMENDMENT_DESIGN_BUILDER_DATE: String(meffordSignature.signedAt || fields.DB_AMENDMENT_DESIGN_BUILDER_DATE || "").slice(0, 10),
    };
    const renderedBody = renderOwnerContractTemplate(body, values, {
      trustedHtmlFields: wantsWord ? [] : ["OWNER_SIGNATURE", "CONTRACTOR_SIGNATURE", "DESIGN_BUILDER_SIGNATURE", "DB_AMENDMENT_OWNER_SIGNATURE", "DB_AMENDMENT_DESIGN_BUILDER_SIGNATURE"],
      adaptiveValues: !wantsWord && contractType === "Time & Materials",
    });
    if (wantsWord) {
      const docx = createEditableOwnerContractDocx({
        title: row.title,
        projectNumber: projectId,
        contractType: template.label,
        instrument: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : activeInstrument,
        recordId,
        revisionLabel,
        status: row.status,
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
          "content-disposition": `attachment; filename="${safeFileName(`${projectId}-${String(data.contractType)}-${revisionLabel}-Editable-Review.docx`)}"`,
        },
      });
    }
    const statusClass = row.status.toLowerCase().replaceAll(" ", "-");
    const executed = ["Executed", "Phase 1 Executed"].includes(row.status);
    const signatureSummary = [
      signatureLine("Owner", ownerSignature),
      signatureLine(contractType.startsWith("Design-Build") ? "Design-Builder" : "Contractor", meffordSignature),
    ].join("");
    const editableWord = ownerSession ? "" : `<a href="/api/contracts/document?projectId=${encodeURIComponent(projectId)}&amp;recordId=${encodeURIComponent(recordId)}&amp;format=docx" download>Download Editable Word Copy</a>`;
    const blankMaster = !ownerSession && template.docxPath ? `<a href="${template.docxPath}" download>Download Blank Word Master</a>` : "";
    const sourceFileId = fields.EXTERNAL_CONTRACT_FILE_ID || "";
    const controllingSource = contractType === "External Contract" && /^\d+$/.test(sourceFileId) ? `<a href="/api/files?id=${encodeURIComponent(sourceFileId)}" target="_blank" rel="noreferrer">Open Controlling External Contract</a>` : "";
    const basisSchedule = renderOwnerContractBasisSchedule(fields, ownerSession ? undefined : (fileId) => `/api/files?id=${encodeURIComponent(String(fileId))}`);
    const basisToolbarLinks = ownerSession ? "" : renderOwnerContractBasisToolbarLinks(fields);
    const retainageInitial = formatOwnerContractFieldValue("RETAINAGE_PERCENTAGE", String(data.retainageInitialPercent || 10));
    const retainageAfterHalf = formatOwnerContractFieldValue("RETAINAGE_PERCENTAGE", String(data.retainageAfterHalfPercent || 5));
    const instrumentLabel = contractType === "Time & Materials" ? "Price Arrangement" : "Active Instrument";
    const instrumentValue = contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD) : activeInstrument;
    const contractBodyClass = contractType === "Time & Materials" ? "contract-body contract-body-small-project" : "contract-body";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(row.title)}</title><style>${style}${OWNER_CONTRACT_DOCUMENT_CSS}</style></head><body><div class="contract-toolbar"><button onclick="window.print()">Print / Save PDF</button>${editableWord}${blankMaster}${controllingSource}${basisToolbarLinks}<span>${escapeHtml(template.id)} · ${escapeHtml(activeInstrument)} · ${escapeHtml(row.status)}</span></div><div class="contract-document-watermark ${executed ? "executed" : ""}">${executed ? "EXECUTED ELECTRONIC RECORD" : "CONTROLLED DRAFT / SIGNATURE COPY"}</div><section class="contract-document-cover execution-cover"><header><div><p>MEFFORD CONTRACTING · COMMAND CENTER</p><h1>${escapeHtml(row.title)}</h1><p>Project ${escapeHtml(projectId)} · Controlled Contract Record ${escapeHtml(recordId)}</p></div><span class="status ${statusClass}">${escapeHtml(row.status)}</span></header><dl><div><dt>Contract Type</dt><dd>${escapeHtml(template.label)}</dd></div><div><dt>${instrumentLabel}</dt><dd>${escapeHtml(instrumentValue)}</dd></div><div><dt>Template</dt><dd>${escapeHtml(template.id)} · ${escapeHtml(template.version)}</dd></div><div><dt>Project Owner</dt><dd>${escapeHtml(fields.OWNER_LEGAL_NAME || "Not Completed")}</dd></div><div><dt>Contract Value / Control</dt><dd>${escapeHtml(contractValue(contractType, activeInstrument, fields))}</dd></div><div><dt>Payment Terms</dt><dd>${escapeHtml(String(data.paymentTerms || fields.PAYMENT_TERMS || "Not Completed"))}</dd></div><div><dt>Retainage</dt><dd>${escapeHtml(`${retainageInitial} until 50% completion; ${retainageAfterHalf} thereafter`)}</dd></div><div><dt>Master Source</dt><dd>${template.source === "Mefford" ? "Mefford-Controlled Master" : "External Controlling Agreement"}</dd></div></dl><div class="signature-certificate">${signatureSummary}</div></section>${basisSchedule}<main class="${contractBodyClass}">${renderedBody}</main></body></html>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${safeFileName(`${projectId}-${String(data.contractType)}-Owner-Contract.html`)}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Owner Contract Document Is Unavailable";
    return Response.json({ error: message }, { status: 500 });
  }
}

function signatureMarkup(signature: Record<string, unknown>, label: string) {
  const image = String(signature.signatureImage || "");
  return validSignatureImage(image) ? `<img class="contract-signature" src="${image}" alt="${escapeHtml(label)}">` : "Signature Pending";
}

function editableSignatureText(signature: Record<string, unknown>, party: string) {
  const signedAt = String(signature.signedAt || "").slice(0, 10);
  return signedAt
    ? `${String(signature.signerName || party)} — Electronic signature retained in the controlled Command Center record (${signedAt})`
    : "Signature Pending";
}

function signatureLine(label: string, signature: Record<string, unknown>) {
  const image = String(signature.signatureImage || "");
  return `<article><strong>${escapeHtml(label)}</strong>${validSignatureImage(image) ? `<img src="${image}" alt="${escapeHtml(label)}">` : ""}<span>${escapeHtml(String(signature.signerName || "Signature Pending"))}${signature.signerTitle ? ` · ${escapeHtml(String(signature.signerTitle))}` : ""}</span><span>${escapeHtml(String(signature.signedAt || "Not Signed"))}</span></article>`;
}

function contractValue(type: Parameters<typeof contractAmountField>[0], instrument: OwnerContractInstrument, fields: Record<string, string>) {
  const field = contractAmountField(type, instrument);
  const value = formatOwnerContractFieldValue(field, fields[field] || "");
  if (type === "Design-Build GMP" && instrument === "Phase 1 Agreement") return value || "Phase 1 Fee / NTE Not Completed; GMP Pending Exhibit A";
  if (type === "Time & Materials") {
    const method = normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD);
    return method === "Time & Materials" ? "Time & Materials · No Maximum Price" : `${method} · ${value || "Amount Not Completed"}`;
  }
  return value || "Not Completed";
}

function normalizeFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [key, String(fieldValue ?? "")]));
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validSignatureImage(value: string) {
  return value.length < 300_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
