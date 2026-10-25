import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve(import.meta.dirname, '../.tmp')
mkdirSync(directory, { recursive: true, mode: 0o700 })
for (const [name, value] of [
  ['dev-email-key', randomBytes(48).toString('hex')],
  ['dev-email-account', `bazaar-dev-${randomBytes(8).toString('hex')}@gmail.com`]
]) {
  const path = resolve(directory, name)
  if (!existsSync(path)) {
    try { writeFileSync(path, value + '\n', { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
}
