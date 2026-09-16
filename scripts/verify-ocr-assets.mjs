import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OCR_ASSET_PATH } from '../lib/ocr-assets.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const shipped = path.join(root, 'dist/client', OCR_ASSET_PATH);
const manifest = JSON.parse(await readFile(path.join(shipped,'manifest.json'),'utf8'));
assert.equal(manifest.assets.length,8);
for (const asset of manifest.assets) {
  const bytes = await readFile(path.join(shipped,asset.name));
  assert.equal(bytes.length,asset.bytes,asset.name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.name);
  assert.deepEqual(bytes,await readFile(path.join(root,'public',OCR_ASSET_PATH,asset.name)),asset.name);
}
console.log('Validated all eight packaged OCR assets and their checksums.');
