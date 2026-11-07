import type { PrismaClient } from '../generated/prisma/client.js'

export async function assertWalletLedgerGrants(client: PrismaClient) {
  const allowed: Record<string, string[]> = {
    WalletLedgerMeta: ['SELECT'], WalletLedgerAccount: ['SELECT', 'INSERT', 'UPDATE'],
    WalletLedgerClaim: ['SELECT', 'INSERT'], WalletLedgerReservation: ['SELECT', 'INSERT', 'DELETE'],
    WalletLedgerOperation: ['SELECT', 'INSERT', 'UPDATE'], WalletLedgerEvent: ['SELECT', 'INSERT'],
    PaymentLedgerIntent: ['SELECT', 'INSERT'], PaymentLedgerHead: ['SELECT', 'INSERT', 'UPDATE'],
    PaymentLedgerResolution: ['SELECT', 'INSERT']
  }
  const [role] = await client.$queryRaw<{ privileged: boolean }[]>`
    SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)) AS privileged
    FROM pg_roles r WHERE rolname = current_user`
  if (!role || role.privileged) throw new Error('Unsafe wallet ledger privileges')
  for (const [table, permissions] of Object.entries(allowed)) {
    for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const [row] = await client.$queryRaw<{ granted: boolean }[]>`
        SELECT has_table_privilege(current_user, format('%I.%I', current_schema(), ${table}::text), ${permission}::text) AS granted`
      if (row?.granted !== permissions.includes(permission)) throw new Error('Unsafe wallet ledger privileges')
    }
  }
}
