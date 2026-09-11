import test from 'node:test'
import { runAppProcess } from './helpers/app-process.mjs'
import { testUrl } from './helpers/database.mjs'

test('compiled entrypoint listens and exits cleanly on SIGTERM', { timeout: 15000 }, async () => {
  await runAppProcess(testUrl())
})
