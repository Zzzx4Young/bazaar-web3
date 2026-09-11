import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import test from 'node:test'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl || new URL(databaseUrl).pathname !== '/bazaar_test') {
  throw new Error('TEST_DATABASE_URL must explicitly target bazaar_test')
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

test('compiled entrypoint listens and exits cleanly on SIGTERM', { timeout: 15000 }, async () => {
  const port = await availablePort()
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const exit = once(child, 'exit')
  // Drain output without exposing possible connection details in assertion failures.
  child.stdout.resume()
  child.stderr.resume()
  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
          signal: AbortSignal.timeout(300)
        })
        if (response.status === 200) {
          ready = true
          break
        }
      } catch {
        /* Wait for the listening socket. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(ready, true)
    child.kill('SIGTERM')
    let timer
    try {
      const [, signal] = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Shutdown exceeded 3 seconds')), 3000)
        })
      ])
      assert.equal(signal, 'SIGTERM')
    } finally {
      clearTimeout(timer)
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exit
  }
})
