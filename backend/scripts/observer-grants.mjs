const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid SQL identifier')
  return `"${value}"`
}

const views = {
  accounts: `SELECT id, status, "createdAt" AS created_at, role FROM SOURCE."Account"`,
  listings: `SELECT id, "sellerId" AS seller_id, type, category, "priceAmount" AS price_amount,
    currency, "publicationStatus" AS publication_status, version, "createdAt" AS created_at,
    "updatedAt" AS updated_at FROM SOURCE."Listing"`,
  orders: `SELECT id, "listingId" AS listing_id, "buyerId" AS buyer_id,
    "sellerId" AS seller_id, status, version, "createdAt" AS created_at,
    "updatedAt" AS updated_at, "checkoutId" AS checkout_id FROM SOURCE."Order"`,
  checkouts: `SELECT id, "buyerId" AS buyer_id, "createdAt" AS created_at FROM SOURCE."Checkout"`,
  order_snapshots: `SELECT "orderId" AS order_id, "listingVersion" AS listing_version, type,
    category, "priceAmount" AS price_amount, currency FROM SOURCE."OrderSnapshot"`,
  order_shipping_status: `SELECT "orderId" AS order_id, true AS has_shipping
    FROM SOURCE."OrderShipping"`,
  physical_inventory: `SELECT "listingId" AS listing_id, availability,
    "activeOrderId" AS active_order_id, version FROM SOURCE."PhysicalInventory"`,
  digital_inventory: `SELECT "listingId" AS listing_id, availability,
    "activeOrderId" AS active_order_id, version FROM SOURCE."DigitalInventory"`,
  inventory_reservations: `SELECT id, "listingId" AS listing_id, "orderId" AS order_id,
    state, "createdAt" AS created_at, "closedAt" AS closed_at
    FROM SOURCE."InventoryReservation"`,
  deliveries: `SELECT id, "orderId" AS order_id, "sellerId" AS seller_id, sequence, kind,
    "createdAt" AS created_at FROM SOURCE."DeliveryRecord"`,
  issues: `SELECT id, "orderId" AS order_id, "buyerId" AS buyer_id,
    "sourceStatus" AS source_status, status, "createdAt" AS created_at,
    "resolvedAt" AS resolved_at FROM SOURCE."IssueRecord"`,
  refunds: `SELECT id, "orderId" AS order_id, "issueId" AS issue_id,
    "requestedBy" AS requested_by, status, "approvedBy" AS approved_by,
    "returnOutcome" AS return_outcome, "createdAt" AS created_at,
    "approvedAt" AS approved_at, "resolvedBy" AS resolved_by FROM SOURCE."RefundRequest"`,
  settlements: `SELECT id, "orderId" AS order_id, mode, operation, amount, currency,
    "createdAt" AS created_at FROM SOURCE."SettlementRecord"`,
  seller_reviews: `SELECT id, "orderId" AS order_id, "buyerId" AS buyer_id,
    "sellerId" AS seller_id, rating, "createdAt" AS created_at FROM SOURCE."SellerReview"`,
  order_events: `SELECT id, "orderId" AS order_id, "actorId" AS actor_id, operation,
    "fromState" AS from_state, "toState" AS to_state, "requestId" AS request_id,
    "createdAt" AS created_at FROM SOURCE."OrderEvent"`,
  idempotency_results: `SELECT "actorId" AS actor_id, operation, "resourceId" AS resource_id,
    "resultCode" AS result_code, "createdAt" AS created_at FROM SOURCE."IdempotencyRecord"`,
  sessions: `SELECT "accountId" AS account_id, "createdAt" AS created_at,
    "expiresAt" AS expires_at, "revokedAt" IS NOT NULL AS revoked FROM SOURCE."Session"`,
  rate_snapshots: `SELECT id, provider, "fetchedAt" AS fetched_at, "expiresAt" AS expires_at
    FROM SOURCE."RateSnapshot"`,
  migration_status: `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
    FROM SOURCE."_prisma_migrations"`
}

export async function grantObserver(client, sourceSchema, observeSchema, role) {
  const source = identifier(sourceSchema)
  const observe = identifier(observeSchema)
  const observer = identifier(role)
  await client.$transaction(async (tx) => {
    const roles = await tx.$queryRaw`
      SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = ${role}`
    const memberships = await tx.$queryRaw`
      SELECT granted.rolname
      FROM pg_roles member
      CROSS JOIN pg_roles granted
      WHERE member.rolname = ${role}
        AND member.oid <> granted.oid
        AND pg_has_role(member.oid, granted.oid, 'MEMBER')`
    const owners = await tx.$queryRaw`
      SELECT owner.rolname
      FROM pg_namespace namespace
      JOIN pg_roles owner ON owner.oid = namespace.nspowner
      WHERE namespace.nspname = ${observeSchema}`
    const current = await tx.$queryRaw`SELECT current_user`
    if (roles.length !== 1 || Object.values(roles[0]).some(Boolean) || memberships.length !== 0)
      throw new Error('Observer role must be unprivileged and without memberships')
    if (owners.length !== 1 || owners[0].rolname !== current[0].current_user)
      throw new Error('Observation schema must be owned by the migration role')

    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA ${source} FROM ${observer}`)
    await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA ${source} FROM ${observer}`)
    await tx.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${source} FROM ${observer}`)
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA ${observe} FROM PUBLIC, ${observer}`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${observe} TO ${observer}`)
    for (const [name, statement] of Object.entries(views)) {
      await tx.$executeRawUnsafe(
        `CREATE OR REPLACE VIEW ${observe}.${identifier(name)} WITH (security_barrier = true) AS ${statement.replaceAll('SOURCE', source)}`
      )
    }
    await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA ${observe} FROM PUBLIC, ${observer}`)
    await tx.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA ${observe} TO ${observer}`)
  })
}
