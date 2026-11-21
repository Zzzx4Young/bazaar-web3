import test from 'node:test'
import assert from 'node:assert/strict'
import { createOwnedDatabase, withTestCleanup } from './helpers/owned-database.mjs'

// Controlled catalog and completion boundary; not historical root-cause evidence.
async function fixture(t, options = {}) {
  const previous = process.env.TEST_DATABASE_URL
  process.env.TEST_DATABASE_URL = 'postgresql://fixture:synthetic@127.0.0.1:58435/bazaar_test'
  t.after(() => {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL
    else process.env.TEST_DATABASE_URL = previous
  })
  const state = {
    prepared: false,
    dropped: false,
    clients: [],
    sql: [],
    current: {
      cluster: '1111111111111111111',
      oid: '1234',
      owner: '10',
      sessions: []
    }
  }
  const client = (pool) => ({
    async $queryRaw(strings) {
      const sql = strings.join('')
      if (sql.includes('current_database'))
        return [
          {
            database: 'bazaar_test',
            cluster:
              pool?.statementTimeoutMs === 240000
                ? (options.maintenanceCluster ?? state.current.cluster)
                : state.current.cluster
          }
        ]
      if (sql.includes('pg_stat_activity')) return state.current.sessions
      if (sql.includes('pg_database')) return state.dropped ? [] : [{ ...state.current }]
      throw new Error('Unexpected catalog query')
    },
    async $executeRawUnsafe(sql) {
      state.sql.push({ sql, budget: pool?.statementTimeoutMs })
      if (sql === 'CHECKPOINT') {
        await options.checkpoint?.()
        state.prepared = true
        Object.assign(state.current, options.after)
      }
      if (sql.startsWith('DROP DATABASE')) state.dropped = true
    }
  })
  const owned = await createOwnedDatabase({ client: client() }, 't10_entry_' + 'a'.repeat(32), {
    databaseFactory: (_url, pool) => {
      const service = {
        pool,
        client: client(pool),
        closed: false,
        async onModuleInit() {},
        async onModuleDestroy() {
          this.closed = true
          if (pool.statementTimeoutMs === 240000 && options.closeError) throw options.closeError
        }
      }
      state.clients.push(service)
      return service
    }
  })
  return { owned, state }
}

test('R07 checkpoint: await separate 240s maintenance before 15s DROP', async (t) => {
  let release, entered
  const waiting = new Promise((resolve) => {
    entered = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { owned, state } = await fixture(t, {
    checkpoint: () => {
      entered()
      return gate
    }
  })
  const dropping = owned.drop()
  try {
    await Promise.race([
      waiting,
      dropping.then(() => {
        throw new Error('DROP bypassed checkpoint')
      })
    ])
    assert.equal(state.dropped, false)
    assert.equal(state.clients.filter((c) => !c.closed).length, 2)
  } finally {
    release()
  }
  await dropping
  assert.deepEqual(
    state.sql.filter((x) => !x.sql.startsWith('CREATE')),
    [
      { sql: 'CHECKPOINT', budget: 240000 },
      { sql: 'DROP DATABASE "t10_entry_' + 'a'.repeat(32) + '"', budget: 15000 }
    ]
  )
  assert.ok(state.clients.every((c) => c.closed))
  const count = state.sql.length
  await owned.drop()
  assert.equal(state.sql.length, count)
})

test('R07 checkpoint: failure skips DROP and preserves main and later cleanup', async (t) => {
  const timeout = Object.assign(new Error('controlled checkpoint timeout'), { code: '57014' })
  const main = new assert.AssertionError({ message: 'main assertion' })
  const { owned, state } = await fixture(t, {
    checkpoint: () => {
      throw timeout
    }
  })
  let later = false
  await assert.rejects(
    withTestCleanup(async () => {
      throw main
    }, [
      ['owned database', () => owned.drop()],
      [
        'later cleanup',
        async () => {
          later = true
        }
      ]
    ]),
    (error) => {
      assert.deepEqual(error.errors, [main, timeout])
      return true
    }
  )
  assert.equal(later, true)
  assert.equal(state.dropped, false)
  assert.equal(state.sql.filter((x) => x.sql === 'CHECKPOINT').length, 1)
  assert.ok(state.clients.every((c) => c.closed))
})

test('R07 checkpoint: reject changed cluster, OID, owner or sessions before maintenance', async (t) => {
  for (const before of [
    { cluster: '222' },
    { oid: '5678' },
    { owner: '11' },
    { sessions: [{ pid: 42 }] }
  ]) {
    const { owned, state } = await fixture(t)
    Object.assign(state.current, before)
    await assert.rejects(owned.drop(), /identity changed|still has sessions/)
    assert.equal(
      state.sql.some((x) => x.sql === 'CHECKPOINT'),
      false
    )
    assert.equal(state.dropped, false)
    assert.ok(state.clients.every((c) => c.closed))
  }
})

test('R07 checkpoint: revalidate cluster, OID, owner and sessions after preparation', async (t) => {
  for (const after of [
    { cluster: '222' },
    { oid: '5678' },
    { owner: '11' },
    { sessions: [{ pid: 42 }] }
  ]) {
    const { owned, state } = await fixture(t, { after })
    await assert.rejects(owned.drop(), /identity changed|still has sessions/)
    assert.equal(state.prepared, true)
    assert.equal(state.dropped, false)
    assert.ok(state.clients.every((c) => c.closed))
  }
})

test('R07 checkpoint: maintenance endpoint must match CREATE cluster', async (t) => {
  const { owned, state } = await fixture(t, { maintenanceCluster: '222' })
  await assert.rejects(owned.drop(), /cluster identity changed/)
  assert.equal(
    state.sql.some((x) => x.sql === 'CHECKPOINT'),
    false
  )
  assert.equal(state.dropped, false)
  assert.ok(state.clients.every((c) => c.closed))
})

 test('R07 checkpoint: preserve preparation and maintenance disconnect errors together', async (t) => {
  const prepare = new Error('injected checkpoint failure'), close = new Error('injected close failure')
  const { owned, state } = await fixture(t, { checkpoint: async () => { throw prepare }, closeError: close })
  await assert.rejects(owned.drop(), (e) => e instanceof AggregateError && e.errors[0] === prepare && e.errors[1] === close)
  assert.equal(state.dropped, false)
})
