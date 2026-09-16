import { roundMoney } from "./money";

export const PHASE_ONE_BILLING = "Phase 1 Design";
export const CONSTRUCTION_BILLING = "Construction";
export const PHASE_ONE_SOV_ID = "OWNER-BILLING-SETUP-PHASE1";

export function billingObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return billingObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function executed(snapshot: Record<string, unknown>) {
  const signatures = billingObject(snapshot.signatures);
  return Boolean(snapshot.executionHash && snapshot.executedAt
    && billingObject(signatures.owner).signedAt && billingObject(signatures.mefford).signedAt);
}

export function ownerBillingAuthority(project: {
  ownerContractType?: unknown; ownerContractStatus?: unknown;
  contractAmount?: unknown; currentContractAmount?: unknown;
}, contract?: { status?: unknown; data?: unknown }) {
  const data = billingObject(contract?.data);
  const phases = billingObject(data.phaseExecutions);
  const isGmp = project.ownerContractType === "Design-Build GMP" && data.contractType === "Design-Build GMP";
  const constructionSnapshot = billingObject(isGmp ? phases.gmpExhibitA : phases.primary);
  const construction = project.ownerContractStatus === "Executed" && contract?.status === "Executed"
    && (executed(constructionSnapshot) || executed(data));
  const phaseOne = billingObject(phases.phase1);
  const fee = billingObject(phaseOne.fields);
  const phaseOneAmount = isGmp && executed(phaseOne)
    ? roundMoney(fee.PHASE_ONE_DESIGN_AND_PRECONSTRUCTION_FEE || fee.TOTAL_PHASE_ONE_FEE) : 0;
  return {
    construction,
    phaseOneAmount: Math.max(0, phaseOneAmount),
    baseAmount: roundMoney(project.contractAmount),
    currentAmount: roundMoney(project.currentContractAmount || project.contractAmount),
    message: construction ? "" : isGmp
      ? "Execute GMP Exhibit A Before Construction Billing."
      : "Both Parties Must Sign The Owner Contract Before Billing Can Proceed.",
  };
}

export function ownerBillingPhaseError(authority: ReturnType<typeof ownerBillingAuthority>, phase: unknown) {
  if (phase && phase !== CONSTRUCTION_BILLING && phase !== PHASE_ONE_BILLING) return "Select A Valid Billing Phase.";
  if (phase === PHASE_ONE_BILLING) return authority.phaseOneAmount > 0
    ? "" : "A Signed Phase 1 Agreement With A Design Fee Is Required For Design Billing.";
  return authority.construction ? "" : authority.message;
}
