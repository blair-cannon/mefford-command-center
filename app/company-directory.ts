import { isAssignableToDesignation } from "../lib/team-access";

export type CompanyDirectoryMember = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  defaultDesignations: string[];
  projectDesignations: string[];
  scope: string;
  status: string;
};

export const MEFFORD_COMPANY_DIRECTORY: CompanyDirectoryMember[] = [
  {
    name: "Jordan Mefford",
    email: "jmefford@meffcon.com",
    accessLevel: "Company Owner",
    defaultDesignations: [],
    projectDesignations: [],
    scope: "Complete company access",
    status: "Pending Connection",
  },
  {
    name: "Blain Faulkner",
    email: "it@meffcon.com",
    accessLevel: "Employee",
    defaultDesignations: ["IT Administrator"],
    projectDesignations: [],
    scope: "IT & Integrations Administration And IT Performance Review Evidence",
    status: "Pending Connection",
  },
];

export function eligibleCompanyMembers(designation: string) {
  return MEFFORD_COMPANY_DIRECTORY.filter(
    (member) =>
      member.status !== "Disabled" &&
      isAssignableToDesignation(
        member.accessLevel,
        [...member.projectDesignations, ...member.defaultDesignations],
        designation,
      ),
  );
}
