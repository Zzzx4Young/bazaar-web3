import test from 'node:test'
import { runAppProcess } from './helpers/app-process.mjs'
import { sandbox } from './helpers/database.mjs'

test('compiled entrypoint listens and exits cleanly on SIGTERM', { timeout: 15000 }, async () => {
  const db = await sandbox()
  try {
    await runAppProcess(db.url)
  } finally {
    await db.close()
  }
})
