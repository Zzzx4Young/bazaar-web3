-- CreateTable
CREATE TABLE "ListingTestnetPrice" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "chainId" INTEGER NOT NULL,
    "token" VARCHAR(42) NOT NULL,
    "escrow" VARCHAR(42) NOT NULL,
    "amountAtoms" VARCHAR(78) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingTestnetPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestnetOrderSnapshot" (
    "orderId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "priceId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "token" VARCHAR(42) NOT NULL,
    "escrow" VARCHAR(42) NOT NULL,
    "amountAtoms" VARCHAR(78) NOT NULL,
    "sellerWallet" VARCHAR(42) NOT NULL,
    "sellerBindingVersion" INTEGER NOT NULL,
    "payoutConfirmationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestnetOrderSnapshot_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingTestnetPrice_listingId_listingVersion_key" ON "ListingTestnetPrice"("listingId", "listingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ListingTestnetPrice_terms_key" ON "ListingTestnetPrice"("id", "listingId", "listingVersion", "chainId", "token", "escrow", "amountAtoms");

-- CreateIndex
CREATE INDEX "TestnetOrderSnapshot_sellerId_createdAt_idx" ON "TestnetOrderSnapshot"("sellerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestnetOrderSnapshot_orderId_listingVersion_key" ON "TestnetOrderSnapshot"("orderId", "listingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TestnetOrderSnapshot_order_terms_key" ON "TestnetOrderSnapshot"("orderId", "listingId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_testnet_listing_seller_key" ON "Order"("id", "listingId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSnapshot_orderId_listingVersion_key" ON "OrderSnapshot"("orderId", "listingVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SellerPayoutConfirmation_terms_key" ON "SellerPayoutConfirmation"("id", "accountId", "chainId", "wallet", "escrow", "bindingVersion");

-- AddForeignKey
ALTER TABLE "ListingTestnetPrice" ADD CONSTRAINT "ListingTestnetPrice_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestnetOrderSnapshot" ADD CONSTRAINT "TestnetOrderSnapshot_orderId_listingId_sellerId_fkey" FOREIGN KEY ("orderId", "listingId", "sellerId") REFERENCES "Order"("id", "listingId", "sellerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestnetOrderSnapshot" ADD CONSTRAINT "TestnetOrderSnapshot_orderId_listingVersion_fkey" FOREIGN KEY ("orderId", "listingVersion") REFERENCES "OrderSnapshot"("orderId", "listingVersion") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestnetOrderSnapshot" ADD CONSTRAINT "TestnetOrderSnapshot_price_terms_fkey" FOREIGN KEY ("priceId", "listingId", "listingVersion", "chainId", "token", "escrow", "amountAtoms") REFERENCES "ListingTestnetPrice"("id", "listingId", "listingVersion", "chainId", "token", "escrow", "amountAtoms") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TestnetOrderSnapshot" ADD CONSTRAINT "TestnetOrderSnapshot_payout_terms_fkey" FOREIGN KEY ("payoutConfirmationId", "sellerId", "chainId", "sellerWallet", "escrow", "sellerBindingVersion") REFERENCES "SellerPayoutConfirmation"("id", "accountId", "chainId", "wallet", "escrow", "bindingVersion") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "ListingTestnetPrice" ADD CONSTRAINT "ListingTestnetPrice_valid" CHECK (
  "listingVersion" > 0 AND "chainId" IN (11155111, 31337)
  AND "token" ~ '^0x[0-9a-f]{40}$' AND "token" <> '0x0000000000000000000000000000000000000000'
  AND "escrow" ~ '^0x[0-9a-f]{40}$' AND "escrow" <> '0x0000000000000000000000000000000000000000'
  AND "amountAtoms" ~ '^[1-9][0-9]{0,77}$'
  AND "amountAtoms"::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
);
ALTER TABLE "TestnetOrderSnapshot" ADD CONSTRAINT "TestnetOrderSnapshot_wallet_valid" CHECK (
  "sellerBindingVersion" > 0 AND "sellerWallet" ~ '^0x[0-9a-f]{40}$'
);
CREATE UNIQUE INDEX "SellerPayoutConfirmation_one_active" ON "SellerPayoutConfirmation" ("accountId", "chainId") WHERE "revokedAt" IS NULL;
