#!/usr/bin/env bash
set -euo pipefail

if [[ -s /run/config/migration_database_url && -s /run/config/runtime_database_url ]]; then
  chown 1000:1000 /run/config/migration_database_url /run/config/runtime_database_url
  chmod 0400 /run/config/migration_database_url /run/config/runtime_database_url
  exit 0
fi

admin_password=$(cat /run/secrets/postgres_password)
migrate_password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
runtime_password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')

export PGPASSWORD="$admin_password"
psql --host postgres --username bazaar_admin --dbname bazaar_dev --set ON_ERROR_STOP=on \
  -v migrate_password="$migrate_password" -v runtime_password="$runtime_password" <<'SQL'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazaar_migrate') THEN
    CREATE ROLE bazaar_migrate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazaar_runtime') THEN
    CREATE ROLE bazaar_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$do$;
ALTER ROLE bazaar_migrate PASSWORD :'migrate_password';
ALTER ROLE bazaar_runtime PASSWORD :'runtime_password';
CREATE SCHEMA IF NOT EXISTS bazaar AUTHORIZATION bazaar_migrate;
REVOKE ALL ON SCHEMA bazaar FROM PUBLIC;
SQL

umask 077
cat > /run/config/migration_database_url <<EOF
postgresql://bazaar_migrate:${migrate_password}@postgres:5432/bazaar_dev?schema=bazaar
EOF
cat > /run/config/runtime_database_url <<EOF
postgresql://bazaar_runtime:${runtime_password}@postgres:5432/bazaar_dev?schema=bazaar
EOF

# Backend containers run as the image's unprivileged `node` user (UID 1000).
# Keep each generated connection URL private while allowing that user to read it.
chown 1000:1000 /run/config/migration_database_url /run/config/runtime_database_url
chmod 0400 /run/config/migration_database_url /run/config/runtime_database_url
