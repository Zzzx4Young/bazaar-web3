CREATE TABLE "DigitalInventory" (
    "listingId" UUID NOT NULL,
    "listingType" TEXT NOT NULL DEFAULT 'digital',
    "availability" TEXT NOT NULL DEFAULT 'available',
    "activeOrderId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "DigitalInventory_pkey" PRIMARY KEY ("listingId")
);

ALTER TABLE "DigitalInventory" ADD CONSTRAINT "DigitalInventory_listingId_listingType_fkey"
  FOREIGN KEY ("listingId", "listingType") REFERENCES "Listing"("id", "type")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "DigitalInventory" ADD CONSTRAINT "DigitalInventory_activeOrderId_listingId_fkey"
  FOREIGN KEY ("activeOrderId", "listingId") REFERENCES "Order"("id", "listingId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "DigitalInventory" ADD CONSTRAINT "digital_inventory_valid" CHECK (
  "listingType" = 'digital' AND "version" > 0 AND
  (("availability" = 'available' AND "activeOrderId" IS NULL) OR
   ("availability" IN ('reserved', 'sold', 'refund_hold') AND "activeOrderId" IS NOT NULL))
);
