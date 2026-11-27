#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evidence=${1:?Usage: bash scripts/run-file-capacity.sh ABSOLUTE_EVIDENCE_DIR}
[[ "$evidence" = /* && "$evidence" != *,* ]] || exit 1
image=${PRIVATE_FILE_CHECK_IMAGE:-sha256:1cca08651d855df02dca36b7a6347da847c41be4ecae2b01ff2733adb4316498}
sudo -n docker image inspect "$image" >/dev/null
mkdir -p "$evidence/samples"
sudo -n docker run --pull=never --rm --network=none --read-only \
  --memory=512000000 --cpus=1 --pids-limit=32 --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD/file-checker/control/generate-capacity.py,target=/generate.py,readonly" \
  --mount "type=bind,source=$evidence/samples,target=/samples" \
  --entrypoint python3 "$image" /generate.py /samples > "$evidence/generate.log" 2>&1
PRIVATE_FILE_CHECK_IMAGE=$image PRIVATE_FILE_CAPACITY_SAMPLES="$evidence/samples" \
  node --test --test-concurrency=1 tests/file-check-capacity.integration.mjs
