CREATE TABLE "MediaAsset" (
  "id" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "uploadKey" TEXT NOT NULL,
  "hotKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "contentType" TEXT NOT NULL,
  "declaredBytes" INTEGER NOT NULL,
  "actualBytes" INTEGER,
  "sha256" CHAR(64),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMPTZ(6),
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_asset_state_valid" CHECK (
    ("status" = 'pending' AND "hotKey" IS NULL AND "actualBytes" IS NULL AND "sha256" IS NULL AND "verifiedAt" IS NULL) OR
    ("status" = 'ready' AND "hotKey" IS NOT NULL AND "actualBytes" IS NOT NULL AND "sha256" IS NOT NULL AND "verifiedAt" IS NOT NULL)
  ),
  CONSTRAINT "media_asset_size_valid" CHECK ("declaredBytes" BETWEEN 1 AND 5242880 AND ("actualBytes" IS NULL OR "actualBytes" = "declaredBytes")),
  CONSTRAINT "media_asset_type_valid" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp'))
);
CREATE UNIQUE INDEX "MediaAsset_uploadKey_key" ON "MediaAsset"("uploadKey");
CREATE UNIQUE INDEX "MediaAsset_hotKey_key" ON "MediaAsset"("hotKey");
CREATE INDEX "MediaAsset_sellerId_status_createdAt_idx" ON "MediaAsset"("sellerId", "status", "createdAt");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ListingMedia" (
  "listingId" UUID NOT NULL,
  "mediaId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "ListingMedia_pkey" PRIMARY KEY ("listingId", "mediaId"),
  CONSTRAINT "listing_media_position_valid" CHECK ("position" BETWEEN 0 AND 7)
);
CREATE UNIQUE INDEX "ListingMedia_listingId_position_key" ON "ListingMedia"("listingId", "position");
CREATE UNIQUE INDEX "ListingMedia_mediaId_key" ON "ListingMedia"("mediaId");
CREATE INDEX "ListingMedia_mediaId_idx" ON "ListingMedia"("mediaId");
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
