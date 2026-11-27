import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const m = await import('../dist/auth/publication-runtime.js').catch((e) => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e
  return {}
})
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 't10-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'runtime.json'),
    config = {
      environmentId: 'isolated',
      configurationVersion: 'C5',
      wakeSocket: join(root, 'wake.sock'),
      openingFile: join(root, 'opening.json'),
      publicKeyFile: join(root, 'pin.pem'),
      recoveryRunId: randomUUID(),
      walletLedgerId: randomUUID(),
      privateLedgerId: randomUUID()
    }
  await writeFile(file, JSON.stringify(config), { mode: 0o644 })
  return { root, file, config }
}
test('runtime config is public-only and binds environment, ledger IDs, version and recovery run', async (t) => {
  const f = await fixture(t)
  assert.equal(typeof m.readPublicationRuntimeConfig, 'function')
  const c = m.readPublicationRuntimeConfig({ WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: f.file })
  assert.equal(c.environmentId, f.config.environmentId)
  assert.equal(c.configurationFile, f.file)
  assert.equal(typeof c.configurationHash, 'string')
  assert.equal(c.privateKeyFile, undefined)
  assert.equal(m.readPublicationRuntimeConfig({}), undefined)
})
test('runtime rejects secret fields, ambiguous locations, missing run and weak permissions', async (t) => {
  const f = await fixture(t)
  assert.equal(typeof m.readPublicationRuntimeConfig, 'function')
  for (const mutate of [
    (c) => ({ ...c, environmentId: ['isolated'] }),
    (c) => ({ ...c, configurationVersion: 123 }),
    (c) => ({ ...c, privateKeyFile: '/secret' }),
    (c) => ({ ...c, encryptionKeyFile: '/secret' }),
    (c) => ({ ...c, openingFile: 'relative' }),
    (c) => ({ ...c, walletLedgerId: 'not-uuid' }),
    (c) => ({ ...c, recoveryRunId: undefined })
  ]) {
    await writeFile(f.file, JSON.stringify(mutate(f.config)))
    assert.throws(() =>
      m.readPublicationRuntimeConfig({ WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: f.file })
    )
  }
  await writeFile(f.file, JSON.stringify(f.config))
  await chmod(f.file, 0o666)
  assert.throws(() =>
    m.readPublicationRuntimeConfig({ WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: f.file })
  )
})
test('public runtime publication cannot silently enable outside explicit Web3 environment', async (t) => {
  const f = await fixture(t)
  const { readConfig } = await import('../dist/config.js')
  assert.throws(
    () =>
      readConfig({
        DATABASE_URL: 'postgresql://example@localhost/bazaar_test',
        WEB3_PUBLICATION_RUNTIME_CONFIG_FILE: f.file
      }),
    /PUBLICATION_REQUIRES_WEB3/
  )
})
