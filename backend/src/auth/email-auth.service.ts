import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { type PrismaClient } from '../generated/prisma/client.js'
import { type AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { AuthService, type Authenticated } from './auth.service.js'
import { codeDigest, createEmailCode, normalizeGmail, type EmailSender,
  type EmailCodeLocale, type EmailCodePurpose } from './email-code.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export class EmailAuthService {
  constructor(
    private readonly client: PrismaClient,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sender: EmailSender | null
  ) {}

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
    if (rows.length !== 1) throw new DomainError('RATE_LIMITED')
  }

  async request(emailInput: string, locale: EmailCodeLocale, ip: string,
    purpose: EmailCodePurpose = 'login', accountId: string | null = null) {
    const key = this.key()
    const email = normalizeGmail(emailInput)
    await this.limit(`email-send:${email}`, 5, 3600)
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
      WHERE "EmailCodeChallenge"."createdAt" <= clock_timestamp() - interval '60 seconds'
      RETURNING "key"`
    if (rows.length !== 1) throw new DomainError('RATE_LIMITED')
    try {
      await this.sender!.send({ to: email, locale, purpose, code })
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
    if (!/^\d{6}$/.test(code)) throw new DomainError('INVALID_INPUT')
    await this.limit(`email-verify:${email}`, 10, 3600)
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
      if (purpose === 'bind') {
        if (!accountId) return { error: 'FORBIDDEN' } as const
        const existing = await tx.accountIdentity.findUnique({
          where: { provider_subject: { provider: 'email', subject: email } }
        })
        if (existing && existing.accountId !== accountId)
          return { error: 'ACCOUNT_LINK_REQUIRED' } as const
        const nameOwner = await tx.account.findUnique({ where: { loginName: email } })
        if (nameOwner && nameOwner.id !== accountId)
          return { error: 'ACCOUNT_LINK_REQUIRED' } as const
        const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } })
        if (account.role !== 'participant' || account.status !== 'active')
          return { error: 'FORBIDDEN' } as const
        await tx.accountIdentity.upsert({
          where: { accountId_provider: { accountId, provider: 'email' } },
          create: { accountId, provider: 'email', subject: email, email },
          update: { subject: email, email }
        })
        return { auth: await this.auth.issueSession(tx, account, cookie) } as const
      }
      const identity = await tx.accountIdentity.findUnique({
        where: { provider_subject: { provider: 'email', subject: email } },
        include: { account: true }
      })
      if (identity && (identity.account.status !== 'active' || identity.account.role !== 'participant'))
        return { error: 'INVALID_CREDENTIALS' } as const
      let account = identity?.account
      if (!account) {
        if (await tx.account.findUnique({ where: { loginName: email } }))
          return { error: 'ACCOUNT_LINK_REQUIRED' } as const
        account = await tx.account.create({ data: { loginName: email, displayName: email.split('@')[0] } })
        await tx.accountIdentity.create({ data: { accountId: account.id, provider: 'email', subject: email, email } })
      }
      return { auth: await this.auth.issueSession(tx, account, cookie) } as const
    })
    if (result.error) throw new DomainError(result.error)
    return result.auth!
  }
}
