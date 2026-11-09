-- CreateTable
CREATE TABLE "DeliveryMapping" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "versionId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "escrow" VARCHAR(42) NOT NULL,
    "chainOrderId" CHAR(66) NOT NULL,
    "credentialId" CHAR(66) NOT NULL,
    "deliveryVersion" CHAR(66) NOT NULL,
    "manifestCommitment" CHAR(66) NOT NULL,
    "salt" CHAR(64) NOT NULL,
    "manifest" JSONB NOT NULL,
    "permit" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySignature" (
    "signerAddress" VARCHAR(42) NOT NULL,
    "mappingId" UUID NOT NULL,
    "signature" VARCHAR(132) NOT NULL,

    CONSTRAINT "DeliverySignature_pkey" PRIMARY KEY ("mappingId")
);

-- CreateTable
CREATE TABLE "SupplementChallenge" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "mappingId" UUID NOT NULL,
    "message" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SupplementChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementPublication" (
    "authorizationId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "mappingId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "signature" VARCHAR(132) NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementPublication_pkey" PRIMARY KEY ("authorizationId")
);

-- CreateTable
CREATE TABLE "DownloadGrant" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "basis" JSONB NOT NULL,

    CONSTRAINT "DownloadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAccessAudit" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "submitterId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "parentId" UUID,
    "text" TEXT NOT NULL,
    "versionId" UUID,
    "deliveryReferenceId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAuthorization" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryMapping_credentialId_key" ON "DeliveryMapping"("credentialId");

-- CreateIndex
CREATE INDEX "DeliveryMapping_orderId_versionId_idx" ON "DeliveryMapping"("orderId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryMapping_actorId_key_key" ON "DeliveryMapping"("actorId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementChallenge_actorId_key_key" ON "SupplementChallenge"("actorId", "key");

-- CreateIndex
CREATE INDEX "EvidenceRecord_orderId_createdAt_idx" ON "EvidenceRecord"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_submitterId_key_key" ON "EvidenceRecord"("submitterId", "key");

-- CreateIndex
CREATE INDEX "ReviewAuthorization_orderId_accountId_idx" ON "ReviewAuthorization"("orderId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_actorId_key_key" ON "ReviewEvent"("actorId", "key");
ALTER TABLE "DeliveryMapping" ADD CONSTRAINT "DeliveryMapping_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplementChallenge" ADD CONSTRAINT "SupplementChallenge_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplementPublication" ADD CONSTRAINT "SupplementPublication_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "FileAccessAudit" ADD CONSTRAINT "FileAccessAudit_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "ReviewAuthorization" ADD CONSTRAINT "ReviewAuthorization_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "DeliveryMapping" ADD CONSTRAINT "DeliveryMapping_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PrivateFileVersion"("id") ON DELETE RESTRICT;
ALTER TABLE "DeliveryMapping" ADD CONSTRAINT "DeliveryMapping_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "DeliverySignature" ADD CONSTRAINT "DeliverySignature_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "DeliveryMapping"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplementChallenge" ADD CONSTRAINT "SupplementChallenge_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "DeliveryMapping"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplementPublication" ADD CONSTRAINT "SupplementPublication_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "SupplementChallenge"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplementPublication" ADD CONSTRAINT "SupplementPublication_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "DeliveryMapping"("id") ON DELETE RESTRICT;
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PrivateFileVersion"("id") ON DELETE RESTRICT;
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PrivateFileVersion"("id") ON DELETE RESTRICT;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_deliveryReferenceId_fkey" FOREIGN KEY ("deliveryReferenceId") REFERENCES "PrivateFileVersion"("id") ON DELETE RESTRICT;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EvidenceRecord"("id") ON DELETE RESTRICT;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "ReviewAuthorization" ADD CONSTRAINT "ReviewAuthorization_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "FileAccessAudit" ADD CONSTRAINT "FileAccessAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "DownloadGrant" ADD CONSTRAINT "DownloadGrant_lifetime" CHECK ("expiresAt"="issuedAt"+interval '300 seconds' AND "purpose" IN ('delivery','evidence'));
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_body" CHECK (length("text")<=10000 AND (length("text")>0 OR "versionId" IS NOT NULL OR "deliveryReferenceId" IS NOT NULL));
ALTER TABLE "DeliverySignature" ADD CONSTRAINT "DeliverySignature_format" CHECK ("signature" ~ '^0x[0-9a-fA-F]{130}$');
ALTER TABLE "SupplementPublication" ADD CONSTRAINT "SupplementPublication_format" CHECK ("signature" ~ '^0x[0-9a-fA-F]{130}$');
