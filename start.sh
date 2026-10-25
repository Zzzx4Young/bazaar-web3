#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"
state_file="$repo_root/.tmp/bazaar-start.pid"
state_lock="$state_file.lock"
ready_file="$repo_root/.tmp/bazaar-start.ready"
log_file="$repo_root/.tmp/start.log"
mode="${1:-}"
if [[ $# -gt 1 || ( -n "$mode" && "$mode" != '--foreground' ) ]]; then
  echo 'Usage: ./start.sh' >&2
  exit 2
fi

probe() {
  curl -s -o /dev/null --connect-timeout 1 --max-time 3 "$1"
}

backend_up=false
frontend_up=false
probe http://127.0.0.1:3001/api/health/live && backend_up=true
probe http://localhost:3000/zh-CN && frontend_up=true
if "$backend_up" && "$frontend_up"; then
  if curl -fs -o /dev/null --connect-timeout 1 --max-time 3 \
    -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' \
    -d '{}' http://127.0.0.1:3001/api/health/ready && \
    curl -fs -o /dev/null --connect-timeout 1 --max-time 3 http://localhost:3000/zh-CN/explore; then
    echo 'Bazaar is already running at http://localhost:3000/zh-CN'
    exit 0
  fi
fi
if "$backend_up" || "$frontend_up"; then
  echo 'Port 3000 or 3001 is already in use. Run ./stop.sh for a Bazaar instance started here, or inspect the port owner.' >&2
  exit 1
fi

for command in node npm curl docker flock setsid; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) process.exit(1)' || {
  echo 'Node.js 22.12 or newer is required.' >&2
  exit 1
}
for path in backend/.env backend/.tmp/i7-migrate.env backend/node_modules frontend/node_modules; do
  [[ -e "$path" ]] || { echo "Missing $path; follow the backend and frontend README setup first." >&2; exit 1; }
done

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    docker_cmd=(sudo -n docker)
  else
    echo 'Docker is unavailable. Start Docker or configure noninteractive sudo for it.' >&2
    exit 1
  fi
fi

if [[ "$mode" != '--foreground' ]]; then
  mkdir -p "$repo_root/.tmp"
  umask 077
  exec 9>"$repo_root/.tmp/bazaar-start.launch.lock"
  flock -n 9 || { echo 'Bazaar startup is already in progress.' >&2; exit 1; }
  rm -f "$ready_file"
  : > "$log_file"
  chmod 600 "$log_file"
  # The launcher owns the service processes; setsid isolates it from terminal signals.
  setsid bash "$repo_root/start.sh" --foreground 9>&- </dev/null >"$log_file" 2>&1 &
  launcher_pid=$!
  trap 'kill -TERM "$launcher_pid" 2>/dev/null || true; wait "$launcher_pid" 2>/dev/null || true; exit 130' INT
  trap 'kill -TERM "$launcher_pid" 2>/dev/null || true; wait "$launcher_pid" 2>/dev/null || true; exit 143' TERM
  echo 'Starting Bazaar services...'
  # Build, Garage bootstrap, and migrations have no fixed duration.
  while :; do
    if [[ -f "$ready_file" ]] && read -r ready_pid ready_start < "$ready_file" &&
      [[ "$ready_pid" == "$launcher_pid" ]] &&
      [[ "$(awk '{print $22}' "/proc/$launcher_pid/stat" 2>/dev/null || true)" == "$ready_start" ]]; then
      trap - INT TERM
      echo 'Bazaar ready: http://localhost:3000/zh-CN/explore'
      echo "Logs: $log_file"
      echo 'Stop applications with ./stop.sh; stop containers with ./down.sh.'
      exit 0
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null ||
      [[ "$(awk '{print $3}' "/proc/$launcher_pid/stat" 2>/dev/null || true)" == 'Z' ]]; then
      wait "$launcher_pid" || true
      echo "Bazaar startup failed. Inspect $log_file" >&2
      exit 1
    fi
    sleep 1
  done
fi

backend_pid=''
frontend_pid=''
archive_pid=''
startup_pid=''
start_ticks=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$startup_pid" ]] || kill "$startup_pid" 2>/dev/null || true
  [[ -z "$startup_pid" ]] || wait "$startup_pid" 2>/dev/null || true
  [[ -z "$frontend_pid" ]] || kill "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
  [[ -z "$archive_pid" ]] || kill "$archive_pid" 2>/dev/null || true
  [[ -z "$frontend_pid" ]] || wait "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || wait "$backend_pid" 2>/dev/null || true
  [[ -z "$archive_pid" ]] || wait "$archive_pid" 2>/dev/null || true
  (
    flock -x 9
    if [[ -f "$state_file" ]] && read -r recorded_pid recorded_start < "$state_file" &&
      [[ "$recorded_pid" == "$$" && "$recorded_start" == "$start_ticks" ]]; then
      rm -f "$state_file"
    fi
    if [[ -f "$ready_file" ]] && read -r recorded_pid recorded_start < "$ready_file" &&
      [[ "$recorded_pid" == "$$" && "$recorded_start" == "$start_ticks" ]]; then
      rm -f "$ready_file"
    fi
  ) 9>"$state_lock"
  echo 'Application services stopped; PostgreSQL and Garage remain running.'
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$repo_root/.tmp"
start_ticks="$(awk '{print $22}' "/proc/$$/stat")"
(
  flock -x 9
  printf '%s %s\n' "$$" "$start_ticks" > "$state_file"
) 9>"$state_lock"

# Waiting on a child lets TERM interrupt bootstrap; cleanup then stops that step.
run_startup_step() {
  "$@" &
  startup_pid=$!
  local status=0
  wait "$startup_pid" || status=$?
  startup_pid=''
  return "$status"
}
deploy_migrations() (
  cd backend
  exec env -u DATABASE_URL -u DATABASE_URL_FILE DATABASE_RUNTIME_ROLE=bazaar_runtime \
    node --env-file-if-exists=.tmp/i7-migrate.env scripts/deploy-migrations.mjs
)

run_startup_step bash infra/scripts/init-secrets.sh
run_startup_step node backend/scripts/init-dev-email.mjs
run_startup_step "${docker_cmd[@]}" compose -f infra/compose.yaml up -d --wait postgres
run_startup_step npm --prefix backend run build
run_startup_step node infra/scripts/bootstrap-garage.mjs
run_startup_step deploy_migrations

media_env=(
  GARAGE_HOT_ENDPOINT=http://127.0.0.1:3900
  GARAGE_HOT_PUBLIC_ENDPOINT=http://localhost:3900
  GARAGE_COLD_ENDPOINT=http://127.0.0.1:3903
  GARAGE_HOT_ACCESS_KEY_ID_FILE="$repo_root/infra/.secrets/garage-app/hot_access_key_id"
  GARAGE_HOT_SECRET_KEY_FILE="$repo_root/infra/.secrets/garage-app/hot_secret_key"
  GARAGE_COLD_ACCESS_KEY_ID_FILE="$repo_root/infra/.secrets/garage-app/cold_access_key_id"
  GARAGE_COLD_SECRET_KEY_FILE="$repo_root/infra/.secrets/garage-app/cold_secret_key"
)
dev_email_env=(
  NODE_ENV=development
  EMAIL_CODE_HMAC_KEY_FILE="$repo_root/backend/.tmp/dev-email-key"
  EMAIL_CODE_DEV_ACCOUNT_FILE="$repo_root/backend/.tmp/dev-email-account"
  EMAIL_CODE_DEV_INBOX_FILE="$repo_root/backend/.tmp/dev-email-inbox"
)
proxy_env=()
if [[ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}" ]]; then
  proxy_env=(NODE_USE_ENV_PROXY=1)
fi

(
  cd backend
  exec env -u DATABASE_URL -u DATABASE_URL_FILE "${proxy_env[@]}" "${media_env[@]}" "${dev_email_env[@]}" \
    node --env-file-if-exists=.env dist/main.js
) &
backend_pid=$!

(
  cd backend
  exec env -u DATABASE_URL -u DATABASE_URL_FILE "${media_env[@]}" \
    node --env-file-if-exists=.env scripts/archive-order-media.mjs --loop
) &
archive_pid=$!

ready() {
  curl -fs -o /dev/null --connect-timeout 1 --max-time 3 \
    -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' \
    -d '{}' http://127.0.0.1:3001/api/health/ready
}
for ((attempt = 0; attempt < 60; attempt++)); do
  if ready; then break; fi
  kill -0 "$backend_pid" 2>/dev/null || { echo 'Backend exited during startup.' >&2; exit 1; }
  kill -0 "$archive_pid" 2>/dev/null || { echo 'Archive worker exited during startup.' >&2; exit 1; }
  sleep 1
done
ready || { echo 'Backend did not become ready within 60 seconds.' >&2; exit 1; }

(
  cd frontend
  # Keep the dev compiler separate from npm run build, which writes .next.
  exec env BACKEND_ORIGIN=http://127.0.0.1:3001 NEXT_PUBLIC_EMAIL_CODE_DEV_INBOX=1 \
    NEXT_DIST_DIR=.next-dev \
    ./node_modules/.bin/next dev
) &
frontend_pid=$!

page_ready() {
  curl -fs -o /dev/null --connect-timeout 1 --max-time 5 http://localhost:3000/zh-CN/explore
}
for ((attempt = 0; attempt < 60; attempt++)); do
  if page_ready; then break; fi
  kill -0 "$frontend_pid" 2>/dev/null || { echo 'Frontend exited during startup.' >&2; exit 1; }
  sleep 1
done
page_ready || { echo 'Frontend did not become ready within 60 seconds.' >&2; exit 1; }
kill -0 "$archive_pid" 2>/dev/null || { echo 'Archive worker exited during startup.' >&2; exit 1; }
curl -fsS -o /dev/null --connect-timeout 1 --max-time 10 \
  -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' \
  -d '{"sort":"newest","limit":"10","page":"1"}' \
  http://localhost:3000/api/listings/search || {
    echo 'Frontend is reachable, but its listing API check failed.' >&2
    exit 1
  }

echo 'Bazaar ready: http://localhost:3000/zh-CN/explore'
(
  flock -x 9
  printf '%s %s\n' "$$" "$start_ticks" > "$ready_file"
) 9>"$state_lock"
wait -n "$backend_pid" "$frontend_pid" "$archive_pid"
