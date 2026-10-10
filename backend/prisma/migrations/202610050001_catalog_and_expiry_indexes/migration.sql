-- Supports the bounded expiry sweep: pending-payment status, oldest first.
CREATE INDEX CONCURRENTLY "Order_status_createdAt_id_idx" ON "Order"("status", "createdAt", "id");

-- Supports bounded home sections for each listing type.
CREATE INDEX CONCURRENTLY "Listing_publicationStatus_type_createdAt_id_idx"
  ON "Listing"("publicationStatus", "type", "createdAt", "id");
