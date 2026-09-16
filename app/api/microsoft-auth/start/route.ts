import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import { approvedMicrosoftIdentityForActor, recordMicrosoftActivity } from "../../../../lib/microsoft-access-server";
import { beginMicrosoftEntraAuthorization, MicrosoftEntraAuthError } from "../../../../lib/microsoft-entra-auth";
import { resolveCommandActor } from "../../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const identity = await approvedMicrosoftIdentityForActor(actor);
    const authorization = await beginMicrosoftEntraAuthorization(actor, identity);
    await recordMicrosoftActivity({
      actor,
      microsoftEmail: identity.microsoftEmail,
      providerSubject: identity.providerSubject,
      action: "Started Single-Tenant Microsoft Identity Verification",
      resourceType: "Microsoft Identity",
      status: "Succeeded",
      detail: { flow: "Authorization Code + PKCE", tokensRetained: false },
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorization.authorizationUrl,
        "Set-Cookie": authorization.cookie,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof MicrosoftEntraAuthError ? error.status : 403;
    return Response.json({ error: safeMessage(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Microsoft identity verification could not start";
}
