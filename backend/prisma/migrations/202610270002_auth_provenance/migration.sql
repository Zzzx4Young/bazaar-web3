BEGIN;

ALTER TABLE "AccountIdentity"
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN "verificationSource" VARCHAR(24);
ALTER TABLE "AccountIdentity" ADD CONSTRAINT "AccountIdentity_verificationSource_check"
  CHECK ("verificationSource" IS NULL OR
    "verificationSource" IN ('email_delivery', 'dev_inbox', 'google_oidc'));
ALTER TABLE "Session"
  ADD COLUMN "authMethod" VARCHAR(24),
  ADD COLUMN "authenticatedAt" TIMESTAMPTZ(6);
ALTER TABLE "Session" ADD CONSTRAINT "Session_authMethod_check"
  CHECK ("authMethod" IS NULL OR
    "authMethod" IN ('password', 'email_code', 'email_code_dev', 'google_oidc'));

-- Existing identities and sessions retain NULL provenance. Backfilling a proof
-- timestamp would falsely imply that a historical mailbox or provider was checked.
CREATE TABLE "AccountIdentityEvent" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "provider" VARCHAR(16) NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "previousSubject" VARCHAR(100),
  "currentSubject" VARCHAR(100) NOT NULL,
  "previousEmail" VARCHAR(100),
  "currentEmail" VARCHAR(100) NOT NULL,
  "verificationSource" VARCHAR(24) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountIdentityEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountIdentityEvent_provider_check" CHECK ("provider" IN ('email', 'google')),
  CONSTRAINT "AccountIdentityEvent_action_check" CHECK ("action" IN ('register', 'bind', 'replace', 'reverify')),
  CONSTRAINT "AccountIdentityEvent_source_check" CHECK ("verificationSource" IN ('email_delivery', 'dev_inbox', 'google_oidc'))
);
CREATE INDEX "AccountIdentityEvent_accountId_createdAt_idx"
  ON "AccountIdentityEvent"("accountId", "createdAt");
ALTER TABLE "AccountIdentityEvent" ADD CONSTRAINT "AccountIdentityEvent_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
