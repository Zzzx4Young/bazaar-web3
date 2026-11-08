import { createHash } from 'node:crypto'
import type { PrismaClient, Prisma, TransactionAttempt } from '../generated/prisma/client.js'
import type { AuthService, Authenticated } from '../auth/auth.service.js'
import { DomainError } from '../common/domain-error.js'
import { transact, type Transaction } from '../database/transaction.js'
import { chainScope, lockChain } from './escrow-projector.js'
import { stable, type DualChainObserver } from './chain-observer.js'
export interface AttemptObservation {
  status: 'unknown' | 'included' | 'reverted' | 'finalized'
  sender?: string
  nonce?: string
  blockHash?: string
  height?: string
  transactionSucceeded?: boolean
  businessConfirmation: false
  orphanedBlockHash?: string
}
const json = (v: unknown) => JSON.parse(stable(v)) as Prisma.InputJsonValue
function publicAttempt(row: TransactionAttempt) {
  let observation: Record<string, unknown> | null = null
  if (row.observation && typeof row.observation === 'object' && !Array.isArray(row.observation)) {
    const raw = row.observation as Record<string, unknown>
    observation = { businessConfirmation: false }
    for (const key of ['blockHash', 'orphanedBlockHash'])
      if (typeof raw[key] === 'string' && /^0x[0-9a-f]{64}$/.test(raw[key]))
        observation[key] = raw[key]
    if (typeof raw.sender === 'string' && /^0x[0-9a-f]{40}$/.test(raw.sender))
      observation.sender = raw.sender
    for (const key of ['nonce', 'height'])
      if (typeof raw[key] === 'string' && /^[0-9]{1,78}$/.test(raw[key]))
        observation[key] = raw[key]
    if (typeof raw.transactionSucceeded === 'boolean')
      observation.transactionSucceeded = raw.transactionSucceeded
    const snapshot = raw.snapshot as { height?: unknown; hash?: unknown } | undefined
    if (
      snapshot &&
      typeof snapshot.height === 'string' &&
      /^[0-9]{1,78}$/.test(snapshot.height) &&
      typeof snapshot.hash === 'string' &&
      /^0x[0-9a-f]{64}$/.test(snapshot.hash)
    )
      observation.finalizedSnapshot = { height: snapshot.height, hash: snapshot.hash }
  }
  return {
    id: row.id,
    orderId: row.orderId,
    txHash: row.txHash,
    status: row.status,
    createdAt: row.createdAt,
    observation
  }
}
export class TransactionAttemptService {
  readonly scope: string
  constructor(
    readonly client: PrismaClient,
    readonly auth: AuthService,
    readonly observer: Pick<DualChainObserver, 'config' | 'observeTransaction'>
  ) {
    this.scope = chainScope(observer.config)
  }
  private async authorize(tx: Transaction, user: Authenticated, orderId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${user.account.id}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT "tokenHash" FROM "Session" WHERE "tokenHash"=${user.tokenHash} FOR UPDATE`
    const current = await this.auth.authenticate('bazaar_session=' + user.token)
    const o = await tx.order.findUnique({ where: { id: orderId } })
    if (
      current.account.id !== user.account.id ||
      !o ||
      ![o.buyerId, o.sellerId].includes(current.account.id)
    )
      throw new DomainError('NOT_FOUND')
    if (o.settlementMode !== 'testnet_escrow') throw new DomainError('STATE_CONFLICT')
  }
  async reportAttempt(user: Authenticated, orderId: string, txHash: string, key: string) {
    if (
      !/^0x[0-9a-fA-F]{64}$/.test(txHash) ||
      typeof key !== 'string' ||
      key.length < 1 ||
      key.length > 100
    )
      throw new DomainError('INVALID_INPUT')
    txHash = txHash.toLowerCase()
    const requestHash = createHash('sha256')
      .update(stable({ orderId, txHash, scope: this.scope }))
      .digest('hex')
    const result = await transact(this.client, async (tx) => {
      await this.authorize(tx, user, orderId)
      const prior = await tx.transactionAttempt.findUnique({
        where: { actorId_key: { actorId: user.account.id, key } }
      })
      if (prior) {
        if (prior.requestHash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT')
        return prior
      }
      if (
        (await tx.transactionAttempt.count({ where: { actorId: user.account.id, orderId } })) >= 32
      )
        throw new DomainError('RATE_LIMITED')
      return tx.transactionAttempt.create({
        data: { scope: this.scope, actorId: user.account.id, orderId, key, txHash, requestHash }
      })
    })
    return publicAttempt(result)
  }
  async refreshAttempt(user: Authenticated, id: string) {
    const current = await this.auth.authenticate('bazaar_session=' + user.token)
    const hint = await this.client.transactionAttempt.findUnique({ where: { id } })
    if (!hint || hint.actorId !== current.account.id || hint.scope !== this.scope)
      throw new DomainError('NOT_FOUND')
    const observation = await this.observer.observeTransaction(
      hint.txHash as `0x${string}`,
      (hint.observation as AttemptObservation | null) ?? undefined
    )
    const result = await transact(this.client, async (tx) => {
      await lockChain(tx, this.scope)
      await this.authorize(tx, user, hint.orderId)
      const old = await tx.transactionAttempt.findUniqueOrThrow({ where: { id } })
      if (old.status === 'finalized') return old
      const previous = old.observation as AttemptObservation | null
      if (
        previous?.blockHash &&
        ((observation.blockHash && previous.blockHash !== observation.blockHash) ||
          observation.orphanedBlockHash === previous.blockHash)
      ) {
        await tx.chainObservation.updateMany({
          where: {
            scope: this.scope,
            txHash: hint.txHash,
            blockHash: previous.blockHash,
            status: 'canonical_tentative'
          },
          data: { status: 'orphaned' }
        })
        await tx.reconciliationIncident.create({
          data: {
            scope: this.scope,
            kind: 'tentative_reorg',
            reason: 'unfinalized observation replaced; money projection unchanged',
            evidence: json({
              txHash: hint.txHash,
              oldBlock: previous.blockHash,
              newBlock: observation.blockHash ?? null
            })
          }
        })
      }
      if (observation.blockHash)
        await tx.chainObservation.create({
          data: {
            scope: this.scope,
            txHash: hint.txHash,
            blockHash: observation.blockHash,
            status: observation.status === 'finalized' ? 'finalized' : 'canonical_tentative',
            evidence: json(observation)
          }
        })
      if (
        ['included', 'reverted', 'finalized'].includes(observation.status) &&
        observation.sender &&
        observation.nonce
      ) {
        const siblings = await tx.transactionAttempt.findMany({
          where: {
            scope: this.scope,
            orderId: hint.orderId,
            NOT: { id },
            status: { in: ['submitted', 'unknown', 'included', 'reverted'] }
          },
          take: 32
        })
        for (const prior of siblings) {
          const p = prior.observation as AttemptObservation | null
          if (p?.sender === observation.sender && p?.nonce === observation.nonce)
            await tx.transactionAttempt.update({
              where: { id: prior.id },
              data: { status: 'replaced' }
            })
        }
      }
      return tx.transactionAttempt.update({
        where: { id },
        data: { status: observation.status, observation: json(observation) }
      })
    })
    return publicAttempt(result)
  }
}
