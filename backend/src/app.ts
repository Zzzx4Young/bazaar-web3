import { EvidenceService } from './evidence/evidence.service.js'
import { EvidenceController } from './evidence/evidence.controller.js'
import {
  DeliveryPermitService,
  type DeliverySigner,
  readDeliverySigner,
  ChainDeliverySignerVerifier
} from './delivery-files/delivery-permit.service.js'
import { DeliveryController } from './delivery-files/delivery.controller.js'
import { DownloadService } from './delivery-files/download.service.js'
import { SupplementPublicationService } from './delivery-files/supplement-publication.service.js'
import { CheckpointPaymentObserver } from './web3/payment-observer.js'
import { DualChainObserver } from './web3/chain-observer.js'
import { TransactionAttemptService } from './web3/transaction-attempt.js'
import { TransactionAttemptController } from './web3/transaction-attempt.controller.js'
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
import { PaymentIntentService } from './web3/payment-intent.service.js'
import { PaymentIntentController } from './web3/payment-intent.controller.js'
import { PostgresPaymentJournal, type PaymentJournal } from './web3/payment-journal.js'
import { readPaymentSigner, type PaymentSigner } from './web3/payment-signer.js'
import type { PaymentChainObserver } from './web3/payment-observer.js'
import { PrivateFileController } from './delivery-files/private-file.controller.js'
import { PrivateFileService } from './delivery-files/upload.service.js'
import { GaragePrivateObjectStore, type PrivateObjectStore } from './delivery-files/object-store.js'
import type { PrivateFileBudget } from './delivery-files/quota.service.js'
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
    walletGoogleClient?: GoogleClient; paymentSigner?: PaymentSigner;
    deliverySigner?: DeliverySigner; paymentJournal?: PaymentJournal; paymentObserver?: PaymentChainObserver; chainObserver?: DualChainObserver; privateFiles?: {store:PrivateObjectStore;budget:PrivateFileBudget;uploadKey:Buffer} } = {}
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
  const paymentSigner = config.web3 ? dependencies.paymentSigner ?? readPaymentSigner(config.web3.paymentSignerFile) : null
  const paymentJournal = config.web3 ? dependencies.paymentJournal ?? (ledgerDatabase
    ? new PostgresPaymentJournal(ledgerDatabase.client, config.web3.securityLedgerId) : null) : null
  const chainObserver=config.web3?.chainDeployment ? dependencies.chainObserver ?? new DualChainObserver(config.web3,config.web3.chainDeployment) : null
  const attempts=chainObserver ? new TransactionAttemptService(database.client,auth,chainObserver) : null
  const payments = config.web3 && ledger && sellerPayout && paymentSigner && paymentJournal
    ? new PaymentIntentService(database.client, auth, sellerPayout, ledger, paymentJournal, paymentSigner,
      dependencies.paymentObserver ?? (chainObserver ? new CheckpointPaymentObserver(database.client,chainObserver) : null), config.web3, dependencies.walletEoaCheck ?? createEoaChecker(config.web3)) : null
  const media = new MediaService(
    database.client,
    dependencies.mediaStore ?? (config.mediaStore ? new GarageObjectStore(config.mediaStore) : null)
  )
  const privateFileConfig=config.privateFiles
  const privateFiles=dependencies.privateFiles ? new PrivateFileService(database.client,
    dependencies.privateFiles.store,dependencies.privateFiles.budget,dependencies.privateFiles.uploadKey)
    : privateFileConfig ? new PrivateFileService(database.client,new GaragePrivateObjectStore(privateFileConfig.store),
      privateFileConfig.budget,privateFileConfig.uploadKey) : null
  const fileStore = dependencies.privateFiles?.store ??
    (privateFileConfig ? new GaragePrivateObjectStore(privateFileConfig.store) : null)
  const fileOrigin = privateFileConfig?.uploadOrigin
  const downloads = config.web3 && fileStore && fileOrigin && privateFileConfig
    ? new DownloadService(database.client, config.web3, fileStore, fileOrigin,
      privateFileConfig.uploadKey) : null
  const deliverySigner = config.web3
    ? dependencies.deliverySigner ?? readDeliverySigner(config.web3.deliverySignerFile, config.web3) : null
  const deliveryPermits = config.web3 && fileStore && downloads && deliverySigner && chainObserver
    ? new DeliveryPermitService(database.client, config.web3, fileStore, deliverySigner,
      new ChainDeliverySignerVerifier(chainObserver)) : null
  const publications = config.web3 && fileStore && downloads
    ? new SupplementPublicationService(database.client, config.web3, fileStore) : null
  const evidence = config.web3 && downloads
    ? new EvidenceService(database.client, config.web3, downloads) : null
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
      controllers: [EvidenceController, DeliveryController, TransactionAttemptController,
        HealthController,
        AuthController,
        WalletIdentityController,
        TestnetController, PaymentIntentController, PrivateFileController,
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
        { provide: PaymentIntentService, useValue: payments },
        { provide: TransactionAttemptService, useValue: attempts },
        { provide: PrivateFileService, useValue: privateFiles },
        { provide: EvidenceService, useValue: evidence },
        { provide: DeliveryPermitService, useValue: deliveryPermits },
        { provide: DownloadService, useValue: downloads },
        { provide: SupplementPublicationService, useValue: publications },
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
