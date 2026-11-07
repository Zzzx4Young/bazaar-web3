import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type Account, type PrismaClient } from '../generated/prisma/client.js'
import { type AppConfig } from '../config.js'
import { type Transaction } from '../database/transaction.js'
import { DomainError } from '../common/domain-error.js'
import type { WalletSecurityLedger } from './wallet-security-ledger.js'
import { dummyHash, normalizeLogin, validatePassword, verifyPassword } from './password.js'
import {
  loginIpLimit, loginNameLimit, loginWindowSeconds, maxConcurrentHashesPerInstance,
  sessionMaxAgeSeconds
} from './auth-policy.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const csrfToken = (token: string) => digest(`csrf:${token}`)
export type AuthMethod = 'password' | 'email_code' | 'email_code_dev' | 'google_oidc' | 'wallet_siwe'
export interface Authenticated {
  token: string
  tokenHash: string
  account: Account
  createdAt: Date
  authMethod: AuthMethod | null
  authenticatedAt: Date | null
}

export class AuthService {
  private activeHashes = 0

  constructor(
    readonly client: PrismaClient,
    readonly config: AppConfig,
    private readonly walletLedger?: WalletSecurityLedger
  ) {}

  private async consume(key: string, limit: number) {
    // The database row lock serializes attempts from all API instances. Store only
    // a digest of the IP or normalized login name, never the raw identifier.
    const rows = await this.client.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthRateBucket" ("key", "count", "windowEnd")
      VALUES (${digest(key)}, 1, statement_timestamp() + ${loginWindowSeconds} * interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateBucket"."windowEnd" <= statement_timestamp()
          THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
        "windowEnd" = CASE WHEN "AuthRateBucket"."windowEnd" <= statement_timestamp()
          THEN statement_timestamp() + ${loginWindowSeconds} * interval '1 second'
          ELSE "AuthRateBucket"."windowEnd" END
      WHERE "AuthRateBucket"."windowEnd" <= statement_timestamp()
        OR "AuthRateBucket"."count" < ${limit}
      RETURNING "count"`
    if (rows.length !== 1) throw new DomainError('RATE_LIMITED')
  }

  async rateLimitGoogleStart(ip: string) {
    await this.consume(`google-start-ip:${ip}`, loginIpLimit)
  }

  async rateLimitWallet(ip: string) {
    await this.consume(`wallet-ip:${ip}`, loginIpLimit)
  }

  async verifyWalletPassword(auth: Authenticated, password: string, ip: string) {
    await this.rateLimitWallet(ip)
    await this.consume(`wallet-account:${auth.account.id}`, loginNameLimit)
    if (this.activeHashes >= maxConcurrentHashesPerInstance) throw new DomainError('RATE_LIMITED')
    this.activeHashes++
    try {
      const credential = await this.client.accountCredential.findUnique({ where: { accountId: auth.account.id } })
      const correct = await verifyPassword(password, credential?.passwordHash ?? dummyHash)
      if (!correct || !credential) throw new DomainError('INVALID_CREDENTIALS')
      return credential.passwordHash
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_INPUT')
        throw new DomainError('INVALID_CREDENTIALS')
      throw error
    } finally { this.activeHashes-- }
  }

  token(cookie: string | undefined) {
    const values = (cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('bazaar_session='))
    if (values.length !== 1) return null
    const token = values[0].slice('bazaar_session='.length)
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
  }

  cookie(token: string, clear = false) {
    return `bazaar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : sessionMaxAgeSeconds}${this.config.secureCookie ? '; Secure' : ''}`
  }

  view(auth: Authenticated) {
    const { id, loginName, displayName, role } = auth.account
    return { account: { id, loginName, displayName, role }, csrfToken: csrfToken(auth.token) }
  }

  async authenticate(cookie: string | undefined): Promise<Authenticated> {
    const token = this.token(cookie)
    if (!token) throw new DomainError('UNAUTHENTICATED')
    const tokenHash = digest(token)
    const session = await this.client.session.findUnique({
      where: { tokenHash },
      include: { account: true }
    })
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.account.status !== 'active'
    )
      throw new DomainError('UNAUTHENTICATED')
    if (session.authMethod === 'wallet_siwe' && !this.walletLedger)
      throw new DomainError('WALLET_UNAVAILABLE')
    if (this.walletLedger) {
      if (session.recoveryEpoch !== await this.walletLedger.recoveryEpoch())
        throw new DomainError('UNAUTHENTICATED')
      if (session.authMethod === 'wallet_siwe') {
        if (!session.walletChainId || !session.walletAddress || session.walletBindingVersion === null)
          throw new DomainError('UNAUTHENTICATED')
        const head = await this.walletLedger.read(session.accountId, session.walletChainId)
        if (head.address !== session.walletAddress || head.bindingVersion !== session.walletBindingVersion)
          throw new DomainError('UNAUTHENTICATED')
        const row = await this.client.walletIdentity.findUnique({ where: { accountId_chainId: {
          accountId: session.accountId, chainId: session.walletChainId } } })
        await this.walletLedger.assertProjection({ accountId: session.accountId, chainId: session.walletChainId,
          address: row?.address as `0x${string}` | null ?? null, bindingVersion: row?.bindingVersion ?? 0,
          revision: String(row?.securityRevision ?? 0) })
      }
    }
    return { token, tokenHash, account: session.account, createdAt: session.createdAt,
      authMethod: session.authMethod as AuthMethod | null,
      authenticatedAt: session.authenticatedAt }
  }

  async issueSession(tx: Transaction, account: Account, cookie: string | undefined,
    authMethod: AuthMethod, wallet?: { chainId: number; address: string; bindingVersion: number }): Promise<Authenticated> {
    if (authMethod === 'wallet_siwe' && (!wallet || !this.walletLedger))
      throw new DomainError('WALLET_UNAVAILABLE')
    const recoveryEpoch = this.walletLedger ? await this.walletLedger.recoveryEpoch() : undefined
    const token = randomBytes(32).toString('base64url')
    const tokenHash = digest(token)
    const now = new Date()
    const old = this.token(cookie)
    if (old)
      await tx.session.updateMany({
        where: { tokenHash: digest(old), revokedAt: null },
        data: { revokedAt: now }
      })
    await tx.session.create({
      data: { tokenHash, accountId: account.id, authMethod, authenticatedAt: now,
        recoveryEpoch, walletChainId: wallet?.chainId, walletAddress: wallet?.address,
        walletBindingVersion: wallet?.bindingVersion,
        expiresAt: new Date(now.getTime() + sessionMaxAgeSeconds * 1000) }
    })
    return { token, tokenHash, account, createdAt: now, authMethod, authenticatedAt: now }
  }

  checkCsrf(auth: Authenticated, header: string | string[] | undefined) {
    if (
      typeof header !== 'string' ||
      !/^[0-9a-f]{64}$/.test(header) ||
      !timingSafeEqual(Buffer.from(header, 'hex'), Buffer.from(csrfToken(auth.token), 'hex'))
    )
      throw new DomainError('CSRF_REJECTED')
  }

  async requireRecentAccountProof(auth: Authenticated, password: string | undefined, ip: string) {
    if (auth.account.role !== 'participant') throw new DomainError('FORBIDDEN')
    const credential = await this.client.accountCredential.findUnique({ where: { accountId: auth.account.id } })
    if (!credential) {
      if (!auth.authMethod || !auth.authenticatedAt ||
          Date.now() - auth.authenticatedAt.getTime() > 300_000)
        throw new DomainError('INVALID_CREDENTIALS')
      return
    }
    await this.consume(`ip:${ip}`, loginIpLimit)
    await this.consume(`login:${auth.account.loginName}`, loginNameLimit)
    if (!password || !(await verifyPassword(password, credential.passwordHash)))
      throw new DomainError('INVALID_CREDENTIALS')
  }

  async login(loginName: string, password: string, ip: string, cookie?: string) {
    await this.consume(`ip:${ip}`, loginIpLimit)
    const normalized = normalizeLogin(loginName)
    validatePassword(password)
    await this.consume(`login:${normalized}`, loginNameLimit)
    if (this.activeHashes >= maxConcurrentHashesPerInstance) throw new DomainError('RATE_LIMITED')
    this.activeHashes++
    try {
      const account = await this.client.account.findUnique({
        where: { loginName: normalized },
        include: { credential: true }
      })
      const correct = await verifyPassword(password, account?.credential?.passwordHash ?? dummyHash)
      if (!correct || !account || account.status !== 'active')
        throw new DomainError('INVALID_CREDENTIALS')
      // Recheck under a row lock so password reset/disable cannot race a newly issued session.
      return await this.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${account.id}::uuid FOR UPDATE`
        const current = await tx.account.findUniqueOrThrow({
          where: { id: account.id },
          include: { credential: true }
        })
        if (
          current.status !== 'active' ||
          current.credential?.passwordHash !== account.credential?.passwordHash
        )
          throw new DomainError('INVALID_CREDENTIALS')
        return this.issueSession(tx, current, cookie, 'password')
      })
    } finally {
      this.activeHashes--
    }
  }

  async logout(auth: Authenticated) {
    await this.client.session.updateMany({
      where: { tokenHash: auth.tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  }
}
