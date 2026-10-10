import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { capacityGateway } from '../scripts/capacity-gateway.mjs'

test('gateway retries reads but never replays a write after a lost response', async () => {
  let firstAttempts = 0, secondAttempts = 0
  const first = createServer((req) => {
    req.resume()
    req.on('end', () => {
      firstAttempts++
      // Emulate successful processing followed by response loss.
      req.socket.destroy()
    })
  })
  const second = createServer((req, res) => {
    req.resume()
    req.on('end', () => { secondAttempts++; res.end('{}') })
  })
  let gateway
  try {
    first.listen(0, '127.0.0.1'); second.listen(0, '127.0.0.1')
    await Promise.all([once(first, 'listening'), once(second, 'listening')])
    const instances = [first, second].map((server) => ({ port: server.address().port, healthy: true }))
    gateway = await capacityGateway(instances)
    const post = (path) => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: gateway.server.address().port,
        path, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', reject); req.end('{}')
    })
    assert.equal(await post('/api/orders'), 502)
    assert.equal(firstAttempts, 1)
    assert.equal(secondAttempts, 0)
    await gateway.close()
    instances[0].healthy = true
    gateway = await capacityGateway(instances)
    assert.equal(await post('/api/listings/search'), 200)
    assert.equal(firstAttempts, 2)
    assert.equal(secondAttempts, 1)
    assert.equal(gateway.stats.readRetries, 1)
  } finally {
    await gateway?.close()
    for (const server of [first, second]) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('virtual identities are assigned by the isolated gateway and auth mutations are never retried', async () => {
  let mutations = 0, survivorMutations = 0, seen
  const first = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (req.url === '/api/auth/login' || req.url === '/api/auth/logout') { mutations++; req.socket.destroy(); return }
      seen = req.headers; res.end('{}')
    })
  })
  const second = createServer((req, res) => { req.resume(); survivorMutations++; res.end('{}') })
  let gateway
  try {
    first.listen(0, '127.0.0.1'); second.listen(0, '127.0.0.1')
    await Promise.all([once(first, 'listening'), once(second, 'listening')])
    const instances = [first, second].map(server => ({ port: server.address().port, healthy: true }))
    async function send(path, extra = {}) {
      return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: gateway.server.address().port,
          method: 'POST', path, headers: { 'content-type': 'application/json', ...extra } }, res => {
          res.resume(); res.on('end', () => resolve({ status: res.statusCode, apiIndex: res.headers['x-capacity-api-index'] }))
        })
        req.on('error', reject); req.end('{}')
      })
    }
    for (const path of ['/api/auth/login', '/api/auth/logout']) {
      instances[0].healthy = true
      gateway = await capacityGateway(instances, { virtualClients: new Map([['actor', '198.18.0.1']]) })
      assert.equal((await send(path, { 'x-capacity-client': 'actor' })).status, 502)
      await gateway.close(); gateway = undefined
    }
    assert.equal(mutations, 2); assert.equal(survivorMutations, 0)
    instances[0].healthy = true
    gateway = await capacityGateway(instances, { virtualClients: new Map([['actor', '198.18.0.1']]) })
    assert.equal((await send('/api/auth/session', { 'x-capacity-client': 'unknown' })).status, 400)
    const response = await send('/api/auth/session', { 'x-capacity-client': 'actor',
      'x-forwarded-for': '203.0.113.2', forwarded: 'for=203.0.113.3', 'x-real-ip': '203.0.113.4' })
    assert.equal(response.status, 200); assert.equal(response.apiIndex, '0')
    assert.equal(seen['x-forwarded-for'], '198.18.0.1')
    assert.equal(seen.forwarded, undefined); assert.equal(seen['x-real-ip'], undefined)
    assert.equal(seen['x-capacity-client'], undefined)
  } finally {
    await gateway?.close()
    for (const server of [first, second]) {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    }
  }
})
