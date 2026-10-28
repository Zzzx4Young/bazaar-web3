import { randomUUID } from 'node:crypto'

export async function applyGmailPlan(client, plan) {
  if (!plan.length) throw new Error('No development accounts to migrate')
  const ids = plan.map(row => row.id)
  await client.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('bazaar-dev-gmail-migration', 0))::text AS locked`
    const accounts = await tx.account.findMany({
      where: { id: { in: ids } }, select: { id: true, loginName: true }
    })
    const current = new Map(accounts.map(row => [row.id, row.loginName]))
    if (accounts.length !== plan.length || await tx.account.count() !== plan.length ||
        plan.some(row => current.get(row.id) !== row.from))
      throw new Error('Development account set changed after preview')
    const targetOwners = await tx.account.findMany({
      where: { loginName: { in: plan.map(row => row.to) } },
      select: { id: true, loginName: true }
    })
    const plannedIds = new Set(ids)
    if (targetOwners.some(row => !plannedIds.has(row.id)))
      throw new Error('Migrated login name belongs to another account')
    const claims = await tx.gmailClaim.findMany({
      where: { key: { in: plan.map(row => row.key) } },
      select: { key: true, accountId: true }
    })
    const expectedOwner = new Map(plan.map(row => [row.key, row.id]))
    if (claims.some(row => expectedOwner.get(row.key) !== row.accountId))
      throw new Error('Gmail identity is already owned by another account')
    const identities = await tx.accountIdentity.findMany({
      where: { accountId: { in: ids } },
      select: { id: true, accountId: true, provider: true, subject: true, email: true }
    })
    if (identities.some(identity => identity.provider !== 'email' ||
      identity.subject !== current.get(identity.accountId) ||
      identity.email !== identity.subject))
      throw new Error('Unexpected account identity; review before migrating')
    const identityByAccount = new Map(identities.map(row => [row.accountId, row]))
    await tx.gmailClaim.deleteMany({ where: { accountId: { in: ids } } })
    for (const row of plan)
      await tx.account.update({ where: { id: row.id },
        data: { loginName: `migration-${row.id}` } })
    for (const row of plan) {
      await tx.account.update({ where: { id: row.id }, data: { loginName: row.to } })
      const identity = identityByAccount.get(row.id)
      if (identity && identity.subject !== row.to) {
        await tx.accountIdentity.update({ where: { id: identity.id },
          data: { subject: row.to, email: row.to,
            verifiedAt: null, verificationSource: null } })
        await tx.$executeRaw`
          INSERT INTO "AccountIdentityEvent" ("id", "accountId", "provider", "action",
            "previousSubject", "currentSubject", "previousEmail", "currentEmail",
            "verificationSource")
          VALUES (${randomUUID()}::uuid, ${row.id}::uuid, 'email', 'migration',
            ${identity.subject}, ${row.to}, ${identity.email}, ${row.to}, 'unknown')`
      }
    }
    await tx.gmailClaim.createMany({
      data: plan.map(row => ({ key: row.key, accountId: row.id }))
    })
    await tx.emailCodeChallenge.deleteMany({ where: { consumedAt: null } })
  }, { isolationLevel: 'Serializable', timeout: 60_000 })
}
