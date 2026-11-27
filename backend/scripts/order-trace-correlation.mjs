import assert from 'node:assert/strict'

const commandRoute = (route) => /^\/api\/(orders|admin\/disputes)(?:\/|$)/.test(route)

// OrderEvent.requestId is the command idempotency key, not an HTTP request ID.
// Join the browser response to application telemetry without trusting client IDs.
export function correlateOrderEvents(events, responses, requestLogs) {
  return events.map((event) => {
    const response = responses.find((entry) =>
      entry.commandKey === event.request_id && entry.status >= 200 && entry.status < 300 &&
      requestLogs.some((log) => log.requestId === entry.applicationRequestId &&
        log.method === 'POST' && log.status === entry.status && commandRoute(log.route)))
    assert.ok(response, `No application HTTP trace matched ${event.operation} command`)
    assert.match(response.applicationRequestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)
    return { operation: event.operation, commandKey: event.request_id,
      applicationRequestId: response.applicationRequestId }
  })
}
