import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const backend = new URL('backend/', root)
const composeFile = fileURLToPath(new URL('infra/compose.yaml', root))
const resultsDirectory = fileURLToPath(new URL('frontend/e2e-results-v2/', root))
const password = (await readFile(new URL('infra/.secrets/postgres_test_password', root), 'utf8')).trim()
const databaseUrl = new URL('postgresql://bazaar_test_admin@127.0.0.1:55432/bazaar_test')
databaseUrl.password = password

async function run(command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd: fileURLToPath(cwd), env: { ...process.env, ...env }, stdio: 'inherit' })
  return await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

let code = 1
try {
  code = await run(
    'sudo',
    ['-n', 'docker', 'compose', '-f', composeFile, '--profile', 'test', 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres-test'],
    root
  )
  if (code === 0) {
    code = await run('npm', ['run', 'build'], backend)
    if (code === 0)
      code = await run(process.execPath, ['scripts/check-v2-journey.mjs'], backend, {
        V2_DATABASE_URL: databaseUrl.toString(),
        E2E_RESULTS_DIR: resultsDirectory
      })
  }
} finally {
  await run('sudo', ['-n', 'docker', 'compose', '-f', 'infra/compose.yaml', '--profile', 'test', 'stop', 'postgres-test'], root)
}
process.exitCode = code
