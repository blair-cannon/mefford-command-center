import { billingObject, ownerBillingAuthority } from "./owner-billing-authority";
import { roundMoney } from "./money";

export type SalesContract = {
  projectNumber: string;
  projectName: string;
  company: string;
  contractRecordId: string;
  status: string;
  contractValue: number;
  baseContractValue: number;
  signed: boolean;
  signedAt: string;
  signedDate: string;
  recognizedValue: number;
  pendingSignature: boolean;
};

/** A live projection of the controlled contract, never the immutable award. */
export function resolveSalesContract(project: {
  number: string; name?: string; ownerName?: string; status: string; ownerContractRecordId: string;
  ownerContractType: string; ownerContractStatus: string;
  contractAmount: string; currentContractAmount: string;
}, contract?: { status?: unknown; data?: unknown }): SalesContract {
  const data = billingObject(contract?.data);
  const phases = billingObject(data.phaseExecutions);
  const phase = billingObject(project.ownerContractType === "Design-Build GMP" ? phases.gmpExhibitA : phases.primary);
  const signatures = billingObject(phase.signatures);
  const snapshot = phase.executionHash && phase.executedAt
    && billingObject(signatures.owner).signedAt && billingObject(signatures.mefford).signedAt ? phase : data;
  const authority = ownerBillingAuthority(project, contract);
  const signedAt = String(snapshot.executedAt || "");
  const validDate = signedAt && Number.isFinite(Date.parse(signedAt));
  const available = !/^(deletion quarantine|deleted|void|voided|cancelled|canceled)$/i.test(project.status);
  const signed = Boolean(available && authority.construction && validDate);
  const signedDate = signed ? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(signedAt)) : "";
  const contractValue = roundMoney(project.currentContractAmount || project.contractAmount);
  return {
    projectNumber: project.number, projectName: project.name || project.number, company: project.ownerName || "",
    contractRecordId: project.ownerContractRecordId,
    status: project.ownerContractStatus || "Draft", contractValue,
    baseContractValue: roundMoney(project.contractAmount), signed,
    signedAt: signed ? signedAt : "", signedDate,
    recognizedValue: signed ? contractValue : 0,
    pendingSignature: available && project.status === "Active" && !signed,
  };
}

export function opportunityContract(data: unknown): SalesContract | null {
  const value = billingObject(billingObject(data).contractSales);
  return typeof value.projectNumber === "string" ? value as SalesContract : null;
}

/** Always overwrite client-supplied or previously cached contract projections. */
export function withSalesContract(data: Record<string, unknown>, contracts: ReadonlyMap<string, SalesContract>): Record<string, unknown> & { contractSales: SalesContract | null } {
  const projectNumber = String(data.awardedProjectNumber || data.awardedProjectId || "");
  return { ...data, contractSales: contracts.get(projectNumber) || null };
}

/** Recognize each signed project once, in the period of final signature. */
export function signedSalesRecords<T extends { data?: unknown }>(records: readonly T[], year?: string | number): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const contract = opportunityContract(record.data);
    if (!contract?.signed || !contract.signedDate || seen.has(contract.projectNumber)
      || year !== undefined && contract.signedDate.slice(0, 4) !== String(year)) return false;
    seen.add(contract.projectNumber);
    return true;
  });
}
