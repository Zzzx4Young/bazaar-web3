import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'

export async function runAppProcess(databaseUrl) {
  const socket = createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const port = socket.address().port
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve()))
  )
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      HOST: '127.0.0.1',
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const exit = once(child, 'exit')
  child.stdout.resume()
  child.stderr.resume()
  let timer
  try {
    const deadline = Date.now() + 8000
    let ready = false
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
          signal: AbortSignal.timeout(300)
        })
        if (response.status === 200) {
          ready = true
          break
        }
      } catch {
        /* The process may still be initializing its database connection. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(ready, true, 'Compiled API did not become ready')
    child.kill('SIGTERM')
    const [, signal] = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('API shutdown timed out')), 3000)
      })
    ])
    assert.equal(signal, 'SIGTERM')
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exit
  }
}
