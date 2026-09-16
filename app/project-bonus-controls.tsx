"use client";
import { useCallback, useEffect, useState } from "react";
import { BONUS_CONSENT, BONUS_TIERS, bonusMoney, type BonusView } from "../lib/project-bonuses";
import { SignaturePad } from "./signature-pad";

export function ProjectBonusControls({projectId,onSaved}:{projectId:string;onSaved?:()=>void}) {
  const [data,setData]=useState<BonusView|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);
  const [preview,setPreview]=useState(false),[revision,setRevision]=useState(false),[sign,setSign]=useState(false);
  const [name,setName]=useState(""),[ink,setInk]=useState(""),[consent,setConsent]=useState(false);
  const [edit,setEdit]=useState({pmEmail:"",superintendentEmail:"",budget:"",finalDate:"",tier:"",reason:"",effectiveDate:new Date().toISOString().slice(0,10)});
  const load=useCallback(async()=>{
    setLoading(true);
    try{const r=await fetch(`/api/project-bonuses?projectId=${encodeURIComponent(projectId)}`,{cache:"no-store"}),j=await r.json() as {agreement:BonusView|null;error?:string};if(r.status===403){setData(null);return;}if(!r.ok)throw new Error(j.error);setData(j.agreement);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Agreement unavailable");}finally{setLoading(false);}
  },[projectId]);
  useEffect(()=>{queueMicrotask(()=>void load());},[load]);
  const post=async(action:string,payload:Record<string,unknown>)=>{
    if(!data)return;setSaving(true);setError("");
    try{const r=await fetch("/api/project-bonuses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,action,id:data.current.id,version:data.current.version,...payload})}),j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error);setInk("");setConsent(false);setSign(false);setRevision(false);setPreview(false);await load();onSaved?.();}
    catch(e){setError(e instanceof Error?e.message:"Agreement could not be saved");}finally{setSaving(false);}
  };
  if(!data)return error?<div className="meeting-refresh-error" role="alert">{error}<button onClick={()=>void load()}>Retry Bonus Agreement</button></div>:loading?<div className="bonus-loading">Loading bonus agreement…</div>:null;
  const a=data.current,s=a.snapshot,signed=Boolean(a.signatures.pm&&a.signatures.superintendent);
  const url=`/api/project-bonuses?projectId=${encodeURIComponent(projectId)}&document=pdf&id=${encodeURIComponent(a.id)}&v=${a.version}`;
  const canSign=Boolean(data.canSign&&data.meetingActive&&!data.sourceChanged&&!data.missing.length&&!data.closeoutAt);
  return <section className="project-bonus-controls" aria-label="Turnover bonus agreement">
    <header><div><strong>Bonus Agreement · R{a.revision}</strong><span>{signed?"Signed by both employees":"Signatures required"}{data.closeoutAt?` · Bonus obligation: ${data.paymentStatus}`:""}</span></div><div className="turnover-buttons">
      <button type="button" className="secondary-action" onClick={()=>setPreview(!preview)}>{preview?"Close Document":"Review Agreement"}</button>
      <a className="secondary-action" href={url} target="_blank" rel="noreferrer">Print / Download</a>
      {data.canManage&&!data.closeoutAt?<button type="button" className="secondary-action" disabled={saving} onClick={()=>{const latest=data.sourceChanged?data.suggested:s;setEdit({pmEmail:latest.pm.email,superintendentEmail:latest.superintendent.email,budget:String(latest.budget),finalDate:latest.finalDate,tier:String(latest.tier),reason:"",effectiveDate:new Date().toISOString().slice(0,10)});setRevision(!revision);}}>Update / Replace Employee</button>:null}
      {data.canSign&&!data.closeoutAt?<button type="button" className="primary-action" disabled={saving||!canSign} onClick={()=>{setSign(!sign);setPreview(true);setName(s[data.canSign as "pm"|"superintendent"].name);}}>Sign My Agreement</button>:null}
      {data.canStartReplacement?<button type="button" className="primary-action" disabled={saving} onClick={()=>void post("start-replacement",{})}>Start Follow-Up Turnover Now</button>:null}
    </div></header>
    <div className="bonus-facts"><span>Budget <b>{bonusMoney(s.budget)}</b></span><span>Completion <b>{s.finalDate||"Required"}</b></span><span>Potential payout <b>{s.payoutMonth||"Required"}</b></span></div>
    <div className="bonus-people">{(["superintendent","pm"] as const).map(role=><div key={role}><strong>{role==="pm"?"PM":"Site superintendent"}: {s[role].name||"Unassigned"}</strong><span>{bonusMoney(role==="pm"?s.pmBonus:s.superintendentBonus)} · {a.signatures[role]?`Signed ${new Date(a.signatures[role]!.at).toLocaleString()}`:"Awaiting signature"}</span></div>)}</div>
    {error?<div className="meeting-refresh-error" role="alert">{error}</div>:null}
    {data.sourceChanged?<p className="bonus-warning" role="alert">Project details or team changed. The Company Owner must issue a new revision before signing or accepting turnover.</p>:null}
    {data.missing.length?<p className="bonus-warning">Required: {data.missing.join("; ")}</p>:null}
    {data.canSign&&!data.meetingActive&&!data.closeoutAt?<p className="bonus-warning">Start the Operations turnover meeting to sign.</p>:null}
    {data.closeoutAt?<p className="bonus-warning">Closeout authorized {new Date(data.closeoutAt).toLocaleDateString()}. Accounting and the Company Owner must review the bonus obligation, prior employees, schedule, final cost and OSHA evidence for July / December payout.</p>:null}
    {preview?<iframe className="bonus-preview" title={`Bonus agreement revision ${a.revision}`} src={`${url}#view=FitH`} />:null}
    {sign&&canSign?<form className="bonus-sign-form" onSubmit={e=>{e.preventDefault();void post("sign",{role:data.canSign,signerName:name,signatureImage:ink,consent,hash:a.hash});}}><label>Your full name<input required value={name} onChange={e=>setName(e.target.value)} /></label><SignaturePad value={ink} onChange={setInk} label="Your signature"/><label className="turnover-check"><input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{BONUS_CONSENT}</span></label><button className="primary-action" disabled={saving||!ink||!consent}>{saving?"Saving signature…":"Sign and Save in Project Files"}</button></form>:null}
    {revision?<form className="bonus-edit-form" onSubmit={e=>{e.preventDefault();void post("revise",{...edit,budget:Number(edit.budget),...(Number(edit.tier)>=0?{tier:Number(edit.tier)}:{tier:undefined})});}}>
      {(["pmEmail","superintendentEmail"] as const).map(key=><label key={key}>{key==="pmEmail"?"Project manager":"Site superintendent"}<select value={edit[key]} onChange={e=>setEdit({...edit,[key]:e.target.value})}><option value="">Use current project assignment</option>{data.employees.map(p=><option key={p.email} value={p.email}>{p.name} · {p.email}</option>)}</select></label>)}
      <label>Approved project cost budget<input required type="number" min="0.01" step="0.01" value={edit.budget} onChange={e=>setEdit({...edit,budget:e.target.value,tier:"-1"})}/></label><label>Final completion date<input required type="date" value={edit.finalDate} onChange={e=>setEdit({...edit,finalDate:e.target.value})}/></label>
      <label>Bonus tier<select value={edit.tier} onChange={e=>setEdit({...edit,tier:e.target.value})}><option value="-1">Calculate from budget</option>{BONUS_TIERS.map((t,i)=><option value={i} key={i}>{t.label}</option>)}</select></label><label>Effective date<input type="date" required value={edit.effectiveDate} onChange={e=>setEdit({...edit,effectiveDate:e.target.value})}/></label>
      <label className="bonus-wide">Reason<textarea required minLength={10} maxLength={1500} value={edit.reason} onChange={e=>setEdit({...edit,reason:e.target.value})}/><small>Updates project assignments and completion date. Prior signatures stay on their original revision. Both employees must sign this revision; prior bonus entitlement remains subject to management review.</small></label><button className="primary-action" disabled={saving}>Create New Revision</button>
    </form>:null}
    <details className="bonus-history"><summary>Agreement history{data.history.length?` · ${data.history.length} earlier revisions`:""}</summary><a href={`/api/project-bonuses?projectId=${encodeURIComponent(projectId)}&document=original`}>Original Word Document</a>{data.history.map(h=><article key={h.id}><span>R{h.revision} · {h.snapshot.pm.name} / {h.snapshot.superintendent.name} · {h.signatures.pm||h.signatures.superintendent?"Signed record retained":"Unsigned draft"}</span><a href={`/api/project-bonuses?projectId=${encodeURIComponent(projectId)}&document=pdf&id=${encodeURIComponent(h.id)}`} target="_blank" rel="noreferrer">Open R{h.revision}</a>{h.fileId?<a href={`/api/files?id=${h.fileId}`} target="_blank" rel="noreferrer">Archived Signed File</a>:null}</article>)}</details>
  </section>;
}
