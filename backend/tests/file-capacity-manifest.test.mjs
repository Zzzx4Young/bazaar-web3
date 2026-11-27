import test from 'node:test'
import assert from 'node:assert/strict'
import { assertExpansionManifest, assertCapacityManifest } from '../scripts/file-capacity-manifest.mjs'
test('expansion acceptance cannot be replaced with duplicate or smaller green fixtures', () => {
  const rows = [1999999999, 2000000000, 2000000001].map((n) => ({
    name: `expanded-${n}.zip`, expandedBytes: n, expected: n > 2000000000 ? 'rejected' : 'clean',
    bytes: 266031971, sha256: 'a'.repeat(64)
  }))
  rows.push({ name: 'expanded-tail-eicar.zip', expandedBytes: 2000000000,
    expected: 'rejected', reason: 'MALWARE_DETECTED', bytes: 266031971, sha256: 'b'.repeat(64) })
  assertExpansionManifest(rows)
  assert.throws(() => assertExpansionManifest([rows[0], rows[0], rows[0], rows[0]]))
  assert.throws(() => assertExpansionManifest(rows.map((r) => ({ ...r, expandedBytes: 4 }))))
  assert.throws(() => assertExpansionManifest(rows.map((r) => ({ ...r, expected: 'clean' }))))
  assert.throws(() => assertCapacityManifest(Array(12).fill(rows[0])))
})
