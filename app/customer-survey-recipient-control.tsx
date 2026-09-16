"use client";

import { useCallback, useEffect, useState } from "react";

type Recipient = { name: string; email: string; primary?: boolean };
type Payload = { primary: Recipient; additional: Recipient[]; canEdit: boolean; cadence: string; policy: string; error?: string };

export function CustomerSurveyRecipientControl({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [additional, setAdditional] = useState<Recipient[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`/api/customer-survey-recipients?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const result = await response.json() as Payload;
    if (!response.ok) { setError(result.error || "Survey recipients could not be loaded."); return; }
    setData(result); setAdditional(result.additional || []); setError("");
  }, [projectId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/customer-survey-recipients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, additional }) });
      const result = await response.json() as Payload;
      if (!response.ok) throw new Error(result.error || "Survey recipients could not be saved.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Survey recipients could not be saved."); }
    finally { setSaving(false); }
  }

  if (!data && !error) return <section className="survey-recipient-control"><span>Loading automatic survey recipients…</span></section>;
  return <section className="survey-recipient-control" aria-labelledby="survey-recipient-title"><header><div><h2 id="survey-recipient-title">Customer Recipients</h2><span>{data?.cadence || "Project cadence will follow the contract type."}</span></div><b>AUTOMATED</b></header>
    {data ? <div className="survey-recipient-body"><article className="survey-primary-recipient"><span>PRIMARY · ALWAYS INCLUDED</span><strong>{data.primary.name || "Primary Contact Needed"}</strong><small>{data.primary.email || "Set the owner email in the Owner Contract or Owner Portal."}</small></article>
      <div className="survey-additional-recipients"><header><div><strong>Additional recipients</strong><small>The Project Manager may add more customer contacts. Each receives a separate single-use survey.</small></div>{data.canEdit ? <button type="button" onClick={() => setAdditional([...additional, { name: "", email: "" }])}>＋ Add Recipient</button> : null}</header>
        {additional.map((recipient, index) => <div className="survey-recipient-row" key={`${index}-${recipient.email}`}><input aria-label={`Additional recipient ${index + 1} name`} placeholder="Customer name" value={recipient.name} disabled={!data.canEdit} onChange={(event) => setAdditional(additional.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input aria-label={`Additional recipient ${index + 1} email`} type="email" placeholder="customer@company.com" value={recipient.email} disabled={!data.canEdit} onChange={(event) => setAdditional(additional.map((item, itemIndex) => itemIndex === index ? { ...item, email: event.target.value } : item))} />{data.canEdit ? <button type="button" aria-label={`Remove ${recipient.name || "recipient"}`} onClick={() => setAdditional(additional.filter((_, itemIndex) => itemIndex !== index))}>×</button> : null}</div>)}
        {!additional.length ? <p>No additional recipients. Automatic surveys will still go to the primary customer contact.</p> : null}
      </div>
      <footer><span>{data.policy}</span>{data.canEdit ? <button type="button" disabled={saving || !data.primary.email} onClick={() => void save()}>{saving ? "Saving…" : "Save Survey Recipients"}</button> : null}</footer>
    </div> : null}
    {error ? <div className="survey-recipient-error" role="alert">{error}</div> : null}
  </section>;
}
