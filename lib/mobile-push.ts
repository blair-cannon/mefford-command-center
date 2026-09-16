import { and, eq } from "drizzle-orm";
import { mobileDeviceSessions } from "../db/schema";

export async function deliverOperationalPush(recipientEmail: string) {
  const { env } = await import("cloudflare:workers");
  const binding = env as unknown as Record<string, unknown>;
  const publicKey = String(binding.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(binding.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  const subject = String(binding.WEB_PUSH_VAPID_SUBJECT || "mailto:it@meffcon.com").trim();
  if (!publicKey || !privateKey) return { status: "Connection Required", sent: 0, attempted: 0, receipts: [], transientFailures: 0, permanentFailures: 0 };

  const { getDb } = await import("../db");
  const db = getDb();
  const sessions = await db
    .select()
    .from(mobileDeviceSessions)
    .where(and(
      eq(mobileDeviceSessions.userEmail, recipientEmail),
      eq(mobileDeviceSessions.status, "Trusted"),
      eq(mobileDeviceSessions.pushEnabled, true),
    ));
  let sent = 0;
  let transientFailures = 0;
  let permanentFailures = 0;
  const receipts: Array<{ deviceId: string; status: number; receiptId: string; acceptedAt: string }> = [];
  for (const session of sessions) {
    try {
      const subscription = JSON.parse(session.pushSubscriptionJson || "{}") as { endpoint?: string };
      if (!subscription.endpoint) continue;
      const response = await sendWebPushSignal(subscription.endpoint, publicKey, privateKey, subject);
      if (response.ok) {
        sent += 1;
        receipts.push({
          deviceId: session.id,
          status: response.status,
          receiptId: response.headers.get("x-request-id") || response.headers.get("location") || `${session.id}:${response.status}:${Date.now()}`,
          acceptedAt: new Date().toISOString(),
        });
        continue;
      }
      if ([404, 410].includes(response.status)) {
        permanentFailures += 1;
        await db.update(mobileDeviceSessions).set({ pushEnabled: false, pushSubscriptionJson: "", updatedAt: new Date().toISOString() }).where(eq(mobileDeviceSessions.id, session.id));
      } else {
        transientFailures += 1;
      }
    } catch {
      transientFailures += 1;
      // The delivery event remains queued for the next reconciliation attempt.
    }
  }
  return { status: sessions.length ? (sent ? "Provider Accepted" : "Retry") : "No Enabled Device", sent, attempted: sessions.length, receipts, transientFailures, permanentFailures };
}

async function sendWebPushSignal(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const audience = new URL(endpoint).origin;
  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlJson({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("jwk", privateJwk(publicKey, privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)));
  const token = `${unsigned}.${base64Url(signature)}`;
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${publicKey}`,
      TTL: "86400",
      Urgency: "normal",
    },
  });
}

function privateJwk(publicKey: string, privateKey: string): JsonWebKey {
  const point = base64UrlDecode(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error("The VAPID public key is invalid");
  return {
    kty: "EC",
    crv: "P-256",
    x: base64Url(point.slice(1, 33)),
    y: base64Url(point.slice(33, 65)),
    d: privateKey,
    ext: true,
    key_ops: ["sign"],
  };
}

function base64UrlJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
