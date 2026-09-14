import { readFileSync } from 'node:fs'

export interface AppConfig {
  databaseUrl: string
  host: string
  port: number
  appOrigin: string
  secureCookie: boolean
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
    secureCookie: origin.protocol === 'https:'
  }
}
