import { billingObject, ownerBillingAuthority, ownerBillingPhaseError, PHASE_ONE_BILLING, PHASE_ONE_SOV_ID } from "./owner-billing-authority";
import { roundMoney } from "./money";

export async function phaseOneBillingCredit(database: D1Database, projectId: string) {
  const rows = await database.prepare(`SELECT data_json FROM command_records WHERE project_id = ?
    AND record_type = 'Owner Billing' AND status IN ('Sent', 'Partially Paid', 'Paid', 'Overdue')`)
    .bind(projectId).all<{ data_json: string }>();
  return roundMoney(rows.results.reduce((sum, row) => {
    const data = billingObject(row.data_json);
    return sum + (data.billingPhase === PHASE_ONE_BILLING ? invoiceEarned(data) : 0);
  }, 0));
}

export async function phaseOneCreditError(database: D1Database, projectId: string, setup: Record<string, unknown>) {
  const credit = await phaseOneBillingCredit(database, projectId);
  const lines = Array.isArray(setup.sovLines) ? setup.sovLines as Record<string, unknown>[] : [];
  if (credit > 0 && !lines.some(line => line.id === setup.phaseOneCreditLineId && Number(line.scheduledValue) >= credit - 0.001))
    return "Select The Construction SOV Line Carrying Previously Billed Phase 1 Work.";
  return "";
}

export async function loadOwnerBillingAuthority(database: D1Database, projectId: string) {
  const row = await database.prepare(`SELECT p.owner_contract_type, p.owner_contract_status,
    p.owner_contract_record_id, p.contract_amount, p.current_contract_amount,
    c.status AS contract_status, c.data_json AS contract_json
    FROM projects p LEFT JOIN command_records c ON c.project_id = p.number
      AND c.id = p.owner_contract_record_id AND c.record_type = 'Contracts'
    WHERE p.number = ? AND p.status <> 'Deletion Quarantine'`).bind(projectId).first<{
      owner_contract_type: string; owner_contract_status: string; owner_contract_record_id: string;
      contract_amount: string; current_contract_amount: string; contract_status: string; contract_json: string;
    }>();
  return { projectId, row, ...ownerBillingAuthority({
    ownerContractType: row?.owner_contract_type, ownerContractStatus: row?.owner_contract_status,
    contractAmount: row?.contract_amount, currentContractAmount: row?.current_contract_amount,
  }, { status: row?.contract_status, data: row?.contract_json }) };
}

export async function ownerBillingReleaseError(database: D1Database, projectId: string, record: { id: string; data: Record<string, unknown> }) {
  const authority = await loadOwnerBillingAuthority(database, projectId);
  const error = ownerBillingPhaseError(authority, record.data.billingPhase);
  if (error) return { authority, error };
  const phaseOne = record.data.billingPhase === PHASE_ONE_BILLING;
  const setupId = phaseOne ? PHASE_ONE_SOV_ID : "OWNER-BILLING-SETUP";
  const setup = await database.prepare(`SELECT status, data_json FROM command_records
    WHERE project_id = ? AND id = ? AND record_type = 'Owner Billing Setup'`)
    .bind(projectId, setupId).first<{ status: string; data_json: string }>();
  if (setup?.status !== "Locked") return { authority, error: "A Company Owner Must Lock The Authorized Schedule Of Values Before Billing Review." };
  const setupData = billingObject(setup.data_json);
  const lines = Array.isArray(setupData.sovLines) ? setupData.sovLines as Record<string, unknown>[] : [];
  const expected = phaseOne ? authority.phaseOneAmount : authority.baseAmount;
  if (!lines.length || roundMoney(lines.reduce((sum, line) => sum + Number(line.scheduledValue || 0), 0)) !== expected)
    return { authority, error: "The Locked Schedule Of Values Must Match The Authorized Contract Amount." };
  if (!phaseOne) {
    const error = await phaseOneCreditError(database, projectId, setupData);
    if (error) return { authority, error };
  }
  const earned = invoiceEarned(record.data);
  const ceiling = phaseOne ? authority.phaseOneAmount : authority.currentAmount;
  if (!Number.isFinite(earned) || earned < 0 || earned > ceiling + 0.001)
    return { authority, error: "This Invoice Exceeds Its Signed Contract Authorization." };
  if (phaseOne && Array.isArray(record.data.lines) && record.data.lines.some(line => !lines.some(sov => sov.id === line.id)))
    return { authority, error: "Design Billing Must Use The Approved Phase 1 Schedule Of Values." };
  const prior = await database.prepare(`SELECT data_json FROM command_records WHERE project_id = ?
    AND id <> ? AND record_type = 'Owner Billing' AND status IN ('Sent', 'Partially Paid', 'Paid', 'Overdue')`)
    .bind(projectId, record.id).all<{ data_json: string }>();
  const priorData = prior.results.map(row => billingObject(row.data_json));
  for (const cap of [{ amount: ceiling, records: phaseOne ? priorData.filter(data => data.billingPhase === PHASE_ONE_BILLING) : priorData },
    ...(phaseOne && authority.construction ? [{ amount: authority.currentAmount, records: priorData }] : [])]) {
    const gross = cap.records.reduce((sum, data) => sum + invoiceEarned(data), 0) + earned;
    const payments = cap.records.reduce((sum, data) => sum + Number(data.currentPaymentDue || 0), 0) + Number(record.data.currentPaymentDue);
    if (!Number.isFinite(gross) || !Number.isFinite(payments) || roundMoney(gross) > cap.amount || roundMoney(payments) > cap.amount)
      return { authority, error: "Prior Invoices And This Invoice Exceed The Signed Authorization. Review Remaining Billing Capacity." };
  }
  return { authority, error: "", setupId, setupJson: setup.data_json };
}

export function invoiceEarned(data: Record<string, unknown>) {
  const lines = Array.isArray(data.lines) ? data.lines as Record<string, unknown>[] : [];
  const total = lines.length ? lines.reduce((sum, line) => sum + Number(line.totalThisPeriod || 0), 0)
    : Number(data.currentEarned ?? (Number(data.currentPaymentDue || 0) + Number(data.retainageThisPeriod || 0)));
  if (!Number.isFinite(total) || (data.currentEarned !== undefined && Math.abs(Number(data.currentEarned) - total) > 0.001)) return NaN;
  const payment = Number(data.currentPaymentDue);
  const retainage = Number(data.retainageThisPeriod || 0);
  if (!Number.isFinite(payment) || !Number.isFinite(retainage) || payment < 0 || Math.abs(payment + retainage - total) > 0.011) return NaN;
  return roundMoney(total);
}

/** Run inside the posting transaction, so concurrent invoices cannot both consume
 * the same signed authorization. Existing issued invoices remain collectible.
 */
export function ownerBillingPostingGuard(database: D1Database, authority: Awaited<ReturnType<typeof loadOwnerBillingAuthority>>,
  record: { id: string; data: Record<string, unknown> }, setupId: string, setupJson: string) {
  const phaseOne = record.data.billingPhase === PHASE_ONE_BILLING;
  const priorEarned = `CAST(ROUND(COALESCE(json_extract(b.data_json, '$.currentEarned'),
    json_extract(b.data_json, '$.currentPaymentDue') + COALESCE(json_extract(b.data_json, '$.retainageThisPeriod'), 0), 0) * 100) AS INTEGER)`;
  const sum = (phaseOnly: boolean, payment = false) => `(SELECT COALESCE(SUM(${payment ? "CAST(ROUND(COALESCE(json_extract(b.data_json, '$.currentPaymentDue'), 0) * 100) AS INTEGER)" : priorEarned}), 0) FROM command_records b
    WHERE b.project_id = p.number AND b.record_type = 'Owner Billing' AND b.id <> ?
      AND b.status IN ('Sent', 'Partially Paid', 'Paid', 'Overdue')
      ${phaseOnly ? "AND json_extract(b.data_json, '$.billingPhase') = 'Phase 1 Design'" : ""})`;
  const earned = Math.round(invoiceEarned(record.data) * 100);
  const caps = [{ phaseOnly: phaseOne, value: phaseOne ? authority.phaseOneAmount : authority.currentAmount },
    ...(phaseOne && authority.construction ? [{ phaseOnly: false, value: authority.currentAmount }] : [])];
  return database.prepare(`INSERT INTO record_audits
    (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
    VALUES (?, (SELECT c.id FROM projects p JOIN command_records c ON c.project_id = p.number
      AND c.id = p.owner_contract_record_id AND c.record_type = 'Contracts'
      WHERE p.number = ? AND p.owner_contract_status = ? AND p.contract_amount = ? AND p.current_contract_amount = ?
        AND c.status = ? AND c.data_json = ?
        AND EXISTS (SELECT 1 FROM command_records s WHERE s.project_id = p.number AND s.id = ? AND s.status = 'Locked' AND s.data_json = ?)
        AND ${caps.map(cap => `${sum(cap.phaseOnly)} + ? <= ? AND ${sum(cap.phaseOnly, true)} + ? <= ?`).join(" AND ")}),
      'Billing Contract Authority', 'Ready To Send', 'Verified', 'Signed authority checked during invoice posting',
      'Command Center', '', ?)`)
    .bind(authority.projectId, authority.projectId, authority.row!.owner_contract_status, authority.row!.contract_amount,
      authority.row!.current_contract_amount, authority.row!.contract_status, authority.row!.contract_json, setupId, setupJson,
      ...caps.flatMap(cap => [record.id, earned, Math.round(cap.value * 100), record.id,
        Math.round(Number(record.data.currentPaymentDue) * 100), Math.round(cap.value * 100)]), `${record.id} · ${phaseOne ? PHASE_ONE_BILLING : "Executed Owner Contract"}`);
}
