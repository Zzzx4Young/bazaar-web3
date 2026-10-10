import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import {
  defaultDatabasePool, validateDatabaseUrlOptions, type DatabasePoolConfig
} from './database-policy.js'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient

  constructor(databaseUrl: string, pool: DatabasePoolConfig = defaultDatabasePool) {
    const url = new URL(databaseUrl)
    validateDatabaseUrlOptions(url)
    const schema = url.searchParams.get('schema') ?? 'public'
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema')
    const adapter = new PrismaPg(
      {
        connectionString: databaseUrl,
        options: `-c search_path=${schema},pg_catalog`,
        max: pool.max,
        connectionTimeoutMillis: pool.connectionTimeoutMs,
        idleTimeoutMillis: pool.idleTimeoutMs,
        statement_timeout: pool.statementTimeoutMs
      },
      { schema }
    )
    this.client = new PrismaClient({ adapter })
  }

  async onModuleInit() {
    await this.client.$connect()
    await this.ping()
  }

  async ping(requireWritable = false) {
    const startedAt = process.hrtime.bigint()
    if (requireWritable) {
      const [state] = await this.client.$queryRaw<{ writable: boolean }[]>`
        SELECT NOT pg_is_in_recovery()
          AND current_setting('transaction_read_only') = 'off' AS writable
      `
      if (state?.writable !== true) throw new Error('Database is not writable')
    } else {
      await this.client.$queryRaw`SELECT 1`
    }
    return Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 1000) / 1000
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
