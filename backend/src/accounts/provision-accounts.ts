import { type PrismaClient } from '../generated/prisma/client.js'
import { hashPassword, normalizeLogin } from '../auth/password.js'
import { DomainError } from '../common/domain-error.js'

interface SeedAccount {
  loginName: string
  displayName: string
  password: string
}

export async function provisionAccounts(client: PrismaClient, input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50)
    throw new DomainError('INVALID_INPUT')
  const accounts: SeedAccount[] = []
  for (const item of input) {
    if (
      !item ||
      typeof item !== 'object' ||
      Object.keys(item).sort().join(',') !== 'displayName,loginName,password' ||
      typeof item.displayName !== 'string' ||
      !item.displayName.trim() ||
      [...item.displayName].length > 80
    )
      throw new DomainError('INVALID_INPUT')
    accounts.push({
      loginName: normalizeLogin(item.loginName),
      displayName: item.displayName.trim(),
      password: item.password
    })
  }
  if (new Set(accounts.map((account) => account.loginName)).size !== accounts.length)
    throw new DomainError('INVALID_INPUT')
  const prepared: Array<{ loginName: string; displayName: string; passwordHash: string }> = []
  for (const { password, ...account } of accounts)
    prepared.push({ ...account, passwordHash: await hashPassword(password) })
  await client.$transaction(
    async (tx) => {
      for (const { passwordHash, ...account } of prepared) {
        await tx.account.create({ data: { ...account, credential: { create: { passwordHash } } } })
      }
    },
    { timeout: 10000 }
  )
  return prepared.length
}

export async function resetPassword(client: PrismaClient, loginName: string, password: string) {
  const login = normalizeLogin(loginName)
  const passwordHash = await hashPassword(password)
  await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "loginName" = ${login} FOR UPDATE`
    const account = await tx.account.findUnique({ where: { loginName: login } })
    if (!account) throw new DomainError('NOT_FOUND')
    await tx.accountCredential.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, passwordHash },
      update: { passwordHash }
    })
    await tx.session.updateMany({
      where: { accountId: account.id, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  })
}
