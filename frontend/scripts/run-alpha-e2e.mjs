import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const backendDirectory = resolve(process.cwd(), '../backend')
const repositoryDirectory = resolve(process.cwd(), '..')
const resultsDirectory = resolve(process.cwd(), 'e2e-results')

const run = (command, args, cwd, env = process.env) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`))
      else if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code ?? 1}`))
    })
  })

let databaseStarted = false
try {
  await run('bash', ['infra/scripts/init-secrets.sh'], repositoryDirectory)
  await run(
    'sudo',
    [
      '-n',
      'docker',
      'compose',
      '-f',
      'infra/compose.yaml',
      '--profile',
      'test',
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres-test'
    ],
    repositoryDirectory
  )
  databaseStarted = true
  await run('npm', ['run', 'build'], backendDirectory)
  await run(process.execPath, ['scripts/check-alpha-journey.mjs'], backendDirectory, {
    ...process.env,
    E2E_RESULTS_DIR: resultsDirectory
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (databaseStarted)
    await run(
      'sudo',
      [
        '-n',
        'docker',
        'compose',
        '-f',
        'infra/compose.yaml',
        '--profile',
        'test',
        'stop',
        'postgres-test'
      ],
      repositoryDirectory
    ).catch((error) => {
      console.error(`Failed to stop postgres-test: ${error.message}`)
      process.exitCode = 1
    })
}
