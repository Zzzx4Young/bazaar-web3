import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { connect, testUrl } from './helpers/database.mjs'
const helpers = await import('./helpers/owned-database.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  return {}
})

for (const failMain of [false, true])
  test(`R07: owned database lifecycle, injected assertion failure=${failMain}`, async () => {
    assert.equal(typeof helpers.createOwnedDatabase, 'function')
    const admin = await connect(testUrl())
    const name = 't10_entry_' + randomUUID().replaceAll('-', '')
    let owned, target
    const injected = new assert.AssertionError({ message: 'injected owned database assertion' })
    try {
      owned = await helpers.createOwnedDatabase(admin, name)
      const url = new URL(testUrl())
      url.pathname = '/' + name
      url.searchParams.set('application_name', 'wp2-owned-cleanup-main')
      target = await connect(url)
      const [backend] = await target.client.$queryRaw`SELECT pg_backend_pid() AS pid`
      await assert.rejects(owned.drop(), /Owned database still has sessions/)
      const main = helpers.withTestCleanup(async () => {
        assert.ok(backend.pid > 0)
        if (failMain) throw injected
      }, [
        ['target disconnect', () => target.onModuleDestroy()],
        ['owned database', () => owned.drop()]
      ])
      if (failMain) await assert.rejects(main, (error) => error === injected)
      else await main
      assert.equal(
        (await admin.client.$queryRaw`SELECT datname FROM pg_database WHERE datname=${name}`)
          .length,
        0
      )
    } finally {
      await target?.onModuleDestroy()
      await owned?.drop()
      await admin.onModuleDestroy()
    }
  })

test('R07: a reused database name cannot authorize deletion of a different OID', async () => {
  const admin = await connect(testUrl())
  const name = 't10_entry_' + randomUUID().replaceAll('-', '')
  let original, replacement
  await helpers.withTestCleanup(async () => {
    original = await helpers.createOwnedDatabase(admin, name)
    await admin.client.$executeRawUnsafe(`DROP DATABASE "${name}"`)
    replacement = await helpers.createOwnedDatabase(admin, name)
    await assert.rejects(original.drop(), /Owned database identity changed/)
    assert.equal(
      (await admin.client.$queryRaw`SELECT datname FROM pg_database WHERE datname=${name}`).length,
      1
    )
    for (const invalid of ['bazaar_test', 'bazaar_dev', 't10_entry_other', name + '"'])
      await assert.rejects(
        helpers.createOwnedDatabase(admin, invalid),
        /Explicit isolated owned database required/
      )
  }, [
    ['replacement owned database', async () => replacement?.drop()],
    ['admin disconnect', () => admin.onModuleDestroy()]
  ])
})

test('R07: controlled 57014 cleanup failure preserves the injected main assertion and finishes later cleanup', async () => {
  const admin = await connect(testUrl())
  const name = 't10_entry_' + randomUUID().replaceAll('-', '')
  let owned, target
  const injected = new assert.AssertionError({
    message: 'injected main before controlled DROP timeout'
  })
  try {
    owned = await helpers.createOwnedDatabase(admin, name)
    const url = new URL(testUrl())
    url.pathname = '/' + name
    url.searchParams.set('application_name', 'wp2-controlled-drop-blocker')
    target = await connect(url)
    await assert.rejects(
      helpers.withTestCleanup(async () => {
        throw injected
      }, [
        // Reproduce the original raw-DROP/production-budget shape against only our
        // own deliberately open connection. This is not historical root evidence.
        [
          'controlled raw DROP with owned blocker',
          () => admin.client.$executeRawUnsafe(`DROP DATABASE "${name}"`)
        ],
        ['controlled blocker disconnect', () => target.onModuleDestroy()],
        ['bounded owned cleanup', () => owned.drop()],
        [
          'prove owned database absent',
          async () => {
            assert.equal(
              (await admin.client.$queryRaw`SELECT datname FROM pg_database WHERE datname=${name}`)
                .length,
              0
            )
          }
        ]
      ]),
      (error) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 2)
        assert.equal(error.errors[0], injected)
        assert.match(error.errors[1].message, /57014/)
        assert.match(error.errors[1].message, /statement timeout/)
        console.log(
          JSON.stringify({
            event: 'controlled_cleanup_failure_verified',
            mainCode: injected.code,
            cleanupSqlState: '57014',
            laterCleanup: 'passed',
            historicalRootReproduced: false
          })
        )
        return true
      }
    )
  } finally {
    await target?.onModuleDestroy()
    await owned?.drop()
    await admin.onModuleDestroy()
  }
})
