import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const password = (
  await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')
).trim()
const url = new URL('postgresql://bazaar_validation_admin@127.0.0.1:55433/bazaar_persistence')
url.password = password
const child = spawn(process.execPath, ['scripts/check-i7-environment.mjs', '--restart-compose'], {
  stdio: 'inherit',
  env: { ...process.env, I7_ADMIN_DATABASE_URL: url.toString() }
})
child.on('error', () => {
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
