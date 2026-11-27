-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "recoveryEpoch" UUID,
ADD COLUMN     "walletAddress" VARCHAR(42),
ADD COLUMN     "walletBindingVersion" INTEGER,
ADD COLUMN     "walletChainId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "settlementMode" TEXT NOT NULL DEFAULT 'simulated';

-- CreateTable
CREATE TABLE "WalletIdentity" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" VARCHAR(42),
    "bindingVersion" INTEGER NOT NULL DEFAULT 0,
    "securityRevision" BIGINT NOT NULL DEFAULT 0,
    "lastOperationId" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WalletIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletClaim" (
    "chainId" INTEGER NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "accountId" UUID NOT NULL,
    "claimedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletClaim_pkey" PRIMARY KEY ("chainId","address")
);

-- CreateTable
CREATE TABLE "WalletSecurityOperation" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "revision" BIGINT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSecurityOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletIdentityEvent" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "operationId" UUID NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "previousAddress" VARCHAR(42),
    "currentAddress" VARCHAR(42),
    "bindingVersion" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletIdentityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletChallenge" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "wallet" VARCHAR(42),
    "bindingVersion" INTEGER NOT NULL,
    "recoveryEpoch" UUID NOT NULL,
    "sessionHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "invalidatedAt" TIMESTAMPTZ(6),
    "result" JSONB,

    CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerPayoutConfirmation" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "wallet" VARCHAR(42) NOT NULL,
    "escrow" VARCHAR(42) NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "challengeId" UUID NOT NULL,
    "statement" JSONB NOT NULL,
    "signature" VARCHAR(132) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SellerPayoutConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletIdentity_accountId_chainId_key" ON "WalletIdentity"("accountId", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletIdentity_chainId_address_key" ON "WalletIdentity"("chainId", "address");

-- CreateIndex
CREATE INDEX "WalletClaim_accountId_idx" ON "WalletClaim"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSecurityOperation_accountId_chainId_revision_key" ON "WalletSecurityOperation"("accountId", "chainId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "WalletIdentityEvent_operationId_key" ON "WalletIdentityEvent"("operationId");

-- CreateIndex
CREATE INDEX "WalletIdentityEvent_accountId_createdAt_idx" ON "WalletIdentityEvent"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletChallenge_requestHash_key" ON "WalletChallenge"("requestHash");

-- CreateIndex
CREATE INDEX "WalletChallenge_accountId_purpose_expiresAt_idx" ON "WalletChallenge"("accountId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SellerPayoutConfirmation_challengeId_key" ON "SellerPayoutConfirmation"("challengeId");

-- CreateIndex
CREATE INDEX "SellerPayoutConfirmation_accountId_chainId_revokedAt_idx" ON "SellerPayoutConfirmation"("accountId", "chainId", "revokedAt");

-- AddForeignKey
ALTER TABLE "WalletIdentity" ADD CONSTRAINT "WalletIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletClaim" ADD CONSTRAINT "WalletClaim_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletSecurityOperation" ADD CONSTRAINT "WalletSecurityOperation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletIdentityEvent" ADD CONSTRAINT "WalletIdentityEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletChallenge" ADD CONSTRAINT "WalletChallenge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SellerPayoutConfirmation" ADD CONSTRAINT "SellerPayoutConfirmation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Wallet ownership projections are constrained independently of HTTP validation.
ALTER TABLE "WalletIdentity" ADD CONSTRAINT "WalletIdentity_valid" CHECK (
  "chainId" IN (11155111, 31337) AND "bindingVersion" >= 0 AND "securityRevision" >= 0
  AND ("address" IS NULL OR ("address" ~ '^0x[0-9a-f]{40}$' AND "address" <> '0x0000000000000000000000000000000000000000'))
);
ALTER TABLE "WalletClaim" ADD CONSTRAINT "WalletClaim_valid" CHECK (
  "chainId" IN (11155111, 31337) AND "address" ~ '^0x[0-9a-f]{40}$'
  AND "address" <> '0x0000000000000000000000000000000000000000'
);
ALTER TABLE "WalletChallenge" ADD CONSTRAINT "WalletChallenge_valid" CHECK (
  "chainId" IN (11155111, 31337) AND "bindingVersion" >= 0 AND "expiresAt" > "createdAt"
  AND "expiresAt" <= "createdAt" + interval '300 seconds'
);
ALTER TABLE "SellerPayoutConfirmation" ADD CONSTRAINT "SellerPayoutConfirmation_valid" CHECK (
  "chainId" IN (11155111, 31337) AND "bindingVersion" > 0
  AND "wallet" ~ '^0x[0-9a-f]{40}$' AND "escrow" ~ '^0x[0-9a-f]{40}$'
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_settlementMode_valid" CHECK (
  "settlementMode" IN ('simulated', 'testnet_escrow')
);
ALTER TABLE "Session" ADD CONSTRAINT "Session_wallet_context" CHECK (
  "authMethod" IS DISTINCT FROM 'wallet_siwe' OR
  ("walletChainId" IS NOT NULL AND "walletAddress" IS NOT NULL
   AND "walletBindingVersion" IS NOT NULL AND "recoveryEpoch" IS NOT NULL)
);
