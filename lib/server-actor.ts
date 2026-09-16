export type CommandActor = {
  name: string;
  email: string;
  authenticationEmail?: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  authenticated: boolean;
  identityProvider: "command_center_preview" | "sites_authenticated_user";
  authorizationStatus?: "Active" | "Inactive" | "Unregistered" | "Microsoft Access Blocked" | "Unavailable";
};

export function canonicalCommandEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getCommandActor(request: Request): CommandActor {
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get(
    "oai-authenticated-user-full-name-encoding",
  );
  const fullName =
    encodedName && encoding === "percent-encoded-utf-8"
      ? safeDecode(encodedName)
      : null;

  if (email) {
    return {
      name: fullName || email,
      email,
      authenticationEmail: email,
      accessLevel: "Employee",
      authenticated: true,
      identityProvider: "sites_authenticated_user",
    };
  }

  const host = new URL(request.url).hostname;
  if (host === "terminal.local" || host === "localhost") {
    return {
      name: "Jordan Mefford",
      email: "jmefford@meffcon.com",
      accessLevel: "Employee",
      authenticated: true,
      identityProvider: "command_center_preview",
    };
  }

  return {
    name: "Unknown User",
    email: "",
    accessLevel: "Employee",
    authenticated: false,
    identityProvider: "sites_authenticated_user",
  };
}

/**
 * Resolve every internal request through one fail-closed authorization path.
 * The Sites/ChatGPT email is authentication evidence only. Company identity,
 * active status and role always come from the canonical company member row.
 * Verified aliases are data-controlled so a temporary platform login never
 * becomes a second employee, sender, queue or source of authorization.
 */
export async function resolveCommandActor(request: Request): Promise<CommandActor> {
  const authenticated = getCommandActor(request);
  if (!authenticated.authenticated || !authenticated.email) return authenticated;

  try {
    const { env } = await import("cloudflare:workers");
    const loginEmail = authenticated.email.trim().toLowerCase();
    const alias = await env.DB.prepare(
      `SELECT canonical_email
       FROM command_identity_aliases
       WHERE lower(alias_email) = ? AND is_verified = 1 AND disabled_at IS NULL
       LIMIT 1`,
    ).bind(loginEmail).first<{ canonical_email: string }>();
    const canonicalEmail = String(alias?.canonical_email || loginEmail).trim().toLowerCase();
    const member = await env.DB.prepare(
      `SELECT email, display_name, company_access_level, is_active
       FROM company_members
       WHERE lower(email) = ?
       LIMIT 1`,
    ).bind(canonicalEmail).first<{
      email: string;
      display_name: string;
      company_access_level: string;
      is_active: number;
    }>();

    if (!member) {
      return { ...authenticated, email: canonicalEmail, accessLevel: "Employee", authenticated: false, authorizationStatus: "Unregistered" };
    }
    if (!member.is_active) {
      return { ...authenticated, name: member.display_name, email: member.email.toLowerCase(), accessLevel: "Employee", authenticated: false, authorizationStatus: "Inactive" };
    }

    const accessLevel = normalizeAccessLevel(member.company_access_level);
    const resolved: CommandActor = {
      ...authenticated,
      name: member.display_name || authenticated.name,
      email: member.email.toLowerCase(),
      authenticationEmail: loginEmail,
      accessLevel,
      authenticated: true,
      authorizationStatus: "Active",
    };
    const { microsoftAccessGateForActor } = await import("./microsoft-access-server");
    const microsoft = await microsoftAccessGateForActor(resolved);
    if (!microsoft.allowed) {
      return { ...resolved, accessLevel: "Employee", authenticated: false, authorizationStatus: "Microsoft Access Blocked" };
    }
    return resolved;
  } catch (error) {
    console.error("Command authorization resolution failed", error);
    return { ...authenticated, accessLevel: "Employee", authenticated: false, authorizationStatus: "Unavailable" };
  }
}

function normalizeAccessLevel(value: string): CommandActor["accessLevel"] {
  if (value === "Company Owner" || value === "Administrator") return value;
  return "Employee";
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
