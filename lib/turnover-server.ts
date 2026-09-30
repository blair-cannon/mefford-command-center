import { calculateEstimateSummary, calculateEstimateEntry, normalizeEstimateData } from "../app/estimate-template";
import { reconcileBonusProject, bonusTurnoverBlockers } from "./bonus-server";
import { billingObject as obj } from "./owner-billing-authority";
import { loadSalesContracts } from "./sales-contract-server";
import { consolidateOperationsChecklist } from "./turnover-checklist";
import { contractFieldLabel, contractTemplateForStoredVersion, defaultContractInstrument, isScalarMoneyContractField, normalizeOwnerContractType, type OwnerContractInstrument } from "./owner-contracts";
import { normalizeBidPackageData, selectedProposalBid, latestBid, bidderIsLeveled } from "./procurement";
import { ensureMeetingTables, type MeetingActor } from "./meeting-server";
import { ensureMyWorkTables, upsertWorkItem } from "./my-work";
import { OPS_TURNOVER, SALES_TURNOVER, TURNOVER_SECTIONS, turnoverBuyoutDate, turnoverItemId, type TurnoverChecklistItem, type TurnoverType, type TurnoverPacket, type TurnoverView } from "./turnovers";

type Row = Record<string, string | number | null>;
const str = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const label = (value: string) => value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
const lines = (values: Array<[string, unknown]>) => values.map(([key, value]) => `${key}: ${str(value) || "Not recorded"}`).join("\n");
const templateFieldCache = new Map<string, Set<string>>();
async function contractChecklistFields(data: Record<string, unknown>, projectType: unknown) {
  const type = normalizeOwnerContractType(data.contractType || projectType);
  if (!type) return null;
  const active = ["Phase 1 Agreement","GMP Exhibit A","Primary Agreement","External Agreement Mapping"].includes(str(data.activeInstrument)) ? str(data.activeInstrument) as OwnerContractInstrument : defaultContractInstrument(type);
  const instruments: OwnerContractInstrument[] = type === "Design-Build GMP" && active === "GMP Exhibit A" ? ["Phase 1 Agreement",active] : [active];
  const { env } = await import("cloudflare:workers");
  const keys = new Set<string>();
  for (const instrument of instruments) {
    const path = contractTemplateForStoredVersion(type,instrument,str(data.templateVersion)).htmlPath;
    let fields = templateFieldCache.get(path);
    if (!fields) {
      try {
        const response = await env.ASSETS.fetch(new Request(new URL(path,"https://turnover-assets.invalid")));
        if (!response.ok) return null;
        fields = new Set([...(await response.text()).matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(match=>match[1]));
        if (!fields.size) return null;
        templateFieldCache.set(path,fields);
      } catch { return null; }
    }
    for (const key of fields) keys.add(key);
  }
  return keys;
}
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
  const contractKeys = operations ? await contractChecklistFields(contractData,project?.owner_contract_type) : null;
  const contractEntries = Object.entries(fields).filter(([key])=>!contractKeys || contractKeys.has(key));
  const contractValue = (key:string,value:unknown) => isScalarMoneyContractField(key) && str(value) && Number.isFinite(Number(str(value).replace(/[$,]/g,""))) ? money(Number(str(value).replace(/[$,]/g,""))) : value;
  const newest = (a: Row,b: Row) => str(b.updated_at).localeCompare(str(a.updated_at)) || str(a.id).localeCompare(str(b.id));
  const estimateRecord = records.filter(r => r.record_type === "Awarded Estimates").sort(newest)[0]
    || records.filter(r => r.record_type === "Estimate" || r.record_type === "Estimate Cap Sheet").sort(newest)[0];
  const sourceEstimate = operations ? estimateRecord ? obj(estimateRecord.data_json).estimate || obj(estimateRecord.data_json) : undefined : data.estimate;
  const estimate = normalizeEstimateData(sourceEstimate), summary = calculateEstimateSummary(estimate);
  const contactData = obj(contact?.data_json);
  const packages = records.filter(r => r.record_type === "Bid Packages").map(r => ({ row: r, data: normalizeBidPackageData(obj(r.data_json)) }));
  const proposalRecords = records.filter(r => /Owner Proposal|Construction Proposal|Proposal/.test(str(r.record_type))).sort(newest);
  const basisProposal = proposalRecords.find(r => r.status === "Award Basis Of Sale") || proposalRecords.find(r => r.status === "Issued");
  const proposals = operations ? basisProposal ? [basisProposal] : [] : proposalRecords;
  const items: Record<string, TurnoverChecklistItem[]> = {};
  const add = (section: string, key: string, title: string, value: unknown) => (items[section] ||= []).push({ key, title, source: (typeof value === "number" ? new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(value) : str(value)) || "Not Recorded" });
  const fieldsFor = (section: string, values: Array<[string, unknown]>) => values.forEach(([title, value]) => add(section, title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, value));
  const title = str(project?.name) || str(data.projectName) || str(opportunity.title);
  fieldsFor("control", [["Project", title], ["Project Number", projectId || "Pre-Award"], ["Salesperson", data.assignedRep], ["Estimator", data.assignedEstimator], ["Receiving Lead", receiverName], ["Required Participants", people.map(p => `${p.role}: ${p.name}`).join("\n")], ["Handoff Authority", operations ? contract?.signed ? "Executed Owner Contract" : turnover.ntp_reference ? `Recorded NTP: ${turnover.ntp_reference}` : "Award — Pending Signed Contract / NTP" : "Sales Opportunity Entered Estimating"]]);
  fieldsFor("project", [["Owner / Customer", project?.owner_name || data.company], ["Site", project?.site || data.projectLocation || data.projectAddress], ["Owner Contact", contact?.title], ["Contact Email", contactData.email], ["Contact Phone", contactData.phone], ["Architect", project?.architect], ["Project Type", project?.project_type || data.projectType], ["Project Manager", project?.project_manager], ["Site Superintendent", project?.superintendent], ["Start Date", project?.start_date || data.targetStartDate], ["Substantial Completion", project?.substantial_date], ["Final Completion", project?.final_date], ["Estimated Months", estimate.projectInputs.projectDurationMonths || data.durationMonths], ["Bid Due", data.bidDueDate || data.estimateDueDate || opportunity.due]]);
  fieldsFor("commercial", [["Contract Route", project?.owner_contract_type || data.ownerContractType], ["Current Controlled Contract", contract ? money(contract.contractValue) : "Pre-Award"], ["Owner Contract", contract?.status || "Not Awarded"], ["Construction Sales / Billing", contract?.signed ? "Signed Contract Verified" : "Blocked Pending Both Contract Signatures"], ["Customer Budget", data.budget || data.estimatedValue], ["Cap Sheet Total", money(summary.contractValue)], ["Payment Terms", project?.payment_terms], ["Initial Retainage %", project?.retainage_initial_percent], ["Retainage After Halfway %", project?.retainage_after_half_percent]]);
  if (operations) {
    const commercial = items.commercial;
    commercial.find(item => item.key === "current-controlled-contract")!.title = "Current Owner Contract Amount";
    commercial.find(item => item.key === "payment-terms")!.source = str(contractData.paymentTerms || fields.PAYMENT_TERMS || fields.REMAINING_PAYMENT_SCHEDULE || project?.payment_terms) || "Not Recorded";
    add("commercial","retainage","Retainage And Release", fields.CONSTRUCTION_RETAINAGE || fields.RETAINAGE_TERMS_AND_RELEASE || fields.RETAINAGE_TERMS
      || lines([["Initial Percentage",contractData.retainageInitialPercent ?? project?.retainage_initial_percent],["After 50% Completion",contractData.retainageAfterHalfPercent ?? project?.retainage_after_half_percent]]));
  }
  for (const [key, value] of contractEntries.filter(([k,v]) => str(v) && /BOND|RISK|TAX|DPO|RETAIN|LIQUIDATED|PAYROLL|WAGE|MINORITY|WMDBE|FINANC|CHECK|PAYMENT|ALLOWANCE|ALTERNATE|UNIT_PRICE/i.test(k))) add("commercial", `contract:${key}`, contractFieldLabel(key), contractValue(key,value));
  fieldsFor("estimate", [["Estimate Status", estimate.status], ["Direct Job Cost", money(summary.directJobCost)], ["Budget", money(summary.originalBudget)], ["Contractor Fees", money(summary.totalContractorFees)], ["Reconciliation Difference", money(summary.reconciliationDifference)], ["Duration Months", estimate.projectInputs.projectDurationMonths], ["Travel Miles", estimate.projectInputs.distanceToFromJobMiles], ["Building SF", estimate.projectInputs.buildingSquareFeet], ["Estimator Notes", estimate.notes], ["PM Hours", calculateEstimateEntry(estimate,"0131.00","100",{quantity:0,unit:"HR"}).entry.quantity], ["Superintendent Hours", calculateEstimateEntry(estimate,"0131.00","200",{quantity:0,unit:"HR"}).entry.quantity], ["PM Cost / Billable Rate", `${money(estimate.settings.projectManagerCostRate)} / ${money(estimate.settings.projectManagerBillableRate)}`], ["Superintendent Cost / Billable Rate", `${money(estimate.settings.superintendentCostRate)} / ${money(estimate.settings.superintendentBillableRate)}`]]);
  if (operations) {
    items.estimate.find(item => item.key === "budget")!.title = "Approved Cost Budget At Award";
    items.estimate.find(item => item.key === "direct-job-cost")!.title = "Direct Job Cost At Award";
    items.estimate.find(item => item.key === "contractor-fees")!.title = "Contractor Fees At Award";
  }
  for (const row of summary.budgetRollups.filter(r => r.amount !== 0)) add("estimate", `budget:${row.code}`, `${row.code} ${row.description}`, money(row.amount));
  fieldsFor("scope", [["Project Scope", operations ? fields.CONSTRUCTION_SCOPE_OF_WORK || data.projectDescription : data.projectDescription], ["Owner Commitments / Exclusions", data.scopeNotes || data.notes]]);
  for (const {row, data:p} of packages) add("scope", `package:${row.id}`, `${p.costCode} ${p.trade}`, lines(operations ? [["Scope",p.scopeDescription],["Responsibility",p.scopeNature],["Proposal Scope",p.proposalBasis?.ownerScopeDraft]] : [["Scope",p.scopeDescription],["Responsibility",p.scopeNature],["Budget",money(p.budgetAmount)],["Selected Vendor",p.proposalBasis?.vendorName],["Proposal Scope",p.proposalBasis?.ownerScopeDraft]]));
  for (const proposal of proposals) for (const [key,value] of Object.entries(obj(proposal.data_json)).filter(([k,v]) => /scope|inclusion|exclusion|assumption|executiveSummary|projectUnderstanding/i.test(k) && typeof v === "string")) add("scope", `proposal:${proposal.id}:${key}`, `${proposal.title} · ${label(key)}`, value);
  for (const [key,value] of contractEntries.filter(([k,v]) => /SCOPE|EXCLUSION|ASSUMPTION|OWNER.*PROVID|SALVAGE/i.test(k) && str(v))) add("scope", `contract:${key}`, contractFieldLabel(key), value);
  if (operations) {
    const date = str(turnover.started_at || turnover.held_at || (turnover.scheduled_confirmed ? turnover.scheduled_start : ""));
    const due = turnoverBuyoutDate(date,str(turnover.time_zone) || "America/New_York");
    add("buyout", "deadline", "Buyout Deadline", `${due || "Confirm The Meeting Date"}${due && !turnover.started_at && !turnover.held_at ? " (Planned)" : ""}`);
  }
  for (const {row,data:p} of packages) {
    const selected = selectedProposalBid(p);
    add("buyout", `package:${row.id}`, `${p.costCode} ${p.trade} · Buyout Selection`, lines([["Budget",money(p.budgetAmount)],["Selected Vendor",selected ? `${selected.bidder.vendorName} ${money(selected.basis.selectedPrice)}` : "Not Selected"],["Recommendation",p.recommendation?.narrative]]));
    for (const bidder of p.bidders) {
      const bid = latestBid(bidder); if (!bid) continue;
      add("buyout", `quote:${row.id}:${bidder.vendorId}`, `${p.trade} · ${bidder.vendorName}`, lines([["Quoted Price",money(Number(bid.ocr?.reviewedPrice ?? bid.total))],["Scope Review",bidderIsLeveled(bidder) ? "Scope Leveled" : "Review Required"],["Exclusions",bid.exclusions],["Lead Time",bid.schedule]]));
    }
  }
  if (!packages.length) add("buyout", "coverage", "Subcontract And Vendor Coverage", "No Bid Packages Recorded. Confirm Self-Perform / Owner-Provided Scopes Or Complete Subcontract Coverage.");
  for (const file of fileResult.results.filter(f => f.category !== "Turnover Bonus Agreement")) add("documents", `file:${file.id}`, str(file.name), `${file.category} · ${file.revision} · ${file.created_at}`);
  if (!items.documents?.length) add("documents", "pricing-basis", "Drawings, Specifications And Addenda", "No Source Documents Recorded");
  const riskRecords = records.filter(r => /Risk|Schedule|RFI|Selection|Submittal|Owner Billing|Change Order|Safety|Quality|Design/.test(str(r.record_type)) && !/^(Closed|Complete|Completed|Paid|Void|Voided|Cancelled|Resolved)$/i.test(str(r.status)));
  for (const row of riskRecords) add("risks", `record:${row.record_type}:${row.id}`, `${row.record_type} · ${row.title}`, `${row.status} · ${row.owner} · Due ${row.due}\n${lines(Object.entries(obj(row.data_json)).filter(([k,v]) => /risk|impact|mitigation|blocker|leadTime|reason|notes/i.test(k) && typeof v === "string"))}`);
  for (const category of ["Cost", "Schedule", "Design", "Owner", "Subcontractor", "Safety", "Logistics"]) add("risks", `review:${category.toLowerCase()}`, `${category} Risks`, "");
  fieldsFor("setup", [["System Of Record", "Command Center"], ["Controlled Contract", project?.owner_contract_record_id], ["Budget Lines", summary.budgetRollups.filter(r => r.amount).length], ["Source Opportunity", opportunityId], ["Project Participants", people.map(p => p.name).join(", ")]]);
  for (const row of records.filter(r => /Subcontracts|Purchase Orders|Owner Billing Setup/.test(str(r.record_type)))) add("setup", `record:${row.record_type}:${row.id}`, `${row.record_type} · ${row.title}`, row.status);
  add("actions", "assignments", "Assignments, Owners And Due Dates", "Open Turnover Requirements And Meeting Assignments Are Tracked In Decisions & Actions And My Work.");
  for (const name of ["Primary Project Challenge", "Cost Risk", "Schedule Risk", "Field / Logistics Risk", "Owner Priorities", "Meeting Decisions"]) add("recap", name.toLowerCase().replace(/[^a-z0-9]+/g,"-"), name, "");
  if (operations) consolidateOperationsChecklist(items);
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
    sections: TURNOVER_SECTIONS[turnover.meeting_type as TurnoverType].map(s => ({ ...s, content: (items[s.key] || []).map(item => `${item.title}: ${item.source}`).join("\n"), items: items[s.key] || [] })) };
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
  if (row.meeting_status === "Finalized/Distributed") return { refreshed:false, revision:Number(row.revision), frozen:true };
  if (row.meeting_type === OPS_TURNOVER) await reconcileBonusProject(str(row.project_id),occurrenceId);
  const packet = await packetFor(database,row), snapshot = JSON.stringify(packet), now = new Date().toISOString();
  const changed = snapshot !== row.snapshot_json;
  const revision = Number(row.revision) + (changed ? 1 : 0);
  const status = changed && row.accepted_at ? "Changes Require Review" : row.status === "Accepted" || row.status === "Changes Require Review" ? row.status : packet.gaps.some(g => g.blocking) ? "Preparation" : "Ready For Review";
  const mutable = ["Draft Agenda","Published Agenda","Meeting In Progress","Draft Minutes"].includes(str(row.meeting_status));
  const writes: D1PreparedStatement[] = [];
  if (changed) writes.push(database.prepare(`INSERT INTO meeting_audits (series_id,occurrence_id,entity_type,entity_id,action,before_json,after_json,actor_name,actor_email) VALUES (?,?,'Turnover Packet',(SELECT id FROM meeting_turnovers WHERE id = ? AND revision = ? AND snapshot_json = ?),'Source Revision Refreshed',?,?,'Turnover Automation','system@meffcon.com')`).bind(row.id,occurrenceId,row.id,row.revision,row.snapshot_json,JSON.stringify({revision:row.revision}),JSON.stringify({revision,packet})));
  writes.push(database.prepare(`UPDATE meeting_turnovers SET snapshot_json = ?,revision = ?,status = ?,reviewed_json = CASE WHEN snapshot_json <> ? THEN '[]' ELSE reviewed_json END,checked_at = ?,updated_at = CASE WHEN snapshot_json <> ? THEN ? ELSE updated_at END WHERE id = ? AND revision = ?`).bind(snapshot,revision,status,snapshot,now,snapshot,now,row.id,row.revision));
  if (changed) {
    const lead = packet.people.find(p => p.email === packet.receiverEmail) || packet.people.find(p => p.role.includes("Company Owner")) || packet.people[0];
    if (lead) writes.push(database.prepare(`UPDATE meeting_series SET leader_name = ?,leader_email = ?,title = ?,updated_at = ? WHERE id = ?`).bind(lead.name,lead.email,`${packet.title} · ${row.meeting_type}`,now,row.id));
    for (const person of packet.people) writes.push(database.prepare(`INSERT INTO meeting_attendees (id,occurrence_id,name,email,attendee_role) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM meeting_attendees WHERE occurrence_id = ? AND email = ? AND id <> ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,attendee_role = excluded.attendee_role`).bind(`${row.id}:person:${person.email}`,occurrenceId,person.name,person.email,person.role,occurrenceId,person.email,`${row.id}:person:${person.email}`));
    writes.push(database.prepare(`DELETE FROM meeting_attendees WHERE occurrence_id = ? AND substr(id,1,?) = ? AND email NOT IN (SELECT value FROM json_each(?))`).bind(occurrenceId,`${row.id}:person:`.length,`${row.id}:person:`,JSON.stringify(packet.people.map(p=>p.email))));
  }
  if (mutable) {
    // Keep prior section notes readable. Never copy one group completion onto
    // its new individual checklist items or discard a removed item's history.
    writes.push(database.prepare(`UPDATE meeting_agenda_items SET source_type = 'Turnover Section Notes',title = 'Previous Section Notes',source_reason = '',status = CASE WHEN trim(notes) = '' THEN 'Superseded' ELSE status END,updated_at = ? WHERE occurrence_id = ? AND source_type = 'Turnover Source'`).bind(now,occurrenceId));
    const ids: string[] = [];
    const retiredAliases: string[] = [];
    packet.sections.forEach((section,index) => (section.items || []).forEach((item,itemIndex) => {
      const id = turnoverItemId(str(row.id),section.key,item.key); ids.push(id);
      writes.push(database.prepare(`INSERT INTO meeting_agenda_items (id,occurrence_id,section_key,title,position,timebox_minutes,source_type,source_id,source_version,source_reason,created_by,updated_at) VALUES (?,?,?,?,?,0,'Turnover Checklist',?,?,?,'Turnover Automation',?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title,position = excluded.position,source_version = excluded.source_version,source_reason = excluded.source_reason,
        status = CASE WHEN meeting_agenda_items.source_reason <> excluded.source_reason OR meeting_agenda_items.title <> excluded.title OR meeting_agenda_items.status = 'Superseded' THEN 'Open' ELSE meeting_agenda_items.status END,
        updated_at = CASE WHEN meeting_agenda_items.source_reason <> excluded.source_reason OR meeting_agenda_items.title <> excluded.title OR meeting_agenda_items.status = 'Superseded' THEN excluded.updated_at ELSE meeting_agenda_items.updated_at END`)
        .bind(id,occurrenceId,section.key,item.title,(index+1)*10000+itemIndex+1,item.key,String(revision),item.source,now));
      const aliases = (item.replaces || []).map(prior => turnoverItemId(str(row.id),prior.section,prior.key));
      if (aliases.length) {
        retiredAliases.push(...aliases);
        // Read notes inside the atomic batch, so a concurrent editor's latest
        // text is preserved. Retiring the aliases makes this merge idempotent.
        const priorNotes = `SELECT '[' || title || ']' || char(10) || notes AS text FROM meeting_agenda_items WHERE occurrence_id = ? AND id IN (SELECT value FROM json_each(?)) AND status <> 'Superseded' AND trim(notes) <> '' ORDER BY position,id`;
        writes.push(database.prepare(`UPDATE meeting_agenda_items SET notes = CASE WHEN trim(notes) = '' THEN '' ELSE notes || char(10) || char(10) END || (SELECT group_concat(text,char(10) || char(10)) FROM (${priorNotes})),status = 'Open',updated_at = ? WHERE id = ? AND EXISTS (${priorNotes})`).bind(occurrenceId,JSON.stringify(aliases),now,id,occurrenceId,JSON.stringify(aliases)));
      }
    }));
    if (retiredAliases.length) writes.push(database.prepare(`UPDATE meeting_agenda_items SET status = 'Superseded',updated_at = ? WHERE occurrence_id = ? AND id IN (SELECT value FROM json_each(?)) AND status <> 'Superseded'`).bind(now,occurrenceId,JSON.stringify(retiredAliases)));
    // Historical sales figures and retired source documents may have notes with
    // no equivalent current item. Keep those visible once, without stale facts.
    for (const [index,section] of packet.sections.entries()) {
      const priorNotes = `SELECT '[' || title || ']' || char(10) || notes AS text FROM meeting_agenda_items WHERE occurrence_id = ? AND section_key = ? AND source_type = 'Turnover Checklist' AND status <> 'Superseded' AND id NOT IN (SELECT value FROM json_each(?)) AND trim(notes) <> '' ORDER BY position,id`;
      writes.push(database.prepare(`INSERT INTO meeting_agenda_items (id,occurrence_id,section_key,title,position,timebox_minutes,source_type,source_reason,notes,created_by,updated_at)
        SELECT ?,?,?,'Previous Item Notes',?,0,'Turnover Section Notes','',(SELECT group_concat(text,char(10) || char(10)) FROM (${priorNotes})),'Turnover Automation',? WHERE EXISTS (${priorNotes})
        ON CONFLICT(id) DO UPDATE SET notes = CASE WHEN trim(meeting_agenda_items.notes) = '' THEN excluded.notes ELSE meeting_agenda_items.notes || char(10) || char(10) || excluded.notes END,status = 'Open',updated_at = excluded.updated_at`)
        .bind(`${row.id}:previous-item-notes:${section.key}`,occurrenceId,section.key,(index+1)*10000+9999,occurrenceId,section.key,JSON.stringify(ids),now,occurrenceId,section.key,JSON.stringify(ids)));
    }
    writes.push(database.prepare(`UPDATE meeting_agenda_items SET status = 'Superseded',updated_at = ? WHERE occurrence_id = ? AND source_type = 'Turnover Checklist' AND status <> 'Superseded' AND id NOT IN (SELECT value FROM json_each(?))`).bind(now,occurrenceId,JSON.stringify(ids)));
  }
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
  const expected = packet.sections?.flatMap(section => (section.items || []).map(item => turnoverItemId(str(row.id),section.key,item.key))) || [];
  const checklist = expected.length ? (await env.DB.prepare(`SELECT id,status FROM meeting_agenda_items WHERE occurrence_id = ? AND source_type = 'Turnover Checklist'`).bind(occurrenceId).all<Row>()).results : [];
  return { id:str(row.id), type:row.meeting_type as TurnoverType,status:str(row.status),revision:Number(row.revision),packet,scheduled:Boolean(row.scheduled_confirmed),
    buyoutDue:row.meeting_type === OPS_TURNOVER ? turnoverBuyoutDate(str(row.started_at || row.held_at || (row.scheduled_confirmed ? row.scheduled_start : "")),str(row.time_zone)) : "",
    reviewed:json<string[]>(row.reviewed_json,[]),acceptedAt:str(row.accepted_at),acceptedBy:str(row.accepted_by),ntpReference:str(row.ntp_reference),
    canAccept:Boolean(packet.receiverEmail && packet.receiverEmail.toLowerCase() === actor.email.toLowerCase()), updatedAt:str(row.updated_at),
    ...(expected.length ? { checklist: { total:expected.length, completed:expected.filter(id => checklist.some(item => item.id === id && item.status === 'Complete')).length } } : {}) };
}

export async function changeTurnover(context: Row, actor: MeetingActor, payload: { action:string; expectedRevision?:number; sectionKey?:string; value?:boolean | string | number; startAt?:string; location?:string; reason?:string; entityId?:string; expectedVersion?:string; notes?:string; status?:string }) {
  const { env } = await import("cloudflare:workers"); const database = env.DB;
  if (context.status === "Finalized/Distributed") throw new TurnoverError("Finalized Turnover Records Are Locked");
  await refreshTurnoverMeeting(str(context.id));
  const view = await turnoverView(str(context.id),actor);
  if (!view) throw new TurnoverError("Turnover Not Found",404);
  if (payload.expectedRevision !== view.revision) throw new TurnoverError("Source Information Changed. Review The Current Turnover Revision Before Saving.");
  const lead = actor.accessLevel === "Company Owner" || str(context.leader_email).toLowerCase() === actor.email.toLowerCase();
  const now = new Date().toISOString(), writes: D1PreparedStatement[] = [];
  let itemGuard = "", itemBindings: string[] = [];
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
  } else if (payload.action === "turnover_item") {
    if (!lead && !view.canAccept) throw new TurnoverError("The Meeting Leader Or Receiving Lead Must Update The Checklist",403);
    if (view.status === "Accepted") throw new TurnoverError("This Turnover Has Been Accepted. Its Checklist Is Locked Until Source Information Changes.");
    const item = await database.prepare(`SELECT * FROM meeting_agenda_items WHERE id = ? AND occurrence_id = ? AND source_type = 'Turnover Checklist' AND status <> 'Superseded'`).bind(payload.entityId || "",context.id).first<Row>();
    if (!item) throw new TurnoverError("Turnover Checklist Item Not Found",404);
    if (!payload.expectedVersion || payload.expectedVersion !== item.updated_at) throw new TurnoverError("This Checklist Item Changed. Your Notes Are Kept; Reload The Saved Item Before Trying Again.");
    if (!["Open","Complete"].includes(payload.status || "") || typeof payload.notes !== "string" || payload.notes.length > 20000) throw new TurnoverError("A Checklist Status And Notes Of At Most 20,000 Characters Are Required",400);
    itemGuard = " AND EXISTS (SELECT 1 FROM meeting_agenda_items WHERE id = ? AND occurrence_id = ? AND updated_at = ?)";
    itemBindings = [str(item.id),str(context.id),payload.expectedVersion];
    writes.push(database.prepare(`UPDATE meeting_agenda_items SET notes = ?,status = ?,updated_at = ? WHERE id = ? AND occurrence_id = ?`).bind(payload.notes,payload.status,now,item.id,context.id));
    writes.push(database.prepare(`UPDATE meeting_turnovers SET updated_at = ? WHERE id = ?`).bind(now,view.id));
    writes.push(database.prepare(`UPDATE meeting_occurrences SET agenda_pdf_key = '' WHERE id = ?`).bind(context.id));
  } else if (payload.action === "turnover_review") {
    if (!view.canAccept) throw new TurnoverError("The Assigned Receiving Lead Must Review This Packet",403);
    if (view.checklist) throw new TurnoverError("Complete Each Dedicated Checklist Item Before Acceptance");
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
    if (view.checklist ? view.checklist.completed !== view.checklist.total : view.packet.sections.some(s => !view.reviewed.includes(s.key))) throw new TurnoverError("Complete Every Turnover Checklist Item Before Acceptance");
    const checklist = (await database.prepare(`SELECT id,section_key,title,source_reason,status,notes FROM meeting_agenda_items WHERE occurrence_id = ? AND source_type = 'Turnover Checklist' AND status <> 'Superseded' ORDER BY position`).bind(context.id).all<Row>()).results;
    writes.push(database.prepare(`UPDATE meeting_turnovers SET status = 'Accepted',accepted_by = ?,accepted_at = ?,accepted_snapshot_json = ?,updated_at = ? WHERE id = ?`).bind(actor.email,now,JSON.stringify({...view.packet,checklist}),now,view.id));
    if (context.status !== "Finalized/Distributed") writes.push(database.prepare(`INSERT OR IGNORE INTO meeting_decisions (id,occurrence_id,statement,decision_maker_name,decision_maker_email,status,proposed_by,confirmed_by,confirmed_at,evidence) VALUES (?,?,?,?,?,'Confirmed',?,?,?,?)`).bind(`${view.id}:acceptance:R${view.revision}`,context.id,`${actor.name} accepted turnover revision R${view.revision}. Open exceptions retain their assigned owners and due dates.`,actor.name,actor.email,actor.name,actor.email,now,`Permanent turnover packet ${view.id} revision ${view.revision}`));
  } else throw new TurnoverError("Unknown Turnover Action",400);
  // The audit guard and business writes are one transaction. A competing review
  // cannot silently overwrite acceptance of a different source revision.
  try {
    await database.batch([
      database.prepare(`INSERT INTO meeting_audits (series_id,occurrence_id,entity_type,entity_id,action,before_json,after_json,reason,actor_name,actor_email) VALUES (?,?,'Turnover Packet',(SELECT id FROM meeting_turnovers WHERE id = ? AND revision = ? AND reviewed_json = ? AND updated_at = ?${itemGuard}),?,?,?,?,?,?)`).bind(context.series_id,context.id,view.id,view.revision,JSON.stringify(view.reviewed),view.updatedAt,...itemBindings,payload.action,JSON.stringify(view),JSON.stringify(payload),payload.reason || "",actor.name,actor.email),
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
