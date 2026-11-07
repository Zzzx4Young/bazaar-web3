import 'reflect-metadata'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { type AppConfig } from './config.js'
import { DatabaseService } from './database/database.service.js'
import { HealthController } from './health/health.controller.js'
import { AuthService } from './auth/auth.service.js'
import { AuthController } from './auth/auth.controller.js'
import { WalletIdentityController } from './auth/wallet-identity.controller.js'
import { WalletAuthService } from './auth/wallet-auth.service.js'
import { WalletReauthService } from './auth/wallet-reauth.service.js'
import { PostgresWalletSecurityLedger } from './auth/postgres-wallet-security-ledger.js'
import type { WalletSecurityLedger } from './auth/wallet-security-ledger.js'
import type { EvmAddress } from './web3/web3-types.js'
import { createEoaChecker } from './auth/wallet-account-type.js'
import { assertWalletLedgerGrants } from './auth/wallet-ledger-grants.js'
import { SellerPayoutService } from './web3/seller-payout.service.js'
import { TestnetController } from './web3/testnet.controller.js'
import { IdentityController } from './auth/identity.controller.js'
import { EmailAuthService } from './auth/email-auth.service.js'
import { GoogleAuthService } from './auth/google-auth.service.js'
import { GoogleOidcClient, type GoogleClient } from './auth/google-client.js'
import { type EmailSender } from './auth/email-code.js'
import { AuthGuard } from './auth/auth.guard.js'
import { ApiErrorFilter } from './common/api-error.filter.js'
import { ListingController } from './listings/listing.controller.js'
import { ListingReviewController } from './listings/listing-review.controller.js'
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
  dependencies: { loadRates?: RateLoader; logRequest?: RequestLogSink | false;
    mediaStore?: GarageObjectStore; emailSender?: EmailSender; googleClient?: GoogleClient;
    walletLedger?: WalletSecurityLedger; walletEoaCheck?: (address: EvmAddress) => Promise<void>;
    walletGoogleClient?: GoogleClient } = {}
) {
  if (config.web3 && !dependencies.walletLedger) {
    const business = new URL(config.databaseUrl), security = new URL(config.web3.securityLedgerUrl)
    if (business.hostname === security.hostname && (business.port || '5432') === (security.port || '5432') &&
      business.pathname === security.pathname) throw new Error('Wallet ledger requires an independent database')
  }
  const database = new DatabaseService(config.databaseUrl, config.databasePool)
  const ledgerDatabase = config.web3 && !dependencies.walletLedger
    ? new DatabaseService(config.web3.securityLedgerUrl, { ...config.databasePool, max: 2 }) : null
  const ledger = config.web3 ? dependencies.walletLedger ?? new PostgresWalletSecurityLedger(
    ledgerDatabase!.client, config.web3.securityLedgerId) : undefined
  const auth = new AuthService(database.client, config, ledger)
  const wallets = config.web3 && ledger ? new WalletAuthService(database.client, auth, ledger, {
    chainId: config.web3.chainId, escrow: config.web3.escrow, appOrigin: config.appOrigin,
    assertEoa: dependencies.walletEoaCheck ?? createEoaChecker(config.web3)
  }) : null
  const walletGoogle = dependencies.walletGoogleClient ?? (config.googleOAuth ? new GoogleOidcClient({
    ...config.googleOAuth, redirectUri: `${config.appOrigin}/api/auth/wallet/reauth/google/callback`
  }) : null)
  const walletReauth = wallets ? new WalletReauthService(database.client, auth, wallets, config,
    dependencies.emailSender ?? null, walletGoogle) : null
  const emailAuth = new EmailAuthService(database.client, config, auth, dependencies.emailSender ?? null)
  const googleAuth = new GoogleAuthService(database.client, config, auth,
    dependencies.googleClient ?? (config.googleOAuth ? new GoogleOidcClient(config.googleOAuth) : null))
  const rates = new RatesService(database.client, dependencies.loadRates)
  const listings = new ListingService(database.client, rates, config.listingCommitmentPolicy, config.web3)
  const sellerPayout = wallets && ledger && config.web3
    ? new SellerPayoutService(database.client, wallets, ledger, config.web3) : null
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
        WalletIdentityController,
        TestnetController,
        IdentityController,
        ListingController, ListingReviewController,
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
        { provide: WalletAuthService, useValue: wallets },
        { provide: WalletReauthService, useValue: walletReauth },
        ...(ledgerDatabase ? [{ provide: 'WalletLedgerDatabase', useValue: ledgerDatabase }] : []),
        { provide: EmailAuthService, useValue: emailAuth },
        { provide: GoogleAuthService, useValue: googleAuth },
        { provide: ListingService, useValue: listings },
        { provide: SellerPayoutService, useValue: sellerPayout },
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
    if (ledgerDatabase) await assertWalletLedgerGrants(ledgerDatabase.client)
    if (ledger) await ledger.recoveryEpoch()
    await app.getHttpAdapter().getInstance().ready()
    return app
  } catch (error) {
    await app.close()
    throw error
  }
}
