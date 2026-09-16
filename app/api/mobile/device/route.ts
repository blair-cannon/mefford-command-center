import { and, desc, eq } from "drizzle-orm";
import {
  companyMembers,
  mobileDeviceAudits,
  mobileDeviceSessions,
} from "../../../../db/schema";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";

const OFFLINE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_MS = 2 * 60 * 1000;

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  if (new URL(request.url).searchParams.get("action") === "push-config") {
    const { env } = await import("cloudflare:workers");
    const vapidPublicKey = String((env as unknown as Record<string, unknown>).WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
    if (!vapidPublicKey) return Response.json({ error: "Operational push delivery is not configured" }, { status: 503 });
    return Response.json({ vapidPublicKey });
  }
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const accessLevel = await effectiveAccessLevel(actor.email, actor.accessLevel);
  const canAdminister = ["Company Owner", "Administrator"].includes(accessLevel);
  const deviceFingerprint = clean(new URL(request.url).searchParams.get("deviceId"), 180);
  const currentSessionId = deviceFingerprint ? await deviceSessionId(actor.email, deviceFingerprint) : "";
  const sessions = await db
    .select()
    .from(mobileDeviceSessions)
    .where(canAdminister ? undefined : eq(mobileDeviceSessions.userEmail, actor.email))
    .orderBy(desc(mobileDeviceSessions.lastSeenAt))
    .limit(canAdminister ? 250 : 25);
  return Response.json({
    sessions: sessions.map(publicSession),
    currentSessionId,
    canAdminister,
    offlineDays: 7,
  });
}

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  const input = await request.json() as Record<string, unknown>;
  const action = clean(input.action, 40);
  const deviceFingerprint = clean(input.deviceId, 180);
  const { getDb } = await import("../../../../db");
  const db = getDb();
  const accessLevel = await effectiveAccessLevel(actor.email, actor.accessLevel);
  const canAdminister = ["Company Owner", "Administrator"].includes(accessLevel);

  if (action === "register" || action === "seen") {
    if (!deviceFingerprint) {
      return Response.json({ error: "Device identity is required" }, { status: 400 });
    }
    const id = await deviceSessionId(actor.email, deviceFingerprint);
    const existing = await db
      .select()
      .from(mobileDeviceSessions)
      .where(eq(mobileDeviceSessions.id, id))
      .limit(1);
    if (existing[0]?.status === "Revoked") {
      return Response.json(
        { error: "This device session was remotely revoked. Sign in and ask an Owner or Administrator to restore access." },
        { status: 403 },
      );
    }
    const now = new Date();
    const lastSeenAt = now.toISOString();
    const offlineExpiresAt = new Date(now.getTime() + OFFLINE_SESSION_MS).toISOString();
    const values = {
      id,
      userEmail: actor.email,
      userName: actor.name,
      deviceFingerprint,
      deviceName: clean(input.deviceName, 120) || "Command Center Device",
      platform: clean(input.platform, 120) || "Web App",
      status: "Trusted",
      lastSeenAt,
      offlineExpiresAt,
      updatedAt: lastSeenAt,
    };
    await db
      .insert(mobileDeviceSessions)
      .values(values)
      .onConflictDoUpdate({
        target: mobileDeviceSessions.id,
        set: values,
      });
    if (!existing[0]) {
      await audit(id, actor.email, actor, "Device Trusted", `${values.deviceName} · ${values.platform}`);
    }
    return Response.json({ session: publicSession({ ...existing[0], ...values }) });
  }

  if (action === "revoke") {
    const sessionId = clean(input.sessionId, 180);
    const target = await db
      .select()
      .from(mobileDeviceSessions)
      .where(eq(mobileDeviceSessions.id, sessionId))
      .limit(1);
    if (!target[0]) return Response.json({ error: "Device session not found" }, { status: 404 });
    if (!canAdminister && target[0].userEmail !== actor.email) {
      return Response.json({ error: "You cannot revoke this device" }, { status: 403 });
    }
    const now = new Date().toISOString();
    await db
      .update(mobileDeviceSessions)
      .set({
        status: "Revoked",
        revokedAt: now,
        revokedBy: actor.name,
        pushEnabled: false,
        pushSubscriptionJson: "",
        pendingChallenge: "",
        challengeExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(mobileDeviceSessions.id, sessionId));
    await audit(sessionId, target[0].userEmail, actor, "Device Revoked", clean(input.reason, 500) || "Remote access revoked");
    return Response.json({ revoked: true, sessionId });
  }

  if (!deviceFingerprint) {
    return Response.json({ error: "Device identity is required" }, { status: 400 });
  }
  const id = await deviceSessionId(actor.email, deviceFingerprint);
  const session = await db
    .select()
    .from(mobileDeviceSessions)
    .where(and(eq(mobileDeviceSessions.id, id), eq(mobileDeviceSessions.status, "Trusted")))
    .limit(1);
  if (!session[0]) {
    return Response.json({ error: "A trusted device session is required" }, { status: 403 });
  }

  if (action === "biometric-enroll") {
    const credentialId = clean(input.credentialId, 1200);
    const publicKey = clean(input.publicKey, 12000);
    const algorithm = Number(input.algorithm);
    const rpId = new URL(request.url).hostname;
    if (!credentialId || !publicKey || ![-7, -257].includes(algorithm)) {
      return Response.json({ error: "A verifiable platform credential is required" }, { status: 400 });
    }
    const now = new Date().toISOString();
    await db
      .update(mobileDeviceSessions)
      .set({ biometricCredentialId: credentialId, biometricPublicKey: publicKey, biometricAlgorithm: algorithm, biometricSignCount: 0, biometricRpId: rpId, updatedAt: now })
      .where(eq(mobileDeviceSessions.id, id));
    await audit(id, actor.email, actor, "Face ID Enrolled", `Verified platform credential bound to ${rpId}`);
    return Response.json({ enrolled: true, credentialId, rpId });
  }

  if (action === "step-up-challenge") {
    if (!session[0].biometricCredentialId || !session[0].biometricPublicKey || !session[0].biometricRpId) {
      return Response.json({ error: "Face ID must be enrolled on this device first" }, { status: 409 });
    }
    const challenge = randomToken(32);
    const expiresAt = new Date(Date.now() + CHALLENGE_MS).toISOString();
    await db
      .update(mobileDeviceSessions)
      .set({ pendingChallenge: challenge, challengeExpiresAt: expiresAt, updatedAt: new Date().toISOString() })
      .where(eq(mobileDeviceSessions.id, id));
    return Response.json({ challenge, credentialId: session[0].biometricCredentialId, rpId: session[0].biometricRpId, expiresAt });
  }

  if (action === "step-up-verify") {
    const challenge = clean(input.challenge, 200);
    const assertionId = clean(input.assertionId, 1200);
    const actionLabel = clean(input.actionLabel, 240);
    const assertion = {
      authenticatorData: clean(input.authenticatorData, 12000),
      clientDataJSON: clean(input.clientDataJSON, 12000),
      signature: clean(input.signature, 12000),
    };
    const challengeMatches = Boolean(challenge && challenge === session[0].pendingChallenge);
    const credentialMatches = Boolean(assertionId && assertionId === session[0].biometricCredentialId);
    const challengeFresh = Boolean(session[0].challengeExpiresAt && new Date(session[0].challengeExpiresAt).getTime() >= Date.now());
    if (!challengeMatches || !credentialMatches || !challengeFresh) {
      return Response.json({ error: "Face ID confirmation expired or did not match this device" }, { status: 403 });
    }
    const verification = await verifyWebAuthnAssertion({
      request,
      challenge,
      authenticatorData: assertion.authenticatorData,
      clientDataJSON: assertion.clientDataJSON,
      signature: assertion.signature,
      publicKey: session[0].biometricPublicKey,
      algorithm: session[0].biometricAlgorithm,
      rpId: session[0].biometricRpId,
      priorSignCount: session[0].biometricSignCount,
    });
    if (!verification.verified) {
      return Response.json({ error: verification.error || "Face ID assertion could not be verified" }, { status: 403 });
    }
    const now = new Date().toISOString();
    await db
      .update(mobileDeviceSessions)
      .set({ pendingChallenge: "", challengeExpiresAt: null, biometricSignCount: verification.signCount, lastSeenAt: now, offlineExpiresAt: new Date(Date.now() + OFFLINE_SESSION_MS).toISOString(), updatedAt: now })
      .where(eq(mobileDeviceSessions.id, id));
    await audit(id, actor.email, actor, "Face ID Step-Up Confirmed", actionLabel || "Sensitive mobile action");
    return Response.json({ verified: true, verifiedAt: now });
  }

  if (action === "push-preference") {
    const enabled = input.enabled === true;
    const subscription = enabled ? JSON.stringify(input.subscription || {}) : "";
    const now = new Date().toISOString();
    await db
      .update(mobileDeviceSessions)
      .set({ pushEnabled: enabled, pushSubscriptionJson: subscription, updatedAt: now })
      .where(eq(mobileDeviceSessions.id, id));
    await audit(id, actor.email, actor, enabled ? "Push Enabled" : "Push Disabled", "Assignments, approvals, mentions, due items, escalations, safety alerts and sync failures");
    return Response.json({ pushEnabled: enabled });
  }

  return Response.json({ error: "Unsupported mobile device action" }, { status: 400 });
}

async function effectiveAccessLevel(email: string, fallback: string) {
  const { getDb } = await import("../../../../db");
  const rows = await getDb()
    .select({ accessLevel: companyMembers.companyAccessLevel })
    .from(companyMembers)
    .where(eq(companyMembers.email, email))
    .limit(1);
  return rows[0]?.accessLevel || fallback;
}

async function audit(
  sessionId: string,
  userEmail: string,
  actor: { name: string; email: string },
  action: string,
  detail: string,
) {
  const { getDb } = await import("../../../../db");
  await getDb().insert(mobileDeviceAudits).values({
    sessionId,
    userEmail,
    actorName: actor.name,
    actorEmail: actor.email,
    action,
    detail,
  });
}

async function deviceSessionId(email: string, fingerprint: string) {
  const data = new TextEncoder().encode(`${email.toLowerCase()}|${fingerprint}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `MOB-${Array.from(new Uint8Array(digest)).slice(0, 18).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function publicSession(session: typeof mobileDeviceSessions.$inferSelect | Record<string, unknown>) {
  return {
    id: String(session.id || ""),
    userEmail: String(session.userEmail || ""),
    userName: String(session.userName || ""),
    deviceName: String(session.deviceName || ""),
    platform: String(session.platform || ""),
    status: String(session.status || ""),
    biometricEnrolled: Boolean(session.biometricCredentialId),
    pushEnabled: Boolean(session.pushEnabled),
    lastSeenAt: String(session.lastSeenAt || ""),
    offlineExpiresAt: String(session.offlineExpiresAt || ""),
    revokedAt: session.revokedAt ? String(session.revokedAt) : null,
    revokedBy: String(session.revokedBy || ""),
  };
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyWebAuthnAssertion(input: {
  request: Request;
  challenge: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  publicKey: string;
  algorithm: number;
  rpId: string;
  priorSignCount: number;
}) {
  try {
    if (!input.authenticatorData || !input.clientDataJSON || !input.signature || !input.publicKey) {
      return { verified: false, signCount: input.priorSignCount, error: "The biometric assertion was incomplete" };
    }
    const authenticatorData = base64UrlDecode(input.authenticatorData);
    const clientDataBytes = base64UrlDecode(input.clientDataJSON);
    const signatureBytes = base64UrlDecode(input.signature);
    const publicKeyBytes = base64UrlDecode(input.publicKey);
    if (authenticatorData.length < 37) return { verified: false, signCount: input.priorSignCount, error: "Authenticator data was invalid" };

    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as { type?: string; challenge?: string; origin?: string };
    const expectedOrigin = new URL(input.request.url).origin;
    if (clientData.type !== "webauthn.get" || clientData.challenge !== input.challenge || clientData.origin !== expectedOrigin) {
      return { verified: false, signCount: input.priorSignCount, error: "The biometric assertion was not issued for this Command Center session" };
    }

    const expectedRpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.rpId)));
    if (!constantTimeEqual(authenticatorData.slice(0, 32), expectedRpIdHash)) {
      return { verified: false, signCount: input.priorSignCount, error: "The biometric assertion was issued for a different site" };
    }
    const flags = authenticatorData[32] || 0;
    if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
      return { verified: false, signCount: input.priorSignCount, error: "Face ID or device biometric verification was not completed" };
    }
    const signCount = new DataView(toArrayBuffer(authenticatorData.slice(33, 37))).getUint32(0, false);
    if (input.priorSignCount > 0 && signCount > 0 && signCount <= input.priorSignCount) {
      return { verified: false, signCount: input.priorSignCount, error: "The biometric assertion counter did not advance" };
    }

    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(clientDataBytes)));
    const signedBytes = new Uint8Array(authenticatorData.length + clientHash.length);
    signedBytes.set(authenticatorData, 0);
    signedBytes.set(clientHash, authenticatorData.length);
    const key = await importWebAuthnKey(publicKeyBytes, input.algorithm);
    const verifyAlgorithm: AlgorithmIdentifier | EcdsaParams = input.algorithm === -7
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5" };
    const normalizedSignature = input.algorithm === -7 ? ecdsaDerToRaw(signatureBytes, 32) : signatureBytes;
    const verified = await crypto.subtle.verify(verifyAlgorithm, key, toArrayBuffer(normalizedSignature), toArrayBuffer(signedBytes));
    return { verified, signCount, error: verified ? "" : "The signed biometric assertion did not verify" };
  } catch {
    return { verified: false, signCount: input.priorSignCount, error: "The signed biometric assertion could not be verified" };
  }
}

function importWebAuthnKey(publicKey: Uint8Array, algorithm: number) {
  if (algorithm === -7) {
    return crypto.subtle.importKey("spki", toArrayBuffer(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  if (algorithm === -257) {
    return crypto.subtle.importKey("spki", toArrayBuffer(publicKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  throw new Error("Unsupported platform credential algorithm");
}

function ecdsaDerToRaw(signature: Uint8Array, coordinateLength: number) {
  if (signature[0] !== 0x30) throw new Error("Invalid ECDSA signature");
  let offset = 1;
  const sequence = readDerLength(signature, offset);
  offset = sequence.next;
  if (signature[offset++] !== 0x02) throw new Error("Invalid ECDSA signature");
  const rLength = readDerLength(signature, offset);
  offset = rLength.next;
  const r = signature.slice(offset, offset + rLength.length);
  offset += rLength.length;
  if (signature[offset++] !== 0x02) throw new Error("Invalid ECDSA signature");
  const sLength = readDerLength(signature, offset);
  offset = sLength.next;
  const s = signature.slice(offset, offset + sLength.length);
  const raw = new Uint8Array(coordinateLength * 2);
  raw.set(trimAndPadInteger(r, coordinateLength), 0);
  raw.set(trimAndPadInteger(s, coordinateLength), coordinateLength);
  return raw;
}

function readDerLength(bytes: Uint8Array, offset: number) {
  const first = bytes[offset++];
  if (first < 0x80) return { length: first, next: offset };
  const count = first & 0x7f;
  if (!count || count > 2) throw new Error("Invalid DER length");
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset++];
  return { length, next: offset };
}

function trimAndPadInteger(value: Uint8Array, length: number) {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset += 1;
  const trimmed = value.slice(offset);
  if (trimmed.length > length) throw new Error("ECDSA integer is too large");
  const result = new Uint8Array(length);
  result.set(trimmed, length - trimmed.length);
  return result;
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
