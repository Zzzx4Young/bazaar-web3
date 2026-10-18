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
import { MediaController } from './media/media.controller.js'
import { MediaReadController } from './media/media-read.controller.js'
import { MediaService } from './media/media.service.js'
import { GarageObjectStore } from './media/garage-object-store.js'
import { RequestAdmission } from './common/request-admission.js'
import { requestPolicy } from './common/request-policy.js'
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
  dependencies: { loadRates?: RateLoader; logRequest?: RequestLogSink | false; mediaStore?: GarageObjectStore } = {}
) {
  const database = new DatabaseService(config.databaseUrl, config.databasePool)
  const auth = new AuthService(database.client, config)
  const rates = new RatesService(database.client, dependencies.loadRates)
  const listings = new ListingService(database.client, rates)
  const media = new MediaService(
    database.client,
    dependencies.mediaStore ?? (config.mediaStore ? new GarageObjectStore(config.mediaStore) : null)
  )
  const telemetry = new RequestTelemetry()
  const admission = new RequestAdmission(config.maxInFlightRequests)
  const requestLogSink =
    dependencies.logRequest === undefined
      ? logger === false
        ? false
        : defaultRequestLogSink
      : dependencies.logRequest
  const adapter = new FastifyAdapter({
    bodyLimit: requestPolicy.maxBodyBytes,
    requestIdHeader: false,
    trustProxy: config.trustedProxyCidrs
  })
  const instance = adapter.getInstance()
  instance.addHook('onRequest', (request, reply, done) => {
    telemetry.start(request, reply)
    done()
  })
  instance.addHook('onResponse', (request, reply, done) => {
    admission.release(request)
    telemetry.finish(request, reply, requestLogSink)
    done()
  })
  instance.addHook('preHandler', (request, reply, done) => {
    const live =
      request.method === 'POST' &&
      new URL(request.url, 'http://localhost').pathname === '/api/health/live'
    if (live || admission.acquire(request)) {
      done()
      return
    }
    telemetry.setError(request, 'OVERLOADED')
    reply
      .header('Cache-Control', 'no-store')
      .status(503)
      .send({ code: 'OVERLOADED', retryable: true, requestId: request.id })
  })
  instance.addHook('onSend', (request, _reply, payload, done) => {
    admission.release(request)
    done(null, payload)
  })
  const app = await NestFactory.create<NestFastifyApplication>(
    {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        ListingController,
        OrderController,
        DisputeController,
        BalanceController,
        SellerReviewController,
        MediaController,
        MediaReadController
      ],
      providers: [
        { provide: DatabaseService, useValue: database },
        { provide: AuthService, useValue: auth },
        { provide: ListingService, useValue: listings },
        { provide: MediaService, useValue: media }
      ]
    },
    adapter,
    { logger, abortOnError: false }
  )
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: config.appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
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
