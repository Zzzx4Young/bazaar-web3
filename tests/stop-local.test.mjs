import assert from 'node:assert/strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bazaar-stop-test-'))
  mkdirSync(join(root, '.tmp'))
  for (const script of ['stop.sh', 'down.sh']) {
    copyFileSync(new URL(`../${script}`, import.meta.url), join(root, script))
    chmodSync(join(root, script), 0o755)
  }
  return { root, state: join(root, '.tmp/bazaar-start.pid') }
}

test('stop treats a missing or stale launcher record as already stopped', () => {
  const { root, state } = fixture()
  try {
    assert.match(execFileSync(join(root, 'stop.sh'), { encoding: 'utf8' }), /no Bazaar application/i)
    writeFileSync(state, '99999999 1\n')
    assert.match(execFileSync(join(root, 'stop.sh'), { encoding: 'utf8' }), /stale|no longer running/i)
    assert.equal(existsSync(state), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('down stops both Compose services after a launcher SIGKILL, including on repeat', async () => {
  const { root, state } = fixture()
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const log = join(root, 'docker.log')
  const docker = join(bin, 'docker')
  writeFileSync(docker, '#!/bin/sh\ncase "$1" in\ninfo) exit 0;;\ncompose) case " $* " in *" ps "*) exit 0;; esac; printf "%s\\n" "$*" >> "$DOCKER_LOG";;\nesac\n')
  chmodSync(docker, 0o755)
  const launcher = join(root, 'start.sh')
  writeFileSync(launcher, '#!/bin/bash\nwhile :; do sleep 0.1; done\n')
  const child = spawn('bash', [launcher], { cwd: root, stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  try {
    const start = readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(' ')[21]
    writeFileSync(state, `${child.pid} ${start}\n`)
    child.kill('SIGKILL')
    await exited
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log }
    execFileSync(join(root, 'down.sh'), { env })
    execFileSync(join(root, 'down.sh'), { env })
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    assert.equal(calls.length, 4)
    assert.match(calls[0], /stop garage-hot garage-cold$/)
    assert.match(calls[1], /stop postgres$/)
    assert.equal(existsSync(state), false)
  } finally {
    child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop rejects invalid records without signaling their PID', () => {
  const { root, state } = fixture()
  const other = spawn('sleep', ['30'])
  try {
    writeFileSync(state, `${other.pid} invalid\n`)
    assert.throws(() => execFileSync(join(root, 'stop.sh'), { stdio: 'pipe' }), /invalid/)
    assert.equal(existsSync(state), true)
    assert.equal(other.exitCode, null)
  } finally {
    other.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop clears a reused PID record without killing an unrelated process', () => {
  const { root, state } = fixture()
  const other = spawn('sleep', ['30'])
  try {
    const start = readFileSync(`/proc/${other.pid}/stat`, 'utf8').split(' ')[21]
    writeFileSync(state, `${other.pid} ${start}\n`)
    assert.match(execFileSync(join(root, 'stop.sh'), { encoding: 'utf8' }), /another process/)
    assert.equal(existsSync(state), false)
    assert.equal(other.exitCode, null)
  } finally {
    other.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop signals a live launcher and reports success after it exits', async () => {
  const { root, state } = fixture()
  const launcher = join(root, 'start.sh')
  writeFileSync(launcher, '#!/bin/bash\ntrap "exit 0" TERM\nwhile :; do sleep 0.1; done\n')
  const child = spawn('bash', [launcher], { cwd: root, stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  try {
    const start = readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(' ')[21]
    writeFileSync(state, `${child.pid} ${start}\n`)
    const result = await execFileAsync(join(root, 'stop.sh'))
    assert.match(result.stdout, /application processes stopped/i)
    await exited
    assert.equal(child.exitCode, 0)
  } finally {
    child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop preserves a real signal failure', () => {
  const { root, state } = fixture()
  const launcher = join(root, 'start.sh')
  writeFileSync(launcher, '#!/bin/bash\nwhile :; do sleep 1; done\n')
  const child = spawn('bash', [launcher], { cwd: root, stdio: 'ignore' })
  try {
    const start = readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(' ')[21]
    writeFileSync(state, `${child.pid} ${start}\n`)
    const command = 'kill() { return 1; }; export -f kill; exec ./stop.sh'
    assert.throws(() => execFileSync('bash', ['-c', command], { cwd: root, stdio: 'pipe' }))
    assert.equal(child.exitCode, null)
    assert.equal(existsSync(state), true)
  } finally {
    child.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('stale cleanup does not remove a record replaced while waiting for the lock', async () => {
  const { root, state } = fixture()
  const lock = `${state}.lock`
  writeFileSync(state, '99999999 1\n')
  const writer = spawn('flock', ['-x', lock, 'bash', '-c',
    'echo locked; sleep 0.2; printf "invalid record\\n" > "$STATE_FILE"'
  ], { env: { ...process.env, STATE_FILE: state }, stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    await new Promise(resolve => writer.stdout.once('data', resolve))
    const result = execFileAsync(join(root, 'stop.sh'))
    await assert.rejects(result, /invalid/)
    assert.equal(readFileSync(state, 'utf8'), 'invalid record\n')
  } finally {
    writer.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
})

test('down interrupts startup before stopping its database and media dependencies', async () => {
  const { root, state } = fixture()
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const path of ['backend/.tmp', 'backend/node_modules', 'frontend/node_modules', 'infra/scripts'])
    mkdirSync(join(root, path), { recursive: true })
  for (const path of ['backend/.env', 'backend/.tmp/i7-migrate.env'])
    writeFileSync(join(root, path), '')
  writeFileSync(join(root, 'infra/scripts/init-secrets.sh'), 'exit 0\n')
  copyFileSync(new URL('../start.sh', import.meta.url), join(root, 'start.sh'))
  const marker = join(root, 'bootstrapping')
  const log = join(root, 'docker.log')
  const docker = join(bin, 'docker')
  writeFileSync(docker, `#!/bin/sh
case "$1" in
  info) exit 0;;
  compose)
    case " $* " in
      *" ps "*) exit 0;;
      *" up "*) echo ready > "$STARTUP_MARKER"; exec sleep 30;;
      *" stop "*) printf '%s\\n' "$*" >> "$DOCKER_LOG"; exit 0;;
    esac;;
esac
exit 1
`)
  chmodSync(docker, 0o755)
  const curl = join(bin, 'curl')
  writeFileSync(curl, '#!/bin/sh\nexit 7\n')
  chmodSync(curl, 0o755)
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STARTUP_MARKER: marker,
    DOCKER_LOG: log
  }
  const launcher = spawn('bash', [join(root, 'start.sh')], {
    cwd: root, env, detached: true, stdio: 'ignore'
  })
  const exited = new Promise(resolve => launcher.once('exit', resolve))
  try {
    for (let attempt = 0; attempt < 40 && !existsSync(marker); attempt++)
      await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(existsSync(marker), true)
    await execFileAsync(join(root, 'down.sh'), { env, timeout: 4000 })
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 1500))
    ])
    assert.equal(stopped, true, 'launcher must exit before down completes')
    assert.equal(existsSync(state), false)
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    assert.match(calls[0], /stop garage-hot garage-cold$/)
    assert.match(calls[1], /stop postgres$/)
  } finally {
    try { process.kill(-launcher.pid, 'SIGKILL') } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})
