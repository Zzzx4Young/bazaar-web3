#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
chmod 0700 "$PGDATA"
replication_password="$(cat /run/secrets/ha_replication_password)"
printf 'primary:5432:replication:bazaar_ha_replica:%s\n' "$replication_password" > /tmp/ha-replication.pgpass
unset replication_password
chown postgres:postgres /tmp/ha-replication.pgpass
chmod 0600 /tmp/ha-replication.pgpass
export PGPASSFILE=/tmp/ha-replication.pgpass
if [[ ! -f "$PGDATA/.ha-basebackup-complete" ]]; then
  if [[ -f "$PGDATA/PG_VERSION" ]]; then
    echo 'Refusing to start an incomplete standby base backup' >&2
    exit 1
  fi
  gosu postgres pg_basebackup \
    --dbname="host=primary port=5432 user=bazaar_ha_replica application_name=bazaar_ha_standby passfile=/tmp/ha-replication.pgpass" \
    --pgdata="$PGDATA" --write-recovery-conf --wal-method=stream \
    --create-slot --slot=bazaar_ha_slot --no-password
  touch "$PGDATA/.ha-basebackup-complete"
  chown postgres:postgres "$PGDATA/.ha-basebackup-complete"
fi
exec gosu postgres postgres -D "$PGDATA"
