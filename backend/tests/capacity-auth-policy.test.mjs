import assert from 'node:assert/strict'
import test from 'node:test'
import { capacityAuthSchedule } from '../scripts/capacity-auth-policy.mjs'
import { readCapacityPolicy } from '../scripts/capacity-policy.mjs'
import { loginNameLimit, loginIpLimit, loginWindowSeconds } from '../dist/auth/auth-policy.js'

test('auth scheduling preserves all1000 owners,100 writes/s, and adds1 login plus1 session per second', () => {
  const policy = readCapacityPolicy({ CAPACITY_SECONDS: '120' })
  const schedule = capacityAuthSchedule(policy)
  assert.equal(schedule.actorIndexes.length, 32)
  assert.ok(Object.isFrozen(schedule.actorIndexes))
  const owners = new Set(), counts = { read: 0, write: 0, login: 0, session: 0 }
  for (let index = 0; index < policy.rate * policy.seconds; index++) {
    const owner = index % policy.users
    owners.add(owner)
    const auth = schedule.at(index)
    if (auth) {
      assert.equal(auth.userIndex, owner)
      assert.ok(owner % 10 < 8)
      counts[auth.operation]++
    } else counts[index % 10 >= 8 ? 'write' : 'read']++
  }
  assert.equal(owners.size, 1000)
  assert.deepEqual(counts, { read: 47760, write: 12000, login: 120, session: 120 })
  assert.deepEqual(schedule.expectedCounts(120), { login: 120, session: 120 })
})

test('every actor alternates rotation and session; rolling login windows leave room for initial login', () => {
  const policy = readCapacityPolicy({ CAPACITY_SECONDS: '600' })
  const schedule = capacityAuthSchedule(policy)
  const operations = new Map(schedule.actorIndexes.map(i => [i, []]))
  for (let index = 0; index < policy.rate * policy.seconds; index++) {
    const auth = schedule.at(index)
    if (auth) operations.get(auth.userIndex).push({ operation: auth.operation, at: index / policy.rate })
  }
  for (const arrivals of operations.values()) {
    for (let i = 1; i < arrivals.length; i++) assert.notEqual(arrivals[i].operation, arrivals[i - 1].operation)
    const logins = arrivals.filter(a => a.operation === 'login')
    for (const { at } of logins) {
      const attempts = logins.filter(a => a.at >= at && a.at < at + loginWindowSeconds).length + 1
      assert.ok(attempts <= loginNameLimit && attempts <= loginIpLimit)
    }
  }
  for (const policy of [{ users: 999, rate: 500 }, { users: 1000, rate: 0 }])
    assert.throws(() => capacityAuthSchedule(policy))
})
