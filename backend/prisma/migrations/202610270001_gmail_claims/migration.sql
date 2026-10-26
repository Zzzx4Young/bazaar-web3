BEGIN;

CREATE TABLE "GmailClaim" (
  "key" VARCHAR(100) NOT NULL,
  "accountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GmailClaim_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "GmailClaim_accountId_idx" ON "GmailClaim"("accountId");
ALTER TABLE "GmailClaim" ADD CONSTRAINT "GmailClaim_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill Gmail names and verified email identities. A collision between different
-- accounts fails the unique key and stops the migration without transferring ownership.
INSERT INTO "GmailClaim" ("key", "accountId")
SELECT DISTINCT key, "accountId" FROM (
  SELECT replace(split_part(split_part(lower("loginName"), '@', 1), '+', 1), '.', '') || '@gmail.com' AS key,
    "id" AS "accountId"
  FROM "Account" WHERE split_part(lower("loginName"), '@', 2) = 'gmail.com'
    AND split_part("loginName", '@', 3) = ''
  UNION
  SELECT replace(split_part(split_part(lower("subject"), '@', 1), '+', 1), '.', '') || '@gmail.com' AS key,
    "accountId"
  FROM "AccountIdentity" WHERE "provider" = 'email'
    AND split_part(lower("subject"), '@', 2) = 'gmail.com'
    AND split_part("subject", '@', 3) = ''
) AS claims;

COMMIT;
