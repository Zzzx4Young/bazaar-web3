BEGIN;
CREATE TABLE "AccountCredential" (
  "accountId" UUID NOT NULL PRIMARY KEY,
  "passwordHash" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AccountCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "Session" (
  "tokenHash" CHAR(64) NOT NULL PRIMARY KEY,
  "accountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "session_hash_valid" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "session_time_valid" CHECK ("expiresAt" > "createdAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"))
);
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
COMMIT;
