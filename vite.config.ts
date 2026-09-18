import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";
import { prepareOcrAssets } from "./build/ocr-assets.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Local dev/tests use Miniflare's emulated D1/R2, so a placeholder database ID
// and made-up bucket name work fine there. A real production build sets
// CF_D1_DATABASE_ID/CF_D1_DATABASE_NAME/CF_R2_BUCKET_NAME (see
// docs/DEPLOYMENT_AND_ROLLBACK.md) so the wrangler.json emitted by this same
// build (dist/server/wrangler.json, consumed directly by `wrangler deploy`)
// carries the real bindings — there is deliberately no second, hand-maintained
// wrangler.toml/jsonc for production that could drift out of sync with this one.
const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: process.env.CF_D1_DATABASE_NAME || "site-creator-d1",
          database_id: process.env.CF_D1_DATABASE_ID || SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: process.env.CF_R2_BUCKET_NAME || "site-creator-r2",
        },
      ]
    : [],
  triggers: {
    crons: ["*/5 * * * *"],
  },
};

export default defineConfig(async () => {
  await prepareOcrAssets(process.cwd());
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    build: {
      // The ERP shell must remain below the enforced 1 MB minified asset budget.
      // Large workspaces and file processors are loaded on demand.
      chunkSizeWarningLimit: 1000,
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
