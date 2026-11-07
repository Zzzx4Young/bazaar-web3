-- CreateTable
CREATE TABLE "TestnetStock" (
    "listingId" UUID NOT NULL,
    "stockId" CHAR(66) NOT NULL,
    "generation" VARCHAR(78) NOT NULL DEFAULT '0',
    "previousOrderId" CHAR(66) NOT NULL,
    "activeOrderId" UUID,
    "lastOrderId" UUID,
    "state" TEXT NOT NULL DEFAULT 'reserved',

    CONSTRAINT "TestnetStock_pkey" PRIMARY KEY ("listingId")
);

-- CreateTable
CREATE TABLE "PaymentOrderTerms" (
    "orderId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "stockId" CHAR(66) NOT NULL,
    "terms" JSONB NOT NULL,
    "termsHash" CHAR(66) NOT NULL,
    "recoveryEpoch" UUID NOT NULL,
    "initialIntentId" UUID NOT NULL,

    CONSTRAINT "PaymentOrderTerms_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "previousIntentId" UUID,
    "permit" JSONB NOT NULL,
    "digest" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntentState" (
    "intentId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "verification" JSONB,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentIntentState_pkey" PRIMARY KEY ("intentId")
);

-- CreateTable
CREATE TABLE "PaymentSignature" (
    "intentId" UUID NOT NULL,
    "signature" VARCHAR(132) NOT NULL,

    CONSTRAINT "PaymentSignature_pkey" PRIMARY KEY ("intentId")
);

-- CreateTable
CREATE TABLE "PaymentIntentRequest" (
    "actorId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "intentId" UUID NOT NULL,

    CONSTRAINT "PaymentIntentRequest_pkey" PRIMARY KEY ("actorId","operation","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestnetStock_stockId_key" ON "TestnetStock"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "TestnetStock_activeOrderId_key" ON "TestnetStock"("activeOrderId");

-- CreateIndex
CREATE INDEX "PaymentIntent_orderId_createdAt_idx" ON "PaymentIntent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntentState_orderId_status_idx" ON "PaymentIntentState"("orderId", "status");


ALTER TABLE "TestnetStock" ADD CONSTRAINT "TestnetStock_listing_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT;
ALTER TABLE "TestnetStock" ADD CONSTRAINT "TestnetStock_active_order_fkey" FOREIGN KEY ("activeOrderId", "listingId") REFERENCES "Order"("id", "listingId") ON DELETE RESTRICT;
ALTER TABLE "TestnetStock" ADD CONSTRAINT "TestnetStock_state_check" CHECK ("state" IN ('reserved','free','protected') AND "stockId" ~ '^0x[0-9a-f]{64}$' AND "generation" ~ '^(0|[1-9][0-9]{0,77})$');
ALTER TABLE "PaymentOrderTerms" ADD CONSTRAINT "PaymentOrderTerms_order_fkey" FOREIGN KEY ("orderId") REFERENCES "TestnetOrderSnapshot"("orderId") ON DELETE RESTRICT;
ALTER TABLE "PaymentOrderTerms" ADD CONSTRAINT "PaymentOrderTerms_stock_fkey" FOREIGN KEY ("stockId") REFERENCES "TestnetStock"("stockId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PaymentOrderTerms" ADD CONSTRAINT "PaymentOrderTerms_initial_fkey" FOREIGN KEY ("initialIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_terms_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrderTerms"("orderId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_previous_fkey" FOREIGN KEY ("previousIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_id_order_key" UNIQUE ("id","orderId");
ALTER TABLE "PaymentIntentState" ADD CONSTRAINT "PaymentIntentState_intent_fkey" FOREIGN KEY ("intentId","orderId") REFERENCES "PaymentIntent"("id","orderId") ON DELETE RESTRICT;
ALTER TABLE "PaymentIntentState" ADD CONSTRAINT "PaymentIntentState_status_check" CHECK ("status" IN ('issued','cancellation_pending','reconciling','revoked','expired','funded'));
CREATE UNIQUE INDEX "PaymentIntentState_one_live_per_order" ON "PaymentIntentState"("orderId") WHERE "status" IN ('issued','cancellation_pending','reconciling','funded');
ALTER TABLE "PaymentSignature" ADD CONSTRAINT "PaymentSignature_intent_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT;
ALTER TABLE "PaymentSignature" ADD CONSTRAINT "PaymentSignature_format_check" CHECK ("signature" ~ '^0x[0-9a-fA-F]{130}$');
ALTER TABLE "PaymentIntentRequest" ADD CONSTRAINT "PaymentIntentRequest_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "PaymentIntentRequest" ADD CONSTRAINT "PaymentIntentRequest_intent_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT;
