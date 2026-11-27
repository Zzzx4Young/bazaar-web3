import type { PublicationSource } from './publication-worker.js'
import { createHash } from 'node:crypto'
import { stable } from '../web3/chain-observer.js'
import type {
  RecoveryConsumptionGuard,
  RecoveryConsumptionReceipt,
  RecoveryConsumptionSnapshot
} from './recovery-authorization-publication.js'
import type {
  LocalCheckpointPublicationStore,
  PublicationRecord
} from './checkpoint-publication.js'
export const consumptionRecordContext = 'bazaar-recovery-consumption-v1\n'
export function consumptionPublication(receipt: RecoveryConsumptionSnapshot): PublicationRecord {
  const body = stable(receipt)
  return {
    version: 1,
    environmentId: receipt.environmentId,
    namespace: 'recovery-authorizations',
    ledgerId: receipt.nonce,
    sequence: 0,
    digest: createHash('sha256')
      .update(consumptionRecordContext + body)
      .digest('hex'),
    records: { RecoveryAuthorizationReceipt: [body] }
  }
}
/** Each nonce is an immutable single-event stream. The custody checkpoint's
 * global ordinal serializes publication and binds all nonce streams in its vector.
 * The nonce file IS the durable pending event; no second local write can lose it.
 * Failed publication burns the grant and forbids decryption; reconciliation may
 * publish the receipt later but never executes the consumed grant. */
export class PublishedRecoveryConsumptionGuard implements RecoveryConsumptionGuard {
  constructor(
    private readonly o: {
      journal: RecoveryConsumptionGuard & { readReceipts(): Promise<RecoveryConsumptionSnapshot[]> }
      store: Pick<LocalCheckpointPublicationStore, 'recover' | 'publish'>
    }
  ) {}
  async pending() {
    const receipts = await this.o.journal.readReceipts(),
      published = await this.o.store.recover()
    for (const entry of published.entries.filter(
      (e) => e.namespace === 'recovery-authorizations'
    )) {
      if (!receipts.some((r) => stable(consumptionPublication(r)) === stable(entry)))
        throw new Error('RECOVERY_CONSUMPTION_HISTORY_MISSING')
    }
    const pending: PublicationRecord[] = []
    for (const entry of receipts.map(consumptionPublication)) {
      if (!published.entries.some((p) => stable(p) === stable(entry))) {
        pending.push(entry)
        continue
      }
      // Readable does not prove root-directory fsync completed. Reconfirm even
      // matching entries through the fsync-backed idempotent publication path.
      const receipt = await this.o.store.publish(entry),
        actual = await this.o.store.recover(),
        at = actual.entries.findIndex((p) => stable(p) === stable(entry))
      if (at < 0 || actual.receipts[at]?.checkpointHash !== receipt.checkpointHash)
        throw new Error('RECOVERY_CONSUMPTION_READBACK_FAILED')
    }
    return pending
  }
  async reconcile() {
    for (const entry of await this.pending()) {
      const receipt = await this.o.store.publish(entry),
        actual = await this.o.store.recover(),
        at = actual.entries.findIndex((p) => stable(p) === stable(entry))
      if (at < 0 || actual.receipts[at]?.checkpointHash !== receipt.checkpointHash)
        throw new Error('RECOVERY_CONSUMPTION_READBACK_FAILED')
    }
  }
  source(): PublicationSource {
    return {
      pending: () => this.pending(),
      committed: async () =>
        (await this.o.journal.readReceipts())
          .map(consumptionPublication)
          .map(({ namespace, ledgerId, sequence, digest }) => ({
            namespace,
            ledgerId,
            sequence,
            digest
          })),
      acknowledge: async (entry, receiptHash) => {
        const actual = await this.o.store.recover(),
          at = actual.entries.findIndex((e) => stable(e) === stable(entry))
        if (at < 0 || actual.receipts[at]?.checkpointHash !== receiptHash)
          throw new Error('RECOVERY_CONSUMPTION_READBACK_FAILED')
      }
    }
  }
  async consume(receipt: RecoveryConsumptionReceipt) {
    const published = await this.o.store.recover()
    if (
      published.entries.some(
        (e) => e.namespace === 'recovery-authorizations' && e.ledgerId === receipt.nonce
      )
    )
      throw new Error('RECOVERY_AUTHORIZATION_CONSUMED')
    await this.o.journal.consume(receipt)
    await this.reconcile()
  }
}
