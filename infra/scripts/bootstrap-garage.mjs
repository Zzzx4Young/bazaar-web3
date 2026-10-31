#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const infra = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = resolve(infra, 'compose.alpha.yaml')
const secretsDir = resolve(infra, '.secrets')
mkdirSync(secretsDir, { recursive: true, mode: 0o700 })
const appSecretsDir = resolve(secretsDir, 'garage-app')
mkdirSync(appSecretsDir, { recursive: true, mode: 0o700 })

function run(program, args, { allowFailure = false } = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure)
    throw new Error(`${program} ${args.slice(0, 3).join(' ')} failed (exit ${result.status})`)
  return result
}

const composeEnvironment = ['COMPOSE_PROJECT_NAME', 'GARAGE_HOT_PORT', 'GARAGE_COLD_PORT']
  .filter((name) => process.env[name])
  .map((name) => `${name}=${process.env[name]}`)
const docker = run('docker', ['info'], { allowFailure: true }).status === 0
  ? ['docker'] : ['sudo', '-n', 'env', ...composeEnvironment, 'docker']
if (run(docker[0], [...docker.slice(1), 'info'], { allowFailure: true }).status !== 0)
  throw new Error('Docker is unavailable')
const compose = [...docker.slice(1), 'compose', '-f', composeFile, '--profile', 'media']
function dc(args, options) { return run(docker[0], [...compose, ...args], options) }
function garage(service, args, options) {
  return dc(['exec', '-T', service, '/garage', ...args], options)
}

dc(['up', '-d', 'garage-hot', 'garage-cold'])
for (const tier of ['hot', 'cold']) {
  const service = `garage-${tier}`
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    if (garage(service, ['status'], { allowFailure: true }).status === 0) {
      ready = true
      break
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  if (!ready) throw new Error(`${service} did not start`)

  if (garage(service, ['health', '-q'], { allowFailure: true }).status !== 0) {
    const nodeId = garage(service, ['node', 'id']).stdout.trim().split('\n').at(-1)
    if (!/^[0-9a-f]{64}$/.test(nodeId)) throw new Error(`${service} node ID unavailable`)
    garage(service, ['layout', 'assign', nodeId, '-z', `local-${tier}`, '-c', '10GB'])
    garage(service, ['layout', 'apply', '--version', '1'])
  }
  if (garage(service, ['health', '-q'], { allowFailure: true }).status !== 0)
    throw new Error(`${service} layout is not healthy`)

  const bucket = `bazaar-${tier}`
  const keyName = `bazaar-${tier}-app`
  if (garage(service, ['bucket', 'info', bucket], { allowFailure: true }).status !== 0)
    garage(service, ['bucket', 'create', bucket])
  if (garage(service, ['key', 'info', keyName], { allowFailure: true }).status !== 0)
    garage(service, ['key', 'create', keyName])
  garage(service, ['bucket', 'allow', '--read', '--write', '--owner', bucket, '--key', keyName])

  const info = garage(service, ['key', 'info', '--show-secret', keyName]).stdout
  const id = info.match(/^\s*(?:Key ID|Key ID:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  const secret = info.match(/^\s*(?:Secret key|Secret key:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  if (!id || !secret) throw new Error(`${service} key output format was not recognized`)
  writeFileSync(resolve(appSecretsDir, `${tier}_access_key_id`), `${id}\n`, { mode: 0o600 })
  writeFileSync(resolve(appSecretsDir, `${tier}_secret_key`), `${secret}\n`, { mode: 0o600 })
  process.stdout.write(`${service} bucket and credentials ready\n`)
}
const cors = run(process.execPath, [resolve(infra, '../backend/scripts/configure-garage-cors.mjs')])
process.stdout.write(cors.stdout)
