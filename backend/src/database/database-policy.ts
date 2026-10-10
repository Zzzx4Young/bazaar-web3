export interface DatabasePoolConfig {
  max: number
  connectionTimeoutMs: number
  idleTimeoutMs: number
  statementTimeoutMs: number
}

export const defaultDatabasePool: Readonly<DatabasePoolConfig> = Object.freeze({
  max: 5,
  connectionTimeoutMs: 3000,
  idleTimeoutMs: 10000,
  statementTimeoutMs: 3000
})

const maxPoolConnections = 100
const maxTimeoutMs = 600000

export function validateDatabaseUrlOptions(url: URL) {
  // pg lets URL options override the explicit client configuration, including
  // disabling statement_timeout or replacing the schema search_path.
  for (const name of ['statement_timeout', 'options', 'connectionTimeoutMillis', 'query_timeout']) {
    if (url.searchParams.has(name))
      throw new Error('Database URL must not override the application database policy')
  }
}

export function readDatabasePoolConfig(env: NodeJS.ProcessEnv): DatabasePoolConfig {
  function integer(name: string, fallback: number, max: number) {
    const raw = env[name]
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`${name} must be an integer between 1 and ${max}`)
    return value
  }
  return {
    max: integer('DB_POOL_MAX', defaultDatabasePool.max, maxPoolConnections),
    connectionTimeoutMs: integer('DB_CONNECT_TIMEOUT_MS', defaultDatabasePool.connectionTimeoutMs, maxTimeoutMs),
    idleTimeoutMs: integer('DB_IDLE_TIMEOUT_MS', defaultDatabasePool.idleTimeoutMs, maxTimeoutMs),
    statementTimeoutMs: integer('DB_STATEMENT_TIMEOUT_MS', defaultDatabasePool.statementTimeoutMs, maxTimeoutMs)
  }
}
