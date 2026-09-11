BEGIN;
-- Target schema is explicitly selected by the migration runner.

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "loginName" VARCHAR(100) NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceAmount" DECIMAL(38,18) NOT NULL,
    "currency" VARCHAR(12) NOT NULL,
    "publicationStatus" TEXT NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "licenseDescription" TEXT,
    "contentVersion" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshot" (
    "orderId" UUID NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceAmount" DECIMAL(38,18) NOT NULL,
    "currency" VARCHAR(12) NOT NULL,
    "licenseDescription" TEXT,
    "contentVersion" TEXT,

    CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "OrderShipping" (
    "orderId" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "OrderShipping_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "PhysicalInventory" (
    "listingId" UUID NOT NULL,
    "listingType" TEXT NOT NULL DEFAULT 'physical',
    "availability" TEXT NOT NULL DEFAULT 'available',
    "activeOrderId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PhysicalInventory_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "sourceStatus" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "IssueRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" UUID,
    "returnOutcome" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'simulated',
    "operation" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "currency" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "actorId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "resourceId" UUID,
    "resultCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("actorId","operation","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_loginName_key" ON "Account"("loginName");

-- CreateIndex
CREATE INDEX "Listing_publicationStatus_createdAt_id_idx" ON "Listing"("publicationStatus", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_id_sellerId_key" ON "Listing"("id", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_id_type_key" ON "Listing"("id", "type");

-- CreateIndex
CREATE INDEX "Order_buyerId_createdAt_id_idx" ON "Order"("buyerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_id_idx" ON "Order"("sellerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_listingId_key" ON "Order"("id", "listingId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSnapshot_orderId_priceAmount_currency_key" ON "OrderSnapshot"("orderId", "priceAmount", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_orderId_key" ON "InventoryReservation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_orderId_sequence_key" ON "DeliveryRecord"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRecord_id_orderId_key" ON "IssueRecord"("id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_issueId_key" ON "RefundRequest"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRecord_orderId_operation_key" ON "SettlementRecord"("orderId", "operation");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_id_idx" ON "OrderEvent"("orderId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_listingId_sellerId_fkey" FOREIGN KEY ("listingId", "sellerId") REFERENCES "Listing"("id", "sellerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderShipping" ADD CONSTRAINT "OrderShipping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_listingId_listingType_fkey" FOREIGN KEY ("listingId", "listingType") REFERENCES "Listing"("id", "type") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_activeOrderId_listingId_fkey" FOREIGN KEY ("activeOrderId", "listingId") REFERENCES "Order"("id", "listingId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "PhysicalInventory"("listingId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_listingId_fkey" FOREIGN KEY ("orderId", "listingId") REFERENCES "Order"("id", "listingId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssueRecord" ADD CONSTRAINT "IssueRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IssueRecord" ADD CONSTRAINT "IssueRecord_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_issueId_orderId_fkey" FOREIGN KEY ("issueId", "orderId") REFERENCES "IssueRecord"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "SettlementRecord_orderId_amount_currency_fkey" FOREIGN KEY ("orderId", "amount", "currency") REFERENCES "OrderSnapshot"("orderId", "priceAmount", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-maintained PostgreSQL invariants. Prisma cannot express CHECK/trigger rules.
ALTER TABLE "Account" ADD CONSTRAINT "account_status" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "Listing" ADD CONSTRAINT "listing_valid" CHECK (
  "type" IN ('physical', 'digital') AND "publicationStatus" IN ('published', 'withdrawn')
  AND "priceAmount" > 0 AND "version" > 0 AND length("currency") > 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_valid" CHECK (
  "buyerId" <> "sellerId" AND "version" > 0 AND "status" IN
  ('pending_payment', 'pending_delivery', 'pending_acceptance', 'issue', 'cancelled', 'completed', 'refunded'));
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "snapshot_valid" CHECK (
  "priceAmount" > 0 AND "listingVersion" > 0 AND "type" IN ('physical', 'digital'));
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "inventory_valid" CHECK (
  "listingType" = 'physical' AND "version" > 0 AND
  (("availability" = 'available' AND "activeOrderId" IS NULL) OR
   ("availability" IN ('reserved', 'sold', 'refund_hold') AND "activeOrderId" IS NOT NULL)));
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "reservation_valid" CHECK (
  ("state" = 'active' AND "closedAt" IS NULL) OR
  ("state" IN ('cancelled', 'completed', 'refunded') AND "closedAt" IS NOT NULL));
CREATE UNIQUE INDEX "one_active_reservation" ON "InventoryReservation" ("listingId") WHERE "state" = 'active';
CREATE UNIQUE INDEX "one_open_issue" ON "IssueRecord" ("orderId") WHERE "status" = 'open';
ALTER TABLE "IssueRecord" ADD CONSTRAINT "issue_valid" CHECK (
  "sourceStatus" IN ('pending_delivery', 'pending_acceptance') AND
  (("status" = 'open' AND "resolvedAt" IS NULL) OR
   ("status" = 'resolved' AND "resolvedAt" IS NOT NULL)));
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "delivery_valid" CHECK (
  "sequence" > 0 AND "kind" IN ('physical', 'digital') AND length("reference") > 0);
ALTER TABLE "RefundRequest" ADD CONSTRAINT "refund_valid" CHECK (
  ("status" = 'pending' AND "approvedBy" IS NULL AND "approvedAt" IS NULL AND "returnOutcome" IS NULL) OR
  ("status" = 'approved' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL
    AND "returnOutcome" IS NOT NULL AND "returnOutcome" IN ('not_sent', 'returned', 'not_required', 'digital')) OR
  ("status" = 'closed' AND "approvedBy" IS NULL AND "approvedAt" IS NULL AND "returnOutcome" IS NULL));
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "settlement_valid" CHECK (
  "mode" = 'simulated' AND "operation" IN ('payment', 'refund') AND "amount" > 0);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "idempotency_valid" CHECK (
  length("key") BETWEEN 1 AND 100 AND "requestHash" ~ '^[0-9a-f]{64}$');

CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable history' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON "OrderSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON "OrderEvent"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON "SettlementRecord"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER delivery_immutable BEFORE UPDATE OR DELETE ON "DeliveryRecord"
FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

-- A transaction may reserve a key, but must never commit an unfinished result.
CREATE FUNCTION require_idempotency_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "IdempotencyRecord" WHERE "actorId" = NEW."actorId"
    AND "operation" = NEW."operation" AND "key" = NEW."key"
    AND ("resourceId" IS NULL OR "resultCode" IS NULL)) THEN
    RAISE EXCEPTION 'unfinished idempotency result' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER idempotency_result_required
AFTER INSERT OR UPDATE ON "IdempotencyRecord" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_idempotency_result();

COMMIT;
