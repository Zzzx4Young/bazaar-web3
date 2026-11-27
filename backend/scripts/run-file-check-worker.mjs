#!/usr/bin/env node
import { DomainError } from '../dist/common/domain-error.js'
import { readConfig } from '../dist/config.js'
import { DatabaseService } from '../dist/database/database.service.js'
import { PrivateFileService } from '../dist/delivery-files/upload.service.js'
import { GaragePrivateObjectStore } from '../dist/delivery-files/object-store.js'
import { DockerFileChecker } from '../dist/delivery-files/check-worker.js'

const config = readConfig(process.env),
  privateFiles = config.privateFiles
if (!privateFiles) throw new Error('Explicit private file and checker configuration required')
const db = new DatabaseService(config.databaseUrl, config.databasePool)
await db.onModuleInit()
const service = new PrivateFileService(
  db.client,
  new GaragePrivateObjectStore(privateFiles.store),
  privateFiles.budget,
  privateFiles.uploadKey
)
const checker = new DockerFileChecker(privateFiles.checker)
let stopped = false
process.on('SIGTERM', () => {
  stopped = true
})
process.on('SIGINT', () => {
  stopped = true
})
try {
  do {
    await service.reapChecks(checker, privateFiles.scratchRoot)
    const expired = await service.expireUploads()
    const pending = await db.client.privateUpload.findMany({
      where: { status: { in: ['cleanup_pending', 'expired', 'rejected', 'check_timeout'] } },
      take: 20,
      select: { id: true }
    })
    for (const id of new Set([...expired, ...pending.map((r) => r.id)])) {
      try {
        await service.cleanupUpload(id)
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'STATE_CONFLICT') throw error
        // A live receiver has not acknowledged stopping yet. Keep its reservation.
      }
    }
    const job = await service.checkNext(checker, privateFiles.scratchRoot)
    if (process.argv.includes('--once')) break
    if (!job && !stopped) await new Promise((done) => setTimeout(done, 1000))
  } while (!stopped)
} finally {
  await db.onModuleDestroy()
}
