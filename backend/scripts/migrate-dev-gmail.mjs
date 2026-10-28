import { createHash } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync,
  unlinkSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseService } from '../dist/database/database.service.js'
import { planGmailAccounts } from './dev-gmail-migration-plan.mjs'
import { applyGmailPlan } from './dev-gmail-migration-apply.mjs'

const privateDir = resolve(import.meta.dirname, '../.tmp')
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function privateFile(path) {
  const absolute = resolve(path)
  if (!absolute.startsWith(`${privateDir}${sep}`)) throw new Error('Use a private backend/.tmp file')
  const info = lstatSync(absolute)
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error('Private file must be a regular file with no group or world access')
  return absolute
}

function target() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('Load the local migrator env file first')
  const url = new URL(raw)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      (url.port || '5432') !== '5432' || url.pathname !== '/bazaar_dev' ||
      decodeURIComponent(url.username) !== 'bazaar_migrate' ||
      url.searchParams.get('schema') !== 'bazaar')
    throw new Error('Refusing a nonlocal or unexpected migration database')
  return { raw, url }
}

async function snapshot(client) {
  const [accounts, identities, listings, orders] = await Promise.all([
    client.account.findMany({ select: { id: true, loginName: true }, orderBy: { id: 'asc' } }),
    client.accountIdentity.findMany({ select: { id: true, accountId: true, provider: true,
      subject: true, email: true }, orderBy: { id: 'asc' } }),
    client.listing.findMany({ select: { id: true, sellerId: true }, orderBy: { id: 'asc' } }),
    client.order.findMany({ select: { id: true, buyerId: true, sellerId: true },
      orderBy: { id: 'asc' } })
  ])
  return { accounts, identities, accountCount: accounts.length,
    emailIdentityCount: identities.filter(row => row.provider === 'email').length,
    relationDigest: digest({ ids: accounts.map(row => row.id), listings, orders }),
    listingCount: listings.length, orderCount: orders.length }
}

function backup(url) {
  mkdirSync(privateDir, { recursive: true, mode: 0o700 })
  const path = resolve(privateDir, `dev-gmail-backup-${Date.now()}.dump`)
  closeSync(openSync(path, 'wx', 0o600))
  const result = spawnSync('pg_dump', [
    '--host', url.hostname, '--port', url.port || '5432', '--username', 'bazaar_migrate',
    '--dbname', 'bazaar_dev', '--schema', 'bazaar', '--format', 'custom', '--file', path
  ], { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 })
  if (result.status !== 0) {
    unlinkSync(path)
    throw new Error('Development database backup failed')
  }
  console.log(`Private backup: ${path}`)
}

async function main() {
  const [mode, planArg, backupArg] = process.argv.slice(2)
  if (!['--preview', '--backup', '--apply'].includes(mode))
    throw new Error('Usage: --preview | --backup | --apply PLAN_FILE BACKUP_FILE')
  const { raw, url } = target()
  if (mode === '--backup') { backup(url); return }
  const db = new DatabaseService(raw)
  try {
    await db.onModuleInit()
    const before = await snapshot(db.client)
    const plan = planGmailAccounts(before.accounts)
    if (before.identities.some(row => row.provider !== 'email' ||
        row.subject !== before.accounts.find(account => account.id === row.accountId)?.loginName ||
        row.email !== row.subject))
      throw new Error('Unexpected identity state; review before migration')
    if (mode === '--preview') {
      mkdirSync(privateDir, { recursive: true, mode: 0o700 })
      const path = resolve(privateDir, `dev-gmail-plan-${Date.now()}.json`)
      writeFileSync(path, JSON.stringify({ plan, relationDigest: before.relationDigest,
        fingerprint: digest({ accounts: before.accounts, identities: before.identities }) }) + '\n',
      { flag: 'wx', mode: 0o600 })
      console.log(JSON.stringify({ planFile: path, accounts: before.accountCount,
        changed: plan.filter(row => row.from !== row.to).length,
        emailIdentities: before.emailIdentityCount, listings: before.listingCount,
        orders: before.orderCount, uniqueKeys: new Set(plan.map(row => row.key)).size }))
      return
    }
    if (!planArg || !backupArg) throw new Error('--apply requires a plan and backup file')
    const saved = JSON.parse(readFileSync(privateFile(planArg), 'utf8'))
    privateFile(backupArg)
    const archive = spawnSync('pg_restore', ['--list', resolve(backupArg)],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 })
    if (archive.status !== 0) throw new Error('Backup archive is invalid')
    if (saved.fingerprint !== digest({ accounts: before.accounts, identities: before.identities }) ||
        saved.relationDigest !== before.relationDigest || digest(saved.plan) !== digest(plan))
      throw new Error('Development database changed since preview')
    if (!plan.some(row => row.from !== row.to)) throw new Error('No account changes to apply')
    await applyGmailPlan(db.client, plan)
    const after = await snapshot(db.client)
    if (after.accountCount !== before.accountCount ||
        after.relationDigest !== before.relationDigest ||
        after.emailIdentityCount !== before.emailIdentityCount)
      throw new Error('Post-migration ownership verification failed; use the private backup')
    console.log(JSON.stringify({ migrated: plan.length, listings: after.listingCount,
      orders: after.orderCount, ownershipPreserved: true }))
  } finally { await db.onModuleDestroy() }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
