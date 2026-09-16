"use client";

import { useEffect, useMemo, useState } from "react";
import { summaryDrilldownProps } from "./summary-drilldown";
import { MicrosoftFilesControl } from "./microsoft-files-control";

type Connection = {
  key: string;
  name: string;
  shortName: string;
  category: string;
  sensitive: boolean;
  providerStatusUrl: string;
  purpose: string;
  projectImpact: boolean;
  id: string;
  status: string;
  recordedStatus?: string;
  runtime?: { mode: string; activationState: "Implemented" | "Prepared" | "Manual Workflow" | "Managed Resource" | "Not Implemented"; ready: boolean; detail: string; missing: string[] };
  meta: string;
  updatedAt: string;
  data: Record<string, unknown>;
};

type IntegrationRecord = {
  id: string;
  type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
};

type AutomationJob = {
  name: string;
  label: string;
  cadence: string;
  status: "Healthy" | "Failed" | "Late" | "Awaiting First Run";
  lastRunAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
  attempts: number;
  durationMs: number;
  expectedRuns24h: number;
  observedRuns24h: number;
  failedRuns24h: number;
  timedOutRuns24h: number;
  stuckRuns: number;
  oldestStuckAgeMinutes: number;
  openGapSlots: number;
  openDeadLetters: number;
  error: string;
};

type EvidenceCheck = {
  key: string;
  label: string;
  status: "Verified" | "Degraded" | "Failed" | "Unknown" | "Not Configured";
  required: boolean;
  observedAt: string;
  expiresAt: string;
  source: string;
  detail: string;
};

type EvidenceSubject = {
  status: EvidenceCheck["status"];
  evidence: EvidenceCheck[];
  verifiedEvidence: number;
  requiredEvidence: number;
  lastObservedAt: string;
};

type AutomationRun = {
  id: string;
  jobName: string;
  scheduledAt: string;
  completedAt: string;
  status: string;
  attempts: number;
  durationMs: number;
  error: string;
};

type IntegrationResponse = {
  actor: { name: string; email: string; role: string; canConfigure: boolean; canApproveFinancial: boolean; canReviewFinancial: boolean };
  system: { color: "Green" | "Yellow" | "Red"; counts: Record<string, number>; visibleConnections: number; openConflicts: number; openIncidents: number; lastReconciledAt: string };
  application: { overall: EvidenceCheck["status"]; verified: number; degraded: number; failed: number; unknown: number; notConfigured: number; total: number; principle: string; sections: Array<EvidenceSubject & { id: string; name: string; scope: "Company" | "Project"; persistence: string; automation: string; authority: string; connectionBoundary: string }> };
  audit: { overall: EvidenceCheck["status"]; summary: { workflows: number; verifiedWorkflows: number; degradedWorkflows: number; failedWorkflows: number; unknownWorkflows: number; notConfiguredWorkflows: number; isolatedWorkflows: number; intelligenceUses: number; verifiedIntelligenceUses: number; degradedIntelligenceUses: number; failedIntelligenceUses: number; unknownIntelligenceUses: number; notConfiguredIntelligenceUses: number; automationOverall: string }; principle: string; workflows: Array<EvidenceSubject & { id: string; name: string; systems: string[]; trigger: string; automation: string; result: string; humanGate: string; externalBoundary: string }>; intelligence: Array<EvidenceSubject & { id: string; name: string; kind: "OCR" | "OpenAI" | "Native Data"; intake: string; extraction: string; downstream: string[]; review: string; connectionKey: string }> };
  automation: { overall: string; failureCount24h: number; cadence: string; retention: string; openGapSlots: number; openDeadLetters: number; boundedExecution: { timeBudgetMs: number; maxGroupsPerInvocation: number; completedCheckpoints24h: number; canceledCheckpoints24h: number; failedCheckpoints24h: number; cursors: Array<{ source: string; nextGroupIndex: number; lastGroupName: string; lastCheckpointAt: string; lastCycleId: string }>; recentCheckpoints: Array<{ id: string; source: string; scheduledAt: string; groupName: string; groupIndex: number; status: string; startedAt: string; completedAt: string; durationMs: number; error: string; nextGroupIndex: number }> }; trigger: { status: "Healthy" | "Failed" | "Late" | "Awaiting First Run"; expectedRuns24h: number; observedRuns24h: number; lastPlatformTriggerAt: string; lastFallbackTriggerAt: string; source: string; error: string }; jobs: AutomationJob[]; recentRuns: AutomationRun[] };
  handoffs: { status: string; total: number; completed: number; partiallyApplied: number; pending: number; incompleteMandatory: number; exhaustedMandatory: number; maxAttempts: number; truthRule: string; recent: Array<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string; project_id: string; status: string; occurred_at: string; completed_at: string; consumer_count: number; succeeded_consumers: number }> };
  delivery: { status: string; total: number; queued: number; pending: number; deferred: number; retrying: number; providerAccepted: number; deadLetters: number; oldestQueuedAt: string; oldestQueuedAgeMinutes: number; providerReceiptCoverage: number; certifications: Array<{ channel: string; status: string; accepted: number; receipts: number }>; byChannel: Array<{ channel: string; pending: number; accepted: number; deadLetters: number }>; recent: Array<{ id: number; channel: string; eventType: string; recipient: string; status: string; attempts: number; provider: string; providerReceiptId: string; providerStatus: number; createdAt: string; acceptedAt: string; nextAttemptAt: string; error: string }>; truthRule: string };
  microsoftWebhook: { status: string; activeSubscriptions: number; nextExpirationAt: string; lastValidNotificationAt: string; rejectedAttempts24h: number; rateLimitedAttempts24h: number; lastRejectedAt: string; lastRejectedReason: string; openValidationWindows: number; lastValidationAt: string; protection: string };
  platformEvidence: EvidenceCheck[];
  connections: Connection[];
  events: IntegrationRecord[];
  conflicts: IntegrationRecord[];
  maintenance: IntegrationRecord[];
  replays: IntegrationRecord[];
  incidents: IntegrationRecord[];
  policy: { safeguards: { automatic: readonly string[]; prohibited: readonly string[]; cadence: string; maintenance: string; secretStorage: string }; checklist: readonly string[]; statuses: readonly string[]; secretFolder: string; reporting: string; retention: string };
};

type ModalMode = "configure" | "health" | "maintenance" | "conflict" | "replay" | "incident" | "acknowledge-incident" | "resolve-conflict" | "decide-replay" | "replay-result" | "close-incident" | "complete-maintenance";

const blankDraft = {
  primaryOwnerName: "",
  primaryOwnerEmail: "",
  backupOwnerName: "",
  backupOwnerEmail: "",
  reconnectors: "",
  providerStatusUrl: "",
  oneDriveFolder: "SharePoint / Mefford Contracting / Restricted / Integration Recovery Records",
  notes: "",
  environment: "Test",
  checklist: [] as string[],
  status: "Not Configured",
  cause: "",
  impact: "",
  affectedProjectIds: "",
  sourceCount: "0",
  importedCount: "0",
  skippedCount: "0",
  failedCount: "0",
  duplicatesPrevented: "0",
  sampleRecordIds: "",
  maintenanceDate: "",
  expectedEndTime: "04:00",
  reason: "",
  providerReference: "",
  sourceVersion: "",
  commandVersion: "",
  resolution: "Reviewed Merge",
  resolutionNote: "",
  decision: "Approved",
};

export function IntegrationHealthWorkspace() {
  const [data, setData] = useState<IntegrationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"Overview" | "Sections" | "Workflows" | "Connections" | "Microsoft Files" | "Automation" | "Delivery" | "Exceptions" | "Maintenance" | "Audit">("Overview");
  const [selectedKey, setSelectedKey] = useState("");
  const [modal, setModal] = useState<{ mode: ModalMode; recordId?: string } | null>(null);
  const [draft, setDraft] = useState(blankDraft);

  const selected = data?.connections.find((item) => item.key === selectedKey) || data?.connections[0];
  const openRecords = useMemo(() => [
    ...(data?.conflicts.filter((item) => item.status === "Quarantined") || []),
    ...(data?.replays.filter((item) => !["Completed", "Rejected"].includes(item.status)) || []),
    ...(data?.incidents.filter((item) => item.status === "Open") || []),
  ], [data]);

  useEffect(() => { void load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/integration-health", { cache: "no-store" });
      const result = await response.json() as IntegrationResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "IT & Integrations Is Unavailable");
      setData(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "IT & Integrations Is Unavailable");
    } finally { setLoading(false); }
  }

  async function runDeliveryTest() {
    setSaving(true);
    try {
      const response = await fetch("/api/integration-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test-delivery" }) });
      const result = await response.json() as { error?: string; response?: IntegrationResponse; test?: { email?: { outcome?: string }; push?: { status?: string } } };
      if (!response.ok) throw new Error(result.error || "The Controlled Delivery Test Could Not Run");
      if (result.response) setData(result.response);
      setNotice(`Controlled test complete · Email ${result.test?.email?.outcome || "No Evidence"} · Push ${result.test?.push?.status || "No Evidence"}.`);
      window.setTimeout(() => setNotice(""), 6000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Controlled Delivery Test Could Not Run");
    } finally { setSaving(false); }
  }

  function openModal(mode: ModalMode, connection = selected, recordId = "") {
    const value = connection?.data || {};
    setDraft({
      ...blankDraft,
      primaryOwnerName: String(value.primaryOwnerName || ""),
      primaryOwnerEmail: String(value.primaryOwnerEmail || ""),
      backupOwnerName: String(value.backupOwnerName || ""),
      backupOwnerEmail: String(value.backupOwnerEmail || ""),
      reconnectors: Array.isArray(value.reconnectors) ? value.reconnectors.join(", ") : "",
      providerStatusUrl: String(value.providerStatusUrl || connection?.providerStatusUrl || ""),
      oneDriveFolder: String(value.oneDriveFolder || data?.policy.secretFolder || blankDraft.oneDriveFolder),
      notes: String(value.notes || ""),
      environment: String(value.environment || "Test"),
      checklist: Array.isArray(value.checklist) ? value.checklist.map(String) : [],
      status: connection?.status === "Connected" ? "Degraded" : connection?.status || "Not Configured",
      affectedProjectIds: Array.isArray(value.affectedProjectIds) ? value.affectedProjectIds.join(", ") : "",
    });
    if (connection) setSelectedKey(connection.key);
    setModal({ mode, recordId });
  }

  async function submit() {
    if (!modal || !selected) return;
    const action = ({ configure: "save-connection", health: "record-health", maintenance: "schedule-maintenance", conflict: "report-conflict", replay: "request-replay", incident: "open-incident", "acknowledge-incident": "acknowledge-incident", "resolve-conflict": "resolve-conflict", "decide-replay": "decide-replay", "replay-result": "record-replay-result", "close-incident": "close-incident", "complete-maintenance": "complete-maintenance" } as const)[modal.mode];
    setSaving(true);
    setNotice("");
    try {
      const payload = {
        action,
        integrationKey: selected.key,
        recordId: modal.recordId,
        ...draft,
        reconnectors: split(draft.reconnectors),
        affectedProjectIds: split(draft.affectedProjectIds),
        sourceCount: Number(draft.sourceCount),
        importedCount: Number(draft.importedCount),
        skippedCount: Number(draft.skippedCount),
        failedCount: Number(draft.failedCount),
        duplicatesPrevented: Number(draft.duplicatesPrevented),
      };
      const response = await fetch("/api/integration-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; response?: IntegrationResponse };
      if (!response.ok) throw new Error(result.error || "The Integration Action Could Not Be Saved");
      if (result.response) setData(result.response);
      else await load();
      setModal(null);
      setNotice(actionNotice(action));
      window.setTimeout(() => setNotice(""), 4200);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Integration Action Could Not Be Saved"); }
    finally { setSaving(false); }
  }

  if (loading && !data) return <div className="integration-loading"><span /><b>Loading IT & Integrations Center…</b></div>;
  if (!data) return <section className="integration-empty"><h2>IT & Integrations Is Unavailable</h2><p>{notice || "The company integration register could not be loaded."}</p><button onClick={() => void load()}>Try Again</button></section>;

  return (
    <div className="integration-health-workspace">
      {notice ? <div className="integration-notice" role="status">{notice}</div> : null}
      <section className="integration-hero">
        <div className={`integration-orb ${data.system.color.toLowerCase()}`}><span>{data.system.color === "Green" ? "OK" : data.system.color === "Yellow" ? "!" : "×"}</span><b>{data.system.color}</b></div>
        <div><h1>IT & Integrations Center</h1></div>
        <div className="integration-hero-actions"><button onClick={() => void load()}>↻ Reconcile Now</button><small>Checked {dateTime(data.system.lastReconciledAt)}</small></div>
      </section>

      <section className="integration-stats" aria-label="Integration health summary">
        <button {...summaryDrilldownProps({ title: "Application Section Readiness", rows: data.application.sections.map((section) => ({ id: section.id, title: section.name, subtitle: `${section.scope} · ${section.verifiedEvidence}/${section.requiredEvidence} required evidence verified`, status: section.status, meta: section.connectionBoundary, onOpen: () => setTab("Sections"), openLabel: "Open Sections →" })) })}><span>Verified Sections</span><b>{data.application.verified}/{data.application.total}</b><small>{data.application.unknown} unknown · {data.application.failed} failed</small></button>
        <button {...summaryDrilldownProps({ title: "Operational Connections", rows: data.connections.map((connection) => ({ id: connection.key, title: connection.name, subtitle: `${connection.category} · ${String(connection.data.primaryOwnerName || "Owner Unassigned")}`, status: connection.status, meta: connection.data.lastSuccessfulAt ? `Last success ${dateTime(String(connection.data.lastSuccessfulAt))}` : String(connection.data.cause || "No successful connection evidence"), onOpen: () => { setSelectedKey(connection.key); setTab("Connections"); }, openLabel: "Open Connection →" })) })}><span>Connections</span><b>{data.system.visibleConnections}</b><small>{data.system.counts.Connected || 0} connected</small></button>
        <button onClick={() => setTab("Microsoft Files")}><span>Microsoft Files</span><b>SP</b><small>Blueprint + no-delete control</small></button>
        <button {...summaryDrilldownProps({ title: "Scheduled Operations", rows: data.automation.jobs.map((job) => ({ id: job.name, title: job.label, subtitle: `${job.cadence} · ${job.observedRuns24h}/${job.expectedRuns24h} runs`, status: job.status, value: `${job.failedRuns24h} failed`, meta: job.error || (job.lastSuccessAt ? `Last success ${dateTime(job.lastSuccessAt)}` : "Awaiting first success"), onOpen: () => setTab("Automation"), openLabel: "Open Automation →" })) })}><span>Scheduled Operations</span><b className={`automation-overall status-${slug(data.automation.overall)}`}>{data.automation.overall === "Awaiting First Run" ? "WAIT" : data.automation.overall.toUpperCase()}</b><small>{data.automation.failureCount24h} failed in 24 hours</small></button>
        <button {...summaryDrilldownProps({ title: "External Delivery Queue", rows: data.delivery.recent.filter((item) => !["Accepted", "Sent", "Complete"].includes(item.status)).map((item) => ({ id: String(item.id), title: item.eventType, subtitle: `${item.channel} · Created ${dateTime(item.createdAt)}`, status: item.status, value: `${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`, meta: item.error || item.providerReceiptId || "Awaiting provider receipt", onOpen: () => setTab("Delivery"), openLabel: "Open Delivery →" })) })}><span>External Delivery</span><b className={`automation-overall status-${slug(data.delivery.status)}`}>{data.delivery.pending}</b><small>{data.delivery.deadLetters} dead letters · oldest {data.delivery.oldestQueuedAgeMinutes}m</small></button>
        <button {...summaryDrilldownProps({ title: "Open Integration Conflicts", rows: data.conflicts.filter((item) => item.status === "Quarantined").map((item) => ({ id: item.id, title: item.title, subtitle: item.meta, status: item.status, meta: `${item.owner} · Due ${item.due}`, onOpen: () => setTab("Exceptions"), openLabel: "Open Exceptions →" })) })}><span>Open Conflicts</span><b>{data.system.openConflicts}</b><small>Both versions preserved</small></button>
        <button {...summaryDrilldownProps({ title: "Open Provider Incidents", rows: data.incidents.filter((item) => item.status === "Open").map((item) => ({ id: item.id, title: item.title, subtitle: item.meta, status: item.status, meta: `${item.owner} · Due ${item.due}`, onOpen: () => setTab("Exceptions"), openLabel: "Open Exceptions →" })) })}><span>Provider Incidents</span><b>{data.system.openIncidents}</b><small>Safe queue controlled</small></button>
        <button onClick={() => setTab("Maintenance")}><span>Next Window</span><b>Sat</b><small>12:00–6:00 AM ET</small></button>
      </section>

      <nav className="integration-tabs" aria-label="IT and Integrations sections">
        {(["Overview", "Sections", "Workflows", "Connections", "Microsoft Files", "Automation", "Delivery", "Exceptions", "Maintenance", "Audit"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}{item === "Exceptions" && openRecords.length ? <b>{openRecords.length}</b> : null}{item === "Delivery" && data.delivery.deadLetters ? <b>{data.delivery.deadLetters}</b> : null}</button>)}
      </nav>

      {tab === "Overview" ? <IntegrationOverview data={data} onSelect={(connection) => { setSelectedKey(connection.key); setTab("Connections"); }} /> : null}
      {tab === "Sections" ? <SectionReadinessPanel data={data} /> : null}
      {tab === "Workflows" ? <SystemWorkflowAuditPanel data={data} /> : null}
      {tab === "Connections" ? (
        <div className="integration-connection-layout">
          <aside>{data.connections.map((connection) => <button key={connection.key} className={selected?.key === connection.key ? "active" : ""} onClick={() => setSelectedKey(connection.key)}><span className={`integration-mark status-${slug(connection.status)}`}>{connection.shortName}</span><span><b>{connection.name}</b><small>{connection.category}</small></span><i className={`status-dot-label status-${slug(connection.status)}`}>{connection.status}</i></button>)}</aside>
          {selected ? <ConnectionDetail connection={selected} data={data} onAction={(mode) => openModal(mode, selected)} /> : null}
        </div>
      ) : null}
      {tab === "Microsoft Files" ? <MicrosoftFilesControl /> : null}
      {tab === "Automation" ? <AutomationPanel data={data} /> : null}
      {tab === "Delivery" ? <DeliveryControlPanel data={data} saving={saving} onTest={() => void runDeliveryTest()} /> : null}
      {tab === "Exceptions" ? <ExceptionsPanel data={data} onOpen={(mode, record) => { const key = String(record.data.integrationKey || ""); const connection = data.connections.find((item) => item.key === key) || selected; openModal(mode, connection, record.id); }} /> : null}
      {tab === "Maintenance" ? <MaintenancePanel data={data} selected={selected} onSchedule={(connection) => openModal("maintenance", connection)} onComplete={(record) => { const key = String(record.data.integrationKey || ""); openModal("complete-maintenance", data.connections.find((item) => item.key === key) || selected, record.id); }} /> : null}
      {tab === "Audit" ? <AuditPanel data={data} /> : null}

      {modal ? <IntegrationModal mode={modal.mode} draft={draft} setDraft={setDraft} selected={selected} data={data} saving={saving} onClose={() => setModal(null)} onSubmit={() => void submit()} /> : null}
    </div>
  );
}

function IntegrationOverview({ data, onSelect }: { data: IntegrationResponse; onSelect: (connection: Connection) => void }) {
  const attention = data.connections.filter((item) => item.status !== "Connected");
  return <div className="integration-overview">
    <section className="integration-panel integration-attention"><header><div><h2>{attention.length ? `${attention.length} Connections Need Attention` : "Every Connection Is Healthy"}</h2></div><span className={`integration-pill ${data.system.color.toLowerCase()}`}>{data.system.color}</span></header><div className="integration-rows">{data.connections.map((connection) => <button key={connection.key} onClick={() => onSelect(connection)}><span className={`integration-mark status-${slug(connection.status)}`}>{connection.shortName}</span><span><b>{connection.name}</b><small>{String(connection.data.cause || connection.purpose)}</small></span><i className={`status-dot-label status-${slug(connection.status)}`}>{connection.status}</i><em>›</em></button>)}</div></section>

  </div>;
}

function AutomationPanel({ data }: { data: IntegrationResponse }) {
  return <div className="automation-health-layout">
    <section className="integration-panel scheduler-trigger-evidence"><header><div><h2>Mandatory Handoff Ledger</h2><span>{data.handoffs.truthRule}</span></div><b className={`status-dot-label status-${slug(data.handoffs.status)}`}>{data.handoffs.status}</b></header><div><article><small>COMPLETE EVENTS</small><strong>{data.handoffs.completed}/{data.handoffs.total}</strong><span>Every mandatory consumer reconciled</span></article><article><small>PARTIALLY APPLIED</small><strong>{data.handoffs.partiallyApplied}</strong></article><article><small>MANDATORY RESULTS OPEN</small><strong>{data.handoffs.incompleteMandatory}</strong></article><article><small>EXHAUSTED</small><strong>{data.handoffs.exhaustedMandatory}</strong><span>Escalated after {data.handoffs.maxAttempts} bounded attempts</span></article></div></section>
    <section className="integration-panel scheduler-trigger-evidence"><header><div><h2>Independent Platform Scheduler</h2><span>{data.automation.trigger.source}</span></div><b className={`status-dot-label status-${slug(data.automation.trigger.status)}`}>{data.automation.trigger.status}</b></header><div><article><small>PLATFORM RECEIPTS</small><strong>{data.automation.trigger.observedRuns24h}/{data.automation.trigger.expectedRuns24h}</strong><span>Expected five-minute triggers observed during the measured window</span></article><article><small>LAST PLATFORM TRIGGER</small><strong>{data.automation.trigger.lastPlatformTriggerAt ? dateTime(data.automation.trigger.lastPlatformTriggerAt) : "No Proof Yet"}</strong><span>{data.automation.trigger.error || "The platform trigger is current and independently recorded."}</span></article><article><small>SAFETY FALLBACK</small><strong>{data.automation.trigger.lastFallbackTriggerAt ? dateTime(data.automation.trigger.lastFallbackTriggerAt) : "Not Needed"}</strong></article><article><small>RECOVERY QUEUES</small><strong>{data.automation.openGapSlots} Gaps · {data.automation.openDeadLetters} Dead Letters</strong></article></div></section>
    <section className="integration-panel scheduler-trigger-evidence"><header><div><h2>Durable Scheduler Cursor &amp; Recovery</h2></div><b className={`status-dot-label status-${data.automation.boundedExecution.canceledCheckpoints24h || data.automation.boundedExecution.failedCheckpoints24h ? "failed" : "healthy"}`}>{data.automation.boundedExecution.canceledCheckpoints24h || data.automation.boundedExecution.failedCheckpoints24h ? "Recovery Required" : "Bounded"}</b></header><div><article><small>TIME BUDGET</small><strong>{(data.automation.boundedExecution.timeBudgetMs / 1000).toFixed(1)} sec</strong></article><article><small>GROUP LIMIT</small><strong>{data.automation.boundedExecution.maxGroupsPerInvocation}</strong><span>Operation group per five-minute invocation</span></article><article><small>CHECKPOINTS · 24H</small><strong>{data.automation.boundedExecution.completedCheckpoints24h}</strong><span>Durably completed operation groups</span></article><article><small>CANCELED / FAILED · 24H</small><strong>{data.automation.boundedExecution.canceledCheckpoints24h} / {data.automation.boundedExecution.failedCheckpoints24h}</strong></article></div></section>
    <section className="integration-panel automation-register"><header><div><h2>Permanent Run And Failure Ledger</h2><span>{data.automation.cadence} · {data.automation.retention}</span></div><b className={`status-dot-label status-${slug(data.automation.overall)}`}>{data.automation.overall}</b></header><div>{data.automation.jobs.map((job) => <article key={job.name}><span className={`automation-job-mark status-${slug(job.status)}`}>{job.status === "Healthy" ? "OK" : job.status === "Failed" ? "×" : job.status === "Late" ? "!" : "…"}</span><div><h3>{job.label}</h3><p>{job.cadence} · {job.observedRuns24h}/{job.expectedRuns24h} expected execution slots observed</p><small>{job.error || (job.lastSuccessAt ? `Last success ${dateTime(job.lastSuccessAt)}` : "Waiting for the first eligible scheduled trigger")}</small>{job.stuckRuns ? <small className="automation-stuck">{job.stuckRuns} stuck · oldest {Math.round(job.oldestStuckAgeMinutes)} minutes</small> : null}</div><i className={`status-dot-label status-${slug(job.status)}`}>{job.status}</i><time>{job.lastRunAt ? `${job.attempts} attempt${job.attempts === 1 ? "" : "s"} · ${job.durationMs} ms` : "No run yet"}</time></article>)}</div></section>
    <section className="integration-panel automation-history"><header><div><h2>Isolated Retries And Outcomes</h2></div><b>{data.automation.recentRuns.length} Runs</b></header><div>{data.automation.recentRuns.length ? data.automation.recentRuns.map((run) => <article key={run.id}><time>{dateTime(run.scheduledAt)}</time><span className={`audit-icon status-${slug(run.status)}`}>{run.status === "Succeeded" ? "OK" : "×"}</span><div><h3>{run.jobName.replaceAll("-", " ")}</h3><p>{run.error || `${run.durationMs} ms · ${run.attempts} attempt${run.attempts === 1 ? "" : "s"}`}</p><small>{run.status} · Completed {dateTime(run.completedAt)}</small></div></article>) : <div className="integration-zero">The scheduler is registered. Run evidence will appear after the first eligible five-minute trigger.</div>}</div></section>
  </div>;
}

function DeliveryControlPanel({ data, saving, onTest }: { data: IntegrationResponse; saving: boolean; onTest: () => void }) {
  const delivery = data.delivery;
  return <div className="delivery-control-layout">
    <section className="delivery-truth-banner"><div><h2>Provider Evidence, Not Assumed Delivery</h2><span>{delivery.truthRule}</span></div><div className="delivery-truth-actions"><b className={`status-dot-label status-${slug(delivery.status)}`}>{delivery.status}</b>{data.actor.canConfigure ? <button disabled={saving} onClick={onTest}>{saving ? "Testing…" : "Run Controlled Email + Push Test"}</button> : null}</div></section>
    <section className="delivery-metrics">
      <article {...summaryDrilldownProps({ title: "Pending External Deliveries", rows: delivery.recent.filter((event) => ["Queued", "Pending", "Deferred", "Retrying"].includes(event.status)).map((event) => ({ id: String(event.id), title: `${event.eventType} · ${event.recipient}`, subtitle: `${event.channel} · ${event.provider || "Provider Pending"}`, status: event.status, meta: `${event.attempts} attempt(s)${event.nextAttemptAt ? ` · Next ${dateTime(event.nextAttemptAt)}` : ""}` })) })}><small>PENDING</small><strong>{delivery.pending}</strong><span>{delivery.queued} new · {delivery.deferred} deferred · {delivery.retrying} retrying</span></article>
      <article {...summaryDrilldownProps({ title: "Oldest Pending External Delivery", rows: delivery.recent.filter((event) => ["Queued", "Pending", "Deferred", "Retrying"].includes(event.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 1).map((event) => ({ id: String(event.id), title: `${event.eventType} · ${event.recipient}`, subtitle: `${event.channel} · Created ${dateTime(event.createdAt)}`, status: event.status, meta: event.error || `${event.attempts} attempt(s)` })) })}><small>OLDEST PENDING</small><strong>{delivery.oldestQueuedAt ? `${delivery.oldestQueuedAgeMinutes} min` : "None"}</strong><span>{delivery.oldestQueuedAt ? dateTime(delivery.oldestQueuedAt) : "No pending external delivery"}</span></article>
      <article {...summaryDrilldownProps({ title: "Provider-Accepted Deliveries", rows: delivery.recent.filter((event) => event.status === "Provider Accepted" || Boolean(event.acceptedAt)).map((event) => ({ id: String(event.id), title: `${event.eventType} · ${event.recipient}`, subtitle: `${event.channel} · ${event.provider}`, status: event.status, meta: event.providerReceiptId ? `Receipt ${event.providerReceiptId} · HTTP ${event.providerStatus}` : "Provider receipt missing" })) })}><small>PROVIDER ACCEPTED</small><strong>{delivery.providerAccepted}</strong><span>{delivery.providerReceiptCoverage}% retain a provider receipt</span></article>
      <article {...summaryDrilldownProps({ title: "External Delivery Dead Letters", rows: delivery.recent.filter((event) => ["Dead Letter", "Failed Permanent", "Exhausted"].includes(event.status)).map((event) => ({ id: String(event.id), title: `${event.eventType} · ${event.recipient}`, subtitle: `${event.channel} · ${event.provider || "Provider Unknown"}`, status: event.status, meta: event.error || `${event.attempts} attempts exhausted` })) })}><small>DEAD LETTERS</small><strong>{delivery.deadLetters}</strong><span>{delivery.deadLetters ? "Manual IT action is required" : "No exhausted or permanent failures"}</span></article>
    </section>
    <section className="integration-panel delivery-certification"><header><div><h2>Email And Push Acceptance Tests</h2></div></header><div>{delivery.certifications.map((item) => <article key={item.channel}><span className={`delivery-channel ${item.channel.toLowerCase()}`}>{item.channel === "Email" ? "EM" : "PU"}</span><div><h3>{item.channel}</h3><p>{item.status}</p><small>{item.accepted} accepted event(s) · {item.receipts} receipt(s)</small></div><b className={`status-dot-label status-${slug(item.status)}`}>{item.receipts ? "Certified" : "Awaiting Test"}</b></article>)}</div></section>
    <section className="integration-panel delivery-ledger"><header><div><h2>Queue, Retry, Deferral And Receipt Evidence</h2></div><b>{delivery.recent.length} Recent</b></header><div>{delivery.recent.length ? delivery.recent.map((event) => <article key={event.id}><time>{dateTime(event.createdAt)}</time><span className={`delivery-channel ${event.channel.toLowerCase()}`}>{event.channel === "Email" ? "EM" : "PU"}</span><div><h3>{event.eventType} · {event.recipient}</h3><p>{event.providerReceiptId ? `${event.provider || event.channel} receipt ${event.providerReceiptId} · HTTP ${event.providerStatus}` : event.error || "Waiting for the delivery processor"}</p><small>{event.attempts} attempt(s){event.nextAttemptAt ? ` · Next ${dateTime(event.nextAttemptAt)}` : ""}{event.acceptedAt ? ` · Accepted ${dateTime(event.acceptedAt)}` : ""}</small></div><b className={`status-dot-label status-${slug(event.status)}`}>{event.status}</b></article>) : <div className="integration-zero">No external delivery events exist yet. Certification begins with the first controlled test.</div>}</div></section>
  </div>;
}

function SectionReadinessPanel({ data }: { data: IntegrationResponse }) {
  return <div className="section-readiness-layout">
    <section className="section-readiness-hero"><div><h2>Application Section Status</h2><span>{data.application.principle}</span></div><strong {...summaryDrilldownProps({ title: "Verified Application Sections", rows: data.application.sections.filter((section) => section.status === "Verified").map((section) => ({ id: section.id, title: section.name, subtitle: `${section.scope} · ${section.verifiedEvidence}/${section.requiredEvidence} evidence`, status: section.status, meta: section.connectionBoundary })) })}>{data.application.verified}/{data.application.total}<small>VERIFIED SECTIONS</small></strong><div className="section-status-summary"><b {...summaryDrilldownProps({ title: "Failed Application Sections", rows: data.application.sections.filter((section) => section.status === "Failed").map((section) => ({ id: section.id, title: section.name, subtitle: section.scope, status: section.status, meta: section.connectionBoundary })) })}>{data.application.failed} Failed</b><b {...summaryDrilldownProps({ title: "Degraded Application Sections", rows: data.application.sections.filter((section) => section.status === "Degraded").map((section) => ({ id: section.id, title: section.name, subtitle: section.scope, status: section.status, meta: section.connectionBoundary })) })}>{data.application.degraded} Degraded</b><b {...summaryDrilldownProps({ title: "Unknown Application Sections", rows: data.application.sections.filter((section) => section.status === "Unknown").map((section) => ({ id: section.id, title: section.name, subtitle: section.scope, status: section.status, meta: section.connectionBoundary })) })}>{data.application.unknown} Unknown</b><b {...summaryDrilldownProps({ title: "Unconfigured Application Sections", rows: data.application.sections.filter((section) => section.status === "Not Configured").map((section) => ({ id: section.id, title: section.name, subtitle: section.scope, status: section.status, meta: section.connectionBoundary })) })}>{data.application.notConfigured} Not Configured</b></div></section>

    {(["Company", "Project"] as const).map((scope) => <section className="integration-panel section-readiness-register" key={scope}><header><div><p>{scope.toUpperCase()} WORKSPACES</p><h2>{scope} Section Evidence</h2></div><b>{data.application.sections.filter((section) => section.scope === scope).length} Sections</b></header><div>{data.application.sections.filter((section) => section.scope === scope).map((section) => <article key={section.id}><span className={`section-evidence-mark status-${slug(section.status)}`}>{section.status}</span><div><h3>{section.name}</h3><div className="section-evidence-score"><b>{section.verifiedEvidence}/{section.requiredEvidence} required checks verified</b><span>{section.lastObservedAt ? `Last evidence ${dateTime(section.lastObservedAt)}` : "No dated evidence"}</span></div><p><b>Persistence</b>{section.persistence}</p><p><b>Automation</b>{section.automation}</p><p><b>Human Authority</b>{section.authority}</p><EvidenceList evidence={section.evidence} /><small>{section.connectionBoundary}</small></div></article>)}</div></section>)}
  </div>;
}

function SystemWorkflowAuditPanel({ data }: { data: IntegrationResponse }) {
  return <div className="system-workflow-audit">
    <section className="workflow-audit-hero"><div><h2>{data.audit.summary.failedWorkflows ? "Failed Handoffs Require Immediate Attention" : data.audit.summary.unknownWorkflows ? "Workflow Proof Is Incomplete" : "Measured Handoffs Are Current"}</h2><span>{data.audit.principle}</span></div><div><strong>{data.audit.summary.verifiedWorkflows}/{data.audit.summary.workflows}</strong><small>VERIFIED HANDOFFS</small></div><div><strong>{data.audit.summary.failedWorkflows + data.audit.summary.degradedWorkflows}</strong><small>FAILED / DEGRADED</small></div><div><strong>{data.audit.summary.unknownWorkflows}</strong><small>UNKNOWN</small></div></section>
    <section className="integration-panel workflow-register"><header><div><h2>Upstream → Automation → Downstream</h2></div><b>{data.audit.summary.workflows} Flows</b></header><div>{data.audit.workflows.map((item) => <article key={item.id}><span className={`section-evidence-mark status-${slug(item.status)}`}>{item.status}</span><div><h3>{item.name}</h3><div className="section-evidence-score"><b>{item.verifiedEvidence}/{item.requiredEvidence} required checks verified</b><span>{item.lastObservedAt ? `Last evidence ${dateTime(item.lastObservedAt)}` : "No dated evidence"}</span></div><div className="workflow-system-chain">{item.systems.map((system, index) => <span key={system}>{index ? "→ " : ""}{system}</span>)}</div><p><b>Trigger</b>{item.trigger}</p><p><b>Automatic Handoff</b>{item.automation}</p><p><b>Result</b>{item.result}</p><p><b>Human Authority</b>{item.humanGate}</p><EvidenceList evidence={item.evidence} /><small>{item.externalBoundary}</small></div></article>)}</div></section>
    <section className="integration-panel intelligence-register"><header><div><h2>OCR Where It Helps · Native Data Where It Is Safer</h2></div><b>{data.audit.summary.verifiedIntelligenceUses}/{data.audit.summary.intelligenceUses} Verified</b></header><div>{data.audit.intelligence.map((item) => <article key={item.id}><span className={`intelligence-kind kind-${slug(item.kind)}`}>{item.kind === "Native Data" ? "DATA" : item.kind.toUpperCase()}</span><div><h3>{item.name}</h3><p><b>Intake</b>{item.intake}</p><p><b>Extracts</b>{item.extraction}</p><div className="workflow-system-chain">{item.downstream.map((system, index) => <span key={system}>{index ? "→ " : ""}{system}</span>)}</div><EvidenceList evidence={item.evidence} /><small>{item.review}</small></div><i className={`status-dot-label status-${slug(item.status)}`}>{item.status}</i></article>)}</div></section>
  </div>;
}

function EvidenceList({ evidence }: { evidence: EvidenceCheck[] }) {
  return <div className="health-evidence-list">{evidence.map((check) => <div key={check.key} className={`health-evidence-row status-${slug(check.status)}`}><i /><span><b>{check.label}{check.required ? " · Required" : " · Optional"}</b><small>{check.detail}</small><em>{check.source}{check.observedAt ? ` · ${dateTime(check.observedAt)}` : " · Not observed"}{check.expiresAt ? ` · Expires ${dateTime(check.expiresAt)}` : ""}</em></span><strong>{check.status}</strong></div>)}</div>;
}

function ConnectionDetail({ connection, data, onAction }: { connection: Connection; data: IntegrationResponse; onAction: (mode: ModalMode) => void }) {
  const reconciliation = connection.data.reconciliation as Record<string, unknown> | undefined;
  const checklist = Array.isArray(connection.data.checklist) ? connection.data.checklist : [];
  const implemented = connection.runtime?.activationState !== "Not Implemented";
  const canOperate = implemented && (data.actor.canConfigure || (data.actor.role === "Accounting" && connection.sensitive));
  return <section className="integration-detail"><header><div className={`integration-mark large status-${slug(connection.status)}`}>{connection.shortName}</div><div><p>{connection.category}{connection.sensitive ? " · OWNER-CONTROLLED" : ""}</p><h2>{connection.name}</h2><span>{connection.purpose}</span></div><i className={`status-dot-label status-${slug(connection.status)}`}>{connection.status}</i></header>
    <div className="integration-detail-grid"><div><span>Primary Owner</span><b>{String(connection.data.primaryOwnerName || "Unassigned")}</b><small>{String(connection.data.primaryOwnerEmail || "Ownership required")}</small></div><div><span>Backup Owner</span><b>{String(connection.data.backupOwnerName || "Unassigned")}</b><small>{String(connection.data.backupOwnerEmail || "Backup required")}</small></div><div><span>Last Successful Sync</span><b>{dateTime(String(connection.data.lastSuccessfulAt || ""))}</b><small>Last checked {dateTime(String(connection.data.lastCheckedAt || ""))}</small></div><div><span>Environment</span><b>{String(connection.data.environment || "Test")}</b><small>Test and production remain isolated</small></div></div>
    <section className="integration-impact"><div><p>RUNTIME CONFIGURATION · {connection.runtime?.activationState || "Unknown"}</p><b>{connection.runtime?.detail || "Runtime configuration has not been inspected"}</b><small>{connection.runtime?.mode || "External Adapter"}{connection.runtime?.missing?.length ? ` · Missing ${connection.runtime.missing.join(", ")}` : " · Required settings present"}</small></div><div><p>OPERATIONAL IMPACT</p><b>{String(connection.data.impact || "No known operational impact")}</b><small>{String(connection.data.cause || "No recorded provider failure")}</small></div></section>
    {connection.key === "microsoft-meetings" ? <section className="integration-reconciliation integration-webhook-evidence"><header><div><h3>{data.microsoftWebhook.status}</h3></div><span>Last verified notification {dateTime(data.microsoftWebhook.lastValidNotificationAt)}</span></header><div><span><b>{data.microsoftWebhook.activeSubscriptions}</b><small>Active Subscriptions</small></span><span><b>{dateTime(data.microsoftWebhook.nextExpirationAt)}</b><small>Next Expiration</small></span><span><b>{data.microsoftWebhook.rejectedAttempts24h}</b><small>Rejected · 24 Hours</small></span><span><b>{data.microsoftWebhook.rateLimitedAttempts24h}</b><small>Rate Limited · 24 Hours</small></span><span><b>{data.microsoftWebhook.openValidationWindows}</b><small>Open Setup Windows</small></span><span><b>{dateTime(data.microsoftWebhook.lastValidationAt)}</b><small>Last Authorized Handshake</small></span></div><p>{data.microsoftWebhook.protection}{data.microsoftWebhook.lastRejectedReason ? ` · Last rejection: ${data.microsoftWebhook.lastRejectedReason} at ${dateTime(data.microsoftWebhook.lastRejectedAt)}` : " · No rejected attempt has been recorded."}</p></section> : null}
    <section className="integration-reconciliation"><header><div><h3>Source-To-Command Center Control</h3></div><span>{dateTime(String(reconciliation?.recordedAt || ""))}</span></header><div>{[["Source", reconciliation?.sourceCount], ["Imported", reconciliation?.importedCount], ["Skipped", reconciliation?.skippedCount], ["Failed", reconciliation?.failedCount], ["Duplicates Prevented", reconciliation?.duplicatesPrevented]].map(([itemLabel, value]) => <span key={String(itemLabel)}><b>{String(value ?? "—")}</b><small>{String(itemLabel)}</small></span>)}</div><p>Sample IDs: {String(reconciliation?.sampleRecordIds || "No masked samples recorded")}</p></section>
    <section className="integration-readiness"><header><p>PRODUCTION READINESS</p><b>{checklist.length}/{data.policy.checklist.length}</b></header><div className="integration-progress"><i style={{ width: `${Math.round(checklist.length / data.policy.checklist.length * 100)}%` }} /></div><small>{checklist.length === data.policy.checklist.length ? "All go-live gates recorded" : "Production stays blocked until every gate is approved"}</small></section>
    <footer>{!implemented ? <span>Inventory only · implement and test a server-side adapter before configuration or health certification.</span> : null}{implemented && data.actor.canConfigure ? <button onClick={() => onAction("configure")}>Configure & Assign</button> : null}{canOperate ? <button className="primary" onClick={() => onAction("health")}>Record Health Check</button> : null}{canOperate ? <button onClick={() => onAction("conflict")}>Quarantine Conflict</button> : null}{implemented && data.actor.canConfigure ? <button onClick={() => onAction("replay")}>Request Replay</button> : null}{canOperate ? <button onClick={() => onAction("incident")}>Provider Incident</button> : null}</footer>
    {connection.providerStatusUrl ? <a className="provider-status-link" href={connection.providerStatusUrl} target="_blank" rel="noreferrer">Open Provider Status Page ↗</a> : <span className="provider-status-link muted">Provider status page will be set during connection setup</span>}
  </section>;
}

function ExceptionsPanel({ data, onOpen }: { data: IntegrationResponse; onOpen: (mode: ModalMode, record: IntegrationRecord) => void }) {
  return <div className="integration-exceptions"><ExceptionGroup title="Quarantined Conflicts" subtitle="Both versions remain permanent until reviewed." records={data.conflicts} empty="No unresolved synchronization conflicts." actions={(record) => record.status === "Quarantined" ? <button onClick={() => onOpen("resolve-conflict", record)}>Resolve Conflict</button> : null} /><ExceptionGroup title="Manual Replay Approvals" subtitle="Financial and payroll replays require Accounting review and Company Owner approval." records={data.replays} empty="No manual replay requests." actions={(record) => record.status === "Pending Accounting Review" && data.actor.canReviewFinancial || record.status === "Pending Owner Approval" && data.actor.canApproveFinancial ? <button onClick={() => onOpen("decide-replay", record)}>Record Decision</button> : record.status === "Approved For Safe Replay" && data.actor.canConfigure ? <button onClick={() => onOpen("replay-result", record)}>Record Replay Result</button> : null} /><ExceptionGroup title="Provider Incidents" subtitle="Acknowledgement and resolution time are retained for IT service review; provider-caused downtime stays separately identified." records={data.incidents} empty="No provider incidents." actions={(record) => record.status === "Open" && data.actor.canConfigure ? <>{!record.data.acknowledgedAt ? <button onClick={() => onOpen("acknowledge-incident", record)}>Acknowledge & Triage</button> : null}<button onClick={() => onOpen("close-incident", record)}>Reconcile & Close</button></> : null} /></div>;
}

function ExceptionGroup({ title, subtitle, records, empty, actions }: { title: string; subtitle: string; records: IntegrationRecord[]; empty: string; actions: (record: IntegrationRecord) => React.ReactNode }) {
  return <section className="integration-panel exception-group"><header><div><h2>{title}</h2><span>{subtitle}</span></div><b>{records.filter((item) => !["Resolved", "Completed", "Closed", "Rejected"].includes(item.status)).length} Open</b></header>{records.length ? <div className="exception-list">{records.map((record) => <article key={record.id}><span className={`status-dot-label status-${slug(record.status)}`}>{record.status}</span><div><h3>{record.title}</h3><p>{record.meta}</p><small>{dateTime(record.updatedAt)} · {record.owner}</small></div>{actions(record)}</article>)}</div> : <div className="integration-zero">✓ {empty}</div>}</section>;
}

function MaintenancePanel({ data, selected, onSchedule, onComplete }: { data: IntegrationResponse; selected?: Connection; onSchedule: (connection: Connection) => void; onComplete: (record: IntegrationRecord) => void }) {
  const windows = data.maintenance;
  return <div className="integration-maintenance"><section className="maintenance-rule"><div><h2>Saturday · 12:00–6:00 AM Eastern</h2></div>{data.actor.canConfigure && selected ? <button onClick={() => onSchedule(selected)}>Schedule Maintenance</button> : null}</section><section className="integration-panel"><header><div><h2>Scheduled, Active & Completed Windows</h2></div><b>{windows.length} Records</b></header>{windows.length ? <div className="maintenance-list">{windows.map((record) => <article key={record.id}><time>{record.due}<small>{String(record.data.startTime || "00:00")}–{String(record.data.expectedEndTime || "06:00")} ET</small></time><div><h3>{record.title}</h3><p>{String(record.data.reason || record.meta)}</p><small>Scheduled by {String(record.data.scheduledBy || record.owner)} · {record.meta}</small></div><span className={`status-dot-label status-${slug(record.status)}`}>{record.status}</span>{record.status === "Active" && data.actor.canConfigure ? <button onClick={() => onComplete(record)}>Restore Now</button> : null}</article>)}</div> : <div className="integration-zero">No maintenance has been scheduled. Normal Saturday access remains available.</div>}</section></div>;
}

function AuditPanel({ data }: { data: IntegrationResponse }) {
  const all = [...data.events, ...data.conflicts, ...data.replays, ...data.incidents, ...data.maintenance].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <section className="integration-panel integration-audit"><header><div><h2>Connection Event History</h2><span>{data.policy.retention}</span></div><b>{all.length} Events</b></header><div>{all.length ? all.map((record) => <article key={record.id}><time>{dateTime(record.updatedAt)}</time><span className={`audit-icon status-${slug(record.status)}`}>{record.type.includes("Conflict") ? "CF" : record.type.includes("Replay") ? "RP" : record.type.includes("Maintenance") ? "MW" : record.type.includes("Incident") ? "IN" : "EV"}</span><div><h3>{record.title}</h3><p>{record.meta}</p><small>{record.owner} · {record.status}</small></div></article>) : <div className="integration-zero">No integration events have been recorded.</div>}</div></section>;
}

function IntegrationModal({ mode, draft, setDraft, selected, data, saving, onClose, onSubmit }: { mode: ModalMode; draft: typeof blankDraft; setDraft: React.Dispatch<React.SetStateAction<typeof blankDraft>>; selected?: Connection; data: IntegrationResponse; saving: boolean; onClose: () => void; onSubmit: () => void }) {
  const update = (key: keyof typeof blankDraft, value: string | string[]) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="integration-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="integration-modal" role="dialog" aria-modal="true" aria-label={modalTitle(mode)}><header><div><p>{selected?.name || "INTEGRATION CONTROL"}</p><h2>{modalTitle(mode)}</h2></div><button onClick={onClose} aria-label="Close">×</button></header><div className="integration-form">
    {mode === "configure" ? <><label>Primary Owner Name<input value={draft.primaryOwnerName} onChange={(e) => update("primaryOwnerName", e.target.value)} /></label><label>Primary Owner Email<input type="email" value={draft.primaryOwnerEmail} onChange={(e) => update("primaryOwnerEmail", e.target.value)} /></label><label>Backup Owner Name<input value={draft.backupOwnerName} onChange={(e) => update("backupOwnerName", e.target.value)} /></label><label>Backup Owner Email<input type="email" value={draft.backupOwnerEmail} onChange={(e) => update("backupOwnerEmail", e.target.value)} /></label><label className="wide">Authorized Reconnectors<input value={draft.reconnectors} onChange={(e) => update("reconnectors", e.target.value)} placeholder="Emails separated by commas" /></label><label>Environment<select value={draft.environment} onChange={(e) => update("environment", e.target.value)}><option>Test</option><option>Production</option></select></label><label>Provider Status Page<input type="url" value={draft.providerStatusUrl} onChange={(e) => update("providerStatusUrl", e.target.value)} /></label><label className="wide">Restricted SharePoint Recovery Records Folder<input value={draft.oneDriveFolder} onChange={(e) => update("oneDriveFolder", e.target.value)} /><small>Recovery instructions and rotation records only. Active credentials remain encrypted in platform secret storage.</small></label><fieldset className="wide"><legend>Go-Live Checklist</legend>{data.policy.checklist.map((item) => <label className="check" key={item}><input type="checkbox" checked={draft.checklist.includes(item)} onChange={() => update("checklist", draft.checklist.includes(item) ? draft.checklist.filter((value) => value !== item) : [...draft.checklist, item])} /><span>{item}</span></label>)}</fieldset><label className="wide">Configuration Notes<textarea rows={3} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label></> : null}
    {mode === "health" ? <><label>Status<select value={draft.status} onChange={(e) => update("status", e.target.value)}>{data.policy.statuses.filter((item) => item !== "Connected").map((item) => <option key={item}>{item}</option>)}</select></label><label>Affected Project Numbers<input value={draft.affectedProjectIds} onChange={(e) => update("affectedProjectIds", e.target.value)} placeholder="26-001, 26-004" /></label><label className="wide">Cause<textarea rows={3} value={draft.cause} onChange={(e) => update("cause", e.target.value)} placeholder="Required for any degraded or failed condition" /></label><label className="wide">Operational Impact<textarea rows={3} value={draft.impact} onChange={(e) => update("impact", e.target.value)} /></label><div className="integration-warning wide"><b>Connected cannot be selected manually.</b><span>Only a server-executed provider test or verified provider event with reconciliation evidence can establish a Connected status.</span></div><ReconciliationFields draft={draft} update={update} /></> : null}
    {mode === "maintenance" ? <><label>Saturday Date<input type="date" value={draft.maintenanceDate} onChange={(e) => update("maintenanceDate", e.target.value)} /></label><label>Expected Completion<input type="time" value={draft.expectedEndTime} onChange={(e) => update("expectedEndTime", e.target.value)} /></label><label className="wide">Maintenance Scope And Reason<textarea rows={5} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label><div className="integration-warning wide"><b>Window begins at 12:00 AM Eastern.</b><span>Anything expected after 6:00 AM creates an all-user in-app and email warning.</span></div></> : null}
    {mode === "conflict" ? <><label>Affected Project Numbers<input value={draft.affectedProjectIds} onChange={(e) => update("affectedProjectIds", e.target.value)} /></label><label className="wide">Conflict Description<textarea rows={3} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label><label className="wide">Provider / Source Version<textarea rows={4} value={draft.sourceVersion} onChange={(e) => update("sourceVersion", e.target.value)} /></label><label className="wide">Existing Command Center Version<textarea rows={4} value={draft.commandVersion} onChange={(e) => update("commandVersion", e.target.value)} /></label></> : null}
    {mode === "replay" ? <><label className="wide">Specific Replay Reason<textarea rows={5} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label><div className="integration-warning wide"><b>Duplicate prevention is mandatory.</b><span>Financial and payroll replays route through Accounting review and Company Owner approval.</span></div></> : null}
    {mode === "incident" ? <><label className="wide">Provider Incident Reference<input value={draft.providerReference} onChange={(e) => update("providerReference", e.target.value)} placeholder="Provider incident number or status update" /></label><label className="wide">Outage And Operational Impact<textarea rows={4} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label><label className="wide">Temporary Operating Instructions<textarea rows={4} value={draft.notes} onChange={(e) => update("notes", e.target.value)} /></label></> : null}
    {mode === "acknowledge-incident" ? <><label className="wide">Initial Assessment And Immediate Response<textarea rows={6} value={draft.reason} onChange={(e) => update("reason", e.target.value)} placeholder="Record what was confirmed, who is affected, the temporary operating plan, and the next checkpoint." /></label><div className="integration-warning wide"><b>This starts the response clock evidence.</b><span>Provider outage duration remains separate from IT acknowledgement, communication, reconciliation, and recovery work.</span></div></> : null}
    {mode === "resolve-conflict" ? <><label>Resolution<select value={draft.resolution} onChange={(e) => update("resolution", e.target.value)}><option>Reviewed Merge</option><option>Source Version Accepted</option><option>Command Center Version Accepted</option></select></label><label className="wide">Resolution Basis<textarea rows={5} value={draft.resolutionNote} onChange={(e) => update("resolutionNote", e.target.value)} /></label><div className="integration-warning wide"><b>Both originals remain permanent.</b><span>The resolution creates a new audited outcome and never deletes either source.</span></div></> : null}
    {mode === "decide-replay" ? <><label>Decision<select value={draft.decision} onChange={(e) => update("decision", e.target.value)}><option>Approved</option><option>Rejected</option></select></label><label className="wide">Decision Note<textarea rows={5} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label></> : null}
    {mode === "replay-result" || mode === "close-incident" ? <><label className="wide">Completion / Reconciliation Note<textarea rows={4} value={draft.reason} onChange={(e) => update("reason", e.target.value)} /></label><ReconciliationFields draft={draft} update={update} /></> : null}
    {mode === "complete-maintenance" ? <><label className="wide">Restoration And Verification Note<textarea rows={6} value={draft.reason} onChange={(e) => update("reason", e.target.value)} placeholder="Record what was completed, what was tested, and the actual restoration time." /></label></> : null}
  </div><footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={saving} onClick={onSubmit}>{saving ? "Recording…" : modalButton(mode)}</button></footer></section></div>;
}

function ReconciliationFields({ draft, update }: { draft: typeof blankDraft; update: (key: keyof typeof blankDraft, value: string | string[]) => void }) {
  return <fieldset className="wide reconciliation-fields"><legend>Reconciliation Proof</legend>{(["sourceCount", "importedCount", "skippedCount", "failedCount", "duplicatesPrevented"] as const).map((key) => <label key={key}>{label(key)}<input type="number" min="0" value={draft[key]} onChange={(e) => update(key, e.target.value)} /></label>)}<label className="wide">Sample Record IDs (Masked In Audit)<input value={draft.sampleRecordIds} onChange={(e) => update("sampleRecordIds", e.target.value)} /></label></fieldset>;
}

function modalTitle(mode: ModalMode) { return ({ configure: "Configure Connection", health: "Record Health & Reconciliation", maintenance: "Schedule Saturday Maintenance", conflict: "Quarantine Sync Conflict", replay: "Request Manual Replay", incident: "Open Provider Incident", "acknowledge-incident": "Acknowledge & Triage Incident", "resolve-conflict": "Resolve Quarantined Conflict", "decide-replay": "Decide Replay Approval", "replay-result": "Record Safe Replay Result", "close-incident": "Reconcile & Close Incident", "complete-maintenance": "Restore Service Early" })[mode]; }
function modalButton(mode: ModalMode) { return ({ configure: "Save Controlled Configuration", health: "Record Health Check", maintenance: "Schedule Window", conflict: "Quarantine Sync Conflict", replay: "Route Replay Request", incident: "Open Incident & Safe Queue", "acknowledge-incident": "Record Acknowledgement", "resolve-conflict": "Record Audited Resolution", "decide-replay": "Record Decision", "replay-result": "Complete Safe Replay", "close-incident": "Close After Reconciliation", "complete-maintenance": "Restore Service Now" })[mode]; }
function actionNotice(action: string) { return ({ "save-connection": "Connection ownership and controls saved permanently.", "record-health": "Health status, impact and reconciliation proof recorded.", "schedule-maintenance": "Saturday maintenance window scheduled and audited.", "report-conflict": "Both versions are quarantined for reviewed resolution.", "request-replay": "Replay request routed through the required approvals.", "open-incident": "Provider incident opened with safe-queue controls.", "acknowledge-incident": "Incident acknowledgement, owner, and initial response time recorded.", "resolve-conflict": "Conflict resolution recorded; both originals remain permanent.", "decide-replay": "Replay approval decision recorded.", "record-replay-result": "Safe replay result and duplicate prevention recorded.", "close-incident": "Incident closed after successful reconciliation.", "complete-maintenance": "Service restoration recorded and health status resumed." } as Record<string, string>)[action] || "Integration action recorded."; }
function split(value: string) { return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function dateTime(value: string) { if (!value) return "Not Yet Recorded"; const date = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function label(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
