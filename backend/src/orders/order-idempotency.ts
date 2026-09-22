import { createHash } from 'node:crypto'
import { DomainError } from '../common/domain-error.js'
import { type Transaction } from '../database/transaction.js'

// This record stores only order-command results. Other modules need their own result contracts.
export function requestHash(payload: object): string {
  // Payload is a server-built tuple/object with deterministic field ordering, not raw HTTP input.
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function idempotent(
  tx: Transaction,
  actorId: string,
  operation: string,
  key: string,
  payload: object,
  work: () => Promise<string>,
  allowAdminReplay = false
) {
  const hash = requestHash(payload)
  const inserted = await tx.$queryRaw<{ actorId: string }[]>`
    INSERT INTO "IdempotencyRecord" ("actorId", "operation", "key", "requestHash")
    VALUES (${actorId}::uuid, ${operation}, ${key}, ${hash})
    ON CONFLICT ("actorId", "operation", "key") DO NOTHING RETURNING "actorId"`
  if (inserted.length === 0) {
    // Separate statement: READ COMMITTED gets a new snapshot after the conflicting writer commits.
    const previous = await tx.idempotencyRecord.findUniqueOrThrow({
      where: { actorId_operation_key: { actorId, operation, key } }
    })
    if (previous.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT')
    if (!previous.resourceId || !previous.resultCode)
      throw new Error('Incomplete idempotency result')
    const resource = await tx.order.findUniqueOrThrow({ where: { id: previous.resourceId } })
    if (!allowAdminReplay && resource.buyerId !== actorId && resource.sellerId !== actorId)
      throw new DomainError('FORBIDDEN')
    return previous.resourceId
  }
  const resourceId = await work()
  await tx.idempotencyRecord.update({
    where: { actorId_operation_key: { actorId, operation, key } },
    data: { resourceId, resultCode: 'OK' }
  })
  return resourceId
}
