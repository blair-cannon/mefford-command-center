import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const [assistant, shell, css] = await Promise.all([
  readFile(new URL("app/command-assistant.tsx", root), "utf8"),
  readFile(new URL("app/page.tsx", root), "utf8"),
  readFile(new URL("app/globals.css", root), "utf8"),
]);

test("F-16 assistant launcher owns a reserved topbar slot instead of floating over contextual actions", () => {
  assert.match(shell, /<div className="topbar-actions">[\s\S]*<CommandAssistant/);
  assert.match(assistant, /data-placement="topbar-reserved-slot"/);
  assert.match(css, /\.assistant-launcher\{position:static;inset:auto;z-index:auto;flex:0 0 auto/);
  assert.doesNotMatch(css, /\.assistant-launcher\{position:fixed/);
});

test("F-16 only the explicitly opened dialog layer captures the page", () => {
  assert.match(assistant, /\{open \? \([\s\S]*className="assistant-layer"/);
  assert.match(assistant, /aria-expanded=\{open\}/);
  assert.match(assistant, /aria-controls="command-assistant-panel"/);
  assert.match(assistant, /id="command-assistant-panel"/);
  assert.match(assistant, /event\.target === event\.currentTarget && setOpen\(false\)/);
});

test("F-16 narrow screens collapse the label without returning to overlay positioning", () => {
  assert.match(css, /@media\(max-width:1100px\)\{\.assistant-launcher b\{display:none\}/);
  assert.match(css, /@media\(max-width:800px\)[^\n]*\.assistant-launcher\{position:static;inset:auto\}/);
});
