CREATE TABLE "PrivateFileDisposition" (
 "versionId" uuid PRIMARY KEY REFERENCES "PrivateFileVersion"("id") ON DELETE RESTRICT,
 "claimId" uuid NOT NULL UNIQUE,
 "state" text NOT NULL CHECK ("state" IN ('claimed','deleted')),
 "deadline" timestamptz NOT NULL,
 "updatedAt" timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE "PrivateRecoveryState" (
 "singleton" boolean PRIMARY KEY DEFAULT true CHECK ("singleton"),
 "runId" uuid NOT NULL,
 "backupId" uuid NOT NULL,
 "downloadEpoch" uuid NOT NULL,
 "status" text NOT NULL DEFAULT 'isolated' CHECK ("status" IN ('isolated','verified','active')),
 "checks" jsonb NOT NULL DEFAULT '{}',
 "updatedAt" timestamptz NOT NULL DEFAULT statement_timestamp()
);
