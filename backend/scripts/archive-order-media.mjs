import { DatabaseService } from '../dist/database/database.service.js'
import { readConfig } from '../dist/config.js'
import { GarageObjectStore } from '../dist/media/garage-object-store.js'
import { ArchiveService, readArchiveDays } from '../dist/media/archive.service.js'
import { OrphanService } from '../dist/media/orphan.service.js'

const config = readConfig()
if (!config.mediaStore) throw new Error('Garage media storage is not configured')
const days = readArchiveDays(process.env.ORDER_IMAGE_ARCHIVE_AFTER_DAYS)
const intervalRaw = process.env.ORDER_IMAGE_ARCHIVE_SCAN_SECONDS ?? '60'
if (!/^[1-9][0-9]*$/.test(intervalRaw) || Number(intervalRaw) < 60 ||
  Number(intervalRaw) > 86400) throw new Error('Invalid ORDER_IMAGE_ARCHIVE_SCAN_SECONDS')
const intervalMs = Number(intervalRaw) * 1000
const loop = process.argv.includes('--loop')
const database = new DatabaseService(config.databaseUrl, config.databasePool)
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
try {
  await database.onModuleInit()
  const store = new GarageObjectStore(config.mediaStore)
  const worker = new ArchiveService(database.client, store, days, (item, error) => {
    const code = error && typeof error === 'object' && 'name' in error
      ? String(error.name).slice(0, 80) : 'UnknownError'
    process.stderr.write(`${JSON.stringify({ event: 'order_media_archive_failure',
      orderId: item.orderId, mediaId: item.mediaId, code })}\n`)
  })
  const orphans = new OrphanService(database.client, store)
  do {
    const [{ now }] = await database.client.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`
    const result = await worker.runOnce(now, 100)
    const expired = await orphans.expirePending(now)
    const retired = await orphans.retireUnusedHot(now)
    const untracked = await orphans.reconcileUntracked(now)
    const archiveCutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const [hotReferenced, coldReferenced, archiveBacklog] = await Promise.all([
      database.client.mediaAsset.count({ where: { hotKey: { not: null } } }),
      database.client.mediaAsset.count({ where: { coldKey: { not: null } } }),
      database.client.orderMediaSnapshot.count({ where: {
        storageTier: 'hot', order: { status: 'completed', completedAt: { lte: archiveCutoff } }
      } })
    ])
    process.stdout.write(`${JSON.stringify({
      event: 'order_media_archive', archived: result.archived, failed: result.failed,
      pendingExpired: expired.expired, pendingCleanupFailed: expired.failed,
      hotRetired: retired.retired, hotRetirementFailed: retired.failed,
      hotReferenced, coldReferenced, archiveBacklog,
      untrackedObserved: untracked.observed, untrackedDeleted: untracked.deleted,
      untrackedCleanupFailed: untracked.failed,
      at: now.toISOString()
    })}\n`)
    if (result.failed || expired.failed || retired.failed || untracked.failed) process.exitCode = 1
    if (!loop || stopping) break
    await new Promise((done) => {
      const finish = () => {
        clearTimeout(timer)
        process.off('SIGTERM', finish)
        process.off('SIGINT', finish)
        done()
      }
      const timer = setTimeout(finish, intervalMs)
      process.once('SIGTERM', finish)
      process.once('SIGINT', finish)
    })
  } while (!stopping)
} finally {
  await database.onModuleDestroy()
}
