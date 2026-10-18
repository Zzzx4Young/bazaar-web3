#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

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
  echo 'Port 3000 or 3001 is already in use. Stop the existing service before starting Bazaar.' >&2
  exit 1
fi

for command in node npm curl docker; do
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

bash infra/scripts/init-secrets.sh
"${docker_cmd[@]}" compose -f infra/compose.yaml up -d --wait postgres
npm --prefix backend run build
node infra/scripts/bootstrap-garage.mjs
(
  cd backend
  env -u DATABASE_URL -u DATABASE_URL_FILE DATABASE_RUNTIME_ROLE=bazaar_runtime \
    node --env-file-if-exists=.tmp/i7-migrate.env scripts/deploy-migrations.mjs
)

backend_pid=''
frontend_pid=''
archive_pid=''
media_env=(
  GARAGE_HOT_ENDPOINT=http://127.0.0.1:3900
  GARAGE_HOT_PUBLIC_ENDPOINT=http://localhost:3900
  GARAGE_COLD_ENDPOINT=http://127.0.0.1:3903
  GARAGE_HOT_ACCESS_KEY_ID_FILE="$repo_root/infra/.secrets/garage-app/hot_access_key_id"
  GARAGE_HOT_SECRET_KEY_FILE="$repo_root/infra/.secrets/garage-app/hot_secret_key"
  GARAGE_COLD_ACCESS_KEY_ID_FILE="$repo_root/infra/.secrets/garage-app/cold_access_key_id"
  GARAGE_COLD_SECRET_KEY_FILE="$repo_root/infra/.secrets/garage-app/cold_secret_key"
)
proxy_env=()
if [[ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}" ]]; then
  proxy_env=(NODE_USE_ENV_PROXY=1)
fi
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$frontend_pid" ]] || kill "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
  [[ -z "$archive_pid" ]] || kill "$archive_pid" 2>/dev/null || true
  [[ -z "$frontend_pid" ]] || wait "$frontend_pid" 2>/dev/null || true
  [[ -z "$backend_pid" ]] || wait "$backend_pid" 2>/dev/null || true
  [[ -z "$archive_pid" ]] || wait "$archive_pid" 2>/dev/null || true
  echo 'Application services stopped; PostgreSQL and Garage remain running.'
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd backend
  exec env -u DATABASE_URL -u DATABASE_URL_FILE "${proxy_env[@]}" "${media_env[@]}" \
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
  exec env BACKEND_ORIGIN=http://127.0.0.1:3001 ./node_modules/.bin/next dev
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
echo 'Press Ctrl+C to stop the frontend, backend and archive worker. PostgreSQL and Garage will remain running.'
wait -n "$backend_pid" "$frontend_pid" "$archive_pid"
