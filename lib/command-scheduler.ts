import { reconcileAllProjectHealthNightly } from "../app/api/project-health/route";
import { reconcileAllCloseoutAutomation } from "../app/api/closeout/route";
import { reconcileIntegrationHealth } from "../app/api/integration-health/route";
import { generateQuarterlyPerformanceCycle } from "../app/api/performance-reviews/route";
import { reconcileAssetReadiness } from "./asset-tracking";
import { syncMicrosoftDirectory } from "./microsoft-access-server";
import { reconcileMicrosoftGraphSubscriptions } from "./microsoft-subscriptions";
import { runSharePointStorageAutomation } from "./sharepoint-storage";
import { reconcileCustomerSurveyMilestones } from "./customer-voice";
import { runDeterministicMeetingRules } from "./meeting-server";
import { deliverQueuedOperationalNotices, sendMorningWorkDigests } from "./my-work";
import { maintainRuntimeFailureEvidence } from "./runtime-observability";
import { reconcileDomainOutbox } from "./domain-outbox";
import { reconcileTemplateGovernance } from "./template-governance";
import {
  beginSchedulerGroupCheckpoint,
  completeSchedulerGroupCheckpoint,
  failSchedulerGroupCheckpoint,
  loadSchedulerGroupCursor,
  prepareScheduledOperationCycle,
  recoverCanceledSchedulerGroups,
  resolveCurrentScheduleGap,
  runScheduledOperation,
  SCHEDULER_GROUP_LIMIT,
  SCHEDULER_INVOCATION_BUDGET_MS,
  type ScheduledD1Database,
  type ScheduledOperationName,
  type SchedulerTriggerSource,
} from "./scheduled-operations";

export async function runCommandSchedulerCycle(
  db: ScheduledD1Database,
  input: { source: SchedulerTriggerSource; scheduledAt: Date; cron: string; now?: Date; timeBudgetMs?: number; maxGroups?: number },
) {
  const startedAt = input.now || new Date();
  const timeBudgetMs = Math.max(1_000, Math.min(7_000, Number(input.timeBudgetMs || SCHEDULER_INVOCATION_BUDGET_MS)));
  const maxGroups = Math.max(1, Math.min(2, Number(input.maxGroups || SCHEDULER_GROUP_LIMIT)));
  await maintainRuntimeFailureEvidence(db, startedAt);
  const proposalUpgrades = await import("../app/api/proposals/route").then(({ reconcileAllEditableProposalUpgrades }) => reconcileAllEditableProposalUpgrades());
  const recoveredCanceledGroups = await recoverCanceledSchedulerGroups(db, startedAt, timeBudgetMs);
  const cycle = await prepareScheduledOperationCycle(db, input);
  const cursor = (await loadSchedulerGroupCursor(db, input.source)) % cycle.plans.length;
  const jobs = [];
  let nextGroupIndex = cursor;
  let stoppedForBudget = false;
  for (let offset = 0; offset < maxGroups; offset += 1) {
    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs >= timeBudgetMs - 750) { stoppedForBudget = true; break; }
    const groupIndex = nextGroupIndex % cycle.plans.length;
    const plan = cycle.plans[groupIndex];
    const afterIndex = (groupIndex + 1) % cycle.plans.length;
    const checkpoint = await beginSchedulerGroupCheckpoint(db, { source: input.source, scheduledAt: input.scheduledAt, groupName: plan.name, groupIndex, nextGroupIndex: afterIndex });
    try {
      const results = [];
      for (const slot of plan.slots) {
        results.push(await runScheduledOperation(db, {
          name: plan.name,
          scheduledAt: slot,
          cron: input.cron,
          maxAttempts: 2,
          leaseOwner: input.source,
        }, () => executeCommandOperation(plan.name, slot)));
      }
      const result = { ...plan, results };
      await completeSchedulerGroupCheckpoint(db, { id: checkpoint.id, source: input.source, groupName: plan.name, nextGroupIndex: afterIndex, startedAt: checkpoint.startedAt, result });
      const recoveredEveryPlannedSlot = plan.unrecoveredCount === 0
        && results.every((item) => ["Succeeded", "Already Succeeded"].includes(item.status));
      if (recoveredEveryPlannedSlot) await resolveCurrentScheduleGap(db, plan.name, new Date())
        .catch((error) => console.error(`Recovered schedule-gap alert could not be resolved: ${error instanceof Error ? error.message : String(error)}`));
      jobs.push(result);
      nextGroupIndex = afterIndex;
    } catch (error) {
      await failSchedulerGroupCheckpoint(db, { id: checkpoint.id, startedAt: checkpoint.startedAt, error });
      throw error;
    }
  }
  const durationMs = Date.now() - startedAt.getTime();
  return { ...cycle, jobs, proposalUpgrades, recoveredCanceledGroups, execution: { timeBudgetMs, maxGroups, groupsCompleted: jobs.length, cursorStartedAt: cursor, nextGroupIndex, durationMs, stoppedForBudget, resume: "Durable Scheduler Group Cursor" } };
}

function executeCommandOperation(name: ScheduledOperationName, scheduledAt: Date): Promise<unknown> {
  switch (name) {
    case "template-governance-review":
      return import("cloudflare:workers").then(({ env }) => reconcileTemplateGovernance(env.DB, scheduledAt));
    case "domain-outbox-reconciliation":
      return import("cloudflare:workers").then(({ env }) => reconcileDomainOutbox(env.DB, scheduledAt));
    case "integration-health":
      return reconcileIntegrationHealth({ nightly: scheduledAt.getUTCMinutes() === 0 && scheduledAt.getUTCHours() === 4 });
    case "microsoft-directory-sync":
      return syncMicrosoftDirectory({
        triggerSource: "Scheduled Reconciliation",
        actorName: "Command Center Scheduler",
        actorEmail: "system@command-center.internal",
      });
    case "microsoft-subscription-renewal":
      return reconcileMicrosoftGraphSubscriptions(scheduledAt);
    case "sharepoint-file-reconciliation":
      return runSharePointStorageAutomation();
    case "operational-notice-delivery":
      return deliverQueuedOperationalNotices(scheduledAt);
    case "closeout-reconciliation":
      return reconcileAllCloseoutAutomation().then(() => ({ reconciled: true }));
    case "morning-work-digests":
      return sendMorningWorkDigests(scheduledAt);
    case "meeting-rules":
      return import("./turnover-server").then(async ({ reconcileTurnovers }) => {
        const turnovers = await reconcileTurnovers(2), published = await runDeterministicMeetingRules();
        if (turnovers.pendingFailures) throw new Error(`${turnovers.pendingFailures} turnover source(s) await recovery: ${turnovers.errors.join("; ")}`);
        return { turnovers, published };
      });
    case "customer-survey-milestones":
      return reconcileCustomerSurveyMilestones(scheduledAt);
    case "asset-readiness":
      return reconcileAssetReadiness(scheduledAt);
    case "project-health-nightly":
      return reconcileAllProjectHealthNightly();
    case "quarterly-performance-reviews":
      return generateQuarterlyPerformanceCycle(scheduledAt);
  }
}
