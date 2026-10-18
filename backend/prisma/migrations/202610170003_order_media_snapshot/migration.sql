ALTER TABLE "MediaAsset" ADD COLUMN "coldKey" TEXT;
CREATE UNIQUE INDEX "MediaAsset_coldKey_key" ON "MediaAsset"("coldKey");

ALTER TABLE "Order" ADD COLUMN "completedAt" TIMESTAMPTZ(6);
UPDATE "Order" AS o SET "completedAt" = (
  SELECT MIN(e."createdAt") FROM "OrderEvent" e
  WHERE e."orderId" = o."id" AND e."toState" = 'completed'
) WHERE o."status" = 'completed';
CREATE INDEX "Order_completedAt_id_idx" ON "Order"("completedAt", "id");

CREATE TABLE "OrderMediaSnapshot" (
  "orderId" UUID NOT NULL,
  "mediaId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "storageTier" TEXT NOT NULL DEFAULT 'hot',
  "archivedAt" TIMESTAMPTZ(6),
  CONSTRAINT "OrderMediaSnapshot_pkey" PRIMARY KEY ("orderId", "mediaId"),
  CONSTRAINT "order_media_position_valid" CHECK ("position" BETWEEN 0 AND 7),
  CONSTRAINT "order_media_storage_tier_valid" CHECK (
    ("storageTier" = 'hot' AND "archivedAt" IS NULL) OR
    ("storageTier" = 'cold' AND "archivedAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "OrderMediaSnapshot_orderId_position_key" ON "OrderMediaSnapshot"("orderId", "position");
CREATE INDEX "OrderMediaSnapshot_storageTier_orderId_idx" ON "OrderMediaSnapshot"("storageTier", "orderId");
CREATE INDEX "OrderMediaSnapshot_mediaId_storageTier_idx" ON "OrderMediaSnapshot"("mediaId", "storageTier");
ALTER TABLE "OrderMediaSnapshot" ADD CONSTRAINT "OrderMediaSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OrderMediaSnapshot" ADD CONSTRAINT "OrderMediaSnapshot_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
