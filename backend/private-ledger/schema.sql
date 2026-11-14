-- Separate protected schema/database, never part of a business pg_dump.
CREATE TABLE "PrivateLedgerMeta" (
  "singleton" boolean PRIMARY KEY DEFAULT true CHECK ("singleton"),
  "ledgerId" uuid NOT NULL UNIQUE,
  "maintenance" boolean NOT NULL DEFAULT false
);
CREATE TABLE "PrivateLedgerEvent" (
  "sequence" bigint PRIMARY KEY CHECK ("sequence">0),
  "id" uuid NOT NULL UNIQUE,
  "kind" text NOT NULL CHECK ("kind" IN ('delivery','publication','evidence','terminal','review','claim','deleted','backup_prepared','backup','backup_deleted','restore')),
  "key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL,
  UNIQUE ("kind","key")
);
