// Run after migrations as the schema owner. Roles are provisioned separately by an administrator.
// Explicit grants deliberately exclude Prisma's migration table and future tables.
export async function grantRuntime(client, schema, role) {
  for (const identifier of [schema, role]) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) throw new Error('Invalid SQL identifier')
  }
  const immutable = [
    'OrderSnapshot',
    'OrderShipping',
    'DeliveryRecord',
    'SettlementRecord',
    'OrderEvent',
    'RateSnapshot',
    'SellerReview',
    'OrderMediaSnapshot',
    'AccountIdentityEvent',
    'ListingReviewEvent',
    'WalletClaim',
    'WalletIdentityEvent',
    'WalletSecurityOperation',
    'ListingTestnetPrice',
    'TestnetOrderSnapshot',
    'PaymentOrderTerms',
    'PaymentIntent',
    'PaymentSignature',
    'PaymentIntentRequest',
    'PrivateFileVersion',
    'PrivateFileCheck',
    'PrivateFileAudit',
    'ChainBlock',
    'ChainEvent',
    'ChainSnapshot',
    'ReconciliationIncident',
    'RefundInventoryTransition',
    'DeliveryMapping',
    'DeliverySignature',
    'SupplementChallenge',
    'SupplementPublication',
    'DownloadGrant',
    'FileAccessAudit',
    'EvidenceRecord',
    'ReviewAuthorization',
    'ReviewEvent'
  ]
  const mutable = [
    'Account',
    'Listing',
    'Order',
    'Checkout',
    'PhysicalInventory',
    'DigitalInventory',
    'InventoryReservation',
    'IssueRecord',
    'RefundRequest',
    'IdempotencyRecord',
    'Session',
    'AuthRateBucket',
    'AccountIdentity',
    'GmailClaim',
    'EmailCodeChallenge',
    'GoogleOAuthAttempt',
    'MediaAsset',
    'ListingMedia',
    'WalletIdentity',
    'WalletChallenge',
    'SellerPayoutConfirmation',
    'TestnetStock',
    'PaymentIntentState',
    'PrivateUpload',
    'PrivateFileQuota',
    'PrivateFileGlobal',
    'ScanCheckpoint',
    'EscrowProjection',
    'ChainStockProjection',
    'TransactionAttempt',
    'ChainObservation'
  ]
  await client.$transaction(async (tx) => {
    const roles = await tx.$queryRaw`
      SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
        pg_has_role(r.oid, n.nspowner, 'MEMBER') AS owns_schema,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS has_membership
      FROM pg_roles r CROSS JOIN pg_namespace n
      WHERE r.rolname = ${role} AND n.nspname = ${schema}`
    if (roles.length !== 1 || Object.values(roles[0]).some(Boolean)) {
      throw new Error('Runtime role must be unprivileged, without memberships or schema ownership')
    }
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC, "${role}"`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM "${role}"`)
    for (const table of [...immutable, ...mutable]) {
      const permissions =
        table === 'AccountIdentityEvent'
          ? 'INSERT'
          : table === 'GmailClaim'
            ? 'SELECT, INSERT, DELETE'
            : [
                  'AuthRateBucket',
                  'ListingMedia',
                  'EmailCodeChallenge',
                  'GoogleOAuthAttempt'
                ].includes(table)
              ? 'SELECT, INSERT, UPDATE, DELETE'
              : ['OrderMediaSnapshot', 'MediaAsset'].includes(table)
                ? 'SELECT, INSERT, UPDATE'
                : mutable.includes(table)
                  ? 'SELECT, INSERT, UPDATE'
                  : 'SELECT, INSERT'
      await tx.$executeRawUnsafe(`GRANT ${permissions} ON "${schema}"."${table}" TO "${role}"`)
    }
    await tx.$executeRawUnsafe(
      `GRANT SELECT ON "${schema}"."PrivateFileDisposition", "${schema}"."PrivateRecoveryState" TO "${role}"`
    )
    await tx.$executeRawUnsafe(`REVOKE INSERT ON "${schema}"."ReviewAuthorization" FROM "${role}"`)
    await tx.$executeRawUnsafe(
      `REVOKE UPDATE ON "${schema}"."PrivateUpload", "${schema}"."PrivateFileQuota", "${schema}"."PrivateFileGlobal" FROM "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("status","actualBytes","sha256","queuedAt","checkStartedAt","checkId","failureReason","cleanedAt","receiveOwnerScope","receiveOwnerPid","receiveOwnerStart","receiveStopped","checkOwnerScope","checkOwnerPid","checkOwnerStart","checkOwnerStopped","checkCancelRequested","checkDeadlineAt") ON "${schema}"."PrivateUpload" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("reservedBytes","usedBytes","activeUploads") ON "${schema}"."PrivateFileQuota" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("reservedBytes","usedBytes","activeUploads","queued","checking") ON "${schema}"."PrivateFileGlobal" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `REVOKE UPDATE ON "${schema}"."TransactionAttempt", "${schema}"."ChainObservation", "${schema}"."ScanCheckpoint" FROM "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("status", "observation") ON "${schema}"."TransactionAttempt" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("status") ON "${schema}"."ChainObservation" TO "${role}"`
    )
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("height", "hash", "status", "globals", "updatedAt") ON "${schema}"."ScanCheckpoint" TO "${role}"`
    )
    await tx.$executeRawUnsafe(`REVOKE UPDATE ON "${schema}"."TestnetStock" FROM "${role}"`)
    await tx.$executeRawUnsafe(
      `GRANT UPDATE ("activeOrderId", "lastOrderId", "state", "generation", "previousOrderId") ON "${schema}"."TestnetStock" TO "${role}"`
    )
    await tx.$executeRawUnsafe(`GRANT SELECT ON "${schema}"."AccountCredential" TO "${role}"`)
  })
}
