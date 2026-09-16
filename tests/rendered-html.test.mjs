import assert from "node:assert/strict";
import test from "node:test";
import { createF06Runtime, markCleanStartCompleted } from "./support/f06-runtime-harness.mjs";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const runtime = await createF06Runtime();
  try {
    await markCleanStartCompleted(runtime.database);
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);

    const response = await worker.fetch(
      new Request("https://command-center.f06.test/", {
        headers: { accept: "text/html" },
      }),
      runtime.env,
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/html\b/i,
    );
    const html = await response.text();
    assert.match(html, developmentPreviewMeta);
    assert.match(html, /<title>Mefford Project Command Center<\/title>/i);
  } finally {
    await runtime.dispose();
  }
});
