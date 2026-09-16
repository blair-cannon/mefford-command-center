import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tsconfig = JSON.parse(fs.readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8"));
const verifiedBuild = fs.readFileSync(new URL("../scripts/build-verified.sh", import.meta.url), "utf8");

test("F-05 enforces zero-error TypeScript verification before every production build", () => {
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noEmit, true);
  assert.ok(tsconfig.compilerOptions.types.includes("@cloudflare/workers-types"));
  assert.match(packageJson.scripts.typecheck, /tsc --noEmit --pretty false/);
  assert.match(verifiedBuild, /Running strict TypeScript verification/);
  assert.ok(verifiedBuild.indexOf('"${typescript_compiler}" --noEmit --pretty false') < verifiedBuild.indexOf('"${vinext}" build'));
});
