import { approvedMicrosoftIdentityForActor, recordMicrosoftActivity } from "../../../../lib/microsoft-access-server";
import { completeMicrosoftEntraAuthorization, MicrosoftEntraAuthError } from "../../../../lib/microsoft-entra-auth";
import { resolveCommandActor } from "../../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  let identity: Awaited<ReturnType<typeof approvedMicrosoftIdentityForActor>> | null = null;
  try {
    identity = await approvedMicrosoftIdentityForActor(actor);
    const result = await completeMicrosoftEntraAuthorization(request, actor, identity);
    await recordMicrosoftActivity({
      actor,
      microsoftEmail: result.microsoftEmail,
      providerSubject: result.providerSubject,
      action: "Verified Single-Tenant Microsoft Identity",
      resourceType: "Microsoft Identity",
      status: "Succeeded",
      detail: { tenantId: result.tenantId, verifiedAt: result.verifiedAt, tokensRetained: false },
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/?microsoftIdentity=verified",
        "Set-Cookie": result.clearCookie,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (identity) {
      await recordMicrosoftActivity({
        actor,
        microsoftEmail: identity.microsoftEmail,
        providerSubject: identity.providerSubject,
        action: "Microsoft Identity Verification",
        resourceType: "Microsoft Identity",
        status: "Failed",
        error,
      }).catch(() => undefined);
    }
    const status = error instanceof MicrosoftEntraAuthError ? error.status : 403;
    return Response.json(
      { error: error instanceof Error ? error.message : "Microsoft identity verification failed" },
      {
        status,
        headers: {
          "Set-Cookie": "mefford_microsoft_auth=; Path=/api/microsoft-auth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
