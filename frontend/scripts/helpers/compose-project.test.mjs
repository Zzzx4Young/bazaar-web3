import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { composeProjectArgs } from './compose-project.mjs'

test('explicit Compose identity survives a sudo-like empty child environment', () => {
  const args = composeProjectArgs('bazaar-ci-alpha')
  const received = JSON.parse(execFileSync(process.execPath,
    ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...args],
    { env: {}, encoding: 'utf8' }))
  assert.deepEqual(received, ['--project-name', 'bazaar-ci-alpha'])
})
test('default project remains compatible; invalid explicit identities fail before resource operations', () => {
  assert.deepEqual(composeProjectArgs(undefined), [])
  for (const value of ['', 'UPPER', '../other', '--project-name=x', 'a b', 'a'.repeat(64)])
    assert.throws(() => composeProjectArgs(value), /Invalid isolated Compose/)
})
