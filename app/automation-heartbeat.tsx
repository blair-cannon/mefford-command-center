"use client";

import { useEffect } from "react";

export function AutomationHeartbeat() {
  useEffect(() => {
    let stopped = false;
    const run = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void fetch("/api/automation-heartbeat", { method: "POST", cache: "no-store" }).catch(() => undefined);
    };
    const first = window.setTimeout(run, 2_000);
    const interval = window.setInterval(run, 5 * 60_000);
    const visible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
