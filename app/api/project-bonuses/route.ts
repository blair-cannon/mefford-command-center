import { resolveCommandActor } from "../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { canReadProjectId } from "../../../lib/project-access";
import { BonusError, bonusView, bonusDocument, changeBonus } from "../../../lib/bonus-server";
import { BONUS_DOCX_BASE64 } from "../../../lib/bonus-template";
import { canReadFileScope } from "../../../lib/project-file-access";
import { BONUS_FILE_CATEGORY } from "../../../lib/project-bonuses";

async function access(request:Request,projectId:string) {
  const actor=await resolveCommandActor(request);
  if(!actor.authenticated)throw new BonusError("Authentication required",401);
  const {getDb}=await import("../../../db"),db=getDb();
  if(!projectId||!(await canReadProjectId(db,actor,projectId))||!(await canReadFileScope(db,actor,{projectId,category:BONUS_FILE_CATEGORY})))throw new BonusError("Assigned PM, superintendent, Company Owner or Accounting access required",403);
  return actor;
}
export async function GET(request:Request) {
  try{
    const lock=await enforceOnboardingAccess(request);if(lock)return lock;
    const query=new URL(request.url).searchParams;
    if(query.get("queue")==="1") {
      const actor=await resolveCommandActor(request);if(!actor.authenticated)throw new BonusError("Authentication required",401);
      const {env}=await import("cloudflare:workers");
      const member=await env.DB.prepare("SELECT designations_json FROM company_members WHERE email=? AND is_active=1").bind(actor.email).first<{designations_json:string}>();
      if(actor.accessLevel!=="Company Owner"&&!JSON.parse(member?.designations_json||"[]").some((r:string)=>["Accountant","Accounting Manager","Financial Administrator"].includes(r)))throw new BonusError("Accounting access required",403);
      const rows=await env.DB.prepare("SELECT c.project_id AS projectId,p.name,c.closeout_at AS closeoutAt,c.payment_status AS status FROM project_bonus_controls c JOIN projects p ON p.number=c.project_id WHERE c.closeout_at<>'' ORDER BY c.closeout_at,c.project_id").all();
      return Response.json({queue:rows.results},{headers:{"Cache-Control":"no-store"}});
    }
    const projectId=query.get("projectId")||"",actor=await access(request,projectId);
    const view=await bonusView(projectId,actor);
    if(!view)return Response.json({agreement:null});
    if(query.get("document")==="original")return new Response(Uint8Array.from(atob(BONUS_DOCX_BASE64),c=>c.charCodeAt(0)),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","Content-Disposition":"attachment; filename=Mefford-Contracting-Bonus-Structure.docx","Cache-Control":"no-store"}});
    if(query.get("document")==="pdf") {
      const id=query.get("id"),row=id?[view.current,...view.history].find(r=>r.id===id):view.current;
      if(!row)throw new BonusError("Agreement revision not found",404);
      const pdf=await bonusDocument(row);
      return new Response(pdf as BodyInit,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="Bonus-Agreement-R${row.revision}.pdf"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
    }
    return Response.json({agreement:view},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return failure(e);}
}
export async function POST(request:Request){
  try{
    const lock=await enforceOnboardingAccess(request);if(lock)return lock;
    const input=await request.json() as Record<string,unknown>,projectId=String(input.projectId||""),actor=await access(request,projectId);
    return Response.json(await changeBonus(projectId,actor,input));
  }catch(e){return failure(e);}
}
function failure(e:unknown){if(e instanceof BonusError)return Response.json({error:e.message},{status:e.status});console.error("Project bonus action failed",e);return Response.json({error:"Bonus agreement could not be saved or loaded. Your saved signatures remain intact. Retry."},{status:503});}
