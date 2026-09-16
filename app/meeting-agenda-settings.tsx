"use client";

import { useState } from "react";
import type { AgendaSelection } from "../lib/meeting-agenda-settings";

export type AgendaConfiguration = {
  selection: AgendaSelection; managerEmails: string[]; expectedAccess: string;
  sections: Array<{ id: string; title: string }>; metrics: Array<{ id: string; title: string }>; scorecards: Array<{ id: string; title: string }>;
};
export function MeetingAgendaSettings({ configuration, attendees, owner, leaderEmail, saving, onSave, onClose }: {
  configuration: AgendaConfiguration; attendees: Array<Record<string, string | number | null>>; owner: boolean; leaderEmail: string;
  saving: boolean; onSave: (input: Record<string, unknown>) => Promise<boolean>; onClose: () => void;
}) {
  const [selection, setSelection] = useState(configuration.selection);
  const [managers, setManagers] = useState(configuration.managerEmails);
  const [reason, setReason] = useState("");
  const toggle = (key: keyof AgendaSelection, id: string) => setSelection(current => ({ ...current, [key]: current[key].includes(id) ? current[key].filter(item => item !== id) : [...current[key], id] }));
  return <div className="modal-layer" role="presentation"><section className="record-modal wide meeting-settings-modal" role="dialog" aria-modal="true" aria-labelledby="agenda-settings-title">
    <div className="modal-heading"><h2 id="agenda-settings-title">Agenda Sources And Managers</h2><button aria-label="Close Agenda Settings" disabled={saving} onClick={onClose}>×</button></div>
    <div className="agenda-settings-groups">{(["sections", "metrics", "scorecards"] as const).map(key => <fieldset key={key}><legend>{key === "sections" ? "Automatic Discussion Items" : key === "metrics" ? "Dashboard Measures" : "Selected Company Scorecards"}</legend>
      {configuration[key].map(item => <label key={item.id}><input type="checkbox" checked={selection[key].includes(item.id)} disabled={saving || (key === "scorecards" && !owner)} onChange={() => toggle(key, item.id)} /><span>{item.title}</span></label>)}
      {!configuration[key].length ? <p>No Saved Company Scorecards Available.</p> : null}
    </fieldset>)}</div>
    {owner ? <fieldset className="agenda-manager-picks"><legend>Additional Agenda Managers</legend><p>The meeting leader and company owners already control topic removal.</p>{attendees.filter(person => String(person.email).toLowerCase() !== leaderEmail.toLowerCase() && person.attendee_role !== "Company Owner" && !Number(person.external)).map(person => <label key={String(person.id)}><input type="checkbox" checked={managers.includes(String(person.email).toLowerCase())} disabled={saving} onChange={event => setManagers(current => event.target.checked ? [...current, String(person.email).toLowerCase()] : current.filter(email => email !== String(person.email).toLowerCase()))} /><span>{person.name}</span></label>)}</fieldset> : null}
    <label className="field-label">Reason For Change<textarea value={reason} disabled={saving} onChange={event => setReason(event.target.value)} /></label>
    <div className="modal-actions"><button className="secondary-action" disabled={saving} onClick={onClose}>Cancel</button><button className="primary-action" disabled={saving || !reason.trim()} onClick={async () => { if (await onSave({ selection, ...(owner ? { managerEmails: managers } : {}), expectedAccess: configuration.expectedAccess, reason })) onClose(); }}>Save Agenda Settings</button></div>
  </section></div>;
}
