import assert from 'node:assert/strict'
import { capacityBusinessMixPolicy } from './capacity-policy.mjs'

// Four spaced groups distribute password hashes instead of launching32 at once.
export const capacityAuthPolicy = Object.freeze({ groups: 4, trustedProxyCidr: '127.0.0.1/32' })

export function capacityAuthSchedule({ users, rate }) {
  const { groups } = capacityAuthPolicy
  const { slots, readSlots } = capacityBusinessMixPolicy
  assert.ok(Number.isSafeInteger(users) && users > 0 && users % groups === 0)
  assert.ok(Number.isSafeInteger(rate) && rate > 0)
  const groupWidth = users / groups
  assert.ok(groupWidth % slots === 0 && groupWidth >= readSlots)
  const actorIndexes = Object.freeze(Array.from({ length: groups * readSlots }, (_, index) =>
    Math.floor(index / readSlots) * groupWidth + index % readSlots))
  function at(index) {
    assert.ok(Number.isSafeInteger(index) && index >= 0)
    const cycle = Math.floor(index / users)
    const userIndex = index % users
    if (userIndex % groupWidth !== cycle % readSlots) return undefined
    const group = Math.floor(userIndex / groupWidth)
    return { userIndex, operation: (Math.floor(cycle / readSlots) + group) % 2 ? 'session' : 'login' }
  }
  return {
    actorIndexes, at,
    expectedCounts(seconds) {
      assert.ok(Number.isSafeInteger(seconds) && seconds > 0)
      const counts = { login: 0, session: 0 }
      for (let i = 0; i < rate * seconds; i++) { const action = at(i); if (action) counts[action.operation]++ }
      return counts
    }
  }
}
