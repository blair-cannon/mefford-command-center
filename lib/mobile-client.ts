export type OfflineMobileRecord = {
  id: string;
  projectId: string;
  recordType: string;
  record: Record<string, unknown>;
  queuedAt: string;
  files: Array<{
    name: string;
    type: string;
    blob: Blob;
  }>;
};

const MOBILE_DB = "mefford-command-mobile";
const MOBILE_DB_VERSION = 2;
const QUEUE_STORE = "outbox";
const SNAPSHOT_STORE = "assigned-projects";
const CRYPTO_STORE = "device-crypto";
const CRYPTO_KEY_ID = "offline-aes-gcm-v1";
const DEVICE_KEY = "command-mobile-device-id";
const LAST_CONNECTED_KEY = "command-mobile-last-connected";

type EncryptedValue = { iv: Uint8Array; cipher: ArrayBuffer };
type EncryptedOfflineRecord = {
  id: string;
  projectId: string;
  recordType: string;
  queuedAt: string;
  encrypted: true;
  record: EncryptedValue;
  files: Array<{ name: string; type: string; encrypted: EncryptedValue }>;
};

function openMobileDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline storage is unavailable on this device."));
      return;
    }
    const request = indexedDB.open(MOBILE_DB, MOBILE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("queuedAt", "queuedAt");
        store.createIndex("projectId", "projectId");
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(CRYPTO_STORE)) {
        db.createObjectStore(CRYPTO_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage could not open."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Offline storage transaction was cancelled."));
  });
}

export function mobileDeviceId() {
  if (typeof window === "undefined") return "server";
  let value = window.localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

export function lastSuccessfulMobileConnection() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_CONNECTED_KEY) || "";
}

export function recordSuccessfulMobileConnection(at = new Date().toISOString()) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_CONNECTED_KEY, at);
  return at;
}

export async function queueOfflineMobileRecord(input: {
  projectId: string;
  recordType: string;
  record: Record<string, unknown>;
  files?: File[];
}) {
  const db = await openMobileDb();
  const key = await offlineEncryptionKey(db);
  const record = await encryptJson(key, input.record);
  const files = await Promise.all((input.files || []).map(async (file) => ({
    name: file.name,
    type: file.type,
    encrypted: await encryptBytes(key, await file.arrayBuffer()),
  })));
  const transaction = db.transaction(QUEUE_STORE, "readwrite");
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const queued: EncryptedOfflineRecord = {
    id,
    projectId: input.projectId,
    recordType: input.recordType,
    queuedAt: new Date().toISOString(),
    encrypted: true,
    record,
    files,
  };
  transaction.objectStore(QUEUE_STORE).put(queued);
  await transactionComplete(transaction);
  db.close();
  window.dispatchEvent(new CustomEvent("command-mobile-queue-changed"));
  void registerBackgroundSync();
  return queued;
}

export async function mobileQueueItems() {
  const db = await openMobileDb();
  const transaction = db.transaction(QUEUE_STORE, "readonly");
  const items = await requestResult(
    transaction.objectStore(QUEUE_STORE).getAll() as IDBRequest<Array<EncryptedOfflineRecord | OfflineMobileRecord>>,
  );
  await transactionComplete(transaction);
  const key = await offlineEncryptionKey(db);
  const decrypted = await Promise.all(items.map(async (item) => {
    if (!("encrypted" in item) || item.encrypted !== true) return item as OfflineMobileRecord;
    return {
      id: item.id,
      projectId: item.projectId,
      recordType: item.recordType,
      queuedAt: item.queuedAt,
      record: await decryptJson(key, item.record),
      files: await Promise.all(item.files.map(async (file) => ({
        name: file.name,
        type: file.type,
        blob: new Blob([await decryptBytes(key, file.encrypted)], { type: file.type }),
      }))),
    } satisfies OfflineMobileRecord;
  }));
  db.close();
  return decrypted.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function mobileQueueCount() {
  const db = await openMobileDb();
  const transaction = db.transaction(QUEUE_STORE, "readonly");
  const count = await requestResult(transaction.objectStore(QUEUE_STORE).count());
  await transactionComplete(transaction);
  db.close();
  return count;
}

async function removeQueuedItem(id: string) {
  const db = await openMobileDb();
  const transaction = db.transaction(QUEUE_STORE, "readwrite");
  transaction.objectStore(QUEUE_STORE).delete(id);
  await transactionComplete(transaction);
  db.close();
}

export async function syncMobileQueue(
  onProgress?: (progress: { completed: number; total: number; label: string }) => void,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { completed: 0, total: await mobileQueueCount(), conflicts: 0 };
  }
  const items = await mobileQueueItems();
  let completed = 0;
  let conflicts = 0;
  for (const item of items) {
    onProgress?.({ completed, total: items.length, label: `Syncing ${item.recordType}` });
    const response = await fetch("/api/mobile/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    const result = await response.json() as {
      storedRecordId?: string;
      conflict?: boolean;
      error?: string;
    };
    if (!response.ok || !result.storedRecordId) {
      throw new Error(result.error || `${item.recordType} could not sync.`);
    }
    if (result.conflict) conflicts += 1;
    for (const file of item.files) {
      const form = new FormData();
      form.set("file", new File([file.blob], file.name, { type: file.type }));
      form.set("projectId", item.projectId);
      form.set("category", "Photos");
      form.set("revision", `${result.storedRecordId} Offline Field Upload`);
      form.set("access", "Project team");
      const upload = await fetch("/api/files", { method: "POST", body: form });
      if (!upload.ok) throw new Error(`${file.name} is still waiting to upload.`);
    }
    await removeQueuedItem(item.id);
    completed += 1;
    onProgress?.({ completed, total: items.length, label: `${item.recordType} synced` });
  }
  recordSuccessfulMobileConnection();
  window.dispatchEvent(new CustomEvent("command-mobile-queue-changed"));
  return { completed, total: items.length, conflicts };
}

export async function saveAssignedProjectSnapshot(projectId: string, data: unknown) {
  const db = await openMobileDb();
  const key = await offlineEncryptionKey(db);
  const encryptedData = await encryptJson(key, data);
  const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).put({
    projectId,
    encrypted: true,
    data: encryptedData,
    savedAt: new Date().toISOString(),
  });
  await transactionComplete(transaction);
  db.close();
}

export async function assignedProjectSnapshot(projectId: string) {
  const db = await openMobileDb();
  const transaction = db.transaction(SNAPSHOT_STORE, "readonly");
  const stored = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(projectId));
  await transactionComplete(transaction);
  if (!stored) {
    db.close();
    return null;
  }
  const key = await offlineEncryptionKey(db);
  const data = stored.encrypted === true ? await decryptJson(key, stored.data) : stored.data;
  db.close();
  return { projectId, data, savedAt: String(stored.savedAt || "") };
}

/** Unsubmitted field drafts are encrypted on this device and never enter the sync outbox. */
export async function saveUnfinishedWork(draftKey: string, data: Record<string, unknown>, files: File[]) {
  if (!draftKey.startsWith("unfinished:")) throw new Error("Invalid unfinished-work key.");
  requireDraftEncryption();
  const db = await openMobileDb();
  try {
    const key = await offlineEncryptionKey(db);
    const encryptedData = await encryptJson(key, data);
    const encryptedFiles = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, lastModified: file.lastModified, encrypted: await encryptBytes(key, await file.arrayBuffer()) })));
    const savedAt = new Date().toISOString();
    const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put({ projectId: draftKey, encrypted: true, data: encryptedData, draftFiles: encryptedFiles, savedAt });
    await transactionComplete(transaction);
    return savedAt;
  } finally { db.close(); }
}

export async function readUnfinishedWork(draftKey: string) {
  if (!draftKey.startsWith("unfinished:")) throw new Error("Invalid unfinished-work key.");
  requireDraftEncryption();
  const db = await openMobileDb();
  try {
    const transaction = db.transaction(SNAPSHOT_STORE, "readonly");
    const stored = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(draftKey));
    await transactionComplete(transaction);
    if (!stored || stored.encrypted !== true) return null;
    const key = await offlineEncryptionKey(db);
    const data = await decryptJson(key, stored.data);
    const files = await Promise.all((stored.draftFiles || []).map(async (file: { name: string; type: string; lastModified: number; encrypted: EncryptedValue }) => new File([await decryptBytes(key, file.encrypted)], file.name, { type: file.type, lastModified: file.lastModified })));
    return { data, files, savedAt: String(stored.savedAt || "") };
  } finally { db.close(); }
}

function requireDraftEncryption() {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Encrypted Drafts Require A Secure Connection. Keep This Form Open Until You Finalize.");
}

export async function removeUnfinishedWork(draftKey: string) {
  if (!draftKey.startsWith("unfinished:")) throw new Error("Invalid unfinished-work key.");
  const db = await openMobileDb();
  try {
    const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(draftKey);
    await transactionComplete(transaction);
  } finally { db.close(); }
}

export async function clearOfflineMobileData() {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(MOBILE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LAST_CONNECTED_KEY);
    window.dispatchEvent(new CustomEvent("command-mobile-queue-changed"));
  }
}

async function offlineEncryptionKey(db: IDBDatabase) {
  const transaction = db.transaction(CRYPTO_STORE, "readonly");
  const existing = await requestResult(transaction.objectStore(CRYPTO_STORE).get(CRYPTO_KEY_ID));
  await transactionComplete(transaction);
  if (existing?.key) return existing.key as CryptoKey;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const createTransaction = db.transaction(CRYPTO_STORE, "readwrite");
  const completion = transactionComplete(createTransaction);
  // The read/write transaction serializes concurrent first saves in this tab or another tab.
  const alreadyCreated = await requestResult(createTransaction.objectStore(CRYPTO_STORE).get(CRYPTO_KEY_ID));
  if (!alreadyCreated?.key) createTransaction.objectStore(CRYPTO_STORE).put({ id: CRYPTO_KEY_ID, key, createdAt: new Date().toISOString() });
  await completion;
  return (alreadyCreated?.key || key) as CryptoKey;
}

async function encryptJson(key: CryptoKey, value: unknown) {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)).buffer);
}

async function decryptJson(key: CryptoKey, value: EncryptedValue) {
  const bytes = await decryptBytes(key, value);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

async function encryptBytes(key: CryptoKey, value: ArrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, value);
  return { iv, cipher };
}

function decryptBytes(key: CryptoKey, value: EncryptedValue) {
  const iv = new Uint8Array(value.iv.length);
  iv.set(value.iv);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer }, key, value.cipher);
}

async function registerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration || !("sync" in registration)) return;
  await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("command-mobile-outbox").catch(() => undefined);
}
