type RevisionRow = { revision: number; changed_at: string };

export async function dashboardRevision() {
  const { env } = await import("cloudflare:workers");
  const row = await env.DB.prepare(
    "SELECT revision, changed_at FROM dashboard_change_revisions WHERE id = 1 LIMIT 1",
  ).first<RevisionRow>();
  return {
    revision: Math.max(1, Number(row?.revision || 1)),
    changedAt: String(row?.changed_at || new Date().toISOString()),
  };
}

export async function waitForDashboardRevision(
  since: number,
  signal: AbortSignal,
  options: { attempts?: number; intervalMs?: number } = {},
) {
  const attempts = Math.max(1, Math.min(55, options.attempts || 50));
  const intervalMs = Math.max(250, Math.min(2_000, options.intervalMs || 1_000));
  let current = await dashboardRevision();
  for (let attempt = 0; attempt < attempts && !signal.aborted; attempt += 1) {
    if (current.revision !== since) return { ...current, changed: true };
    await pause(intervalMs, signal);
    current = await dashboardRevision();
  }
  return { ...current, changed: current.revision !== since };
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
