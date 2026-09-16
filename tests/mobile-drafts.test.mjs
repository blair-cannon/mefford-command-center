import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { clearOfflineMobileData, mobileQueueCount, readUnfinishedWork, removeUnfinishedWork, saveUnfinishedWork } from "../lib/mobile-client.ts";
import { draftStorageKey } from "../lib/workspace-usability.ts";

test("encrypted field drafts preserve text and original photos without submitting them", async () => {
  await clearOfflineMobileData();
  const key = draftStorageKey("field@example.com", "26-001", "Daily Logs");
  const data = { description: "Wall framing complete", crew: ["Field Employee"], date: "2026-09-16" };
  const photo = new File([new Uint8Array([1, 2, 3, 4])], "jobsite.jpg", { type: "image/jpeg", lastModified: 12345 });
  await saveUnfinishedWork(key, data, [photo]);
  const restored = await readUnfinishedWork(key);
  assert.deepEqual(restored.data, data);
  assert.equal(restored.files[0].name, photo.name);
  assert.equal(restored.files[0].lastModified, photo.lastModified);
  assert.deepEqual(await restored.files[0].arrayBuffer(), await photo.arrayBuffer());
  assert.equal(await mobileQueueCount(), 0, "an unfinished draft must never enter the upload queue");

  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("mefford-command-mobile", 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction("assigned-projects").objectStore("assigned-projects").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert.equal(stored.encrypted, true);
    assert.ok(stored.data.cipher instanceof ArrayBuffer);
    assert.ok(stored.draftFiles[0].encrypted.cipher instanceof ArrayBuffer);
    assert.ok(!JSON.stringify(stored).includes(data.description), "draft text is never stored as plaintext");
  } finally { db.close(); }
  await removeUnfinishedWork(key);
  assert.equal(await readUnfinishedWork(key), null);
});

test("concurrent first saves retain one usable encryption key and isolate employee/project drafts", async () => {
  await clearOfflineMobileData();
  const keys = [draftStorageKey("a@example.com", "26-001", "Daily Logs"), draftStorageKey("b@example.com", "26-001", "Daily Logs"), draftStorageKey("a@example.com", "26-002", "Daily Logs")];
  await Promise.all(keys.map((key, index) => saveUnfinishedWork(key, { description: `Draft ${index}` }, [])));
  for (const [index, key] of keys.entries()) assert.equal((await readUnfinishedWork(key)).data.description, `Draft ${index}`);
  await removeUnfinishedWork(keys[0]);
  assert.equal(await readUnfinishedWork(keys[0]), null);
  assert.equal((await readUnfinishedWork(keys[1])).data.description, "Draft 1");
  assert.equal((await readUnfinishedWork(keys[2])).data.description, "Draft 2");
  await clearOfflineMobileData();
  for (const key of keys) assert.equal(await readUnfinishedWork(key), null, "revocation cleanup removes device drafts");
});
