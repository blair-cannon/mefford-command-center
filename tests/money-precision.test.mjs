import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import { calculateEstimateSummary, newEstimateData } from "../app/estimate-template.ts";
import { assetAccountingValues } from "../lib/asset-tracking.ts";
import { currencyRawValue, formatCurrencyInput, formatMoney, moneyDecimal, roundMoney, settleCurrencyInput } from "../lib/money.js";
import { normalizeContractMoneyFields } from "../lib/owner-contracts.ts";
import { normalizeProposalData } from "../lib/proposals.ts";

function sourceFiles() {
  const files = [];
  const supportedExtensions = new Set([".ts", ".tsx", ".js", ".html"]);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && supportedExtensions.has(extname(entry.name))) files.push(path);
    }
  };
  for (const root of ["app", "lib", "public/contract-templates"]) visit(root);
  return files.sort();
}

test("central money helpers round, serialize, and display exact cents", () => {
  assert.equal(roundMoney(10.005), 10.01);
  assert.equal(roundMoney(-10.005), -10.01);
  assert.equal(roundMoney("$1,234.567"), 1234.57);
  assert.equal(moneyDecimal(12), "12.00");
  assert.equal(formatMoney(1234.5), "$1,234.50");
});

test("currency inputs retain editable precision and settle to two decimals", () => {
  assert.equal(currencyRawValue("$12,345.678"), "12345.67");
  assert.equal(formatCurrencyInput("12345.6"), "12,345.6");
  assert.equal(settleCurrencyInput("12,345.6"), "12345.60");
  assert.equal(settleCurrencyInput("-9.5", true), "-9.50");
});

test("estimate, proposal, contract, and asset values settle to cents", () => {
  const estimate = newEstimateData();
  estimate.projectInputs.buildingSquareFeet = 50_000;
  estimate.entries["0300.00"] = { quantity: 1, unit: "LS", material: 10.005, labor: 2.345, equipment: 0, subcontract: 0, other: 0 };
  const summary = calculateEstimateSummary(estimate);
  for (const amount of [summary.directJobCost, summary.baseProfit, summary.technologyFee, summary.originalBudget, summary.contractValue, summary.grossProfit, summary.costPerSquareFoot]) {
    assert.ok(Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9, `${amount} must be cents-precise`);
  }
  assert.equal(normalizeProposalData({ contractPrice: 123.456 }).contractPrice, 123.46);
  assert.deepEqual(normalizeContractMoneyFields({ LUMP_SUM_CONTRACT_SUM: "1,234.567", PAYMENT_TERMS: "Pay $500 when invoiced" }), { LUMP_SUM_CONTRACT_SUM: "1234.57", PAYMENT_TERMS: "Pay $500 when invoiced" });
  assert.equal(assetAccountingValues({ acquisitionCost: 100.005, businessUsePercent: 100 }).acquisitionCost, 100.01);
});

test("all application currency formatters and visible fixed money use cents", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/style:\s*["']currency["'][\s\S]{0,220}?\}/g)) {
      const formatter = match[0];
      if (!/minimumFractionDigits:\s*2/.test(formatter) || !/maximumFractionDigits:\s*2/.test(formatter)) {
        offenders.push(`${file}: currency formatter must require exactly two decimals`);
      }
    }
    source.split("\n").forEach((line, index) => {
      if (/\.replace|formula1:/.test(line)) return;
      for (const match of line.matchAll(/\$\d[\d,]*(?:\.\d+)?(?:[KMB])?(?:\/(?:hr|hour|day|week|month|mi|mile|sf))?/gi)) {
        const token = match[0];
        if (!/\d\.\d{2}(?:\/|$)/.test(token)) offenders.push(`${file}:${index + 1}: ${token}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("financial and payroll exports preserve cents", () => {
  const reports = readFileSync("app/financial-reports.tsx", "utf8");
  const payroll = readFileSync("app/accounting-control.tsx", "utf8");
  const ledger = readFileSync("app/general-ledger.tsx", "utf8");
  assert.match(reports, /ss:Format="\$#,##0\.00"/);
  assert.match(payroll, /numeric\(record\.data\.bonus\)\.toFixed\(2\)/);
  assert.match(payroll, /exactMoney\.format\(numeric\(record\.data\.reimbursement\)\)/);
  assert.match(ledger, /row\.debit\.toFixed\(2\)/);
  assert.match(ledger, /row\.netCredit\.toFixed\(2\)/);
});
