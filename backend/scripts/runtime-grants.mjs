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
    'RateSnapshot'
  ]
  const mutable = [
    'Account',
    'Listing',
    'Order',
    'PhysicalInventory',
    'DigitalInventory',
    'InventoryReservation',
    'IssueRecord',
    'RefundRequest',
    'IdempotencyRecord',
    'Session'
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
      const permissions = mutable.includes(table) ? 'SELECT, INSERT, UPDATE' : 'SELECT, INSERT'
      await tx.$executeRawUnsafe(`GRANT ${permissions} ON "${schema}"."${table}" TO "${role}"`)
    }
    await tx.$executeRawUnsafe(`GRANT SELECT ON "${schema}"."AccountCredential" TO "${role}"`)
  })
}
