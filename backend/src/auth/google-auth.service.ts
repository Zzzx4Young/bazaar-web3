import { createHash, randomBytes } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { type AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { AuthService, type Authenticated } from './auth.service.js'
import { type GoogleClient } from './google-client.js'
import { gmailIdentityKey } from './email-code.js'
import { recordIdentityEvent } from './identity-event.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const cookieName = 'bazaar_google_state'

export class GoogleAuthService {
  constructor(private readonly client: PrismaClient, private readonly config: AppConfig,
    private readonly auth: AuthService, private readonly provider: GoogleClient | null) {}

  get enabled() { return Boolean(this.provider && this.config.googleOAuth) }

  private requireProvider() {
    if (!this.enabled) throw new DomainError('GOOGLE_UNAVAILABLE')
    return this.provider!
  }

  cookie(value: string, clear = false, locale: 'zh-CN' | 'en' = 'zh-CN') {
    return `${cookieName}=${clear ? '' : `${value}.${locale}`}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 300}${this.config.secureCookie ? '; Secure' : ''}`
  }

  private cookieValue(header?: string) {
    const values = (header ?? '').split(';').map(part => part.trim())
      .filter(part => part.startsWith(`${cookieName}=`))
    if (values.length !== 1) return null
    return values[0].slice(cookieName.length + 1)
  }

  private readCookie(header?: string) {
    const value = this.cookieValue(header)
    const match = value?.match(/^([A-Za-z0-9_-]{43})(?:\.(?:zh-CN|en))?$/)
    return match?.[1] ?? null
  }

  callbackLocale(header?: string): 'zh-CN' | 'en' {
    const value = this.cookieValue(header)
    return value?.match(/^[A-Za-z0-9_-]{43}\.en$/) ? 'en' : 'zh-CN'
  }

  private returnPath(value?: string) {
    if (!value) return '/zh-CN/me'
    if (value.length > 255 || !/^\/(?!\/)[\w\-/?.=&%#+]*$/.test(value) || value.includes('\\'))
      throw new DomainError('INVALID_INPUT')
    return value
  }

  async start(returnTo: string | undefined, mode: 'login' | 'bind', ip: string,
    accountId?: string) {
    const provider = this.requireProvider()
    const path = this.returnPath(returnTo)
    await this.auth.rateLimitGoogleStart(ip)
    const state = token(), browserToken = token(), verifier = token(), nonce = token()
    await this.client.googleOAuthAttempt.create({ data: {
      stateHash: digest(state), cookieHash: digest(browserToken), verifier, nonce,
      returnTo: path, mode, accountId,
      expiresAt: new Date(Date.now() + 300_000)
    } })
    return { authorizationUrl: provider.authorizeUrl({ state, nonce, verifier }),
      cookie: this.cookie(browserToken, false, /^\/en(?:\/|$)/.test(path) ? 'en' : 'zh-CN') }
  }

  async complete(state: string, code: string, cookies?: string): Promise<{
    auth: Authenticated; returnTo: string
  }> {
    const provider = this.requireProvider()
    const browserToken = this.readCookie(cookies)
    if (!browserToken || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096)
      throw new DomainError('GOOGLE_INVALID')
    const attempt = await this.client.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ stateHash: string }[]>`
        UPDATE "GoogleOAuthAttempt" SET "consumedAt" = clock_timestamp()
        WHERE "stateHash" = ${digest(state)} AND "cookieHash" = ${digest(browserToken)}
          AND "consumedAt" IS NULL AND "expiresAt" > clock_timestamp()
        RETURNING "stateHash"`
      return rows.length ? tx.googleOAuthAttempt.findUnique({ where: { stateHash: rows[0].stateHash } }) : null
    })
    if (!attempt) throw new DomainError('GOOGLE_INVALID')
    const profile = await provider.exchange({ code, verifier: attempt.verifier, nonce: attempt.nonce })
    const bindingAuth = attempt.mode === 'bind' ? await this.auth.authenticate(cookies) : null
    if (attempt.mode === 'bind' && bindingAuth?.account.id !== attempt.accountId)
      throw new DomainError('FORBIDDEN')
    const auth = await this.client.$transaction(async tx => {
      const profileKey = gmailIdentityKey(profile.email)
      const existing = await tx.accountIdentity.findUnique({
        where: { provider_subject: { provider: 'google', subject: profile.sub } },
        include: { account: true }
      })
      if (attempt.mode === 'bind') {
        if (!attempt.accountId) throw new DomainError('GOOGLE_INVALID')
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${attempt.accountId}::uuid FOR UPDATE`
        const account = await tx.account.findUniqueOrThrow({ where: { id: attempt.accountId } })
        if (account.role !== 'participant' || account.status !== 'active') throw new DomainError('FORBIDDEN')
        if (existing && existing.accountId !== account.id) throw new DomainError('ACCOUNT_LINK_REQUIRED')
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${profileKey}, 0))::text AS locked`
        const claim = await tx.gmailClaim.findUnique({ where: { key: profileKey } })
        if (claim && claim.accountId !== account.id) throw new DomainError('ACCOUNT_LINK_REQUIRED')
        const otherEmail = await tx.accountIdentity.findUnique({
          where: { provider_subject: { provider: 'email', subject: profile.email } }
        })
        if (otherEmail && otherEmail.accountId !== account.id)
          throw new DomainError('ACCOUNT_LINK_REQUIRED')
        const nameOwner = await tx.account.findUnique({ where: { loginName: profile.email } })
        if (nameOwner && nameOwner.id !== account.id)
          throw new DomainError('ACCOUNT_LINK_REQUIRED')
        if (!claim) await tx.gmailClaim.create({
          data: { key: profileKey, accountId: account.id }
        })
        const previous = await tx.accountIdentity.findUnique({
          where: { accountId_provider: { accountId: account.id, provider: 'google' } }
        })
        const verifiedAt = new Date()
        await tx.accountIdentity.upsert({
          where: { accountId_provider: { accountId: account.id, provider: 'google' } },
          create: { accountId: account.id, provider: 'google', subject: profile.sub,
            email: profile.email, verifiedAt, verificationSource: 'google_oidc' },
          update: { subject: profile.sub, email: profile.email,
            verifiedAt, verificationSource: 'google_oidc' }
        })
        await recordIdentityEvent(tx, { accountId: account.id, provider: 'google',
          action: !previous ? 'bind' : previous.subject === profile.sub ? 'reverify' : 'replace',
          previousSubject: previous?.subject, currentSubject: profile.sub,
          previousEmail: previous?.email, currentEmail: profile.email,
          verificationSource: 'google_oidc' })
        if (previous && gmailIdentityKey(previous.email) !== profileKey) {
          const previousKey = gmailIdentityKey(previous.email)
          const emailIdentity = await tx.accountIdentity.findUnique({
            where: { accountId_provider: { accountId: account.id, provider: 'email' } }
          })
          const loginNameKey = account.loginName.toLowerCase().endsWith('@gmail.com')
            ? gmailIdentityKey(account.loginName) : null
          const emailKey = emailIdentity ? gmailIdentityKey(emailIdentity.subject) : null
          if (loginNameKey !== previousKey && emailKey !== previousKey)
            await tx.gmailClaim.deleteMany({ where: { key: previousKey, accountId: account.id } })
        }
        return this.auth.issueSession(tx, account, cookies, 'google_oidc')
      }
      if (existing) {
        if (existing.account.status !== 'active' || existing.account.role !== 'participant')
          throw new DomainError('INVALID_CREDENTIALS')
        return this.auth.issueSession(tx, existing.account, cookies, 'google_oidc')
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${profileKey}, 0))::text AS locked`
      if (await tx.gmailClaim.findUnique({ where: { key: profileKey } }))
        throw new DomainError('ACCOUNT_LINK_REQUIRED')
      const sameEmail = await tx.accountIdentity.findUnique({
        where: { provider_subject: { provider: 'email', subject: profile.email } }
      })
      if (sameEmail || await tx.account.findUnique({ where: { loginName: profile.email } }))
        throw new DomainError('ACCOUNT_LINK_REQUIRED')
      const account = await tx.account.create({
        data: { loginName: profileKey, displayName: profile.name }
      })
      await tx.gmailClaim.create({ data: { key: profileKey, accountId: account.id } })
      await tx.accountIdentity.create({
        data: { accountId: account.id, provider: 'google', subject: profile.sub,
          email: profile.email, verifiedAt: new Date(), verificationSource: 'google_oidc' }
      })
      await recordIdentityEvent(tx, { accountId: account.id, provider: 'google',
        action: 'register', currentSubject: profile.sub, currentEmail: profile.email,
        verificationSource: 'google_oidc' })
      return this.auth.issueSession(tx, account, cookies, 'google_oidc')
    })
    return { auth, returnTo: attempt.returnTo }
  }
}
