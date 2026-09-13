import { DatabaseService } from '../dist/database/database.service.js'
import { grantObserver } from './observer-grants.mjs'

const url = new URL(process.env.DATABASE_URL ?? '')
if (decodeURIComponent(url.username) !== 'bazaar_migrate')
  throw new Error('Observer views must be applied by bazaar_migrate')

const database = new DatabaseService(url.toString())
try {
  await database.onModuleInit()
  await grantObserver(database.client, 'bazaar', 'bazaar_observe', 'bazaar_observer')
  console.log('Observer views and grants applied')
} finally {
  await database.onModuleDestroy()
}
