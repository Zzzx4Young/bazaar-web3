-- Owner-only installation in the independent ledger schema, in a transaction.
-- Never include these tables in the authoritative witness fingerprint.
-- Runtime role: SELECT, INSERT only. No UPDATE, DELETE, TRUNCATE or schema CREATE.
CREATE TABLE "LedgerPublicationOutbox" (
  "environmentId" text NOT NULL CHECK (length("environmentId") BETWEEN 1 AND 200),
  "namespace" text NOT NULL CHECK ("namespace" IN ('wallet','private-files')),
  "ledgerId" uuid NOT NULL,
  "sequence" bigint NOT NULL CHECK ("sequence" BETWEEN 0 AND 9007199254740991),
  "digest" text NOT NULL CHECK ("digest" ~ '^[0-9a-f]{64}$'),
  "payload" jsonb NOT NULL CHECK (jsonb_typeof("payload")='object' AND octet_length("payload"::text)<=33554432),
  PRIMARY KEY ("environmentId","namespace","ledgerId","sequence")
);
CREATE TABLE "LedgerPublicationReceipt" (
  "environmentId" text NOT NULL,
  "namespace" text NOT NULL,
  "ledgerId" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "receiptHash" text NOT NULL CHECK ("receiptHash" ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY ("environmentId","namespace","ledgerId","sequence"),
  FOREIGN KEY ("environmentId","namespace","ledgerId","sequence") REFERENCES "LedgerPublicationOutbox" ("environmentId","namespace","ledgerId","sequence")
);
REVOKE ALL ON "LedgerPublicationOutbox", "LedgerPublicationReceipt" FROM PUBLIC;
