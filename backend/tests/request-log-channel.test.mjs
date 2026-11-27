import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers'
import { PassThrough } from 'node:stream'
import { RequestTelemetry } from '../dist/common/request-telemetry.js'
import { attachRequestLogChannel, requestLogMessage } from './helpers/request-log-channel.mjs'

test('31 recovered application records after ready reach original sink across split/coalesced lines', async () => {
  const output = new PassThrough(),
    logs = [],
    control = []
  const done = attachRequestLogChannel(
    output,
    (e) => logs.push(e),
    (r) => control.push(r)
  )
  output.write('{"ready":true,"uid":65534}\n')
  await new Promise((r) => setImmediate(r))
  for (let i = 0; i < 31; i++) {
    const telemetry = new RequestTelemetry(),
      request = { headers: {}, method: 'POST', routeOptions: { url: '/api/auth/session' } }
    const reply = { statusCode: 401, header() {} }
    telemetry.start(request, reply)
    telemetry.finish(request, reply, (entry) => {
      const line =
        JSON.stringify(requestLogMessage({ ...entry, uid: 65534, pid: 12345, cookie: 'SECRET' })) +
        '\n'
      output.write(line.slice(0, 20))
      output.write(line.slice(20))
    })
  }
  output.end()
  await done
  assert.equal(logs.length, 31)
  assert.equal(control.length, 1)
  assert.equal(control[0].ready, true)
  for (const e of logs) {
    assert.equal(e.uid, 65534)
    assert.equal(e.pid, 12345)
    assert.equal(e.statusSource, 'application')
    assert.equal(e.applicationRequestId, e.requestId)
  }
  assert.equal(JSON.stringify(logs).includes('SECRET'), false)
})
