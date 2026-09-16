"use client";
import { useEffect,useState } from "react";
import { ProjectBonusControls } from "./project-bonus-controls";
type Entry={projectId:string;name:string;closeoutAt:string;status:string};
export function BonusPaymentQueue(){
  const [rows,setRows]=useState<Entry[]>([]),[selected,setSelected]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let active=true;fetch("/api/project-bonuses?queue=1",{cache:"no-store"}).then(async r=>{const j=await r.json() as {queue:Entry[];error?:string};if(!r.ok)throw new Error(j.error);if(active)setRows(j.queue);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  if(error)return <p role="alert">Bonus payment reviews unavailable: {error}</p>;
  if(!rows.length)return null;
  return <section className="project-bonus-controls" aria-label="Bonus payment reviews"><header><strong>Bonus Payment Reviews</strong></header><div className="bonus-history">{rows.map(row=><article key={row.projectId}><span><b>{row.name}</b> · Closed {new Date(row.closeoutAt).toLocaleDateString()} · {row.status}</span><button className="secondary-action" onClick={()=>setSelected(selected===row.projectId?"":row.projectId)}>Review Obligation</button></article>)}</div>{selected?<ProjectBonusControls key={selected} projectId={selected}/>:null}</section>;
}
