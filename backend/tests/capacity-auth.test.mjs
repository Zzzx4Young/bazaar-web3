import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import { capacityAuth } from '../scripts/capacity-auth.mjs'
import { readCapacityPolicy } from '../scripts/capacity-policy.mjs'
import { sessionMaxAgeSeconds } from '../dist/auth/auth-policy.js'

const digest = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const users = Array.from({ length: 1000 }, (_, i) => ({ id: `account-${i}`, loginName: `capacity-${i}`, token: randomBytes(32).toString('base64url') }))
  const state = { status: 200, defer: undefined }
  const post = async (_port, _path, _payload, user) => {
    if (state.defer) await state.defer
    const token = randomBytes(32).toString('base64url')
    return { status: state.status, setCookie: [`bazaar_session=${token}; HttpOnly; Max-Age=${sessionMaxAgeSeconds}`],
      value: { account: { id: user.id }, csrfToken: digest(`csrf:${token}`) } }
  }
  const auth = capacityAuth({ users, policy: readCapacityPolicy({}), post, instances: [{ port: 1 }, { port: 2 }],
    password: 'Never-report-this-fixture-password-123', registerSecret: () => {} })
  return { users, state, auth }
}

test('rotation commits only a validated200; non200 is a failure and retains the current token', async () => {
  const { auth, users, state } = fixture()
  await auth.prepare(3)
  const before = users[0].token
  for (const status of [401, 429, 500, 503]) {
    state.status = status
    await assert.rejects(auth.send(0, 3), error => error.code === `HTTP_${status}`)
    assert.ok(users[0].token === before)
  }
  state.status = 200
  await auth.send(0, 3)
  assert.ok(users[0].token !== before)
  const text = JSON.stringify(auth.summary())
  assert.ok(!text.includes(before) && !text.includes(users[0].token) && !text.includes('Never-report'))
  assert.equal(auth.summary().loadLogins, 1)
  assert.equal(auth.summary().failures, 4)
})

test('overlapping or late rotation cannot overwrite a newer actor session', async () => {
  const { auth, users, state } = fixture()
  await auth.prepare(3)
  let finish
  state.defer = new Promise(resolve => { finish = resolve })
  const rotation = auth.send(0, 3)
  await assert.rejects(auth.send(0, 3), /Overlapping authentication/)
  users[0].token = 'newer-session'
  finish()
  await assert.rejects(rotation, /Actor session changed/)
  assert.equal(users[0].token, 'newer-session')
  assert.equal(auth.summary().loadLogins, 0)
})
