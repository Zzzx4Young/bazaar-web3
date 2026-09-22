CREATE TABLE "SellerReview" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "buyerId" UUID NOT NULL,
  "sellerId" UUID NOT NULL,
  "rating" SMALLINT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seller_review_rating_valid" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "SellerReview_orderId_buyerId_fkey" FOREIGN KEY ("orderId", "buyerId")
    REFERENCES "Order"("id", "buyerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SellerReview_orderId_sellerId_fkey" FOREIGN KEY ("orderId", "sellerId")
    REFERENCES "Order"("id", "sellerId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "SellerReview_orderId_key" ON "SellerReview" ("orderId");
CREATE UNIQUE INDEX "SellerReview_orderId_buyerId_key" ON "SellerReview" ("orderId", "buyerId");
CREATE INDEX "SellerReview_sellerId_createdAt_idx" ON "SellerReview" ("sellerId", "createdAt");
CREATE TRIGGER seller_review_immutable BEFORE UPDATE OR DELETE ON "SellerReview"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
