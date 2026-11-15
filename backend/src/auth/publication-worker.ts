import { setInterval, clearInterval } from 'node:timers'
import { stable } from '../web3/chain-observer.js'
import type { PublicationRecord, PublicationReceipt } from './checkpoint-publication.js'
export interface PublicationPosition {
  namespace: PublicationRecord['namespace']
  ledgerId: string
  sequence: number
  digest: string
}
export interface PublicationSource {
  pending(): Promise<PublicationRecord[]>
  committed(): Promise<PublicationPosition[]>
  acknowledge(entry: PublicationRecord, receiptHash: string): Promise<void>
}
interface Store {
  recover(): Promise<{ entries: PublicationRecord[]; receipts: PublicationReceipt[] }>
  publish(entry: PublicationRecord): Promise<PublicationReceipt>
}
interface Scheduler {
  every(fn: () => Promise<void>, milliseconds: number): unknown
  clear(handle: unknown): void
}
const key = (p: PublicationPosition) => p.namespace + ':' + p.ledgerId
/** Single local coordinator: notifications only wake durable work. Startup and
 * each 60-second tick reconcile committed versus verified-published positions.
 * A publication failure never undoes a ledger/chain mutation. */
export class PublicationWorker {
  private active?: Promise<void>
  private timer?: unknown
  private stopped = false
  private result: { state: 'pending' | 'confirmed' | 'isolated'; error?: string } = {
    state: 'pending'
  }
  private readonly scheduler: Scheduler
  constructor(
    private readonly o: {
      source: PublicationSource
      store: Store
      scheduler?: Scheduler
      offchainHistoryVerified?: () => Promise<boolean>
      onError?: (code: string) => void
    }
  ) {
    this.scheduler = o.scheduler ?? {
      every: (fn, ms) => {
        const t = setInterval(() => {
          void fn().catch(() => undefined)
        }, ms)
        t.unref()
        return t
      },
      clear: (h) => clearInterval(h as ReturnType<typeof setInterval>)
    }
  }
  private async compare(requireComplete: boolean) {
    if (this.o.offchainHistoryVerified && !(await this.o.offchainHistoryVerified()))
      throw new Error('PUBLICATION_OFFCHAIN_HISTORY_UNPROVEN')
    const committed = await this.o.source.committed(),
      material = await this.o.store.recover(),
      published = material.receipts.at(-1)?.checkpoint.ledgers ?? []
    for (const p of published) {
      const c = committed.find((x) => key(x) === key(p))
      if (!c || c.sequence < p.sequence || (c.sequence === p.sequence && c.digest !== p.digest))
        throw new Error('PUBLICATION_ROLLBACK')
    }
    if (
      requireComplete &&
      committed.some(
        (c) =>
          !published.some(
            (p) => key(c) === key(p) && c.sequence === p.sequence && c.digest === p.digest
          )
      )
    )
      throw new Error('PUBLICATION_INCOMPLETE')
  }
  reconcile(): Promise<void> {
    if (this.active) return this.active
    this.active = (async () => {
      try {
        await this.compare(false)
        for (let attempt = 0; attempt < 1000; attempt++) {
          const pending = await this.o.source.pending()
          if (!pending.length) {
            await this.compare(true)
            this.result = { state: 'confirmed' }
            return
          }
          for (const entry of pending) {
            const receipt = await this.o.store.publish(entry),
              actual = await this.o.store.recover(),
              index = actual.entries.findIndex((e) => stable(e) === stable(entry))
            if (index < 0 || actual.receipts[index]?.checkpointHash !== receipt.checkpointHash)
              throw new Error('PUBLICATION_READBACK_MISMATCH')
            await this.o.source.acknowledge(entry, receipt.checkpointHash)
          }
        }
        throw new Error('PUBLICATION_BACKLOG_LIMIT')
      } catch (e) {
        const code =
          e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'PUBLICATION_UNAVAILABLE'
        this.result = { state: 'isolated', error: code }
        this.o.onError?.(code)
        throw e
      }
    })().finally(() => {
      this.active = undefined
    })
    return this.active
  }
  notify(): Promise<void> {
    return this.stopped ? Promise.resolve() : this.reconcile()
  }
  async start() {
    if (this.timer !== undefined) throw new Error('PUBLICATION_WORKER_ALREADY_STARTED')
    this.stopped = false
    this.timer = this.scheduler.every(() => this.notify(), 60000)
    // Retain retry timer on startup failure; caller sees failure and does not open.
    await this.reconcile()
  }
  async stop() {
    this.stopped = true
    if (this.timer !== undefined) this.scheduler.clear(this.timer)
    this.timer = undefined
    await this.active?.catch(() => undefined)
  }
  async status() {
    try {
      await this.compare(true)
      if ((await this.o.source.pending()).length) throw new Error('PUBLICATION_ACK_PENDING')
      this.result = { state: 'confirmed' }
    } catch (e) {
      this.result = {
        state: 'isolated',
        error:
          e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'PUBLICATION_UNAVAILABLE'
      }
    }
    return { ...this.result }
  }
}

/** Sources must own disjoint streams; a shared custody vector must be checked
 * against all participants, including independently consumed recovery grants. */
export function combinePublicationSources(sources: PublicationSource[]): PublicationSource {
  async function heads() {
    const positions = (await Promise.all(sources.map((s) => s.committed()))).flat()
    if (new Set(positions.map(key)).size !== positions.length)
      throw new Error('PUBLICATION_SOURCE_CONFLICT')
    return positions
  }
  return {
    committed: heads,
    pending: async () => {
      await heads()
      return (await Promise.all(sources.map((s) => s.pending())))
        .flat()
        .sort((a, b) => a.sequence - b.sequence || key(a).localeCompare(key(b)))
    },
    acknowledge: async (entry, receiptHash) => {
      const positions = await Promise.all(sources.map((s) => s.committed()))
      const owners = positions
        .map((p, i) => (p.some((h) => key(h) === key(entry)) ? i : -1))
        .filter((i) => i >= 0)
      if (owners.length !== 1) throw new Error('PUBLICATION_SOURCE_CONFLICT')
      await sources[owners[0]].acknowledge(entry, receiptHash)
    }
  }
}
