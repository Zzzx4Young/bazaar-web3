#!/usr/bin/env bash
set -euo pipefail
# Loopback host ports and a per-run private Compose network bound this test rule.
printf '\nhost replication bazaar_ha_replica all scram-sha-256\n' >> "$PGDATA/pg_hba.conf"
