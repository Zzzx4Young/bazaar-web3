#!/usr/bin/env bash
set -euo pipefail

# Stop only the host application started by this repository's start.sh.
# start.sh owns the API, frontend, and archive worker; its EXIT trap cleans them up.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
state_file="$repo_root/.tmp/bazaar-start.pid"
state_lock="$state_file.lock"

# A missing record means there is no managed process to signal. Docker is untouched.
if [[ ! -f "$state_file" ]]; then
  echo 'No Bazaar application instance started by ./start.sh is recorded.'
  exit 0
fi

# Coordinate with start.sh so stale cleanup cannot remove a newer launcher record.
exec 9>"$state_lock"
flock -x 9
if [[ ! -f "$state_file" ]]; then
  echo 'No Bazaar application instance started by ./start.sh is recorded.'
  exit 0
fi

# The record contains the launcher PID and Linux process start time (clock ticks).
# Validate both so a stale PID cannot signal a different process after PID reuse.
read -r owner_pid owner_start < "$state_file" || {
  echo 'Bazaar process record is unreadable; no process was stopped.' >&2
  exit 1
}
if [[ ! "$owner_pid" =~ ^[0-9]+$ || ! "$owner_start" =~ ^[0-9]+$ ]]; then
  echo 'Bazaar process record is invalid; no process was stopped.' >&2
  exit 1
fi

process_start() {
  awk '{print $22}' "/proc/$owner_pid/stat" 2>/dev/null || true
}

process_state() {
  awk '{print $3}' "/proc/$owner_pid/stat" 2>/dev/null || true
}

# A zombie can retain its PID and start time after the launcher has cleaned up.
# Only treat it as stopped once its own record is gone (or belongs to a new run).
launcher_record_cleared() (
  flock -x 9
  [[ ! -f "$state_file" ]] && exit 0
  read -r recorded_pid recorded_start < "$state_file" || exit 1
  [[ "$recorded_pid" != "$owner_pid" || "$recorded_start" != "$owner_start" ]]
) 9>"$state_lock"

if [[ "$(process_start)" != "$owner_start" ]]; then
  rm -f "$state_file"
  echo 'Removed stale Bazaar process record; no application process needed stopping.'
  exit 0
fi

# PID and start time alone cannot prove the process is this repository's launcher.
launcher_cwd="$(readlink "/proc/$owner_pid/cwd" 2>/dev/null || true)"
launcher_args=()
if [[ -r "/proc/$owner_pid/cmdline" ]]; then
  mapfile -d '' -t launcher_args < "/proc/$owner_pid/cmdline" || true
fi
launcher_command="${launcher_args[0]:-}"
launcher_script="${launcher_args[1]:-}"
if [[ "$launcher_cwd" != "$repo_root" || "${launcher_command##*/}" != 'bash' ||
  "${launcher_script##*/}" != 'start.sh' ]]; then
  rm -f "$state_file"
  echo 'Removed stale Bazaar process record; PID belongs to another process.'
  exit 0
fi

# Signal the launcher, not its individual children: start.sh performs ordered cleanup.
kill -TERM "$owner_pid"
flock -u 9
exec 9>&-
# Wait up to 10 seconds for that exact launcher process to exit.
for ((attempt = 0; attempt < 50; attempt++)); do
  if [[ "$(process_start)" != "$owner_start" ]] ||
    { [[ "$(process_state)" == 'Z' ]] && launcher_record_cleared; }; then
    echo 'Bazaar application processes stopped; PostgreSQL and Garage remain running.'
    exit 0
  fi
  sleep 0.2
done

echo 'Timed out waiting for Bazaar to stop; inspect the application processes.' >&2
exit 1
