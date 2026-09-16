function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeSalesFunnelStage(stage: unknown): string {
  const value = String(stage || "New Lead");
  if (["Qualified", "Discovery / Site Visit", "Site Visit And Discovery"].includes(value)) return "Qualified Opportunity";
  if (value === "Ready For Estimating") return "Estimating";
  return value;
}

function amount(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
}

/** Use the same commercial value in cards, stage totals, and dashboards.
 * A linked controlled contract supersedes the historical award/proposal price.
 * Sales recognition is separately gated by both parties' contract signatures.
 */
export function salesOpportunityValue(value: unknown, status = ""): number {
  const data = object(value);
  const stage = String(data.stage || status);
  const handoff = object(data.proposalHandoff);
  const metrics = object(data.salesMetrics);
  const awarded = stage === "Awarded" || data.estimateStatus === "Awarded" || Boolean(data.awardedProjectNumber);
  const proposed = ["Proposal Submitted", "Negotiation", "Awarded", "On Hold", "Lost"].includes(stage);
  const constructionProposal = handoff.packetType !== "Preconstruction Letter of Engagement";
  if (awarded) {
    const controlled = amount(object(data.contractSales).contractValue);
    if (controlled !== undefined) return controlled;
    const contract = amount(metrics.contractValue);
    if (contract !== undefined) return contract;
    // Older awards already saved their contract value in estimatedValue.
    const recordedAward = amount(data.estimatedValue);
    if (recordedAward !== undefined) return recordedAward;
  }
  if (proposed && constructionProposal) {
    const proposal = amount(handoff.contractAmount);
    if (proposal !== undefined) return proposal;
  }
  return amount(data.estimatedValue) ?? amount(data.contractValue) ?? 0;
}
