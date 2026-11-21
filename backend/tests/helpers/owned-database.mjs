import { DatabaseService } from '../../dist/database/database.service.js'
import { defaultDatabasePool } from '../../dist/database/database-policy.js'
import { testUrl } from './database.mjs'

// Preserve the main assertion independently from every cleanup result. Never let
// a failed DROP prevent disconnection, role cleanup or filesystem cleanup.
export async function withTestCleanup(main, steps) {
  let result, mainError
  try {
    result = await main()
    console.log(JSON.stringify({ event: 'fixture_main', status: 'passed' }))
  } catch (error) {
    mainError = error
    console.log(JSON.stringify({ event: 'fixture_main', status: 'failed', code: error.code }))
  }
  const failures = []
  for (const [step, cleanup] of steps) {
    const started = Date.now()
    try {
      await cleanup()
      console.log(
        JSON.stringify({
          event: 'fixture_cleanup',
          step,
          status: 'passed',
          elapsedMs: Date.now() - started
        })
      )
    } catch (error) {
      failures.push(error)
      console.log(
        JSON.stringify({
          event: 'fixture_cleanup',
          step,
          status: 'failed',
          code: error.code,
          elapsedMs: Date.now() - started
        })
      )
    }
  }
  if (failures.length)
    throw new AggregateError(
      [...(mainError ? [mainError] : []), ...failures],
      'Fixture main/cleanup failures'
    )
  if (mainError) throw mainError
  return result
}

// Only successful CREATEs in this invocation produce a cleanup capability. The
// name pattern is an additional guard, not proof that an existing DB is ours.
export async function createOwnedDatabase(
  admin,
  name,
  { databaseFactory = (url, pool) => new DatabaseService(url, pool) } = {}
) {
  const base = testUrl()
  if (
    base.hostname !== '127.0.0.1' ||
    !base.port ||
    [5432, 55432, 55433].includes(Number(base.port)) ||
    !/^(bazaar_web3_restore_|t10_entry_|wallet_security_test_|private_lifecycle_test_)[a-f0-9]{32}$/.test(
      name
    )
  )
    throw new Error('Explicit isolated owned database required')
  const [source] = await admin.client.$queryRaw`
    SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()
  `
  if (source?.database !== 'bazaar_test') throw new Error('Unexpected cleanup admin database')
  if (typeof source.cluster !== 'string' || !/^\d+$/.test(source.cluster))
    throw new Error('Missing source cluster identity')
  const cleanupPool = { ...defaultDatabasePool, max: 1, statementTimeoutMs: 15000 }
  // Test-only maintenance budget is independent of DROP and application queries.
  const maintenancePool = { ...cleanupPool, statementTimeoutMs: 240000 }
  const configured = databaseFactory(base.toString(), cleanupPool)
  try {
    await configured.onModuleInit()
    const [endpoint] = await configured.client.$queryRaw`
      SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()
    `
    if (endpoint?.database !== 'bazaar_test' || endpoint.cluster !== source.cluster)
      throw new Error('Configured cluster identity differs from CREATE admin; refusing creation')
  } finally {
    await configured.onModuleDestroy()
  }
  await admin.client.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  const [identity] = await admin.client
    .$queryRaw`SELECT oid::text AS oid, datdba::text AS owner FROM pg_database WHERE datname=${name}`
  if (!identity) throw new Error('Created database identity missing')
  let dropped = false
  return {
    async drop() {
      if (dropped) return
      // DDL gets an explicit bounded budget on its own admin client. Never relax
      // the production query budget, FORCE a drop, or terminate unknown sessions.
      const cleanup = databaseFactory(base.toString(), cleanupPool)
      const started = Date.now()
      try {
        await cleanup.onModuleInit()
        async function validateOwned(phase) {
          const [endpoint] = await cleanup.client.$queryRaw`
          SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()
        `
          if (endpoint?.database !== 'bazaar_test' || endpoint.cluster !== source.cluster)
            throw new Error('Owned database cluster identity changed; refusing cleanup')
          const [current] = await cleanup.client
            .$queryRaw`SELECT oid::text AS oid, datdba::text AS owner FROM pg_database WHERE datname=${name}`
          if (!current || current.oid !== identity.oid || current.owner !== identity.owner)
            throw new Error('Owned database identity changed; refusing cleanup')
          const sessions = await cleanup.client
            .$queryRaw`SELECT pid, usename AS role, application_name AS application, backend_type AS "backendType", state, wait_event_type AS "waitType", wait_event AS "waitEvent" FROM pg_stat_activity WHERE datid=${identity.oid}::oid ORDER BY pid`
          console.log(
            JSON.stringify({
              event: 'owned_database_drop',
              phase,
              database: name,
              oid: identity.oid,
              cluster: source.cluster,
              sessions,
              statementTimeoutMs: 15000
            })
          )
          if (sessions.length)
            throw new Error('Owned database still has sessions; disconnect fixture clients first')
        }
        await validateOwned('before_prepare')
        // CHECKPOINT is cluster-wide: only request it after proving this test's
        // CREATE capability and zero sessions on the explicit isolated endpoint.
        // It may wait for a running background checkpoint. Failure stays visible;
        // no DROP, retry, FORCE or session termination follows a failed prepare.
        const maintenance = databaseFactory(base.toString(), maintenancePool)
        const prepareStarted = Date.now()
        let prepareStatus = 'failed'
        let prepareError, closeError
        try {
          await maintenance.onModuleInit()
          const [endpoint] = await maintenance.client.$queryRaw`
            SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()
          `
          if (endpoint?.database !== 'bazaar_test' || endpoint.cluster !== source.cluster)
            throw new Error('Owned database cluster identity changed; refusing maintenance')
          await maintenance.client.$executeRawUnsafe('CHECKPOINT')
          prepareStatus = 'passed'
        } catch (error) {
          prepareError = error
        } finally {
          console.log(
            JSON.stringify({
              event: 'owned_database_checkpoint',
              database: name,
              status: prepareStatus,
              statementTimeoutMs: maintenancePool.statementTimeoutMs,
              elapsedMs: Date.now() - prepareStarted
            })
          )
          try {
            await maintenance.onModuleDestroy()
          } catch (error) {
            closeError = error
          }
        }
        if (prepareError && closeError)
          throw new AggregateError([prepareError, closeError], 'Checkpoint preparation/cleanup failures', { cause: prepareError })
        if (prepareError) throw prepareError
        if (closeError) throw closeError
        // The wait invalidates prior observations; recheck everything before DDL.
        await validateOwned('before')
        const dropStarted = Date.now()
        try {
          await cleanup.client.$executeRawUnsafe(`DROP DATABASE "${name}"`)
        } finally {
          console.log(
            JSON.stringify({
              event: 'owned_database_drop_statement',
              database: name,
              statementTimeoutMs: cleanupPool.statementTimeoutMs,
              elapsedMs: Date.now() - dropStarted
            })
          )
        }
        const remaining = await cleanup.client
          .$queryRaw`SELECT oid::text AS oid FROM pg_database WHERE datname=${name}`
        if (remaining.length) throw new Error('Owned database remains after DROP')
        dropped = true
        console.log(
          JSON.stringify({
            event: 'owned_database_drop',
            phase: 'after',
            database: name,
            status: 'passed',
            elapsedMs: Date.now() - started
          })
        )
      } catch (error) {
        console.log(
          JSON.stringify({
            event: 'owned_database_drop',
            phase: 'after',
            database: name,
            status: 'failed',
            code: error.code,
            elapsedMs: Date.now() - started
          })
        )
        throw error
      } finally {
        await cleanup.onModuleDestroy()
      }
    }
  }
}
