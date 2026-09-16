"use client";

import { useState } from "react";
import { OPS_TURNOVER, type TurnoverView } from "../lib/turnovers";
import { ProjectBonusControls } from "./project-bonus-controls";

export function TurnoverControls({ turnover, canLead, owner, saving, started, onAction }: {
  turnover:TurnoverView; canLead:boolean; owner:boolean; saving:boolean; started:boolean;
  onAction:(action:string,payload:Record<string,unknown>) => Promise<boolean>;
}) {
  const [scheduleOpen,setScheduleOpen] = useState(false), [start,setStart] = useState(""), [location,setLocation] = useState("");
  const [ntpOpen,setNtpOpen] = useState(false), [ntp,setNtp] = useState(turnover.ntpReference);
  const act = (action:string,payload:Record<string,unknown> = {}) => onAction(action,{ ...payload,expectedRevision:turnover.revision });
  const blocking = turnover.packet.gaps.filter(g => g.blocking);
  const ready = started && turnover.scheduled && !blocking.length && turnover.packet.sections.every(s => turnover.reviewed.includes(s.key));
  return <section className="turnover-controls" aria-label="Turnover acceptance">
    <header><div><strong>{turnover.packet.title}</strong><span>{turnover.status} · R{turnover.revision} · Receiver: {turnover.packet.receiverName || "Unassigned"}</span></div>
      <div className="turnover-buttons">
        {canLead && !started ? <button className="secondary-action" disabled={saving} onClick={() => setScheduleOpen(!scheduleOpen)}>{turnover.scheduled ? "Change Date / Location" : "Confirm Date / Location"}</button> : null}
        {owner && turnover.type === OPS_TURNOVER && !turnover.packet.contractSigned ? <button className="secondary-action" disabled={saving} onClick={() => setNtpOpen(!ntpOpen)}>Record NTP</button> : null}
        {turnover.canAccept && turnover.status !== "Accepted" ? <button className="primary-action" disabled={saving || !ready} onClick={() => void act("turnover_accept")}>Accept Turnover</button> : null}
      </div>
    </header>
    {turnover.type === OPS_TURNOVER ? <div className="turnover-facts"><span>Contract: {new Intl.NumberFormat("en-US",{style:"currency",currency:"USD", minimumFractionDigits: 2, maximumFractionDigits: 2}).format(turnover.packet.contractValue)}</span><span>{turnover.packet.contractSigned ? "Signed Contract" : "Contract To Sign · Construction Billing Blocked"}</span><span>Buyout due: {turnover.buyoutDue || "Meeting date required"}{!started && turnover.buyoutDue ? " (planned)" : ""}</span></div> : null}
    {scheduleOpen ? <form className="turnover-form" onSubmit={async event => { event.preventDefault(); if (await act("turnover_schedule",{ startAt:new Date(start).toISOString(),location })) setScheduleOpen(false); }}><label>Meeting date<input type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label><label>Location / meeting link<input required value={location} onChange={e => setLocation(e.target.value)} /></label><button className="primary-action" disabled={saving}>Save Meeting Date</button></form> : null}
    {ntpOpen ? <form className="turnover-form" onSubmit={async event => { event.preventDefault(); if (await act("turnover_ntp",{reason:ntp})) setNtpOpen(false); }}><label>NTP document reference, date and authorized scope<textarea required value={ntp} onChange={e => setNtp(e.target.value)} /><small>NTP permits the Operations handoff. Signed sales and construction billing still require both contract signatures.</small></label><button className="primary-action" disabled={saving}>Record NTP Authority</button></form> : null}
    {blocking.length ? <ul className="turnover-gaps">{blocking.map(g => <li key={g.key}><strong>Required</strong><span>{g.title} · {g.owner || "Receiving lead"}</span></li>)}</ul> : null}
    <details className="turnover-review"><summary>Receiver Review · {turnover.reviewed.length} / {turnover.packet.sections.length} sections{turnover.status === "Changes Require Review" ? " · Source information changed" : ""}</summary>
      {turnover.packet.sections.map(section => <details key={section.key} className="turnover-section"><summary>{section.title}</summary><div className="turnover-source-text">{section.content}</div>
        {turnover.canAccept && turnover.status !== "Accepted" ? <label className="turnover-check"><input type="checkbox" disabled={saving} checked={turnover.reviewed.includes(section.key)} onChange={event => void act("turnover_review",{sectionKey:section.key,value:event.target.checked})} />Reviewed current source and recorded exceptions</label> : null}
      </details>)}
    </details>
    {turnover.acceptedAt ? <small>Last accepted by {turnover.acceptedBy} · {new Date(turnover.acceptedAt).toLocaleString()}</small> : null}
    {turnover.type === OPS_TURNOVER ? <ProjectBonusControls key={`${turnover.packet.projectId}:${started}`} projectId={turnover.packet.projectId} onSaved={() => { void act("refresh_agenda"); }} /> : null}
  </section>;
}
