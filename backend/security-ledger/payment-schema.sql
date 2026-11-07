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
