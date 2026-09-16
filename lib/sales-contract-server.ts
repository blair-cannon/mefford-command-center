import { billingObject } from "./owner-billing-authority";
import { reconcileAwardContractTotals } from "./project-contract-financials";
import { resolveSalesContract } from "./sales-contract";

/** Call only after authorizing access to the sales/company workspace. The
 * projection exposes amounts and execution status, never signatures or terms. */
export async function loadSalesContracts(database: D1Database, projectIds?: readonly string[]) {
  if (projectIds?.length === 0) return new Map<string, ReturnType<typeof resolveSalesContract>>();
  await reconcileAwardContractTotals(database, projectIds);
  const rows = await database.prepare(`SELECT p.number, p.name, p.owner_name, p.status,
    p.owner_contract_record_id, p.owner_contract_type, p.owner_contract_status,
    p.contract_amount, p.current_contract_amount,
    c.status AS record_status, c.data_json AS contract_data
    FROM projects p LEFT JOIN command_records c ON c.project_id = p.number
      AND c.id = p.owner_contract_record_id AND c.record_type = 'Contracts'
    WHERE p.status NOT IN ('Deletion Quarantine', 'Deleted')
      ${projectIds ? 'AND p.number IN (SELECT value FROM json_each(?))' : ''}`).bind(...(projectIds ? [JSON.stringify(projectIds)] : [])).all<{
      number: string; name: string; owner_name: string; status: string; owner_contract_record_id: string;
      owner_contract_type: string; owner_contract_status: string; contract_amount: string;
      current_contract_amount: string; record_status: string | null; contract_data: string | null;
    }>();
  return new Map(rows.results.filter(row => !projectIds || projectIds.includes(row.number)).map(row => [row.number, resolveSalesContract({
    number: row.number, name: row.name, ownerName: row.owner_name, status: row.status, ownerContractRecordId: row.owner_contract_record_id,
    ownerContractType: row.owner_contract_type, ownerContractStatus: row.owner_contract_status,
    contractAmount: row.contract_amount, currentContractAmount: row.current_contract_amount,
  }, { status: row.record_status, data: billingObject(row.contract_data) })]));
}
