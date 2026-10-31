ALTER TABLE "Listing" ADD COLUMN "commitment" JSONB,
  ADD COLUMN "commitmentVersion" INTEGER,
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'clear',
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewKind" TEXT,
  ADD COLUMN "reviewUpdatedAt" TIMESTAMPTZ(6);
ALTER TABLE "OrderSnapshot" ADD COLUMN "commitment" JSONB,
  ADD COLUMN "commitmentVersion" INTEGER;
ALTER TABLE "Order" ADD COLUMN "transactionPausedAt" TIMESTAMPTZ(6),
  ADD COLUMN "pauseReviewId" UUID;
CREATE TABLE "ListingReviewEvent" (
  "id" UUID NOT NULL, "listingId" UUID NOT NULL, "actorId" UUID,
  "action" TEXT NOT NULL, "kind" TEXT, "reason" TEXT NOT NULL,
  "evidence" TEXT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingReviewEvent_pkey" PRIMARY KEY ("id")
);
CREATE TRIGGER listing_review_event_immutable BEFORE UPDATE OR DELETE ON "ListingReviewEvent"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE INDEX "ListingReviewEvent_listingId_createdAt_id_idx"
  ON "ListingReviewEvent"("listingId", "createdAt", "id");
ALTER TABLE "ListingReviewEvent" ADD CONSTRAINT "ListingReviewEvent_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingReviewEvent" ADD CONSTRAINT "ListingReviewEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Preserve the text and purchase snapshots. Flag only recognizable excluded sale claims;
-- other ambiguous wording remains for human triage.
UPDATE "Listing" SET "reviewStatus" = 'paused',
  "reviewReason" = 'Legacy excluded rights claim requires listing review',
  "reviewKind" = 'listing_rule', "reviewUpdatedAt" = CURRENT_TIMESTAMP
WHERE "reviewStatus" = 'clear' AND (
  ("title" || ' ' || "description" || ' ' || COALESCE("licenseDescription", ''))
  ~* '(版权.{0,8}(转让|出售|买断)|著作权.{0,8}(转让|出售|买断)|所有权.{0,8}(转让|出售|买断)|独家产权|独占产权|独家所有权|copyright[[:space:]]+(transfer|assignment|sale)|exclusive[[:space:]]+(ownership|property[[:space:]]+rights))'
);
UPDATE "Order" o SET "transactionPausedAt" = CURRENT_TIMESTAMP
FROM "Listing" l WHERE o."listingId" = l.id AND l."reviewStatus" = 'paused'
  AND o.status IN ('pending_payment','pending_delivery','pending_acceptance','issue');

INSERT INTO "ListingReviewEvent" ("id","listingId","actorId","action","kind","reason")
SELECT gen_random_uuid(), l.id, NULL, 'legacy_claim_pause', 'listing_rule', l."reviewReason"
FROM "Listing" l WHERE l."reviewStatus" = 'paused'
  AND l."reviewReason" = 'Legacy excluded rights claim requires listing review';
INSERT INTO "OrderEvent" ("id","orderId","actorId","operation","fromState","toState","requestId","note")
SELECT gen_random_uuid(), o.id, NULL, 'listing_review_pause', o.status, o.status,
  gen_random_uuid()::text, 'Legacy excluded rights claim requires listing review'
FROM "Order" o JOIN "Listing" l ON l.id = o."listingId"
WHERE l."reviewStatus" = 'paused' AND o."transactionPausedAt" IS NOT NULL
  AND l."reviewReason" = 'Legacy excluded rights claim requires listing review';
