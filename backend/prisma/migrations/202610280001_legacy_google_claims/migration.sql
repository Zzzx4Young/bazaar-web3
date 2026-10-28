DO $$
BEGIN
  -- Keep writes out of the backfill window. A conflicting owner must stop
  -- deployment instead of silently transferring ownership.
  LOCK TABLE "AccountIdentity", "GmailClaim" IN SHARE ROW EXCLUSIVE MODE;
  CREATE TEMP TABLE legacy_google_claims ON COMMIT DROP AS
  SELECT DISTINCT
    replace(split_part(split_part(lower(trim("email")), '@', 1), '+', 1), '.', '') || '@gmail.com' AS key,
    "accountId"
  FROM "AccountIdentity"
  WHERE "provider" = 'google'
    AND split_part(lower(trim("email")), '@', 2) = 'gmail.com'
    AND split_part(trim("email"), '@', 3) = '';

  IF EXISTS (
    SELECT 1 FROM legacy_google_claims
    GROUP BY key HAVING count(DISTINCT "accountId") > 1
  ) OR EXISTS (
    SELECT 1 FROM legacy_google_claims g JOIN "GmailClaim" c ON c.key = g.key
    WHERE c."accountId" <> g."accountId"
  ) THEN
    RAISE EXCEPTION 'Conflicting historical Google Gmail ownership';
  END IF;
  INSERT INTO "GmailClaim" ("key", "accountId")
  SELECT g.key, g."accountId" FROM legacy_google_claims g
  WHERE NOT EXISTS (SELECT 1 FROM "GmailClaim" c WHERE c.key = g.key);

  -- A development-only address rewrite is an administrative migration,
  -- not proof that the new recipient controls the mailbox.
  ALTER TABLE "AccountIdentityEvent" DROP CONSTRAINT "AccountIdentityEvent_action_check";
  ALTER TABLE "AccountIdentityEvent" ADD CONSTRAINT "AccountIdentityEvent_action_check"
    CHECK ("action" IN ('register', 'bind', 'replace', 'reverify', 'migration'));
  ALTER TABLE "AccountIdentityEvent" DROP CONSTRAINT "AccountIdentityEvent_source_check";
  ALTER TABLE "AccountIdentityEvent" ADD CONSTRAINT "AccountIdentityEvent_source_check"
    CHECK ("verificationSource" IN ('email_delivery', 'dev_inbox', 'google_oidc', 'unknown'));
END $$;
