import type { PrismaClient } from '../generated/prisma/client.js'
export async function assertPrivateLedgerGrants(client: PrismaClient, publication = false) {
  const [role] = await client.$queryRaw<
    { privileged: boolean }[]
  >`SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) AS privileged FROM pg_roles r WHERE rolname=current_user`
  if (!role || role.privileged) throw new Error('Unsafe private ledger role')
  for (const table of ['PrivateLedgerMeta', 'PrivateLedgerEvent', ...(publication ? ['LedgerPublicationOutbox', 'LedgerPublicationReceipt'] : [])])
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const [row] = await client.$queryRaw<
        { granted: boolean }[]
      >`SELECT has_table_privilege(current_user,format('%I.%I',current_schema(),${table}::text),${p}::text) AS granted`
      if (row?.granted !== (p === 'SELECT' || (p === 'INSERT' && table !== 'PrivateLedgerMeta')))
        throw new Error('Unsafe private ledger privileges')
    }
}
