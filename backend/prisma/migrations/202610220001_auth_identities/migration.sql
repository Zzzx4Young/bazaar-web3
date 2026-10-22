CREATE TABLE "AccountIdentity" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "provider" VARCHAR(16) NOT NULL,
  "subject" VARCHAR(100) NOT NULL,
  "email" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountIdentity_provider_subject_key" ON "AccountIdentity"("provider", "subject");
CREATE UNIQUE INDEX "AccountIdentity_accountId_provider_key" ON "AccountIdentity"("accountId", "provider");
ALTER TABLE "AccountIdentity" ADD CONSTRAINT "AccountIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "EmailCodeChallenge" (
  "key" CHAR(64) NOT NULL,
  "id" UUID NOT NULL,
  "email" VARCHAR(100) NOT NULL,
  "purpose" VARCHAR(16) NOT NULL,
  "accountId" UUID,
  "codeHash" CHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  CONSTRAINT "EmailCodeChallenge_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "EmailCodeChallenge_expiresAt_idx" ON "EmailCodeChallenge"("expiresAt");

CREATE TABLE "GoogleOAuthAttempt" (
  "stateHash" CHAR(64) NOT NULL,
  "cookieHash" CHAR(64) NOT NULL,
  "verifier" VARCHAR(128) NOT NULL,
  "nonce" VARCHAR(128) NOT NULL,
  "returnTo" VARCHAR(255) NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "accountId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  CONSTRAINT "GoogleOAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "GoogleOAuthAttempt_expiresAt_idx" ON "GoogleOAuthAttempt"("expiresAt");
ALTER TABLE "GoogleOAuthAttempt" ADD CONSTRAINT "GoogleOAuthAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
