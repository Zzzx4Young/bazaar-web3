import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, copyFileSync, readFileSync
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
