import { randomBytes, randomUUID } from 'node:crypto'
import { keccak256, stringToHex } from 'viem'
import type { Order, PrismaClient, Prisma } from '../generated/prisma/client.js'
import { AuthService, type Authenticated } from '../auth/auth.service.js'
import type { WalletSecurityLedger } from '../auth/wallet-security-ledger.js'
import { DomainError } from '../common/domain-error.js'
import { transact, type Transaction, type TransactionOptions } from '../database/transaction.js'
import { OrderCommands, type CreateOrderInput } from '../orders/order-commands.js'
import { requestHash } from '../orders/order-idempotency.js'
import { SellerPayoutService } from './seller-payout.service.js'
import { orderTerms, web3Policy } from './web3-policy.js'
import type { Bytes32, EvmAddress, OrderTerms, PaymentPermit, Web3Config } from './web3-types.js'
import {
  paymentDigest,
  paymentTypedData,
  orderTermsDigest,
  type PaymentSigner
} from './payment-signer.js'
import type { IssuanceRecord, PaymentJournal } from './payment-journal.js'
import type { PaymentChainObserver, VerifiedIntentState } from './payment-observer.js'

const zero = ('0x' + '0'.repeat(64)) as Bytes32
const randomHash = () => ('0x' + randomBytes(32).toString('hex')) as Bytes32
const identifier = (kind: string, id: string) => keccak256(stringToHex(`bazaar:${kind}:${id}`))
const json = (v: unknown) => v as Prisma.InputJsonValue
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
      .join(',') +
    '}'
  )
}

// No RPC, signature, or client tuple is allowed to create/replace an order snapshot.
export class PaymentIntentService {
  constructor(
    private readonly client: PrismaClient,
    private readonly auth: AuthService,
    private readonly payout: SellerPayoutService,
    private readonly wallets: WalletSecurityLedger,
    private readonly journal: PaymentJournal,
    private readonly signer: PaymentSigner,
    private readonly observer: PaymentChainObserver | null,
    private readonly config: Web3Config,
    private readonly assertEoa: (wallet: EvmAddress) => Promise<void>,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async authenticated(auth: Authenticated) {
    const current = await this.auth.authenticate('bazaar_session=' + auth.token)
    if (current.account.id !== auth.account.id || current.account.role !== 'participant')
      throw new DomainError('FORBIDDEN')
    return current
  }
  private async session(tx: Transaction, auth: Authenticated) {
    await tx.$queryRaw`SELECT "tokenHash" FROM "Session" WHERE "tokenHash" = ${auth.tokenHash} FOR UPDATE`
    const s = await tx.session.findUnique({ where: { tokenHash: auth.tokenHash } })
    const account = await tx.account.findUnique({where:{id:auth.account.id}})
    if (!s || s.revokedAt || s.expiresAt <= new Date() || s.accountId !== auth.account.id ||
      account?.status !== 'active' || account.role !== 'participant' ||
      s.recoveryEpoch !== await this.wallets.recoveryEpoch())
      throw new DomainError('UNAUTHENTICATED')
    if (s.authMethod === 'wallet_siwe') {
      const identity = await tx.walletIdentity.findUnique({where:{accountId_chainId:{
        accountId:auth.account.id,chainId:this.config.chainId}}})
      const trusted = await this.wallets.assertProjection({accountId:auth.account.id,chainId:this.config.chainId,
        address:identity?.address as EvmAddress ?? null,bindingVersion:identity?.bindingVersion??0,
        revision:String(identity?.securityRevision??0)})
      if (s.walletChainId !== this.config.chainId || s.walletAddress !== trusted.address ||
        s.walletBindingVersion !== trusted.bindingVersion) throw new DomainError('UNAUTHENTICATED')
    }
  }
  private async lockOrder(tx: Transaction, auth: Authenticated, orderId: string) {
    const hint = await tx.order.findUnique({ where: { id: orderId } })
    if (!hint || hint.buyerId !== auth.account.id) throw new DomainError('NOT_FOUND')
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${auth.account.id}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT "id" FROM "Listing" WHERE "id" = ${hint.listingId}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
    await this.session(tx, auth)
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
    if (order.settlementMode !== 'testnet_escrow') throw new DomainError('STATE_CONFLICT')
    return order
  }
  private async append(
    tx: Transaction,
    orderId: string,
    terms: OrderTerms,
    previousIntentId: string | null
  ) {
    const id = randomUUID(),
      issuedAt = Math.floor(this.now().getTime() / 1000)
    const permit: PaymentPermit = {
      ...terms,
      schemaVersion: 1,
      intentId: identifier('intent', id),
      issuedAt,
      payDeadline: issuedAt + web3Policy.paymentSeconds,
      signerKeyId: this.signer.keyId
    }
    await tx.paymentIntent.create({
      data: { id, orderId, previousIntentId, permit: json(permit), digest: paymentDigest(permit) }
    })
    await tx.paymentIntentState.create({ data: { intentId: id, orderId } })
    return id
  }
  private async reserve(tx: Transaction, order: Order, auth: Authenticated) {
    await this.session(tx, auth)
    const snapshot = await tx.testnetOrderSnapshot.findUnique({ where: { orderId: order.id } })
    const contents = await tx.orderSnapshot.findUnique({ where: { orderId: order.id } })
    if (!snapshot || !contents) throw new DomainError('WALLET_UNAVAILABLE')
    const identity = await tx.walletIdentity.findUnique({
      where: { accountId_chainId: { accountId: order.buyerId, chainId: this.config.chainId } }
    })
    const trusted = await this.wallets.assertProjection({
      accountId: order.buyerId,
      chainId: this.config.chainId,
      address: (identity?.address as EvmAddress) ?? null,
      bindingVersion: identity?.bindingVersion ?? 0,
      revision: String(identity?.securityRevision ?? 0)
    })
    if (!trusted.address) throw new DomainError('STATE_CONFLICT')
    const stock = await tx.testnetStock.findUnique({ where: { listingId: order.listingId } })
    if (stock && (stock.activeOrderId || stock.state !== 'free'))
      throw new DomainError('INVENTORY_CONFLICT')
    const stockId = (stock?.stockId as Bytes32) ?? randomHash()
    const terms = orderTerms({
      orderId: identifier('order', order.id),
      stockId,
      stockGeneration: stock?.generation ?? '0',
      previousOrderId: (stock?.previousOrderId as Bytes32) ?? zero,
      chainId: snapshot.chainId,
      escrow: snapshot.escrow as EvmAddress,
      token: snapshot.token as EvmAddress,
      amountAtoms: snapshot.amountAtoms,
      buyer: trusted.address,
      refundAddress: trusted.address,
      seller: snapshot.sellerWallet as EvmAddress,
      commitmentHash: keccak256(stringToHex(canonical(contents)))
    })
    if (
      terms.chainId !== this.config.chainId ||
      terms.escrow !== this.config.escrow ||
      terms.token !== this.config.token
    )
      throw new DomainError('WALLET_UNAVAILABLE')
    // A released reservation retains the predecessor for independent journal continuity.
    const predecessor = stock
      ? await tx.paymentIntent.findFirst({
          where: { orderId: stock.lastOrderId ?? '' },
          orderBy: { createdAt: 'desc' }
        })
      : null
    const id = await this.append(tx, order.id, terms, predecessor?.id ?? null)
    await tx.paymentOrderTerms.create({
      data: {
        orderId: order.id,
        listingId: order.listingId,
        stockId,
        terms: json(terms),
        termsHash: orderTermsDigest(terms),
        recoveryEpoch: trusted.recoveryEpoch,
        initialIntentId: id
      }
    })
    await tx.testnetStock.upsert({
      where: { listingId: order.listingId },
      create: {
        listingId: order.listingId,
        stockId,
        generation: terms.stockGeneration,
        previousOrderId: terms.previousOrderId,
        activeOrderId: order.id,
        lastOrderId: order.id
      },
      update: { activeOrderId: order.id, lastOrderId: order.id, state: 'reserved' }
    })
  }
  async createOrder(
    auth: Authenticated,
    key: string,
    input: CreateOrderInput,
    options: TransactionOptions = {}
  ) {
    auth = await this.authenticated(auth)
    const commands = new OrderCommands(this.client, this.payout, (tx, o) =>
      this.reserve(tx, o, auth)
    )
    const orderId = await commands.create(
      auth.account.id,
      key,
      { ...input, settlementMode: 'testnet_escrow' },
      options
    )
    const terms = await this.client.paymentOrderTerms.findUnique({ where: { orderId } })
    if (!terms) throw new DomainError('WALLET_UNAVAILABLE')
    return this.read(auth, terms.initialIntentId)
  }
  private async record(tx: Transaction, id: string): Promise<IssuanceRecord> {
    const i = await tx.paymentIntent.findUnique({ where: { id } })
    if (!i) throw new DomainError('NOT_FOUND')
    const t = await tx.paymentOrderTerms.findUnique({ where: { orderId: i.orderId } })
    const snap = await tx.testnetOrderSnapshot.findUnique({ where: { orderId: i.orderId } })
    const stock = t ? await tx.testnetStock.findUnique({ where: { listingId: t.listingId } }) : null
    if (!t || !snap || !stock || stock.stockId !== t.stockId)
      throw new DomainError('WALLET_UNAVAILABLE')
    const p = i.permit as unknown as PaymentPermit,
      terms = t.terms as unknown as OrderTerms
    if (
      paymentDigest(p) !== i.digest ||
      canonical(orderTerms(p)) !== canonical(orderTerms(terms)) ||
      orderTermsDigest(terms) !== t.termsHash ||
      terms.orderId !== identifier('order', i.orderId) ||
      p.intentId !== identifier('intent', i.id) ||
      p.schemaVersion !== 1 ||
      !Number.isSafeInteger(p.issuedAt) ||
      p.issuedAt <= 0 ||
      !Number.isSafeInteger(p.payDeadline) ||
      !/^0x[0-9a-f]{64}$/.test(p.signerKeyId) ||
      p.payDeadline !== p.issuedAt + web3Policy.paymentSeconds ||
      p.chainId !== this.config.chainId ||
      p.escrow !== this.config.escrow ||
      p.token !== this.config.token ||
      p.amountAtoms !== snap.amountAtoms ||
      p.seller !== snap.sellerWallet ||
      p.stockId !== stock.stockId ||
      p.stockGeneration !== stock.generation ||
      p.previousOrderId !== stock.previousOrderId ||
      (await this.wallets.recoveryEpoch()) !== t.recoveryEpoch
    )
      throw new DomainError('WALLET_UNAVAILABLE')
    return {
      id: i.id,
      orderId: i.orderId,
      listingId: t.listingId,
      stockId: t.stockId,
      scope: `${p.chainId}:${p.escrow}`,
      digest: i.digest,
      termsHash: t.termsHash,
      recoveryEpoch: t.recoveryEpoch,
      permit: p,
      previousIntentId: i.previousIntentId
    }
  }
  async read(auth: Authenticated, id: string) {
    auth = await this.authenticated(auth)
    const original = await this.client.paymentIntent.findUnique({ where: { id } })
    if (!original) throw new DomainError('NOT_FOUND')
    const loaded = await transact(this.client, async (tx) => {
      await this.lockOrder(tx, auth, original.orderId)
      const r = await this.record(tx, id),
        state = await tx.paymentIntentState.findUnique({ where: { intentId: id } })
      const stock = await tx.testnetStock.findUniqueOrThrow({ where: { listingId: r.listingId } })
      if (!state) throw new DomainError('WALLET_UNAVAILABLE')
      if (
        ['issued', 'cancellation_pending', 'reconciling'].includes(state.status) &&
        stock.activeOrderId !== r.orderId
      )
        throw new DomainError('WALLET_UNAVAILABLE')
      return { r, status: state.status }
    })
    let signature = await this.client.paymentSignature.findUnique({ where: { intentId: id } })
    // Stored results are not authority. Every read and re-sign is freshly authorized.
    if (loaded.status === 'issued') {
      await this.journal.authorize(loaded.r)
      await this.assertEoa(loaded.r.permit.buyer)
      if (!signature) {
        if (loaded.r.permit.signerKeyId !== this.signer.keyId)
          throw new DomainError('WALLET_UNAVAILABLE')
        const signed = await this.signer.sign(loaded.r.permit)
        await transact(this.client, async (tx) => {
          await this.lockOrder(tx, auth, loaded.r.orderId)
          await this.record(tx, id)
          await tx.paymentSignature.upsert({
            where: { intentId: id },
            create: { intentId: id, signature: signed },
            update: {}
          })
        })
        signature = await this.client.paymentSignature.findUniqueOrThrow({
          where: { intentId: id }
        })
      }
    }
    await this.authenticated(auth)
    const current = await this.client.paymentIntentState.findUniqueOrThrow({
      where: { intentId: id }
    })
    const stock = await this.client.testnetStock.findUniqueOrThrow({where:{listingId:loaded.r.listingId}})
    return {
      orderId: loaded.r.orderId,
      intentId: id,
      permit: loaded.r.permit,
      typedData: JSON.parse(
        JSON.stringify(paymentTypedData(loaded.r.permit), (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v
        )
      ),
      signature: signature?.signature ?? null,
      status: current.status,
      protection: stock.activeOrderId === loaded.r.orderId ? 'held' : 'released'
    }
  }
  async requestIntentCancel(auth: Authenticated, id: string, key: string) {
    auth = await this.authenticated(auth)
    const i = await this.client.paymentIntent.findUnique({ where: { id } })
    if (!i) throw new DomainError('NOT_FOUND')
    await transact(this.client, async (tx) => {
      await this.lockOrder(tx, auth, i.orderId)
      await this.request(tx, auth, 'cancel', key, { intentId: id }, id)
      const r = await this.record(tx, id)
      const state = await tx.paymentIntentState.findUniqueOrThrow({ where: { intentId: id } })
      if (state.status === 'issued') await this.journal.authorize(r)
      await tx.paymentIntentState.updateMany({
        where: { intentId: id, status: { in: ['issued', 'reconciling'] } },
        data: { status: 'cancellation_pending' }
      })
    })
    return this.read(auth, id)
  }
  private async request(
    tx: Transaction,
    auth: Authenticated,
    operation: string,
    key: string,
    payload: object,
    result?: string
  ) {
    const where = { actorId_operation_key: { actorId: auth.account.id, operation, key } },
      hash = requestHash(payload)
    const prior = await tx.paymentIntentRequest.findUnique({ where })
    if (prior) {
      if (prior.requestHash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT')
      return prior.intentId
    }
    if (result)
      await tx.paymentIntentRequest.create({
        data: { actorId: auth.account.id, operation, key, requestHash: hash, intentId: result }
      })
    return null
  }
  private verify(r: IssuanceRecord, s: VerifiedIntentState) {
    const v = s.snapshot,
      now = this.now().getTime()
    if (
      !v ||
      v.chainId !== r.permit.chainId ||
      !/^0x[0-9a-f]{64}$/.test(v.hash) ||
      !/^[0-9]+$/.test(v.height) ||
      typeof s.intentRevoked !== 'boolean' || typeof s.signerRevoked !== 'boolean' ||
      !Number.isSafeInteger(v.timestamp) ||
      v.timestamp < 0 ||
      !v.verifiedAt ||
      !Number.isFinite(new Date(v.verifiedAt).getTime()) ||
      now - new Date(v.verifiedAt).getTime() > 30_000 ||
      now - new Date(v.verifiedAt).getTime() < -5_000 ||
      v.verifiedBy.length !== 2 ||
      v.verifiedBy[0] !== this.config.rpcPrimary ||
      v.verifiedBy[1] !== this.config.rpcSecondary ||
      v.verifiedBy[0] === v.verifiedBy[1] ||
      s.intentId !== r.permit.intentId ||
      s.orderId !== r.permit.orderId ||
      s.stockId !== r.permit.stockId ||
      s.stockGeneration !== r.permit.stockGeneration ||
      !['None', 'Funded', 'Delivered', 'Disputed', 'Released', 'Refunded'].includes(s.orderState)
    )
      throw new DomainError('WALLET_UNAVAILABLE')
    if (s.orderState !== 'None') {
      if (s.orderTermsHash !== r.termsHash || s.stockOccupant !== r.permit.orderId)
        throw new DomainError('WALLET_UNAVAILABLE')
      return 'funded'
    }
    if (s.stockOccupant !== zero || (s.orderTermsHash !== null && s.orderTermsHash !== r.termsHash))
      throw new DomainError('WALLET_UNAVAILABLE')
    if (s.intentRevoked === true || s.signerRevoked === true || v.timestamp >= r.permit.payDeadline)
      return 'invalid'
    throw new DomainError('STATE_CONFLICT')
  }
  async reconcile(auth: Authenticated, id: string) {
    auth = await this.authenticated(auth)
    const original = await this.client.paymentIntent.findUnique({ where: { id } })
    if (!original) throw new DomainError('NOT_FOUND')
    let canMarkReconciling = false
    try {
      return await transact(this.client, async (tx) => {
        await this.lockOrder(tx, auth, original.orderId)
        const r = await this.record(tx, id),
          state = await tx.paymentIntentState.findUniqueOrThrow({ where: { intentId: id } })
        if (['revoked', 'expired', 'funded'].includes(state.status)) {
          const stock = await tx.testnetStock.findUniqueOrThrow({where:{listingId:r.listingId}})
          return { intentId: id, status: state.status, protection: stock.activeOrderId === r.orderId ? 'held' : 'released' }
        }
        // An original committed tuple can complete its independent registration,
        // but a failed registration must remain issued and recoverable.
        if (state.status === 'issued') await this.journal.authorize(r)
        canMarkReconciling = true
        if (!this.observer) throw new DomainError('WALLET_UNAVAILABLE')
        const s = await this.observer.readIntent(r.permit),
          outcome = this.verify(r, s)
        // Persist independent outcome first. If this transaction dies, the exact
        // original operation can reconcile again; no new permit is authorized.
        await this.journal.resolve(r, outcome, s)
        const status =
          outcome === 'funded'
            ? 'funded'
            : s.intentRevoked || s.signerRevoked
              ? 'revoked'
              : 'expired'
        await tx.paymentIntentState.update({
          where: { intentId: id },
          data: { status, verification: json(s) }
        })
        return { intentId: id, status, protection: 'held' }
      })
    } catch (e) {
      if (canMarkReconciling)
        await this.client.paymentIntentState.updateMany({
          where: { intentId: id, status: { in: ['issued', 'cancellation_pending'] } },
          data: { status: 'reconciling' }
        })
      if (e instanceof DomainError) throw e
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }
  async replaceIntent(auth: Authenticated, orderId: string, key: string, oldId: string) {
    auth = await this.authenticated(auth)
    const id = await transact(this.client, async (tx) => {
      const order = await this.lockOrder(tx, auth, orderId)
      const replay = await this.request(tx, auth, 'replace', key, { orderId, oldId })
      if (replay) return replay
      const r = await this.record(tx, oldId),
        state = await tx.paymentIntentState.findUniqueOrThrow({ where: { intentId: oldId } })
      const stock = await tx.testnetStock.findUniqueOrThrow({
        where: { listingId: order.listingId }
      })
      const active = await tx.paymentIntentState.count({
        where: {
          orderId,
          status: { in: ['issued', 'cancellation_pending', 'reconciling', 'funded'] }
        }
      })
      if (
        r.orderId !== orderId ||
        order.status !== 'pending_payment' ||
        !['revoked', 'expired'].includes(state.status) ||
        stock.activeOrderId !== orderId ||
        active !== 0 ||
        !state.verification
      )
        throw new DomainError('STATE_CONFLICT')
      // Re-read finalized state: an old DB projection alone never authorizes replacement.
      if (!this.observer) throw new DomainError('WALLET_UNAVAILABLE')
      const s = await this.observer.readIntent(r.permit)
      if (this.verify(r, s) !== 'invalid') throw new DomainError('STATE_CONFLICT')
      await this.journal.resolve(r, 'invalid', s)
      const next = await this.append(tx, orderId, orderTerms(r.permit), oldId)
      await this.request(tx, auth, 'replace', key, { orderId, oldId }, next)
      return next
    })
    return this.read(auth, id)
  }
  async closeOrder(auth: Authenticated, orderId: string, key: string) {
    auth = await this.authenticated(auth)
    return transact(this.client, async (tx) => {
      const order = await this.lockOrder(tx, auth, orderId)
      const replay = await this.request(tx, auth, 'close', key, { orderId })
      if (replay) return { orderId, status: 'cancelled' }
      if (order.status !== 'pending_payment') throw new DomainError('STATE_CONFLICT')
      const intents = await tx.paymentIntent.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' }
      })
      if (!intents.length || !this.observer) throw new DomainError('WALLET_UNAVAILABLE')
      let lastEvidence: VerifiedIntentState | null = null
      for (const i of intents) {
        const r = await this.record(tx, i.id),
          state = await tx.paymentIntentState.findUniqueOrThrow({ where: { intentId: i.id } })
        if (!['revoked', 'expired'].includes(state.status)) throw new DomainError('STATE_CONFLICT')
        const s = await this.observer.readIntent(r.permit)
        if (this.verify(r, s) !== 'invalid') throw new DomainError('STATE_CONFLICT')
        if (lastEvidence && (lastEvidence.snapshot.height !== s.snapshot.height ||
          lastEvidence.snapshot.hash !== s.snapshot.hash || lastEvidence.snapshot.timestamp !== s.snapshot.timestamp))
          throw new DomainError('WALLET_UNAVAILABLE')
        lastEvidence = s
      }
      const last = intents[intents.length - 1]
      if (!lastEvidence) throw new DomainError('WALLET_UNAVAILABLE')
      await this.journal.resolve(await this.record(tx, last.id), 'invalid', lastEvidence)
      const stock = await tx.testnetStock.findUniqueOrThrow({
        where: { listingId: order.listingId }
      })
      if (stock.activeOrderId !== orderId) throw new DomainError('WALLET_UNAVAILABLE')
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'cancelled', version: { increment: 1 } }
      })
      await tx.testnetStock.update({
        where: { listingId: order.listingId },
        data: { state: 'free', activeOrderId: null }
      })
      await tx.digitalInventory.update({
        where: { listingId: order.listingId },
        data: { availability: 'available', activeOrderId: null, version: { increment: 1 } }
      })
      await this.request(tx, auth, 'close', key, { orderId }, last.id)
      return { orderId, status: 'cancelled' }
    })
  }
}
