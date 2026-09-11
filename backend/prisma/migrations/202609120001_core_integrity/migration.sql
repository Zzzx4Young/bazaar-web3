BEGIN;
-- DropForeignKey
ALTER TABLE "DeliveryRecord" DROP CONSTRAINT "DeliveryRecord_orderId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryRecord" DROP CONSTRAINT "DeliveryRecord_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "IssueRecord" DROP CONSTRAINT "IssueRecord_orderId_fkey";

-- DropForeignKey
ALTER TABLE "IssueRecord" DROP CONSTRAINT "IssueRecord_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_requestedBy_fkey";

-- DropForeignKey
ALTER TABLE "RefundRequest" DROP CONSTRAINT "RefundRequest_approvedBy_fkey";

-- CreateIndex
CREATE INDEX "Listing_sellerId_createdAt_id_idx" ON "Listing"("sellerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_buyerId_key" ON "Order"("id", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_sellerId_key" ON "Order"("id", "sellerId");

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_orderId_sellerId_fkey" FOREIGN KEY ("orderId", "sellerId") REFERENCES "Order"("id", "sellerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssueRecord" ADD CONSTRAINT "IssueRecord_orderId_buyerId_fkey" FOREIGN KEY ("orderId", "buyerId") REFERENCES "Order"("id", "buyerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_requestedBy_fkey" FOREIGN KEY ("orderId", "requestedBy") REFERENCES "Order"("id", "buyerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_approvedBy_fkey" FOREIGN KEY ("orderId", "approvedBy") REFERENCES "Order"("id", "sellerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Positive numeric alone admits PostgreSQL NaN. Keep the original migration immutable.
ALTER TABLE "Listing" ADD CONSTRAINT "listing_finite_price" CHECK ("priceAmount" <> 'NaN'::numeric);
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "snapshot_finite_price" CHECK ("priceAmount" <> 'NaN'::numeric);
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "settlement_finite_amount" CHECK ("amount" <> 'NaN'::numeric);
CREATE TRIGGER shipping_immutable BEFORE UPDATE OR DELETE ON "OrderShipping"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

CREATE FUNCTION protect_listing_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."sellerId", NEW."type", NEW."createdAt") IS DISTINCT FROM
     (OLD."id", OLD."sellerId", OLD."type", OLD."createdAt") THEN
    RAISE EXCEPTION 'immutable listing identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER listing_identity_immutable BEFORE UPDATE ON "Listing"
FOR EACH ROW EXECUTE FUNCTION protect_listing_identity();

CREATE FUNCTION protect_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."listingId", NEW."buyerId", NEW."sellerId", NEW."createdAt") IS DISTINCT FROM
     (OLD."id", OLD."listingId", OLD."buyerId", OLD."sellerId", OLD."createdAt") THEN
    RAISE EXCEPTION 'immutable order identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_identity_immutable BEFORE UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION protect_order_identity();

COMMIT;
