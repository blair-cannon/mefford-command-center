import assert from "node:assert/strict";
import { test } from "node:test";

import {
  apPaymentLines,
  ownerBillingLines,
  ownerReceiptLines,
  toCents,
} from "../lib/accounting-ledger.ts";
import { calculateProjectHealth } from "../lib/project-health-core.js";
import {
  expectedScheduleSlots,
  scheduleSlotAtOrBefore,
} from "../lib/scheduler-reliability.js";
import {
  evaluateEvidenceStatus,
  overallEvidenceStatus,
} from "../lib/system-health-evidence.js";
import { canonicalCommandEmail } from "../lib/server-actor.ts";

const random = mulberry32(0xF06C0DE);

test("1,000 generated currency values remain exact whole cents and every standard posting balances", () => {
  const builders = [
    (amount) => apPaymentLines(amount, "Generated payment"),
    (amount) => ownerBillingLines(amount, "26001", "Generated billing"),
    (amount) => ownerReceiptLines(amount, "26001", "Generated receipt"),
  ];
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const cents = integer(1, 100_000_000);
    const amount = cents / 100;
    assert.equal(toCents(amount), cents, `currency drift for ${amount}`);
    for (const build of builders) {
      const totals = build(amount).reduce((sum, line) => ({
        debit: sum.debit + Number(line.debitCents || 0),
        credit: sum.credit + Number(line.creditCents || 0),
      }), { debit: 0, credit: 0 });
      assert.equal(totals.debit, cents);
      assert.equal(totals.credit, cents);
    }
  }
});

test("1,000 generated scheduler inputs produce aligned, unique, monotonic execution slots", () => {
  const intervals = [1, 5, 15, 60, 1_440];
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const intervalMinutes = intervals[integer(0, intervals.length - 1)];
    const offsetMinutes = integer(0, Math.max(0, intervalMinutes - 1));
    const now = new Date(Date.UTC(2020 + integer(0, 15), integer(0, 11), integer(1, 28), integer(0, 23), integer(0, 59), integer(0, 59)));
    const floor = scheduleSlotAtOrBefore(now, intervalMinutes, offsetMinutes);
    assert.ok(floor.getTime() <= now.getTime());
    assert.ok(now.getTime() - floor.getTime() < intervalMinutes * 60_000);
    assert.equal(((floor.getTime() / 60_000) - offsetMinutes) % intervalMinutes, 0);

    const slots = expectedScheduleSlots({ now, intervalMinutes, offsetMinutes, windowMinutes: intervalMinutes * integer(1, 20) });
    assert.equal(new Set(slots).size, slots.length);
    for (let index = 1; index < slots.length; index += 1) {
      assert.ok(slots[index] > slots[index - 1]);
      assert.equal(new Date(slots[index]).getTime() - new Date(slots[index - 1]).getTime(), intervalMinutes * 60_000);
    }
  }
});

test("evidence state precedence is fail-closed for every generated combination", () => {
  const statuses = ["Verified", "Degraded", "Failed", "Unknown", "Not Configured"];
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const items = Array.from({ length: integer(1, 12) }, (_, index) => ({
      key: `check-${index}`,
      label: `Check ${index}`,
      status: statuses[integer(0, statuses.length - 1)],
      required: random() > 0.2,
    }));
    const required = items.filter((item) => item.required);
    const overall = overallEvidenceStatus(items);
    const evaluated = evaluateEvidenceStatus(items);
    if (!required.length) {
      assert.equal(overall, "Unknown");
      assert.equal(evaluated, "Unknown");
    }
    if (required.some((item) => item.status === "Failed")) {
      assert.equal(overall, "Failed");
      assert.equal(evaluated, "Failed");
    }
    if (overall === "Verified") assert.ok(required.every((item) => item.status === "Verified"));
    if (evaluated === "Verified") assert.ok(required.every((item) => item.status === "Verified"));
  }
});

test("critical project-health guardrails always force Red and cannot be excepted", () => {
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const budget = integer(100_000, 20_000_000);
    const threshold = Math.min(budget * 0.01, 25_000);
    const overrun = Math.floor(threshold) + integer(1, 500_000);
    const result = calculateProjectHealth({
      today: "2026-08-23",
      project: {
        number: `F06-${iteration}`,
        status: "Active",
        startDate: "2026-01-01",
        substantialDate: "2027-01-01",
        finalDate: "2027-02-01",
        contractAmount: String(budget),
        currentContractAmount: String(budget),
        projectManager: "Pat Project",
        superintendent: "Sam Superintendent",
      },
      records: [
        { id: "CONTROL", type: "Budget Control", status: "Locked", data: { locked: true } },
        { id: "BUDGET", type: "Budget", status: "Active", data: { selectedForProject: true, originalBudget: budget, approvedChanges: 0, committedCost: budget, actualCost: budget, forecastCost: budget + overrun } },
        { id: "SCHEDULE", type: "Schedule", status: "Scheduled", due: "2027-01-01", data: { finish: "2027-01-01", progress: 50, qualityCategoryId: "general" } },
      ],
      exceptions: [{ id: "EX", ruleId: "financial-projected-overrun", status: "Approved", startsAt: "2026-01-01", expiresAt: "2026-12-31" }],
      vendorCompliance: [],
      customRules: [],
    });
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.equal(result.color, "Red");
    assert.ok(result.criticalTriggers.some((item) => item.ruleId === "financial-projected-overrun"));
  }
});

test("identity normalization is case-insensitive, whitespace-safe, and preserves the owner alias", () => {
  const domains = ["meffcon.com", "example.com", "MEFFCON.COM"];
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const local = `Employee.${integer(1, 99999)}`;
    const domain = domains[integer(0, domains.length - 1)];
    const raw = `  ${random() > 0.5 ? local.toUpperCase() : local}@${domain}  `;
    assert.equal(canonicalCommandEmail(raw), `${local.toLowerCase()}@${domain.toLowerCase()}`);
  }
  assert.equal(canonicalCommandEmail("  DJMEFF22@GMAIL.COM "), "djmeff22@gmail.com");
});

function integer(minimum, maximum) {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function mulberry32(seed) {
  return function next() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}
