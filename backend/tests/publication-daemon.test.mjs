import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const configModule = await import('../dist/auth/publication-daemon-config.js').catch(() => ({}))
const daemonModule = await import('../dist/auth/publication-daemon.js').catch(() => ({}))
test('daemon exports stable entry points', () => {
  assert.equal(typeof configModule.readPublicationDaemonConfig, 'function')
  assert.equal(typeof daemonModule.startPublicationDaemon, 'function')
})
test('strict owner config accepts file references and rejects permissions, symlinks, duplicate streams and inline secrets', async (t) => {
  assert.equal(typeof configModule.readPublicationDaemonConfig, 'function')
  const root = await mkdtemp(join(tmpdir(), 'publication-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'owner.json')
  const value = {
    environmentId: 'local-test',
    configurationVersion: 'v1',
    custodyDirectory: join(root, 'custody'),
    publicKeyFile: join(root, 'public.pem'),
    privateKeyFile: join(root, 'private.pem'),
    encryptionKeyFile: join(root, 'encryption.key'),
    ledgerSources: [{ namespace: 'wallet', ledgerId: randomUUID(), urlFile: join(root, 'url') }]
  }
  const read = () =>
    configModule.readPublicationDaemonConfig({ WEB3_PUBLICATION_CUSTODY_CONFIG_FILE: path })
  await writeFile(path, JSON.stringify(value), { mode: 0o600 })
  assert.deepEqual(await read(), value)
  await chmod(path, 0o640)
  await assert.rejects(read, /PUBLICATION_DAEMON_CONFIG/)
  await chmod(path, 0o600)
  for (const invalid of [
    { ...value, encryptionKey: 'secret' },
    { ...value, ledgerSources: [] },
    { ...value, ledgerSources: [value.ledgerSources[0], value.ledgerSources[0]] },
    { ...value, wakeSocketMode: 0o666 },
    { ...value, privateKeyFile: 'relative' },
    { ...value, baselineCheckpoints: [{}] }
  ]) {
    await writeFile(path, JSON.stringify(invalid))
    await assert.rejects(read, /PUBLICATION_DAEMON_CONFIG/)
  }
  const link = join(root, 'link')
  await symlink(path, link)
  await assert.rejects(
    () => configModule.readPublicationDaemonConfig({ WEB3_PUBLICATION_CUSTODY_CONFIG_FILE: link }),
    /PUBLICATION_DAEMON_CONFIG/
  )
})
