import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseService } from '../dist/database/database.service.js'
import { ArchiveService } from '../dist/media/archive.service.js'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { MediaService } from '../dist/media/media.service.js'
import { sandbox } from '../tests/helpers/database.mjs'

const compose = resolve('../infra/compose.media-recovery.yaml')
const project = 'bazaar-media-recovery'
await mkdir('.tmp', { recursive: true, mode: 0o700 })
const backup = await mkdtemp(resolve('.tmp/media-recovery-'))
const password = (await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')).trim()
const base = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
base.password = password
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2joAAAAASUVORK5CYII=', 'base64')
const digest = createHash('sha256').update(bytes).digest('hex')
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
  ? ['docker'] : ['sudo', '-n', 'docker']
let db, restored, restoredSchema, admin
let stage = 'start'

function run(program, args, env = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ...env }, maxBuffer: 1024 * 1024
  })
  if (result.error || result.status !== 0)
    throw new Error(`${program} failed at ${stage} (${result.status ?? result.error?.name})`)
  return result.stdout
}
const dc = (args) => run(docker[0], [...docker.slice(1), 'compose',
  '-f', compose, '-p', project, '--profile', 'restore', ...args])
const garage = (tier, args) => dc(['exec', '-T', `source-${tier}`, '/garage', ...args])

async function bootstrap(tier) {
  const service = `source-${tier}`
  for (let attempt = 0; attempt < 30; attempt++) {
    try { garage(tier, ['status']); break }
    catch {
      if (attempt === 29) throw new Error(`${service} did not start`)
      await new Promise((done) => setTimeout(done, 500))
    }
  }
  const nodeId = garage(tier, ['node', 'id']).trim().split('\n').at(-1)
  if (!/^[0-9a-f]{64}$/.test(nodeId)) throw new Error(`${service} node ID unavailable`)
  garage(tier, ['layout', 'assign', nodeId, '-z', `restore-${tier}`, '-c', '1GB'])
  garage(tier, ['layout', 'apply', '--version', '1'])
  garage(tier, ['health', '-q'])
  garage(tier, ['bucket', 'create', `recovery-${tier}`])
  garage(tier, ['key', 'create', `recovery-${tier}-app`])
  garage(tier, ['bucket', 'allow', '--read', '--write', '--owner',
    `recovery-${tier}`, '--key', `recovery-${tier}-app`])
  const info = garage(tier, ['key', 'info', '--show-secret', `recovery-${tier}-app`])
  const accessKeyId = info.match(/^\s*(?:Key ID|Key ID:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  const secretAccessKey = info.match(/^\s*(?:Secret key|Secret key:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  if (!accessKeyId || !secretAccessKey) throw new Error(`${service} credentials unavailable`)
  return { accessKeyId, secretAccessKey }
}

function store(hotPort, coldPort, hotCredentials, coldCredentials) {
  return new GarageObjectStore({
    hotEndpoint: `http://127.0.0.1:${hotPort}`,
    hotPublicEndpoint: `http://127.0.0.1:${hotPort}`,
    coldEndpoint: `http://127.0.0.1:${coldPort}`,
    hotCredentials, coldCredentials,
    hotBucket: 'recovery-hot', coldBucket: 'recovery-cold'
  })
}

function saveVolume(service, directory) {
  const path = `/var/lib/garage/${directory}`
  const archive = `/backup/${service}-${directory}.tar`
  const args = [...docker.slice(1), 'run', '--rm', '--user', '0',
    '--volumes-from', `${project}-${service}-1`,
    '--mount', `type=bind,src=${backup},dst=/backup`,
    'postgres:17.11-bookworm', 'tar', '-C', path,
    '-cf', archive, '.']
  run(docker[0], args)
}

try {
  stage = 'start isolated Garage instances'
  dc(['up', '-d', 'source-hot', 'source-cold'])
  const hotCredentials = await bootstrap('hot')
  const coldCredentials = await bootstrap('cold')
  const sourceStore = store(3910, 3911, hotCredentials, coldCredentials)

  stage = 'seed PostgreSQL and both object stores'
  db = await sandbox(base)
  const seller = await db.client.account.create({
    data: { loginName: randomUUID(), displayName: 'Recovery seller' }
  })
  const buyer = await db.client.account.create({
    data: { loginName: randomUUID(), displayName: 'Recovery buyer' }
  })
  const hotKey = `assets/recovery/${randomUUID()}`
  await sourceStore.putHot(hotKey, bytes, 'image/png')
  const asset = await db.client.mediaAsset.create({ data: {
    sellerId: seller.id, uploadKey: `staging/recovery/${randomUUID()}`,
    hotKey, status: 'ready', contentType: 'image/png',
    declaredBytes: bytes.length, actualBytes: bytes.length,
    sha256: digest, verifiedAt: new Date()
  } })
  const listing = await db.client.listing.create({ data: {
    sellerId: seller.id, type: 'digital', saleMode: 'repeatable',
    title: 'Recovered images', description: 'Hot and cold restoration',
    category: 'digital_assets', priceAmount: '3', currency: 'USD'
  } })
  await db.client.listingMedia.create({
    data: { listingId: listing.id, mediaId: asset.id, position: 0 }
  })
  const archivedOrder = await db.market.create(buyer.id, randomUUID(), {
    listingId: listing.id, version: 1
  })
  const hotOrder = await db.market.create(buyer.id, randomUUID(), {
    listingId: listing.id, version: 1
  })
  const now = new Date()
  await db.client.order.update({ where: { id: archivedOrder }, data: {
    status: 'completed', completedAt: new Date(now.getTime() - 91 * 86400000)
  } })
  assert.deepEqual(await new ArchiveService(db.client, sourceStore, 90).runOnce(now),
    { archived: 1, failed: 0 })
  const sourceMedia = new MediaService(db.client, sourceStore)
  assert.deepEqual((await sourceMedia.readOrder(archivedOrder, asset.id, buyer.id)).bytes, bytes)
  assert.deepEqual((await sourceMedia.readOrder(hotOrder, asset.id, buyer.id)).bytes, bytes)

  stage = 'backup PostgreSQL and stopped Garage metadata/object volumes'
  run('pg_dump', ['-h', base.hostname, '-p', base.port, '-U', base.username,
    '-d', base.pathname.slice(1), '-n', db.schema, '-Fc', '-f', resolve(backup, 'database.dump')],
  { PGPASSWORD: password })
  dc(['stop', 'source-hot', 'source-cold'])
  for (const tier of ['hot', 'cold'])
    for (const directory of ['meta', 'data'])
      saveVolume(`source-${tier}`, directory)
  restoredSchema = db.schema
  const restoredUrl = new URL(db.url)
  await db.close()
  db = undefined

  stage = 'restore Garage volumes and PostgreSQL schema in isolation'
  dc(['create', 'restored-hot', 'restored-cold'])
  for (const tier of ['hot', 'cold'])
    for (const directory of ['meta', 'data']) {
      const source = `source-${tier}`
      const target = `restored-${tier}`
      // Reuse the exact source archive while writing only into the new restore volume.
      const args = [...docker.slice(1), 'run', '--rm', '--user', '0',
        '--volumes-from', `${project}-${target}-1`,
        '--mount', `type=bind,src=${backup},dst=/backup`,
        'postgres:17.11-bookworm', 'tar', '-C', `/var/lib/garage/${directory}`,
        '-xf', `/backup/${source}-${directory}.tar`]
      run(docker[0], args)
    }
  dc(['start', 'restored-hot', 'restored-cold'])
  run('pg_restore', ['-h', base.hostname, '-p', base.port, '-U', base.username,
    '-d', base.pathname.slice(1), '--no-owner', '--no-acl', resolve(backup, 'database.dump')],
  { PGPASSWORD: password })
  restored = new DatabaseService(restoredUrl.toString())
  await restored.onModuleInit()
  const recoveredStore = store(3912, 3913, hotCredentials, coldCredentials)
  const recoveredMedia = new MediaService(restored.client, recoveredStore)
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      assert.deepEqual((await recoveredMedia.readOrder(archivedOrder, asset.id, buyer.id)).bytes, bytes)
      assert.deepEqual((await recoveredMedia.readOrder(hotOrder, asset.id, buyer.id)).bytes, bytes)
      break
    } catch (error) {
      if (attempt === 29) throw error
      await new Promise((done) => setTimeout(done, 500))
    }
  }
  console.log('PASS: isolated PostgreSQL and hot/cold Garage metadata+object backup restore retained both order images')
} catch (error) {
  console.error(`Media backup restore failed at ${stage}: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await restored?.onModuleDestroy().catch(() => {})
  await db?.close().catch(() => {})
  if (restoredSchema) {
    try {
      admin = new DatabaseService(base.toString())
      await admin.onModuleInit()
      await admin.client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${restoredSchema}" CASCADE`)
    } catch { process.exitCode = 1 }
    finally { await admin?.onModuleDestroy().catch(() => {}) }
  }
  try { dc(['down', '-v', '--remove-orphans']) }
  catch { process.exitCode = 1 }
  await rm(backup, { recursive: true, force: true })
}
