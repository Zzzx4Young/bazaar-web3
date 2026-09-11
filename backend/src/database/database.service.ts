import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient

  constructor(databaseUrl: string) {
    const adapter = new PrismaPg({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000
    })
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
