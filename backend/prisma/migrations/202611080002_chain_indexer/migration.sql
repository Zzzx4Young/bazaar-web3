-- CreateTable
CREATE TABLE "ScanCheckpoint" (
    "scope" VARCHAR(100) NOT NULL,
    "configHash" CHAR(64) NOT NULL,
    "deploymentBlock" BIGINT NOT NULL,
    "height" BIGINT NOT NULL,
    "hash" CHAR(66) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recovering',
    "globals" JSONB,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ScanCheckpoint_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "ChainBlock" (
    "scope" VARCHAR(100) NOT NULL,
    "hash" CHAR(66) NOT NULL,
    "height" BIGINT NOT NULL,
    "parentHash" CHAR(66) NOT NULL,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "ChainBlock_pkey" PRIMARY KEY ("scope","hash")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "scope" VARCHAR(100) NOT NULL,
    "blockHash" CHAR(66) NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "logIndex" BIGINT NOT NULL,
    "height" BIGINT NOT NULL,
    "txIndex" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "args" JSONB NOT NULL,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("scope","blockHash","txHash","logIndex")
);

-- CreateTable
CREATE TABLE "EscrowProjection" (
    "scope" VARCHAR(100) NOT NULL,
    "chainOrderId" CHAR(66) NOT NULL,
    "businessOrderId" UUID,
    "state" TEXT NOT NULL,
    "stockId" CHAR(66) NOT NULL,
    "amountAtoms" VARCHAR(78) NOT NULL,
    "data" JSONB NOT NULL,
    "height" BIGINT NOT NULL,
    "blockHash" CHAR(66) NOT NULL,
    "holdReason" TEXT,
    "downloadEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EscrowProjection_pkey" PRIMARY KEY ("scope","chainOrderId")
);

-- CreateTable
CREATE TABLE "ChainStockProjection" (
    "scope" VARCHAR(100) NOT NULL,
    "stockId" CHAR(66) NOT NULL,
    "occupant" CHAR(66) NOT NULL,
    "generation" VARCHAR(78) NOT NULL,
    "status" TEXT NOT NULL,
    "height" BIGINT NOT NULL,
    "blockHash" CHAR(66) NOT NULL,

    CONSTRAINT "ChainStockProjection_pkey" PRIMARY KEY ("scope","stockId")
);

-- CreateTable
CREATE TABLE "ReconciliationIncident" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAttempt" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "actorId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "observation" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainObservation" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "blockHash" CHAR(66) NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChainBlock_scope_height_key" ON "ChainBlock"("scope", "height");

-- CreateIndex
CREATE INDEX "ChainEvent_scope_height_txIndex_logIndex_idx" ON "ChainEvent"("scope", "height", "txIndex", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_scope_txHash_logIndex_key" ON "ChainEvent"("scope", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "ReconciliationIncident_scope_createdAt_idx" ON "ReconciliationIncident"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionAttempt_scope_txHash_idx" ON "TransactionAttempt"("scope", "txHash");

-- CreateIndex
CREATE INDEX "TransactionAttempt_orderId_createdAt_idx" ON "TransactionAttempt"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionAttempt_actorId_key_key" ON "TransactionAttempt"("actorId", "key");

-- CreateIndex
CREATE INDEX "ChainObservation_scope_txHash_idx" ON "ChainObservation"("scope", "txHash");

ALTER TABLE "ScanCheckpoint" ADD CONSTRAINT "ScanCheckpoint_state_check" CHECK ("status" IN ('active','recovering','isolated') AND "height" >= -1 AND "deploymentBlock" >= 0);
ALTER TABLE "EscrowProjection" ADD CONSTRAINT "EscrowProjection_download_disabled" CHECK ("downloadEnabled" = false);
ALTER TABLE "EscrowProjection" ADD CONSTRAINT "EscrowProjection_state_check" CHECK ("state" IN ('Funded','Delivered','Disputed','Released','Refunded'));
ALTER TABLE "ChainStockProjection" ADD CONSTRAINT "ChainStockProjection_state_check" CHECK ("status" IN ('occupied','refundable_unregistered','blocked_registered','sold'));
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_status_check" CHECK ("status" IN ('submitted','included','replaced','reverted','finalized','unknown'));
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "TransactionAttempt" ADD CONSTRAINT "TransactionAttempt_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
