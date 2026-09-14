import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

// Explicit convenience wrapper for this repository's disposable Compose database.
const password = (
  await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')
).trim()
const url = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
url.password = password
const command = process.argv.slice(2)
const child = spawn(command[0] ?? 'npm', command.length ? command.slice(1) : ['run', 'test:db'], {
  stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: url.toString() }
})
child.on('error', () => {
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
