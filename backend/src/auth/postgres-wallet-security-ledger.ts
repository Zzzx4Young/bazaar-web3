import { isDeepStrictEqual } from 'node:util'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { normalizeWalletAddress } from '../web3/web3-policy.js'
import type { EvmAddress } from '../web3/web3-types.js'
import type { WalletSecurityChange, WalletSecurityLedger, WalletSecuritySnapshot } from './wallet-security-ledger.js'

type Head = Omit<WalletSecuritySnapshot, 'recoveryEpoch'>
type Operation = { id: string; accountId: string; chainId: number; change: WalletSecurityChange;
  status: 'prepared' | 'committed' | 'aborted'; result: WalletSecuritySnapshot | null }

export class PostgresWalletSecurityLedger implements WalletSecurityLedger {
  constructor(private readonly client: PrismaClient, private readonly expectedLedgerId: string) {}

  private async available<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try { return await this.client.$transaction(work) }
    catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }

  private async epoch(tx: Transaction) {
    const [meta] = await tx.$queryRaw<{ ledgerId: string; recoveryEpoch: string; maintenance: boolean }[]>`
      SELECT "ledgerId", "recoveryEpoch", "maintenance" FROM "WalletLedgerMeta"
      WHERE "singleton" = true FOR SHARE`
    if (!meta || meta.ledgerId !== this.expectedLedgerId || meta.maintenance)
      throw new DomainError('WALLET_UNAVAILABLE')
    return meta.recoveryEpoch
  }

  private async lock(tx: Transaction, key: string) {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  }

  private async head(tx: Transaction, accountId: string, chainId: number): Promise<Head> {
    const [row] = await tx.$queryRaw<Head[]>`SELECT "accountId", "chainId", "address", "bindingVersion",
      "revision"::text AS "revision", "payout", "pendingOperationId" FROM "WalletLedgerAccount"
      WHERE "accountId" = ${accountId}::uuid AND "chainId" = ${chainId}`
    return row ?? { accountId, chainId, address: null, bindingVersion: 0,
      revision: '0', payout: null, pendingOperationId: null }
  }

  async recoveryEpoch() { return this.available((tx) => this.epoch(tx)) }

  async read(accountId: string, chainId: number): Promise<WalletSecuritySnapshot> {
    return this.available(async (tx) => {
      const recoveryEpoch = await this.epoch(tx)
      await this.lock(tx, `account:${chainId}:${accountId}`)
      return { ...await this.head(tx, accountId, chainId), recoveryEpoch }
    })
  }

  async assertProjection(projection: Pick<WalletSecuritySnapshot,
    'accountId' | 'chainId' | 'address' | 'bindingVersion' | 'revision'>) {
    const current = await this.read(projection.accountId, projection.chainId)
    if (current.pendingOperationId || current.address !== projection.address ||
      current.bindingVersion !== projection.bindingVersion || current.revision !== projection.revision)
      throw new DomainError('WALLET_UNAVAILABLE')
    return current
  }

  private async owner(tx: Transaction, chainId: number, address: EvmAddress) {
    const rows = await tx.$queryRaw<{ accountId: string }[]>`
      SELECT "accountId" FROM "WalletLedgerClaim" WHERE "chainId" = ${chainId} AND "address" = ${address}
      UNION SELECT "accountId" FROM "WalletLedgerReservation" WHERE "chainId" = ${chainId} AND "address" = ${address}`
    if (rows.length > 1) throw new DomainError('WALLET_UNAVAILABLE')
    return rows[0]?.accountId ?? null
  }

  async claimOwner(chainId: number, address: EvmAddress) {
    return this.available(async (tx) => {
      await this.epoch(tx)
      return this.owner(tx, chainId, normalizeWalletAddress(address))
    })
  }

  private async operation(tx: Transaction, id: string) {
    const [op] = await tx.$queryRaw<Operation[]>`SELECT * FROM "WalletLedgerOperation" WHERE "id" = ${id}::uuid`
    return op
  }

  async prepare(input: WalletSecurityChange): Promise<WalletSecuritySnapshot> {
    if (![11155111, 31337].includes(input.chainId) ||
      !/^(0|[1-9][0-9]{0,18})$/.test(input.expectedRevision) ||
      !Number.isSafeInteger(input.expectedBindingVersion) || input.expectedBindingVersion < 0)
      throw new DomainError('INVALID_INPUT')
    const change: WalletSecurityChange = { ...input,
      address: input.address === null ? null : normalizeWalletAddress(input.address) }
    if (!['bind', 'unbind', 'payout'].includes(change.operation) ||
      (change.operation === 'bind' && !change.address) ||
      (change.operation === 'unbind' && change.address)) throw new DomainError('INVALID_INPUT')
    return this.available(async (tx) => {
      const recoveryEpoch = await this.epoch(tx)
      await this.lock(tx, `account:${change.chainId}:${change.accountId}`)
      const prior = await this.operation(tx, change.operationId)
      if (prior) {
        // JSONB has no property ordering, so compare complete canonical data.
        if (!isDeepStrictEqual(prior.change, change) || prior.status === 'aborted')
          throw new DomainError('IDEMPOTENCY_CONFLICT')
        if (prior.status === 'committed' && prior.result) return prior.result
        return { ...await this.head(tx, change.accountId, change.chainId), recoveryEpoch }
      }
      const state = await this.head(tx, change.accountId, change.chainId)
      if (state.pendingOperationId) throw new DomainError('WALLET_UNAVAILABLE')
      if (state.revision !== change.expectedRevision || state.bindingVersion !== change.expectedBindingVersion)
        throw new DomainError('STATE_CONFLICT')
      if (change.operation === 'payout' && (!change.payout || change.address !== state.address ||
        change.payout.wallet !== state.address)) throw new DomainError('STATE_CONFLICT')
      if (change.address) {
        await this.lock(tx, `wallet:${change.chainId}:${change.address}`)
        const owner = await this.owner(tx, change.chainId, change.address)
        if (owner && owner !== change.accountId) throw new DomainError('ACCOUNT_LINK_REQUIRED')
      }
      await tx.$executeRaw`INSERT INTO "WalletLedgerAccount" ("accountId", "chainId")
        VALUES (${change.accountId}::uuid, ${change.chainId}) ON CONFLICT DO NOTHING`
      await tx.$executeRaw`INSERT INTO "WalletLedgerOperation" ("id", "accountId", "chainId", "change", "status")
        VALUES (${change.operationId}::uuid, ${change.accountId}::uuid, ${change.chainId},
        ${JSON.stringify(change)}::jsonb, 'prepared')`
      if (change.address)
        await tx.$executeRaw`INSERT INTO "WalletLedgerReservation" ("chainId", "address", "accountId", "operationId")
          VALUES (${change.chainId}, ${change.address}, ${change.accountId}::uuid, ${change.operationId}::uuid)`
      await tx.$executeRaw`UPDATE "WalletLedgerAccount" SET "pendingOperationId" = ${change.operationId}::uuid
        WHERE "accountId" = ${change.accountId}::uuid AND "chainId" = ${change.chainId}`
      await tx.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId", "phase", "payload")
        VALUES (${change.operationId}::uuid, 'prepared', ${JSON.stringify(change)}::jsonb)`
      return { ...state, pendingOperationId: change.operationId, recoveryEpoch }
    })
  }

  private async finish(operationId: string, commit: boolean): Promise<WalletSecuritySnapshot> {
    return this.available(async (tx) => {
      const recoveryEpoch = await this.epoch(tx)
      const op = await this.operation(tx, operationId)
      if (!op) throw new DomainError('NOT_FOUND')
      await this.lock(tx, `account:${op.chainId}:${op.accountId}`)
      const currentOp = (await this.operation(tx, operationId))!
      if (currentOp.status === 'committed') {
        if (!commit || !currentOp.result) throw new DomainError('STATE_CONFLICT')
        return currentOp.result
      }
      const state = await this.head(tx, op.accountId, op.chainId)
      if (currentOp.status === 'aborted') {
        if (commit) throw new DomainError('STATE_CONFLICT')
        return { ...state, recoveryEpoch }
      }
      if (state.pendingOperationId !== operationId || state.revision !== op.change.expectedRevision)
        throw new DomainError('WALLET_UNAVAILABLE')
      const c = currentOp.change
      if (c.address) await this.lock(tx, `wallet:${c.chainId}:${c.address}`)
      const result: WalletSecuritySnapshot = commit ? { ...state,
        address: c.address, revision: (BigInt(state.revision) + 1n).toString(),
        bindingVersion: state.bindingVersion + (c.operation === 'payout' ? 0 : 1),
        payout: c.operation === 'payout' ? c.payout : null, pendingOperationId: null, recoveryEpoch
      } : { ...state, pendingOperationId: null, recoveryEpoch }
      if (commit && c.address) {
        const owner = await this.owner(tx, c.chainId, c.address)
        if (owner && owner !== c.accountId) throw new DomainError('WALLET_UNAVAILABLE')
        await tx.$executeRaw`INSERT INTO "WalletLedgerClaim" ("chainId", "address", "accountId", "operationId")
          VALUES (${c.chainId}, ${c.address}, ${c.accountId}::uuid, ${operationId}::uuid) ON CONFLICT DO NOTHING`
      }
      await tx.$executeRaw`UPDATE "WalletLedgerAccount" SET "address" = ${result.address},
        "bindingVersion" = ${result.bindingVersion}, "revision" = ${BigInt(result.revision)},
        "payout" = ${JSON.stringify(result.payout)}::jsonb, "pendingOperationId" = NULL
        WHERE "accountId" = ${op.accountId}::uuid AND "chainId" = ${op.chainId}`
      const status = commit ? 'committed' : 'aborted'
      await tx.$executeRaw`UPDATE "WalletLedgerOperation" SET "status" = ${status},
        "result" = ${JSON.stringify(result)}::jsonb WHERE "id" = ${operationId}::uuid`
      await tx.$executeRaw`DELETE FROM "WalletLedgerReservation" WHERE "operationId" = ${operationId}::uuid`
      await tx.$executeRaw`INSERT INTO "WalletLedgerEvent" ("operationId", "phase", "payload")
        VALUES (${operationId}::uuid, ${status}, ${JSON.stringify(result)}::jsonb)`
      return result
    })
  }

  async commit(operationId: string) { return this.finish(operationId, true) }
  async abort(operationId: string) { await this.finish(operationId, false) }
}
