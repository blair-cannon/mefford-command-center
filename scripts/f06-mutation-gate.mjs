import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const modules = {
  evidence: new URL("../lib/system-health-evidence.js", import.meta.url),
  scheduler: new URL("../lib/scheduler-reliability.js", import.meta.url),
  health: new URL("../lib/project-health-core.js", import.meta.url),
};

const mutations = [
  {
    name: "required failure cannot report Verified",
    module: "evidence",
    find: `if (required.some((check) => check.status === "Failed")) return "Failed";`,
    replace: `if (required.some((check) => check.status === "Failed")) return "Verified";`,
    check: (subject) => assert.equal(subject.evaluateEvidenceStatus([{ key: "db", label: "DB", status: "Failed", required: true }]), "Failed"),
  },
  {
    name: "missing evidence cannot report Verified",
    module: "evidence",
    find: `if (!required.length) return "Unknown";`,
    replace: `if (!required.length) return "Verified";`,
    check: (subject) => assert.equal(subject.evaluateEvidenceStatus([]), "Unknown"),
  },
  {
    name: "scheduler failures cannot report Healthy",
    module: "scheduler",
    find: `if (stuckRuns > 0 || timedOutRuns > 0 || failedRuns > 0) return "Failed";`,
    replace: `if (stuckRuns > 0 || timedOutRuns > 0 || failedRuns > 0) return "Healthy";`,
    check: (subject) => assert.equal(subject.schedulerEvidenceStatus({ expectedRuns: 1, terminalRuns: 1, failedRuns: 1, latestSuccessAgeMinutes: 0, maxDelayMinutes: 15 }), "Failed"),
  },
  {
    name: "scheduler without a successful run cannot report Healthy",
    module: "scheduler",
    find: `if (latestSuccessAgeMinutes === null) return "Awaiting First Run";`,
    replace: `if (latestSuccessAgeMinutes === null) return "Healthy";`,
    check: (subject) => assert.equal(subject.schedulerEvidenceStatus({ expectedRuns: 1, terminalRuns: 0, latestSuccessAgeMinutes: null, maxDelayMinutes: 15 }), "Awaiting First Run"),
  },
  {
    name: "critical health triggers always force Red",
    module: "health",
    find: `const color = criticalTriggers.length ? "Red" : numericScore`,
    replace: `const color = criticalTriggers.length ? "Green" : numericScore`,
    check: (subject) => assert.equal(subject.calculateProjectHealth(criticalHealthInput()).color, "Red"),
  },
  {
    name: "exceptions cannot suppress critical health guardrails",
    module: "health",
    find: `if (exception && !entry.critical) {`,
    replace: `if (exception) {`,
    check: (subject) => {
      const result = subject.calculateProjectHealth(criticalHealthInput());
      assert.equal(result.color, "Red");
      assert.ok(result.criticalTriggers.some((item) => item.ruleId === "financial-projected-overrun"));
    },
  },
  {
    name: "category deductions cannot erase a healthy score",
    module: "health",
    find: `const lost = Math.min(weight, factors.filter`,
    replace: `const lost = Math.max(weight, factors.filter`,
    check: (subject) => assert.equal(subject.calculateProjectHealth(healthyInput()).score, 100),
  },
];

const sources = Object.fromEntries(await Promise.all(Object.entries(modules).map(async ([name, url]) => [name, await readFile(url, "utf8")])));
let killed = 0;

for (const mutation of mutations) {
  const source = sources[mutation.module];
  if (!source.includes(mutation.find)) throw new Error(`Mutation target drifted: ${mutation.name}`);
  const original = await importDataModule(source, `${mutation.module}-original-${killed}`);
  mutation.check(original);

  const mutant = await importDataModule(source.replace(mutation.find, mutation.replace), `${mutation.module}-mutant-${killed}`);
  let detected = false;
  try {
    mutation.check(mutant);
  } catch {
    detected = true;
  }
  if (!detected) throw new Error(`F-06 mutation survived: ${mutation.name}`);
  killed += 1;
  process.stdout.write(`Killed mutation ${killed}/${mutations.length}: ${mutation.name}\n`);
}

if (killed !== mutations.length) throw new Error(`F-06 mutation score was ${killed}/${mutations.length}`);
process.stdout.write(`F-06 critical-control mutation score: ${killed}/${mutations.length} (100%)\n`);

async function importDataModule(source, label) {
  const encoded = Buffer.from(`${source}\n//# sourceURL=f06-${label}.mjs`).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${label}`);
}

function healthyInput() {
  return {
    today: "2026-08-23",
    calculatedAt: "2026-08-23T12:00:00.000Z",
    project: {
      number: "F06-HEALTHY",
      status: "Preconstruction",
      startDate: "2026-09-01",
      substantialDate: "2027-05-01",
      finalDate: "2027-06-01",
      contractAmount: "1000000",
      currentContractAmount: "1000000",
      projectManager: "Pat Project",
      superintendent: "Sam Superintendent",
    },
    records: [
      { id: "CONTROL", type: "Budget Control", status: "Locked", data: { locked: true } },
      { id: "BUDGET", type: "Budget", status: "Active", data: { selectedForProject: true, originalBudget: 1_000_000, approvedChanges: 0, committedCost: 0, actualCost: 0, forecastCost: 1_000_000 } },
      { id: "SCHEDULE", type: "Schedule", status: "Scheduled", due: "2027-01-01", data: { finish: "2027-01-01", progress: 0, qualityCategoryId: "general" } },
    ],
    exceptions: [],
    vendorCompliance: [],
    customRules: [],
  };
}

function criticalHealthInput() {
  const input = healthyInput();
  input.records[1].data.forecastCost = 1_050_000;
  input.exceptions = [{ id: "EX-CRITICAL", ruleId: "financial-projected-overrun", status: "Approved", startsAt: "2026-01-01", expiresAt: "2026-12-31" }];
  return input;
}
