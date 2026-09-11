import 'reflect-metadata'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { type AppConfig } from './config.js'
import { DatabaseService } from './database/database.service.js'
import { HealthController } from './health/health.controller.js'

@Module({})
class AppModule {}

export async function createApp(config: AppConfig, logger: false | undefined = undefined) {
  const database = new DatabaseService(config.databaseUrl)
  const app = await NestFactory.create<NestFastifyApplication>(
    {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: DatabaseService, useValue: database }]
    },
    new FastifyAdapter({ bodyLimit: 1048576 }),
    { logger, abortOnError: false }
  )
  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false }
    })
  )
  app.enableShutdownHooks()
  try {
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    return app
  } catch (error) {
    await app.close()
    throw error
  }
}
