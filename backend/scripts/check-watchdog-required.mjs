import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const name = `bazaar-watchdog-required-${randomUUID().replaceAll('-', '')}`
const image = execFileSync('sudo', ['-n', 'docker', 'image', 'inspect',
  'bazaar-ha-patroni:4.1.5-pg17.11', '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 10000 }).trim()
assert.match(image, /^sha256:[a-f0-9]{64}$/)
const code = `import json, os, pathlib
from watchdog_policy import configure_watchdog
from patroni.watchdog import Watchdog
config = json.loads(pathlib.Path('/opt/ha/patroni.json').read_text())
configure_watchdog(config, os.environ)
device = config['watchdog']['device']
assert not pathlib.Path(device).exists(), 'Probe must never open a real watchdog'
settings = dict(config['bootstrap']['dcs'], watchdog=config['watchdog'])
watchdog = Watchdog(settings)
assert watchdog.config.timeout == settings['ttl'] // 2
assert not watchdog.is_healthy
activated = watchdog.activate()
assert activated is False
assert not watchdog.is_running
watchdog.disable()
print(json.dumps({'mode': config['watchdog']['mode'], 'deviceAbsent': True,
  'timeoutSeconds': settings['ttl'] // 2, 'activated': activated, 'running': watchdog.is_running}))`

const output = execFileSync('sudo', ['-n', 'docker', 'run', '--rm', '--name', name,
  '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--user', 'postgres', '--workdir', '/opt/ha',
  '--entrypoint', '/opt/patroni/bin/python', image, '-B', '-c', code],
  { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
const result = JSON.parse(output.trim())
assert.equal(result.mode, 'required')
assert.equal(result.activated, false)
assert.equal(result.running, false)
assert.equal(result.deviceAbsent, true)
const override = spawnSync('sudo', ['-n', 'docker', 'run', '--rm', '--name', `${name}-override`,
  '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', 'postgres',
  '--security-opt', 'no-new-privileges:true',
  '--env', 'PATRONI_CONFIGURATION=watchdog: {mode: off}', image],
  { encoding: 'utf8', timeout: 30000 })
assert.equal(override.status, 1, 'Native override must fail before bootstrap')
assert.match(override.stderr, /Native Patroni environment overrides are not supported/)
const remaining = execFileSync('sudo', ['-n', 'docker', 'ps', '-a', '--filter', `name=^/${name}$`,
  '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 10000 }).trim()
assert.equal(remaining, '', 'Owned watchdog probe container was not removed')
assert.equal(execFileSync('sudo', ['-n', 'docker', 'ps', '-a', '--filter', `name=^/${name}-override$`,
  '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 10000 }).trim(), '')
await mkdir('.tmp', { recursive: true })
const report = { timestamp: new Date().toISOString(), image, result,
  nativeOverrideRejectedBeforeBootstrap: true, cleaned: true,
  limitations: ['missing-device activation rejection only', 'no host device mounted or modified',
    'not proof of physical fencing or production deployment'] }
await writeFile('.tmp/watchdog-required-report.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify(report))
