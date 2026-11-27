import type { PrismaClient } from '../generated/prisma/client.js'
export async function assertPrivateLedgerGrants(client: PrismaClient, publication = false) {
  const [role] = await client.$queryRaw<
    { privileged: boolean }[]
  >`SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) AS privileged FROM pg_roles r WHERE rolname=current_user`
  if (!role || role.privileged) throw new Error('Unsafe private ledger role')
  for (const table of [
    'PrivateLedgerMeta',
    'PrivateLedgerEvent',
    ...(publication ? ['LedgerPublicationOutbox', 'LedgerPublicationReceipt'] : [])
  ])
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const [row] = await client.$queryRaw<
        { granted: boolean }[]
      >`SELECT has_table_privilege(current_user,format('%I.%I',current_schema(),${table}::text),${p}::text) AS granted`
      if (row?.granted !== (p === 'SELECT' || (p === 'INSERT' && table !== 'PrivateLedgerMeta')))
        throw new Error('Unsafe private ledger privileges')
    }
  // Legacy (unpublished) witnesses also inspect an installed publication fence
  // to prevent silent downgrade after enrollment.
  const [dependency] = await client.$queryRaw<
    { installed: boolean }[]
  >`SELECT to_regclass(format('%I.%I',current_schema(),'LedgerPublicationFence')) IS NOT NULL AS installed`
  if (publication || dependency?.installed) {
    const [fence] = await client.$queryRaw<
      { readable: boolean; mutable: boolean }[]
    >`SELECT has_sequence_privilege(current_user,format('%I.%I',current_schema(),'LedgerPublicationFence'),'SELECT') AS readable,has_sequence_privilege(current_user,format('%I.%I',current_schema(),'LedgerPublicationFence'),'USAGE,UPDATE') AS mutable`
    if (!fence?.readable || fence.mutable) throw new Error('Unsafe publication fence privileges')
  }
}
