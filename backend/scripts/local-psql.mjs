import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const modes = {
  observer: { file: '.tmp/i8-observer.env', user: 'bazaar_observer', schema: 'bazaar_observe' },
  runtime: { file: '.env', user: 'bazaar_runtime', schema: 'bazaar' },
  migrate: { file: '.tmp/i7-migrate.env', user: 'bazaar_migrate', schema: 'bazaar' }
}
const mode = process.argv[2] ?? 'observer'
if (process.argv.length > 3 || !modes[mode]) {
  console.error('Usage: npm run db:psql -- [observer|runtime|migrate]')
  process.exit(2)
}
const selected = modes[mode]
const content = await readFile(resolve(selected.file), 'utf8')
const line = content.split(/\r?\n/).find((value) => value.startsWith('DATABASE_URL='))
if (!line) throw new Error(`DATABASE_URL missing from ${selected.file}`)
const url = new URL(line.slice('DATABASE_URL='.length))
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.pathname !== '/bazaar_dev' ||
  decodeURIComponent(url.username) !== selected.user
)
  throw new Error('Refusing unexpected local database target')

const child = spawn(
  'psql',
  [
    '--host',
    url.hostname,
    '--port',
    url.port || '5432',
    '--username',
    selected.user,
    '--dbname',
    'bazaar_dev',
    '--set',
    'ON_ERROR_STOP=on'
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(url.password),
      PGOPTIONS: `-c search_path=${selected.schema},pg_catalog`
    }
  }
)
child.once('error', (error) => {
  console.error(`Unable to start psql: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
