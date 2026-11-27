import test from 'node:test'
import assert from 'node:assert/strict'
import { validZipCoverage } from '../dist/delivery-files/check-report.js'
test('new ZIP coverage is bounded and consistent without revoking legacy native reports', () => {
  assert.equal(validZipCoverage({ clean: true }), true)
  const good = { scope: 'whole-container-recursive', members: {
    entries: 4, expandedBytes: 2000000000, sha256: 'a'.repeat(64) } }
  assert.equal(validZipCoverage(good), true)
  for (const value of [{ scope: good.scope }, { members: good.members },
    { ...good, scope: 'raw-archive-and-all-members' },
    { ...good, members: { ...good.members, entries: 0, expandedBytes: 1 } },
    { ...good, members: { ...good.members, entries: 1, expandedBytes: 500000001 } },
    { ...good, members: { ...good.members, expandedBytes: 2000000001 } },
    { ...good, members: { ...good.members, entries: 10001 } },
    { ...good, members: { ...good.members, sha256: 'not-a-digest' } }])
    assert.equal(validZipCoverage(value), false)
})
