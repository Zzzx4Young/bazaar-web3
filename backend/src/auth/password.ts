import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { DomainError } from '../common/domain-error.js'

const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
const prefix = 'scrypt$v1$131072$8$1'
export const dummyHash = `${prefix}$${'00'.repeat(16)}$${'00'.repeat(64)}`

export function validatePassword(password: string) {
  if (
    typeof password !== 'string' ||
    [...password].length < 15 ||
    [...password].length > 128 ||
    Buffer.byteLength(password) > 512
  )
    throw new DomainError('INVALID_INPUT')
}

export function normalizeLogin(value: string) {
  if (typeof value !== 'string') throw new DomainError('INVALID_INPUT')
  const login = value.trim().toLowerCase()
  const handle = /^[a-z0-9][a-z0-9_-]{2,63}$/
  const email = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
  if (login.length > 100 || (!handle.test(login) && !email.test(login)))
    throw new DomainError('INVALID_INPUT')
  return login
}

export async function hashPassword(password: string) {
  validatePassword(password)
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `${prefix}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, encoded: string) {
  validatePassword(password)
  const valid = /^scrypt\$v1\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(encoded)
  const parts = (valid ? encoded : dummyHash).split('$')
  const actual = await derive(password, Buffer.from(parts[5], 'hex'))
  return timingSafeEqual(actual, Buffer.from(parts[6], 'hex')) && valid
}
