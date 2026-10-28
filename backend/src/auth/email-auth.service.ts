import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { type AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { AuthService, type Authenticated } from './auth.service.js'
import { codeDigest, createEmailCode, gmailIdentityKey, normalizeGmail, type EmailSender,
  type EmailCodeLocale, type EmailCodePurpose } from './email-code.js'
import { recordIdentityEvent } from './identity-event.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export class EmailAuthService {
  constructor(
    private readonly client: PrismaClient,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sender: EmailSender | null
  ) {
    if (sender && !['email_delivery', 'dev_inbox'].includes(sender.provenance))
      throw new Error('Email sender provenance must be explicit')
  }

  get enabled() { return Boolean(this.sender && this.config.emailCodeKey) }

  private key() {
    if (!this.sender || !this.config.emailCodeKey) throw new DomainError('EMAIL_UNAVAILABLE')
    return this.config.emailCodeKey
  }

  private challengeKey(email: string, purpose: EmailCodePurpose) {
    return createHmac('sha256', this.key()).update(JSON.stringify([email, purpose])).digest('hex')
  }

  private async limit(bucket: string, max: number, seconds: number) {
    const key = hash(bucket)
    const rows = await this.client.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthRateBucket" ("key", "count", "windowEnd")
      VALUES (${key}, 1, clock_timestamp() + ${seconds} * interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateBucket"."windowEnd" <= clock_timestamp()
          THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
        "windowEnd" = CASE WHEN "AuthRateBucket"."windowEnd" <= clock_timestamp()
          THEN clock_timestamp() + ${seconds} * interval '1 second'
          ELSE "AuthRateBucket"."windowEnd" END
      WHERE "AuthRateBucket"."windowEnd" <= clock_timestamp()
        OR "AuthRateBucket"."count" < ${max}
      RETURNING "count"`
    if (rows.length !== 1) {
      const remaining = await this.client.$queryRaw<{ retryAfterSeconds: number }[]>`
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("windowEnd" - clock_timestamp())))::int)
          AS "retryAfterSeconds" FROM "AuthRateBucket" WHERE "key" = ${key}`
      throw new DomainError('RATE_LIMITED', remaining[0]?.retryAfterSeconds ?? seconds)
    }
  }

  async request(emailInput: string, locale: EmailCodeLocale, ip: string,
    purpose: EmailCodePurpose = 'login', accountId: string | null = null) {
    const key = this.key()
    const email = normalizeGmail(emailInput)
    await this.limit(`email-send:${gmailIdentityKey(email)}`, 5, 3600)
    await this.limit(`email-send-ip:${ip}`, 20, 3600)
    const challengeKey = this.challengeKey(email, purpose)
    const id = randomUUID()
    const code = createEmailCode()
    const codeHash = codeDigest(key, id, email, purpose, code)
    const rows = await this.client.$queryRaw<{ key: string }[]>`
      INSERT INTO "EmailCodeChallenge" ("key", "id", "email", "purpose", "accountId",
        "codeHash", "attempts", "createdAt", "expiresAt", "consumedAt")
      VALUES (${challengeKey}, ${id}::uuid, ${email}, ${purpose}, ${accountId}::uuid,
        ${codeHash}, 0, clock_timestamp(), clock_timestamp() + interval '5 minutes', NULL)
      ON CONFLICT ("key") DO UPDATE SET
        "id" = EXCLUDED."id", "accountId" = EXCLUDED."accountId",
        "codeHash" = EXCLUDED."codeHash", "attempts" = 0,
        "createdAt" = clock_timestamp(),
        "expiresAt" = clock_timestamp() + interval '5 minutes', "consumedAt" = NULL
      WHERE "EmailCodeChallenge"."consumedAt" IS NOT NULL
        OR "EmailCodeChallenge"."createdAt" <= clock_timestamp() - interval '60 seconds'
      RETURNING "key"`
    if (rows.length !== 1) {
      const remaining = await this.client.$queryRaw<{ retryAfterSeconds: number }[]>`
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
          "createdAt" + interval '60 seconds' - clock_timestamp())))::int)
          AS "retryAfterSeconds" FROM "EmailCodeChallenge" WHERE "key" = ${challengeKey}`
      throw new DomainError('RATE_LIMITED', remaining[0]?.retryAfterSeconds ?? 60)
    }
    try {
      await this.sender!.send({ to: email, locale, purpose, code, challengeId: id })
    } catch {
      await this.client.emailCodeChallenge.updateMany({
        where: { key: challengeKey, id }, data: { consumedAt: new Date() }
      })
      throw new DomainError('EMAIL_UNAVAILABLE')
    }
  }

  async verify(emailInput: string, code: string, ip: string, cookie?: string,
    purpose: EmailCodePurpose = 'login', accountId: string | null = null): Promise<Authenticated> {
    const secret = this.key()
    const email = normalizeGmail(emailInput)
    const identityKey = gmailIdentityKey(email)
    if (!/^\d{6}$/.test(code)) throw new DomainError('INVALID_INPUT')
    await this.limit(`email-verify:${identityKey}`, 10, 3600)
    await this.limit(`email-verify-ip:${ip}`, 30, 3600)
    const key = this.challengeKey(email, purpose)
    const result = await this.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "key" FROM "EmailCodeChallenge" WHERE "key" = ${key} FOR UPDATE`
      const row = await tx.emailCodeChallenge.findUnique({ where: { key } })
      const dbNow = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now
      if (!row || row.consumedAt || row.expiresAt <= dbNow || row.attempts >= 5 ||
          row.accountId !== accountId) return { error: 'INVALID_CREDENTIALS' } as const
      const computed = codeDigest(secret, row.id, email, purpose, code)
      if (!timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(row.codeHash, 'hex'))) {
        await tx.emailCodeChallenge.update({ where: { key }, data: { attempts: { increment: 1 } } })
        // Return normally, so the failed-attempt increment commits.
        return { error: 'INVALID_CREDENTIALS' } as const
      }
      await tx.emailCodeChallenge.update({ where: { key }, data: { consumedAt: dbNow } })
      if (purpose === 'bind' && accountId)
        await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))::text AS locked`
      const claim = await tx.gmailClaim.findUnique({ where: { key: identityKey } })
      const verificationSource = this.sender!.provenance
      const authMethod = verificationSource === 'dev_inbox' ? 'email_code_dev' : 'email_code'
      if (purpose === 'bind') {
        if (!accountId) return { error: 'FORBIDDEN' } as const
        if (claim && claim.accountId !== accountId)
          return { error: 'ACCOUNT_LINK_REQUIRED' } as const
        const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } })
        if (account.role !== 'participant' || account.status !== 'active')
          return { error: 'FORBIDDEN' } as const
        const previous = await tx.accountIdentity.findUnique({
          where: { accountId_provider: { accountId, provider: 'email' } }
        })
        if (!claim) await tx.gmailClaim.create({ data: { key: identityKey, accountId } })
        await tx.accountIdentity.upsert({
          where: { accountId_provider: { accountId, provider: 'email' } },
          create: { accountId, provider: 'email', subject: email, email,
            verifiedAt: dbNow, verificationSource },
          update: { subject: email, email, verifiedAt: dbNow, verificationSource }
        })
        await recordIdentityEvent(tx, { accountId, provider: 'email',
          action: !previous ? 'bind' : previous.subject === email ? 'reverify' : 'replace',
          previousSubject: previous?.subject, currentSubject: email,
          previousEmail: previous?.email, currentEmail: email, verificationSource })
        if (previous && gmailIdentityKey(previous.subject) !== identityKey) {
          const previousKey = gmailIdentityKey(previous.subject)
          const google = await tx.accountIdentity.findUnique({
            where: { accountId_provider: { accountId, provider: 'google' } }
          })
          const loginNameKey = account.loginName.toLowerCase().endsWith('@gmail.com')
            ? gmailIdentityKey(account.loginName) : null
          const googleKey = google?.email.toLowerCase().endsWith('@gmail.com')
            ? gmailIdentityKey(google.email) : null
          if (loginNameKey !== previousKey && googleKey !== previousKey)
            await tx.gmailClaim.deleteMany({ where: { key: previousKey, accountId } })
        }
        return { auth: await this.auth.issueSession(tx, account, cookie, authMethod) } as const
      }
      if (purpose === 'register') {
        if (claim) {
          const linked = await tx.accountIdentity.findUnique({
            where: { accountId_provider: { accountId: claim.accountId, provider: 'email' } }
          })
          return { error: linked && gmailIdentityKey(linked.subject) === identityKey
            ? 'EMAIL_ACCOUNT_EXISTS' : 'ACCOUNT_LINK_REQUIRED' } as const
        }
        if (await tx.account.findUnique({ where: { loginName: identityKey } }))
          return { error: 'ACCOUNT_LINK_REQUIRED' } as const
        const account = await tx.account.create({
          data: { loginName: identityKey, displayName: email.split('@')[0] }
        })
        await tx.gmailClaim.create({ data: { key: identityKey, accountId: account.id } })
        await tx.accountIdentity.create({
          data: { accountId: account.id, provider: 'email', subject: email, email,
            verifiedAt: dbNow, verificationSource }
        })
        await recordIdentityEvent(tx, { accountId: account.id, provider: 'email',
          action: 'register', currentSubject: email, currentEmail: email, verificationSource })
        return { auth: await this.auth.issueSession(tx, account, cookie, authMethod) } as const
      }
      if (!claim) return { error: 'EMAIL_ACCOUNT_NOT_FOUND' } as const
      const identity = await tx.accountIdentity.findUnique({
        where: { accountId_provider: { accountId: claim.accountId, provider: 'email' } },
        include: { account: true }
      })
      if (!identity || gmailIdentityKey(identity.subject) !== identityKey)
        return { error: 'ACCOUNT_LINK_REQUIRED' } as const
      if (identity.account.status !== 'active' || identity.account.role !== 'participant')
        return { error: 'INVALID_CREDENTIALS' } as const
      return { auth: await this.auth.issueSession(tx, identity.account, cookie, authMethod) } as const
    })
    if (result.error) throw new DomainError(result.error)
    return result.auth!
  }
}
