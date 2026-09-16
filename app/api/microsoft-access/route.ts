import { enforceOnboardingAccess } from "../../../lib/onboarding";
import {
  AccessControlError,
  applyOwnerMicrosoftAccessDecision,
  loadMicrosoftAccessSnapshot,
  syncMicrosoftDirectory,
} from "../../../lib/microsoft-access-server";
import { resolveCommandActor } from "../../../lib/server-actor";

type AccessInput = {
  action?: string;
  providerSubject?: string;
  accessLevel?: string;
  designations?: string[];
  projectScopes?: string[];
  reason?: string;
  confirmation?: string;
};

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const snapshot = await loadMicrosoftAccessSnapshot(actor);
    if (!snapshot.actor.canManage && !snapshot.actor.canSync) {
      return Response.json({ error: "Company Owner Or IT Administrator Access Is Required" }, { status: 403 });
    }
    return Response.json({ ...snapshot, identityTransition: await identityTransition(actor, snapshot) });
  } catch (error) {
    return accessError(error);
  }
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const input = await request.json() as AccessInput;
    if (input.action === "disable-temporary-jordan-login") {
      if (actor.accessLevel !== "Company Owner") return Response.json({ error: "Only A Company Owner Can Retire A Temporary Authentication Bridge" }, { status: 403 });
      if (input.confirmation !== "DISABLE DJMEFF22 GMAIL BRIDGE") return Response.json({ error: "Type DISABLE DJMEFF22 GMAIL BRIDGE exactly to confirm this identity cutover" }, { status: 400 });
      const snapshot = await loadMicrosoftAccessSnapshot(actor);
      const transition = await identityTransition(actor, snapshot);
      if (!transition.canDisable) return Response.json({ error: transition.blockedReason }, { status: 409 });
      const { env } = await import("cloudflare:workers");
      const now = new Date().toISOString();
      const microsoftUser = snapshot.users.find((user) => user.email === "jmefford@meffcon.com");
      await env.DB.batch([
        env.DB.prepare("UPDATE command_identity_aliases SET disabled_at = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE lower(alias_email) = 'djmeff22@gmail.com' AND lower(canonical_email) = 'jmefford@meffcon.com' AND disabled_at IS NULL").bind(now, actor.email, now, now),
        env.DB.prepare(`INSERT INTO microsoft_access_audits
          (id, provider_subject, microsoft_email, action, prior_status, next_status, actor_name, actor_email, actor_type, reason, detail_json, sync_run_id, created_at)
          VALUES (?, ?, 'jmefford@meffcon.com', 'Temporary ChatGPT Login Bridge Disabled', 'Verified Temporary Bridge', 'Canonical Microsoft Identity Only', ?, ?, 'Human', 'Owner confirmed canonical Microsoft sign-in before retiring the temporary ChatGPT login bridge', ?, '', ?)`)
          .bind(crypto.randomUUID(), microsoftUser?.providerSubject || "", actor.name, actor.email, JSON.stringify({ retiredAlias: "djmeff22@gmail.com", canonicalIdentity: "jmefford@meffcon.com", authenticationEmail: actor.authenticationEmail }), now),
      ]);
      return Response.json({ saved: true, notice: "The temporary djmeff22@gmail.com authentication bridge is disabled. Jordan now uses only jmefford@meffcon.com." });
    }
    if (input.action === "sync-directory") {
      const snapshot = await loadMicrosoftAccessSnapshot(actor);
      if (!snapshot.actor.canSync) return Response.json({ error: "Company Owner Or IT Administrator Access Is Required" }, { status: 403 });
      const result = await syncMicrosoftDirectory({
        triggerSource: actor.accessLevel === "Company Owner" ? "Owner Request" : "IT Request",
        actorName: actor.name,
        actorEmail: actor.email,
      });
      if ("scheduledOutcome" in result && result.scheduledOutcome === "Deferred") {
        return Response.json({ error: "Microsoft 365 Is Not Connected Yet", detail: result.reason }, { status: 503 });
      }
      return Response.json({ saved: true, result, notice: "Microsoft 365 Directory Reconciliation Completed. No Command Center Access Was Granted Automatically." });
    }
    if (["grant-access", "update-access", "activate-access", "suspend-access", "revoke-access", "restore-access"].includes(input.action || "")) {
      const result = await applyOwnerMicrosoftAccessDecision(actor, {
        action: input.action as "grant-access" | "update-access" | "activate-access" | "suspend-access" | "revoke-access" | "restore-access",
        providerSubject: String(input.providerSubject || "").trim(),
        accessLevel: input.accessLevel,
        designations: input.designations,
        projectScopes: input.projectScopes,
        reason: input.reason,
      });
      return Response.json(result);
    }
    return Response.json({ error: "A Supported Microsoft Access Action Is Required" }, { status: 400 });
  } catch (error) {
    return accessError(error);
  }
}

async function identityTransition(actor: Awaited<ReturnType<typeof resolveCommandActor>>, snapshot: Awaited<ReturnType<typeof loadMicrosoftAccessSnapshot>>) {
  const { env } = await import("cloudflare:workers");
  const bridge = await env.DB.prepare(
    "SELECT alias_email, canonical_email, disabled_at FROM command_identity_aliases WHERE lower(alias_email) = 'djmeff22@gmail.com' LIMIT 1",
  ).first<{ alias_email: string; canonical_email: string; disabled_at: string | null }>();
  const microsoftUser = snapshot.users.find((user) => user.email === "jmefford@meffcon.com");
  const canonicalAuthenticationProven = actor.authenticationEmail?.toLowerCase() === "jmefford@meffcon.com";
  const microsoftReady = snapshot.connection.enforced && snapshot.connection.entra.configured && snapshot.connection.configured;
  const jordanReady = Boolean(microsoftUser?.accountEnabled && microsoftUser.directoryPresent && microsoftUser.accessStatus === "Active");
  const bridgeEnabled = Boolean(bridge && !bridge.disabled_at);
  const blockedReason = !bridgeEnabled
    ? "The temporary bridge is already disabled."
    : !canonicalAuthenticationProven
      ? "First sign in successfully as jmefford@meffcon.com. Command Center will not disable the current login path before canonical authentication is proven."
      : !microsoftReady
        ? "Microsoft directory, Entra authentication, and access enforcement must all be active before cutover."
        : !jordanReady
          ? "Jordan's jmefford@meffcon.com directory account and Owner-approved Active access must be verified before cutover."
          : "";
  return {
    canonicalIdentity: "jmefford@meffcon.com",
    temporaryAuthenticationAlias: "djmeff22@gmail.com",
    bridgeEnabled,
    authenticationEmail: actor.authenticationEmail || actor.email,
    canonicalAuthenticationProven,
    microsoftReady,
    jordanReady,
    canDisable: bridgeEnabled && canonicalAuthenticationProven && microsoftReady && jordanReady,
    blockedReason,
  };
}

function accessError(error: unknown) {
  const status = error instanceof AccessControlError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Microsoft Access Control Could Not Complete This Action";
  return Response.json({ error: message }, { status });
}
