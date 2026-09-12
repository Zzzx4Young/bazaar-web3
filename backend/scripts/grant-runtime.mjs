import { DatabaseService } from '../dist/database/database.service.js'
import { grantRuntime } from './runtime-grants.mjs'

const [schema, role] = process.argv.slice(2)
if (!process.env.DATABASE_URL || !schema || !role || process.argv.length !== 4) {
  throw new Error(
    'Usage: DATABASE_URL=<migration connection> node scripts/grant-runtime.mjs <schema> <runtime-role>'
  )
}
const db = new DatabaseService(process.env.DATABASE_URL)
try {
  await db.onModuleInit()
  await grantRuntime(db.client, schema, role)
  console.log('Runtime grants applied')
} catch {
  console.error('Runtime grants failed; verify migration ownership and runtime role configuration')
  process.exitCode = 1
} finally {
  await db.onModuleDestroy()
}
