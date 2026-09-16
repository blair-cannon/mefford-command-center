import { PDFDocument, rgb } from "pdf-lib";
import { BONUS_PDF_BASE64 } from "./bonus-template";
import { meetingPdfFonts, wrapMeetingPdfText } from "./meeting-pdf";
import { bonusMoney, type BonusSnapshot, type BonusSignature } from "./project-bonuses";

export async function bonusPdf(snapshot:BonusSnapshot, revision:number, hash:string, signatures:{pm:BonusSignature|null;superintendent:BonusSignature|null}, images:Partial<Record<"pm"|"superintendent",Uint8Array>> = {}) {
  const pdf = await PDFDocument.load(Uint8Array.from(atob(BONUS_PDF_BASE64),c=>c.charCodeAt(0)));
  const {regular,bold} = await meetingPdfFonts(pdf);
  pdf.setTitle(`${snapshot.projectId} Bonus Agreement R${revision}`);
  const first = pdf.getPage(0);
  const continuedFields:Array<[string,string]> = [];
  // Only the blank agreement fields are filled. Every policy paragraph and rate table stays intact.
  first.drawRectangle({x:71,y:69,width:474,height:81,color:rgb(1,1,1)});
  const field = (label:string,value:string,x:number,y:number,width=224) => {
    const lines=wrapMeetingPdfText(`${label}: ${value}`,regular,8,width);
    if(lines.length>2) {continuedFields.push([label,value]);lines.splice(0,lines.length,`${label}: see signature record`);}
    lines.forEach((line,i)=>first.drawText(line,{x,y:y-i*8.5,size:8,font:regular}));
  };
  field("Project Name",snapshot.projectName,72,141);
  field("Total Project Budget",bonusMoney(snapshot.budget),324,141);
  field("Final Completion Date",snapshot.finalDate,72,120);
  field("Potential Month of Bonus Payout",snapshot.payoutMonth,324,120);
  field("Site Superintendent",snapshot.superintendent.name,72,108);
  field("Project Manager",snapshot.pm.name,324,108);
  field("Site Superintendent Potential Bonus",bonusMoney(snapshot.superintendentBonus),72,88);
  field("Project Manager Potential Bonus",bonusMoney(snapshot.pmBonus),324,88);
  for (const [role,x] of [["superintendent",72],["pm",324]] as const) {
    if (images[role]) { const img=await pdf.embedPng(images[role]!); const size=img.scaleToFit(140,22); first.drawImage(img,{x,y:53,width:size.width,height:size.height}); }
    first.drawLine({start:{x,y:52},end:{x:x+210,y:52},thickness:.4});
    first.drawText(role==="pm" ? "Project Manager Signature" : "Site Superintendent Signature",{x,y:41,size:8,font:bold});
  }
  let page=pdf.addPage([612,792]),y=724;
  const write=(value:string,heavy=false) => {
    for(const line of wrapMeetingPdfText(value,heavy?bold:regular,10,468)) { if(y<66){page=pdf.addPage([612,792]);y=724;}page.drawText(line,{x:72,y,size:10,font:heavy?bold:regular});y-=15; } y-=9;
  };
  write("Turnover agreement signature record",true);
  write(`${snapshot.projectName} | ${snapshot.projectId} | Revision ${revision}`);
  for(const [label,value] of continuedFields) write(`${label}: ${value}`);
  write(`Effective date: ${snapshot.effectiveDate}. Budget source: ${snapshot.budgetSource}.`);
  if(snapshot.reason) write(`Revision reason: ${snapshot.reason}`);
  write(`Agreement fingerprint: ${hash}`);
  write(`Original document fingerprint: ${snapshot.templateHash}`);
  for(const role of ["superintendent","pm"] as const) {
    const s=signatures[role];write(role==="pm"?"Project Manager":"Site Superintendent",true);
    write(s ? `${s.name} | ${s.email}\nSigned: ${s.at}\nTurnover meeting: ${s.meetingId}\n${s.consent}` : "Signature pending");
  }
  write("Earlier signed revisions remain in the project files. This revision does not determine a departing employee's bonus entitlement. Management reviews the allocation and the agreement's conditions at closeout.");
  return pdf.save();
}
