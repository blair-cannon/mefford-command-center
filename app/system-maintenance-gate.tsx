"use client";

import { useEffect, useState } from "react";

type Maintenance = { id: string; title: string; expectedEndTime: string; reason: string; startedAt: string };

export function SystemMaintenanceGate({ leadership }: { leadership: boolean }) {
  const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
  const [adminOverride, setAdminOverride] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/api/system-status", { cache: "no-store" });
        const data = await response.json() as { status?: string; maintenance?: Maintenance | null };
        if (active) setMaintenance(data.status === "Maintenance" ? data.maintenance || null : null);
      } catch { /* Keep the current screen during a temporary polling failure. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!maintenance || adminOverride) return null;
  return <div className="system-maintenance-gate" role="alertdialog" aria-modal="true" aria-label="Command Center scheduled maintenance"><section><span className="maintenance-logo">MC</span><p>SCHEDULED SATURDAY MAINTENANCE</p><h1>Command Center Is Being Updated</h1><b>Expected back by {formatTime(maintenance.expectedEndTime)} Eastern</b><small>{maintenance.reason}</small><div><i /><span>Work ends early whenever the update is completed and verified. This screen checks automatically every 30 seconds.</span></div>{leadership ? <button onClick={() => setAdminOverride(true)}>Continue In Restricted Admin Mode</button> : null}<em>No invoices, payments, contracts or approvals are processed automatically during maintenance.</em></section></div>;
}

function formatTime(value: string) { const [hourValue, minute = "00"] = value.split(":"); const hour = Number(hourValue); return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`; }

