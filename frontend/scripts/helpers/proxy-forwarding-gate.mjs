// Test-only loopback transport gate. It never fabricates an application response.
import { createServer, request } from 'node:http'
import assert from 'node:assert/strict'

export async function forwardingGate(backendOrigin) {
  const backend = new URL(backendOrigin)
  assert.equal(backend.protocol, 'http:')
  assert.ok(['127.0.0.1', 'localhost'].includes(backend.hostname))
  const attempts = []
  let armed = null
  const server = createServer(async (incoming, outgoing) => {
    const purchase = incoming.method === 'POST' && incoming.url === '/api/web3/orders'
    const mode = purchase ? (armed ?? 'forward') : 'forward'
    if (purchase) armed = null
    const row = purchase
      ? {
          mode,
          key: incoming.headers['idempotency-key'] ?? null,
          proxyRequestId: incoming.headers['x-proxy-request-id'] ?? null,
          startedAt: new Date().toISOString()
        }
      : null
    if (row) attempts.push(row)
    if (mode === 'disconnect-before-forward') {
      incoming.resume()
      outgoing.destroy()
      return
    }
    // Preserve the Next proxy's forwarded host, cookie, CSRF and idempotency headers.
    const upstream = request(
      new URL(incoming.url, backend),
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: backend.host }
      },
      (response) => {
        if (row) row.upstreamStatus = response.statusCode
        if (mode === 'disconnect-after-commit') {
          const chunks = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => {
            // Read a genuine successful create response before losing it on the wire.
            // The browser must recover this order through persistent idempotency.
            try {
              row.committedOrderId = JSON.parse(Buffer.concat(chunks).toString()).orderId ?? null
            } catch {
              row.committedOrderId = null
            }
            row.applicationRequestId = response.headers['x-application-request-id'] ?? null
            outgoing.destroy()
          })
        } else {
          outgoing.writeHead(response.statusCode, response.headers)
          response.pipe(outgoing)
        }
        response.on('error', () => outgoing.destroy())
      }
    )
    upstream.on('error', () => outgoing.destroy())
    incoming.on('error', () => upstream.destroy())
    outgoing.on('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    attempts,
    arm(mode) {
      assert.ok(['disconnect-before-forward', 'disconnect-after-commit'].includes(mode))
      assert.equal(armed, null, 'Previous purchase fault has not been consumed')
      armed = mode
    },
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
