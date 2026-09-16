export const PROJECT_TEAM_ASSIGNMENT_TYPE = "Project Team Assignment";
export const DESIGNATION_CHANGE_REQUEST_TYPE = "Designation Change Request";

export const PROJECT_DESIGNATIONS = [
  "Project Manager",
  "Superintendent",
  "Estimator",
  "Sales Representative",
  "Marketing",
  "Office Staff",
  "Accountant",
  "Financial Administrator",
  "Safety Director",
  "Safety",
] as const;

export const COMPANY_DESIGNATIONS = [
  "Human Resources",
  "Benefits Administrator",
  "Attorney",
  "IT Administrator",
  "Fleet Manager",
  "Asset Manager",
  "Sales Manager",
  "Estimating Manager",
  "Accounting Manager",
] as const;

export const ALL_COMPANY_DESIGNATIONS = [
  ...PROJECT_DESIGNATIONS,
  ...COMPANY_DESIGNATIONS,
] as const;

export function isAssignableToDesignation(
  accessLevel: string,
  designations: readonly string[],
  designation: string,
) {
  return (
    accessLevel === "Company Owner" || designations.includes(designation)
  );
}

export function parseStringArray(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeDesignations(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ALL_COMPANY_DESIGNATIONS);
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => allowed.has(item)),
    ),
  ).sort();
}

export function projectTeamAssignmentId(email: string) {
  return `TEAM-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function parseRecordData(value?: string | null) {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
