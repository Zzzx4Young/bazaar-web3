import { DomainError } from '../common/domain-error.js'
import { type Transaction } from '../database/transaction.js'

export async function requireActiveAccount(
  tx: Transaction,
  actorId: string,
  role: 'participant' | 'admin' = 'participant'
) {
  const actor = await tx.account.findUnique({ where: { id: actorId } })
  if (!actor || actor.status !== 'active' || actor.role !== role)
    throw new DomainError('FORBIDDEN')
  return actor
}
