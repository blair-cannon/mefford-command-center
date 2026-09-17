/**
 * PARTIAL RECONSTRUCTION — NOT A RECOVERY OF THE ORIGINAL FILE.
 *
 * This file was missing from the exported project (it's not in git history
 * either), and its original contents are unknown to us. Given its name and
 * where it's used (only inside vite.config.ts, alongside the Cloudflare
 * Workers plugin), it most likely provided integration glue specific to
 * ChatGPT Sites' own dev/preview/publish pipeline — NOT the Microsoft Entra /
 * identity-bridge logic, which lives independently in lib/server-actor.ts
 * and the API routes.
 *
 * One concrete piece of its job was inferred from scripts/validate-artifact.sh,
 * which fails the build if `dist/.openai/hosting.json` doesn't exist: this
 * plugin copies that manifest into the build output so the existing
 * verified-build gate (typecheck, lint, build, artifact validation, tests,
 * mutation score) still runs end-to-end outside of ChatGPT Sites. Anything
 * beyond that copy (e.g. ChatGPT's own preview routing) is not reconstructed
 * here — the original file is still recoverable from the ChatGPT project
 * this app was built in, if more turns out to be needed.
 */
import type { Plugin } from "vite";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

export function sites(): Plugin {
  return {
    name: "sites-plugin-partial-reconstruction",
    async closeBundle() {
      const root = process.cwd();
      const destDir = path.join(root, "dist", ".openai");
      await mkdir(destDir, { recursive: true });
      await copyFile(path.join(root, ".openai", "hosting.json"), path.join(destDir, "hosting.json"));
    },
  };
}
