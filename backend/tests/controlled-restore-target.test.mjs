import test from 'node:test'
import assert from 'node:assert/strict'
import * as recovery from './helpers/controlled-browser-recovery.mjs'

const schema = 'pl_' + 'a'.repeat(32)
const base = 'postgresql://fixture:synthetic@127.0.0.1:57435/bazaar_test'
const owned = base + '?schema=' + schema

test('R03: restore admits the explicit isolated port and exact fixture-owned schema', () => {
  assert.equal(typeof recovery.assertControlledRestoreTarget, 'function')
  recovery.assertControlledRestoreTarget(owned, owned, base)
})

test('R03: restore rejects unsafe configuration and every unowned target before spawning restore', () => {
  assert.equal(typeof recovery.assertControlledRestoreTarget, 'function')
  const variants = [
    undefined,
    '',
    'not a URL',
    base.replace('127.0.0.1', 'localhost'),
    base.replace('127.0.0.1', 'example.com'),
    base.replace('57435', '5432'),
    base.replace('57435', '55432'),
    base.replace('57435', '55433'),
    base.replace(':57435', ''),
    base.replace('bazaar_test', 'bazaar_dev'),
    base.replace('postgresql:', 'https:')
  ]
  for (const configured of variants)
    assert.throws(
      () => recovery.assertControlledRestoreTarget(owned, owned, configured),
      /Dedicated isolated restore only/
    )
  for (const target of [
    ...variants,
    owned.replace('57435', '55435'),
    owned.replace('57435', '56435'),
    owned.replace(schema, 'pl_' + 'b'.repeat(32)),
    owned.replace(schema, 'public'),
    owned.replace('synthetic', 'other'),
    owned.replace('fixture:', 'other:'),
    owned + '&schema=' + schema
  ])
    assert.throws(
      () => recovery.assertControlledRestoreTarget(target, owned, base),
      /Dedicated isolated restore only/
    )
  assert.throws(
    () =>
      recovery.assertControlledRestoreTarget(
        owned,
        owned.replace(schema, 'wl_' + 'a'.repeat(32)),
        base
      ),
    /Dedicated isolated restore only/
  )
})
