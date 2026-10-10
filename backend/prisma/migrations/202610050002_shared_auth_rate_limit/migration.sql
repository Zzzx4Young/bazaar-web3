BEGIN;
CREATE TABLE "AuthRateBucket" (
  "key" CHAR(64) NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "windowEnd" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "auth_rate_bucket_count_valid" CHECK ("count" > 0),
  CONSTRAINT "auth_rate_bucket_key_valid" CHECK ("key" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "AuthRateBucket_windowEnd_idx" ON "AuthRateBucket"("windowEnd");
COMMIT;
