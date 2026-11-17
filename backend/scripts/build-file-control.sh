#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
expected=sha256:1cca08651d855df02dca36b7a6347da847c41be4ecae2b01ff2733adb4316498
actual=$(sudo -n docker image inspect bazaar-web3-private-check:t10 --format '{{.Id}}')
[[ "$actual" == "$expected" ]] || { echo 'Cached base digest mismatch' >&2; exit 1; }
# Legacy builder resolves locally cached FROM without BuildKit registry metadata.
# --pull=false is Docker build's equivalent of docker run --pull=never.
sudo -n env DOCKER_BUILDKIT=0 docker build --pull=false --network=none \
  -t bazaar-web3-private-check-control:r06-20261117 file-checker/control >&2
sudo -n docker image inspect bazaar-web3-private-check-control:r06-20261117 --format '{{.Id}}'
