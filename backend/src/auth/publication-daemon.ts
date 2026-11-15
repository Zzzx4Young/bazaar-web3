import { LocalRecoveryAuthorizationJournal } from './recovery-authorization-publication.js'
import { PublishedRecoveryConsumptionGuard } from './recovery-consumption-checkpoint.js'
import { createServer, type Server, type Socket } from 'node:net'
import { chmod, lstat, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseService } from '../database/database.service.js'
import { LocalCheckpointPublicationStore } from './checkpoint-publication.js'
import {
  PublicationWorker,
  combinePublicationSources,
  type PublicationSource
} from './publication-worker.js'
import {
  readPendingPublications,
  readCommittedPublicationHeads,
  acknowledgePublication
} from './publication-outbox.js'
import {
  readPublicationOwnerFile,
  type PublicationDaemonConfig
} from './publication-daemon-config.js'

export interface PublicationDaemon {
  wake(): Promise<void>
  close(): Promise<void>
}
/** Owner process only. IPC conveys a wake, never authority or ledger data. */
export async function startPublicationDaemon(
  config: PublicationDaemonConfig,
  options: { once?: boolean; onError?: (code: string) => void } = {}
): Promise<PublicationDaemon> {
  const databases: DatabaseService[] = [],
    sockets = new Set<Socket>()
  let server: Server | undefined, worker: PublicationWorker | undefined
  let closing: Promise<void> | undefined,
    stopped = false
  const report = (code: string) => {
    try {
      options.onError?.(code)
    } catch {
      /* logging must not stop retries */
    }
  }
  const close = () =>
    (closing ??= (async () => {
      stopped = true
      const closed = server?.listening
        ? new Promise<void>((resolve) => server!.close(() => resolve()))
        : undefined
      for (const s of sockets) s.destroy()
      await worker?.stop()
      await closed
      await Promise.all(databases.map((db) => db.onModuleDestroy()))
    })())
  try {
    const encryptionKey = await readPublicationOwnerFile(config.encryptionKeyFile, 32)
    if (encryptionKey.length !== 32) throw new Error('PUBLICATION_DAEMON_KEY')
    // Read owner-only key files here as well as in the store; website config
    // and environment never receive their contents.
    await readPublicationOwnerFile(config.privateKeyFile, 16384)
    await readPublicationOwnerFile(config.publicKeyFile, 16384)
    const storeOptions = {
      directory: config.custodyDirectory,
      environmentId: config.environmentId,
      configurationVersion: config.configurationVersion,
      publicKeyFile: config.publicKeyFile,
      privateKeyFile: config.privateKeyFile,
      encryptionKey,
      baselineCheckpoints: config.baselineCheckpoints
    }
    const store = new LocalCheckpointPublicationStore(storeOptions)
    const sources: PublicationSource[] = []
    for (const descriptor of config.ledgerSources) {
      const url = new URL(
        (await readPublicationOwnerFile(descriptor.urlFile, 16384)).toString('utf8').trim()
      )
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname === '/')
        throw new Error('PUBLICATION_DAEMON_DATABASE')
      const db = new DatabaseService(url.toString())
      databases.push(db)
      // Connections initialize lazily so a temporarily unavailable DB can be
      // retried by the worker's startup/periodic reconciliation.
      const owns = (p: { namespace: string; ledgerId: string }) =>
        p.namespace === descriptor.namespace && p.ledgerId === descriptor.ledgerId
      sources.push({
        pending: async () => {
          const entries = (await readPendingPublications(db.client)).filter(owns)
          if (entries.some((e) => e.environmentId !== config.environmentId))
            throw new Error('PUBLICATION_ENVIRONMENT')
          return entries
        },
        committed: async () => {
          const heads = (await readCommittedPublicationHeads(db.client)).filter(owns)
          if (heads.length !== 1) throw new Error('PUBLICATION_SOURCE_MISSING')
          return heads
        },
        acknowledge: async (entry, hash) => {
          if (
            !owns(entry) ||
            entry.environmentId !== config.environmentId ||
            entry.namespace === 'recovery-authorizations'
          )
            throw new Error('PUBLICATION_SOURCE_CONFLICT')
          await acknowledgePublication(db.client, { ...entry, namespace: entry.namespace }, hash)
        }
      })
    }
    if (config.authorizationJournal) {
      const j = config.authorizationJournal
      const journal = new LocalRecoveryAuthorizationJournal({
        directory: j.directory,
        usedDirectory: j.usedDirectory,
        binding: {
          environmentId: config.environmentId,
          recoveryId: j.recoveryId,
          checkpointHash: j.checkpointHash,
          configurationVersion: config.configurationVersion
        }
      })
      sources.push(new PublishedRecoveryConsumptionGuard({ journal, store }).source())
    }
    worker = new PublicationWorker({
      source: combinePublicationSources(sources),
      store,
      onError: report,
      scheduler: {
        every: (fn, ms) =>
          setInterval(() => {
            void fn().catch(() => undefined)
          }, ms),
        clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
      }
    })
    const wake = async () => {
      if (!stopped) await worker!.notify().catch(() => undefined)
    }
    if (!options.once && config.wakeSocket) {
      const parent = dirname(config.wakeSocket),
        info = await lstat(parent)
      if (
        !info.isDirectory() ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o022 ||
        (await realpath(parent)) !== parent
      )
        throw new Error('PUBLICATION_DAEMON_SOCKET')
      // bind fails on every pre-existing path, including stale sockets. Never rm.
      server = createServer((socket) => {
        sockets.add(socket)
        socket.on('error', () => undefined)
        socket.on('close', () => sockets.delete(socket))
        socket.resume()
        socket.end()
        socket.setTimeout(1000, () => socket.destroy())
        void wake()
      })
      await new Promise<void>((resolve, reject) => {
        const failed = () => reject(new Error('PUBLICATION_DAEMON_SOCKET'))
        server!.once('error', failed)
        // Unix bind is synchronous: create private even under a permissive
        // inherited umask, then explicitly grant optional group access below.
        const previousMask = process.umask(0o177)
        try {
          server!.listen(config.wakeSocket!, () => {
            server!.removeListener('error', failed)
            resolve()
          })
        } finally {
          process.umask(previousMask)
        }
      })
      server.on('error', () => report('PUBLICATION_DAEMON_SOCKET'))
      await chmod(config.wakeSocket, config.wakeSocketMode ?? 0o600)
    }
    if (options.once) {
      await worker.reconcile()
      await close()
    } else {
      // start retains the real timer after failures. Wake/periodic retries own
      // recovery; no failure is allowed to lose the durable pending queue.
      await worker.start().catch(() => undefined)
    }
    return { wake, close }
  } catch {
    await close()
    throw new Error('PUBLICATION_DAEMON_START')
  }
}
