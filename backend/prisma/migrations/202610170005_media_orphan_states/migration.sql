ALTER TABLE "MediaAsset" DROP CONSTRAINT "media_asset_state_valid";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_state_valid" CHECK (
  ("status" IN ('pending', 'expired', 'discarded') AND "hotKey" IS NULL AND
    "actualBytes" IS NULL AND "sha256" IS NULL AND "verifiedAt" IS NULL) OR
  ("status" = 'ready' AND "hotKey" IS NOT NULL AND "actualBytes" IS NOT NULL AND
    "sha256" IS NOT NULL AND "verifiedAt" IS NOT NULL)
);
