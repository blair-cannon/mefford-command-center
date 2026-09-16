import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { calculateProjectDistance } from "../../../lib/project-distance";
import { recordFirstPartyFailure } from "../../../lib/runtime-observability";
import { resolveCommandActor } from "../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated) return Response.json({ error: "Authentication required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const address = new URL(request.url).searchParams.get("address")?.trim() || "";
  try {
    const distance = await calculateProjectDistance(address);
    return Response.json(distance, { headers: { "Cache-Control": "private, max-age=86400", Vary: "Cookie" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic job distance is unavailable.";
    await recordFirstPartyFailure({ route: "/api/estimate-distance", status: 422, reason: message, actorEmail: actor.email });
    return Response.json({ error: `${message} Enter the round-trip mileage manually.` }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}

