#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const dir = await mkdtemp(join(tmpdir(), 'bazaar-private-garage-')),
  project = 'bazaar-private-' + randomBytes(6).toString('hex')
const rpc = join(dir, 'rpc'),
  input = join(dir, 'input')
await writeFile(rpc, randomBytes(32).toString('hex'), { mode: 0o600 })
await writeFile(input, 'test', { mode: 0o600 })
const env = {
  ...process.env,
  PRIVATE_GARAGE_RPC_SECRET_FILE: rpc,
  PRIVATE_CHECK_INPUT_FILE: input,
  PRIVATE_GARAGE_TEST_PORT: process.env.PRIVATE_GARAGE_TEST_PORT ?? '55436'
}
const compose = [
  '-n',
  'env',
  `PRIVATE_GARAGE_RPC_SECRET_FILE=${rpc}`,
  `PRIVATE_CHECK_INPUT_FILE=${input}`,
  `PRIVATE_GARAGE_TEST_PORT=${env.PRIVATE_GARAGE_TEST_PORT}`,
  'docker',
  'compose',
  '-p',
  project,
  '-f',
  resolve('../infra/compose.web3-test.yaml')
]
function run(args, allowFailure = false) {
  const r = spawnSync('sudo', args, {
    env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 60000
  })
  if (r.error || (r.status !== 0 && !allowFailure))
    throw new Error(
      `Private test resource command failed (${r.status}): ${(r.stderr ?? '').slice(0, 2000)}`
    )
  return r
}
const garage = (args) =>
  run([...compose, 'exec', '-T', 'garage-private', '/garage', ...args]).stdout
let code
let started = false
try {
  started = true
  run([...compose, 'up', '-d', 'garage-private'])
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (run([...compose, 'exec', '-T', 'garage-private', '/garage', 'status'], true).status === 0) {
      ready = true
      break
    }
    await new Promise((done) => setTimeout(done, 300))
  }
  if (!ready) throw new Error('Private Garage did not become ready')
  const node = garage(['node', 'id']).trim().split('\n').at(-1)
  if (!/^[0-9a-f]{64}$/.test(node)) throw new Error('Private Garage node identity unavailable')
  garage(['layout', 'assign', node, '-z', 'private-test', '-c', '8GB'])
  garage(['layout', 'apply', '--version', '1'])
  garage(['bucket', 'create', 'bazaar-private-tests'])
  garage(['key', 'create', 'private-test-app'])
  garage([
    'bucket',
    'allow',
    '--read',
    '--write',
    'bazaar-private-tests',
    '--key',
    'private-test-app'
  ])
  const info = garage(['key', 'info', '--show-secret', 'private-test-app'])
  const id = info.match(/^\s*(?:Key ID|Key ID:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  const secret = info.match(/^\s*(?:Secret key|Secret key:)\s*:?[ \t]*(\S+)\s*$/im)?.[1]
  if (!id || !secret) throw new Error('Private Garage test credential format unsupported')
  const childEnv = {
    ...env,
    PRIVATE_GARAGE_ENDPOINT: `http://127.0.0.1:${env.PRIVATE_GARAGE_TEST_PORT}`,
    PRIVATE_GARAGE_BUCKET: 'bazaar-private-tests',
    PRIVATE_GARAGE_ACCESS_KEY_ID: id,
    PRIVATE_GARAGE_SECRET_KEY: secret
  }
  const args = process.argv.slice(2)
  if (!args.length) throw new Error('Specify isolated test command')
  const child = spawn(args[0], args.slice(1), { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) =>
      process.stdout.write(
        String(b).replaceAll(secret, '[PRIVATE_TEST_SECRET]').replaceAll(id, '[PRIVATE_TEST_KEY]')
      )
    )
  code = await new Promise((done, reject) => {
    child.once('error', reject)
    child.once('exit', (n) => done(n ?? 1))
  })
} finally {
  // Only the random project created by this invocation is removed, including its test-only volumes.
  if (started) run([...compose, 'down', '--volumes', '--remove-orphans'])
  await rm(dir, { recursive: true, force: true })
}
process.exitCode = code
