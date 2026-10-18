ALTER TABLE "OrderMediaSnapshot" ADD COLUMN "archiveClaimToken" UUID;
ALTER TABLE "OrderMediaSnapshot" ADD COLUMN "archiveClaimedUntil" TIMESTAMPTZ(6);
ALTER TABLE "OrderMediaSnapshot" ADD CONSTRAINT "order_media_claim_pair_valid" CHECK (
  ("archiveClaimToken" IS NULL AND "archiveClaimedUntil" IS NULL) OR
  ("archiveClaimToken" IS NOT NULL AND "archiveClaimedUntil" IS NOT NULL)
);
