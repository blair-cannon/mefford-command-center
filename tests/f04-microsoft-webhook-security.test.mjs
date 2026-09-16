import assert from "node:assert/strict";
import test from "node:test";
import { handleMicrosoftWebhookRequest } from "../lib/microsoft-webhook-security.ts";

const NOW = new Date("2026-08-23T14:00:00.000Z");
const SECRET = "test-client-state-that-is-never-a-production-secret";
const SUBSCRIPTION_ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08";

class MemoryStore {
  constructor() {
    this.rateAllowed = true;
    this.window = null;
    this.securityEvents = [];
    this.acceptedEvents = [];
    this.subscriptions = new Map();
  }
  async consumeRateLimit() { return { allowed: this.rateAllowed, retryAfterSeconds: 37 }; }
  async consumeValidationWindow() {
    const current = this.window;
    this.window = null;
    return current;
  }
  async findActiveSubscription(id) { return this.subscriptions.get(id) || null; }
  async recordSecurityEvent(event) { this.securityEvents.push(event); }
  async acceptNotifications(events) { this.acceptedEvents.push(...events); }
}

test("F-04 fails closed when the client-state secret is not configured", async () => {
  const store = new MemoryStore();
  const response = await handleMicrosoftWebhookRequest({ request: notificationRequest([validEvent()]), clientState: "", store, now: NOW });
  assert.equal(response.status, 503);
  assert.equal(store.acceptedEvents.length, 0);
  assert.equal(store.securityEvents.at(-1).reasonCode, "Client State Missing");
});

test("F-04 accepts a validation token only during one authorized subscription window", async () => {
  const store = new MemoryStore();
  const closed = await handleMicrosoftWebhookRequest({ request: challengeRequest("microsoft-token"), clientState: SECRET, store, now: NOW });
  assert.equal(closed.status, 403);
  assert.equal(store.securityEvents.at(-1).reasonCode, "Validation Window Closed");

  store.window = { id: "window-1" };
  const accepted = await handleMicrosoftWebhookRequest({ request: challengeRequest("microsoft-token"), clientState: SECRET, store, now: NOW });
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), "microsoft-token");
  assert.equal(accepted.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(store.securityEvents.at(-1).reasonCode, "Validation Handshake");

  const replayed = await handleMicrosoftWebhookRequest({ request: challengeRequest("microsoft-token"), clientState: SECRET, store, now: NOW });
  assert.equal(replayed.status, 403);
});

test("F-04 rate limits requests before parsing or writing meeting evidence", async () => {
  const store = new MemoryStore();
  store.rateAllowed = false;
  const response = await handleMicrosoftWebhookRequest({ request: notificationRequest([validEvent()]), clientState: SECRET, store, now: NOW });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
  assert.equal(store.acceptedEvents.length, 0);
  assert.equal(store.securityEvents.at(-1).reasonCode, "Rate Limit");
});

test("F-04 rejects invalid JSON, oversized bodies, and malformed event structures", async () => {
  const invalidJsonStore = new MemoryStore();
  const invalidJson = await handleMicrosoftWebhookRequest({
    request: new Request("https://command.example/api/meetings/microsoft-webhook", { method: "POST", headers: jsonHeaders(), body: "{" }),
    clientState: SECRET,
    store: invalidJsonStore,
    now: NOW,
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJsonStore.securityEvents.at(-1).reasonCode, "Invalid JSON");

  const oversizedStore = new MemoryStore();
  const oversized = await handleMicrosoftWebhookRequest({
    request: new Request("https://command.example/api/meetings/microsoft-webhook", { method: "POST", headers: { ...jsonHeaders(), "content-length": "262145" }, body: "{}" }),
    clientState: SECRET,
    store: oversizedStore,
    now: NOW,
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversizedStore.securityEvents.at(-1).reasonCode, "Payload Too Large");

  const malformedStore = new MemoryStore();
  const malformed = await handleMicrosoftWebhookRequest({ request: notificationRequest([{ ...validEvent(), resourceData: {} }]), clientState: SECRET, store: malformedStore, now: NOW });
  assert.equal(malformed.status, 400);
  assert.equal(malformedStore.securityEvents.at(-1).reasonCode, "Resource ID Missing");
});

test("F-04 rejects forged client state, unknown subscriptions, and expired subscriptions", async () => {
  const forgedStore = await activeStore();
  const forged = await handleMicrosoftWebhookRequest({ request: notificationRequest([{ ...validEvent(), clientState: "forged" }]), clientState: SECRET, store: forgedStore, now: NOW });
  assert.equal(forged.status, 401);
  assert.equal(forgedStore.securityEvents.at(-1).reasonCode, "Client State Mismatch");

  const unknownStore = new MemoryStore();
  const unknown = await handleMicrosoftWebhookRequest({ request: notificationRequest([validEvent()]), clientState: SECRET, store: unknownStore, now: NOW });
  assert.equal(unknown.status, 401);
  assert.equal(unknownStore.securityEvents.at(-1).reasonCode, "Subscription Validation Failed");

  const expiredStore = await activeStore();
  expiredStore.subscriptions.get(SUBSCRIPTION_ID).expiration_date_time = "2026-08-23T13:59:59.000Z";
  const expired = await handleMicrosoftWebhookRequest({ request: notificationRequest([validEvent()]), clientState: SECRET, store: expiredStore, now: NOW });
  assert.equal(expired.status, 401);
  assert.equal(expiredStore.securityEvents.at(-1).reasonCode, "Subscription Validation Failed");
});

test("F-04 accepts only known active calendar subscriptions and collapses duplicates within a batch", async () => {
  const store = await activeStore();
  const response = await handleMicrosoftWebhookRequest({ request: notificationRequest([validEvent(), validEvent()]), clientState: SECRET, store, now: NOW });
  assert.equal(response.status, 202);
  assert.equal(store.acceptedEvents.length, 1);
  assert.equal(store.acceptedEvents[0].providerId, "event-123");
  assert.equal(store.securityEvents.at(-1).reasonCode, "Notification Accepted");
});

async function activeStore() {
  const store = new MemoryStore();
  store.subscriptions.set(SUBSCRIPTION_ID, {
    id: SUBSCRIPTION_ID,
    change_type: "created,updated,deleted",
    expiration_date_time: "2026-08-25T14:00:00.000Z",
    client_state_hash: await hash(SECRET),
    status: "Active",
  });
  return store;
}

function validEvent() {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    clientState: SECRET,
    changeType: "updated",
    resource: "Users/41f4f13d-45d0-4a9a-8d7f-62d5a5e66865/Events/event-123",
    resourceData: { id: "event-123" },
  };
}

function notificationRequest(events) {
  return new Request("https://command.example/api/meetings/microsoft-webhook", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ value: events }) });
}

function challengeRequest(token) {
  return new Request(`https://command.example/api/meetings/microsoft-webhook?validationToken=${encodeURIComponent(token)}`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.12" } });
}

function jsonHeaders() {
  return { "content-type": "application/json", "cf-connecting-ip": "203.0.113.12", "cf-ray": "test-ray" };
}

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
