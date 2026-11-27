-- CreateTable
CREATE TABLE "PrivateFileQuota" (
    "accountId" UUID NOT NULL,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "activeUploads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrivateFileQuota_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "PrivateFileGlobal" (
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "policyHash" CHAR(64) NOT NULL,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "activeUploads" INTEGER NOT NULL DEFAULT 0,
    "queued" INTEGER NOT NULL DEFAULT 0,
    "checking" INTEGER NOT NULL DEFAULT 0,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrivateFileGlobal_pkey" PRIMARY KEY ("singleton")
);

-- CreateTable
CREATE TABLE "PrivateUpload" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "declaredBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "actualBytes" INTEGER,
    "sha256" CHAR(64),
    "queuedAt" TIMESTAMPTZ(6),
    "checkStartedAt" TIMESTAMPTZ(6),
    "checkId" UUID,
    "failureReason" TEXT,
    "cleanedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PrivateUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateFileVersion" (
    "id" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "objectVersion" UUID NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "checkId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateFileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateFileCheck" (
    "id" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateFileCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateFileAudit" (
    "id" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateFileAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrivateUpload_objectKey_key" ON "PrivateUpload"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateUpload_checkId_key" ON "PrivateUpload"("checkId");

-- CreateIndex
CREATE INDEX "PrivateUpload_accountId_createdAt_idx" ON "PrivateUpload"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivateUpload_status_createdAt_idx" ON "PrivateUpload"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateUpload_accountId_key_key" ON "PrivateUpload"("accountId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateFileVersion_uploadId_key" ON "PrivateFileVersion"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateFileVersion_objectKey_key" ON "PrivateFileVersion"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateFileVersion_checkId_key" ON "PrivateFileVersion"("checkId");

-- CreateIndex
CREATE INDEX "PrivateFileVersion_orderId_purpose_idx" ON "PrivateFileVersion"("orderId", "purpose");

-- CreateIndex
CREATE INDEX "PrivateFileCheck_uploadId_idx" ON "PrivateFileCheck"("uploadId");

-- CreateIndex
CREATE INDEX "PrivateFileAudit_uploadId_createdAt_idx" ON "PrivateFileAudit"("uploadId", "createdAt");


ALTER TABLE "PrivateFileQuota" ADD CONSTRAINT "PrivateFileQuota_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "PrivateFileQuota" ADD CONSTRAINT "PrivateFileQuota_budget_check" CHECK ("reservedBytes">=0 AND "usedBytes">=0 AND "reservedBytes"+"usedBytes"<=2000000000 AND "activeUploads" BETWEEN 0 AND 2);
ALTER TABLE "PrivateFileGlobal" ADD CONSTRAINT "PrivateFileGlobal_budget_check" CHECK ("singleton" AND "reservedBytes">=0 AND "usedBytes">=0 AND "activeUploads">=0 AND "queued" BETWEEN 0 AND 100 AND "checking" BETWEEN 0 AND 4);
ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_order_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT;
ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_scope_check" CHECK ("purpose" IN ('delivery','evidence') AND "declaredBytes">0 AND "declaredBytes"<=CASE WHEN "contentType"='application/zip' THEN 500000000 ELSE 20000000 END AND "contentType" IN ('application/pdf','image/png','image/jpeg','application/zip') AND "expiresAt">"createdAt");
ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_state_check" CHECK ("status" IN ('uploading','receiving','quarantined','checking','ready','rejected','check_timeout','cleanup_pending','expired','cleaned'));
ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_version_tuple_key" UNIQUE ("id","orderId","accountId","purpose","objectKey","actualBytes","sha256");
ALTER TABLE "PrivateFileCheck" ADD CONSTRAINT "PrivateFileCheck_upload_fkey" FOREIGN KEY ("uploadId") REFERENCES "PrivateUpload"("id") ON DELETE RESTRICT;
ALTER TABLE "PrivateFileCheck" ADD CONSTRAINT "PrivateFileCheck_id_upload_key" UNIQUE ("id","uploadId");
ALTER TABLE "PrivateFileVersion" ADD CONSTRAINT "PrivateFileVersion_exact_upload_fkey" FOREIGN KEY ("uploadId","orderId","ownerId","purpose","objectKey","byteSize","sha256") REFERENCES "PrivateUpload"("id","orderId","accountId","purpose","objectKey","actualBytes","sha256") ON DELETE RESTRICT;
ALTER TABLE "PrivateFileVersion" ADD CONSTRAINT "PrivateFileVersion_exact_check_fkey" FOREIGN KEY ("checkId","uploadId") REFERENCES "PrivateFileCheck"("id","uploadId") ON DELETE RESTRICT;
ALTER TABLE "PrivateFileVersion" ADD CONSTRAINT "PrivateFileVersion_object_version_check" CHECK ("objectVersion"="uploadId" AND "sha256" ~ '^[0-9a-f]{64}$' AND "byteSize">0 AND "purpose" IN ('delivery','evidence'));
ALTER TABLE "PrivateFileAudit" ADD CONSTRAINT "PrivateFileAudit_upload_fkey" FOREIGN KEY ("uploadId") REFERENCES "PrivateUpload"("id") ON DELETE RESTRICT;

ALTER TABLE "PrivateUpload" ADD COLUMN "receiveOwnerScope" CHAR(64), ADD COLUMN "receiveOwnerPid" INTEGER, ADD COLUMN "receiveOwnerStart" TEXT, ADD COLUMN "receiveStopped" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "checkOwnerScope" CHAR(64), ADD COLUMN "checkOwnerPid" INTEGER, ADD COLUMN "checkOwnerStart" TEXT, ADD COLUMN "checkOwnerStopped" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "checkCancelRequested" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "checkDeadlineAt" TIMESTAMPTZ(6);
