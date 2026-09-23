#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-b89e6a3de5270124d3ec4d723e97f93e}"
export CF_D1_DATABASE_NAME="${CF_D1_DATABASE_NAME:-mefford-command-center}"
export CF_D1_DATABASE_ID="${CF_D1_DATABASE_ID:-d13ceb68-1e26-47b8-a3c5-1f519f51f3ab}"
export CF_R2_BUCKET_NAME="${CF_R2_BUCKET_NAME:-mefford-command-center-files}"

echo "==> Building (typecheck, lint, tests, mutation gate all run as part of this)..."
npm run build

migrations_config="${TMPDIR:-/tmp}/wrangler-migrations.json"
echo "==> Preparing a migrations config pointing at drizzle/ (the generated config defaults to a migrations/ folder that doesn't exist here)..."
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('dist/server/wrangler.json'));
config.d1_databases[0].migrations_dir = '${project_root}/drizzle';
fs.writeFileSync('${migrations_config}', JSON.stringify(config));
"

echo "==> Applying any pending D1 migrations to production..."
npx wrangler d1 migrations apply "${CF_D1_DATABASE_NAME}" --remote -c "${migrations_config}"

echo "==> Deploying the Worker..."
npx wrangler deploy -c dist/server/wrangler.json

echo "==> Deploy complete."
