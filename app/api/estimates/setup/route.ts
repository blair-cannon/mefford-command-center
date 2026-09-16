import { eq } from "drizzle-orm";
import { companyMembers, vendorProfiles } from "../../../../db/schema";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { isAssignableToDesignation } from "../../../../lib/team-access";
import { complianceState, ensureVendorSchema } from "../../../../lib/vendor-portal";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  await ensureVendorSchema();
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const [architectRows, members] = await Promise.all([
    db.select({ id: vendorProfiles.id, name: vendorProfiles.legalName, status: vendorProfiles.status })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.vendorType, "Architect")),
    db.select({ email: companyMembers.email, name: companyMembers.displayName, accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson })
      .from(companyMembers)
      .where(eq(companyMembers.isActive, true)),
  ]);
  const architects = await Promise.all(architectRows.map(async (vendor) => {
    const compliance = await complianceState(db, vendor.id);
    return {
      ...vendor,
      paymentHold: compliance.paymentBlocked,
      temporaryApproval: Boolean(compliance.activeOverride),
      temporaryApprovalExpiresAt: compliance.activeOverride?.expiresAt || "",
    };
  }));
  const department = (...designations: string[]) => members
    .filter((member) => designations.some((designation) => isAssignableToDesignation(member.accessLevel, parseDesignations(member.designationsJson), designation)))
    .map(({ email, name }) => ({ email, name }));
  return Response.json({
    architects: architects.sort((a, b) => a.name.localeCompare(b.name)),
    departments: {
      sales: department("Sales Representative"),
      estimating: department("Estimator"),
      accounting: department("Accountant", "Financial Administrator"),
    },
    visibility: {
      sales: "Department Wide",
      estimating: "Department Wide With One Primary Estimator Per Estimate",
      accounting: "Department Wide",
      projectManagement: "Assigned Project Only",
      superintendent: "Assigned Project Only",
    },
  });
}

function parseDesignations(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
