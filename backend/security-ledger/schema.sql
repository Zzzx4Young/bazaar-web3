-- Provision separately from business migrations and business restore.
CREATE TABLE "WalletLedgerMeta" (
  "singleton" boolean PRIMARY KEY DEFAULT true CHECK ("singleton"),
  "ledgerId" uuid NOT NULL UNIQUE,
  "recoveryEpoch" uuid NOT NULL,
  "maintenance" boolean NOT NULL DEFAULT false
);
CREATE TABLE "WalletLedgerAccount" (
  "accountId" uuid NOT NULL,
  "chainId" integer NOT NULL CHECK ("chainId" IN (11155111, 31337)),
  "address" varchar(42),
  "bindingVersion" integer NOT NULL DEFAULT 0 CHECK ("bindingVersion" >= 0),
  "revision" bigint NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "payout" jsonb,
  "pendingOperationId" uuid,
  PRIMARY KEY ("accountId", "chainId")
);
CREATE TABLE "WalletLedgerClaim" (
  "chainId" integer NOT NULL,
  "address" varchar(42) NOT NULL CHECK ("address" ~ '^0x[0-9a-f]{40}$'),
  "accountId" uuid NOT NULL,
  "operationId" uuid NOT NULL,
  PRIMARY KEY ("chainId", "address")
);
CREATE TABLE "WalletLedgerReservation" (
  "chainId" integer NOT NULL,
  "address" varchar(42) NOT NULL,
  "accountId" uuid NOT NULL,
  "operationId" uuid NOT NULL UNIQUE,
  PRIMARY KEY ("chainId", "address")
);
CREATE TABLE "WalletLedgerOperation" (
  "id" uuid PRIMARY KEY,
  "accountId" uuid NOT NULL,
  "chainId" integer NOT NULL,
  "change" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('prepared', 'committed', 'aborted')),
  "result" jsonb
);
CREATE TABLE "WalletLedgerEvent" (
  "operationId" uuid NOT NULL,
  "phase" text NOT NULL CHECK ("phase" IN ('prepared', 'committed', 'aborted')),
  "payload" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY ("operationId", "phase")
);
-- Independent issuance history: never restore from a business backup.
CREATE TABLE "PaymentLedgerIntent" (
  "id" uuid PRIMARY KEY,
  "orderId" uuid NOT NULL,
  "listingId" uuid NOT NULL,
  "stockId" char(66) NOT NULL,
  "scope" text NOT NULL,
  "digest" char(66) NOT NULL,
  "termsHash" char(66) NOT NULL,
  "recoveryEpoch" uuid NOT NULL,
  "permit" jsonb NOT NULL,
  "previousIntentId" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE "PaymentLedgerHead" (
  "scope" text NOT NULL,
  "listingId" uuid NOT NULL,
  "stockId" char(66) NOT NULL,
  "intentId" uuid NOT NULL REFERENCES "PaymentLedgerIntent"("id"),
  PRIMARY KEY ("scope", "listingId"),
  UNIQUE ("scope", "stockId")
);
CREATE TABLE "PaymentLedgerResolution" (
  "intentId" uuid PRIMARY KEY REFERENCES "PaymentLedgerIntent"("id"),
  "outcome" text NOT NULL CHECK ("outcome" IN ('invalid', 'funded')),
  "evidence" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT statement_timestamp()
);
