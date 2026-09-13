import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertRestrictedRoles,
  validateRecoveryTarget
} from '../scripts/local-role-credential-recovery.mjs'

const restrictedRoles = [
  {
    rolname: 'bazaar_migrate',
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false
  },
  {
    rolname: 'bazaar_runtime',
    rolcanlogin: true,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false
  }
]

test('credential recovery accepts only the loopback bazaar_dev target', () => {
  assert.equal(
    validateRecoveryTarget('postgresql://admin:secret@127.0.0.1:5432/bazaar_dev').hostname,
    '127.0.0.1'
  )
  for (const url of [
    'postgresql://admin:secret@example.com:5432/bazaar_dev',
    'postgresql://admin:secret@127.0.0.1:5432/other'
  ])
    assert.throws(() => validateRecoveryTarget(url), /loopback bazaar_dev/)
})

test('credential recovery rejects elevated attributes and inherited memberships', () => {
  const owners = [{ rolname: 'bazaar_migrate' }]
  assert.doesNotThrow(() => assertRestrictedRoles(restrictedRoles, [], owners))
  assert.throws(
    () =>
      assertRestrictedRoles(
        restrictedRoles,
        [{ member_role: 'bazaar_runtime', granted_role: 'elevated_role' }],
        owners
      ),
    /restricted application roles/
  )
  assert.throws(
    () =>
      assertRestrictedRoles(
        restrictedRoles.map((role) =>
          role.rolname === 'bazaar_runtime' ? { ...role, rolcreatedb: true } : role
        ),
        [],
        owners
    ),
    /restricted application roles/
  )
  assert.throws(
    () =>
      assertRestrictedRoles(
        restrictedRoles.map((role) =>
          role.rolname === 'bazaar_runtime' ? { ...role, rolcanlogin: false } : role
        ),
        [],
        owners
      ),
    /restricted application roles/
  )
})

test('credential recovery requires the migration role to own the schema', () => {
  assert.throws(
    () => assertRestrictedRoles(restrictedRoles, [], [{ rolname: 'postgres' }]),
    /schema ownership/
  )
})
