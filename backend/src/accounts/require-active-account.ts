import { DomainError } from '../common/domain-error.js'
import { type Transaction } from '../database/transaction.js'

export async function requireActiveAccount(tx: Transaction, actorId: string) {
  const actor = await tx.account.findUnique({ where: { id: actorId } })
  if (!actor || actor.status !== 'active') throw new DomainError('FORBIDDEN')
}
