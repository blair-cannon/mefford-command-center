export const SALES_OPPORTUNITY_HANDOFF_REQUIREMENTS = Object.freeze([
  Object.freeze({ key: "projectName", label: "Opportunity Name" }),
  Object.freeze({ key: "company", label: "Primary Company" }),
  Object.freeze({ key: "contactId", label: "Company Contact" }),
  Object.freeze({ key: "assignedRep", label: "Salesperson" }),
  Object.freeze({ key: "leadSource", label: "Lead Source" }),
  Object.freeze({ key: "expectedAwardDate", label: "Expected Award Date" }),
  Object.freeze({ key: "assignedEstimator", label: "Assigned Estimator" }),
]);

/**
 * @param {Record<string, unknown>} opportunity
 */
export function missingSalesOpportunityHandoffFields(opportunity = {}) {
  return SALES_OPPORTUNITY_HANDOFF_REQUIREMENTS
    .filter(({ key }) => key !== "contactId" || opportunity.leadSource !== "Public Bid")
    .filter(({ key }) => !String(opportunity[key] ?? "").trim())
    .map(({ label }) => label);
}

/**
 * @param {Record<string, unknown>} opportunity
 * @returns {{ status: "Incomplete" | "Ready For Estimating", missingFields: string[] }}
 */
export function salesOpportunityQualification(opportunity = {}) {
  const missingFields = missingSalesOpportunityHandoffFields(opportunity);
  return {
    status: missingFields.length ? "Incomplete" : "Ready For Estimating",
    missingFields,
  };
}
