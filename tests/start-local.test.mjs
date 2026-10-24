import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, copyFileSync, readFileSync,
  existsSync, statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('start script leaves already-running services alone', () => {
  const bin = mkdtempSync(join(tmpdir(), 'bazaar-start-test-'))
  try {
    for (const command of ['docker', 'npm', 'sudo']) {
      const path = join(bin, command)
      writeFileSync(path, '#!/bin/sh\necho unexpected command >&2\nexit 99\n')
      chmodSync(path, 0o755)
    }
    const curl = join(bin, 'curl')
    writeFileSync(curl, '#!/bin/sh\nexit 0\n')
    chmodSync(curl, 0o755)
    const output = execFileSync('bash', ['start.sh'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8'
    })
    assert.match(output, /already running/i)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('start script enables the configured HTTPS proxy for the backend process', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bazaar-proxy-test-'))
  const bin = join(fixture, 'bin')
  const marker = join(fixture, 'backend-proxy-setting')
  try {
    mkdirSync(bin)
    for (const path of [
      'backend/.tmp', 'backend/node_modules', 'frontend/node_modules', 'infra/scripts'
    ]) mkdirSync(join(fixture, path), { recursive: true })
    copyFileSync(new URL('../start.sh', import.meta.url), join(fixture, 'start.sh'))
    for (const path of ['backend/.env', 'backend/.tmp/i7-migrate.env'])
      writeFileSync(join(fixture, path), '')
    writeFileSync(join(fixture, 'infra/scripts/init-secrets.sh'), 'exit 0\n')
    for (const command of ['docker', 'npm']) {
      const path = join(bin, command)
      writeFileSync(path, '#!/bin/sh\nexit 0\n')
      chmodSync(path, 0o755)
    }
    const curl = join(bin, 'curl')
    writeFileSync(curl, '#!/bin/sh\nexit 7\n')
    chmodSync(curl, 0o755)
    const node = join(bin, 'node')
    writeFileSync(node, `#!/bin/sh
case "$*" in
  *dist/main.js*) printf "%s" "$NODE_USE_ENV_PROXY" > "$MARKER";;
esac
exit 0
`)
    chmodSync(node, 0o755)
    assert.throws(() => execFileSync('bash', ['start.sh'], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HTTPS_PROXY: 'http://127.0.0.1:9999',
        NODE_USE_ENV_PROXY: '',
        MARKER: marker
      },
      timeout: 5000,
      stdio: 'ignore'
    }))
    assert.equal(readFileSync(marker, 'utf8'), '1')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('start returns after readiness while managed services keep running and log output is detached', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bazaar-detached-start-test-'))
  const bin = join(fixture, 'bin')
  const backend = join(fixture, 'backend-ready')
  const frontend = join(fixture, 'frontend-ready')
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BACKEND_MARKER: backend,
    FRONTEND_MARKER: frontend
  }
  try {
    mkdirSync(bin)
    for (const path of [
      'backend/.tmp', 'backend/node_modules', 'frontend/node_modules/.bin', 'infra/scripts'
    ]) mkdirSync(join(fixture, path), { recursive: true })
    for (const script of ['start.sh', 'stop.sh']) {
      copyFileSync(new URL(`../${script}`, import.meta.url), join(fixture, script))
      chmodSync(join(fixture, script), 0o755)
    }
    for (const path of ['backend/.env', 'backend/.tmp/i7-migrate.env'])
      writeFileSync(join(fixture, path), '')
    writeFileSync(join(fixture, 'infra/scripts/init-secrets.sh'), 'exit 0\n')
    for (const command of ['docker', 'npm']) {
      writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n')
      chmodSync(join(bin, command), 0o755)
    }
    writeFileSync(join(bin, 'node'), `#!/bin/sh
case " $* " in
  *dist/main.js*) touch "$BACKEND_MARKER"; exec sleep 30;;
  *archive-order-media.mjs*) exec sleep 30;;
esac
exit 0
`)
    chmodSync(join(bin, 'node'), 0o755)
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
case " $* " in
  */api/health/live*|*/api/health/ready*) test -f "$BACKEND_MARKER";;
  */zh-CN/explore*|*/zh-CN*) test -f "$FRONTEND_MARKER";;
  */api/listings/search*) test -f "$BACKEND_MARKER" && test -f "$FRONTEND_MARKER";;
  *) exit 1;;
esac
`)
    chmodSync(join(bin, 'curl'), 0o755)
    const next = join(fixture, 'frontend/node_modules/.bin/next')
    writeFileSync(next, '#!/bin/sh\ntouch "$FRONTEND_MARKER"\nexec sleep 30\n')
    chmodSync(next, 0o755)

    const output = execFileSync('bash', ['start.sh'], {
      cwd: fixture, env, encoding: 'utf8', timeout: 5000
    })
    assert.match(output, /Bazaar ready/)
    assert.doesNotMatch(output, /Press Ctrl\+C/)
    assert.equal(existsSync(join(fixture, '.tmp/bazaar-start.pid')), true)
    const log = join(fixture, '.tmp/start.log')
    assert.match(readFileSync(log, 'utf8'), /Bazaar ready/)
    assert.equal(statSync(log).mode & 0o777, 0o600)
    assert.equal(existsSync(backend) && existsSync(frontend), true)
    assert.match(execFileSync(join(fixture, 'stop.sh'), { env, encoding: 'utf8' }), /stopped/i)
    assert.equal(existsSync(join(fixture, '.tmp/bazaar-start.pid')), false)
  } finally {
    try { execFileSync(join(fixture, 'stop.sh'), { env, stdio: 'ignore' }) } catch {}
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('start keeps waiting while a long bootstrap step is still progressing', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bazaar-slow-start-test-'))
  const bin = join(fixture, 'bin')
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RELEASE_MARKER: join(fixture, 'release-bootstrap'),
    POLL_COUNT: join(fixture, 'poll-count'),
    BACKEND_MARKER: join(fixture, 'backend-ready'),
    FRONTEND_MARKER: join(fixture, 'frontend-ready')
  }
  try {
    mkdirSync(bin)
    for (const path of [
      'backend/.tmp', 'backend/node_modules', 'frontend/node_modules/.bin', 'infra/scripts'
    ]) mkdirSync(join(fixture, path), { recursive: true })
    for (const script of ['start.sh', 'stop.sh']) {
      copyFileSync(new URL(`../${script}`, import.meta.url), join(fixture, script))
      chmodSync(join(fixture, script), 0o755)
    }
    for (const path of ['backend/.env', 'backend/.tmp/i7-migrate.env'])
      writeFileSync(join(fixture, path), '')
    writeFileSync(join(fixture, 'infra/scripts/init-secrets.sh'), 'exit 0\n')
    const mocks = {
      docker: `#!/bin/sh
case "$1" in
  info) exit 0;;
  compose) case " $* " in *" up "*) while [ ! -e "$RELEASE_MARKER" ]; do /bin/sleep 0.01; done;; esac;;
esac
exit 0
`,
      npm: '#!/bin/sh\nexit 0\n',
      node: `#!/bin/sh
case " $* " in
  *dist/main.js*) touch "$BACKEND_MARKER"; exec /bin/sleep 30;;
  *archive-order-media.mjs*) exec /bin/sleep 30;;
esac
exit 0
`,
      curl: `#!/bin/sh
case " $* " in
  */api/health/live*|*/api/health/ready*) test -f "$BACKEND_MARKER";;
  */zh-CN/explore*|*/zh-CN*) test -f "$FRONTEND_MARKER";;
  */api/listings/search*) test -f "$BACKEND_MARKER" && test -f "$FRONTEND_MARKER";;
  *) exit 1;;
esac
`,
      sleep: `#!/bin/sh
if [ "$1" = 1 ]; then
  count=0
  [ ! -f "$POLL_COUNT" ] || count=$(cat "$POLL_COUNT")
  count=$((count + 1))
  printf '%s\\n' "$count" > "$POLL_COUNT"
  [ "$count" -lt 301 ] || touch "$RELEASE_MARKER"
  exec /bin/sleep 0.002
fi
exec /bin/sleep "$@"
`
    }
    for (const [name, content] of Object.entries(mocks)) {
      const path = join(bin, name)
      writeFileSync(path, content)
      chmodSync(path, 0o755)
    }
    const next = join(fixture, 'frontend/node_modules/.bin/next')
    writeFileSync(next, '#!/bin/sh\ntouch "$FRONTEND_MARKER"\nexec /bin/sleep 30\n')
    chmodSync(next, 0o755)

    const output = execFileSync('bash', ['start.sh'], {
      cwd: fixture, env, encoding: 'utf8', timeout: 10000
    })
    assert.match(output, /Bazaar ready/)
    assert.ok(Number(readFileSync(env.POLL_COUNT, 'utf8')) >= 301)
  } finally {
    try { execFileSync(join(fixture, 'stop.sh'), { env, stdio: 'ignore' }) } catch {}
    rmSync(fixture, { recursive: true, force: true })
  }
})
