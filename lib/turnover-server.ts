import { calculateEstimateSummary, calculateEstimateEntry, normalizeEstimateData } from "../app/estimate-template";
import { reconcileBonusProject, bonusTurnoverBlockers } from "./bonus-server";
import { billingObject as obj } from "./owner-billing-authority";
import { loadSalesContracts } from "./sales-contract-server";
import { normalizeBidPackageData, selectedProposalBid, latestBid, bidderIsLeveled } from "./procurement";
import { ensureMeetingTables, type MeetingActor } from "./meeting-server";
import { ensureMyWorkTables, upsertWorkItem } from "./my-work";
import { OPS_TURNOVER, SALES_TURNOVER, TURNOVER_SECTIONS, turnoverBuyoutDate, type TurnoverType, type TurnoverPacket, type TurnoverView } from "./turnovers";

type Row = Record<string, string | number | null>;
const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const label = (value: string) => value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
const lines = (values: Array<[string, unknown]>) => values.map(([key, value]) => `${key}: ${str(value) || "Not recorded"}`).join("\n");
export class TurnoverError extends Error { status: number; constructor(message: string, status = 409) { super(message); this.status = status; } }

export async function ensureTurnoverTables(database: D1Database) {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS meeting_turnovers (
      id text PRIMARY KEY NOT NULL, meeting_type text NOT NULL, opportunity_id text NOT NULL, project_id text NOT NULL DEFAULT '',
      occurrence_id text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'Preparation', revision integer NOT NULL DEFAULT 0,
      snapshot_json text NOT NULL DEFAULT '{}', reviewed_json text NOT NULL DEFAULT '[]', accepted_snapshot_json text NOT NULL DEFAULT '{}',
      accepted_by text NOT NULL DEFAULT '', accepted_at text NOT NULL DEFAULT '', ntp_reference text NOT NULL DEFAULT '',
      scheduled_confirmed integer NOT NULL DEFAULT 0, checked_at text NOT NULL DEFAULT '', created_at text NOT NULL, updated_at text NOT NULL,
      UNIQUE(meeting_type, opportunity_id))`),
    database.prepare(`CREATE INDEX IF NOT EXISTS meeting_turnover_queue_idx ON meeting_turnovers (checked_at, id)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS meeting_turnover_recovery (source_id text PRIMARY KEY NOT NULL, last_error text NOT NULL DEFAULT '', attempted_at text NOT NULL, retry_after text NOT NULL DEFAULT '')`),
  ]);
}

async function packetFor(database: D1Database, turnover: Row): Promise<TurnoverPacket> {
  const opportunity = await database.prepare(`SELECT * FROM command_records WHERE project_id = 'MEFFORD-SALES' AND id = ? AND record_type = 'Sales Opportunities'`).bind(turnover.opportunity_id).first<Row>();
  if (!opportunity) throw new TurnoverError("The Turnover Source Opportunity Is Unavailable", 404);
  const data = obj(opportunity.data_json), operations = turnover.meeting_type === OPS_TURNOVER;
  const projectId = str(turnover.project_id), opportunityId = str(turnover.opportunity_id);
  const [project, membersResult, recordResult, fileResult, contact] = await Promise.all([
    projectId ? database.prepare(`SELECT * FROM projects WHERE number = ?`).bind(projectId).first<Row>() : Promise.resolve(null),
    database.prepare(`SELECT email, display_name, company_access_level, designations_json FROM company_members WHERE is_active = 1 ORDER BY email`).all<Row>(),
    database.prepare(`SELECT * FROM command_records WHERE project_id = ? AND (project_id <> 'MEFFORD-SALES' OR (json_valid(data_json) AND json_extract(data_json, '$.opportunityId') = ?)) ORDER BY record_type, id`).bind(operations ? projectId : "MEFFORD-SALES", opportunityId).all<Row>(),
    database.prepare(`SELECT id, name, category, revision, created_at, storage_key, content_type, size_bytes FROM project_files WHERE project_id IN (?, ?) ORDER BY id`).bind(projectId || `ESTIMATE-${opportunityId}`, `ESTIMATE-${opportunityId}`).all<Row>(),
    str(data.contactId) ? database.prepare(`SELECT * FROM command_records WHERE project_id = 'MEFFORD-SALES' AND id = ? AND record_type = 'Sales Contacts'`).bind(str(data.contactId)).first<Row>() : Promise.resolve(null),
  ]);
  if (operations && (!project || /Deleted|Deletion Quarantine/i.test(str(project.status)))) throw new TurnoverError("The Turnover Project Is Unavailable", 404);
  const members = membersResult.results;
  const resolve = (name: string) => { const matches = members.filter(m => [str(m.display_name).toLowerCase(), str(m.email).toLowerCase()].includes(name.toLowerCase())); return matches.length === 1 ? matches[0] : undefined; };
  const senderName = str(operations ? data.assignedEstimator : data.assignedRep) || str(opportunity.owner);
  const receiverName = str(operations ? project?.project_manager : data.assignedEstimator);
  const sender = resolve(senderName), receiver = resolve(receiverName);
  const people: TurnoverPacket["people"] = [];
  const addPerson = (member: Row | undefined, role: string) => {
    if (!member) return;
    const prior = people.find(p => p.email === member.email);
    if (prior) { if (!prior.role.split("; ").includes(role)) prior.role += `; ${role}`; }
    else people.push({ name:str(member.display_name),email:str(member.email),role });
  };
  addPerson(sender, operations ? "Estimator" : "Salesperson"); addPerson(receiver, operations ? "Project Manager" : "Estimator");
  if (operations) addPerson(resolve(str(project?.superintendent)), "Site Superintendent");
  for (const member of members) {
    const roles = json<string[]>(member.designations_json, []);
    if (member.company_access_level === "Company Owner") addPerson(member, "Company Owner");
    else if (roles.some(role => (operations ? ["Chief Estimator", "Estimating Manager", "Director of Operations", "Accounting Manager", "Project Accountant"] : ["Sales Manager", "Estimating Manager", "Chief Estimator"]).includes(role))) addPerson(member, roles.join(", "));
  }
  if (operations) {
    const accountants = members.filter(m => json<string[]>(m.designations_json,[]).some(role => ["Accountant","Project Accountant","Accounting Manager","Financial Administrator"].includes(role)));
    if (accountants.length === 1) addPerson(accountants[0],"Project Accountant");
  }
  const assignedParticipants = await database.prepare(`SELECT a.email,a.attendee_role FROM meeting_attendees a JOIN company_members m ON lower(m.email) = lower(a.email) AND m.is_active = 1 WHERE a.occurrence_id = ? AND substr(a.id,1,?) <> ? ORDER BY a.email,a.attendee_role`).bind(turnover.occurrence_id || `${turnover.id}:meeting`,`${turnover.id}:person:`.length,`${turnover.id}:person:`).all<Row>();
  for (const participant of assignedParticipants.results) addPerson(resolve(str(participant.email)),str(participant.attendee_role));
  const contract = projectId ? (await loadSalesContracts(database, [projectId])).get(projectId) : undefined;
  const records = recordResult.results;
  const contractData = obj(records.find(r => r.id === project?.owner_contract_record_id)?.data_json), fields = obj(contractData.fields);
  const estimateRecord = records.find(r => r.record_type === "Awarded Estimates" || r.record_type === "Estimate" || r.record_type === "Estimate Cap Sheet");
  const sourceEstimate = operations && estimateRecord ? obj(estimateRecord.data_json).estimate || obj(estimateRecord.data_json) : data.estimate;
  const estimate = normalizeEstimateData(sourceEstimate), summary = calculateEstimateSummary(estimate);
  const contactData = obj(contact?.data_json);
  const packages = records.filter(r => r.record_type === "Bid Packages").map(r => ({ row: r, data: normalizeBidPackageData(obj(r.data_json)) }));
  const proposals = records.filter(r => /Owner Proposal|Construction Proposal|Proposal/.test(str(r.record_type)));
  const content: Record<string, string> = {};
  const title = str(project?.name) || str(data.projectName) || str(opportunity.title);
  content.control = lines([["Project", title], ["Project number", projectId || "Pre-award"], ["Salesperson", data.assignedRep], ["Estimator", data.assignedEstimator], ["Receiving lead", receiverName], ["Required participants", people.map(p => `${p.role}: ${p.name}`).join("; ")], ["Trigger", operations ? contract?.signed ? "Executed owner contract" : turnover.ntp_reference ? `Recorded NTP: ${turnover.ntp_reference}` : "Award — preparation pending signed contract / NTP" : "Sales opportunity entered estimating"]]);
  content.project = lines([["Owner / customer", project?.owner_name || data.company], ["Site", project?.site || data.projectLocation || data.projectAddress], ["Owner contact", contact?.title], ["Contact email", contactData.email], ["Contact phone", contactData.phone], ["Architect", project?.architect], ["Project type", project?.project_type || data.projectType], ["Project manager", project?.project_manager], ["Site superintendent", project?.superintendent], ["Start", project?.start_date || data.targetStartDate], ["Substantial completion", project?.substantial_date], ["Final completion", project?.final_date], ["Estimated months", estimate.projectInputs.projectDurationMonths || data.durationMonths], ["Bid due", data.bidDueDate || data.estimateDueDate || opportunity.due], ["Expected award", data.expectedAwardDate]]);
  content.project += "\n" + lines(Object.entries(fields).filter(([key,value]) => str(value) && /ARCHITECT|CIVIL|STRUCTURAL|MECHANICAL|ELECTRICAL|PLUMBING|ENGINEER|OWNER_CONTACT|PAY_APP|APPLICATION.*PAYMENT/i.test(key)).map(([key,value]) => [label(key),value]));
  content.commercial = lines([["Contract type", project?.owner_contract_type || data.ownerContractType], ["Current controlled contract", contract ? money(contract.contractValue) : "Pre-award"], ["Owner contract", contract?.status || "Not awarded"], ["Construction sales / billing", contract?.signed ? "Signed contract verified" : "Blocked pending both contract signatures"], ["Customer budget", data.budget || data.estimatedValue], ["Cap sheet total", money(summary.contractValue)], ["Payment terms", project?.payment_terms], ["Initial retainage %", project?.retainage_initial_percent], ["Retainage after halfway %", project?.retainage_after_half_percent], ...Object.entries(fields).filter(([k,v]) => str(v) && /BOND|RISK|TAX|DPO|RETAIN|LIQUIDATED|PAYROLL|WAGE|MINORITY|WMDBE|FINANC|CHECK|PAYMENT|ALLOWANCE|ALTERNATE|UNIT_PRICE/i.test(k)).map(([k,v]): [string,unknown] => [label(k),v])]);
  content.estimate = lines([["Estimate status", estimate.status], ["Direct job cost", money(summary.directJobCost)], ["Budget", money(summary.originalBudget)], ["Contractor fees", money(summary.totalContractorFees)], ["Reconciliation difference", money(summary.reconciliationDifference)], ["Duration months", estimate.projectInputs.projectDurationMonths], ["Travel miles", estimate.projectInputs.distanceToFromJobMiles], ["Building SF", estimate.projectInputs.buildingSquareFeet], ["Estimator notes", estimate.notes]]) + "\n" + summary.budgetRollups.filter(r => r.amount !== 0).map(r => `${r.code} ${r.description}: ${money(r.amount)}`).join("\n");
  content.estimate += "\n" + lines([["PM hours", calculateEstimateEntry(estimate,"0131.00","100",{quantity:0,unit:"HR"}).entry.quantity], ["Superintendent hours", calculateEstimateEntry(estimate,"0131.00","200",{quantity:0,unit:"HR"}).entry.quantity], ["PM cost / billable rate", `${money(estimate.settings.projectManagerCostRate)} / ${money(estimate.settings.projectManagerBillableRate)}`], ["Superintendent cost / billable rate", `${money(estimate.settings.superintendentCostRate)} / ${money(estimate.settings.superintendentBillableRate)}`]]);
  content.scope = lines([["Project scope", operations ? fields.CONSTRUCTION_SCOPE_OF_WORK || data.projectDescription : data.projectDescription], ["Owner commitments / exclusions", data.scopeNotes || data.notes]]) + "\n" + packages.map(({data:p}) => `${p.costCode} ${p.trade}: ${p.scopeDescription}\nResponsibility: ${p.scopeNature}; budget ${money(p.budgetAmount)}; selected ${p.proposalBasis?.vendorName || "Unassigned"}\nProposal scope: ${p.proposalBasis?.ownerScopeDraft || "Not selected"}`).join("\n") + "\n" + proposals.map(p => `${p.title} (${p.status}): ${lines(Object.entries(obj(p.data_json)).filter(([k,v]) => /scope|inclusion|exclusion|assumption|executiveSummary|projectUnderstanding/i.test(k) && typeof v === "string"))}`).join("\n");
  content.scope += "\n" + lines(Object.entries(fields).filter(([key,value]) => /SCOPE|EXCLUSION|ASSUMPTION|OWNER.*PROVID|SALVAGE/i.test(key) && str(value)).map(([key,value]) => [label(key),value]));
  content.buyout = packages.map(({row,data:p}) => {
    const selected = selectedProposalBid(p);
    const bids = p.bidders.map(b => ({ bidder:b, bid:latestBid(b) })).filter(b => b.bid).sort((a,b) => Number(a.bid!.ocr?.reviewedPrice ?? a.bid!.total) - Number(b.bid!.ocr?.reviewedPrice ?? b.bid!.total));
    return `${row.title} · ${p.costCode} · ${row.status}\nBudget ${money(p.budgetAmount)}; selected ${selected ? `${selected.bidder.vendorName} ${money(selected.basis.selectedPrice)}` : "Not selected"}\n${bids.map(({bidder,bid}) => `${bidder.vendorName}: ${money(Number(bid!.ocr?.reviewedPrice ?? bid!.total))}; ${bidderIsLeveled(bidder) ? "Scope leveled" : "Scope review required"}; exclusions ${bid!.exclusions || "None recorded"}; lead time ${bid!.schedule || "Not recorded"}`).join("\n")}\nRecommendation: ${p.recommendation?.narrative || "Not recorded"}`;
  }).join("\n\n") || "No bid packages recorded. Confirm self-perform / owner-provided scopes or complete subcontract coverage.";
  if (operations) {
    const date = str(turnover.started_at || turnover.held_at || (turnover.scheduled_confirmed ? turnover.scheduled_start : ""));
    const due = turnoverBuyoutDate(date,str(turnover.time_zone) || "America/New_York");
    content.buyout = `Buyout deadline: ${due || "Confirm the meeting date"}${due && !turnover.started_at && !turnover.held_at ? " (planned)" : ""}\n\n${content.buyout}`;
  }
  content.documents = fileResult.results.map(f => `${f.name} · ${f.category} · ${f.revision} · ${f.created_at}`).join("\n") || "No source documents recorded.";
  const riskRecords = records.filter(r => /Risk|Schedule|RFI|Selection|Submittal|Owner Billing|Change Order|Safety|Quality|Design/.test(str(r.record_type)) && !/^(Closed|Complete|Completed|Paid|Void|Voided|Cancelled|Resolved)$/i.test(str(r.status)));
  content.risks = riskRecords.map(r => `${r.record_type}: ${r.title} · ${r.status} · ${r.owner} · Due ${r.due}\n${lines(Object.entries(obj(r.data_json)).filter(([k,v]) => /risk|impact|mitigation|blocker|leadTime|reason|notes/i.test(k) && typeof v === "string"))}`).join("\n\n") || "No open risks recorded. Review cost, schedule, design, owner, subcontractor, safety and logistics risks.";
  content.setup = lines([["System of record", "Command Center"], ["Controlled contract", project?.owner_contract_record_id], ["Budget lines", summary.budgetRollups.filter(r => r.amount).length], ["Source opportunity", opportunityId], ["Project participants", people.map(p => p.name).join(", ")]]) + "\n" + records.filter(r => /Subcontracts|Purchase Orders|Owner Billing Setup/.test(str(r.record_type))).map(r => `${r.record_type}: ${r.title} · ${r.status}`).join("\n");
  content.actions = "Open turnover requirements and meeting assignments are tracked in Decisions & Actions and My Work.";
  content.recap = "Record the primary project challenge, cost risk, schedule risk, field/logistics risk, owner priorities and meeting decisions. PM acceptance records the exact reviewed source revision.";
  const gaps: TurnoverPacket["gaps"] = [];
  const gap = (key: string, missing: boolean, text: string, blocking = true, owner = senderName) => { if (missing) gaps.push({ key, title:text, owner, blocking }); };
  gap("sender", !sender, operations ? "Assign an active estimator" : "Assign an active salesperson");
  gap("receiver", !receiver, operations ? "Assign an active project manager" : "Assign an active estimator");
  gap("scope", !str(data.projectDescription || fields.CONSTRUCTION_SCOPE_OF_WORK), "Record the project scope");
  gap("documents", fileResult.results.length === 0, "Provide drawings / specifications or document the pricing basis", false);
  if (!operations) {
    gap("contact", data.leadSource !== "Public Bid" && !contact, "Link the customer contact");
    gap("bid-deadline", !str(data.bidDueDate || data.estimateDueDate || opportunity.due), "Confirm the bid deadline", false);
  } else {
    gap("authority", !contract?.signed && !str(turnover.ntp_reference), "Obtain the signed owner contract or record authorized NTP");
    gap("superintendent", !resolve(str(project?.superintendent)), "Assign an active site superintendent");
    gap("schedule", !str(project?.start_date) || !str(project?.substantial_date) || !str(project?.final_date), "Confirm contractual start, substantial and final dates");
    gap("estimate", !sourceEstimate || Math.abs(summary.reconciliationDifference) > 0.01, "Reconcile the final cap sheet");
    gap("accountant", !people.some(p => /Account/i.test(p.role)), "Confirm project accountant participation", true, receiverName);
    gap("ops-director", !people.some(p => /Director.*Operations/i.test(p.role)), "Confirm Director of Operations participation", true, receiverName);
    gap("chief-estimator", !people.some(p => /Chief Estimator|Estimating Manager/i.test(p.role)), "Confirm Chief Estimator participation", true);
    for (const {row,data:p} of packages) gap(`coverage:${row.id}`, !selectedProposalBid(p), `Resolve subcontract coverage: ${p.trade}`, false);
  }
  return { title, projectId, opportunityId, receiverName, receiverEmail:str(receiver?.email), senderName, senderEmail:str(sender?.email), contractSigned:Boolean(contract?.signed), contractValue:contract?.contractValue || 0, people, gaps,
    files:fileResult.results.filter(f => f.category !== "Turnover Bonus Agreement").map(f => ({id:str(f.id),name:str(f.name),category:str(f.category),revision:str(f.revision),storageKey:str(f.storage_key),contentType:str(f.content_type),size:Number(f.size_bytes)})),
    sections: TURNOVER_SECTIONS[turnover.meeting_type as TurnoverType].map(s => ({ ...s, content: content[s.key] || "" })) };
}

export async function ensureTurnoverMeeting(type: TurnoverType, opportunityId: string, projectId = "") {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await ensureMeetingTables(); await ensureTurnoverTables(database);
  const id = `turnover:${type === SALES_TURNOVER ? "sales" : "ops"}:${opportunityId}`;
  const occurrenceId = `${id}:meeting`, now = new Date().toISOString();
  const seed: Row = { id, meeting_type:type, opportunity_id:opportunityId, project_id:projectId, ntp_reference:"" };
  const packet = await packetFor(database, seed);
  const lead = packet.people.find(p => p.email === packet.receiverEmail) || packet.people.find(p => p.role.includes("Company Owner")) || packet.people[0];
  if (!lead) throw new TurnoverError("Assign An Active Internal Turnover Participant");
  const duration = type === SALES_TURNOVER ? 40 : 90;
  const start = new Date(Date.now() + 86400000).toISOString();
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO meeting_series (id,meeting_type,project_id,title,cadence,start_at,duration_minutes,meeting_mode,location,leader_name,leader_email,organizer_email,recording_default,auto_publish_hours,created_by) VALUES (?,?,'MEFFORD-COMPANY',?,'One Time',?,?,'In Person','To Be Confirmed',?,?,?,0,24,'Turnover Automation')`).bind(id,type,`${packet.title} · ${type}`,start,duration,lead.name,lead.email,lead.email),
    database.prepare(`INSERT OR IGNORE INTO meeting_occurrences (id,series_id,meeting_number,scheduled_start,scheduled_end,recording_enabled,publication_hold,publication_hold_reason) VALUES (?,?,?,?,?,0,1,'Confirm turnover date and participants')`).bind(occurrenceId,id,`${type === SALES_TURNOVER ? "SE" : "TO"}-${opportunityId}`,start,new Date(Date.parse(start)+duration*60000).toISOString()),
    database.prepare(`INSERT OR IGNORE INTO meeting_turnovers (id,meeting_type,opportunity_id,project_id,occurrence_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(id,type,opportunityId,projectId,occurrenceId,now,now),
    ...packet.people.map(p => database.prepare(`INSERT OR IGNORE INTO meeting_attendees (id,occurrence_id,name,email,attendee_role) VALUES (?,?,?,?,?)`).bind(`${id}:person:${p.email}`,occurrenceId,p.name,p.email,p.role)),
  ]);
  await refreshTurnoverMeeting(occurrenceId);
  return { turnoverId:id, occurrenceId, status:"Prepared", externalInvitationsSent:false };
}

export async function refreshTurnoverMeeting(occurrenceId: string) {
  const { env } = await import("cloudflare:workers"); const database = env.DB;
  await ensureTurnoverTables(database);
  const row = await database.prepare(`SELECT t.*,o.status AS meeting_status,o.started_at,o.held_at,o.scheduled_start,s.time_zone FROM meeting_turnovers t JOIN meeting_occurrences o ON o.id = t.occurrence_id JOIN meeting_series s ON s.id = o.series_id WHERE t.occurrence_id = ?`).bind(occurrenceId).first<Row>();
  if (!row) return { refreshed:false };
  if (row.meeting_type === OPS_TURNOVER) await reconcileBonusProject(str(row.project_id),occurrenceId);
  const packet = await packetFor(database,row), snapshot = JSON.stringify(packet), now = new Date().toISOString();
  const changed = snapshot !== row.snapshot_json;
  const revision = Number(row.revision) + (changed ? 1 : 0);
  const status = changed && row.accepted_at ? "Changes Require Review" : row.status === "Accepted" || row.status === "Changes Require Review" ? row.status : packet.gaps.some(g => g.blocking) ? "Preparation" : "Ready For Review";
  const mutable = ["Draft Agenda","Published Agenda","Meeting In Progress"].includes(str(row.meeting_status));
  const writes: D1PreparedStatement[] = [];
  if (changed) writes.push(database.prepare(`INSERT INTO meeting_audits (series_id,occurrence_id,entity_type,entity_id,action,before_json,after_json,actor_name,actor_email) VALUES (?,?,'Turnover Packet',(SELECT id FROM meeting_turnovers WHERE id = ? AND revision = ? AND snapshot_json = ?),'Source Revision Refreshed',?,?,'Turnover Automation','system@meffcon.com')`).bind(row.id,occurrenceId,row.id,row.revision,row.snapshot_json,JSON.stringify({revision:row.revision}),JSON.stringify({revision,packet})));
  writes.push(database.prepare(`UPDATE meeting_turnovers SET snapshot_json = ?,revision = ?,status = ?,reviewed_json = CASE WHEN snapshot_json <> ? THEN '[]' ELSE reviewed_json END,checked_at = ?,updated_at = CASE WHEN snapshot_json <> ? THEN ? ELSE updated_at END WHERE id = ? AND revision = ?`).bind(snapshot,revision,status,snapshot,now,snapshot,now,row.id,row.revision));
  if (changed) {
    const lead = packet.people.find(p => p.email === packet.receiverEmail) || packet.people.find(p => p.role.includes("Company Owner")) || packet.people[0];
    if (lead) writes.push(database.prepare(`UPDATE meeting_series SET leader_name = ?,leader_email = ?,title = ?,updated_at = ? WHERE id = ?`).bind(lead.name,lead.email,`${packet.title} · ${row.meeting_type}`,now,row.id));
    for (const person of packet.people) writes.push(database.prepare(`INSERT INTO meeting_attendees (id,occurrence_id,name,email,attendee_role) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM meeting_attendees WHERE occurrence_id = ? AND email = ? AND id <> ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,attendee_role = excluded.attendee_role`).bind(`${row.id}:person:${person.email}`,occurrenceId,person.name,person.email,person.role,occurrenceId,person.email,`${row.id}:person:${person.email}`));
    writes.push(database.prepare(`DELETE FROM meeting_attendees WHERE occurrence_id = ? AND substr(id,1,?) = ? AND email NOT IN (SELECT value FROM json_each(?))`).bind(occurrenceId,`${row.id}:person:`.length,`${row.id}:person:`,JSON.stringify(packet.people.map(p=>p.email))));
  }
  if (mutable) packet.sections.forEach((section,index) => writes.push(database.prepare(`INSERT INTO meeting_agenda_items (id,occurrence_id,section_key,title,position,timebox_minutes,source_type,source_id,source_version,source_reason,created_by) VALUES (?,?,?,?,?,?,'Turnover Source',?,?,?,'Turnover Automation') ON CONFLICT(id) DO UPDATE SET source_reason = excluded.source_reason,source_version = excluded.source_version,updated_at = CURRENT_TIMESTAMP WHERE meeting_agenda_items.source_reason <> excluded.source_reason`).bind(`${row.id}:section:${section.key}`,occurrenceId,section.key,section.title,(index+1)*10000,section.minutes,`${row.id}:${section.key}`,String(revision),section.content)));
  if (mutable && changed) writes.push(database.prepare(`UPDATE meeting_occurrences SET agenda_pdf_key = '' WHERE id = ?`).bind(occurrenceId));
  try { await database.batch(writes); }
  catch (error) { if (/NOT NULL|constraint/i.test(String(error))) throw new TurnoverError("Turnover Sources Changed During Refresh. Retry The Current Packet."); throw error; }
  if (mutable) for (let offset = 0; offset < packet.files.length; offset += 50) await database.batch(packet.files.slice(offset,offset+50).map(file => database.prepare(`INSERT INTO meeting_attachments (id,occurrence_id,name,category,storage_key,content_type,size_bytes,source_type,source_id,source_version,uploaded_by) VALUES (?,?,?,?,?,?,?,'Turnover Source',?,?,'Turnover Automation') ON CONFLICT(id) DO UPDATE SET name = excluded.name,category = excluded.category,storage_key = excluded.storage_key,source_version = excluded.source_version`).bind(`${row.id}:file:${file.id}`,occurrenceId,file.name,file.category,file.storageKey,file.contentType,file.size,file.id,file.revision)));
  await synchronizeTurnoverWork(database,{...row,status},packet);
  return { refreshed:true, refreshedAt:now, revision, frozen:!mutable };
}

async function synchronizeTurnoverWork(database: D1Database, row: Row, packet: TurnoverPacket) {
  await ensureMyWorkTables(); const { getDb } = await import("../db"); const db = getDb();
  const fallback = packet.people.find(p => p.role.includes("Company Owner")) || packet.people[0];
  if (!fallback) return;
  const active: string[] = [];
  const items = [...packet.gaps];
  if (row.status !== "Accepted") items.push({ key:"acceptance", title:`Review and accept turnover: ${packet.title}`, owner:packet.receiverName, blocking:true });
  if (row.meeting_type === OPS_TURNOVER && (row.started_at || row.held_at)) items.push({ key:"buyout", title:`Complete buyout review: ${packet.title}`, owner:packet.receiverName, blocking:false });
  for (const item of items) {
    const person = packet.people.find(p => p.name.toLowerCase() === item.owner.toLowerCase()) || fallback;
    const id = `${row.id}:action:${item.key}`; active.push(id);
    const due = item.key === "buyout" ? `${turnoverBuyoutDate(str(row.started_at || row.held_at),str(row.time_zone))}T21:00:00Z` : str(row.scheduled_start);
    const existing = await database.prepare(`SELECT status,assignee_email,work_item_id FROM meeting_action_items WHERE id = ?`).bind(id).first<Row>();
    // Buyout is human work: a completed review must stay complete on refresh.
    if (item.key === "buyout" && existing && ["Complete","Cancelled With Reason"].includes(str(existing.status))) continue;
    const done = item.key === "buyout" ? "Review all subcontracts, purchase orders, scope gaps and final production budget. Record buyout decisions and outstanding exceptions." : `Resolve the source requirement and verify turnover revision. ${item.title}`;
    await database.prepare(`INSERT INTO meeting_action_items (id,occurrence_id,series_id,project_id,title,definition_of_done,assignee_name,assignee_email,due_at,priority,source_type,source_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'Turnover Requirement',?,'Turnover Automation') ON CONFLICT(id) DO UPDATE SET assignee_name = excluded.assignee_name,assignee_email = excluded.assignee_email,due_at = excluded.due_at,status = CASE WHEN meeting_action_items.status IN ('Complete','Cancelled With Reason') THEN 'Assignment Not Confirmed' ELSE meeting_action_items.status END,completed_at = NULL`).bind(id,row.occurrence_id,row.id,packet.projectId || "MEFFORD-COMPANY",item.title,done,person.name,person.email,due,item.blocking ? "High" : "Normal",item.key).run();
    if (existing?.work_item_id && existing.assignee_email !== person.email) await database.batch([
      database.prepare(`UPDATE command_work_items SET status = 'Completed',completed_at = CURRENT_TIMESTAMP,updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(existing.work_item_id),
      database.prepare(`UPDATE notification_delivery_events SET status = 'Suppressed',deferred_reason = 'Turnover responsibility reassigned',next_attempt_at = NULL WHERE work_item_id = ? AND status IN ('Queued','Deferred','Retry Scheduled')`).bind(existing.work_item_id),
      database.prepare(`UPDATE meeting_action_items SET status = 'Assignment Not Confirmed' WHERE id = ?`).bind(id),
    ]);
    const workKey = `${id}:${person.email.toLowerCase()}`;
    await upsertWorkItem(db,{ dedupeKey:workKey,projectId:packet.projectId || "MEFFORD-COMPANY",recipientName:person.name,recipientEmail:person.email,kind:"Turnover",title:item.title,message:done,priority:item.blocking ? "High" : "Normal",sourceType:"Meeting Action",sourceRecordId:id,actionTarget:str(row.meeting_type),dueAt:due,createdBy:"Turnover Automation" });
    await database.prepare(`UPDATE meeting_action_items SET work_item_id = (SELECT id FROM command_work_items WHERE dedupe_key = ?) WHERE id = ?`).bind(workKey,id).run();
  }
  const stale = await database.prepare(`SELECT id,work_item_id,source_id FROM meeting_action_items WHERE series_id = ? AND source_type = 'Turnover Requirement' AND status NOT IN ('Complete','Cancelled With Reason')`).bind(row.id).all<Row>();
  const now = new Date().toISOString();
  for (const action of stale.results) if (!active.includes(str(action.id)) && action.source_id !== "buyout") await database.batch([
    database.prepare(`UPDATE meeting_action_items SET status = 'Complete',evidence = 'Source requirement resolved by turnover reconciliation',completed_at = ?,updated_at = ? WHERE id = ?`).bind(now,now,action.id),
    database.prepare(`UPDATE command_work_items SET status = 'Completed',completed_at = ?,updated_at = ? WHERE id = ?`).bind(now,now,action.work_item_id),
  ]);
}

export async function turnoverView(occurrenceId: string, actor: MeetingActor): Promise<TurnoverView | null> {
  const { env } = await import("cloudflare:workers"); await ensureTurnoverTables(env.DB);
  const row = await env.DB.prepare(`SELECT t.*,o.held_at,o.started_at,o.scheduled_start,s.time_zone FROM meeting_turnovers t JOIN meeting_occurrences o ON o.id = t.occurrence_id JOIN meeting_series s ON s.id = o.series_id WHERE t.occurrence_id = ?`).bind(occurrenceId).first<Row>();
  if (!row) return null;
  const packet = json<TurnoverPacket>(row.snapshot_json, {} as TurnoverPacket);
  return { id:str(row.id), type:row.meeting_type as TurnoverType,status:str(row.status),revision:Number(row.revision),packet,scheduled:Boolean(row.scheduled_confirmed),
    buyoutDue:row.meeting_type === OPS_TURNOVER ? turnoverBuyoutDate(str(row.started_at || row.held_at || (row.scheduled_confirmed ? row.scheduled_start : "")),str(row.time_zone)) : "",
    reviewed:json<string[]>(row.reviewed_json,[]),acceptedAt:str(row.accepted_at),acceptedBy:str(row.accepted_by),ntpReference:str(row.ntp_reference),
    canAccept:Boolean(packet.receiverEmail && packet.receiverEmail.toLowerCase() === actor.email.toLowerCase()) };
}

export async function changeTurnover(context: Row, actor: MeetingActor, payload: { action:string; expectedRevision?:number; sectionKey?:string; value?:boolean | string | number; startAt?:string; location?:string; reason?:string }) {
  const { env } = await import("cloudflare:workers"); const database = env.DB;
  await refreshTurnoverMeeting(str(context.id));
  const view = await turnoverView(str(context.id),actor);
  if (!view) throw new TurnoverError("Turnover Not Found",404);
  if (payload.expectedRevision !== view.revision) throw new TurnoverError("Source Information Changed. Review The Current Turnover Revision Before Saving.");
  const lead = actor.accessLevel === "Company Owner" || str(context.leader_email).toLowerCase() === actor.email.toLowerCase();
  const now = new Date().toISOString(), writes: D1PreparedStatement[] = [];
  if (payload.action === "turnover_schedule") {
    if (!lead) throw new TurnoverError("Turnover Leader Permission Required",403);
    if (context.started_at) throw new TurnoverError("The Meeting Has Already Started");
    if (!payload.startAt || !Number.isFinite(Date.parse(payload.startAt)) || !payload.location?.trim()) throw new TurnoverError("Enter A Valid Meeting Date And Location",400);
    const start = new Date(payload.startAt).toISOString(), end = new Date(Date.parse(start) + (view.type === SALES_TURNOVER ? 40 : 90) * 60000).toISOString();
    writes.push(database.prepare(`UPDATE meeting_occurrences SET scheduled_start = ?,scheduled_end = ?,publication_hold = 0,publication_hold_reason = '',updated_at = ? WHERE id = ?`).bind(start,end,now,context.id));
    writes.push(database.prepare(`UPDATE meeting_series SET start_at = ?,location = ?,updated_at = ? WHERE id = ?`).bind(start,payload.location.trim(),now,context.series_id));
    writes.push(database.prepare(`UPDATE meeting_turnovers SET scheduled_confirmed = 1,updated_at = ? WHERE id = ?`).bind(now,view.id));
  } else if (payload.action === "turnover_ntp") {
    if (actor.accessLevel !== "Company Owner" || view.type !== OPS_TURNOVER) throw new TurnoverError("Only The Company Owner Can Record NTP Authority",403);
    if (!payload.reason?.trim()) throw new TurnoverError("Record The NTP Document Reference, Date And Authorized Scope",400);
    writes.push(database.prepare(`UPDATE meeting_turnovers SET ntp_reference = ?,updated_at = ? WHERE id = ?`).bind(payload.reason.trim().slice(0,2000),now,view.id));
  } else if (payload.action === "turnover_review") {
    if (!view.canAccept) throw new TurnoverError("The Assigned Receiving Lead Must Review This Packet",403);
    if (!view.packet.sections.some(s => s.key === payload.sectionKey)) throw new TurnoverError("Unknown Turnover Section",400);
    const reviewed = view.reviewed.filter(key => key !== payload.sectionKey);
    if (payload.value === true) reviewed.push(payload.sectionKey!);
    writes.push(database.prepare(`UPDATE meeting_turnovers SET reviewed_json = ?,updated_at = ? WHERE id = ?`).bind(JSON.stringify(reviewed.sort()),now,view.id));
  } else if (payload.action === "turnover_accept") {
    if (!view.canAccept) throw new TurnoverError("Only The Assigned Receiving Lead Can Accept This Turnover",403);
    if (view.type === OPS_TURNOVER) {
      const blockers = await bonusTurnoverBlockers(view.packet.projectId);
      if (blockers.length) throw new TurnoverError(`Bonus Agreement: ${blockers.join("; ")}`);
    }
    if (!view.scheduled || !context.started_at) throw new TurnoverError("Confirm The Date And Hold The Turnover Meeting Before Acceptance");
    if (view.packet.gaps.some(g => g.blocking)) throw new TurnoverError(`Resolve Required Items: ${view.packet.gaps.filter(g => g.blocking).map(g => g.title).join("; ")}`);
    if (view.packet.sections.some(s => !view.reviewed.includes(s.key))) throw new TurnoverError("Review Every Turnover Section Before Acceptance");
    writes.push(database.prepare(`UPDATE meeting_turnovers SET status = 'Accepted',accepted_by = ?,accepted_at = ?,accepted_snapshot_json = snapshot_json,updated_at = ? WHERE id = ?`).bind(actor.email,now,now,view.id));
    if (context.status !== "Finalized/Distributed") writes.push(database.prepare(`INSERT OR IGNORE INTO meeting_decisions (id,occurrence_id,statement,decision_maker_name,decision_maker_email,status,proposed_by,confirmed_by,confirmed_at,evidence) VALUES (?,?,?,?,?,'Confirmed',?,?,?,?)`).bind(`${view.id}:acceptance:R${view.revision}`,context.id,`${actor.name} accepted turnover revision R${view.revision}. Open exceptions retain their assigned owners and due dates.`,actor.name,actor.email,actor.name,actor.email,now,`Permanent turnover packet ${view.id} revision ${view.revision}`));
  } else throw new TurnoverError("Unknown Turnover Action",400);
  // The audit guard and business writes are one transaction. A competing review
  // cannot silently overwrite acceptance of a different source revision.
  const before = await database.prepare(`SELECT updated_at,reviewed_json FROM meeting_turnovers WHERE id = ?`).bind(view.id).first<Row>();
  try {
    await database.batch([
      database.prepare(`INSERT INTO meeting_audits (series_id,occurrence_id,entity_type,entity_id,action,before_json,after_json,reason,actor_name,actor_email) VALUES (?,?,'Turnover Packet',(SELECT id FROM meeting_turnovers WHERE id = ? AND revision = ? AND reviewed_json = ? AND updated_at = ?),?,?,?,?,?,?)`).bind(context.series_id,context.id,view.id,view.revision,JSON.stringify(view.reviewed),before?.updated_at || "",payload.action,JSON.stringify(view),JSON.stringify(payload),payload.reason || "",actor.name,actor.email),
      ...writes,
    ]);
  } catch (error) { if (/NOT NULL|constraint/i.test(String(error))) throw new TurnoverError("Turnover Changed While You Were Saving. Reload And Review Again."); throw error; }
  await refreshTurnoverMeeting(str(context.id));
  return { saved:true };
}

/** Bounded catch-up also covers old awards and a response interrupted after saving. */
export async function reconcileTurnovers(limit = 4) {
  const { env } = await import("cloudflare:workers"); const database = env.DB; await ensureTurnoverTables(database);
  const now = new Date().toISOString(), errors: string[] = [];
  const attempt = async (sourceId: string, run: () => Promise<unknown>) => {
    try { await run(); await database.prepare(`DELETE FROM meeting_turnover_recovery WHERE source_id = ?`).bind(sourceId).run(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Turnover recovery failed";
      errors.push(`${sourceId}: ${message}`);
      await database.prepare(`INSERT INTO meeting_turnover_recovery (source_id,last_error,attempted_at,retry_after) VALUES (?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET last_error = excluded.last_error,attempted_at = excluded.attempted_at,retry_after = excluded.retry_after`).bind(sourceId,message.slice(0,600),now,new Date(Date.now()+300000).toISOString()).run();
    }
  };
  const candidates = await database.prepare(`SELECT r.id,r.data_json,r.status FROM command_records r WHERE r.project_id = 'MEFFORD-SALES' AND r.record_type = 'Sales Opportunities' AND json_valid(r.data_json) AND r.status NOT IN ('Lost','Deleted','Deletion Quarantine') AND NOT EXISTS (SELECT 1 FROM meeting_turnover_recovery f WHERE f.source_id = r.id AND f.retry_after > ?) AND (json_extract(r.data_json,'$.estimatingRequestedAt') IS NOT NULL OR json_extract(r.data_json,'$.stage') IN ('Estimating','Proposal Submitted','Negotiation','Awarded')) AND (NOT EXISTS (SELECT 1 FROM meeting_turnovers t WHERE t.opportunity_id = r.id AND t.meeting_type = ?) OR (COALESCE(json_extract(r.data_json,'$.awardedProjectNumber'),'') <> '' AND NOT EXISTS (SELECT 1 FROM meeting_turnovers t WHERE t.opportunity_id = r.id AND t.meeting_type = ?))) ORDER BY r.updated_at,r.id LIMIT ?`).bind(now,SALES_TURNOVER,OPS_TURNOVER,Math.max(1,Math.min(8,limit))).all<Row>();
  for (const row of candidates.results) {
    const data = obj(row.data_json);
    await attempt(str(row.id),async () => {
      await ensureTurnoverMeeting(SALES_TURNOVER,str(row.id));
      if (str(data.awardedProjectNumber)) await ensureTurnoverMeeting(OPS_TURNOVER,str(row.id),str(data.awardedProjectNumber));
    });
  }
  const queued = await database.prepare(`SELECT occurrence_id FROM meeting_turnovers t WHERE NOT EXISTS (SELECT 1 FROM meeting_turnover_recovery f WHERE f.source_id = t.occurrence_id AND f.retry_after > ?) ORDER BY checked_at,id LIMIT ?`).bind(now,Math.max(1,Math.min(8,limit))).all<Row>();
  for (const row of queued.results) await attempt(str(row.occurrence_id),() => refreshTurnoverMeeting(str(row.occurrence_id)));
  const outstanding = await database.prepare(`SELECT COUNT(*) AS n FROM meeting_turnover_recovery`).first<{ n:number }>();
  return { createdOrRecovered:candidates.results.length,refreshed:queued.results.length,errors,pendingFailures:Number(outstanding?.n || 0) };
}
