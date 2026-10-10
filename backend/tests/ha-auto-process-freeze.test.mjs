import assert from 'node:assert/strict'
import test from 'node:test'
import {
  freezeQualification,
  ownedProcessTarget,
  managementProcessTarget
} from '../scripts/ha-auto-process-freeze.mjs'

const primary = { node: 'pg1', recovering: false, read_only: 'off' }
const replica = (node) => ({ node, recovering: true, read_only: 'on' })
const sample = {
  leaseRemainingSeconds: 10,
  oldContainerRunning: true,
  states: [primary, replica('pg2'), replica('pg3')]
}

test('a live lease permits one old SQL primary but does not establish fencing', () => {
  assert.deepEqual(freezeQualification(sample, 'pg1'), {
    oldFenced: false,
    replacementPrimary: undefined,
    unsafeDualPrimary: false,
    unfencedAfterLeaseExpiry: false
  })
})

test('expired leader lease plus a second SQL primary fails even if proxy eligibility is unknown', () => {
  const value = freezeQualification(
    {
      ...sample,
      leaseRemainingSeconds: -1,
      states: [primary, { ...primary, node: 'pg2' }, replica('pg3')]
    },
    'pg1'
  )
  assert.equal(value.replacementPrimary, 'pg2')
  assert.equal(value.oldFenced, false)
  assert.equal(value.unsafeDualPrimary, true)
  assert.equal(value.unfencedAfterLeaseExpiry, true)
})

test('unreachable SQL and a paused or running container do not prove fencing', () => {
  const value = freezeQualification(
    {
      ...sample,
      leaseRemainingSeconds: -1,
      states: [{ node: 'pg1', unavailable: true }, replica('pg2'), replica('pg3')]
    },
    'pg1'
  )
  assert.equal(value.oldFenced, false)
  assert.equal(value.unfencedAfterLeaseExpiry, true)
})

test('zero remaining TTL does not establish that the lease has already expired', () => {
  assert.equal(
    freezeQualification({ ...sample, leaseRemainingSeconds: 0 }, 'pg1').unfencedAfterLeaseExpiry,
    false
  )
})

test('standby recovery or confirmed container termination establishes old-node fencing', () => {
  assert.equal(
    freezeQualification(
      { ...sample, states: [replica('pg1'), { ...primary, node: 'pg2' }, replica('pg3')] },
      'pg1'
    ).oldFenced,
    true
  )
  assert.equal(
    freezeQualification(
      {
        ...sample,
        oldContainerRunning: false,
        states: [{ node: 'pg1', unavailable: true }, replica('pg2'), replica('pg3')]
      },
      'pg1'
    ).oldFenced,
    true
  )
})

test('a primary defaulting to read-only is not a physically fenced standby', () => {
  assert.equal(
    freezeQualification(
      { ...sample, states: [{ ...primary, read_only: 'on' }, replica('pg2'), replica('pg3')] },
      'pg1'
    ).oldFenced,
    false
  )
})

test('unknown identities, duplicate observations and missing lease metadata reject the evidence', () => {
  assert.throws(() => freezeQualification(sample, 'unowned'))
  assert.throws(() =>
    freezeQualification({ ...sample, states: [primary, replica('unowned'), replica('pg3')] }, 'pg1')
  )
  assert.throws(() =>
    freezeQualification({ ...sample, states: [primary, primary, replica('pg3')] }, 'pg1')
  )
  assert.throws(() => freezeQualification({ ...sample, leaseRemainingSeconds: undefined }, 'pg1'))
})

test('process signals require the current project, service and live unpaused container', () => {
  const project = `bazaar-ha-auto-${'1'.repeat(32)}`
  const container = {
    Id: 'a'.repeat(64),
    Config: {
      Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.service': 'pg1'
      }
    },
    State: { Running: true, Paused: false, Pid: 123 }
  }
  assert.equal(ownedProcessTarget(project, 'pg1', container), container.Id)
  assert.throws(() => ownedProcessTarget(project, 'pg2', container))
  assert.throws(() => ownedProcessTarget(`bazaar-ha-auto-${'2'.repeat(32)}`, 'pg1', container))
  for (const state of [{ Running: false }, { Paused: true }, { Pid: 0 }])
    assert.throws(() =>
      ownedProcessTarget(project, 'pg1', {
        ...container,
        State: { ...container.State, ...state }
      })
    )
})

test('freeze targets the actual Patroni child, keeping PID 1 supervisor and postmaster distinct', () => {
  const value = {
    supervisor: { pid: 1, state: 'S', isPatroni: true },
    manager: { pid: 2, parentPid: 1, state: 'S', isPatroni: true, startTicks: '12345' },
    postgres: { pid: 87, state: 'S' }
  }
  assert.equal(managementProcessTarget(value), 2)
  for (const change of [
    { pid: 1 },
    { pid: 87 },
    { parentPid: 0 },
    { isPatroni: false },
    { startTicks: '' }
  ])
    assert.throws(() =>
      managementProcessTarget({ ...value, manager: { ...value.manager, ...change } })
    )
  assert.throws(() =>
    managementProcessTarget({ ...value, supervisor: { ...value.supervisor, state: 'T' } })
  )
})
