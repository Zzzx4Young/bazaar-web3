import assert from 'node:assert/strict'
import test from 'node:test'
import { RequestTelemetry } from '../dist/common/request-telemetry.js'

const reply = () => ({
  statusCode: 200,
  headers: {},
  header(name, value) {
    this.headers[name.toLowerCase()] = value
    return this
  }
})

test('request IDs correlate safe success and error logs', () => {
  const telemetry = new RequestTelemetry()
  const logs = []
  const response = reply()
  const request = {
    headers: { 'x-request-id': 'test.request-123' },
    id: '',
    method: 'POST',
    routeOptions: { url: '/api/health/live' }
  }
  telemetry.start(request, response)
  telemetry.finish(request, response, (entry) => logs.push(entry))

  assert.equal(request.id, 'test.request-123')
  assert.equal(response.headers['x-request-id'], request.id)
  assert.equal(logs[0].requestId, request.id)
  assert.equal(logs[0].route, '/api/health/live')
  assert.equal(logs[0].status, 200)
  assert.equal(typeof logs[0].durationMs, 'number')

  const secret = 'must-not-appear'
  const invalidResponse = reply()
  invalidResponse.statusCode = 404
  const invalid = {
    headers: { 'x-request-id': 'invalid request id', cookie: secret },
    id: '',
    method: 'POST',
    routeOptions: undefined,
    url: `/api/${secret}?address=${secret}`,
    body: { accessCode: secret }
  }
  telemetry.start(invalid, invalidResponse)
  telemetry.setError(invalid, 'NOT_FOUND')
  telemetry.finish(invalid, invalidResponse, (entry) => logs.push(entry))

  assert.match(invalid.id, /^[0-9a-f-]{36}$/)
  assert.equal(invalidResponse.headers['x-request-id'], invalid.id)
  assert.equal(logs[1].route, 'unmatched')
  assert.equal(logs[1].errorCode, 'NOT_FOUND')
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('request log sink failures do not alter request handling', () => {
  const telemetry = new RequestTelemetry()
  const original = console.error
  const fallback = []
  console.error = (value) => fallback.push(value)
  try {
    const response = reply()
    const request = {
      headers: {},
      id: '',
      method: 'POST',
      routeOptions: { url: '/api/health/live' }
    }
    telemetry.start(request, response)
    telemetry.finish(request, response, () => {
      throw new Error('private sink failure')
    })
    assert.equal(response.statusCode, 200)
    assert.equal(fallback.length, 1)
    assert.equal(fallback[0].includes('private sink failure'), false)
    assert.match(fallback[0], /^\{"event":"request_log_failed","requestId":"[0-9a-f-]{36}"\}$/)
  } finally {
    console.error = original
  }
})

test('unexpected errors retain only bounded safe codes correlated with the request, never error data', () => {
  const telemetry = new RequestTelemetry(), response = reply(), logs = []
  const request = { headers: { 'x-request-id': 'r08-safe' }, id: '', method: 'POST', routeOptions: { url: '/api/example/:id' } }
  const secret = 'PRIVATE_COOKIE_SIGNATURE_URL'
  const error = Object.assign(new Error(secret), {
    code: 'P2010', meta: { code: '40P01', query: secret }, cause: { message: secret, code: '40P01' }
  })
  telemetry.start(request, response)
  response.statusCode = 500
  telemetry.setError(request, 'INTERNAL_ERROR', error)
  telemetry.finish(request, response, (entry) => logs.push(entry))
  assert.equal(logs[0].requestId, 'r08-safe')
  assert.deepEqual(logs[0].failure.codes, ['P2010', '40P01'])
  assert.equal(logs[0].failure.class, 'Error')
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('transaction failure diagnostics distinguish work and commit without changing failures', async () => {
  const { transact } = await import('../dist/database/transaction.js')
  const { safeFailure } = await import('../dist/common/failure-diagnostics.js')
  for (const phase of ['work', 'commit']) {
    const error = Object.assign(new Error('secret database operation'), { code: 'P2028' })
    const client = { $transaction: async (work) => {
      const tx = { $queryRaw: async () => [] }
      const result = await work(tx)
      if (phase === 'commit') throw error
      return result
    } }
    await assert.rejects(transact(client, async () => { if (phase === 'work') throw error }), (e) => e === error)
    assert.deepEqual(safeFailure(error).transaction, { phase, attempt: 1 })
    assert.equal(JSON.stringify(safeFailure(error)).includes('secret'), false)
  }
})

test('diagnostic traversal handles cycles and rejects arbitrary codes and error names', async () => {
  const { safeFailure } = await import('../dist/common/failure-diagnostics.js')
  const e = Object.assign(new Error('secret'), { name: 'secret', code: 'secret' }); e.cause = e
  assert.deepEqual(safeFailure(e), { class: 'Unknown', codes: [] })
})
