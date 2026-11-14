import type { Transaction } from '../database/transaction.js'
import type { VerifiedRange } from '../web3/escrow-state.js'
import { PrivateLifecycleLedger } from './deletion-ledger.js'
export function persistPrivateFinality(ledger: PrivateLifecycleLedger, scope: string) {
  return async (tx: Transaction, r: VerifiedRange) => {
    for (const o of r.orders) {
      if (!['Released', 'Refunded'].includes(o.state)) continue
      const terms = await tx.paymentOrderTerms.findMany({ where: { stockId: o.stockId } })
      const t = terms.find((t) => (t.terms as { orderId: string }).orderId === o.orderId)
      if (!t) throw new Error('Private retention order mapping missing')
      await ledger.terminal({
        scope,
        orderId: t.orderId,
        chainOrderId: o.orderId,
        state: o.state,
        height: r.snapshot.height,
        blockHash: r.snapshot.hash
      })
    }
  }
}
