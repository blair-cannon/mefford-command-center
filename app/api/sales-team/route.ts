import { eq } from "drizzle-orm";
import { companyMembers } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { resolveCommandActor } from "../../../lib/server-actor";
import { isAssignableToDesignation, parseStringArray } from "../../../lib/team-access";

export async function GET(request: Request) {
  try {
    const actor = await resolveCommandActor(request);
    if (!actor.authenticated) return Response.json({ error: "Authentication Required" }, { status: 401 });
    const onboardingLock = await enforceOnboardingAccess(request);
    if (onboardingLock) return onboardingLock;
    const { getDb } = await import("../../../db");
    const db = getDb();
    const members = await db.select({ name: companyMembers.displayName, email: companyMembers.email, accessLevel: companyMembers.companyAccessLevel, designationsJson: companyMembers.designationsJson }).from(companyMembers).where(eq(companyMembers.isActive, true));
    const current = members.find(member => member.email.toLowerCase() === actor.email.toLowerCase());
    if (!current || !(["Company Owner", "Administrator"].includes(current.accessLevel) || parseStringArray(current.designationsJson).some(role => ["Estimator", "Sales Representative", "Marketing"].includes(role)))) {
      return Response.json({ error: "Sales Or Estimating Access Is Required" }, { status: 403 });
    }
    const eligible = (designation: string) => members
      .filter(member => isAssignableToDesignation(member.accessLevel, parseStringArray(member.designationsJson), designation))
      .map(({ name, email }) => ({ name, email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ salespeople: eligible("Sales Representative"), estimators: eligible("Estimator") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Sales and estimating team load failed", error);
    return Response.json({ error: "Sales and estimating team could not be loaded. Try again." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
