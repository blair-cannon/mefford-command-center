import {
  DISPLAY_EMAIL,
  authenticateDashboardPassword,
  clearDashboardLoginFailures,
  createDashboardSession,
  dashboardCredential,
  dashboardSessionCookie,
  expiredDashboardSessionCookie,
  dashboardLoginAllowed,
  recordDashboardLoginFailure,
  revokeDashboardSession,
  setDashboardPassword,
  validateDashboardSession,
} from "../../../lib/dashboard-display-auth";
import { resolveCommandActor } from "../../../lib/server-actor";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "owner") {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const credential = await dashboardCredential();
    return Response.json({
      email: DISPLAY_EMAIL,
      configured: Boolean(credential),
      updatedAt: credential?.updated_at || "",
      updatedBy: credential?.updated_by || "",
      route: "/dashboard-display",
    });
  }
  return Response.json({ email: DISPLAY_EMAIL, authenticated: await validateDashboardSession(request) });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => ({})) as { action?: string; email?: string; password?: string; confirmation?: string };
  if (input.action === "login") {
    if (!await dashboardLoginAllowed(request)) {
      return Response.json({ error: "Too many dashboard login attempts. Wait 15 minutes and try again." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } });
    }
    if (String(input.email || "").trim().toLowerCase() !== DISPLAY_EMAIL || !await authenticateDashboardPassword(String(input.password || ""))) {
      await recordDashboardLoginFailure(request);
      return Response.json({ error: "The dashboard email or password is incorrect." }, { status: 401 });
    }
    await clearDashboardLoginFailures(request);
    const session = await createDashboardSession();
    return Response.json({ authenticated: true, email: DISPLAY_EMAIL }, { headers: { "Set-Cookie": dashboardSessionCookie(request, session.token, session.expiresAt), "Cache-Control": "no-store" } });
  }
  if (input.action === "logout") {
    await revokeDashboardSession(request);
    return Response.json({ authenticated: false }, { headers: { "Set-Cookie": expiredDashboardSessionCookie(request), "Cache-Control": "no-store" } });
  }
  if (input.action === "set-password") {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    if (input.password !== input.confirmation) return Response.json({ error: "The password confirmation does not match." }, { status: 400 });
    try {
      await setDashboardPassword(String(input.password || ""), `${owner.name} <${owner.email}>`);
      return Response.json({ saved: true, email: DISPLAY_EMAIL, priorSessionsRevoked: true });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The dashboard password could not be saved." }, { status: 400 });
    }
  }
  return Response.json({ error: "A valid dashboard access action is required." }, { status: 400 });
}

async function requireOwner(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || actor.accessLevel !== "Company Owner") {
    return Response.json({ error: "Only the Company Owner can control the dashboard display password." }, { status: 403 });
  }
  return actor;
}
