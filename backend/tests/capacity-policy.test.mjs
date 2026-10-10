import assert from 'node:assert/strict'
import test from 'node:test'
import { readCapacityPolicy } from '../scripts/capacity-policy.mjs'

test('capacity configuration keeps the confirmed load target and validates test controls', () => {
  const baseline = readCapacityPolicy({})
  assert.equal(baseline.users, 1000)
  assert.equal(baseline.rate, 500)
  assert.equal(baseline.poolMax, 5)
  assert.equal(baseline.maxInFlightRequests, 200)
  assert.equal(readCapacityPolicy({ CAPACITY_MAX_IN_FLIGHT: '100' }).maxInFlightRequests, 100)
  assert.equal(baseline.writePhases, 'staggered')
  assert.equal(baseline.databaseTopology, 'single')
  assert.equal(
    readCapacityPolicy({ CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha' }).databaseTopology,
    'synchronous-ha'
  )
  assert.equal(
    readCapacityPolicy({
      CAPACITY_PHASES: 'aligned',
      CAPACITY_POOL_MAX: '10',
      CAPACITY_SECONDS: '300'
    }).seconds,
    300
  )
  for (const env of [
    { CAPACITY_PHASES: 'unknown' },
    { CAPACITY_POOL_MAX: '0' },
    { CAPACITY_POOL_MAX: '101' },
    { CAPACITY_MAX_IN_FLIGHT: '0' },
    { CAPACITY_MAX_IN_FLIGHT: '10001' },
    { CAPACITY_SECONDS: '59' },
    { CAPACITY_SECONDS: '1801' },
    { CAPACITY_SECONDS: '60.5' },
    { CAPACITY_DATABASE_TOPOLOGY: 'unknown' }
  ])
    assert.throws(() => readCapacityPolicy(env))
})

test('database fault keeps the arrival target and provisions enough independent inventory', () => {
  const policy = readCapacityPolicy({
    CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
    CAPACITY_DATABASE_FAULT: 'primary-kill',
    CAPACITY_SECONDS: '120'
  })
  assert.equal(policy.databaseFault, 'primary-kill')
  assert.equal(policy.users, 1000)
  assert.equal(policy.rate, 500)
  assert.ok(policy.listings / 2 >= 6000)
  assert.throws(() => readCapacityPolicy({ CAPACITY_DATABASE_FAULT: 'unknown' }))
  assert.throws(
    () => readCapacityPolicy({ CAPACITY_DATABASE_FAULT: 'primary-kill' }),
    /synchronous HA/
  )
})

test('all-replica loss is an explicit synchronous HA fault mode', () => {
  const policy = readCapacityPolicy({
    CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
    CAPACITY_DATABASE_FAULT: 'replicas-stop'
  })
  assert.equal(policy.databaseFault, 'replicas-stop')
  assert.throws(() => readCapacityPolicy({ CAPACITY_DATABASE_FAULT: 'replicas-stop' }))
})

test('dual database ingress is an explicit HA-only capacity topology', () => {
  const policy = readCapacityPolicy({ CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
    CAPACITY_SECOND_DATABASE_ADDRESS: '127.0.0.1:41002' })
  assert.equal(policy.secondDatabaseAddress, '127.0.0.1:41002')
  assert.throws(() => readCapacityPolicy({ CAPACITY_SECOND_DATABASE_ADDRESS: '127.0.0.1:41002' }))
  assert.throws(() => readCapacityPolicy({ CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
    CAPACITY_SECOND_DATABASE_ADDRESS: 'remote.example:5432' }))
})

test('gateway fault needs two distinct HA ingresses and preserves the full write target', () => {
  const policy = readCapacityPolicy({ CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha',
    CAPACITY_SECOND_DATABASE_ADDRESS: '127.0.0.1:41002', CAPACITY_DATABASE_FAULT: 'gateway-kill', CAPACITY_SECONDS: '120' })
  assert.equal(policy.rate, 500)
  assert.equal(policy.users, 1000)
  assert.ok(policy.listings / 2 >= 6001)
  assert.throws(() => readCapacityPolicy({ CAPACITY_DATABASE_TOPOLOGY: 'synchronous-ha', CAPACITY_DATABASE_FAULT: 'gateway-kill' }))
})
