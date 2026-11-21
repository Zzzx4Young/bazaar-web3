import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { DatabaseService } from '../dist/database/database.service.js'
import { connect, testUrl } from './helpers/database.mjs'
import { createOwnedDatabase, withTestCleanup } from './helpers/owned-database.mjs'

// Run only on a dedicated disposable test cluster. Observations are opportunistic:
// a fast checkpoint need not expose CheckpointDone during the polling interval.
test('R07 checkpoint: real maintenance budget and DROP budget remain independent', async () => {
  const admin = await connect(testUrl())
  const name = 't10_entry_' + randomUUID().replaceAll('-', '')
  const application = 'r07-checkpoint-' + randomUUID()
  const budgets = [],
    observations = []
  let owned, target
  await withTestCleanup(async () => {
    owned = await createOwnedDatabase(admin, name, {
      databaseFactory: (base, pool) => {
        const url = new URL(base)
        url.searchParams.set('application_name', application)
        const database = new DatabaseService(url.toString(), pool)
        const init = database.onModuleInit.bind(database)
        database.onModuleInit = async () => {
          await init()
          const [row] = await database.client.$queryRaw`SHOW statement_timeout`
          budgets.push({ configuredMs: pool.statementTimeoutMs, effective: row.statement_timeout })
        }
        return database
      }
    })
    const url = new URL(testUrl())
    url.pathname = '/' + name
    target = await connect(url)
    await target.client.$executeRawUnsafe(
      "CREATE TABLE checkpoint_fixture AS SELECT i, repeat('x', 1024) AS value FROM generate_series(1, 2000) i"
    )
    await target.onModuleDestroy()
    target = undefined
    let done = false
    const dropping = owned.drop().finally(() => {
      done = true
    })
    // Attach a rejection handler immediately while polling; rethrow by awaiting below.
    dropping.catch(() => {})
    const pollStarted = Date.now()
    try {
      while (!done && Date.now() - pollStarted < 260000) {
        const rows = await admin.client.$queryRaw`
          SELECT state, wait_event_type AS "waitType", wait_event AS "waitEvent", query
          FROM pg_stat_activity WHERE application_name=${application}
        `
        for (const row of rows) {
          if (row.query === 'CHECKPOINT' || row.query.startsWith('DROP DATABASE'))
            observations.push({ state: row.state, waitType: row.waitType, waitEvent: row.waitEvent, operation: row.query === 'CHECKPOINT' ? 'checkpoint' : 'owned-drop', elapsedMs: Date.now() - pollStarted })
        }
        if (!done) await setTimeout(10)
      }
    } finally {
      await dropping
    }
    assert.deepEqual(budgets, [
      { configuredMs: 15000, effective: '15s' },
      { configuredMs: 15000, effective: '15s' },
      { configuredMs: 240000, effective: '4min' }
    ])
    assert.equal(
      (await admin.client.$queryRaw`SELECT oid FROM pg_database WHERE datname=${name}`).length,
      0
    )
    console.log(
      JSON.stringify({
        event: 'checkpoint_experiment',
        budgets,
        observations,
        checkpointWaitObserved: observations.some((row) => row.waitEvent === 'CheckpointDone'),
        historicalRootReproduced: false
      })
    )
  }, [
    ['experiment target disconnect', async () => target?.onModuleDestroy()],
    ['experiment owned database', async () => owned?.drop()],
    ['experiment admin disconnect', () => admin.onModuleDestroy()]
  ])
})
