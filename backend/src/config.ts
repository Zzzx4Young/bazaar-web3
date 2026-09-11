export interface AppConfig {
  databaseUrl: string
  host: string
  port: number
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let url: URL
  try {
    url = new URL(env.DATABASE_URL ?? '')
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
  return { databaseUrl: url.toString(), host: env.HOST ?? '127.0.0.1', port }
}
