import { createServer, request, Agent } from 'node:http'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'

// Test gateway only. Production ingress must implement and validate its own policy.
const readPaths = new Set(['/api/listings/search', '/api/listings/home', '/api/auth/session', '/api/orders/search'])
const isRead = (method, url) => method === 'POST' &&
  (readPaths.has(new URL(url, 'http://localhost').pathname) ||
    /^\/api\/listings\/[0-9a-f-]{36}\/detail$/.test(new URL(url, 'http://localhost').pathname))

export async function capacityGateway(instances, { virtualClients } = {}) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1000 })
  const stats = { attempts: [0, 0], completed: [0, 0], readRetries: 0, writeRetries: 0 }
  let next = 0
  const server = createServer(async (req, res) => {
    const chunks = []
    let bytes = 0
    try {
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 1048576) { res.writeHead(413); res.end('{}'); return }
        chunks.push(chunk)
      }
    } catch { res.destroy(); return }
    const body = Buffer.concat(chunks)
    const headers = { ...req.headers }
    for (const name of ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-capacity-client']) delete headers[name]
    if (virtualClients && req.headers['x-capacity-client'] !== undefined) {
      const ip = virtualClients.get(req.headers['x-capacity-client'])
      if (!ip) { res.writeHead(400); res.end('{}'); return }
      headers['x-forwarded-for'] = ip
    }
    const tried = new Set()
    async function forward() {
      const candidates = instances.map((instance, index) => ({ instance, index }))
        .filter(({ instance, index }) => instance.healthy && !tried.has(index))
      const candidate = candidates[next++ % candidates.length]
      if (!candidate) { res.writeHead(503); res.end('{}'); return }
      const { instance, index } = candidate
      tried.add(index)
      stats.attempts[index]++
      let headersReceived = false
      const upstream = request({ hostname: '127.0.0.1', port: instance.port, path: req.url,
        method: req.method, headers, agent }, (reply) => {
        headersReceived = true
        res.writeHead(reply.statusCode, { ...reply.headers, 'x-capacity-api-index': String(index) })
        reply.on('end', () => { stats.completed[index]++ })
        reply.on('error', () => res.destroy())
        reply.pipe(res)
      })
      upstream.setTimeout(5000, () => upstream.destroy(new Error('Upstream timeout')))
      upstream.on('error', () => {
        instance.healthy = false
        if (headersReceived) { res.destroy(); return }
        if (isRead(req.method, req.url) && tried.size < instances.length) {
          stats.readRetries++
          void forward()
        } else { res.writeHead(502); res.end('{}') }
      })
      upstream.end(body)
    }
    await forward()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, stats, close: async () => {
    agent.destroy()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  } }
}
