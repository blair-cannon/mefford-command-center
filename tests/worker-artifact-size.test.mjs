import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("the release build removes only generated output before compiling current chunks", async () => {
  const build = await readFile(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");
  const cleanup = 'rm -rf -- "${SITES_PROJECT_ROOT:?}/dist"';
  assert.ok(build.includes(cleanup));
  assert.ok(build.indexOf(cleanup) < build.indexOf('"${vinext}" build'));
  const validation = await readFile(new URL("../scripts/validate-artifact.sh", import.meta.url), "utf8");
  assert.ok(validation.includes('verify-worker-size.mjs" "${SITES_PROJECT_ROOT}/dist/server"'));
});

test("the size gate counts nested Worker chunks and rejects an accumulated oversized release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mefford-worker-budget-"));
  const script = fileURLToPath(new URL("../scripts/verify-worker-size.mjs", import.meta.url));
  try {
    await mkdir(join(directory, "ssr", "assets"), { recursive: true });
    await writeFile(join(directory, "index.js"), "export default {fetch(){return new Response('ok')}}");
    const stale = join(directory, "ssr", "assets", "old-page.js");
    await writeFile(stale, "");
    await truncate(stale, 64 * 1024 * 1024);
    const oversized = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
    assert.notEqual(oversized.status, 0);
    assert.match(oversized.stderr, /exceeding the 60 MiB release budget/);
    await rm(stale);
    const clean = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /Worker file size verified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
