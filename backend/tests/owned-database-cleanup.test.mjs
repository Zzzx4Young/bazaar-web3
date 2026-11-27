import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const helpers = await import('./helpers/owned-database.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
  return {}
})

for (const failMain of [false, true])
  test(`R07: main assertion failure=${failMain} is preserved and all cleanup steps run`, async () => {
    assert.equal(typeof helpers.withTestCleanup, 'function')
    const root = await mkdtemp(join(tmpdir(), 'wp2-cleanup-'))
    const file = join(root, 'owned')
    const mainError = new assert.AssertionError({ message: 'injected main assertion' })
    const cleanupError = new Error('injected cleanup failure')
    await writeFile(file, 'synthetic')
    try {
      await assert.rejects(
        helpers.withTestCleanup(async () => {
          if (failMain) throw mainError
        }, [
          [
            'failing step',
            async () => {
              throw cleanupError
            }
          ],
          ['remove owned directory', () => rm(root, { recursive: true })]
        ]),
        (error) => {
          assert.ok(error instanceof AggregateError)
          assert.deepEqual(error.errors, failMain ? [mainError, cleanupError] : [cleanupError])
          return true
        }
      )
      await assert.rejects(access(file), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

test('R07: successful cleanup preserves the main result and the exact main error', async () => {
  assert.equal(typeof helpers.withTestCleanup, 'function')
  assert.equal(await helpers.withTestCleanup(async () => 42, []), 42)
  const mainError = new assert.AssertionError({ message: 'injected assertion only' })
  await assert.rejects(
    helpers.withTestCleanup(async () => {
      throw mainError
    }, []),
    (error) => error === mainError
  )
})
