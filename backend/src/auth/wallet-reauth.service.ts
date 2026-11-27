import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Prisma, PrismaClient, WalletChallenge } from '../generated/prisma/client.js'
import type { AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { AuthService, type Authenticated } from './auth.service.js'
import { WalletAuthService, type WalletPurpose } from './wallet-auth.service.js'
import { createEmailCode, normalizeGmail, type EmailSender, type EmailCodeLocale } from './email-code.js'
import type { GoogleClient } from './google-client.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const data = (row: WalletChallenge) => row.payload as Prisma.JsonObject
const view = (row: WalletChallenge) => {
 const locale = (row.payload as Prisma.JsonObject | null)?.browserLocale
 return { id: row.id, expiresAt: row.expiresAt.toISOString(), ...(['en','zh-CN'].includes(String(locale)) ? {locale: String(locale)} : {}) }
}
const cookieName = 'bazaar_wallet_oauth'

export class WalletReauthService {
  constructor(private readonly client: PrismaClient, private readonly auth: AuthService,
    private readonly wallets: WalletAuthService, private readonly config: AppConfig,
    private readonly sender: EmailSender | null, private readonly google: GoogleClient | null) {
    if (sender && !['email_delivery', 'dev_inbox'].includes(sender.provenance))
      throw new Error('Email sender provenance must be explicit')
  }

  private async limit(accountId: string, ip: string, scope: string, max: number) {
    await this.auth.rateLimitWallet(ip)
    const key = hash(`wallet-reauth:${scope}:${accountId}`)
    const rows = await this.client.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthRateBucket" ("key", "count", "windowEnd")
      VALUES (${key}, 1, clock_timestamp() + interval '15 minutes')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateBucket"."windowEnd" <= clock_timestamp() THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
        "windowEnd" = CASE WHEN "AuthRateBucket"."windowEnd" <= clock_timestamp()
          THEN clock_timestamp() + interval '15 minutes' ELSE "AuthRateBucket"."windowEnd" END
      WHERE "AuthRateBucket"."windowEnd" <= clock_timestamp() OR "AuthRateBucket"."count" < ${max}
      RETURNING "count"`
    if (rows.length !== 1) throw new DomainError('RATE_LIMITED')
  }

  private digest(row: Pick<WalletChallenge, 'accountId' | 'sessionHash' | 'purpose' | 'wallet' | 'payload'>, code: string) {
    if (!this.config.emailCodeKey) throw new DomainError('EMAIL_UNAVAILABLE')
    const payload = row.payload as Prisma.JsonObject
    return createHmac('sha256', this.config.emailCodeKey).update(JSON.stringify([
      'wallet_reauth', payload.tokenId, payload.email, payload.source,
      row.accountId, row.sessionHash, row.purpose, row.wallet, code
    ])).digest('hex')
  }

  async requestEmail(auth: Authenticated, purpose: WalletPurpose, address: string, key: string,
    locale: EmailCodeLocale, ip: string) {
    if (!this.sender || !this.config.emailCodeKey) throw new DomainError('EMAIL_UNAVAILABLE')
    await this.limit(auth.account.id, ip, 'email-send', 5)
    const identity = await this.client.accountIdentity.findUnique({ where: { accountId_provider: {
      accountId: auth.account.id, provider: 'email' } } })
    if (!identity?.verifiedAt) throw new DomainError('ACCOUNT_LINK_REQUIRED')
    const email = normalizeGmail(identity.subject), code = createEmailCode()
    const payload = { tokenId: randomUUID(), email, identityId: identity.id,
      source: this.sender.provenance === 'dev_inbox' ? 'email_code_dev' : 'email_code',
      identityVerifiedAt: identity.verifiedAt.toISOString(), attempts: 0 }
    const codeHash = this.digest({ accountId: auth.account.id, sessionHash: auth.tokenHash, purpose,
      wallet: address.toLowerCase(), payload }, code)
    const { row, created } = await this.wallets.startProviderProof(auth, purpose, address, key,
      'email', { ...payload, codeHash })
    if (created) {
      try { await this.sender.send({ to: email, code, challengeId: row.id, purpose: 'wallet_reauth', locale }) }
      catch {
        await this.client.walletChallenge.updateMany({ where: { id: row.id }, data: { invalidatedAt: new Date() } })
        throw new DomainError('EMAIL_UNAVAILABLE')
      }
    }
    return view(row)
  }

  async verifyEmail(auth: Authenticated, id: string, code: string, ip: string) {
    if (!this.sender || !this.config.emailCodeKey) throw new DomainError('EMAIL_UNAVAILABLE')
    if (!/^\d{6}$/.test(code)) throw new DomainError('INVALID_INPUT')
    await this.limit(auth.account.id, ip, 'email-verify', 10)
    const result = await this.wallets.providerTransaction(auth, id, 'email', async (tx, row) => {
      const payload = data(row), attempts = Number(payload.attempts ?? 0)
      if (attempts >= 5) return null
      if (payload.source !== (this.sender!.provenance === 'dev_inbox' ? 'email_code_dev' : 'email_code')) return null
      const identity = await tx.accountIdentity.findUnique({ where: { accountId_provider: {
        accountId: auth.account.id, provider: 'email' } } })
      if (!identity?.verifiedAt || identity.id !== payload.identityId || identity.subject !== payload.email ||
        identity.verifiedAt.toISOString() !== payload.identityVerifiedAt) return null
      const correct = typeof payload.codeHash === 'string' && /^[a-f0-9]{64}$/.test(payload.codeHash) &&
        timingSafeEqual(Buffer.from(this.digest(row, code), 'hex'), Buffer.from(payload.codeHash, 'hex'))
      if (!correct) {
        await tx.walletChallenge.update({ where: { id }, data: { payload: { ...payload, attempts: attempts + 1 } } })
        return null // Commit failures; throwing here would roll the count back.
      }
      const verified = await tx.walletChallenge.update({ where: { id }, data: { kind: 'reauth',
        payload: { ...payload } } })
      return view(verified)
    })
    if (!result) throw new DomainError('INVALID_CREDENTIALS')
    return result
  }

  cookie(value = '', clear = false, remainingSeconds = 300) {
    return `${cookieName}=${value}; Path=/api/auth/wallet/reauth/google; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : remainingSeconds}${this.config.secureCookie ? '; Secure' : ''}`
  }

  private browserToken(auth: Authenticated, purpose: string, address: string, stateToken: string) {
    if (!this.config.googleOAuth) throw new DomainError('GOOGLE_UNAVAILABLE')
    return createHmac('sha256', this.config.googleOAuth.clientSecret).update(JSON.stringify([
      'wallet-oauth-cookie:v1', stateToken, auth.account.id, auth.tokenHash, purpose, address.toLowerCase()
    ])).digest('base64url')
  }

  async startGoogle(auth: Authenticated, purpose: WalletPurpose, address: string, key: string, ip: string, locale?: 'en' | 'zh-CN') {
    if (!this.google) throw new DomainError('GOOGLE_UNAVAILABLE')
    await this.limit(auth.account.id, ip, 'google-start', 5)
    const identity = await this.client.accountIdentity.findUnique({ where: { accountId_provider: {
      accountId: auth.account.id, provider: 'google' } } })
    if (!identity?.verifiedAt) throw new DomainError('ACCOUNT_LINK_REQUIRED')
    const stateToken = token(), verifier = token(), nonce = token()
    const browserToken = this.browserToken(auth, purpose, address, stateToken)
    const { row } = await this.wallets.startProviderProof(auth, purpose, address, key, 'google', {
      stateToken, cookieHash: hash(browserToken), verifier, nonce,
      ...(locale ? {browserLocale: locale} : {}),
      identityId: identity.id, subject: identity.subject, identityVerifiedAt: identity.verifiedAt.toISOString()
    })
    // Recover the same cookie on response loss without storing its plaintext.
    // Retry lifetime remains bounded by the original server deadline.
    const stored = data(row)
    const originalToken = this.browserToken(auth, purpose, address, String(stored.stateToken))
    if (hash(originalToken) !== stored.cookieHash) throw new DomainError('GOOGLE_INVALID')
    const cookie = this.cookie(originalToken, false, Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)))
    if (typeof stored.authorizationUrl === 'string')
      return { ...view(row), authorizationUrl: stored.authorizationUrl, cookie }
    const state = `${row.id}.${stored.stateToken}`
    const url = new URL(this.google.authorizeUrl({ state, verifier: String(stored.verifier), nonce: String(stored.nonce) }))
    url.searchParams.set('prompt', 'select_account')
    await this.wallets.providerTransaction(auth, row.id, 'google', async (tx, current) => {
      await tx.walletChallenge.update({ where: { id: current.id },
        data: { payload: { ...data(current), authorizationUrl: url.toString() } } })
    })
    return { ...view(row), authorizationUrl: url.toString(), cookie }
  }

  async completeGoogle(auth: Authenticated, state: string, code: string, cookies: string) {
    if (!this.google) throw new DomainError('GOOGLE_UNAVAILABLE')
    const match = state.match(/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/)
    const values = cookies.split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName}=`))
    if (!match || values.length !== 1 || !code || code.length > 4096) throw new DomainError('GOOGLE_INVALID')
    const cookieHash = hash(values[0].slice(cookieName.length + 1)), id = match[1]
    const claimed = await this.wallets.providerTransaction(auth, id, 'google', async (tx, row) => {
      const payload = data(row)
      if (payload.stateToken !== match[2] || payload.cookieHash !== cookieHash) throw new DomainError('GOOGLE_INVALID')
      if (row.kind === 'reauth') return { row, done: true }
      if (payload.claimed) throw new DomainError('GOOGLE_INVALID')
      await tx.walletChallenge.update({ where: { id }, data: { payload: { ...payload, claimed: true } } })
      return { row, done: false }
    })
    if (claimed.done) return view(claimed.row)
    const payload = data(claimed.row)
    try {
      const profile = await this.google.exchange({ code, verifier: String(payload.verifier), nonce: String(payload.nonce) })
      return await this.wallets.providerTransaction(auth, id, 'google', async (tx, row) => {
        const identity = await tx.accountIdentity.findUnique({ where: { accountId_provider: {
          accountId: auth.account.id, provider: 'google' } } })
        if (!identity?.verifiedAt || identity.id !== payload.identityId || identity.subject !== payload.subject ||
          profile.sub !== identity.subject || identity.verifiedAt.toISOString() !== payload.identityVerifiedAt)
          throw new DomainError('INVALID_CREDENTIALS')
        const retained = { ...data(row) }
        delete retained.verifier
        delete retained.nonce
        return view(await tx.walletChallenge.update({ where: { id }, data: { kind: 'reauth',
          payload: { ...retained, source: 'google_oidc' } } }))
      })
    } catch (error) {
      await this.client.walletChallenge.updateMany({ where: { id, kind: 'provider_google' },
        data: { invalidatedAt: new Date() } })
      throw error
    }
  }
}
