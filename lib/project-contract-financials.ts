import { roundMoney } from "./money";

/** Rebase the current total inside the same transaction as the owner contract.
 * Preserve executed change orders and any documented opening adjustment. SQLite
 * evaluates both assignments against the old row, including contract_amount.
 */
export const REBASED_CURRENT_CONTRACT_SQL = `printf('%.2f', (
  CAST(ROUND(CAST(? AS REAL) * 100) AS INTEGER)
  + CAST(ROUND(CAST(COALESCE(NULLIF(current_contract_amount, ''), contract_amount, '0') AS REAL) * 100) AS INTEGER)
  - CAST(ROUND(CAST(COALESCE(NULLIF(contract_amount, ''), '0') AS REAL) * 100) AS INTEGER)
) / 100.0)`;

type StaleCandidate = {
  number: string;
  contract_amount: string;
  current_contract_amount: string;
  owner_contract_record_id: string;
  setup_json: string;
  award_json: string;
  contract_json: string;
};

function object(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function cents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(/[$,]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const amount = Math.round(roundMoney(raw) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Repair only the proven legacy save defect: the current total still equals
 * the immutable award plus executed COs, while the controlled contract setup
 * and project's base amount agree on a different negotiated amount. Unexplained
 * or imported differences are left intact. No source document is rewritten.
 * Call after authorization; project readers pass only their visible projects.
 */
export async function reconcileAwardContractTotals(database: D1Database, projectIds?: readonly string[]) {
  const corrected = new Map<string, string>();
  if (projectIds?.length === 0) return corrected;
  const candidates = await database.prepare(`
    SELECT p.number, p.contract_amount, p.current_contract_amount, p.owner_contract_record_id,
      s.data_json AS setup_json, a.data_json AS award_json, c.data_json AS contract_json
    FROM projects p
    JOIN command_records s ON s.project_id = 'MEFFORD-ACCOUNTING'
      AND s.id = p.owner_contract_record_id AND s.record_type = 'Owner Contract Setup'
    JOIN command_records c ON c.project_id = p.number
      AND c.id = p.owner_contract_record_id AND c.record_type = 'Contracts'
    JOIN command_records a ON a.project_id = p.number AND a.id = (
      SELECT id FROM command_records WHERE project_id = p.number AND record_type = 'Awarded Estimates'
      ORDER BY updated_at DESC, id DESC LIMIT 1)
    WHERE p.status <> 'Deletion Quarantine' AND p.current_contract_amount <> ''
      AND p.current_contract_amount <> p.contract_amount
      ${projectIds ? "AND p.number IN (SELECT value FROM json_each(?))" : ""}
  `).bind(...(projectIds ? [JSON.stringify(projectIds)] : [])).all<StaleCandidate>();
  for (const row of candidates.results || []) {
    if (projectIds && !projectIds.includes(row.number)) continue;
    const setup = object(row.setup_json);
    const base = cents(row.contract_amount);
    const award = cents(object(row.award_json).contractValue);
    const current = cents(row.current_contract_amount);
    if (base === null || base < 0 || award === null || award < 0 || current === null
      || base === award || setup.sourceOfTruth !== "Owner Contract Record"
      || setup.contractRecordId !== row.owner_contract_record_id || cents(setup.contractAmount) !== base) continue;
    const changes = await database.prepare(`SELECT data_json FROM command_records
      WHERE project_id = ? AND record_type = 'Change Orders' AND status = 'Executed'`)
      .bind(row.number).all<{ data_json: string }>();
    const changeAmounts = changes.results.map(change => cents(object(change.data_json).approvedTotal));
    if (changeAmounts.some(amount => amount === null)) continue;
    const changeTotal = changeAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
    const next = base + changeTotal;
    if (current !== award + changeTotal || next < 0 || !Number.isSafeInteger(next)) continue;
    const newValue = (next / 100).toFixed(2);
    // Recheck the exact sources in the atomic batch. A concurrent contract or
    // CO execution cannot be overwritten, and a retry cannot duplicate an audit.
    const guard = `number = ? AND contract_amount = ? AND current_contract_amount = ?
      AND owner_contract_record_id = ?
      AND EXISTS (SELECT 1 FROM command_records WHERE project_id = 'MEFFORD-ACCOUNTING' AND id = ? AND data_json = ?)
      AND EXISTS (SELECT 1 FROM command_records WHERE project_id = projects.number AND id = ? AND data_json = ?)`;
    const bindings = [row.number, row.contract_amount, row.current_contract_amount,
      row.owner_contract_record_id, row.owner_contract_record_id, row.setup_json,
      row.owner_contract_record_id, row.contract_json];
    const now = new Date().toISOString();
    const results = await database.batch([
      database.prepare(`INSERT INTO record_audits
        (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
        SELECT number, owner_contract_record_id, 'Current Contract Reconciled', current_contract_amount, ?,
          'Negotiated owner contract amount replaced the stale award basis', 'Command Center', '',
          'Current contract reconciled to the controlled base plus executed change orders; award history retained.'
        FROM projects WHERE ${guard}`).bind(newValue, ...bindings),
      database.prepare(`UPDATE projects SET current_contract_amount = ?, updated_at = ? WHERE ${guard}`)
        .bind(newValue, now, ...bindings),
    ]);
    if (results[1].meta.changes) corrected.set(row.number, newValue);
  }
  return corrected;
}
