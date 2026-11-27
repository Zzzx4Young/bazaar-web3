-- Preserve existing providers; wallet sessions additionally require the context
-- constraint introduced by the wallet foundation migration.
ALTER TABLE "Session" DROP CONSTRAINT "Session_authMethod_check";
ALTER TABLE "Session" ADD CONSTRAINT "Session_authMethod_check"
  CHECK ("authMethod" IS NULL OR "authMethod" IN
    ('password', 'email_code', 'email_code_dev', 'google_oidc', 'wallet_siwe'));
