ALTER TABLE "Listing" ADD COLUMN "saleMode" TEXT NOT NULL DEFAULT 'one_off';

UPDATE "Listing" SET "saleMode" = 'repeatable'
WHERE "type" = 'digital'
  AND NOT EXISTS (
    SELECT 1 FROM "DigitalInventory" di WHERE di."listingId" = "Listing"."id"
  );

ALTER TABLE "Listing" ADD CONSTRAINT "listing_sale_mode_valid"
  CHECK ("saleMode" IN ('one_off', 'repeatable') AND
    ("type" <> 'physical' OR "saleMode" = 'one_off'));
