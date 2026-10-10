import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { parseLeaderLease, readLeaseTtl } from '../scripts/ha-auto-dcs.mjs'

const encoded = Buffer.from('pg2').toString('base64')
const leaseId = '7587870992920194875'
const raw = `{"kvs":[{"value":"${encoded}","lease":${leaseId}}]}`

test('etcd leader lease preserves integer precision and accepts numeric or string IDs', () => {
  const value = { leader: 'pg2', leaseIdHex: BigInt(leaseId).toString(16) }
  assert.deepEqual(parseLeaderLease(raw), value)
  assert.deepEqual(parseLeaderLease(raw.replace(leaseId, `"${leaseId}"`)), value)
})

test('missing, ambiguous or invalid leader leases are not valid fencing evidence', () => {
  for (const value of [
    '{}',
    '{"kvs":[]}',
    raw.replace(leaseId, '0'),
    raw.replace(leaseId, '-1'),
    raw.replace(leaseId, '1.5'),
    raw.replace(leaseId, '9223372036854775808'),
    raw.replace(encoded, '')
  ])
    assert.throws(() => parseLeaderLease(value))
})

test('remaining TTL tracks the captured lease, including expiry', async () => {
  const calls = []
  const compose = async (...args) => {
    calls.push(args)
    return '{"ttl":-1}'
  }
  const hex = BigInt(leaseId).toString(16)
  assert.equal(await readLeaseTtl(compose, hex), -1)
  assert.equal(calls[0].at(-3), hex)
  await assert.rejects(() => readLeaseTtl(async () => '{"ttl":null}', hex))
  await assert.rejects(() => readLeaseTtl(compose, 'not-a-lease'))
})
