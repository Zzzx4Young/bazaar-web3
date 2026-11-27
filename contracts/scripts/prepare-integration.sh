#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_dir/contracts"
node scripts/bootstrap-solc.mjs
forge=node_modules/@foundry-rs/forge-linux-amd64/bin/forge
anvil=node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil
"$forge" --version
"$anvil" --version
mkdir -p .tmp
# Build all source and test dependency artifacts first; no T04 vector is read by build.
"$forge" build
# This one test only exports deterministic deployment addresses, not hand-written permits.
"$forge" test --match-test testExportDeployment -vv
cd "$repo_dir/backend"
npm run build
# TEST_DATABASE_URL is injected by with-web3-test-db. Real services generate the permit vectors.
node ../contracts/scripts/export-t04-vectors.mjs
