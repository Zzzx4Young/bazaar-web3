ALTER TABLE "Order" DROP CONSTRAINT "order_valid";
ALTER TABLE "Order" ADD CONSTRAINT "order_valid" CHECK (
  "buyerId" <> "sellerId" AND "version" > 0 AND "status" IN
  ('pending_payment', 'pending_delivery', 'pending_acceptance', 'issue', 'cancelled', 'expired', 'completed', 'refunded')
);

ALTER TABLE "InventoryReservation" DROP CONSTRAINT "reservation_valid";
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "reservation_valid" CHECK (
  ("state" = 'active' AND "closedAt" IS NULL) OR
  ("state" IN ('cancelled', 'expired', 'completed', 'refunded') AND "closedAt" IS NOT NULL)
);
