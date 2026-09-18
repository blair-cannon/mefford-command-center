import { beginMicrosoftEntraAuthorization, MicrosoftEntraAuthError } from "../../../../lib/microsoft-entra-auth";

// This is the primary Command Center sign-in entry point on the self-hosted
// Cloudflare deployment — it does not require any prior authentication (there
// is no ChatGPT Sites access-policy header anymore to have established one).
// Anyone may reach this URL and attempt to sign in with a Microsoft account;
// whether that account is actually authorized is decided after the fact, in
// the callback, once Entra has verified who they are.
export async function GET() {
  try {
    const authorization = await beginMicrosoftEntraAuthorization();
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
    const status = error instanceof MicrosoftEntraAuthError ? error.status : 503;
    return Response.json({ error: safeMessage(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Microsoft identity verification could not start";
}
