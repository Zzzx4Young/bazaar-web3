CREATE TABLE "Checkout" (
  "id" UUID NOT NULL,
  "buyerId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Checkout_buyerId_fkey" FOREIGN KEY ("buyerId")
    REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "Checkout_id_buyerId_key" ON "Checkout" ("id", "buyerId");
CREATE INDEX "Checkout_buyerId_createdAt_idx" ON "Checkout" ("buyerId", "createdAt");

ALTER TABLE "Order" ADD COLUMN "checkoutId" UUID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutId_buyerId_fkey"
  FOREIGN KEY ("checkoutId", "buyerId") REFERENCES "Checkout"("id", "buyerId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Order_checkoutId_idx" ON "Order" ("checkoutId");
