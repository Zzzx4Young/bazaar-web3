// Isolated browser-test child. Backend imports finish before an optional UID drop;
// configuration comes only from the recovered bootstrap, never readConfig/.env.
import 'reflect-metadata'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { createInterface } from 'node:readline'
import { constants } from 'node:fs'
import { open, lstat, realpath, readdir, unlink, access } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, dirname } from 'node:path'
import { createApp } from '../../dist/app.js'
import { DatabaseService } from '../../dist/database/database.service.js'
import { LedgerWitness, registerLedgerWitness } from '../../dist/auth/ledger-witness.js'
import { createWitnessCheckpointGuard } from '../../dist/auth/recovery-authority.js'
import { PostgresWalletSecurityLedger } from '../../dist/auth/postgres-wallet-security-ledger.js'
import { PostgresPaymentJournal } from '../../dist/web3/payment-journal.js'
import { readPaymentSigner } from '../../dist/web3/payment-signer.js'
import { readDeliverySigner } from '../../dist/delivery-files/delivery-permit.service.js'
import { PrivateLifecycleLedger } from '../../dist/delivery-files/deletion-ledger.js'
import { GaragePrivateObjectStore } from '../../dist/delivery-files/object-store.js'
import { PrivateFileService } from '../../dist/delivery-files/upload.service.js'
import { DownloadService } from '../../dist/delivery-files/download.service.js'
import { createPrivateUploadGateway } from '../../dist/delivery-files/upload-gateway.js'

// Start IPC or stdin JSON line: {root, bootstrapPath, uid, gid, parentGid, originalDirectory,
// custodyDirectory, trustedPublicKeyFile, checkpointDirectory}. bootstrapPath,
// signer and witness paths are inside root. Public key/checkpoint documents are
// direct children of the separate owner-controlled 0755 checkpointDirectory;
// trustedPublicKeyFile is pinned by the start message only, never selected by the bundle.
// Bootstrap shape:
// {config, securityUrl, securityId, witnessDirectory, privateUrl, privateId,
// privateWitnessDirectory, paymentFile, deliveryFile, port, uploadPort,
// trustedCheckpointOptions:{wallet,private}}. config.privateFiles.uploadKeyHex
// replaces uploadKey. Optional config.configurationVersion is reported unchanged,
// or null if omitted. Responses contain no credentials/configuration. Without
// process.send, stdout carries only newline-delimited JSON protocol responses.
// Close message: {type:'close'} (or 'close'); stdin EOF/disconnect/signals close.
let app, gateway, uploadKey, starting, stopping
let started = false,
  closing = false,
  diagnostic = 'INVALID_START'
const databases = []
const ipc = typeof process.send === 'function'
let pendingOutput = Promise.resolve()
function requireValid(value) {
  if (!value) throw new Error('INVALID_RECOVERED_RUNTIME')
}
function send(value) {
  pendingOutput = pendingOutput.then(
    () =>
      new Promise((resolveSend) => {
        if (ipc) {
          if (process.connected) process.send(value, () => resolveSend())
          else resolveSend()
        } else process.stdout.write(JSON.stringify(value) + '\n', () => resolveSend())
      })
  )
}
async function within(root, path) {
  requireValid(typeof path === 'string' && resolve(path) === path)
  const tail = relative(root, path)
  requireValid(tail && tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail))
  requireValid((await realpath(path)) === path)
  return path
}
async function bootstrapFile(root, path) {
  await within(root, path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const bytes = Buffer.alloc(1048577)
  try {
    const s = await file.stat()
    requireValid(
      s.isFile() &&
        s.uid === process.getuid() &&
        !(s.mode & 0o077) &&
        s.nlink === 1 &&
        s.size <= 1048576
    )
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    requireValid(length <= 1048576)
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally {
    bytes.fill(0)
    await file.close()
  }
}
async function denied(action) {
  try {
    await action()
    return false
  } catch (error) {
    return error.code === 'EACCES' || error.code === 'EPERM'
  }
}
async function originalSecretDenied(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const bytes = Buffer.alloc(1)
    try {
      await file.read(bytes, 0, 1, 0)
    } finally {
      bytes.fill(0)
    }
  } finally {
    await file.close()
  }
}
async function custodyProbe(directory) {
  const path = join(directory, 'probe')
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile('probe')
  } finally {
    await file.close()
    await unlink(path)
  }
}
function stop(code = 0) {
  closing = true
  if (stopping) return
  stopping = (async () => {
    const timer = setTimeout(() => process.exit(code || 1), 5000)
    timer.unref()
    await starting
    let failed = false
    if (gateway) {
      gateway.closeAllConnections?.()
      await new Promise((resolveClose) => gateway.close(() => resolveClose()))
    }
    if (app) {
      try {
        await app.close()
      } catch {
        failed = true
      }
    }
    const results = await Promise.allSettled(databases.map((db) => db.onModuleDestroy()))
    failed ||= results.some((result) => result.status === 'rejected')
    uploadKey?.fill(0)
    if (failed) send({ error: 'RUNTIME_CLOSE_FAILED' })
    await pendingOutput
    clearTimeout(timer)
    process.exit(code || (failed ? 1 : 0))
  })().catch(() => process.exit(1))
}
async function start(message) {
  requireValid(message && typeof message === 'object')
  const {
    root,
    bootstrapPath,
    uid,
    gid,
    parentGid,
    originalDirectory,
    custodyDirectory,
    trustedPublicKeyFile,
    checkpointDirectory,
    trustedProfileFile
  } = message
  for (const path of [
    root,
    bootstrapPath,
    originalDirectory,
    custodyDirectory,
    trustedPublicKeyFile,
    checkpointDirectory,
    trustedProfileFile
  ])
    requireValid(typeof path === 'string' && resolve(path) === path)
  for (const id of [uid, gid, parentGid]) requireValid(Number.isSafeInteger(id) && id > 0)
  diagnostic = 'PRIVILEGE_DROP_FAILED'
  if (process.getuid() === 0) {
    process.setgroups([parentGid])
    process.setgid(gid)
    process.setuid(uid)
  }
  requireValid(process.getuid() === uid && process.getgid() === gid)
  diagnostic = 'BOOTSTRAP_REJECTED'
  const info = await lstat(root)
  requireValid(
    info.isDirectory() &&
      info.uid === uid &&
      (info.mode & 0o7777) === 0o700 &&
      (await realpath(root)) === root
  )
  await within(root, bootstrapPath)
  diagnostic = 'ISOLATION_CHECK_FAILED'
  const originalReadDenied =
    (await denied(() => readdir(originalDirectory))) &&
    (await denied(() =>
      originalSecretDenied(join(originalDirectory, relative(root, bootstrapPath)))
    ))
  const custodyWriteDenied = await denied(() => custodyProbe(custodyDirectory))
  requireValid(originalReadDenied && custodyWriteDenied)
  diagnostic = 'BOOTSTRAP_REJECTED'
  const bootstrap = await bootstrapFile(root, bootstrapPath)
  const {
    config,
    securityUrl,
    securityId,
    witnessDirectory,
    privateUrl,
    privateId,
    privateWitnessDirectory,
    paymentFile,
    deliveryFile,
    port,
    uploadPort,
    trustedCheckpointOptions
  } = bootstrap
  requireValid(
    config?.web3 &&
      config.privateFiles &&
      trustedCheckpointOptions?.wallet &&
      trustedCheckpointOptions.private
  )
  for (const value of [port, uploadPort])
    requireValid(Number.isSafeInteger(value) && value > 0 && value <= 65535)
  requireValid(port !== uploadPort && /^[0-9a-fA-F]{64}$/.test(config.privateFiles.uploadKeyHex))
  const configVersion = config.configurationVersion ?? null
  requireValid(
    configVersion === null ||
      (typeof configVersion === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(configVersion)) ||
      (Number.isSafeInteger(configVersion) && configVersion > 0)
  )
  for (const path of [witnessDirectory, privateWitnessDirectory, paymentFile, deliveryFile])
    await within(root, path)
  diagnostic = 'CHECKPOINT_TRUST_REJECTED'
  // Neither trust-directory nor package may contain the other. Public material
  // is authenticated by pinned signatures, not by privateRoot ownership rules.
  const contains = (directory, path) => {
    const tail = relative(directory, path)
    return !tail || (tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail))
  }
  requireValid(!contains(root, checkpointDirectory) && !contains(checkpointDirectory, root))
  requireValid((await realpath(checkpointDirectory)) === checkpointDirectory)
  const trust = await lstat(checkpointDirectory)
  requireValid(trust.isDirectory() && trust.uid !== uid && (trust.mode & 0o7777) === 0o755)
  requireValid(await denied(() => access(checkpointDirectory, constants.W_OK)))
  async function publicDocument(path) {
    await within(checkpointDirectory, path)
    requireValid(dirname(path) === checkpointDirectory)
    const file = await lstat(path)
    requireValid(
      file.isFile() &&
        file.uid === trust.uid &&
        !(file.mode & 0o022) &&
        file.nlink === 1 &&
        file.size <= 16384
    )
    requireValid(await denied(() => access(path, constants.W_OK)))
  }
  await publicDocument(trustedPublicKeyFile)
  await publicDocument(trustedProfileFile)
  const profile = await open(trustedProfileFile, constants.O_RDONLY | constants.O_NOFOLLOW)
  let trustedOptions
  try {
    trustedOptions = JSON.parse(await profile.readFile('utf8'))
  } finally {
    await profile.close()
  }
  requireValid(JSON.stringify(trustedOptions) === JSON.stringify(trustedCheckpointOptions))
  for (const [options, id, namespace] of [
    [trustedCheckpointOptions.wallet, securityId, 'wallet'],
    [trustedCheckpointOptions.private, privateId, 'private-files']
  ]) {
    requireValid(
      options.ledgerId === id &&
        options.namespace === namespace &&
        options.publicKeyFile === trustedPublicKeyFile
    )
    await publicDocument(options.checkpointFile)
    await publicDocument(options.historyFile)
    await publicDocument(options.configurationFile)
  }
  requireValid(
    trustedCheckpointOptions.wallet.environmentId === trustedCheckpointOptions.private.environmentId
  )
  uploadKey = Buffer.from(config.privateFiles.uploadKeyHex, 'hex')
  delete config.privateFiles.uploadKeyHex
  config.privateFiles.uploadKey = uploadKey
  config.web3.controlledRecovery = true
  config.web3.securityCheckpoint = trustedCheckpointOptions.wallet
  config.web3.securityLedgerUrl = securityUrl
  config.web3.securityLedgerId = securityId
  config.web3.securityWitnessDirectory = witnessDirectory
  config.web3.paymentSignerFile = paymentFile
  config.web3.deliverySignerFile = deliveryFile
  config.privateLifecycle = {
    url: privateUrl,
    ledgerId: privateId,
    witnessDirectory: privateWitnessDirectory,
    checkpoint: trustedCheckpointOptions.private
  }
  config.port = port
  diagnostic = 'SIGNER_LOAD_FAILED'
  const paymentSigner = readPaymentSigner(paymentFile)
  const deliverySigner = readDeliverySigner(deliveryFile, config.web3)
  requireValid(paymentSigner && deliverySigner)
  diagnostic = 'LEDGER_OPEN_FAILED'
  const security = new DatabaseService(securityUrl, { ...config.databasePool, max: 2 })
  databases.push(security)
  const privateDatabase = new DatabaseService(privateUrl, { ...config.databasePool, max: 2 })
  databases.push(privateDatabase)
  await Promise.all(databases.map((db) => db.onModuleInit()))
  const witness = new LedgerWitness(
    security.client,
    securityId,
    witnessDirectory,
    'wallet',
    createWitnessCheckpointGuard(trustedCheckpointOptions.wallet)
  )
  registerLedgerWitness(security.client, witness)
  await witness.verify()
  const walletLedger = new PostgresWalletSecurityLedger(security.client, securityId)
  const privateLedger = new PrivateLifecycleLedger(
    privateDatabase.client,
    privateId,
    privateWitnessDirectory,
    undefined,
    createWitnessCheckpointGuard(trustedCheckpointOptions.private)
  )
  await privateLedger.verify()
  if (closing) return
  diagnostic = 'APP_OPEN_FAILED'
  const store = new GaragePrivateObjectStore(config.privateFiles.store)
  app = await createApp(config, false, {
    logRequest: false,
    walletLedger,
    privateLedger,
    paymentSigner,
    deliverySigner,
    paymentJournal: new PostgresPaymentJournal(security.client, securityId),
    privateFiles: { store, budget: config.privateFiles.budget, uploadKey }
  })
  if (closing) return
  diagnostic = 'LISTEN_FAILED'
  gateway = createPrivateUploadGateway(
    app.get(PrivateFileService),
    config.appOrigin,
    app.get(DownloadService)
  )
  await new Promise((resolveListen, reject) => {
    gateway.once('error', reject)
    gateway.listen(uploadPort, '127.0.0.1', () => {
      gateway.off('error', reject)
      resolveListen()
    })
  })
  await app.listen(port, '127.0.0.1')
  if (!closing)
    send({
      ready: true,
      originalReadDenied,
      custodyWriteDenied,
      pid: process.pid,
      uid: process.getuid(),
      configVersion
    })
}

function dispatch(message) {
  if (message === 'close' || message?.type === 'close') {
    stop()
    return
  }
  if (started || closing) {
    send({ error: 'INVALID_PROTOCOL' })
    stop(1)
    return
  }
  started = true
  starting = start(message).catch(() => {
    send({ error: diagnostic })
    stop(1)
  })
}
if (ipc) {
  process.on('message', dispatch)
  process.once('disconnect', () => stop())
} else {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  input.on('line', (line) => {
    try {
      requireValid(Buffer.byteLength(line) <= 16384)
      dispatch(JSON.parse(line))
    } catch {
      send({ error: 'INVALID_PROTOCOL' })
      stop(1)
    }
  })
  input.once('close', () => stop())
  process.stdin.once('error', () => stop(1))
  process.stdout.once('error', () => stop(1))
}
process.once('SIGTERM', () => stop())
process.once('SIGINT', () => stop())
process.on('uncaughtException', () => {
  send({ error: 'RUNTIME_FAILED' })
  stop(1)
})
process.on('unhandledRejection', () => {
  send({ error: 'RUNTIME_FAILED' })
  stop(1)
})
