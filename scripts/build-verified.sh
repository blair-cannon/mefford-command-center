#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
typescript_compiler="${SITES_PROJECT_ROOT}/node_modules/.bin/tsc"
eslint="${SITES_PROJECT_ROOT}/node_modules/.bin/eslint"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

if [[ ! -x "${typescript_compiler}" ]]; then
  echo "TypeScript is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

if [[ ! -x "${eslint}" ]]; then
  echo "ESLint is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running F-07 spreadsheet supply-chain verification..."
node "${script_dir}/verify-spreadsheet-security.mjs"

echo "Running strict TypeScript verification..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_TYPECHECK_KILL_AFTER:-10s}" \
  "${SITES_TYPECHECK_TIMEOUT:-4m}" \
  "${typescript_compiler}" --noEmit --pretty false

echo "Running static control verification..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_LINT_KILL_AFTER:-10s}" \
  "${SITES_LINT_TIMEOUT:-6m}" \
  "${eslint}" . --ignore-pattern dist --ignore-pattern .next

echo "Running bounded vinext build..."
# Vinext's nested server builds retain old hashed chunks unless the parent
# output is cleared first. Only generated output belongs in this directory.
rm -rf -- "${SITES_PROJECT_ROOT:?}/dist"
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

"${script_dir}/validate-artifact.sh"

echo "Running F-06 behavioral, runtime, role, migration, fault, and invariant controls..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_TEST_KILL_AFTER:-10s}" \
  "${SITES_TEST_TIMEOUT:-6m}" \
  node \
    --experimental-strip-types \
    --import "${SITES_PROJECT_ROOT}/tests/support/f06-cloudflare-loader.mjs" \
    --experimental-test-coverage \
    --test-coverage-include="${SITES_PROJECT_ROOT}/lib/accounting-ledger.ts" \
    --test-coverage-include="${SITES_PROJECT_ROOT}/lib/project-health-core.js" \
    --test-coverage-include="${SITES_PROJECT_ROOT}/lib/scheduler-reliability.js" \
    --test-coverage-include="${SITES_PROJECT_ROOT}/lib/system-health-evidence.js" \
    --test-coverage-lines=85 \
    --test-coverage-branches=70 \
    --test-coverage-functions=85 \
    --test-concurrency="${SITES_TEST_CONCURRENCY:-2}" \
    --test "${SITES_PROJECT_ROOT}"/tests/*.test.mjs

echo "Running F-06 critical-control mutation verification..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_MUTATION_KILL_AFTER:-10s}" \
  "${SITES_MUTATION_TIMEOUT:-1m}" \
  node "${SITES_PROJECT_ROOT}/scripts/f06-mutation-gate.mjs"

echo "F-06 release evidence verified: static analysis, compiled runtime behavior, minimum coverage, and mutation score all passed."
