import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { readMaxInFlightRequests } from './common/request-policy.js'
import {
  readDatabasePoolConfig,
  validateDatabaseUrlOptions,
  type DatabasePoolConfig
} from './database/database-policy.js'

export interface AppConfig {
  databaseUrl: string
  host: string
  port: number
  appOrigin: string
  secureCookie: boolean
  trustedProxyCidrs: false | string[]
  databasePool: DatabasePoolConfig
  maxInFlightRequests: number
}

function readTrustedProxies(value: string | undefined): false | string[] {
  if (!value?.trim()) return false
  const entries = value.split(',').map((entry) => entry.trim())
  for (const entry of entries) {
    const [address, prefix, ...extra] = entry.split('/')
    const family = isIP(address ?? '')
    const maxPrefix = family === 4 ? 32 : 128
    if (
      !family ||
      extra.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > maxPrefix))
    ) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or non-global CIDRs')
    }
  }
  return [...new Set(entries)]
}

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.DATABASE_URL
  const file = env.DATABASE_URL_FILE
  if ((direct && file) || (!direct && !file)) {
    throw new Error('Set exactly one of DATABASE_URL or DATABASE_URL_FILE')
  }
  if (direct) return direct
  try {
    const value = readFileSync(file!, 'utf8').replace(/\r?\n$/, '')
    if (!value || /[\r\n]/.test(value)) throw new Error()
    return value
  } catch {
    throw new Error('DATABASE_URL_FILE must contain one database URL')
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let url: URL
  try {
    url = new URL(readDatabaseUrl(env))
    validateDatabaseUrlOptions(url)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname === '/'
    ) {
      throw new Error()
    }
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL')
  }
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  let origin: URL
  try {
    origin = new URL(env.APP_ORIGIN ?? 'http://localhost:3000')
    if (
      origin.origin !== (env.APP_ORIGIN ?? 'http://localhost:3000') ||
      origin.username ||
      origin.password ||
      !['http:', 'https:'].includes(origin.protocol) ||
      (origin.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    )
      throw new Error()
  } catch {
    throw new Error('APP_ORIGIN must be an exact HTTPS origin or loopback HTTP origin')
  }
  return {
    databaseUrl: url.toString(),
    host: env.HOST ?? '127.0.0.1',
    port,
    appOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    trustedProxyCidrs: readTrustedProxies(env.TRUSTED_PROXY_CIDRS),
    databasePool: readDatabasePoolConfig(env),
    maxInFlightRequests: readMaxInFlightRequests(env)
  }
}
