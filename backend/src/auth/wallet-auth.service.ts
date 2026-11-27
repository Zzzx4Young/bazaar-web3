import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { recoverMessageAddress, recoverTypedDataAddress, type Hex } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { PrismaClient, WalletChallenge, Prisma } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { normalizeWalletAddress } from '../web3/web3-policy.js'
import { idempotencyKey } from '../orders/idempotency-key.js'
import type { EvmAddress } from '../web3/web3-types.js'
import { AuthService, type Authenticated } from './auth.service.js'
import type { WalletSecurityLedger } from './wallet-security-ledger.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export type WalletPurpose = 'bind' | 'unbind' | 'payout'
type Purpose = WalletPurpose
interface Options {
  chainId: number
  escrow: EvmAddress
  appOrigin: string
  assertEoa: (address: EvmAddress) => Promise<void>
  now?: () => Date
}

export class WalletAuthService {
  constructor(private readonly client: PrismaClient, private readonly auth: AuthService,
    private readonly ledger: WalletSecurityLedger, private readonly options: Options) {}

  private now() { return this.options.now?.() ?? new Date() }
  private deadline(now: Date) { return new Date(now.getTime() + 300_000) }
  private async assertEoa(address: EvmAddress) {
    try { await this.options.assertEoa(address) }
    catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('WALLET_UNAVAILABLE')
    }
  }
  private async session(auth: Authenticated) {
    const current = await this.auth.authenticate(`bazaar_session=${auth.token}`)
    if (current.account.id !== auth.account.id || current.account.role !== 'participant')
      throw new DomainError('FORBIDDEN')
    return current
  }
  private async lock(tx: Transaction, accountId: string, auth?: Authenticated) {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`
    const account = await tx.account.findUnique({ where: { id: accountId } })
    if (!account || account.status !== 'active' || account.role !== 'participant')
      throw new DomainError('FORBIDDEN')
    if (auth) {
      await tx.$queryRaw`SELECT "tokenHash" FROM "Session" WHERE "tokenHash" = ${auth.tokenHash} FOR UPDATE`
      const session = await tx.session.findUnique({ where: { tokenHash: auth.tokenHash } })
      if (!session || session.accountId !== accountId || session.revokedAt || session.expiresAt <= this.now() ||
        session.recoveryEpoch !== await this.ledger.recoveryEpoch()) throw new DomainError('UNAUTHENTICATED')
    }
  }
  private request(auth: Authenticated, kind: string, key: string) {
    return hash(JSON.stringify([auth.account.id, auth.tokenHash, this.options.chainId,
      this.options.escrow, kind, idempotencyKey(key)]))
  }
  private sameScope(row: WalletChallenge) {
    return row.chainId === this.options.chainId &&
      (row.payload as Prisma.JsonObject | null)?.escrow === this.options.escrow
  }
  private sameIntent(row: WalletChallenge, purpose: Purpose, wallet: string) {
    if (row.purpose !== purpose || row.wallet !== wallet) throw new DomainError('IDEMPOTENCY_CONFLICT')
  }
  private view(row: WalletChallenge) {
    return { id: row.id, expiresAt: row.expiresAt.toISOString() }
  }
  private typedData(row: WalletChallenge) {
    if (!row.wallet) throw new DomainError('INVALID_CREDENTIALS')
    const primaryType = row.purpose === 'payout' ? 'SellerPayoutConfirmation' : 'WalletAction'
    return {
      domain: { name: row.purpose === 'payout' ? 'Bazaar Seller Payout' : 'Bazaar Wallet Action', version: '1', chainId: row.chainId,
        verifyingContract: this.options.escrow },
      primaryType,
      types: { [primaryType]: [
        { name: 'purpose', type: 'string' }, { name: 'account', type: 'bytes32' },
        { name: 'wallet', type: 'address' }, { name: 'bindingVersion', type: 'uint32' },
        { name: 'authorization', type: 'bytes32' }, { name: 'session', type: 'bytes32' },
        { name: 'recoveryEpoch', type: 'bytes32' }, { name: 'expiresAtMilliseconds', type: 'uint64' }
      ] },
      message: { purpose: row.purpose, account: `0x${hash(row.accountId)}` as Hex,
        wallet: row.wallet as EvmAddress, bindingVersion: row.bindingVersion,
        authorization: `0x${hash(row.id)}` as Hex, session: `0x${row.sessionHash}` as Hex,
        recoveryEpoch: `0x${hash(row.recoveryEpoch)}` as Hex,
        expiresAtMilliseconds: row.expiresAt.getTime() }
    }
  }
  private async valid(row: WalletChallenge | null, auth: Authenticated, kind: string) {
    if (!row || !this.sameScope(row) || row.kind !== kind || row.accountId !== auth.account.id ||
      row.sessionHash !== auth.tokenHash || row.invalidatedAt || row.expiresAt <= this.now() ||
      row.recoveryEpoch !== await this.ledger.recoveryEpoch())
      throw new DomainError('INVALID_CREDENTIALS')
    return row
  }

  async current(auth: Authenticated) {
    await this.session(auth)
    const row = await this.client.walletIdentity.findUnique({ where: { accountId_chainId: {
      accountId: auth.account.id, chainId: this.options.chainId } } })
    return this.ledger.assertProjection({ accountId: auth.account.id, chainId: this.options.chainId,
      address: row?.address as EvmAddress | null ?? null, bindingVersion: row?.bindingVersion ?? 0,
      revision: String(row?.securityRevision ?? 0) })
  }

  async requestPasswordReauth(auth: Authenticated, password: string, purpose: Purpose,
    address: string, key: string, ip: string) {
    await this.session(auth)
    if (!['bind', 'unbind', 'payout'].includes(purpose) || typeof password !== 'string' || password.length > 128)
      throw new DomainError('INVALID_INPUT')
    const wallet = normalizeWalletAddress(address)
    const passwordHash = await this.auth.verifyWalletPassword(auth, password, ip)
    const state = await this.current(auth)
    const requestHash = this.request(auth, 'reauth', key)
    return this.client.$transaction(async (tx) => {
      await this.lock(tx, auth.account.id, auth)
      const credential = await tx.accountCredential.findUnique({ where: { accountId: auth.account.id } })
      if (credential?.passwordHash !== passwordHash) throw new DomainError('INVALID_CREDENTIALS')
      const prior = await tx.walletChallenge.findUnique({ where: { requestHash } })
      if (prior) {
        this.sameIntent(prior, purpose, wallet)
        return this.view(prior)
      }
      const now = this.now()
      await tx.walletChallenge.updateMany({ where: { accountId: auth.account.id, purpose,
        consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } })
      const row = await tx.walletChallenge.create({ data: { accountId: auth.account.id,
        chainId: this.options.chainId, kind: 'reauth', purpose, wallet,
        bindingVersion: state.bindingVersion, recoveryEpoch: state.recoveryEpoch,
        sessionHash: auth.tokenHash, requestHash, payload: { source: 'password', escrow: this.options.escrow }, createdAt: now,
        expiresAt: this.deadline(now) } })
      return this.view(row)
    })
  }

  async createActionChallenge(auth: Authenticated, proofId: string, purpose: Purpose,
    address: string, key: string) {
    await this.session(auth)
    const wallet = normalizeWalletAddress(address)
    const requestHash = this.request(auth, 'action', key)
    return this.client.$transaction(async (tx) => {
      await this.lock(tx, auth.account.id, auth)
      const prior = await tx.walletChallenge.findUnique({ where: { requestHash } })
      if (prior) {
        this.sameIntent(prior, purpose, wallet)
        if ((prior.payload as Prisma.JsonObject).proofId !== proofId) throw new DomainError('IDEMPOTENCY_CONFLICT')
        return { ...this.view(prior), typedData: this.typedData(prior) }
      }
      const proof = await this.valid(await tx.walletChallenge.findUnique({ where: { id: proofId } }), auth, 'reauth')
      const state = await this.current(auth)
      if (proof.consumedAt || proof.purpose !== purpose || proof.wallet !== wallet ||
        proof.bindingVersion !== state.bindingVersion ||
        (purpose !== 'bind' && state.address !== wallet)) throw new DomainError('INVALID_CREDENTIALS')
      const now = this.now()
      await tx.walletChallenge.update({ where: { id: proof.id }, data: { consumedAt: now } })
      const row = await tx.walletChallenge.create({ data: { accountId: auth.account.id,
        chainId: this.options.chainId, kind: 'action', purpose, wallet,
        bindingVersion: state.bindingVersion, recoveryEpoch: state.recoveryEpoch,
        sessionHash: auth.tokenHash, requestHash, payload: { proofId, escrow: this.options.escrow,
          source: (proof.payload as Prisma.JsonObject).source ?? 'password' }, createdAt: now,
        expiresAt: new Date(Math.min(now.getTime() + 300_000, proof.expiresAt.getTime())) } })
      return { ...this.view(row), typedData: this.typedData(row) }
    })
  }

  // Server-only adapter boundary: a pending provider challenge is never an
  // account proof. Only provider verification may change its kind to reauth.
  async startProviderProof(auth: Authenticated, purpose: Purpose, address: string, key: string,
    provider: 'email' | 'google', payload: Prisma.InputJsonObject) {
    await this.session(auth)
    if (!['bind', 'unbind', 'payout'].includes(purpose)) throw new DomainError('INVALID_INPUT')
    const wallet = normalizeWalletAddress(address)
    const state = await this.current(auth)
    const requestHash = this.request(auth, `provider_${provider}`, key)
    return this.client.$transaction(async tx => {
      await this.lock(tx, auth.account.id, auth)
      const prior = await tx.walletChallenge.findUnique({ where: { requestHash } })
      if (prior) {
        this.sameIntent(prior, purpose, wallet)
        await this.valid(prior, auth, prior.kind)
        return { row: prior, created: false }
      }
      const now = this.now()
      await tx.walletChallenge.updateMany({ where: { accountId: auth.account.id, chainId: this.options.chainId,
        purpose, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } })
      const row = await tx.walletChallenge.create({ data: { accountId: auth.account.id,
        chainId: this.options.chainId, kind: `provider_${provider}`, purpose, wallet,
        bindingVersion: state.bindingVersion, recoveryEpoch: state.recoveryEpoch,
        sessionHash: auth.tokenHash, requestHash, payload: { ...payload, provider, escrow: this.options.escrow }, createdAt: now,
        expiresAt: this.deadline(now) } })
      return { row, created: true }
    })
  }

  async providerTransaction<T>(auth: Authenticated, id: string, provider: 'email' | 'google',
    work: (tx: Transaction, row: WalletChallenge) => Promise<T>) {
    await this.session(auth)
    return this.client.$transaction(async tx => {
      await this.lock(tx, auth.account.id, auth)
      const row = await tx.walletChallenge.findUnique({ where: { id } })
      if (!row || ![`provider_${provider}`, 'reauth'].includes(row.kind) ||
        (row.payload as Prisma.JsonObject).provider !== provider) throw new DomainError('INVALID_CREDENTIALS')
      await this.valid(row, auth, row.kind)
      const state = await this.current(auth)
      if (state.bindingVersion !== row.bindingVersion) throw new DomainError('INVALID_CREDENTIALS')
      return work(tx, row)
    })
  }

  async consumeActionChallenge(auth: Authenticated, id: string, signature?: Hex) {
    return this.consumeOperation(auth, id, signature, false)
  }

  async consumePayoutChallenge(auth: Authenticated, id: string, signature: Hex) {
    return this.consumeOperation(auth, id, signature, true)
  }

  async reconcilePayoutChallenge(cookie: string | undefined, id: string, signature: Hex,
    csrf: string | string[] | undefined) {
    const { auth } = await this.auth.payoutRecoverySession(cookie, id)
    this.auth.checkCsrf(auth, csrf)
    return this.client.$transaction(async tx => {
      await this.lock(tx, auth.account.id, auth)
      const challenge = await tx.walletChallenge.findUnique({ where: { id } })
      const operation = await tx.walletSecurityOperation.findUnique({ where: { id } })
      const confirmation = await tx.sellerPayoutConfirmation.findUnique({ where: { id } })
      if (!challenge || !this.sameScope(challenge) || challenge.kind !== 'action' || challenge.purpose !== 'payout' ||
        challenge.accountId !== auth.account.id || challenge.sessionHash !== auth.tokenHash || !challenge.consumedAt ||
        !challenge.result || !operation || operation.operation !== 'payout' || operation.accountId !== auth.account.id ||
        operation.chainId !== challenge.chainId || operation.requestHash !== challenge.requestHash ||
        !confirmation || confirmation.revokedAt || confirmation.accountId !== auth.account.id ||
        confirmation.challengeId !== id || confirmation.signature.toLowerCase() !== signature.toLowerCase())
        throw new DomainError('INVALID_CREDENTIALS')
      const identity = await tx.walletIdentity.findUnique({ where: { accountId_chainId: {
        accountId: auth.account.id, chainId: challenge.chainId } } })
      const head = await this.ledger.read(auth.account.id, challenge.chainId)
      if (!identity || identity.lastOperationId !== id || identity.securityRevision !== operation.revision ||
        identity.address !== challenge.wallet || identity.bindingVersion !== challenge.bindingVersion ||
        confirmation.wallet !== identity.address || confirmation.bindingVersion !== identity.bindingVersion ||
        confirmation.chainId !== challenge.chainId || confirmation.escrow !== this.options.escrow ||
        head.address !== identity.address || head.bindingVersion !== identity.bindingVersion ||
        head.recoveryEpoch !== challenge.recoveryEpoch ||
        (head.pendingOperationId ? head.pendingOperationId !== id || BigInt(head.revision) + 1n !== operation.revision
          : BigInt(head.revision) !== operation.revision || head.payout?.confirmationId !== id))
        throw new DomainError('WALLET_UNAVAILABLE')
      const expected = { address: identity.address, bindingVersion: identity.bindingVersion,
        revision: String(identity.securityRevision) }
      if (!isDeepStrictEqual(challenge.result, expected) || !isDeepStrictEqual(operation.result, expected) ||
        !isDeepStrictEqual(confirmation.statement, this.typedData(challenge)))
        throw new DomainError('WALLET_UNAVAILABLE')
      try {
        if (normalizeWalletAddress(await recoverTypedDataAddress({ ...this.typedData(challenge), signature })) !== identity.address)
          throw new Error('signature')
      } catch { throw new DomainError('INVALID_CREDENTIALS') }
      // No new business mutation and no renewed proof: only finish the original
      // committed authorization, even if its original challenge has since expired.
      await this.ledger.commit(id)
      return challenge.result
    })
  }

  private async consumeOperation(auth: Authenticated, id: string, signature: Hex | undefined, isPayout: boolean) {
    await this.session(auth)
    const original = await this.client.walletChallenge.findUnique({ where: { id } })
    if (original && !this.sameScope(original)) throw new DomainError('INVALID_CREDENTIALS')
    if (original && (isPayout ? original.purpose !== 'payout' : !['bind', 'unbind'].includes(original.purpose)))
      throw new DomainError('INVALID_CREDENTIALS')
    // A retry returns stored evidence only; it cannot authorize a second mutation.
    if (original?.accountId === auth.account.id && original.sessionHash === auth.tokenHash &&
      original.kind === 'action' && original.consumedAt && original.result) {
      await this.ledger.commit(id)
      return original.result
    }
    const row = await this.valid(original, auth, 'action')
    if (!row.wallet || !['bind', 'unbind', 'payout'].includes(row.purpose)) throw new DomainError('INVALID_CREDENTIALS')
    if (row.purpose !== 'unbind') {
      try {
        if (!signature || normalizeWalletAddress(await recoverTypedDataAddress({ ...this.typedData(row), signature })) !== row.wallet)
          throw new Error('signature')
      } catch { throw new DomainError('INVALID_CREDENTIALS') }
      await this.assertEoa(row.wallet as EvmAddress)
    }
    const head = await this.ledger.read(auth.account.id, row.chainId)
    const state = head.pendingOperationId === id ? head : await this.current(auth)
    // Read after the ledger state: a newer revision can only be used after its
    // business commit, including payout operations that do not change bindingVersion.
    const committed = await this.client.walletChallenge.findUnique({ where: { id } })
    if (committed?.accountId === auth.account.id && committed.sessionHash === auth.tokenHash &&
      committed.kind === 'action' && committed.purpose === row.purpose && committed.consumedAt && committed.result) {
      await this.ledger.commit(id)
      return committed.result
    }
    if (row.bindingVersion !== state.bindingVersion) throw new DomainError('INVALID_CREDENTIALS')
    const address = row.purpose === 'unbind' ? null : row.wallet as EvmAddress
    if (isPayout && address !== state.address) throw new DomainError('INVALID_CREDENTIALS')
    await this.ledger.prepare({ operationId: row.id, operation: row.purpose as Purpose,
      accountId: row.accountId, chainId: row.chainId, expectedRevision: state.revision,
      expectedBindingVersion: state.bindingVersion, expectedRecoveryEpoch: row.recoveryEpoch, address,
      payout: isPayout ? { wallet: address!, escrow: this.options.escrow, confirmationId: id } : null, requestHash: row.requestHash })
    const result = { address, bindingVersion: state.bindingVersion + (isPayout ? 0 : 1), revision: String(BigInt(state.revision) + 1n) }
    let persisted: Prisma.JsonValue
    try {
      persisted = await this.client.$transaction(async (tx) => {
        await this.lock(tx, auth.account.id, auth)
        const latest = await tx.walletChallenge.findUnique({ where: { id } })
        if (latest?.kind === 'action' && latest.accountId === auth.account.id && latest.sessionHash === auth.tokenHash &&
          latest.consumedAt && latest.result) return latest.result
        const challenge = await this.valid(latest, auth, 'action')
        const identity = await tx.walletIdentity.findUnique({ where: { accountId_chainId: {
          accountId: auth.account.id, chainId: row.chainId } } })
        if (challenge.consumedAt || (identity?.bindingVersion ?? 0) !== state.bindingVersion ||
          String(identity?.securityRevision ?? 0) !== state.revision)
          throw new DomainError('STATE_CONFLICT')
        await tx.walletIdentity.upsert({ where: { accountId_chainId: { accountId: row.accountId, chainId: row.chainId } },
          create: { accountId: row.accountId, chainId: row.chainId, address, bindingVersion: result.bindingVersion,
            securityRevision: BigInt(result.revision), lastOperationId: id },
          update: { address, bindingVersion: result.bindingVersion,
            securityRevision: BigInt(result.revision), lastOperationId: id } })
        if (address && !isPayout) await tx.walletClaim.upsert({ where: { chainId_address: { chainId: row.chainId, address } },
          create: { chainId: row.chainId, address, accountId: row.accountId }, update: {} })
        await tx.walletSecurityOperation.create({ data: { id, accountId: row.accountId,
          chainId: row.chainId, operation: row.purpose, revision: BigInt(result.revision), requestHash: row.requestHash, result } })
        await tx.walletIdentityEvent.create({ data: { accountId: row.accountId, chainId: row.chainId,
          operationId: id, operation: row.purpose, previousAddress: state.address, currentAddress: address,
          bindingVersion: result.bindingVersion, revision: BigInt(result.revision) } })
        const now = this.now()
        await tx.sellerPayoutConfirmation.updateMany({ where: { accountId: row.accountId,
          chainId: row.chainId, revokedAt: null }, data: { revokedAt: now } })
        if (isPayout) await tx.sellerPayoutConfirmation.create({ data: {
          id, accountId: row.accountId, chainId: row.chainId, wallet: address!, escrow: this.options.escrow,
          bindingVersion: result.bindingVersion, challengeId: id, signature: signature!,
          statement: this.typedData(row) as unknown as Prisma.InputJsonValue, confirmedAt: now
        } })
        else await tx.session.updateMany({ where: { accountId: row.accountId, authMethod: 'wallet_siwe', revokedAt: null },
          data: { revokedAt: now } })
        await tx.walletChallenge.updateMany({ where: { accountId: row.accountId, chainId: row.chainId,
          id: { not: id }, ...(isPayout ? { purpose: 'payout' } : {}),
          consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } })
        await tx.walletChallenge.update({ where: { id }, data: { consumedAt: now, result } })
        return result
      })
    } catch (error) {
      // A callback rollback alone does not prove another retry did not commit.
      // Fence the challenge under the same account lock before releasing a
      // known-unapplied operation; concurrent successful retries are preserved.
      if (error instanceof DomainError) await this.client.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${row.accountId}::uuid FOR UPDATE`
        const applied = await tx.walletSecurityOperation.findUnique({ where: { id } })
        if (applied) return
        await tx.walletChallenge.updateMany({ where: { id, consumedAt: null }, data: { invalidatedAt: this.now() } })
        await this.ledger.abort(id)
      })
      else throw new DomainError('WALLET_UNAVAILABLE')
      throw error
    }
    await this.ledger.commit(id)
    return persisted
  }

  async createLoginChallenge(address: string, ip: string) {
    await this.auth.rateLimitWallet(ip)
    const wallet = normalizeWalletAddress(address)
    const accountId = await this.ledger.claimOwner(this.options.chainId, wallet)
    if (!accountId) throw new DomainError('INVALID_CREDENTIALS')
    const state = await this.ledger.read(accountId, this.options.chainId)
    if (state.address !== wallet) throw new DomainError('INVALID_CREDENTIALS')
    const projection = await this.client.walletIdentity.findUnique({ where: { accountId_chainId: {
      accountId, chainId: this.options.chainId } } })
    await this.ledger.assertProjection({ accountId, chainId: this.options.chainId,
      address: projection?.address as EvmAddress | null ?? null, bindingVersion: projection?.bindingVersion ?? 0,
      revision: String(projection?.securityRevision ?? 0) })
    await this.assertEoa(wallet)
    const now = this.now(), expiresAt = this.deadline(now), id = randomUUID()
    const message = createSiweMessage({ address: wallet, chainId: this.options.chainId,
      domain: new URL(this.options.appOrigin).host, uri: this.options.appOrigin, version: '1',
      nonce: generateSiweNonce(), issuedAt: now, expirationTime: expiresAt,
      statement: 'Sign in to Bazaar. This signature cannot authorize wallet binding or payments.' })
    await this.client.walletChallenge.create({ data: { id, accountId, chainId: this.options.chainId,
      kind: 'login', purpose: 'login', wallet, bindingVersion: state.bindingVersion,
      recoveryEpoch: state.recoveryEpoch, sessionHash: hash(id), requestHash: hash(`login:${id}`),
      payload: { message, escrow: this.options.escrow }, createdAt: now, expiresAt } })
    return { id, message, expiresAt: expiresAt.toISOString() }
  }

  async verifyLogin(id: string, message: string, signature: Hex, ip: string, cookie?: string) {
    await this.auth.rateLimitWallet(ip)
    const row = await this.client.walletChallenge.findUnique({ where: { id } })
    if (!row || !this.sameScope(row) || row.kind !== 'login' || row.consumedAt || row.invalidatedAt || row.expiresAt <= this.now() ||
      !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) || row.payload.message !== message)
      throw new DomainError('INVALID_CREDENTIALS')
    try {
      if (normalizeWalletAddress(await recoverMessageAddress({ message, signature })) !== row.wallet)
        throw new Error('signature')
    } catch { throw new DomainError('INVALID_CREDENTIALS') }
    const state = await this.ledger.read(row.accountId, row.chainId)
    if (state.address !== row.wallet || state.bindingVersion !== row.bindingVersion || state.recoveryEpoch !== row.recoveryEpoch)
      throw new DomainError('INVALID_CREDENTIALS')
    await this.assertEoa(state.address!)
    return this.client.$transaction(async (tx) => {
      await this.lock(tx, row.accountId)
      const challenge = await tx.walletChallenge.findUniqueOrThrow({ where: { id } })
      if (challenge.consumedAt || challenge.invalidatedAt || challenge.expiresAt <= this.now())
        throw new DomainError('INVALID_CREDENTIALS')
      const identity = await tx.walletIdentity.findUnique({ where: { accountId_chainId: {
        accountId: row.accountId, chainId: row.chainId } } })
      const fresh = await this.ledger.assertProjection({ accountId: row.accountId, chainId: row.chainId,
        address: identity?.address as EvmAddress | null ?? null, bindingVersion: identity?.bindingVersion ?? 0,
        revision: String(identity?.securityRevision ?? 0) })
      if (fresh.address !== row.wallet || fresh.bindingVersion !== row.bindingVersion ||
        fresh.recoveryEpoch !== row.recoveryEpoch) throw new DomainError('INVALID_CREDENTIALS')
      const account = await tx.account.findUniqueOrThrow({ where: { id: row.accountId } })
      if (account.status !== 'active') throw new DomainError('INVALID_CREDENTIALS')
      await tx.walletChallenge.update({ where: { id }, data: { consumedAt: this.now() } })
      return this.auth.issueSession(tx, account, cookie, 'wallet_siwe', {
        chainId: row.chainId, address: row.wallet!, bindingVersion: row.bindingVersion,
        recoveryEpoch: fresh.recoveryEpoch })
    })
  }
}
