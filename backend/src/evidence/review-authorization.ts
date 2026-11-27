import { DomainError } from '../common/domain-error.js'
import type { Transaction } from '../database/transaction.js'

// Provisioning belongs to the deployment owner. Application callers cannot
// create, extend or broaden a review scope through evidence APIs.
export async function requireReviewAuthorization(
  tx: Transaction,
  orderId: string,
  accountId: string
) {
  const account = await tx.account.findUnique({ where: { id: accountId } })
  if (account?.status !== 'active' || account.role !== 'admin') throw new DomainError('FORBIDDEN')
  const scope = await tx.reviewAuthorization.findFirst({
    where: { orderId, accountId, expiresAt: { gt: new Date() } },
    orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }]
  })
  if (!scope) throw new DomainError('FORBIDDEN')
  return scope
}
