BEGIN;
ALTER TABLE "DeliveryRecord" ADD COLUMN "carrier" TEXT;
ALTER TABLE "DeliveryRecord" ADD COLUMN "accessCode" TEXT;
COMMIT;
