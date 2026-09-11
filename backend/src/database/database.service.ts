import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient

  constructor(databaseUrl: string) {
    const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public'
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid database schema')
    const adapter = new PrismaPg(
      {
        connectionString: databaseUrl,
        options: `-c search_path=${schema},pg_catalog`,
        max: 5,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
        statement_timeout: 3000
      },
      { schema }
    )
    this.client = new PrismaClient({ adapter })
  }

  async onModuleInit() {
    await this.client.$connect()
    await this.ping()
  }

  async ping() {
    await this.client.$queryRaw`SELECT 1`
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
