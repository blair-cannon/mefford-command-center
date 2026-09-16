"use client";

import { useCallback, useEffect, useState } from "react";

type DeletionRequest = {
  id: string;
  target_kind: "project" | "estimate";
  target_id: string;
  target_name: string;
  state: string;
  phase: string;
  requested_by_name: string;
  requested_at: string;
  purge_after: string;
  purgeReady: boolean;
  restoreAvailable: boolean;
  purgeAvailable: boolean;
  operationStale: boolean;
  purgeConfirmation: string;
  error_message: string;
  counts: Record<string, number>;
};

export function DeletionRecoveryCenter() {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [purgeConfirmations, setPurgeConfirmations] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/owner-delete?view=quarantine", { cache: "no-store" });
      const result = await response.json() as { requests?: DeletionRequest[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Deletion recovery could not be loaded.");
      setRequests(result.requests || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Deletion recovery could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function act(action: "restore" | "purge", request: DeletionRequest) {
    setSaving(request.id);
    setNotice("");
    try {
      const response = await fetch("/api/owner-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestId: request.id, confirmation: action === "purge" ? purgeConfirmations[request.id] || "" : "" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || `The ${action} action could not be completed.`);
      setNotice(action === "restore" ? `${request.target_name} was restored.` : `${request.target_name} was permanently purged and reconciled.`);
      setPurgeConfirmations((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== request.id)));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `The ${action} action could not be completed.`);
    } finally {
      setSaving("");
    }
  }

  return <section className="deletion-recovery-center">
    <header><div><h2>Deletion Recovery Center</h2></div><button onClick={() => void load()} disabled={loading}>↻ Refresh</button></header>
    {notice ? <div className="deletion-recovery-notice" role="status">{notice}</div> : null}
    {loading ? <div className="deletion-recovery-empty">Verifying deletion quarantine…</div> : requests.length ? <div className="deletion-recovery-list">{requests.map((request) => {
      const count = Object.values(request.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      return <article key={request.id}>
        <span className="deletion-kind">{request.target_kind === "project" ? "PROJECT" : "ESTIMATE"}</span>
        <div><strong>{request.target_name}</strong><small>{request.target_id} · {request.state} · {request.phase}</small><p>{count.toLocaleString()} identified records/files · Requested by {request.requested_by_name} on {dateTime(request.requested_at)}</p>{request.error_message ? <em>{request.error_message}</em> : null}</div>
        <aside><small>RECOVERY ENDS</small><strong>{dateTime(request.purge_after)}</strong><span>{request.purgeReady ? "Final purge is now available" : "Restore remains available"}</span></aside>
        <div className="deletion-recovery-actions">
          <button disabled={saving === request.id || !request.restoreAvailable} onClick={() => void act("restore", request)}>Restore</button>
          {request.purgeReady ? <label><span>Type exactly to authorize final destruction:</span><code>{request.purgeConfirmation}</code><input value={purgeConfirmations[request.id] || ""} onChange={(event) => setPurgeConfirmations((current) => ({ ...current, [request.id]: event.target.value }))} aria-label={`Final purge confirmation for ${request.target_name}`} /></label> : null}
          <button className="danger-action" disabled={saving === request.id || !request.purgeAvailable || purgeConfirmations[request.id] !== request.purgeConfirmation} onClick={() => void act("purge", request)}>{request.state === "Purge Failed" || request.operationStale ? "Resume Verified Purge" : "Permanently Purge"}</button>
        </div>
      </article>;
    })}</div> : <div className="deletion-recovery-empty">Nothing is in deletion quarantine.</div>}
  </section>;
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
