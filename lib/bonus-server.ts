import { calculateEstimateSummary, normalizeEstimateData } from "../app/estimate-template";
import { billingObject } from "./owner-billing-authority";
import { BONUS_TEMPLATE_SHA256 } from "./bonus-template";
import { bonusPdf } from "./bonus-pdf";
import { BONUS_CONSENT, BONUS_FILE_CATEGORY, BONUS_TIERS, bonusMissing, bonusPayoutMonth, bonusTier, validBonusDate, type BonusSnapshot, type BonusSignature, type BonusView, type BonusAgreementView } from "./project-bonuses";
import type { CommandActor } from "./server-actor";
import { ensureMyWorkTables, upsertWorkItem } from "./my-work";

type Row=Record<string,string|number|null>;
const parse=<T>(s:unknown):T=>JSON.parse(String(s));
const str=(s:unknown)=>String(s||"");
export class BonusError extends Error { status:number; constructor(message:string,status=409){super(message);this.status=status;} }
async function database(){return (await import("cloudflare:workers")).env.DB;}
export async function bonusHash(value:string|Uint8Array){ const bytes=typeof value==="string"?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as BufferSource))].map(b=>b.toString(16).padStart(2,"0")).join(""); }

async function bonusSource(projectId:string) {
  const db=await database();
  const [project,estimate,members] = await Promise.all([
    db.prepare("SELECT * FROM projects WHERE number = ?").bind(projectId).first<Row>(),
    db.prepare("SELECT data_json,updated_at FROM command_records WHERE project_id = ? AND record_type = 'Awarded Estimates' ORDER BY updated_at DESC,id LIMIT 1").bind(projectId).first<Row>(),
    db.prepare("SELECT display_name,email FROM company_members WHERE is_active = 1 ORDER BY email").all<Row>(),
  ]);
  if(!project || /Deleted|Quarantine/.test(str(project.status))) throw new BonusError("Project unavailable",404);
  const resolve=(name:string)=>{const matches=members.results.filter(m=>[str(m.display_name).toLowerCase(),str(m.email).toLowerCase()].includes(name.toLowerCase()));return {name:matches.length===1?str(matches[0].display_name):name,email:matches.length===1?str(matches[0].email):""};};
  const data=billingObject(estimate?.data_json),budget=estimate?calculateEstimateSummary(normalizeEstimateData(data.estimate||data)).originalBudget:0;
  return {projectId,projectName:str(project.name),budget,budgetSource:"Awarded estimate approved cost budget",finalDate:str(project.final_date),pm:resolve(str(project.project_manager)),superintendent:resolve(str(project.superintendent)),estimateVersion:str(estimate?.updated_at)};
}
type Source=Awaited<ReturnType<typeof bonusSource>>;
function snapshotFor(source:Source,reason="",effectiveDate=new Date().toISOString().slice(0,10),tierOverride?:number):BonusSnapshot {
  const tier=tierOverride??bonusTier(source.budget),amounts=BONUS_TIERS[tier];
  return {...source,tier,pmBonus:amounts?.pm||0,superintendentBonus:amounts?.superintendent||0,supplementaryBonus:amounts?.supplementary||0,payoutMonth:bonusPayoutMonth(source.finalDate),templateHash:BONUS_TEMPLATE_SHA256,reason,effectiveDate};
}
function viewRow(row:Row):BonusAgreementView {return {id:str(row.id),revision:Number(row.revision),version:Number(row.version),snapshot:parse<BonusSnapshot>(row.snapshot_json),hash:str(row.content_hash),signatures:{pm:parse<BonusSignature|null>(row.pm_signature_json),superintendent:parse<BonusSignature|null>(row.superintendent_signature_json)},fileId:Number(row.file_id),createdAt:str(row.created_at)};}

async function currentRows(projectId:string) {
  const db=await database(),control=await db.prepare("SELECT * FROM project_bonus_controls WHERE project_id = ?").bind(projectId).first<Row>();
  const current=control?await db.prepare("SELECT * FROM project_bonus_agreements WHERE id = ?").bind(control.current_id).first<Row>():null;
  return {db,control,current};
}
async function createRevision(projectId:string,occurrenceId:string,source:Source,snapshot:BonusSnapshot,actorEmail:string,prior:Row|null,control:Row|null,extra:D1PreparedStatement[]=[]) {
  const db=await database(),revision=Number(control?.revision||0)+1,id=`bonus:${projectId}:${revision}`,now=new Date().toISOString();
  const json=JSON.stringify(snapshot),hash=await bonusHash(json);
  const writes:D1PreparedStatement[]=[];
  if(prior) writes.push(guard(db,prior,"Revision created",actorEmail,{reason:snapshot.reason}));
  writes.push(db.prepare("INSERT INTO project_bonus_agreements (id,project_id,revision,snapshot_json,source_json,content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,projectId,revision,json,JSON.stringify(source),hash,now,now));
  writes.push(db.prepare("INSERT INTO project_bonus_controls (project_id,current_id,revision,occurrence_id,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET current_id=excluded.current_id,revision=excluded.revision,updated_at=excluded.updated_at").bind(projectId,id,revision,occurrenceId,now));
  writes.push(...extra);
  try{await db.batch(writes);}catch(e){if(/constraint|UNIQUE|NOT NULL/i.test(String(e)))throw new BonusError("Agreement changed. Reload the current revision.");throw e;}
}
function guard(db:D1Database,row:Row,action:string,actorEmail:string,detail:unknown,source?:Source) {
  // Null agreement_id aborts the entire batch on a competing signature/revision.
  const condition=source?" AND EXISTS (SELECT 1 FROM projects p WHERE p.number=a.project_id AND p.name=? AND p.final_date=? AND lower(p.project_manager) IN (lower(?),lower(?)) AND lower(p.superintendent) IN (lower(?),lower(?))) AND EXISTS (SELECT 1 FROM company_members WHERE email=? AND is_active=1) AND COALESCE((SELECT updated_at FROM command_records WHERE project_id=a.project_id AND record_type='Awarded Estimates' ORDER BY updated_at DESC,id LIMIT 1),'')=?":"";
  return db.prepare(`INSERT INTO project_bonus_audits (id,agreement_id,action,actor_email,detail_json,created_at) VALUES (?,(SELECT a.id FROM project_bonus_agreements a JOIN project_bonus_controls c ON c.current_id=a.id WHERE a.id=? AND a.version=?${condition}),?,?,?,?)`).bind(crypto.randomUUID(),row.id,row.version,...(source?[source.projectName,source.finalDate,source.pm.name,source.pm.email,source.superintendent.name,source.superintendent.email,actorEmail,source.estimateVersion]:[]),action,actorEmail,JSON.stringify(detail),new Date().toISOString());
}

export async function reconcileBonusProject(projectId:string,occurrenceId:string) {
  const {db,control,current}=await currentRows(projectId),source=await bonusSource(projectId);
  if(!current) await createRevision(projectId,occurrenceId,source,snapshotFor(source),"system@meffcon.com",null,null);
  else if(!control?.closeout_at && current.pm_signature_json==="null" && current.superintendent_signature_json==="null" && !parse<BonusSnapshot>(current.snapshot_json).reason && current.source_json!==JSON.stringify(source)) {
    await createRevision(projectId,occurrenceId,source,snapshotFor(source),"system@meffcon.com",current,control);
  }
  // Recover a closeout that predates this feature or a stopped request. The controlled authorization is the source.
  await db.prepare("UPDATE project_bonus_controls SET closeout_at=COALESCE((SELECT json_extract(data_json,'$.totalCloseout.at') FROM command_records WHERE project_id=? AND id='CLOSEOUT-CONTROL' AND status='Closed' AND json_valid(data_json) AND json_extract(data_json,'$.totalCloseout.authorized')=1),''),payment_status='Review Required' WHERE project_id=? AND closeout_at='' AND EXISTS (SELECT 1 FROM command_records WHERE project_id=? AND id='CLOSEOUT-CONTROL' AND status='Closed' AND json_valid(data_json) AND json_extract(data_json,'$.totalCloseout.authorized')=1)").bind(projectId,projectId,projectId).run();
  await synchronizeBonusWork(projectId);
}

export async function bonusView(projectId:string,actor:CommandActor):Promise<BonusView|null> {
  const db=await database(),turnover=await db.prepare("SELECT occurrence_id FROM meeting_turnovers WHERE project_id=? AND meeting_type='Estimating To Operations Turnover'").bind(projectId).first<Row>();
  if(!turnover)return null;
  await reconcileBonusProject(projectId,str(turnover.occurrence_id));
  const {control,current}=await currentRows(projectId);if(!current||!control)return null;
  const [source,meeting,history,members]=await Promise.all([
    bonusSource(projectId),db.prepare("SELECT status FROM meeting_occurrences WHERE id=?").bind(control.occurrence_id).first<Row>(),
    db.prepare("SELECT * FROM project_bonus_agreements WHERE project_id=? ORDER BY revision DESC").bind(projectId).all<Row>(),
    actor.accessLevel==="Company Owner"?db.prepare("SELECT display_name AS name,email FROM company_members WHERE is_active=1 ORDER BY display_name,email").all<{name:string;email:string}>():Promise.resolve({results:[]}),
  ]);
  const value=viewRow(current),sourceChanged=current.source_json!==JSON.stringify(source);
  const role=value.snapshot.pm.email===actor.email?"pm":value.snapshot.superintendent.email===actor.email?"superintendent":"";
  return {projectId,current:value,suggested:snapshotFor(source),history:history.results.filter(r=>r.id!==current.id).map(viewRow),sourceChanged,missing:bonusMissing(value.snapshot),canManage:actor.accessLevel==="Company Owner",canSign:role&&!value.signatures[role]?role:"",meetingActive:meeting?.status==="Meeting In Progress",canStartReplacement:actor.accessLevel==="Company Owner"&&!control.closeout_at&&!(value.signatures.pm&&value.signatures.superintendent)&&meeting?.status!=="Meeting In Progress"&&(["Draft Minutes","Finalized/Distributed"].includes(str(meeting?.status))||history.results.some(r=>r.id!==current.id&&(r.pm_signature_json!=="null"||r.superintendent_signature_json!=="null"))),closeoutAt:str(control.closeout_at),paymentStatus:str(control.payment_status),employees:members.results};
}

export async function bonusTurnoverBlockers(projectId:string) {
  const {control,current}=await currentRows(projectId);
  if(!current)return ["Prepare the project bonus agreement"];
  const changed=current.source_json!==JSON.stringify(await bonusSource(projectId));
  return [...bonusMissing(parse<BonusSnapshot>(current.snapshot_json)),...(changed?["Update the bonus agreement for the current project team and baseline"]:[]),...(current.pm_signature_json==="null"?["PM bonus agreement signature"]:[]),...(current.superintendent_signature_json==="null"?["Site superintendent bonus agreement signature"]:[]),...(!control? ["Bonus agreement control missing"]:[])];
}

export async function bonusDocument(row:BonusAgreementView) {
  const {env}=await import("cloudflare:workers"),images:Partial<Record<"pm"|"superintendent",Uint8Array>>={};
  for(const role of ["pm","superintendent"] as const) {const signature=row.signatures[role];if(signature){const object=await env.BUCKET.get(signature.imageKey);if(!object)throw new BonusError("A signature image is unavailable. Restore the project file before continuing.");images[role]=new Uint8Array(await object.arrayBuffer());}}
  return bonusPdf(row.snapshot,row.revision,row.hash,row.signatures,images);
}

export async function changeBonus(projectId:string,actor:CommandActor,input:Record<string,unknown>) {
  const {db,control,current}=await currentRows(projectId);
  if(!current||!control)throw new BonusError("Operations turnover not found",404);
  if(input.id!==current.id||Number(input.version)!==Number(current.version))throw new BonusError("Agreement changed. Reload and review the current revision.");
  const now=new Date().toISOString(),source=await bonusSource(projectId),value=viewRow(current);
  if(input.action==="start-replacement") {
    if(actor.accessLevel!=="Company Owner")throw new BonusError("Company Owner permission required",403);
    const view=await bonusView(projectId,actor);if(!view?.canStartReplacement)throw new BonusError("A replacement agreement with prior signatures is required");
    if(view.sourceChanged||view.missing.length)throw new BonusError("Resolve the current agreement fields and project assignments first");
    const original=await db.prepare("SELECT o.series_id,o.meeting_number FROM meeting_occurrences o WHERE o.id=?").bind(control.occurrence_id).first<Row>();
    if(!original)throw new BonusError("Original turnover meeting unavailable");
    const id=`${current.id}:replacement-meeting`,end=new Date(Date.now()+3600000).toISOString();
    await db.batch([
      guard(db,current,"Replacement turnover started",actor.email,{at:now,meetingId:id}),
      db.prepare("INSERT INTO meeting_occurrences (id,series_id,meeting_number,status,scheduled_start,scheduled_end,started_at,recording_enabled,publication_hold) VALUES (?,?,?,'Meeting In Progress',?,?,?,0,0)").bind(id,original.series_id,`BR-${projectId}-${current.revision}`,now,end,now),
      ...[value.snapshot.pm,value.snapshot.superintendent,{name:actor.name,email:actor.email}].map(p=>db.prepare("INSERT OR IGNORE INTO meeting_attendees (id,occurrence_id,name,email,attendee_role) VALUES (?,?,?,?,?)").bind(`${id}:${p.email}`,id,p.name,p.email,p.email===value.snapshot.pm.email?"Project Manager":p.email===value.snapshot.superintendent.email?"Site Superintendent":"Company Owner")),
      db.prepare("INSERT INTO meeting_agenda_items (id,occurrence_id,section_key,title,position,timebox_minutes,source_type,source_id,source_reason,created_by) VALUES (?,?,'recap','Replacement employee turnover and bonus agreement',10000,30,'Bonus Agreement',?,?,?)").bind(`${id}:agreement`,id,current.id,`Review project responsibilities, approved budget, completion date and bonus agreement R${current.revision}. Record outstanding handoff issues and obtain both employee signatures.`,actor.name),
      db.prepare("UPDATE project_bonus_controls SET occurrence_id=?,updated_at=? WHERE project_id=?").bind(id,now,projectId),
      db.prepare("UPDATE project_bonus_agreements SET version=version+1,updated_at=? WHERE id=?").bind(now,current.id),
    ]);
  } else if(input.action==="revise") {
    if(actor.accessLevel!=="Company Owner")throw new BonusError("Company Owner permission required",403);
    if(control.closeout_at)throw new BonusError("Closed project agreements are retained for payment review and cannot be replaced.");
    const reason=str(input.reason).trim(),effectiveDate=str(input.effectiveDate);
    if(reason.length<10||reason.length>1500||!validBonusDate(effectiveDate))throw new BonusError("Enter an effective date and a specific revision reason (10–1500 characters).",400);
    const extra:D1PreparedStatement[]=[];
    for(const role of ["pm","superintendent"] as const) if(input[`${role}Email`]) {
      const member=await db.prepare("SELECT display_name,email FROM company_members WHERE is_active=1 AND lower(email)=?").bind(str(input[`${role}Email`]).toLowerCase()).first<Row>();
      if(!member)throw new BonusError("Select an active employee",400);
      source[role]={name:str(member.display_name),email:str(member.email)};
      const duplicates=await db.prepare("SELECT COUNT(*) AS n FROM company_members WHERE is_active=1 AND lower(display_name)=lower(?)").bind(member.display_name).first<{n:number}>();
      if(duplicates?.n!==1)throw new BonusError("Employee names must be unique for the project assignment. Resolve the duplicate in People first.",400);
      extra.push(db.prepare(`UPDATE projects SET ${role==="pm"?"project_manager":"superintendent"}=?,updated_at=? WHERE number=?`).bind(member.display_name,now,projectId));
    }
    const tier=input.tier===undefined?undefined:Number(input.tier);
    if(tier!==undefined&&(!Number.isInteger(tier)||!BONUS_TIERS[tier]))throw new BonusError("Choose a valid bonus tier",400);
    const snapshot=snapshotFor(source,reason,effectiveDate,tier);
    if(input.budget!==undefined) {const n=Number(input.budget);if(!Number.isFinite(n)||n<=0||n>1e12)throw new BonusError("Enter a positive approved project budget",400);snapshot.budget=Math.round(n*100)/100;snapshot.budgetSource="Company Owner approved turnover budget";const selected=tier??bonusTier(snapshot.budget);Object.assign(snapshot,{tier:selected,pmBonus:BONUS_TIERS[selected]?.pm||0,superintendentBonus:BONUS_TIERS[selected]?.superintendent||0,supplementaryBonus:BONUS_TIERS[selected]?.supplementary||0});}
    if(input.finalDate!==undefined){if(!validBonusDate(str(input.finalDate)))throw new BonusError("Enter a valid final completion date",400);snapshot.finalDate=str(input.finalDate);snapshot.payoutMonth=bonusPayoutMonth(snapshot.finalDate);extra.push(db.prepare("UPDATE projects SET final_date=?,updated_at=? WHERE number=?").bind(snapshot.finalDate,now,projectId));source.finalDate=snapshot.finalDate;}
    if(snapshot.pm.email===snapshot.superintendent.email&&snapshot.pm.email)throw new BonusError("Assign separate PM and superintendent signers",400);
    await createRevision(projectId,str(control.occurrence_id),source,snapshot,actor.email,current,control,extra);
  } else if(input.action==="sign") {
    const role=input.role;if(role!=="pm"&&role!=="superintendent")throw new BonusError("Choose your assigned signing role",400);
    if(value.snapshot[role].email!==actor.email||source[role].email!==actor.email)throw new BonusError("Only the currently assigned employee may sign their own agreement",403);
    if(value.signatures[role])throw new BonusError("Your signature is already recorded");
    if(control.closeout_at||current.source_json!==JSON.stringify(source))throw new BonusError("The project baseline or team changed. The Company Owner must issue a current agreement before signing.");
    const meeting=await db.prepare("SELECT status FROM meeting_occurrences WHERE id=?").bind(control.occurrence_id).first<Row>();
    if(meeting?.status!=="Meeting In Progress")throw new BonusError("Sign during the active Operations turnover meeting");
    const missing=bonusMissing(value.snapshot);if(missing.length)throw new BonusError(`Complete: ${missing.join("; ")}`);
    const image=str(input.signatureImage),name=str(input.signerName).trim();
    if(input.hash!==value.hash||input.consent!==true||name.toLowerCase()!==actor.name.trim().toLowerCase()||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)||image.length<200||image.length>600000)throw new BonusError("Review the current document, draw your signature, enter your own name and consent",400);
    const {env}=await import("cloudflare:workers"),imageBytes=Uint8Array.from(atob(image.split(",")[1]),c=>c.charCodeAt(0));
    const imageKey=`bonus/${projectId}/${value.id}/${crypto.randomUUID()}.png`;
    // Validate PNG decoding and dimensions before saving an assertion of signature.
    const {PDFDocument}=await import("pdf-lib"),check=await PDFDocument.create();let png;
    try{png=await check.embedPng(imageBytes);}catch{throw new BonusError("The drawn signature image is invalid",400);}
    if(png.width<64||png.height<16||png.width>4096||png.height>2048)throw new BonusError("The drawn signature image has invalid dimensions",400);
    const signature:BonusSignature={name,email:actor.email,at:now,imageKey,consent:BONUS_CONSENT,hash:value.hash,meetingId:str(control.occurrence_id)};
    value.signatures[role]=signature;
    await env.BUCKET.put(imageKey,imageBytes,{httpMetadata:{contentType:"image/png"}});
    const pdf=await bonusDocument(value),storageKey=`bonus/${projectId}/${value.id}/${crypto.randomUUID()}.pdf`;
    await env.BUCKET.put(storageKey,pdf,{httpMetadata:{contentType:"application/pdf"}});
    const status=value.signatures.pm&&value.signatures.superintendent?"Signed":"Signature Pending";
    try{await db.batch([
      guard(db,current,"Employee signature",actor.email,{...signature,pdfHash:await bonusHash(pdf)},source),
      db.prepare("INSERT INTO project_files (project_id,name,category,revision,storage_key,content_type,size_bytes,uploaded_by,access) VALUES (?,?,?,?,?,'application/pdf',?,?,'Internal Compensation')").bind(projectId,`${projectId} Bonus Agreement R${value.revision} - ${status}.pdf`,BONUS_FILE_CATEGORY,`R${value.revision} · ${status}`,storageKey,pdf.length,actor.name),
      db.prepare(`UPDATE project_bonus_agreements SET ${role==="pm"?"pm_signature_json":"superintendent_signature_json"}=?,version=version+1,file_id=(SELECT id FROM project_files WHERE storage_key=?),updated_at=? WHERE id=?`).bind(JSON.stringify(signature),storageKey,now,current.id),
    ]);}catch(e){if(/constraint|NOT NULL/i.test(String(e)))throw new BonusError("Agreement changed during signing. Reload before signing again.");throw e;}
  } else throw new BonusError("Unknown bonus action",400);
  await synchronizeBonusWork(projectId);
  return {saved:true};
}

export async function synchronizeBonusWork(projectId:string) {
  const {db,control,current}=await currentRows(projectId);if(!control||!current)return;
  await ensureMyWorkTables();const {getDb}=await import("../db"),drizzle=getDb(),value=viewRow(current);
  const recipients=control.closeout_at?(await db.prepare("SELECT display_name AS name,email FROM company_members WHERE is_active=1 AND (company_access_level='Company Owner' OR EXISTS (SELECT 1 FROM json_each(designations_json) WHERE value IN ('Accountant','Accounting Manager','Financial Administrator')))").all<{name:string;email:string}>()).results:[value.snapshot.pm,value.snapshot.superintendent].filter((p,i)=>p.email&&!value.signatures[i===0?"pm":"superintendent"]);
  const active:string[]=[];
  for(const person of recipients){const key=`bonus:${projectId}:${control.closeout_at?"payment-review":value.id}:${person.email}`;active.push(key);await upsertWorkItem(drizzle,{dedupeKey:key,projectId,recipientName:person.name,recipientEmail:person.email,kind:control.closeout_at?"Bonus Payment Review":"Turnover Signature",title:`${control.closeout_at?"Review bonus obligation":"Sign turnover bonus agreement"}: ${value.snapshot.projectName}`,message:control.closeout_at?"Project closeout is authorized. Review every signed revision, employee changes, schedule, final cost and outside-reported OSHA violations. Confirm eligibility and allocation before the July/December payout; no payment has been approved or issued.":"Review and sign your exact bonus agreement during the Operations turnover meeting.",priority:"High",sourceType:"Project Bonus",sourceRecordId:projectId,actionTarget:control.closeout_at?"Closeout":"Estimating To Operations Turnover",dueAt:control.closeout_at?`${bonusPayoutMonth(str(control.closeout_at).slice(0,10))}-01T12:00:00Z`:"",createdBy:"Turnover Bonus Automation"});}
  await db.prepare("UPDATE command_work_items SET status='Completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE source_type='Project Bonus' AND source_record_id=? AND dedupe_key NOT IN (SELECT value FROM json_each(?)) AND status<>'Completed'").bind(projectId,JSON.stringify(active)).run();
  await db.prepare("UPDATE notification_delivery_events SET status='Suppressed',deferred_reason='Bonus agreement assignment resolved or replaced',next_attempt_at=NULL WHERE work_item_id IN (SELECT id FROM command_work_items WHERE source_type='Project Bonus' AND source_record_id=? AND status='Completed') AND status IN ('Queued','Deferred','Retry Scheduled')").bind(projectId).run();
}
