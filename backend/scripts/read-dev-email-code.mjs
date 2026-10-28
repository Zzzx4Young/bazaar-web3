import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeGmail } from '../dist/auth/email-code.js'

const args = process.argv.slice(2)
const emailArg = args[0] === '--email' ? args[1] : undefined
const purposeArg = args[2] === '--purpose' ? args[3] : undefined
const validArgs = Boolean(emailArg) && (args.length === 2 ||
  (args.length === 4 && args[2] === '--purpose' &&
    ['register', 'login', 'bind'].includes(purposeArg)))
if (!validArgs) {
  console.error('Usage: node scripts/read-dev-email-code.mjs --email name@gmail.com [--purpose register|login|bind]')
  process.exitCode = 1
} else {
  try {
    const email = normalizeGmail(emailArg)
    const inboxFile = process.env.EMAIL_CODE_DEV_INBOX_FILE ??
      resolve(import.meta.dirname, '../.tmp/dev-email-inbox')
    const now = Date.now()
    const entries = readFileSync(inboxFile, 'utf8').trim().split('\n')
      .map(line => JSON.parse(line))
      .filter(entry => entry.email === email && (!purposeArg || entry.purpose === purposeArg) &&
        /^\d{6}$/.test(entry.code) &&
        Number.isFinite(Date.parse(entry.createdAt)) &&
        Date.parse(entry.createdAt) <= now + 30_000 &&
        Date.parse(entry.createdAt) + 5 * 60_000 > now)
    const latest = entries.at(-1)
    if (!latest) throw new Error('No current code')
    console.log(`Account: ${latest.email}\nPurpose: ${latest.purpose}\nCode: ${latest.code}\nIssued: ${latest.createdAt}`)
  } catch {
    console.error('No current development email code for that address. Request a new one first.')
    process.exitCode = 1
  }
}
