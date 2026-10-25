import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const envFile = new URL('../.tmp/i8-observer.env', import.meta.url)
const content = await readFile(envFile, 'utf8')
const line = content.split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='))
if (!line) throw new Error('DATABASE_URL missing from private observer env')
const url = new URL(line.slice('DATABASE_URL='.length))
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.pathname !== '/bazaar_dev' ||
  decodeURIComponent(url.username) !== 'bazaar_observer'
)
  throw new Error('Refusing unexpected observer database target')

const child = spawn(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve('@bytebase/dbhub')),
    '--transport',
    'stdio',
    '--config',
    new URL('../../infra/dbhub.toml', import.meta.url).pathname
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, BAZAAR_OBSERVER_DATABASE_URL: url.toString() }
  }
)
child.once('error', (error) => {
  console.error(`Unable to start DBHub: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
