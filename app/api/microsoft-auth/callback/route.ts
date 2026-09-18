import { authorizeVerifiedMicrosoftIdentity, recordMicrosoftActivity } from "../../../../lib/microsoft-access-server";
import {
  completeMicrosoftEntraAuthorization,
  issueCommandSessionCookie,
  MicrosoftEntraAuthError,
} from "../../../../lib/microsoft-entra-auth";
import type { CommandActor } from "../../../../lib/server-actor";

// Companion to start/route.ts: Microsoft redirects back here once someone has
// signed in. completeMicrosoftEntraAuthorization only proves *who* signed in
// (independently, via Microsoft) — it is authorizeVerifiedMicrosoftIdentity
// below that decides whether that person is actually allowed into Command
// Center, and only on success is the real login session issued.
export async function GET(request: Request) {
  let result: Awaited<ReturnType<typeof completeMicrosoftEntraAuthorization>> | null = null;
  try {
    result = await completeMicrosoftEntraAuthorization(request);
    const authorization = await authorizeVerifiedMicrosoftIdentity(result.microsoftEmail, result.providerSubject);
    const activityActor: CommandActor = {
      name: authorization.allowed ? authorization.name : result.displayName || result.microsoftEmail,
      email: authorization.allowed ? authorization.email : result.microsoftEmail,
      accessLevel: authorization.allowed ? authorization.accessLevel : "Employee",
      authenticated: authorization.allowed,
      identityProvider: "sites_authenticated_user",
    };

    if (!authorization.allowed) {
      await recordMicrosoftActivity({
        actor: activityActor,
        microsoftEmail: result.microsoftEmail,
        providerSubject: result.providerSubject,
        action: "Signed In With Microsoft — Not Yet Owner-Approved",
        resourceType: "Microsoft Identity",
        status: "Failed",
        detail: { status: authorization.status, tenantId: result.tenantId },
      });
      const headers = new Headers({ "Cache-Control": "no-store" });
      headers.append("Set-Cookie", result.clearCookie);
      return Response.json(
        {
          error: `Signed in with Microsoft as ${result.microsoftEmail}, but this account is not yet approved for Command Center access (${authorization.status}). Ask the Company Owner to approve it, then try again.`,
        },
        { status: 403, headers },
      );
    }

    await recordMicrosoftActivity({
      actor: activityActor,
      microsoftEmail: result.microsoftEmail,
      providerSubject: result.providerSubject,
      action: "Signed In With Microsoft (Primary Login)",
      resourceType: "Microsoft Identity",
      status: "Succeeded",
      detail: { tenantId: result.tenantId, verifiedAt: result.verifiedAt, tokensRetained: false },
    });

    const sessionCookie = await issueCommandSessionCookie(authorization.email);
    const headers = new Headers({
      Location: "/?microsoftIdentity=verified",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    headers.append("Set-Cookie", result.clearCookie);
    headers.append("Set-Cookie", sessionCookie);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    if (result) {
      await recordMicrosoftActivity({
        actor: { name: result.displayName || result.microsoftEmail, email: result.microsoftEmail, accessLevel: "Employee", authenticated: false, identityProvider: "sites_authenticated_user" },
        microsoftEmail: result.microsoftEmail,
        providerSubject: result.providerSubject,
        action: "Microsoft Sign-In",
        resourceType: "Microsoft Identity",
        status: "Failed",
        error,
      }).catch(() => undefined);
    }
    const status = error instanceof MicrosoftEntraAuthError ? error.status : 403;
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", "mefford_microsoft_auth=; Path=/api/microsoft-auth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    return Response.json(
      { error: error instanceof Error ? error.message : "Microsoft sign-in failed" },
      { status, headers },
    );
  }
}
