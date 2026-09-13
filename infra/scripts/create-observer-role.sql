-- Run once with psql as the database administrator, after create-app-roles.sql.
-- Existing roles/schema cause failure; this script never takes over existing objects.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE bazaar_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE bazaar_observer SET default_transaction_read_only = on;
ALTER ROLE bazaar_observer SET statement_timeout = '3s';
ALTER ROLE bazaar_observer SET idle_in_transaction_session_timeout = '3s';
ALTER ROLE bazaar_observer SET search_path = bazaar_observe, pg_catalog;
CREATE SCHEMA bazaar_observe AUTHORIZATION bazaar_migrate;
REVOKE ALL ON SCHEMA bazaar_observe FROM PUBLIC;
COMMIT;
-- Interactive prompting keeps the password out of files, arguments and SQL history.
\password bazaar_observer
