import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { connect, testUrl } from './helpers/database.mjs'
import { createOwnedDatabase, withTestCleanup } from './helpers/owned-database.mjs'
import { assertPrivateLedgerGrants } from '../dist/delivery-files/private-ledger-grants.js'
import { PrivateLifecycleLedger } from '../dist/delivery-files/deletion-ledger.js'

test('R04: actual production private-ledger provision grants SELECT-only fence access', async () => {
  const admin = await connect(testUrl())
  const suffix = randomUUID().replaceAll('-', '')
  const name = 'private_lifecycle_test_' + suffix,
    role = 'plp_' + suffix
  const root = await mkdtemp(join(tmpdir(), 'wp2-private-provision-'))
  let owned,
    runtime,
    createdRole = false
  await withTestCleanup(async () => {
    owned = await createOwnedDatabase(admin, name)
    const secret = randomBytes(24).toString('hex')
    await admin.client.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`
    )
    createdRole = true
    const ownerUrl = new URL(testUrl())
    ownerUrl.pathname = '/' + name
    ownerUrl.searchParams.set('schema', 'private_lifecycle')
    const file = join(root, 'owner-url'),
      witness = join(root, 'witness'),
      id = randomUUID()
    await writeFile(file, ownerUrl.toString(), { mode: 0o600 })
    await mkdir(witness, { mode: 0o700 })
    const child = spawn(
      process.execPath,
      ['scripts/provision-private-ledger.mjs', '--confirm-independent-private-ledger'],
      {
        env: {
          ...process.env,
          PRIVATE_LEDGER_OWNER_URL_FILE: file,
          PRIVATE_LEDGER_ID: id,
          PRIVATE_LEDGER_WITNESS_DIR: witness,
          PRIVATE_LEDGER_RUNTIME_ROLE: role
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output += chunk
      })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
    let code
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
    } finally {
      clearTimeout(timer)
    }
    assert.equal(
      code,
      0,
      output
        .replaceAll(ownerUrl.toString(), '[OWNER_URL]')
        .replaceAll(decodeURIComponent(ownerUrl.password), '[REDACTED]')
    )
    const runtimeUrl = new URL(ownerUrl)
    runtimeUrl.username = role
    runtimeUrl.password = secret
    runtime = await connect(runtimeUrl)
    for (const publication of [false, true])
      await assertPrivateLedgerGrants(runtime.client, publication)
    const ledger = new PrivateLifecycleLedger(runtime.client, id, witness)
    const key = randomUUID()
    await ledger.append('claim', key, { id: key })
    await ledger.verify()
    assert.equal((await ledger.find('claim', key)).payload.id, key)
    await assert.rejects(
      runtime.client.$queryRaw`SELECT nextval('"LedgerPublicationFence"')`,
      /permission denied/
    )
    await assert.rejects(
      runtime.client.$queryRaw`SELECT setval('"LedgerPublicationFence"', 2)`,
      /permission denied/
    )
  }, [
    ['runtime disconnect', async () => runtime?.onModuleDestroy()],
    ['owned provision database', async () => owned?.drop()],
    [
      'owned provision role',
      async () => {
        if (createdRole) await admin.client.$executeRawUnsafe(`DROP ROLE "${role}"`)
      }
    ],
    ['admin disconnect', () => admin.onModuleDestroy()],
    ['provision directory', () => rm(root, { recursive: true, force: true })]
  ])
})
