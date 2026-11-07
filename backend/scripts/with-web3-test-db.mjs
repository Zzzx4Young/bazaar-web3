import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const port = Number(process.env.WEB3_TEST_PORT ?? 55435)
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5432, 55432, 55433].includes(port))
  throw new Error('Use a dedicated Web3 disposable test database port')
const password = (await readFile(new URL('../../infra/.secrets/postgres_test_password', import.meta.url), 'utf8')).trim()
const url = new URL(`postgresql://bazaar_test_admin@127.0.0.1:${port}/bazaar_test`)
url.password = password
const args = process.argv.slice(2)
const child = spawn(args[0] ?? 'npm', args.length ? args.slice(1) : ['run', 'test:db'], {
  stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url.toString() }
})
child.on('error', () => { process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
