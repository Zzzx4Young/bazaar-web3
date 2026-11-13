import { transact } from '../database/transaction.js'
import { lockChain } from './escrow-projector.js'
import type { VerifiedRange } from './escrow-state.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Bytes32 } from './web3-types.js'
import {
  DualChainObserver,
  ChainVerificationError,
  unavailable,
  contradiction
} from './chain-observer.js'
import { EscrowProjector } from './escrow-projector.js'
import type { TransactionOptions } from '../database/transaction.js'
export class ChainIndexer {
  readonly projector: EscrowProjector
  constructor(
    readonly client: PrismaClient,
    readonly observer: DualChainObserver,
    readonly verifyPrivateBasis?: () => Promise<void>,
    readonly verifyResolutions?: (range: VerifiedRange) => Promise<() => Promise<void>>,
    readonly recoverRefunds?: () => Promise<unknown>
  ) {
    this.projector = new EscrowProjector(
      client,
      observer.config,
      observer.deployment,
      verifyResolutions
    )
  }
  async runOnce(options: TransactionOptions = {}) {
    const cursor = await this.client.scanCheckpoint.findUnique({
      where: { scope: this.projector.scope }
    })
    if (!cursor || cursor.configHash !== this.projector.configHash || cursor.status === 'isolated')
      return unavailable('index checkpoint missing, mismatched or isolated')
    try {
      if (this.verifyPrivateBasis) {
        try {
          await this.verifyPrivateBasis()
        } catch {
          await transact(this.client, async (tx) => {
            await lockChain(tx, this.projector.scope)
            await tx.scanCheckpoint.updateMany({
              where: { scope: this.projector.scope, status: 'active' },
              data: { status: 'recovering' }
            })
            const terms = await tx.paymentOrderTerms.findMany({
              select: { listingId: true, terms: true }
            })
            for (const row of terms) {
              const t = row.terms as { chainId: number; escrow: string }
              if (
                t.chainId === this.observer.config.chainId &&
                t.escrow === this.observer.config.escrow
              )
                await tx.testnetStock.updateMany({
                  where: { listingId: row.listingId },
                  data: { state: 'protected' }
                })
            }
          })
          return unavailable('independent issuance or private recovery basis unavailable')
        }
      }
      const head = await this.observer.readVerifiedSnapshot()
      if (BigInt(head.height) < cursor.height)
        return unavailable('finalized sources are behind accepted progress')
      if (cursor.height >= cursor.deploymentBlock) {
        const previous = await this.observer.atHeight(cursor.height.toString(), head)
        if (previous.hash !== cursor.hash) return contradiction('accepted finalized cursor changed')
      }
      if (BigInt(head.height) === cursor.height) {
        await this.observer.verifyDeployment(head)
        const guard = await this.verifyResolutions?.({
          from: (cursor.height + 1n).toString(),
          snapshot: head,
          blocks: [],
          events: [],
          orders: [],
          stocks: [],
          globals: cursor.globals as unknown as VerifiedRange['globals']
        })
        await transact(this.client, async (tx) => {
          await lockChain(tx, this.projector.scope)
          await guard?.()
          await tx.scanCheckpoint.updateMany({
            where: {
              scope: this.projector.scope,
              height: cursor.height,
              hash: cursor.hash,
              status: cursor.status,
              configHash: this.projector.configHash
            },
            data: { updatedAt: new Date() }
          })
        })
        await this.recoverRefunds?.()
        return { status: cursor.status, height: cursor.height.toString(), events: 0 }
      }
      const tracked: Bytes32[] = []
      let after: string | undefined
      for (;;) {
        const page = await this.client.escrowProjection.findMany({
          where: { scope: this.projector.scope },
          select: { chainOrderId: true },
          orderBy: { chainOrderId: 'asc' },
          take: 128,
          ...(after
            ? {
                cursor: {
                  scope_chainOrderId: { scope: this.projector.scope, chainOrderId: after }
                },
                skip: 1
              }
            : {})
        })
        if (!page.length) break
        tracked.push(...page.map((row) => row.chainOrderId as Bytes32))
        after = page[page.length - 1].chainOrderId
      }
      const range = await this.observer.scanAndVerify((cursor.height + 1n).toString(), tracked)
      const result = await this.projector.project(range, options)
      await this.recoverRefunds?.()
      return result
    } catch (e) {
      if (e instanceof ChainVerificationError && e.kind === 'contradiction') {
        const current = await this.client.scanCheckpoint.findUnique({
          where: { scope: this.projector.scope }
        })
        if (current?.status !== 'isolated')
          await this.projector.isolate(e.reason, {
            acceptedHeight: cursor.height.toString(),
            acceptedHash: cursor.hash,
            observed: e.evidence ?? null
          })
      }
      throw e
    }
  }
}
