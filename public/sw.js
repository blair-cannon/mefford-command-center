const SHELL_CACHE = "mefford-command-shell-v1";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.svg", "/mefford-logo.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("mefford-command-") && key !== SHELL_CACHE).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put("/", response.clone()));
          return response;
        })
        .catch(() => caches.match("/").then((response) => response || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && ["script", "style", "font", "image"].includes(request.destination)) {
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data
        ? event.data.json()
        : await fetch("/api/mobile/push/latest", { credentials: "include", cache: "no-store" }).then((response) => response.ok ? response.json() : ({}));
    } catch {
      data = { title: "Command Center", body: event.data?.text() || "New work requires attention." };
    }
    await self.registration.showNotification(data.title || "Command Center", {
      body: data.body || "New work requires attention.",
      icon: "/mefford-logo.png",
      badge: "/favicon.svg",
      tag: data.tag || "command-center-work",
      data: { url: data.url || "/?target=My%20Work" },
      requireInteraction: data.priority === "Critical",
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/?target=My%20Work", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "command-mobile-outbox") return;
  event.waitUntil(processEncryptedOutbox());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_MOBILE_CACHE") {
    event.waitUntil(caches.delete(SHELL_CACHE));
  }
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function processEncryptedOutbox() {
  const db = await openMobileDatabase();
  const records = await idbRequest(db.transaction("outbox", "readonly").objectStore("outbox").getAll());
  const keyRecord = await idbRequest(db.transaction("device-crypto", "readonly").objectStore("device-crypto").get("offline-aes-gcm-v1"));
  if (!keyRecord?.key) {
    db.close();
    return notifyMobileClients("COMMAND_MOBILE_SYNC");
  }
  let completed = 0;
  for (const stored of records) {
    if (!stored.encrypted) continue;
    try {
      await notifyMobileClients("COMMAND_MOBILE_SYNC_PROGRESS", { completed, total: records.length, label: `Uploading ${stored.recordType}` });
      const record = JSON.parse(new TextDecoder().decode(await decryptStoredValue(keyRecord.key, stored.record)));
      const syncResponse = await fetch("/api/mobile/sync", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: stored.id, projectId: stored.projectId, recordType: stored.recordType, record, queuedAt: stored.queuedAt, files: [] }) });
      if (!syncResponse.ok) break;
      const sync = await syncResponse.json();
      if (!sync.storedRecordId) break;
      let filesComplete = true;
      for (const file of stored.files || []) {
        const bytes = await decryptStoredValue(keyRecord.key, file.encrypted);
        const form = new FormData();
        form.set("file", new File([bytes], file.name, { type: file.type }));
        form.set("projectId", stored.projectId);
        form.set("category", "Photos");
        form.set("revision", `${sync.storedRecordId} Background Mobile Upload`);
        form.set("access", "Project team");
        const upload = await fetch("/api/files", { method: "POST", credentials: "include", body: form });
        if (!upload.ok) { filesComplete = false; break; }
      }
      if (!filesComplete) break;
      await idbTransaction(db, "outbox", "readwrite", (store) => store.delete(stored.id));
      completed += 1;
    } catch {
      break;
    }
  }
  db.close();
  await notifyMobileClients("COMMAND_MOBILE_SYNC_COMPLETE", { completed, total: records.length });
}

function openMobileDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mefford-command-mobile", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbTransaction(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function decryptStoredValue(key, value) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: value.iv }, key, value.cipher);
}

async function notifyMobileClients(type, detail = {}) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type, ...detail }));
}
