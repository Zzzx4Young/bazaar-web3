import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { forwardingGate } from './proxy-forwarding-gate.mjs'

test('gate breaks transport before commit and after commit, then forwards a replay unchanged', async () => {
  const received = []
  const upstream = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received.push({ path: req.url, key: req.headers['idempotency-key'], body })
    res.setHeader('set-cookie', ['one=1; HttpOnly', 'two=2; HttpOnly'])
    res.setHeader('x-application-request-id', 'app-id')
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ orderId: 'one-order' }))
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const gate = await forwardingGate(`http://127.0.0.1:${upstream.address().port}`)
  const buy = () =>
    fetch(gate.origin + '/api/web3/orders', {
      method: 'POST',
      headers: { 'idempotency-key': 'same-key' },
      body: '{"listingId":"one"}'
    })
  try {
    gate.arm('disconnect-before-forward')
    // Non-purchase requests keep working, and do not consume the armed fault.
    assert.equal((await fetch(gate.origin + '/api/auth/session')).status, 201)
    await assert.rejects(buy(), /fetch failed/)
    assert.equal(received.filter((r) => r.path === '/api/web3/orders').length, 0)
    gate.arm('disconnect-after-commit')
    await assert.rejects(buy(), /fetch failed/)
    assert.equal(received.filter((r) => r.path === '/api/web3/orders').length, 1)
    const replay = await buy()
    assert.equal(replay.status, 201)
    assert.deepEqual(await replay.json(), { orderId: 'one-order' })
    assert.equal(replay.headers.get('x-application-request-id'), 'app-id')
    assert.equal(replay.headers.getSetCookie().length, 2)
    assert.deepEqual(received.at(-1), received.at(-2))
    assert.deepEqual(
      gate.attempts.map((r) => r.mode),
      ['disconnect-before-forward', 'disconnect-after-commit', 'forward']
    )
    assert.equal(gate.attempts[1].upstreamStatus, 201)
  } finally {
    await gate.close()
    upstream.closeAllConnections()
    await new Promise((r) => upstream.close(r))
  }
})
