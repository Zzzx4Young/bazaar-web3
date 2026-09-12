-- Run once with psql as the database administrator, in the intended application database.
-- Existing roles/schema cause failure; this script never takes over existing objects.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE bazaar_migrate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE bazaar_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA bazaar AUTHORIZATION bazaar_migrate;
REVOKE ALL ON SCHEMA bazaar FROM PUBLIC;
COMMIT;
-- Interactive password prompts avoid putting plaintext credentials in files or SQL history.
\password bazaar_migrate
\password bazaar_runtime
