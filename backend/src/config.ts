import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { type GarageStoreConfig } from './media/garage-object-store.js'
import { readMaxInFlightRequests } from './common/request-policy.js'
import {
  readDatabasePoolConfig,
  validateDatabaseUrlOptions,
  type DatabasePoolConfig
} from './database/database-policy.js'

export interface AppConfig {
  databaseUrl: string
  listingCommitmentPolicy: 'compat' | 'enforce'
  host: string
  port: number
  appOrigin: string
  secureCookie: boolean
  trustedProxyCidrs: false | string[]
  databasePool: DatabasePoolConfig
  maxInFlightRequests: number
  mediaStore: GarageStoreConfig | null
  googleOAuth: { clientId: string; clientSecret: string; redirectUri: string } | null
  emailCodeKey: Buffer | null
  devEmailBindSkipReauth: boolean
}

function readSecret(env: NodeJS.ProcessEnv, valueName: string, fileName: string): string | null {
  const direct = env[valueName]
  const file = env[fileName]
  if (direct && file) throw new Error(`Set only one of ${valueName} or ${fileName}`)
  if (!direct && !file) return null
  const value = file ? readFileSync(file, 'utf8').trim() : direct!
  if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid ${valueName}`)
  return value
}

function readMediaStoreConfig(env: NodeJS.ProcessEnv): GarageStoreConfig | null {
  const names = [
    'GARAGE_HOT_ENDPOINT', 'GARAGE_HOT_PUBLIC_ENDPOINT', 'GARAGE_COLD_ENDPOINT',
    'GARAGE_HOT_ACCESS_KEY_ID_FILE', 'GARAGE_HOT_SECRET_KEY_FILE',
    'GARAGE_COLD_ACCESS_KEY_ID_FILE', 'GARAGE_COLD_SECRET_KEY_FILE'
  ] as const
  if (names.every((name) => !env[name])) return null
  if (names.some((name) => !env[name])) throw new Error('Incomplete Garage configuration')
  const endpoint = (name: typeof names[number]) => {
    const value = env[name]!
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.origin !== value)
      throw new Error(`Invalid ${name}`)
    return value
  }
  const secret = (name: typeof names[number]) => {
    const value = readFileSync(env[name]!, 'utf8').trim()
    if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid ${name}`)
    return value
  }
  return {
    hotEndpoint: endpoint('GARAGE_HOT_ENDPOINT'),
    hotPublicEndpoint: endpoint('GARAGE_HOT_PUBLIC_ENDPOINT'),
    coldEndpoint: endpoint('GARAGE_COLD_ENDPOINT'),
    hotCredentials: {
      accessKeyId: secret('GARAGE_HOT_ACCESS_KEY_ID_FILE'),
      secretAccessKey: secret('GARAGE_HOT_SECRET_KEY_FILE')
    },
    coldCredentials: {
      accessKeyId: secret('GARAGE_COLD_ACCESS_KEY_ID_FILE'),
      secretAccessKey: secret('GARAGE_COLD_SECRET_KEY_FILE')
    },
    hotBucket: 'bazaar-hot',
    coldBucket: 'bazaar-cold'
  }
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
  const listingCommitmentPolicy = env.LISTING_COMMITMENT_POLICY ?? 'compat'
  if (listingCommitmentPolicy !== 'compat' && listingCommitmentPolicy !== 'enforce')
    throw new Error('LISTING_COMMITMENT_POLICY must be compat or enforce')
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
  const googleClientId = env.GOOGLE_CLIENT_ID
  const googleClientSecret = readSecret(env, 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET_FILE')
  if (Boolean(googleClientId) !== Boolean(googleClientSecret))
    throw new Error('Google OAuth requires both client ID and client secret')
  const emailSecret = readSecret(env, 'EMAIL_CODE_HMAC_KEY', 'EMAIL_CODE_HMAC_KEY_FILE')
  if (emailSecret && Buffer.byteLength(emailSecret) < 32)
    throw new Error('EMAIL_CODE_HMAC_KEY must contain at least 32 bytes')
  if (env.DEV_EMAIL_BIND_SKIP_REAUTH && !['0', '1'].includes(env.DEV_EMAIL_BIND_SKIP_REAUTH))
    throw new Error('Invalid DEV_EMAIL_BIND_SKIP_REAUTH')
  const devEmailBindSkipReauth = env.DEV_EMAIL_BIND_SKIP_REAUTH === '1'
  if (devEmailBindSkipReauth && (env.NODE_ENV !== 'development' ||
      (env.HOST ?? '127.0.0.1') !== '127.0.0.1' ||
      origin.origin !== 'http://localhost:3000'))
    throw new Error('DEV_EMAIL_BIND_SKIP_REAUTH requires local development configuration')
  return {
    databaseUrl: url.toString(),
    listingCommitmentPolicy,
    host: env.HOST ?? '127.0.0.1',
    port,
    appOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    trustedProxyCidrs: readTrustedProxies(env.TRUSTED_PROXY_CIDRS),
    databasePool: readDatabasePoolConfig(env),
    maxInFlightRequests: readMaxInFlightRequests(env),
    mediaStore: readMediaStoreConfig(env),
    googleOAuth: googleClientId && googleClientSecret ? {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: `${origin.origin}/api/auth/google/callback`
    } : null,
    emailCodeKey: emailSecret ? Buffer.from(emailSecret) : null,
    devEmailBindSkipReauth
  }
}
