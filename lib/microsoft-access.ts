export const MICROSOFT_ACCESS_STATUSES = [
  "No Access",
  "Onboarding Access",
  "Approved",
  "Active",
  "Suspended",
  "Revoked",
  "Microsoft Account Disabled",
] as const;

export type MicrosoftAccessStatus = typeof MICROSOFT_ACCESS_STATUSES[number];

export const MICROSOFT_ACCESS_LEVELS = ["Employee", "Administrator"] as const;
export type MicrosoftAccessLevel = typeof MICROSOFT_ACCESS_LEVELS[number];

export type MicrosoftDirectoryPerson = {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  userType?: string | null;
  accountEnabled?: boolean | null;
};

export function normalizedMicrosoftEmail(person: MicrosoftDirectoryPerson) {
  return String(person.mail || person.userPrincipalName || "").trim().toLowerCase();
}

export function normalizeDirectoryPerson(person: MicrosoftDirectoryPerson) {
  const providerSubject = cleanIdentity(person.id, 160);
  const userPrincipalName = cleanEmail(person.userPrincipalName || person.mail);
  const mail = cleanEmail(person.mail);
  const email = mail || userPrincipalName;
  if (!providerSubject || !email) return null;
  return {
    providerSubject,
    displayName: cleanText(person.displayName || email, 180),
    userPrincipalName: userPrincipalName || email,
    mail,
    jobTitle: cleanText(person.jobTitle, 180),
    department: cleanText(person.department, 180),
    userType: cleanText(person.userType || "Member", 40) || "Member",
    accountEnabled: person.accountEnabled !== false,
  };
}

export function isEmployeeAccountCandidate(input: {
  userType: string;
  email: string;
  accountEnabled: boolean;
  directoryPresent: boolean;
}) {
  return input.directoryPresent && input.accountEnabled && input.userType.toLowerCase() === "member" && input.email.endsWith("@meffcon.com");
}

export function normalizeAccessLevel(value: unknown): MicrosoftAccessLevel {
  return value === "Administrator" ? "Administrator" : "Employee";
}

export function normalizeProjectScopes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => cleanIdentity(item, 80)).filter(Boolean))).sort();
}

export function statusAfterOwnerGrant(input: { onboardingComplete: boolean; existingAccessLevel?: string }) {
  if (input.existingAccessLevel === "Company Owner") return "Active" as const;
  return input.onboardingComplete ? "Active" as const : "Onboarding Access" as const;
}

export function statusAfterOwnerRestore(input: { onboardingComplete: boolean }) {
  return input.onboardingComplete ? "Active" as const : "Onboarding Access" as const;
}

export function accessStatusAllowsSignIn(status: string) {
  return status === "Onboarding Access" || status === "Approved" || status === "Active";
}

export function fullCompanyAccessAllowed(status: string) {
  return status === "Active";
}

export function disabledStatus(priorStatus: string) {
  return {
    previousAccessStatus: MICROSOFT_ACCESS_STATUSES.includes(priorStatus as MicrosoftAccessStatus)
      ? priorStatus as MicrosoftAccessStatus
      : "No Access" as const,
    accessStatus: "Microsoft Account Disabled" as const,
  };
}

export function ownerDecisionReason(value: unknown) {
  return cleanText(value, 500);
}

export function validOwnerDecisionReason(value: unknown) {
  return ownerDecisionReason(value).length >= 8;
}

function cleanText(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEmail(value: unknown) {
  const email = cleanText(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanIdentity(value: unknown, max: number) {
  return cleanText(value, max).replace(/[^a-zA-Z0-9@._:+-]/g, "");
}
