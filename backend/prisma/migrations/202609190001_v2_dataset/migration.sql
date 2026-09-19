BEGIN;

ALTER TABLE "Listing" DROP CONSTRAINT "listing_valid";
ALTER TABLE "Listing" ADD CONSTRAINT "listing_valid" CHECK (
  "type" IN ('physical', 'digital') AND
  "publicationStatus" IN ('published', 'withdrawn', 'draft', 'archived') AND
  "priceAmount" >= 0 AND "version" > 0 AND length("currency") > 0);

ALTER TABLE "OrderSnapshot" DROP CONSTRAINT "snapshot_valid";
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "snapshot_valid" CHECK (
  "priceAmount" >= 0 AND "listingVersion" > 0 AND "type" IN ('physical', 'digital'));

COMMIT;
