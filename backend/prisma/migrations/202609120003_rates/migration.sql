BEGIN;
CREATE TABLE "RateSnapshot" (
  "id" UUID NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "rates" JSONB NOT NULL,
  "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "rate_snapshot_valid" CHECK ("expiresAt" > "fetchedAt" AND jsonb_typeof("rates") = 'object')
);
CREATE INDEX "RateSnapshot_expiresAt_idx" ON "RateSnapshot"("expiresAt");
CREATE TRIGGER rate_snapshot_immutable BEFORE UPDATE OR DELETE ON "RateSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
COMMIT;
