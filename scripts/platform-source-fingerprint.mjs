import { createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
export async function sourceFingerprint(){
  const hash=createHash('sha256');
  async function walk(relative){for(const entry of (await readdir(new URL(relative,root),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=relative+'/'+entry.name;if(entry.isDirectory())await walk(path);else if(/\.(tsx?|jsx?|mjs|css|sql|json|docx|pdf)$/.test(path)){hash.update(path);hash.update(await readFile(new URL(path,root)));}}}
  for(const directory of ['app','lib','db','drizzle','assets/templates'])await walk(directory);
  for(const file of ['package.json','package-lock.json']){hash.update(file);hash.update(await readFile(new URL(file,root)));}
  return hash.digest('hex');
}
