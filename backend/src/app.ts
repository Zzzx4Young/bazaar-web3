import 'reflect-metadata'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { type AppConfig } from './config.js'
import { DatabaseService } from './database/database.service.js'
import { HealthController } from './health/health.controller.js'
import { AuthService } from './auth/auth.service.js'
import { AuthController } from './auth/auth.controller.js'
import { AuthGuard } from './auth/auth.guard.js'
import { ApiErrorFilter } from './common/api-error.filter.js'
import { ListingController } from './listings/listing.controller.js'
import { ListingService } from './listings/listing.service.js'
import { RatesService, type RateLoader } from './pricing/rates.service.js'
import { OrderController } from './orders/order.controller.js'
import { DisputeController } from './orders/dispute.controller.js'
import { BalanceController } from './orders/balance.controller.js'
import { SellerReviewController } from './reviews/seller-review.controller.js'
import {
  defaultRequestLogSink,
  type RequestLogSink,
  RequestTelemetry
} from './common/request-telemetry.js'

@Module({})
class AppModule {}

export async function createApp(
  config: AppConfig,
  logger: false | undefined = undefined,
  dependencies: { loadRates?: RateLoader; logRequest?: RequestLogSink | false } = {}
) {
  const database = new DatabaseService(config.databaseUrl)
  const auth = new AuthService(database.client, config)
  const rates = new RatesService(database.client, dependencies.loadRates)
  const listings = new ListingService(database.client, rates)
  const telemetry = new RequestTelemetry()
  const requestLogSink =
    dependencies.logRequest === undefined
      ? logger === false
        ? false
        : defaultRequestLogSink
      : dependencies.logRequest
  const adapter = new FastifyAdapter({ bodyLimit: 1048576, requestIdHeader: false })
  const instance = adapter.getInstance()
  instance.addHook('onRequest', (request, reply, done) => {
    telemetry.start(request, reply)
    done()
  })
  instance.addHook('onResponse', (request, reply, done) => {
    telemetry.finish(request, reply, requestLogSink)
    done()
  })
  const app = await NestFactory.create<NestFastifyApplication>(
    {
      module: AppModule,
      controllers: [HealthController, AuthController, ListingController, OrderController,
        DisputeController, BalanceController, SellerReviewController],
      providers: [
        { provide: DatabaseService, useValue: database },
        { provide: AuthService, useValue: auth },
        { provide: ListingService, useValue: listings }
      ]
    },
    adapter,
    { logger, abortOnError: false }
  )
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: config.appOrigin,
    credentials: true,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Content-Type',
      'Origin',
      'Cookie',
      'X-CSRF-Token',
      'Idempotency-Key',
      'X-Request-Id'
    ],
    exposedHeaders: ['X-Request-Id']
  })
  app.useGlobalGuards(new AuthGuard(auth, new Reflector()))
  app.useGlobalFilters(new ApiErrorFilter(telemetry))
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
