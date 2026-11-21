import { createInterface } from 'node:readline'

// Only RequestTelemetry's structured diagnostic fields cross this channel.
// In particular, never forward a request object or an Error / message / stack.
export function requestLogMessage(entry) {
  const {
    event,
    timestamp,
    requestId,
    applicationRequestId,
    proxyRequestId,
    statusSource,
    pid,
    uid,
    method,
    route,
    status,
    durationMs,
    errorCode,
    failure
  } = entry
  return {
    type: 'request_telemetry',
    entry: {
      event,
      timestamp,
      requestId,
      applicationRequestId,
      proxyRequestId,
      statusSource,
      pid,
      uid,
      method,
      route,
      status,
      durationMs,
      ...(errorCode ? { errorCode } : {}),
      ...(failure
        ? {
            failure: {
              class: failure.class,
              codes: failure.codes,
              ...(failure.transaction
                ? {
                    transaction: {
                      phase: failure.transaction.phase,
                      attempt: failure.transaction.attempt
                    }
                  }
                : {})
            }
          }
        : {})
    }
  }
}

// Keep reading after ready: the recovered API lives beyond the readiness promise.
export function attachRequestLogChannel(stream, sink, onControl) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message?.type === 'request_telemetry') {
      if (sink) sink(requestLogMessage(message.entry).entry)
    } else onControl(message)
  })
  return new Promise((resolve, reject) => {
    lines.once('close', resolve)
    stream.once('error', reject)
  })
}
