import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { normalizeProposalData, proposalScopeTotal, type ProposalData } from "./proposals";
import { roundMoney } from "./money";

export const PROPOSAL_WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PROPOSAL_WORD_LIMIT = 8 * 1024 * 1024;
type Field = { key: string; label: string; value: string; kind: "text" | "number" | "date" | "list" };
const scalarFields = [
  ["projectName", "Project Name"], ["projectLocation", "Project Location"], ["ownerName", "Project Owner Or Agency"],
  ["ownerContactName", "Prepared For"], ["ownerContactTitle", "Contact Title"], ["ownerContactEmail", "Contact Email"], ["ownerContactPhone", "Contact Phone"],
  ["proposalDate", "Proposal Date", "date"], ["validThrough", "Valid Through", "date"],
  ["title", "Proposal Title"], ["subtitle", "Subtitle"], ["executiveSummary", "Project Summary"], ["projectUnderstanding", "Project Understanding"],
  ["approachIntroduction", "Delivery Plan"],
  ["targetStartDate", "Target Start Date", "date"], ["durationMonths", "Duration In Months", "number"], ["scheduleNarrative", "Schedule"],
  ["paymentTerms", "Payment Terms"], ["depositPercent", "Deposit Percent", "number"],
  ["assumptions", "Assumptions", "list"], ["exclusions", "Exclusions", "list"], ["nextSteps", "What Comes Next"], ["recommendationSteps", "Next Actions", "list"],
] as const;
function fields(data: ProposalData): Field[] {
  const result: Field[] = scalarFields.map(([key,label,kind])=>({key,label,kind:kind || "text",value:Array.isArray(data[key])?(data[key] as string[]).join("\n"):String(data[key] ?? "")}));
  for (const collection of ["approachPhases", "designStartupServices"] as const) {
    if (collection === "designStartupServices" && !data.recommendedContractType.startsWith("Design-Build")) continue;
    for (const [index,item] of data[collection].entries()) if (item.included) {
      result.push({key:`${collection}.${index}.title`,label:collection === "approachPhases" ? "Delivery Phase" : "Design Startup Service",value:item.title,kind:"text"},
        {key:`${collection}.${index}.description`,label:"Description",value:item.description,kind:"text"});
    }
  }
  for (const [index,item] of data.scheduleMilestones.entries()) if (item.included)
    result.push({key:`scheduleMilestones.${index}.title`,label:"Schedule Milestone",value:item.title,kind:"text"});
  for (const [index,scope] of data.scopeSections.entries()) if(scope.included) {
    result.push({key:`scopeSections.${index}.title`,label:"Scope Title",value:scope.title,kind:"text"},
      {key:`scopeSections.${index}.description`,label:"Included Work",value:scope.description,kind:"text"},
      {key:`scopeSections.${index}.amount`,label:"Scope Amount",value:scope.amount.toFixed(2),kind:"number"});
  }
  return result;
}
const escapeXml=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const decodeXml=(value:string)=>value.replace(/&#(x[\da-f]+|\d+);/gi,(_,code:string)=>String.fromCodePoint(code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code))).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&amp;','&');
function paragraph(text:string,style="Normal") { return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`; }
function fieldParagraph(text:string) { return `<w:p><w:r>${text.split('\n').map(line=>`<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join('<w:br/>')}</w:r></w:p>`; }
function documentXml(data:ProposalData) {
  const body=paragraph(data.projectName,"Title")+paragraph(`${data.packetType} · Revision ${data.revision}`,"Subtitle")
    +paragraph("Edit the fields below in Word, save as .docx, and upload in Proposal Studio. Scope amounts update the proposal total. Images and drawings remain attached in the Studio. Changes return to Draft for approval.")
    +fields(data).map((f,index)=>paragraph(f.label,"Heading2")+`<w:sdt><w:sdtPr><w:alias w:val="${escapeXml(f.label)}"/><w:tag w:val="meffcon:${f.key}"/><w:id w:val="${index+1}"/><w:lock w:val="sdtLocked"/><w:richText/></w:sdtPr><w:sdtContent>${fieldParagraph(f.value)}</w:sdtContent></w:sdt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
}
export async function proposalWordFingerprint(data:ProposalData) {
  const bytes=new TextEncoder().encode(JSON.stringify(normalizeProposalData(data)));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function createProposalWord(data:ProposalData,recordId:string) {
  const metadata={format:"meffcon-proposal-word-v1",recordId,opportunityId:data.opportunityId,revision:data.revision,fingerprint:await proposalWordFingerprint(data)};
  const files={
    "[Content_Types].xml":`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`,
    "_rels/.rels":`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`,
    "word/_rels/document.xml.rels":`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "word/document.xml":documentXml(data),
    "word/styles.xml":`<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="50"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`,
    "docProps/custom.xml":`<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MeffconProposal"><vt:lpwstr>${escapeXml(JSON.stringify(metadata))}</vt:lpwstr></property></Properties>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)])));
}
function textContent(xml:string) {
  return decodeXml(xml.replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:br\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]*>/g,'')).trim();
}
export async function readProposalWord(bytes:Uint8Array,current:ProposalData,recordId:string) {
  if(bytes.length>PROPOSAL_WORD_LIMIT) throw new Error("Word Files Must Be 8 MB Or Smaller.");
  let files:Record<string,Uint8Array>;
  try {
    let total=0, count=0;
    files=unzipSync(bytes,{filter:file=>{
      total+=file.originalSize;count++;
      if(total>20*1024*1024 || count>2048 || file.originalSize>4*1024*1024) throw new Error("Word Package Is Too Large.");
      if(/vbaProject|embeddings\//i.test(file.name)) throw new Error("Macros And Embedded Programs Are Not Accepted.");
      return ['word/document.xml','docProps/custom.xml'].includes(file.name);
    }});
  } catch {throw new Error("Upload A Valid Proposal Studio Word File Without Macros Or Embedded Programs (8 MB Maximum).");}
  if(!files['word/document.xml'] || !files['docProps/custom.xml']) throw new Error("Use The Editable Word Copy Downloaded From Proposal Studio.");
  const xml=strFromU8(files['word/document.xml']),custom=strFromU8(files['docProps/custom.xml']);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml+custom)) throw new Error("Unsupported Word XML.");
  if(/<w:(?:ins|del|moveFrom|moveTo)\b/.test(xml)) throw new Error("Accept Or Reject Tracked Changes In Word Before Uploading.");
  const property=custom.match(/<property\b[^>]*name="MeffconProposal"[^>]*>([\s\S]*?)<\/property>/);
  let meta;try{meta=JSON.parse(textContent(property?.[1] || ''));}catch{throw new Error("The Word File's Proposal Identity Is Missing. Download A Fresh Copy.");}
  if(meta.format!=='meffcon-proposal-word-v1' || meta.recordId!==recordId || meta.opportunityId!==current.opportunityId)throw new Error("This Word File Belongs To A Different Proposal.");
  if(meta.revision!==current.revision || meta.fingerprint!==await proposalWordFingerprint(current))throw new Error("This Word Copy Is Out Of Date. Download The Latest Draft Before Applying These Edits.");
  const expected=fields(current),values=new Map<string,string>();
  for(const match of xml.matchAll(/<w:sdt\b[^>]*>([\s\S]*?)<\/w:sdt>/g)) {
    const key=match[1].match(/<w:tag\b[^>]*w:val="meffcon:([^"]+)"/)?.[1];
    if(!key || !expected.some(f=>f.key===key) || values.has(key))throw new Error("The Word File Contains Missing Or Duplicate Proposal Fields. Download A Fresh Copy.");
    const content=match[1].match(/<w:sdtContent\b[^>]*>([\s\S]*?)<\/w:sdtContent>/)?.[1];
    if(content===undefined)throw new Error("A Word Proposal Field Is Incomplete.");
    const value=textContent(content);if(value.length>30000)throw new Error("A Proposal Field Exceeds 30,000 Characters.");values.set(key,value);
  }
  if(values.size!==expected.length)throw new Error("Keep All Proposal Fields In The Word File. Clear A Field's Text To Remove Its Content.");
  const outside=(value:string)=>textContent(value.replace(/<w:sdt\b[^>]*>[\s\S]*?<\/w:sdt>/g,'')).replace(/\s+/g,' ');
  if(outside(xml)!==outside(documentXml(current)))throw new Error("Some Edits Are Outside The Proposal Fields. Move That Text Into Its Field In Word And Upload Again.");
  const updated=structuredClone(current) as unknown as Record<string,unknown>; const changes:Array<{field:string;before:string;after:string}>=[];
  for(const f of expected) {
    const text=values.get(f.key)!;let value:unknown=text;
    if(f.kind==='number') {
      if(!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text.replace(/^\$/, '')))throw new Error(`${f.label} Must Be A Number With At Most Two Decimal Places.`);
      value=Number(text.replace(/[$,]/g,''));
      if(!Number.isFinite(value as number) || Math.abs(value as number)>1e12)throw new Error(`${f.label} Is Outside The Supported Range.`);
      if(f.key==='durationMonths' && ((value as number)<=0 || (value as number)>120))throw new Error("Duration Must Be Greater Than 0 And At Most 120 Months.");
      if(f.key==='depositPercent' && ((value as number)<0 || (value as number)>100))throw new Error("Deposit Must Be Between 0 And 100 Percent.");
    }
    if(f.kind==='date' && text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text))throw new Error(`${f.label} Must Use A Valid YYYY-MM-DD Date.`);
    if(f.kind==='list')value=text.split('\n').map(x=>x.trim()).filter(Boolean);
    if(text===f.value.trim())continue;
    const path=f.key.split('.');if(path.length===1)updated[f.key]=value;else (updated[path[0]] as Array<Record<string,unknown>>)[Number(path[1])][path[2]]=value;
    changes.push({field:f.key,before:f.value,after:text});
  }
  if(changes.some(x=>/^scopeSections\.\d+\.amount$/.test(x.field))) updated.contractPrice=roundMoney(proposalScopeTotal(updated.scopeSections as ProposalData['scopeSections']));
  return {data:normalizeProposalData({...updated,status:'Draft'},current),changes};
}
