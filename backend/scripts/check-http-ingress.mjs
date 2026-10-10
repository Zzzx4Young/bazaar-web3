import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { httpIngressEnvironment, cleanupHttpIngress } from './http-ingress-environment.mjs'

// Transport fixtures only: never represent these responses as marketplace data.
const root = new URL('../../', import.meta.url).pathname
const origin = 'http://localhost:3000'
const project = `bazaar-http-${randomUUID().replaceAll('-', '')}`
const policy = Object.freeze({ deadlineMs: 15_000, pollMs: 100, requestTimeoutMs: 3000 })
const sources = ['infra/http/haproxy.cfg', 'infra/compose.http-validation.yaml',
  'backend/scripts/check-http-ingress.mjs', 'backend/scripts/http-ingress-environment.mjs']
const fingerprint = async () => Object.fromEntries(await Promise.all(sources.map(async name =>
  [name, createHash('sha256').update(await readFile(root + name)).digest('hex')])))
const report = { timestamp: new Date().toISOString(), project,
  scope: 'local HAProxy transport fixtures; no real API, PostgreSQL, capacity, TLS or host-fault acceptance',
  policy, passed: false, cleaned: false, observations: [] }
const backends = []
let setupStarted = false, ingress
const compose = (...args) => ingress.compose(...args)
async function until(check) {
  const started = performance.now()
  do {
    if (await check()) return performance.now() - started
    await new Promise(resolve => setTimeout(resolve, policy.pollMs))
  } while (performance.now() - started < policy.deadlineMs)
  throw new Error('HTTP ingress readiness deadline exceeded')
}
async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
async function unusedPort() {
  const server = createServer()
  const port = await listen(server)
  await new Promise(resolve => server.close(resolve))
  return port
}
async function post(port, path = '/transport/read', spoof = false) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
      headers: { origin, 'content-type': 'application/json',
        ...(spoof ? { forwarded: 'for=203.0.113.1', 'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '203.0.113.3', 'x-capacity-client': 'unregistered' } : {}) },
      body: '{}', signal: AbortSignal.timeout(policy.requestTimeoutMs) })
    const text = await response.text()
    let value
    try { value = JSON.parse(text) } catch { value = null }
    return { status: response.status, value }
  } catch { return { status: 0 } }
}

try {
  report.sourceHashes = await fingerprint()
  for (let index = 0; index < 2; index++) {
    const backend = { id: `transport-${index}`, ready: false, mutations: 0 }
    backend.server = createServer((req, res) => {
      if (req.url === '/api/health/ready') {
        const validProbe = req.method === 'POST' && req.headers.origin === origin
        res.writeHead(validProbe && backend.ready ? 200 : 503)
        res.end('{}'); return
      }
      if (req.url === '/transport/lost-write') {
        backend.mutations++
        req.socket.destroy(); return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: backend.id, headers: {
        forwarded: req.headers.forwarded, forwardedFor: req.headers['x-forwarded-for'],
        realIp: req.headers['x-real-ip'], capacityClient: req.headers['x-capacity-client']
      } }))
    })
    backend.port = await listen(backend.server)
    backends.push(backend)
  }
  const ports = [await unusedPort(), await unusedPort()]
  assert.notEqual(ports[0], ports[1])
  report.endpoints = ports.map(port => `127.0.0.1:${port}`)
  ingress = await httpIngressEnvironment({ project, origin,
    apiPorts: backends.map(backend => backend.port), ingressPorts: ports })
  setupStarted = true
  await compose('up', '-d')
  for (const port of ports) await until(async () => (await post(port)).status === 503)
  report.observations.push({ check: 'both-backends-unready', status: 503 })
  backends.forEach(backend => { backend.ready = true })
  for (const port of ports) {
    await until(async () => {
      const responses = await Promise.all(Array.from({ length: 4 }, () => post(port)))
      return responses.every(response => response.status === 200) &&
        new Set(responses.map(response => response.value.id)).size === 2
    })
    const ids = new Set()
    for (let i = 0; i < 10; i++) {
      const response = await post(port, '/transport/read', true)
      assert.equal(response.status, 200)
      ids.add(response.value.id)
      assert.deepEqual(response.value.headers, { forwardedFor: '127.0.0.1' })
    }
    assert.equal(ids.size, 2)
  }
  report.observations.push({ check: 'both-ingresses-route-both-backends-and-strip-spoofed-headers', passed: true })
  backends[0].ready = false
  for (const port of ports) {
    await until(async () => {
      const responses = await Promise.all(Array.from({ length: 4 }, () => post(port)))
      return responses.every(response => response.status === 200 && response.value.id === backends[1].id)
    })
  }
  report.observations.push({ check: 'unready-backend-excluded', survivor: backends[1].id })
  for (const port of ports) {
    const before = backends.reduce((sum, backend) => sum + backend.mutations, 0)
    const response = await post(port, '/transport/lost-write')
    assert.ok([0, 502, 503].includes(response.status))
    assert.equal(backends.reduce((sum, backend) => sum + backend.mutations, 0) - before, 1)
  }
  report.observations.push({ check: 'lost-write-response', attemptsPerRequest: 1 })
  for (let index = 0; index < 2; index++) {
    const started = performance.now()
    await compose('kill', '-s', 'SIGKILL', `ingress${index + 1}`)
    assert.equal((await post(ports[index])).status, 0)
    assert.equal((await post(ports[1 - index])).status, 200)
    const survivorMs = performance.now() - started
    assert.ok(survivorMs <= policy.deadlineMs)
    await compose('up', '-d', `ingress${index + 1}`)
    const restoredMs = await until(async () => (await post(ports[index])).status === 200)
    report.observations.push({ check: 'ingress-process-kill-and-restore', index, survivorMs, restoredMs })
  }
  assert.deepEqual(await fingerprint(), report.sourceHashes)
  report.passed = true
} catch (error) {
  report.failure = error.message
  process.exitCode = 1
} finally {
  if (setupStarted) {
    report.cleaned = await cleanupHttpIngress(ingress)
    if (!report.cleaned) { report.passed = false; process.exitCode = 1 }
  } else await ingress?.dispose()
  for (const backend of backends) {
    backend.server.closeAllConnections()
    await new Promise(resolve => backend.server.close(resolve))
  }
  await mkdir(root + 'backend/.tmp', { recursive: true })
  await writeFile(root + 'backend/.tmp/http-ingress-transport-report.json',
    JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report))
}
