import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return directoryBytes(path);
    if (entry.isSymbolicLink()) throw new Error(`Worker output cannot contain a symbolic link: ${entry.name}`);
    return (await stat(path)).size;
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

const directory = process.argv[2];
if (!directory) throw new Error("A generated Worker directory is required.");
const bytes = await directoryBytes(directory);
// Leave room for hosting's small generated entry wrapper below its 64 MiB limit.
const maximum = 60 * 1024 * 1024;
if (bytes > maximum) {
  throw new Error(`Worker files total ${(bytes / 1024 / 1024).toFixed(2)} MiB, exceeding the 60 MiB release budget. Clean the generated output and rebuild before publishing.`);
}
console.log(`Worker file size verified: ${(bytes / 1024 / 1024).toFixed(2)} MiB / 60 MiB.`);
