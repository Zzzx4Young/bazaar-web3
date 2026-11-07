// Run explicitly as the independent ledger owner; never in business migrations.
export async function grantWalletLedger(client, schema, role) {
  for (const value of [schema, role])
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid SQL identifier')
  const permissions = {
    WalletLedgerMeta: 'SELECT', WalletLedgerAccount: 'SELECT, INSERT, UPDATE',
    WalletLedgerClaim: 'SELECT, INSERT', WalletLedgerReservation: 'SELECT, INSERT, DELETE',
    WalletLedgerOperation: 'SELECT, INSERT, UPDATE', WalletLedgerEvent: 'SELECT, INSERT'
  }
  await client.$transaction(async tx => {
    const rows = await tx.$queryRaw`
      SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
        pg_has_role(r.oid, n.nspowner, 'MEMBER') AS owns_schema,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS has_membership
      FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname = ${role} AND n.nspname = ${schema}`
    if (rows.length !== 1 || Object.values(rows[0]).some(Boolean))
      throw new Error('Ledger runtime must be unprivileged without ownership or memberships')
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC, "${role}"`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    for (const [table, grants] of Object.entries(permissions)) {
      await tx.$executeRawUnsafe(`REVOKE ALL ON "${schema}"."${table}" FROM PUBLIC, "${role}"`)
      await tx.$executeRawUnsafe(`GRANT ${grants} ON "${schema}"."${table}" TO "${role}"`)
    }
  })
}
