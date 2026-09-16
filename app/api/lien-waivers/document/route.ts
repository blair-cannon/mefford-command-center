import { and, eq } from "drizzle-orm";
import { commandRecords } from "../../../../db/schema";
import {
  LIEN_WAIVER_FORM_LABELS,
  LIEN_WAIVER_RECORD_TYPE,
  LIEN_WAIVER_RULES,
  isConditionalWaiver,
  isLienWaiverJurisdiction,
  isLienWaiverProjectClass,
  isLienWaiverType,
  waiverDocumentCopy,
} from "../../../../lib/lien-waivers";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { resolveCommandActor } from "../../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const search = new URL(request.url).searchParams;
    const projectId = search.get("projectId")?.trim() || "";
    const recordId = search.get("recordId")?.trim() || "";
    if (!projectId || !recordId) return Response.json({ error: "Project And Waiver Record Are Required" }, { status: 400 });
    const { getDb } = await import("../../../../db");
    const row = (await getDb().select().from(commandRecords).where(and(eq(commandRecords.projectId, projectId), eq(commandRecords.id, recordId), eq(commandRecords.recordType, LIEN_WAIVER_RECORD_TYPE))).limit(1))[0];
    if (!row) return Response.json({ error: "Lien Waiver Record Not Found" }, { status: 404 });
    const data = parseObject(row.dataJson);
    if (!isLienWaiverType(data.formType) || !isLienWaiverJurisdiction(data.jurisdiction) || !isLienWaiverProjectClass(data.projectClass)) return Response.json({ error: "Project State And Classification Must Be Configured Before The Form Can Be Generated" }, { status: 409 });
    const amount = Number(data.amount || 0);
    const copy = waiverDocumentCopy({ type: data.formType, projectClass: data.projectClass, amount, throughDate: String(data.throughDate || ""), paymentReference: String(data.clearedPaymentReference || "") });
    const rule = LIEN_WAIVER_RULES[data.jurisdiction];
    const signature = data.signature && typeof data.signature === "object" ? data.signature as Record<string, unknown> : {};
    const signatureImage = validSignatureImage(signature.signatureImage) ? String(signature.signatureImage) : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(row.title)}</title><style>
      @page{size:letter portrait;margin:.32in}*{box-sizing:border-box}body{margin:0;background:#ececec;color:#111;font-family:Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;display:flex;justify-content:center;gap:12px;padding:12px;background:#151515;color:white;z-index:2}.toolbar button{border:0;border-radius:4px;padding:10px 18px;background:#df1f2f;color:white;font-weight:800}.toolbar span{align-self:center;font-size:12px}.sheet{width:7.86in;min-height:10.36in;margin:18px auto;background:white;border:1px solid #bbb;padding:.34in .42in;position:relative;overflow:hidden}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:5px solid #d7192d;padding-bottom:12px}.brand h1{margin:0;font-size:28px;letter-spacing:1.8px}.brand h1 b{color:#d7192d}.brand p{margin:3px 0 0;font-size:10px;letter-spacing:1.6px;font-weight:bold}.docid{text-align:right;font-size:9px;line-height:1.45}.title{text-align:center;margin:14px 0 10px}.title h2{margin:0;font-size:16px;text-transform:uppercase;letter-spacing:.7px}.title p{margin:5px 0 0;color:#d7192d;font-size:10px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #222;border-bottom:0}.field{min-height:41px;padding:6px 8px;border-bottom:1px solid #222}.field:nth-child(odd){border-right:1px solid #222}.field.wide{grid-column:1/-1;border-right:0}.field label{display:block;font-size:7.5px;text-transform:uppercase;letter-spacing:.5px;color:#555;font-weight:bold}.field strong{display:block;margin-top:4px;font-size:10.5px;line-height:1.2}.release{border:1px solid #222;padding:10px 11px;font-size:9.5px;line-height:1.42}.release p{margin:0 0 7px}.release p:last-child{margin:0}.exceptions{display:grid;grid-template-columns:1fr 1fr;border:1px solid #222;border-top:0}.exceptions div{padding:7px 9px;min-height:55px}.exceptions div:first-child{border-right:1px solid #222}.exceptions b{display:block;font-size:7.5px;text-transform:uppercase}.exceptions span{display:block;margin-top:5px;font-size:9px;line-height:1.3}.sign{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:12px}.sigbox h3,.notary h3{font-size:9px;margin:0 0 10px;text-transform:uppercase}.line{border-bottom:1px solid #222;min-height:22px;font-size:9px;padding:6px 2px 2px}.line small{float:right;color:#666}.sig-image{display:block;max-width:185px;max-height:38px;margin:-7px 0 -3px}.notary{font-size:8px;line-height:1.35}.notary p{margin:0 0 9px}.authority{position:absolute;left:.42in;right:.42in;bottom:.25in;border-top:1px solid #aaa;padding-top:5px;font-size:6.8px;color:#555;display:flex;justify-content:space-between;gap:16px}.draft{position:absolute;right:-55px;top:62px;transform:rotate(35deg);background:#f7d8db;color:#9e1220;padding:6px 62px;font-size:9px;font-weight:900;letter-spacing:1px}@media print{body{background:white}.toolbar{display:none}.sheet{margin:0;border:0;width:auto;min-height:auto;padding:0}.authority{bottom:0}.draft{right:-42px;top:30px}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button><span>One-page controlled draft · Nothing is sent automatically</span></div><main class="sheet"><div class="draft">COUNSEL / OWNER REVIEW</div><header class="brand"><div><h1>MEFFORD <b>CONTRACTING</b></h1><p>PROJECT COMMAND · CONTROLLED PAYMENT DOCUMENT</p></div><div class="docid"><b>${escapeHtml(String(data.formVersion || "MEF-LW-v1"))}</b><br>${escapeHtml(recordId)}<br>${escapeHtml(row.status)}</div></header><section class="title"><h2>${escapeHtml(LIEN_WAIVER_FORM_LABELS[data.formType])}</h2><p>${escapeHtml(rule.name)} · ${escapeHtml(String(data.projectClass))} · Payment-Specific Release</p></section><section class="grid">
      ${field("Claimant / Vendor", data.vendorName)}${field("Customer / General Contractor", "Mefford Contracting")}
      ${field("Project", data.projectLegalName)}${field("Property Owner / Public Agency", data.propertyOwner || "As recorded in project setup")}
      ${field("Project Address", data.projectAddress)}${field("Commitment", data.commitmentReference)}
      ${field("Invoice / Pay Application", data.payApplicationReference)}${field("Through Date", data.throughDate)}
      ${field("Payment Amount", money(amount))}${field("Retainage Excluded", money(Number(data.retainage || 0)))}
      ${field("Payment Reference", data.clearedPaymentReference || (isConditionalWaiver(data.formType) ? "Conditional — not yet cleared" : "Required before execution"))}${field("Payment Status", isConditionalWaiver(data.formType) ? "Effective only on collected funds" : "Collected funds recorded")}
      ${field("Legal Description / Parcel / Public-Works Reference", data.legalDescription, true)}
    </section><section class="release"><p><b>WAIVER AND RELEASE.</b> ${escapeHtml(copy)}</p><p><b>LOWER-TIER STATEMENT.</b> ${escapeHtml(String(data.lowerTierStatement || "No unpaid lower-tier claims are known except those listed below."))}</p><p><b>NO ADVANCE WAIVER.</b> This payment document is not part of an award contract and does not waive rights for future work, unpaid retainage, or claims expressly reserved below.</p></section><section class="exceptions"><div><b>Express Exceptions / Disputed Claims</b><span>${escapeHtml(String(data.exceptions || "None"))}</span></div><div><b>Title Company / Lender Companion Requirements</b><span>${escapeHtml(String(data.titleCompanyRequirements || "None recorded"))}</span></div></section><section class="sign"><div class="sigbox"><h3>Authorized Claimant Signature</h3><div class="line">${signatureImage ? `<img class="sig-image" src="${escapeHtml(signatureImage)}" alt="Claimant signature">` : escapeHtml(String(signature.signerName || ""))}<small>Drawn Signature</small></div><div class="line">${escapeHtml(String(signature.signerName || ""))} · ${escapeHtml(String(signature.signerTitle || ""))}<small>Typed Identity / Title</small></div><div class="line">${escapeHtml(String(signature.signedAt || ""))}<small>Date / Time</small></div></div><div class="notary"><h3>Notary Acknowledgment</h3><p>State of ____________ · County of ____________<br>Acknowledged before me on ____________ by __________________________.</p><div class="line"><small>Notary Public</small></div><div class="line"><small>Commission Expires</small></div></div></section><footer class="authority"><span>${escapeHtml(rule.authority)} · ${escapeHtml(rule.control)}</span><span>Controlled draft · Initial counsel and Company Owner approval, then annual Owner review, required before company-wide release.</span></footer></main></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "content-disposition": `inline; filename="${recordId}.html"` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lien Waiver Document Is Unavailable";
    return Response.json({ error: message }, { status: 500 });
  }
}

function field(label: string, value: unknown, wide = false) { return `<div class="field${wide ? " wide" : ""}"><label>${escapeHtml(label)}</label><strong>${escapeHtml(String(value || "—"))}</strong></div>`; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0); }
function parseObject(value: unknown): Record<string, unknown> { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function validSignatureImage(value: unknown) { return typeof value === "string" && value.length < 250_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value); }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character); }
