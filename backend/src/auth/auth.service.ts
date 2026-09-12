import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type Account, type PrismaClient } from '../generated/prisma/client.js'
import { type AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { dummyHash, normalizeLogin, validatePassword, verifyPassword } from './password.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const csrfToken = (token: string) => digest(`csrf:${token}`)
export interface Authenticated {
  token: string
  tokenHash: string
  account: Account
}

export class AuthService {
  private readonly buckets = new Map<string, { count: number; end: number }>()
  private activeHashes = 0

  constructor(
    readonly client: PrismaClient,
    readonly config: AppConfig
  ) {}

  private consume(key: string, limit: number) {
    const now = Date.now()
    for (const [name, bucket] of this.buckets) if (bucket.end <= now) this.buckets.delete(name)
    const bucket = this.buckets.get(key)
    if (bucket) {
      if (bucket.count >= limit) throw new DomainError('RATE_LIMITED')
      bucket.count++
    } else {
      if (this.buckets.size >= 10000) throw new DomainError('RATE_LIMITED')
      this.buckets.set(key, { count: 1, end: now + 60000 })
    }
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
    return `bazaar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 43200}${this.config.secureCookie ? '; Secure' : ''}`
  }

  view(auth: Authenticated) {
    const { id, loginName, displayName } = auth.account
    return { account: { id, loginName, displayName }, csrfToken: csrfToken(auth.token) }
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
    return { token, tokenHash, account: session.account }
  }

  checkCsrf(auth: Authenticated, header: string | string[] | undefined) {
    if (
      typeof header !== 'string' ||
      !/^[0-9a-f]{64}$/.test(header) ||
      !timingSafeEqual(Buffer.from(header, 'hex'), Buffer.from(csrfToken(auth.token), 'hex'))
    )
      throw new DomainError('CSRF_REJECTED')
  }

  async login(loginName: string, password: string, ip: string, cookie?: string) {
    this.consume(`ip:${ip}`, 10)
    const normalized = normalizeLogin(loginName)
    validatePassword(password)
    this.consume(`login:${normalized}`, 5)
    if (this.activeHashes >= 2) throw new DomainError('RATE_LIMITED')
    this.activeHashes++
    try {
      const account = await this.client.account.findUnique({
        where: { loginName: normalized },
        include: { credential: true }
      })
      const correct = await verifyPassword(password, account?.credential?.passwordHash ?? dummyHash)
      if (!correct || !account || account.status !== 'active')
        throw new DomainError('INVALID_CREDENTIALS')
      const token = randomBytes(32).toString('base64url')
      const tokenHash = digest(token)
      const old = this.token(cookie)
      // Recheck under a row lock so password reset/disable cannot race a newly issued session.
      await this.client.$transaction(async (tx) => {
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
        const now = new Date()
        if (old)
          await tx.session.updateMany({
            where: { tokenHash: digest(old), revokedAt: null },
            data: { revokedAt: now }
          })
        await tx.session.create({
          data: { tokenHash, accountId: account.id, expiresAt: new Date(now.getTime() + 43200000) }
        })
      })
      return { token, tokenHash, account }
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
