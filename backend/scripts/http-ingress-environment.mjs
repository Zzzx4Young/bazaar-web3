import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)
export async function cleanupHttpIngress(environment) {
  try {
    await environment.compose('down', '--remove-orphans')
    assert.equal((await environment.compose('ps', '-a', '-q')).stdout.trim(), '')
    await environment.dispose()
    return true
  } catch {
    // Keep the environment file when cleanup fails; it is needed to recover.
    return false
  }
}
export async function httpIngressEnvironment({ project, origin, apiPorts, ingressPorts }) {
  assert.match(project, /^bazaar-http-[0-9a-f]{32}$/)
  assert.equal(new URL(origin).origin, origin)
  assert.equal(apiPorts.length, 2)
  assert.equal(ingressPorts.length, 2)
  for (const port of [...apiPorts, ...ingressPorts])
    assert.ok(Number.isSafeInteger(port) && port > 1024 && port <= 65535)
  assert.equal(new Set([...apiPorts, ...ingressPorts]).size, 4)
  const directory = await mkdtemp(join(tmpdir(), 'bazaar-http-'))
  const file = join(directory, 'ingress.env')
  const values = { APP_ORIGIN: origin, API_ONE_ADDRESS: `127.0.0.1:${apiPorts[0]}`,
    API_TWO_ADDRESS: `127.0.0.1:${apiPorts[1]}`,
    HTTP_ONE_PORT: ingressPorts[0], HTTP_TWO_PORT: ingressPorts[1] }
  try {
    await writeFile(file, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', { mode: 0o600 })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    compose: (...args) => run('sudo', ['-n', 'docker', 'compose', '-p', project, '--env-file', file,
      '-f', 'infra/compose.http-validation.yaml', ...args], {
      cwd: new URL('../../', import.meta.url).pathname, timeout: 60_000
    }),
    dispose: () => rm(directory, { recursive: true, force: true })
  }
}
