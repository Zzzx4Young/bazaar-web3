import assert from 'node:assert/strict'
import test from 'node:test'
import { findGmailClaimIssues } from '../dist/auth/gmail-claims-check.js'

test('Gmail claim check detects missing, conflicting, unbacked, and malformed ownership', () => {
  const issues = findGmailClaimIssues({
    accounts: [
      { id: 'a', loginName: 'first.person@gmail.com' },
      { id: 'b', loginName: 'second.person@gmail.com' },
      { id: 'c', loginName: 'other' }
    ],
    identities: [
      { accountId: 'a', provider: 'email', subject: 'first.person+shop@gmail.com',
        email: 'first.person+shop@gmail.com' },
      { accountId: 'c', provider: 'email', subject: 'third.person@gmail.com',
        email: 'different@gmail.com' }
    ],
    claims: [
      { key: 'firstperson@gmail.com', accountId: 'b' },
      { key: 'orphan@gmail.com', accountId: 'c' }
    ]
  })
  assert.deepEqual(issues.map(issue => issue.kind).sort(), [
    'email_identity_mismatch', 'missing', 'missing', 'unbacked', 'wrong_owner'
  ])
  assert.ok(issues.every(issue => !('email' in issue) && !('key' in issue)))
})

test('Gmail claim check accepts aliases owned by one account and rejects cross-account collisions', () => {
  assert.deepEqual(findGmailClaimIssues({
    accounts: [{ id: 'a', loginName: 'first.person@gmail.com' }],
    identities: [{ accountId: 'a', provider: 'google', subject: 'google-sub',
      email: 'firstperson+shop@gmail.com' }],
    claims: [{ key: 'firstperson@gmail.com', accountId: 'a' }]
  }), [])
  const conflicts = findGmailClaimIssues({
    accounts: [{ id: 'a', loginName: 'first.person@gmail.com' },
      { id: 'b', loginName: 'firstperson@gmail.com' }],
    identities: [], claims: [{ key: 'firstperson@gmail.com', accountId: 'a' }]
  })
  assert.ok(conflicts.some(issue => issue.kind === 'collision'))
})
