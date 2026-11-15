// Run explicitly as the independent ledger owner; never in business migrations.
export async function grantWalletLedger(client, schema, role) {
  for (const value of [schema, role])
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid SQL identifier')
  const permissions = {
    WalletLedgerMeta: 'SELECT', WalletLedgerAccount: 'SELECT, INSERT, UPDATE',
    WalletLedgerClaim: 'SELECT, INSERT', WalletLedgerReservation: 'SELECT, INSERT, DELETE',
    WalletLedgerOperation: 'SELECT, INSERT, UPDATE', WalletLedgerEvent: 'SELECT, INSERT',
    PaymentLedgerIntent: 'SELECT, INSERT', PaymentLedgerHead: 'SELECT, INSERT, UPDATE',
    PaymentLedgerResolution: 'SELECT, INSERT', PaymentLedgerRefundExit: 'SELECT, INSERT'
  }
  await client.$transaction(async tx => {
    const rows = await tx.$queryRaw`
      SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
        pg_has_role(r.oid, n.nspowner, 'MEMBER') AS owns_schema,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS has_membership,
        EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = n.oid AND relowner = r.oid) AS owns_table
      FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname = ${role} AND n.nspname = ${schema}`
    if (rows.length !== 1 || Object.values(rows[0]).some(Boolean))
      throw new Error('Ledger runtime must be unprivileged without ownership or memberships')
    await tx.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC, "${role}"`)
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
    // Additive refund upgrades also support legacy ledgers without publication.
    // Installing publication tables is a separate owner action, never runtime DDL.
    const [publication] = await tx.$queryRaw`SELECT count(*)::integer AS count FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema}
      AND c.relname IN ('LedgerPublicationOutbox','LedgerPublicationReceipt')`
    if (publication.count !== 0 && publication.count !== 2) throw new Error('Incomplete publication schema')
    const effective = { ...permissions, ...(publication.count === 2 ? {
      LedgerPublicationOutbox: 'SELECT, INSERT', LedgerPublicationReceipt: 'SELECT, INSERT'
    } : {}) }
    for (const [table, grants] of Object.entries(effective)) {
      await tx.$executeRawUnsafe(`REVOKE ALL ON "${schema}"."${table}" FROM PUBLIC, "${role}"`)
      await tx.$executeRawUnsafe(`GRANT ${grants} ON "${schema}"."${table}" TO "${role}"`)
    }
    // Table ACLs do not erase inherited/column privileges. Verify effective access.
    const [exit] = await tx.$queryRaw`
      SELECT has_table_privilege(${role}, c.oid, 'SELECT') AS can_select,
        has_table_privilege(${role}, c.oid, 'INSERT') AS can_insert,
        has_table_privilege(${role}, c.oid, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS can_rewrite,
        has_any_column_privilege(${role}, c.oid, 'UPDATE,REFERENCES') AS column_rewrite
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = 'PaymentLedgerRefundExit'`
    if (!exit?.can_select || !exit.can_insert || exit.can_rewrite || exit.column_rewrite)
      throw new Error('Refund ledger runtime must have SELECT and INSERT only')
  })
}
