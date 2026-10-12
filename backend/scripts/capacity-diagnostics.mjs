export const capacityDiagnosticPolicy = Object.freeze({ maxSamples: 100, samplesPerError: 5 })

const publicCodes = new Set(['OVERLOADED', 'DATABASE_UNAVAILABLE', 'RETRY_EXHAUSTED',
  'RATE_LIMITED', 'UNAVAILABLE', 'INVALID_INPUT', 'UNAUTHENTICATED', 'INTERNAL_ERROR',
  'STATE_CONFLICT', 'LISTING_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INVENTORY_CONFLICT'])

export function capacityHttpError(response, message) {
  const error = new Error(message)
  error.code = `HTTP_${response.status}`
  if (publicCodes.has(response.value?.code)) error.responseCode = response.value.code
  if ([0, 1].includes(response.apiIndex)) error.apiIndex = response.apiIndex
  return error
}

export function capacityFailureSamples() {
  const samples = [], counts = new Map()
  return {
    samples,
    record(key, { index, elapsedMs, kind, error }) {
      const count = counts.get(key) ?? 0
      if (count >= capacityDiagnosticPolicy.samplesPerError ||
        samples.length >= capacityDiagnosticPolicy.maxSamples) return
      counts.set(key, count + 1)
      // Never serialize request payloads, tokens, raw responses or error messages.
      samples.push({ index, elapsedMs, kind, code: error.code, name: error.name,
        ...(publicCodes.has(error.responseCode) ? { responseCode: error.responseCode } : {}),
        ...([0, 1].includes(error.apiIndex) ? { apiIndex: error.apiIndex } : {}) })
    }
  }
}
