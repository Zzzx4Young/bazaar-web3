#!/usr/bin/env node
import { PrivateBackupService } from '../dist/delivery-files/private-backup.js'
import { lifecycleRuntime, backupKey } from './private-lifecycle-runtime.mjs'
if (
  process.argv.length !== 3 ||
  !['--create', '--expire'].includes(process.argv[2]) ||
  !process.env.PRIVATE_BACKUP_DIRECTORY
)
  throw new Error('Use --create or --expire with explicit PRIVATE_BACKUP_DIRECTORY')
const r = await lifecycleRuntime({ connectSource: process.argv[2] !== '--expire' })
try {
  const service = new PrivateBackupService(
    r.source.client,
    r.sourceUrl,
    r.store,
    r.ledger,
    backupKey(),
    process.env.PRIVATE_BACKUP_DIRECTORY
  )
  if (process.argv[2] === '--expire') console.log(JSON.stringify(await service.expire()))
  else {
    const b = await service.create()
    console.log(
      JSON.stringify({
        backupId: b.id,
        consistentPointAt: b.consistentPointAt,
        expiresAt: b.expiresAt,
        objectCount: b.objects.length
      })
    )
  }
} finally {
  await r.close()
}
