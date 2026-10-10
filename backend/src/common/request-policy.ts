export const requestPolicy = Object.freeze({
  defaultMaxInFlight: 200,
  maxInFlightLimit: 10000,
  maxBodyBytes: 1024 * 1024
})

export function readMaxInFlightRequests(env: NodeJS.ProcessEnv): number {
  const raw = env.API_MAX_IN_FLIGHT
  if (raw === undefined) return requestPolicy.defaultMaxInFlight
  const value = Number(raw)
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > requestPolicy.maxInFlightLimit
  )
    throw new Error('API_MAX_IN_FLIGHT must be an integer between 1 and 10000')
  return value
}
