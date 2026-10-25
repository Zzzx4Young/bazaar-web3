import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const inbox = JSON.parse(readFileSync(resolve(import.meta.dirname, '../.tmp/dev-email-inbox'), 'utf8'))
  if (!/^\d{6}$/.test(inbox.code)) throw new Error('Invalid code')
  console.log(`Account: ${inbox.email}\nCode: ${inbox.code}\nIssued: ${inbox.createdAt}`)
} catch {
  console.error('No development email code is available. Request one in the login form first.')
  process.exitCode = 1
}
