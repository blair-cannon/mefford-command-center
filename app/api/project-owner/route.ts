import { getCommandActor } from "../../../lib/server-actor";
import { isExecutionControlField, isSignatureContractField } from "../../../lib/owner-contracts";
import { isOwnerContractBasisField, ownerContractBasisAttachments } from "../../../lib/owner-contract-basis";
import {
  ensureOwnerPortalSchema,
  hashOwnerSecret,
  maskOwnerEmail,
  ownerPortalSession,
  parseOwnerObject,
  randomOwnerToken,
} from "../../../lib/owner-portal";

type OwnerInput = {
  action?: "verify-code" | "request-change" | "submit-review" | "sign";
  inviteId?: string;
  code?: string;
  clauseKey?: string;
  requestType?: "Replacement" | "Addition" | "Deletion" | "Comment";
  proposedText?: string;
  comment?: string;
  decision?: "Accepted" | "Changes Requested";
  signerName?: string;
  signerTitle?: string;
  signatureImage?: string;
  signatureConsent?: boolean;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await ensureOwnerPortalSchema(database);
  const inviteId = new URL(request.url).searchParams.get("inviteId")?.trim() || "";
  if (!inviteId) return Response.json({ error: "Project Owner Invite Is Required" }, { status: 400 });
  const invite = await loadInvite(database, inviteId);
  if (!invite || invite.revoked_at || invite.status === "Revoked") return Response.json({ error: "This Project Owner Invite Is Not Available" }, { status: 404 });
  const session = await ownerPortalSession(database, request);
  if (!session) {
    return Response.json({
      verified: false,
      invite: {
        id: invite.id,
        contactName: invite.contact_name,
        emailHint: maskOwnerEmail(invite.email),
        expiresAt: invite.expires_at,
        expired: new Date(invite.expires_at) <= new Date(),
        locked: invite.attempts >= 5,
      },
    });
  }
  return ownerPayload(database, session);
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await ensureOwnerPortalSchema(database);
  const input = await request.json() as OwnerInput;
  const now = new Date();

  if (input.action === "verify-code") {
    const invite = await loadInvite(database, input.inviteId?.trim() || "");
    const code = input.code?.replace(/\D/g, "") || "";
    if (!invite || invite.revoked_at || invite.status === "Revoked" || new Date(invite.expires_at) <= now || invite.attempts >= 5) {
      return Response.json({ error: "This Invite Is Expired Revoked Or Locked" }, { status: 403 });
    }
    const actor = getCommandActor(request);
    if (actor.identityProvider !== "command_center_preview" && (!actor.authenticated || actor.email.toLowerCase() !== invite.email.toLowerCase())) {
      return Response.json({ error: "Sign In With The Exact Email Address Mefford Invited" }, { status: 403 });
    }
    if (code.length !== 6 || (await hashOwnerSecret(code)) !== invite.code_hash) {
      const attempts = invite.attempts + 1;
      await database.batch([
        database.prepare(`UPDATE owner_portal_invites SET attempts = ? WHERE id = ?`).bind(attempts, invite.id),
        ownerAudit(database, invite.project_id, invite.contract_record_id, invite.contact_name, invite.email, "Owner Portal Code Rejected", `Attempt ${attempts} of 5.`),
      ]);
      return Response.json({ error: attempts >= 5 ? "Invite Locked After Five Attempts" : `Code Not Accepted · ${5 - attempts} Attempts Remain` }, { status: 403 });
    }
    const sessionToken = randomOwnerToken();
    const sessionExpiresAt = new Date(now.getTime() + 8 * 3_600_000).toISOString();
    await database.batch([
      database.prepare(`UPDATE owner_portal_invites SET attempts = 0, status = 'Accepted', verified_at = ?, session_hash = ?, session_expires_at = ? WHERE id = ?`).bind(now.toISOString(), await hashOwnerSecret(sessionToken), sessionExpiresAt, invite.id),
      ownerAudit(database, invite.project_id, invite.contract_record_id, invite.contact_name, invite.email, "Owner Portal Access Verified", `Controlled project-only session expires ${sessionExpiresAt}.`),
    ]);
    return Response.json({ verified: true, sessionToken, sessionExpiresAt });
  }

  const session = await ownerPortalSession(database, request);
  if (!session) return Response.json({ error: "Project Owner Session Is Missing Or Expired" }, { status: 401 });
  const access = await database.prepare(`SELECT * FROM owner_portal_access WHERE project_id = ? LIMIT 1`).bind(session.project_id).first<Record<string, unknown>>();
  if (!access || access.revoked_at || access.status === "Dormant" || access.status === "Revoked") return Response.json({ error: "Mefford Has Not Released Project Owner Access" }, { status: 403 });
  const contract = await database.prepare(`SELECT id, title, owner, due, status, meta, record_date, data_json FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Contracts' LIMIT 1`).bind(session.project_id, session.contract_record_id).first<Record<string, unknown>>();
  if (!contract) return Response.json({ error: "Released Owner Contract Not Found" }, { status: 404 });
  const data = parseOwnerObject(contract.data_json);

  if (input.action === "request-change") {
    if (!["Owner Review", "Changes Requested"].includes(String(access.status || ""))) return Response.json({ error: "The Contract Is Not Open For Owner Review" }, { status: 409 });
    const revisionId = String(access.approved_revision_id || "");
    const revision = await database.prepare(`SELECT fields_json FROM owner_contract_revisions WHERE id = ? AND project_id = ? LIMIT 1`).bind(revisionId, session.project_id).first<{ fields_json: string }>();
    const fields = parseOwnerObject(revision?.fields_json);
    const clauseKey = input.clauseKey?.trim().toUpperCase() || "";
    const requestType = input.requestType || "Comment";
    const proposedText = input.proposedText?.trim().slice(0, 20_000) || "";
    const comment = input.comment?.trim().slice(0, 5000) || "";
    if (!revision || !clauseKey || !(clauseKey in fields) || isExecutionControlField(clauseKey) || isSignatureContractField(clauseKey) || isOwnerContractBasisField(clauseKey) || !comment || ((requestType === "Replacement" || requestType === "Addition") && !proposedText)) return Response.json({ error: "Select A Released Clause And Explain The Requested Change" }, { status: 400 });
    const requestId = `OCR-${crypto.randomUUID()}`;
    await database.batch([
      database.prepare(`INSERT INTO owner_contract_change_requests (id, project_id, contract_record_id, revision_id, clause_key, request_type, original_text, proposed_text, comment, status, created_by_name, created_by_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`).bind(requestId, session.project_id, session.contract_record_id, revisionId, clauseKey, requestType, String(fields[clauseKey] || ""), proposedText, comment, session.contact_name, session.email, now.toISOString(), now.toISOString()),
      database.prepare(`UPDATE owner_portal_access SET status = 'Changes Requested', last_review_at = ?, updated_at = ? WHERE project_id = ?`).bind(now.toISOString(), now.toISOString(), session.project_id),
      database.prepare(`UPDATE command_records SET status = 'Changes Requested', data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify({ ...data, contractPhase: "Changes Requested" }), now.toISOString(), session.project_id, session.contract_record_id),
      ownerAudit(database, session.project_id, session.contract_record_id, session.contact_name, session.email, "Contract Change Requested", `${requestType} · ${clauseKey} · ${comment}`),
    ]);
    await routeOwnerWork(database, session.project_id, session.contract_record_id, "Project Manager", "Owner Contract Change Requested", `${session.contact_name} requested a ${requestType.toLowerCase()} for ${clauseKey}. Review the exact released clause and respond in Contracts.`, "High", `owner-change:${requestId}`);
    return ownerPayload(database, session);
  }

  if (input.action === "submit-review") {
    if (!["Owner Review", "Changes Requested"].includes(String(access.status || ""))) return Response.json({ error: "The Contract Is Not Open For Owner Review" }, { status: 409 });
    const open = await database.prepare(`SELECT COUNT(*) AS count FROM owner_contract_change_requests WHERE project_id = ? AND contract_record_id = ? AND revision_id = ? AND status = 'Open'`).bind(session.project_id, session.contract_record_id, String(access.approved_revision_id || "")).first<{ count: number }>();
    const hasChanges = Number(open?.count || 0) > 0;
    if (input.decision === "Accepted" && hasChanges) return Response.json({ error: "Open Change Requests Must Be Resolved Before The Revision Can Be Accepted" }, { status: 409 });
    const phase = hasChanges || input.decision === "Changes Requested" ? "Changes Requested" : "Owner Review Complete";
    await database.batch([
      database.prepare(`UPDATE owner_portal_access SET status = ?, last_review_at = ?, updated_at = ? WHERE project_id = ?`).bind(phase, now.toISOString(), now.toISOString(), session.project_id),
      database.prepare(`UPDATE command_records SET status = ?, data_json = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(phase, JSON.stringify({ ...data, contractPhase: phase, ownerReviewCompletedBy: session.contact_name, ownerReviewCompletedAt: now.toISOString() }), now.toISOString(), session.project_id, session.contract_record_id),
      ownerAudit(database, session.project_id, session.contract_record_id, session.contact_name, session.email, phase === "Owner Review Complete" ? "Contract Revision Accepted" : "Contract Review Submitted With Changes", `Revision ${String(access.approved_revision_id || "")}.`),
    ]);
    await routeOwnerWork(database, session.project_id, session.contract_record_id, phase === "Owner Review Complete" ? "Company Owner" : "Project Manager", phase === "Owner Review Complete" ? "Owner Contract Ready For Final Approval" : "Owner Contract Changes Submitted", phase === "Owner Review Complete" ? `${session.contact_name} accepted the released revision. Company Owner final approval and freeze are required before signatures.` : `${session.contact_name} submitted contract changes for Mefford response.`, "High", `owner-review:${session.project_id}:${String(access.approved_revision_id || "")}:${phase}`);
    return ownerPayload(database, session);
  }

  if (input.action === "sign") {
    if (String(access.status || "") !== "Ready for Signature" || String(contract.status || "") !== "Ready for Signature") return Response.json({ error: "Mefford Must Complete Final Approval Before Owner Signature" }, { status: 409 });
    if (!input.signatureConsent || !input.signerName?.trim() || !input.signerTitle?.trim() || !validSignatureImage(input.signatureImage)) return Response.json({ error: "Typed Identity Title Consent And Drawn Signature Are Required" }, { status: 400 });
    const revision = await database.prepare(`SELECT id, snapshot_hash, frozen_at, fields_json FROM owner_contract_revisions WHERE id = ? AND project_id = ? LIMIT 1`).bind(String(access.approved_revision_id || ""), session.project_id).first<{ id: string; snapshot_hash: string; frozen_at: string | null; fields_json: string }>();
    if (!revision?.frozen_at || revision.snapshot_hash !== String(data.frozenRevisionHash || "")) return Response.json({ error: "The Frozen Contract Revision Could Not Be Verified" }, { status: 409 });
    const basisAttachmentCount = ownerContractBasisAttachments(parseOwnerObject(revision.fields_json)).length;
    const signatures = parseOwnerObject(data.signatures);
    signatures.owner = {
      signerName: input.signerName.trim(), signerTitle: input.signerTitle.trim(), signerEmail: session.email,
      signatureImage: input.signatureImage, signedAt: now.toISOString(), capturedBy: session.contact_name,
      capturedByEmail: session.email, revisionId: revision.id, revisionHash: revision.snapshot_hash,
      consentText: `I reviewed and agree to this exact frozen contract revision${basisAttachmentCount ? ` and its ${basisAttachmentCount} listed contract-basis PDF${basisAttachmentCount === 1 ? "" : "s"}` : ""} and intend this electronic signature to be binding.`,
    };
    const nextData = { ...data, signatures, signatureStatus: "Owner Signed", contractPhase: "Owner Signed", ownerSignedAt: now.toISOString() };
    await database.batch([
      database.prepare(`UPDATE command_records SET status = 'Owner Signed', data_json = ?, meta = ?, updated_at = ? WHERE project_id = ? AND id = ?`).bind(JSON.stringify(nextData), `${String(data.contractType || "Owner Contract")} · Owner Signed · Mefford Countersignature Required`, now.toISOString(), session.project_id, session.contract_record_id),
      database.prepare(`UPDATE projects SET owner_contract_status = 'Owner Signed', owner_contract_record_id = ?, updated_at = ? WHERE number = ?`).bind(session.contract_record_id, now.toISOString(), session.project_id),
      database.prepare(`UPDATE owner_portal_access SET status = 'Owner Signed', last_review_at = ?, updated_at = ? WHERE project_id = ?`).bind(now.toISOString(), now.toISOString(), session.project_id),
      ownerAudit(database, session.project_id, session.contract_record_id, session.contact_name, session.email, "Project Owner Signature Recorded", `Frozen revision ${revision.id} · ${revision.snapshot_hash} · ${basisAttachmentCount} contract-basis PDF${basisAttachmentCount === 1 ? "" : "s"}`),
      database.prepare(`INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary) VALUES (?, ?, 'Owner Contract Lifecycle', 'Ready for Signature', 'Owner Signed', 'Dedicated Project Owner Portal', ?, ?, ?)`).bind(session.project_id, session.contract_record_id, session.contact_name, session.email, `Project Owner signed frozen revision ${revision.id}; Mefford countersignature is now required.`),
    ]);
    await routeOwnerWork(database, session.project_id, session.contract_record_id, "Company Owner", "Mefford Countersignature Required", `${session.contact_name} signed the exact frozen owner contract revision. Mefford must countersign before execution.`, "Critical", `owner-signature:${session.project_id}:${revision.id}`);
    return ownerPayload(database, session);
  }

  return Response.json({ error: "Project Owner Action Is Not Supported" }, { status: 400 });
}

async function ownerPayload(database: D1Database, session: Awaited<ReturnType<typeof ownerPortalSession>>) {
  if (!session) return Response.json({ error: "Project Owner Session Is Missing" }, { status: 401 });
  const [project, access, contract, revisions, changes, records, files] = await Promise.all([
    database.prepare(`SELECT number, name, status, site, owner_name, owner_contract_date, owner_contract_type, owner_contract_status, contract_amount, current_contract_amount, start_date, substantial_date, final_date, project_manager FROM projects WHERE number = ? LIMIT 1`).bind(session.project_id).first<Record<string, unknown>>(),
    database.prepare(`SELECT * FROM owner_portal_access WHERE project_id = ? LIMIT 1`).bind(session.project_id).first<Record<string, unknown>>(),
    database.prepare(`SELECT id, title, due, status, meta, record_date, data_json FROM command_records WHERE project_id = ? AND id = ? AND record_type = 'Contracts' LIMIT 1`).bind(session.project_id, session.contract_record_id).first<Record<string, unknown>>(),
    database.prepare(`SELECT id, revision_number, phase, contract_type, fields_json, snapshot_hash, frozen_at, created_at FROM owner_contract_revisions WHERE project_id = ? AND phase IN ('Approved for Owner Review', 'Final Approval') ORDER BY revision_number DESC`).bind(session.project_id).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, revision_id, clause_key, request_type, original_text, proposed_text, comment, status, mefford_response, created_by_name, created_at, updated_at FROM owner_contract_change_requests WHERE project_id = ? AND created_by_email = ? ORDER BY created_at DESC`).bind(session.project_id, session.email).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, record_type, title, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE project_id = ? AND record_type IN ('Change Orders','Owner Billing','Owner Invoices','Schedule','Selections','Closeout Requirements','Project Owner Messages') ORDER BY updated_at DESC`).bind(session.project_id).all<Record<string, unknown>>(),
    database.prepare(`SELECT id, name, category, revision, content_type, size_bytes, created_at FROM project_files WHERE project_id = ? AND (lower(access) LIKE '%owner%' OR lower(access) LIKE '%client%') ORDER BY created_at DESC`).bind(session.project_id).all<Record<string, unknown>>(),
  ]);
  if (!project || !access || !contract || access.revoked_at || access.status === "Dormant" || access.status === "Revoked") return Response.json({ error: "Project Owner Access Is Not Active" }, { status: 403 });
  const contractData = parseOwnerObject(contract.data_json);
  const ownerRecords = records.results.map(sanitizeOwnerRecord).filter((record): record is NonNullable<ReturnType<typeof sanitizeOwnerRecord>> => record !== null);
  return Response.json({
    verified: true,
    invite: { id: session.id, email: session.email, contactName: session.contact_name, sessionExpiresAt: session.session_expires_at },
    project: {
      number: project.number, name: project.name, status: project.status, site: project.site,
      ownerName: project.owner_name, contractDate: project.owner_contract_date, contractType: project.owner_contract_type,
      contractStatus: project.owner_contract_status, contractAmount: project.contract_amount,
      currentContractAmount: project.current_contract_amount, startDate: project.start_date,
      substantialDate: project.substantial_date, finalDate: project.final_date, projectManager: project.project_manager,
    },
    access: { status: access.status, approvedRevisionId: access.approved_revision_id, lastReviewAt: access.last_review_at },
    contract: {
      id: contract.id, title: contract.title, status: contract.status, meta: contract.meta,
      contractType: contractData.contractType, signatures: sanitizeSignatures(contractData.signatures),
      frozenRevisionId: contractData.frozenRevisionId, activeInstrument: contractData.activeInstrument,
      agreementSource: contractData.agreementSource,
      basisAttachments: ownerContractBasisAttachments(parseOwnerObject(contractData.fields)),
    },
    revisions: revisions.results.map((revision) => {
      const revisionFields = parseOwnerObject(revision.fields_json);
      return { ...revision, fields: ownerReviewFields(revisionFields), basisAttachments: ownerContractBasisAttachments(revisionFields), fields_json: undefined };
    }),
    changeRequests: changes.results,
    changeOrders: ownerRecords.filter((record) => record.recordType === "Change Orders"),
    billing: ownerRecords.filter((record) => ["Owner Billing", "Owner Invoices"].includes(String(record.recordType))),
    schedule: ownerRecords.filter((record) => record.recordType === "Schedule"),
    selections: ownerRecords.filter((record) => record.recordType === "Selections"),
    closeout: ownerRecords.filter((record) => record.recordType === "Closeout Requirements"),
    messages: ownerRecords.filter((record) => record.recordType === "Project Owner Messages"),
    documents: files.results,
    privacyBoundary: ["Internal Estimates", "Margin And Fee Detail", "Bid Comparisons", "Internal Budgets", "Accounting Journals", "Employee Information", "Internal Notes", "Restricted Safety Records"],
  });
}

function ownerReviewFields(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => !isExecutionControlField(key) && !isSignatureContractField(key) && !isOwnerContractBasisField(key) && String(value ?? "").trim()));
}

function sanitizeOwnerRecord(row: Record<string, unknown>) {
  const data = parseOwnerObject(row.data_json);
  if (row.record_type === "Change Orders" && !["Owner Review", "Approved", "Executed", "Rejected"].includes(String(row.status || ""))) return null;
  if (row.record_type === "Closeout Requirements" && !["Approved", "Submitted", "Owner Acceptance"].includes(String(row.status || ""))) return null;
  const safeData = row.record_type === "Schedule"
    ? pick(data, ["start", "finish", "duration", "progress", "milestone", "ownerVisibleNote"])
    : row.record_type === "Selections"
      ? pick(data, ["description", "color", "size", "manufacturer", "model", "decisionDue", "ownerDecision", "orderedStatus"])
      : row.record_type === "Change Orders"
        ? pick(data, ["description", "reason", "ownerAmount", "approvedTotal", "scheduleDays", "newSubstantialDate", "newFinalDate", "ownerDecision"])
        : row.record_type === "Owner Billing" || row.record_type === "Owner Invoices"
          ? pick(data, ["invoiceNumber", "applicationNumber", "periodEnd", "currentDue", "contractAmount", "approvedChanges", "retainage", "balanceToFinish", "paymentStatus"])
          : pick(data, ["category", "instructions", "summary", "ownerMessage", "submittedFiles", "fileVersions"]);
  return { id: row.id, recordType: row.record_type, title: row.title, due: row.due, status: row.status, meta: row.meta, recordDate: row.record_date, data: safeData };
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]));
}

function sanitizeSignatures(value: unknown) {
  const signatures = parseOwnerObject(value);
  const owner = parseOwnerObject(signatures.owner);
  const mefford = parseOwnerObject(signatures.mefford);
  return {
    owner: owner.signedAt ? { signerName: owner.signerName, signerTitle: owner.signerTitle, signedAt: owner.signedAt } : {},
    mefford: mefford.signedAt ? { signerName: mefford.signerName, signerTitle: mefford.signerTitle, signedAt: mefford.signedAt } : {},
  };
}

function ownerAudit(database: D1Database, projectId: string, contractRecordId: string, actorName: string, actorEmail: string, action: string, detail: string) {
  return database.prepare(`INSERT INTO owner_portal_audits (project_id, contract_record_id, actor_type, actor_name, actor_email, action, detail) VALUES (?, ?, 'Project Owner', ?, ?, ?, ?)`).bind(projectId, contractRecordId, actorName, actorEmail, action, detail);
}

async function loadInvite(database: D1Database, inviteId: string) {
  return database.prepare(`SELECT id, project_id, contract_record_id, contact_name, email, code_hash, status, expires_at, attempts, verified_at, revoked_at, session_hash, session_expires_at FROM owner_portal_invites WHERE id = ? LIMIT 1`).bind(inviteId).first<{
    id: string; project_id: string; contract_record_id: string; contact_name: string; email: string;
    code_hash: string; status: string; expires_at: string; attempts: number; verified_at: string | null;
    revoked_at: string | null; session_hash: string | null; session_expires_at: string | null;
  }>();
}

function validSignatureImage(value: unknown) {
  return typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length >= 200;
}

async function routeOwnerWork(database: D1Database, projectId: string, recordId: string, audience: "Project Manager" | "Company Owner", title: string, message: string, priority: string, dedupeKey: string) {
  const recipients = audience === "Company Owner"
    ? await database.prepare(`SELECT display_name, email FROM company_members WHERE is_active = 1 AND company_access_level = 'Company Owner'`).all<{ display_name: string; email: string }>()
    : await database.prepare(`SELECT cm.display_name, cm.email FROM projects p JOIN company_members cm ON cm.display_name = p.project_manager AND cm.is_active = 1 WHERE p.number = ?`).bind(projectId).all<{ display_name: string; email: string }>();
  const now = new Date().toISOString();
  for (const recipient of recipients.results) {
    await database.prepare(`INSERT INTO command_work_items (id, dedupe_key, project_id, recipient_name, recipient_email, kind, title, message, priority, item_kind, status, source_type, source_record_id, action_target, due_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Owner Contract', ?, ?, ?, 'Approval', 'Open', 'Contracts', ?, 'Contracts', ?, 'Project Owner Portal', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`).bind(`OWI-${crypto.randomUUID()}`, `${dedupeKey}:${recipient.email}`, projectId, recipient.display_name, recipient.email, title, message, priority, recordId, now, now, now).run();
  }
}
