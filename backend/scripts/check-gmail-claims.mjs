import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { findGmailClaimIssues } from '../dist/auth/gmail-claims-check.js'

const maxRows = 50_000
const config = readConfig()
const database = new DatabaseService(config.databaseUrl, config.databasePool)
try {
  await database.onModuleInit()
  const input = await database.client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`
    const [accounts, identities, claims] = await Promise.all([
      tx.account.findMany({ select: { id: true, loginName: true }, take: maxRows + 1 }),
      tx.accountIdentity.findMany({ select: { accountId: true, provider: true,
        subject: true, email: true }, take: maxRows + 1 }),
      tx.gmailClaim.findMany({ select: { key: true, accountId: true }, take: maxRows + 1 })
    ])
    if ([accounts, identities, claims].some(rows => rows.length > maxRows))
      throw new Error('ROW_LIMIT')
    return { accounts, identities, claims }
  }, { isolationLevel: 'RepeatableRead' })
  const issues = findGmailClaimIssues(input)
  const counts = Object.fromEntries([...new Set(issues.map(issue => issue.kind))]
    .map(kind => [kind, issues.filter(issue => issue.kind === kind).length]))
  console.log(JSON.stringify({ checked: {
    accounts: input.accounts.length, identities: input.identities.length,
    claims: input.claims.length }, issues: issues.length, counts,
    sample: issues.slice(0, 20) }))
  if (issues.length) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error && error.message === 'ROW_LIMIT'
    ? `Claim inspection exceeds ${maxRows} rows per table; use a paged audit`
    : 'Claim inspection failed; check database access and migrations')
  process.exitCode = 1
} finally {
  await database.onModuleDestroy()
}
