#!/usr/bin/env bash
set -euo pipefail

# Shut down only the containers used by the host development app.
# Compose stop preserves their containers and named PostgreSQL/Garage volumes.
# Do not include postgres-test: its database lives on tmpfs and stopping it loses data.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    docker_cmd=(sudo -n docker)
  else
    echo 'Docker is unavailable; development containers were not stopped.' >&2
    exit 1
  fi
fi

# Garage belongs to the bazaar-alpha Compose project. Leave it running when
# that project's containerized application is using it.
alpha_users="$("${docker_cmd[@]}" compose -f infra/compose.alpha.yaml ps --status running --services api frontend archive-worker)"
if [[ -n "$alpha_users" ]]; then
  echo "Containerized Alpha services are running ($alpha_users); Garage and PostgreSQL were not stopped." >&2
  exit 1
fi

# Stop host processes only after confirming that container shutdown can proceed.
./stop.sh

"${docker_cmd[@]}" compose -f infra/compose.alpha.yaml stop garage-hot garage-cold
"${docker_cmd[@]}" compose -f infra/compose.yaml stop postgres
echo 'Development PostgreSQL and Garage containers stopped; named volumes, secrets, and postgres-test were preserved.'
