import { readFile, stat } from 'node:fs/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { provisionAccounts, resetPassword } from '../dist/accounts/provision-accounts.js'

let db
try {
  if (
    !process.env.DATABASE_URL ||
    !process.env.SEED_ACCOUNTS_FILE ||
    (process.argv.length !== 2 &&
      !(process.argv.length === 3 && process.argv[2] === '--reset-password'))
  )
    throw new Error('Explicit migration connection and input file required')
  const metadata = await stat(process.env.SEED_ACCOUNTS_FILE)
  if (!metadata.isFile() || metadata.size > 65536 || (metadata.mode & 0o077) !== 0)
    throw new Error('Input must be a private regular file of at most 64 KiB')
  const input = JSON.parse(await readFile(process.env.SEED_ACCOUNTS_FILE, 'utf8'))
  db = new DatabaseService(process.env.DATABASE_URL)
  await db.onModuleInit()
  if (process.argv[2] === '--reset-password') {
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !== 'loginName,password'
    )
      throw new Error('Invalid reset input')
    await resetPassword(db.client, input.loginName, input.password)
    console.log('Password reset and existing sessions revoked')
  } else {
    const count = await provisionAccounts(db.client, input)
    console.log(`Provisioned ${count} account(s)`)
  }
} catch {
  console.error(
    'Account operation failed; verify private input format, connection and uniqueness. No credentials are logged.'
  )
  process.exitCode = 1
} finally {
  await db?.onModuleDestroy()
}
