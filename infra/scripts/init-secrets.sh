#!/usr/bin/env bash
set -euo pipefail
# Relative to this script, independent of the caller's working directory.
infra_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v openssl >/dev/null
umask 077
mkdir -p "$infra_dir/.secrets"
for secret in postgres_password postgres_test_password; do
  target="$infra_dir/.secrets/$secret"
  if [[ -e "$target" ]]; then
    [[ -s "$target" ]] || { echo "Empty secret: $target" >&2; exit 1; }
    continue
  fi
  # noclobber protects existing credentials, including concurrent invocations.
  (set -o noclobber; openssl rand -hex 32 > "$target")
done
echo 'Secret files ready; existing passwords preserved.'
