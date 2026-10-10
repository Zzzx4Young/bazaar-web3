import { validateSecondDatabaseAddress } from './capacity-database-ingress.mjs'
import { readDatabasePoolConfig } from '../dist/database/database-policy.js'
import { readMaxInFlightRequests } from '../dist/common/request-policy.js'

const users = 1000
const rate = 500
const baselineListings = 10000
const writeBuyerFraction = 0.2
const roundsPerWritePair = 2
export const capacityBusinessMixPolicy = Object.freeze({ slots: 10, readSlots: 8 })

// Keep a 20-second healthy baseline and 20 seconds on the surviving API.
export const capacityApiFaultPolicy = Object.freeze({
  injectAfterMs: 20_000,
  replaceAfterMs: 40_000
})

export function readCapacityPolicy(env) {
  const databaseTopology = env.CAPACITY_DATABASE_TOPOLOGY ?? 'single'
  if (!['single', 'synchronous-ha'].includes(databaseTopology))
    throw new Error('Invalid capacity database topology')
  const secondDatabaseAddress = env.CAPACITY_SECOND_DATABASE_ADDRESS
  if (secondDatabaseAddress !== undefined) {
    validateSecondDatabaseAddress(secondDatabaseAddress)
    if (databaseTopology !== 'synchronous-ha') throw new Error('Dual database ingress requires synchronous HA')
  }
  const databaseFault = env.CAPACITY_DATABASE_FAULT ?? 'none'
  if (!['none', 'primary-kill', 'replicas-stop', 'gateway-kill'].includes(databaseFault))
    throw new Error('Invalid capacity database fault')
  if (databaseFault !== 'none' && databaseTopology !== 'synchronous-ha')
    throw new Error('Database fault requires synchronous HA')
  if (databaseFault === 'gateway-kill' && secondDatabaseAddress === undefined)
    throw new Error('Gateway fault requires dual database ingress')
  const writePhases = env.CAPACITY_PHASES ?? 'staggered'
  if (!['staggered', 'aligned'].includes(writePhases))
    throw new Error('Invalid capacity write phases')
  const rawSeconds = env.CAPACITY_SECONDS ?? '60'
  const seconds = Number(rawSeconds)
  if (!/^\d+$/.test(rawSeconds) || !Number.isSafeInteger(seconds) || seconds < 60 || seconds > 1800)
    throw new Error('Capacity duration must be an integer between 60 and 1800 seconds')
  const pool = readDatabasePoolConfig(
    env.CAPACITY_POOL_MAX === undefined ? {} : { DB_POOL_MAX: env.CAPACITY_POOL_MAX }
  )
  const physicalItems =
    Math.ceil((rate * seconds) / users / roundsPerWritePair) * users * writeBuyerFraction
  return {
    users,
    rate,
    seconds,
    // Each independent write pair consumes one physical item. Half the catalog is physical.
    listings:
      databaseFault === 'none'
        ? baselineListings
        : Math.max(baselineListings, 2 * (physicalItems + 1)),
    timeoutMs: 5000,
    poolMax: pool.max,
    maxInFlightRequests: readMaxInFlightRequests(
      env.CAPACITY_MAX_IN_FLIGHT === undefined
        ? {}
        : { API_MAX_IN_FLIGHT: env.CAPACITY_MAX_IN_FLIGHT }
    ),
    writePhases,
    databaseTopology,
    secondDatabaseAddress,
    databaseFault
  }
}
