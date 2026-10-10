import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

export function parseLeaderLease(raw) {
  const value = JSON.parse(raw)
  assert.equal(value.kvs?.length, 1, 'Expected one existing leader key')
  const tokens = [...raw.matchAll(/"lease"\s*:\s*(?:"([1-9]\d*)"|([1-9]\d*))(?=\s*[,}])/g)]
  assert.equal(tokens.length, 1, 'Expected one exact positive leader lease ID')
  // etcd IDs exceed Number precision; never recover the ID from parsed JSON numbers.
  const id = BigInt(tokens[0][1] ?? tokens[0][2])
  assert.ok(id <= 9223372036854775807n, 'Leader lease ID exceeds signed 64-bit range')
  const leader = Buffer.from(value.kvs[0].value, 'base64').toString()
  assert.ok(/^[a-z][a-z0-9_-]{0,63}$/.test(leader), 'Invalid leader identity')
  return { leader, leaseIdHex: id.toString(16) }
}

export async function readLeaseTtl(compose, leaseIdHex) {
  assert.ok(
    /^[a-f0-9]{1,16}$/.test(leaseIdHex) && BigInt(`0x${leaseIdHex}`) > 0n,
    'Invalid captured leader lease ID'
  )
  const value = JSON.parse(
    await compose(
      'exec',
      '-T',
      'etcd3',
      'etcdctl',
      '--endpoints=http://127.0.0.1:2379',
      '--command-timeout=3s',
      'lease',
      'timetolive',
      leaseIdHex,
      '-w',
      'json'
    )
  )
  assert.ok(Number.isSafeInteger(value.ttl) && value.ttl >= -1, 'Missing original lease TTL')
  return value.ttl
}

export async function leaderLease(compose, key) {
  const raw = await compose(
    'exec',
    '-T',
    'etcd3',
    'etcdctl',
    '--endpoints=http://127.0.0.1:2379',
    '--command-timeout=3s',
    'get',
    key,
    '-w',
    'json'
  )
  const lease = parseLeaderLease(raw)
  return { ...lease, remainingSeconds: await readLeaseTtl(compose, lease.leaseIdHex) }
}
