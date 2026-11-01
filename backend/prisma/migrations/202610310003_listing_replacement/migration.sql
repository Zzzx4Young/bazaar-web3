ALTER TABLE "Listing" ADD COLUMN "replacementOfListingId" UUID;
CREATE UNIQUE INDEX "Listing_replacementOfListingId_key" ON "Listing"("replacementOfListingId");
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_replacementOfListingId_fkey"
  FOREIGN KEY ("replacementOfListingId") REFERENCES "Listing"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
