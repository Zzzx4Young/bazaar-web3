import { createHash, randomUUID } from 'node:crypto'
import { recoverMessageAddress, recoverTypedDataAddress, type Hex } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import type { PrismaClient, WalletChallenge } from '../generated/prisma/client.js'
import type { Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import { normalizeWalletAddress } from '../web3/web3-policy.js'
import type { EvmAddress } from '../web3/web3-types.js'
import { AuthService, type Authenticated } from './auth.service.js'
import type { WalletSecurityLedger } from './wallet-security-ledger.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
type Purpose = 'bind' | 'unbind'
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
  private request(auth: Authenticated, kind: string, purpose: string, wallet: string, key: string) {
    if (!key || key.length > 128) throw new DomainError('INVALID_INPUT')
    return hash(JSON.stringify([auth.account.id, auth.tokenHash, kind, purpose, wallet, key]))
  }
  private view(row: WalletChallenge) {
    return { id: row.id, expiresAt: row.expiresAt.toISOString() }
  }
  private typedData(row: WalletChallenge) {
    if (!row.wallet) throw new DomainError('INVALID_CREDENTIALS')
    return {
      domain: { name: 'Bazaar Wallet Action', version: '1', chainId: row.chainId,
        verifyingContract: this.options.escrow },
      primaryType: 'WalletAction' as const,
      types: { WalletAction: [
        { name: 'purpose', type: 'string' }, { name: 'account', type: 'bytes32' },
        { name: 'wallet', type: 'address' }, { name: 'bindingVersion', type: 'uint32' },
        { name: 'authorization', type: 'bytes32' }, { name: 'session', type: 'bytes32' },
        { name: 'recoveryEpoch', type: 'bytes32' }, { name: 'expiresAt', type: 'uint64' }
      ] },
      message: { purpose: row.purpose, account: `0x${hash(row.accountId)}` as Hex,
        wallet: row.wallet as EvmAddress, bindingVersion: row.bindingVersion,
        authorization: `0x${hash(row.id)}` as Hex, session: `0x${row.sessionHash}` as Hex,
        recoveryEpoch: `0x${hash(row.recoveryEpoch)}` as Hex,
        expiresAt: Math.floor(row.expiresAt.getTime() / 1000) }
    }
  }
  private async valid(row: WalletChallenge | null, auth: Authenticated, kind: string) {
    if (!row || row.kind !== kind || row.accountId !== auth.account.id ||
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
    if (!['bind', 'unbind'].includes(purpose) || typeof password !== 'string' || password.length > 128)
      throw new DomainError('INVALID_INPUT')
    const wallet = normalizeWalletAddress(address)
    const passwordHash = await this.auth.verifyWalletPassword(auth, password, ip)
    const state = await this.current(auth)
    const requestHash = this.request(auth, 'reauth', purpose, wallet, key)
    return this.client.$transaction(async (tx) => {
      await this.lock(tx, auth.account.id, auth)
      const credential = await tx.accountCredential.findUnique({ where: { accountId: auth.account.id } })
      if (credential?.passwordHash !== passwordHash) throw new DomainError('INVALID_CREDENTIALS')
      const prior = await tx.walletChallenge.findUnique({ where: { requestHash } })
      if (prior) return this.view(prior)
      const now = this.now()
      await tx.walletChallenge.updateMany({ where: { accountId: auth.account.id, purpose,
        consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } })
      const row = await tx.walletChallenge.create({ data: { accountId: auth.account.id,
        chainId: this.options.chainId, kind: 'reauth', purpose, wallet,
        bindingVersion: state.bindingVersion, recoveryEpoch: state.recoveryEpoch,
        sessionHash: auth.tokenHash, requestHash, payload: {}, createdAt: now,
        expiresAt: new Date(now.getTime() + 300_000) } })
      return this.view(row)
    })
  }

  async createActionChallenge(auth: Authenticated, proofId: string, purpose: Purpose,
    address: string, key: string) {
    await this.session(auth)
    const wallet = normalizeWalletAddress(address)
    const requestHash = this.request(auth, 'action', purpose, wallet, key)
    return this.client.$transaction(async (tx) => {
      await this.lock(tx, auth.account.id, auth)
      const prior = await tx.walletChallenge.findUnique({ where: { requestHash } })
      if (prior) return { ...this.view(prior), typedData: this.typedData(prior) }
      const proof = await this.valid(await tx.walletChallenge.findUnique({ where: { id: proofId } }), auth, 'reauth')
      const state = await this.current(auth)
      if (proof.consumedAt || proof.purpose !== purpose || proof.wallet !== wallet ||
        proof.bindingVersion !== state.bindingVersion ||
        (purpose === 'unbind' && state.address !== wallet)) throw new DomainError('INVALID_CREDENTIALS')
      const now = this.now()
      await tx.walletChallenge.update({ where: { id: proof.id }, data: { consumedAt: now } })
      const row = await tx.walletChallenge.create({ data: { accountId: auth.account.id,
        chainId: this.options.chainId, kind: 'action', purpose, wallet,
        bindingVersion: state.bindingVersion, recoveryEpoch: state.recoveryEpoch,
        sessionHash: auth.tokenHash, requestHash, payload: { proofId }, createdAt: now,
        expiresAt: new Date(Math.min(now.getTime() + 300_000, proof.expiresAt.getTime())) } })
      return { ...this.view(row), typedData: this.typedData(row) }
    })
  }

  async consumeActionChallenge(auth: Authenticated, id: string, signature?: Hex) {
    await this.session(auth)
    const original = await this.client.walletChallenge.findUnique({ where: { id } })
    // A retry returns stored evidence only; it cannot authorize a second mutation.
    if (original?.accountId === auth.account.id && original.sessionHash === auth.tokenHash &&
      original.kind === 'action' && original.consumedAt && original.result) {
      await this.ledger.commit(id)
      return original.result
    }
    const row = await this.valid(original, auth, 'action')
    if (!row.wallet || !['bind', 'unbind'].includes(row.purpose)) throw new DomainError('INVALID_CREDENTIALS')
    if (row.purpose === 'bind') {
      try {
        if (!signature || normalizeWalletAddress(await recoverTypedDataAddress({ ...this.typedData(row), signature })) !== row.wallet)
          throw new Error('signature')
      } catch { throw new DomainError('INVALID_CREDENTIALS') }
      await this.options.assertEoa(row.wallet as EvmAddress)
    }
    const state = await this.current(auth)
    if (row.bindingVersion !== state.bindingVersion) throw new DomainError('INVALID_CREDENTIALS')
    const address = row.purpose === 'unbind' ? null : row.wallet as EvmAddress
    await this.ledger.prepare({ operationId: row.id, operation: row.purpose as Purpose,
      accountId: row.accountId, chainId: row.chainId, expectedRevision: state.revision,
      expectedBindingVersion: state.bindingVersion, address, payout: null, requestHash: row.requestHash })
    const result = { address, bindingVersion: state.bindingVersion + 1, revision: String(BigInt(state.revision) + 1n) }
    try {
      await this.client.$transaction(async (tx) => {
        await this.lock(tx, auth.account.id, auth)
        const challenge = await this.valid(await tx.walletChallenge.findUnique({ where: { id } }), auth, 'action')
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
        if (address) await tx.walletClaim.upsert({ where: { chainId_address: { chainId: row.chainId, address } },
          create: { chainId: row.chainId, address, accountId: row.accountId }, update: {} })
        await tx.walletSecurityOperation.create({ data: { id, accountId: row.accountId,
          chainId: row.chainId, operation: row.purpose, revision: BigInt(result.revision), requestHash: row.requestHash, result } })
        await tx.walletIdentityEvent.create({ data: { accountId: row.accountId, chainId: row.chainId,
          operationId: id, operation: row.purpose, previousAddress: state.address, currentAddress: address,
          bindingVersion: result.bindingVersion, revision: BigInt(result.revision) } })
        const now = this.now()
        await tx.sellerPayoutConfirmation.updateMany({ where: { accountId: row.accountId,
          chainId: row.chainId, revokedAt: null }, data: { revokedAt: now } })
        await tx.session.updateMany({ where: { accountId: row.accountId, authMethod: 'wallet_siwe', revokedAt: null },
          data: { revokedAt: now } })
        await tx.walletChallenge.updateMany({ where: { accountId: row.accountId, chainId: row.chainId,
          id: { not: id }, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } })
        await tx.walletChallenge.update({ where: { id }, data: { consumedAt: now, result } })
      })
    } catch (error) {
      // Only a known application rollback may release the independent reservation.
      if (error instanceof DomainError) await this.ledger.abort(id)
      else throw new DomainError('WALLET_UNAVAILABLE')
      throw error
    }
    await this.ledger.commit(id)
    return result
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
    await this.options.assertEoa(wallet)
    const now = this.now(), expiresAt = new Date(now.getTime() + 300_000), id = randomUUID()
    const message = createSiweMessage({ address: wallet, chainId: this.options.chainId,
      domain: new URL(this.options.appOrigin).host, uri: this.options.appOrigin, version: '1',
      nonce: generateSiweNonce(), issuedAt: now, expirationTime: expiresAt,
      statement: 'Sign in to Bazaar. This signature cannot authorize wallet binding or payments.' })
    await this.client.walletChallenge.create({ data: { id, accountId, chainId: this.options.chainId,
      kind: 'login', purpose: 'login', wallet, bindingVersion: state.bindingVersion,
      recoveryEpoch: state.recoveryEpoch, sessionHash: hash(id), requestHash: hash(`login:${id}`),
      payload: { message }, createdAt: now, expiresAt } })
    return { id, message, expiresAt: expiresAt.toISOString() }
  }

  async verifyLogin(id: string, message: string, signature: Hex, ip: string) {
    await this.auth.rateLimitWallet(ip)
    const row = await this.client.walletChallenge.findUnique({ where: { id } })
    if (!row || row.kind !== 'login' || row.consumedAt || row.invalidatedAt || row.expiresAt <= this.now() ||
      !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) || row.payload.message !== message)
      throw new DomainError('INVALID_CREDENTIALS')
    try {
      if (normalizeWalletAddress(await recoverMessageAddress({ message, signature })) !== row.wallet)
        throw new Error('signature')
    } catch { throw new DomainError('INVALID_CREDENTIALS') }
    const state = await this.ledger.read(row.accountId, row.chainId)
    if (state.address !== row.wallet || state.bindingVersion !== row.bindingVersion || state.recoveryEpoch !== row.recoveryEpoch)
      throw new DomainError('INVALID_CREDENTIALS')
    await this.options.assertEoa(state.address!)
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
      return this.auth.issueSession(tx, account, undefined, 'wallet_siwe', {
        chainId: row.chainId, address: row.wallet!, bindingVersion: row.bindingVersion })
    })
  }
}
