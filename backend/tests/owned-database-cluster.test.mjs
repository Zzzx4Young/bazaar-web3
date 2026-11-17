import test from 'node:test'
import assert from 'node:assert/strict'
import { createOwnedDatabase } from './helpers/owned-database.mjs'

// Controlled catalog responses exercise cross-cluster identity without a second
// PostgreSQL container or any real network/DDL in these unit tests.
function catalog(cluster, counters) {
  return {
    async $queryRaw(strings) {
      const sql = strings.join('')
      if (sql.includes('current_database')) return [{ database: 'bazaar_test', cluster }]
      if (sql.includes('pg_control_system')) return [{ cluster }]
      return [{ oid: '1234', owner: '10' }]
    },
    async $executeRawUnsafe(sql) {
      if (sql.startsWith('CREATE DATABASE')) counters.creates++
      if (sql.startsWith('DROP DATABASE')) counters.drops++
    }
  }
}

test('R07: an admin from a different cluster cannot mint an owned database capability', async () => {
  const previous = process.env.TEST_DATABASE_URL
  process.env.TEST_DATABASE_URL = 'postgresql://fixture:synthetic@127.0.0.1:57435/bazaar_test'
  const counters = { creates: 0, drops: 0, closed: 0 }
  try {
    const admin = { client: catalog('1111111111111111111', counters) }
    const databaseFactory = () => ({
      client: catalog('2222222222222222222', counters),
      async onModuleInit() {},
      async onModuleDestroy() {
        counters.closed++
      }
    })
    await assert.rejects(
      createOwnedDatabase(admin, 't10_entry_' + 'a'.repeat(32), { databaseFactory }),
      /cluster identity/
    )
    assert.equal(counters.creates, 0)
    assert.equal(counters.drops, 0)
    assert.equal(counters.closed, 1)
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL
    else process.env.TEST_DATABASE_URL = previous
  }
})

test('R07: cleanup refuses a changed cluster even when database OID and owner could match', async () => {
  const previous = process.env.TEST_DATABASE_URL
  process.env.TEST_DATABASE_URL = 'postgresql://fixture:synthetic@127.0.0.1:57435/bazaar_test'
  const counters = { creates: 0, drops: 0, closed: 0 }
  let configuredCluster = '1111111111111111111'
  try {
    const admin = { client: catalog(configuredCluster, counters) }
    const databaseFactory = () => ({
      client: catalog(configuredCluster, counters),
      async onModuleInit() {},
      async onModuleDestroy() {
        counters.closed++
      }
    })
    const owned = await createOwnedDatabase(admin, 't10_entry_' + 'a'.repeat(32), {
      databaseFactory
    })
    configuredCluster = '2222222222222222222'
    await assert.rejects(owned.drop(), /cluster identity changed/)
    assert.equal(counters.creates, 1)
    assert.equal(counters.drops, 0)
    assert.equal(counters.closed, 2)
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL
    else process.env.TEST_DATABASE_URL = previous
  }
})
